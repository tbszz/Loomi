import { createHash } from 'node:crypto';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { createQianwenEmbeddingProvider } from './cloudEmbeddingClient.js';
import { createGoogleEmbeddingProvider } from './googleEmbeddingClient.js';

// Opt-in only. Cloud embeddings require a distinct explicit provider and key;
// chat credentials cannot authorize candidate retrieval transport.
export function createConfiguredEmbeddingProvider(env = process.env) {
  if (!env.RESUME_EMBEDDING_MODEL) return null;
  const provider = env.RESUME_EMBEDDING_PROVIDER ?? 'ollama';
  if (provider === 'qianwen') {
    const rawDimensions = env.RESUME_EMBEDDING_DIMENSIONS;
    if (rawDimensions !== undefined && (typeof rawDimensions !== 'string' || !/^(256|512|768|1024)$/.test(rawDimensions))) throw new Error('云端嵌入维度配置无效。');
    return createQianwenEmbeddingProvider({
    baseUrl: env.RESUME_EMBEDDING_BASE_URL, model: env.RESUME_EMBEDDING_MODEL,
    apiKey: env.RESUME_EMBEDDING_API_KEY,
    dimensions: rawDimensions === undefined ? undefined : Number(rawDimensions),
    revision: env.RESUME_EMBEDDING_REVISION,
    });
  }
  if (provider === 'google') {
    const rawDimensions = env.RESUME_EMBEDDING_DIMENSIONS;
    if (rawDimensions !== undefined && (typeof rawDimensions !== 'string' || !/^(768|1536|3072)$/.test(rawDimensions))) throw new Error('云端嵌入维度配置无效。');
    return createGoogleEmbeddingProvider({
      baseUrl: env.RESUME_EMBEDDING_BASE_URL, model: env.RESUME_EMBEDDING_MODEL,
      apiKey: env.RESUME_EMBEDDING_API_KEY,
      dimensions: rawDimensions === undefined ? undefined : Number(rawDimensions),
      revision: env.RESUME_EMBEDDING_REVISION,
      fetchImpl: proxyFetchImpl(env),
    });
  }
  if (provider !== 'ollama') throw new Error('嵌入服务提供方配置无效。');
  return createLocalEmbeddingProvider({ baseUrl: env.RESUME_EMBEDDING_BASE_URL, model: env.RESUME_EMBEDDING_MODEL, digest: env.RESUME_EMBEDDING_DIGEST });
}

// Reachable-endpoint policy: some networks cannot reach the approved cloud
// endpoint directly. When a proxy is configured for this process, scope it to
// the embedding transport only; chat and other traffic keep their own routes.
function proxyFetchImpl(env) {
  const proxyUrl = env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
  if (!proxyUrl) return undefined;
  try {
    const url = new URL(proxyUrl);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error();
    const agent = new ProxyAgent({ uri: url.origin });
    return (endpoint, init) => undiciFetch(endpoint, { ...init, dispatcher: agent });
  } catch {
    // The configured value may embed credentials; never echo it back.
    throw new Error('云端嵌入代理配置无效。');
  }
}

export function createLocalEmbeddingProvider({ baseUrl = 'http://127.0.0.1:11434', model, digest, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error('本地嵌入服务地址无效。'); }
  if (!['http:','https:'].includes(url.protocol) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) throw new Error('嵌入服务只允许显式配置的本机地址。');
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  if (typeof model !== 'string' || !/^[A-Za-z0-9_./:-]{1,120}$/.test(model) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/i.test(digest)) throw new Error('请配置本机已有的嵌入模型及其完整模型版本 digest。');
  const origin = url.origin;
  const id = `ollama:${createHash('sha256').update(JSON.stringify([origin, model, digest.toLowerCase()])).digest('hex')}`;
  const json = async (route, options, signal) => {
    const response = await fetchImpl(`${origin}${route}`, { ...options, redirect: 'error', signal });
    if (!response.ok) throw new Error('本地嵌入服务未成功返回。');
    const reader = response.body.getReader();
    let bytes = 0; const chunks = [];
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('嵌入结果超出大小限制。'); }
        chunks.push(Buffer.from(value));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { reader.releaseLock(); }
  };
  return {
    id,
    async embed({ texts, purpose, signal } = {}) {
      signal?.throwIfAborted();
      if (!['query','document'].includes(purpose) || !Array.isArray(texts) || !texts.length || texts.length > 32 || texts.some(text => typeof text !== 'string' || !text.trim() || text.length > 8192) || texts.reduce((sum, text) => sum + text.length, 0) > 128000) throw new Error('嵌入输入不符合批次或长度限制。');
      const active = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]);
      const verifyModel = async () => {
        const tags = await json('/api/tags', { method: 'GET' }, active);
        const installed = tags.models?.find(item => [item.name, item.model].includes(model));
        if (!installed || installed.digest?.toLowerCase() !== digest.toLowerCase()) throw new Error('本地嵌入模型版本已变化或未安装，请核对配置并重建索引。');
      };
      await verifyModel();
      const result = await json('/api/embed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input: texts, truncate: false }) }, active);
      active.throwIfAborted();
      const vectors = result.embeddings;
      const dimensions = vectors?.[0]?.length;
      if (!Array.isArray(vectors) || vectors.length !== texts.length || !Number.isInteger(dimensions) || dimensions < 1 || dimensions > 16384 || vectors.some(vector => !Array.isArray(vector) || vector.length !== dimensions || vector.some(value => typeof value !== 'number' || !Number.isFinite(value)) || !vector.some(value => value !== 0))) throw new Error('嵌入服务返回了无效向量。');
      // Tags are mutable: reject a replacement observed while /api/embed ran,
      // rather than caching its vectors under the previous model digest.
      await verifyModel();
      active.throwIfAborted();
      return vectors;
    }
  };
}
