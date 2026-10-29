import { createHash } from 'node:crypto';

const APPROVED_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const APPROVED_MODEL = 'gemini-embedding-001';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TASK_TYPES = { query: 'RETRIEVAL_QUERY', document: 'RETRIEVAL_DOCUMENT' };

// One text per embedContent request: the Generative Language embedding endpoint
// takes a single part, so retrieval batches fan out into sequential calls with
// a per-request deadline instead of one deadline for the whole batch.
export function createGoogleEmbeddingProvider({ baseUrl, model, apiKey, dimensions = 3072, revision, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error('云端嵌入服务地址无效。'); }
  if (typeof baseUrl !== 'string' || /[?#]/.test(baseUrl) || url.origin !== 'https://generativelanguage.googleapis.com' || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, '') !== '/v1beta') throw new Error('云端嵌入服务只允许显式批准的 HTTPS 地址。');
  if (model !== APPROVED_MODEL) throw new Error('请配置明确批准的云端嵌入模型。');
  if (![768, 1536, 3072].includes(dimensions)) throw new Error('云端嵌入维度配置无效。');
  if (typeof revision !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(revision)) throw new Error('请配置非敏感的云端嵌入模型版本标识。');
  if (typeof apiKey !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(apiKey)) throw new Error('请单独配置云端嵌入服务凭据。');
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('云端嵌入传输配置无效。');
  const endpoint = `${APPROVED_BASE_URL}/models/${APPROVED_MODEL}:embedContent`;
  const id = `google:${createHash('sha256').update(JSON.stringify([APPROVED_BASE_URL, model, dimensions, revision])).digest('hex')}`;

  return {
    id,
    async embed({ texts, purpose, signal } = {}) {
      if (signal?.aborted) throw new Error('云端嵌入请求已取消。');
      if (!['query', 'document'].includes(purpose) || !Array.isArray(texts) || !texts.length || texts.length > 32 || Array.from(texts).some(text => typeof text !== 'string' || !text.trim() || text.length > 8192) || texts.reduce((sum, text) => sum + text.length, 0) > 128000) throw new Error('嵌入输入不符合批次或长度限制。');
      // Snapshot the complete validated batch before asynchronous transport.
      const input = [...texts];
      const taskType = TASK_TYPES[purpose];
      const vectors = [];
      let failure = '云端嵌入服务未成功返回。';
      let timedOut = false;
      let activeController = null;
      try {
        for (const text of input) {
          if (signal?.aborted) throw new Error('云端嵌入请求已取消。');
          const controller = new AbortController();
          activeController = controller;
          const cancel = () => controller.abort();
          signal?.addEventListener('abort', cancel, { once: true });
          const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
          const abortError = () => new Error(timedOut ? '云端嵌入请求超时。' : '云端嵌入请求已取消。');
          // Race each operation as well as passing the signal: a stalled response
          // reader or an injected transport must not outlive the request deadline.
          const bounded = async operation => {
            if (controller.signal.aborted) throw abortError();
            let onAbort;
            const aborted = new Promise((_, reject) => {
              onAbort = () => reject(abortError());
              controller.signal.addEventListener('abort', onAbort, { once: true });
            });
            try { return await Promise.race([operation(), aborted]); }
            finally { controller.signal.removeEventListener('abort', onAbort); }
          };
          try {
            const response = await bounded(() => fetchImpl(endpoint, {
              method: 'POST', redirect: 'error', signal: controller.signal,
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
              body: JSON.stringify({ model: `models/${APPROVED_MODEL}`, content: { parts: [{ text }] }, taskType, outputDimensionality: dimensions }),
            }));
            if (!response.ok || response.redirected || (response.url && response.url !== endpoint)) {
              response.body?.cancel().catch(() => {});
              throw new Error();
            }
            const reader = response.body.getReader();
            const chunks = [];
            let bytes = 0;
            let complete = false;
            try {
              while (true) {
                const { done, value } = await bounded(() => reader.read());
                if (done) { complete = true; break; }
                bytes += value.byteLength;
                if (bytes > MAX_RESPONSE_BYTES) { failure = '嵌入结果超出大小限制。'; throw new Error(); }
                chunks.push(Buffer.from(value));
              }
            } finally {
              if (!complete) reader.cancel().catch(() => {});
              reader.releaseLock();
            }
            const result = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
            failure = '云端嵌入服务返回了无效向量。';
            const values = result?.embedding?.values;
            if (!result || (Object.hasOwn(result, 'model') && result.model !== `models/${APPROVED_MODEL}`) || !Array.isArray(values) || values.length !== dimensions || values.some(value => typeof value !== 'number' || !Number.isFinite(value)) || !values.some(value => value !== 0)) throw new Error();
            vectors.push(values);
            failure = '云端嵌入服务未成功返回。';
          } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', cancel);
            activeController = null;
          }
        }
        if (signal?.aborted) throw new Error('云端嵌入请求已取消。');
        return vectors;
      } catch {
        // Do not retain upstream Error/cause, response bodies, URLs, inputs,
        // headers or caller abort reasons in errors returned to retrieval.
        activeController?.abort();
        if (signal?.aborted) throw new Error('云端嵌入请求已取消。');
        if (timedOut) throw new Error('云端嵌入请求超时。');
        throw new Error(failure);
      }
    },
  };
}
