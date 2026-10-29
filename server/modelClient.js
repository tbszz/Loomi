import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

import { requestMiniMax } from "./minimaxClient.js";
import { createClaudeAgentModel } from './claudeAgent.js';

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 75_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export function createDefaultModel({ dataDir, skills } = {}) {
  const sessionDirectory = path.join(dataDir || process.env.RESUME_PROTOCOL_DATA_DIR || path.join(root, 'data'), 'agent-sessions');
  const runtime = process.env.RESUME_PROTOCOL_AGENT_RUNTIME || 'auto';
  if (!['auto', 'claude', 'minimax', 'bigmodel', 'compatible'].includes(runtime)) throw new Error('RESUME_PROTOCOL_AGENT_RUNTIME 必须为 auto、claude、minimax、bigmodel 或 compatible。');
  if (runtime === 'bigmodel') return createClaudeAgentModel({ provider: 'bigmodel', apiKey: process.env.BIGMODEL_API_KEY,
    baseUrl: 'https://open.bigmodel.cn/api/anthropic', model: process.env.BIGMODEL_MODEL || 'glm-5.3',
    visionModel: process.env.BIGMODEL_VISION_MODEL || 'glm-4.6v',
    gitBashPath: process.env.CLAUDE_CODE_GIT_BASH_PATH, sessionDirectory, skills });
  if (runtime === 'minimax' || (runtime === 'auto' && !process.env.ANTHROPIC_API_KEY && process.env.MINIMAX_API_KEY)) return createClaudeAgentModel({ provider: 'minimax', apiKey: process.env.MINIMAX_API_KEY,
    baseUrl: (process.env.MINIMAX_API_URL || 'https://api.minimaxi.com/anthropic').replace(/\/+$/, ''),
    model: process.env.MINIMAX_MODEL || 'MiniMax-M2.7', gitBashPath: process.env.CLAUDE_CODE_GIT_BASH_PATH, sessionDirectory, skills });
  if (runtime === 'claude' || runtime === 'auto') {
    return createClaudeAgentModel({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.CLAUDE_AGENT_MODEL,
      gitBashPath: process.env.CLAUDE_CODE_GIT_BASH_PATH, sessionDirectory, skills });
  }
  const helper = args => requestMiniMax(args);
  helper.runtime = 'compatible-helper';
  helper.runTools = unsupportedPrimaryRuntime;
  return helper;
}

export function createCustomModel(settings, options = {}) {
  const normalized = normalizeCustomSettings(settings);
  const request = async function requestCustomModel({ system, messages, tools, maxTokens = 2400, signal }) {
    const timeout = AbortSignal.timeout(options.timeoutMs || DEFAULT_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    if (normalized.protocol === "anthropic") {
      return requestAnthropicCompatible({ settings: normalized, system, messages, tools, maxTokens, signal: requestSignal, options });
    }
    return requestOpenAiCompatible({ settings: normalized, system, messages, tools, maxTokens, signal: requestSignal, options });
  };
  request.runtime = 'compatible-helper';
  request.runTools = unsupportedPrimaryRuntime;
  return request;
}

async function unsupportedPrimaryRuntime() {
  throw publicModelError('兼容模型配置仅支持辅助生成；主职业 Agent 需要 Claude Agent SDK。请使用默认 SDK 模型配置。');
}

export function normalizeCustomSettings(settings) {
  const protocol = settings?.protocol === "openai" ? "openai" : "anthropic";
  const baseUrl = validatePublicHttpsBaseUrl(settings?.baseUrl);
  const model = String(settings?.model || "").trim();
  const apiKey = String(settings?.apiKey || "");
  if (!model) throw publicModelError("请填写模型名称。");
  if (!apiKey) throw publicModelError("请填写 API Key。");
  return { protocol, baseUrl, model, apiKey };
}

export async function requestAnthropicCompatible({ settings, system, messages, tools, maxTokens, signal, options = {} }) {
  const response = await postJson({
    url: resolveAnthropicMessagesUrl(settings.baseUrl),
    apiKey: settings.apiKey,
    headers: { "x-api-key": settings.apiKey, "anthropic-version": ANTHROPIC_VERSION },
    body: {
      model: settings.model,
      max_tokens: maxTokens,
      temperature: 0.3,
      system,
      messages: normalizeAnthropicMessages(messages),
      ...(tools?.length ? { tools } : {})
    },
    signal,
    options
  });
  if (!Array.isArray(response.content) || !response.content.length) throw publicModelError("自定义模型返回了空响应，请重试。");
  if (response.stop_reason === "max_tokens") throw publicModelError("模型输出达到长度上限，请缩小任务范围后重试。");
  return response;
}

export async function requestOpenAiCompatible({ settings, system, messages, tools, maxTokens, signal, options = {} }) {
  const response = await postJson({
    url: resolveOpenAiChatUrl(settings.baseUrl),
    apiKey: settings.apiKey,
    headers: { Authorization: `Bearer ${settings.apiKey}` },
    body: {
      model: settings.model,
      max_tokens: maxTokens,
      temperature: 0.3,
      messages: toOpenAiMessages({ system, messages }),
      ...(tools?.length ? { tools: toOpenAiTools(tools) } : {})
    },
    signal,
    options
  });
  const choice = Array.isArray(response.choices) ? response.choices[0] : null;
  const message = choice?.message;
  const content = [];
  const text = openAiContentToText(message?.content);
  if (text) content.push({ type: "text", text });
  for (const call of message?.tool_calls || []) {
    if (call?.type !== "function" || !call.function?.name) continue;
    content.push({ type: "tool_use", id: String(call.id || `tool_${content.length}`), name: call.function.name, input: parseToolArguments(call.function.arguments) });
  }
  if (!content.length) throw publicModelError("自定义模型返回了空响应，请重试。");
  if (choice?.finish_reason === "length") throw publicModelError("模型输出达到长度上限，请缩小任务范围后重试。");
  return { id: response.id, model: response.model || settings.model, role: "assistant", stop_reason: content.some(block => block.type === "tool_use") ? "tool_use" : "end_turn", content };
}

export function resolveAnthropicMessagesUrl(baseUrl) {
  const base = trimTrailingSlash(baseUrl);
  if (base.endsWith("/v1/messages")) return base;
  if (base.endsWith("/v1")) return `${base}/messages`;
  return `${base}/v1/messages`;
}

export function resolveOpenAiChatUrl(baseUrl) {
  const base = trimTrailingSlash(baseUrl);
  if (base.endsWith("/v1/chat/completions")) return base;
  if (base.endsWith("/v1")) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

export function validatePublicHttpsBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw publicModelError("请填写有效的 HTTPS API 地址。");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw publicModelError("API 地址必须是 HTTPS 公网地址。");
  }
  if (!parsed.hostname || isPrivateHostname(parsed.hostname)) {
    throw publicModelError("API 地址必须使用公网域名或公网 IP。");
  }
  parsed.pathname = trimTrailingSlash(parsed.pathname || "");
  parsed.search = "";
  return trimTrailingSlash(parsed.toString());
}

export function isPrivateAddress(address) {
  if (!address) return true;
  if (net.isIPv4(address)) {
    const parts = address.split(".").map(Number);
    return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) || parts[0] >= 224;
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    const mapped = parseIpv4MappedAddress(lower);
    if (mapped) return isPrivateAddress(mapped);
    const first = parseInt(lower.split(":").find(Boolean) || "0", 16);
    return lower === "::1" || lower === "::" || (first >= 0xfc00 && first <= 0xfdff) ||
      (first >= 0xfe80 && first <= 0xfebf) || (first >= 0xff00 && first <= 0xffff);
  }
  return true;
}

function normalizeAnthropicMessages(messages = []) {
  return messages.map((message) => {
    if (typeof message.content === "string") return { role: message.role, content: message.content };
    if (!Array.isArray(message.content)) return { role: message.role, content: "" };
    return { role: message.role, content: message.content.map(normalizeAnthropicBlock).filter(Boolean) };
  });
}

function toOpenAiMessages({ system, messages = [] }) {
  const converted = [];
  if (system) converted.push({ role: "system", content: String(system) });
  for (const message of messages) {
    if (typeof message.content === "string") {
      converted.push({ role: message.role, content: message.content });
      continue;
    }
    if (!Array.isArray(message.content)) continue;
    if (message.role === "assistant") {
      const text = message.content.filter(block => block?.type === "text").map(block => block.text || "").filter(Boolean).join("\n");
      const toolCalls = message.content.filter(block => block?.type === "tool_use").map(block => ({
        id: String(block.id || ""),
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input || {}) }
      })).filter(call => call.id && call.function.name);
      converted.push({ role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      continue;
    }
    const contentParts = [];
    for (const block of message.content) {
      if (block?.type === "tool_result") {
        converted.push({ role: "tool", tool_call_id: String(block.tool_use_id || ""), content: stringifyToolResult(block.content) });
      } else if (block?.type === "text" && block.text) {
        contentParts.push({ type: "text", text: String(block.text) });
      } else {
        const image = toOpenAiImagePart(block);
        if (image) contentParts.push(image);
      }
    }
    if (contentParts.length) converted.push({ role: "user", content: contentParts.some(part => part.type !== "text") ? contentParts : contentParts.map(part => part.text).join("\n") });
  }
  return converted;
}

function normalizeAnthropicBlock(block) {
  if (!block || typeof block !== "object") return null;
  if (["text", "thinking", "tool_use", "tool_result"].includes(block.type)) return block;
  if (block.type !== "image") return null;
  const source = normalizeImageSource(block.source);
  return source ? { type: "image", source } : null;
}

function normalizeImageSource(source) {
  if (!source || typeof source !== "object") return null;
  if (source.type !== "base64" || !source.media_type || !source.data) return null;
  return { type: "base64", media_type: String(source.media_type), data: String(source.data) };
}

function toOpenAiImagePart(block) {
  if (!block || typeof block !== "object") return null;
  if (block.type === "image_url" && block.image_url?.url) {
    return { type: "image_url", image_url: { url: String(block.image_url.url) } };
  }
  if (block.type === "input_image" && block.image_url) {
    return { type: "image_url", image_url: { url: String(block.image_url) } };
  }
  if (block.type !== "image") return null;
  const source = normalizeImageSource(block.source);
  return source ? { type: "image_url", image_url: { url: `data:${source.media_type};base64,${source.data}` } } : null;
}

function toOpenAiTools(tools = []) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description || "",
      parameters: tool.input_schema || { type: "object", properties: {} }
    }
  }));
}

async function postJson({ url, headers, body, signal, options }) {
  const target = new URL(url);
  const records = await resolvePublicRecords(target, options.lookup);
  const request = options.requestImpl || requestJsonWithHttps;
  const response = await request(target, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
    lookup: createPinnedLookup(target.hostname, records)
  });
  if (response.statusCode >= 300 && response.statusCode < 400) throw publicModelError("自定义模型地址返回了重定向，请填写最终 API 地址。");
  if (response.statusCode < 200 || response.statusCode >= 300) throw publicModelError(`自定义模型请求失败（HTTP ${response.statusCode}）。请检查模型配置、额度或稍后重试。`);
  try {
    return JSON.parse(response.body || "{}");
  } catch {
    throw publicModelError("自定义模型返回了不可解析的 JSON。");
  }
}

async function resolvePublicRecords(target, lookup = dns.promises.lookup) {
  if (target.protocol !== "https:" || isPrivateHostname(target.hostname)) throw publicModelError("API 地址必须使用公网 HTTPS。");
  const records = await lookup(target.hostname, { all: true, verbatim: true });
  const list = Array.isArray(records) ? records : [records];
  if (!list.length || list.some(record => isPrivateAddress(record.address))) {
    throw publicModelError("API 地址解析到了非公网地址。");
  }
  return list;
}

function createPinnedLookup(hostname, records) {
  const allowed = records.filter(record => !isPrivateAddress(record.address));
  return function pinnedLookup(host, options, callback) {
    try {
      if (host !== hostname) throw publicModelError("请求地址发生变化。");
      const family = options?.family;
      const matches = allowed.filter(item => !family || item.family === family);
      const selected = matches.length ? matches : allowed;
      if (!selected.length) throw publicModelError("API 地址解析到了非公网地址。");
      if (options?.all) {
        callback(null, selected.map(record => ({ address: record.address, family: record.family })));
        return;
      }
      callback(null, selected[0].address, selected[0].family);
    } catch (error) {
      callback(error);
    }
  };
}

function requestJsonWithHttps(target, options) {
  return new Promise((resolve, reject) => {
    const req = https.request(target, {
      method: options.method,
      headers: options.headers,
      lookup: options.lookup,
      signal: options.signal,
      timeout: DEFAULT_TIMEOUT_MS,
      rejectUnauthorized: options.rejectUnauthorized
    }, (res) => {
      let body = "";
      let bytes = 0;
      res.setEncoding("utf8");
      res.on("data", chunk => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_RESPONSE_BYTES) {
          req.destroy(publicModelError("自定义模型响应过大，请缩小输出后重试。"));
          return;
        }
        body += chunk;
      });
      res.on("end", () => resolve({ statusCode: res.statusCode || 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.write(options.body);
    req.end();
  }).catch((error) => {
    if (error.name === "AbortError") throw error;
    if (error.publicModelError) throw error;
    throw publicModelError("自定义模型请求失败。请检查模型配置或稍后重试。");
  });
}

function stringifyToolResult(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(block => block?.text || block?.content || JSON.stringify(block)).join("\n");
  if (content === undefined || content === null) return "";
  return JSON.stringify(content);
}

function openAiContentToText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map(part => typeof part === "string" ? part : part?.text || "").join("\n").trim();
}

function parseToolArguments(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function isPrivateHostname(hostname) {
  const host = hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || Boolean(net.isIP(host) && isPrivateAddress(host));
}

function parseIpv4MappedAddress(address) {
  const dotted = address.match(/(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];
  const groups = address.split(":").filter(Boolean);
  const ffffIndex = groups.findIndex(group => group.padStart(4, "0") === "ffff");
  if (ffffIndex === -1 || groups.length < ffffIndex + 3) return null;
  const high = parseInt(groups.at(-2), 16);
  const low = parseInt(groups.at(-1), 16);
  if (!Number.isFinite(high) || !Number.isFinite(low) || high < 0 || high > 0xffff || low < 0 || low > 0xffff) return null;
  return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function publicModelError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.publicModelError = true;
  return error;
}

export const __testing = {
  toOpenAiMessages,
  toOpenAiTools,
  createPinnedLookup,
  requestJsonWithHttps,
  publicModelError
};
