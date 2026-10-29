import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_URL = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_QUESTIONS = 16;
const QUESTION_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const QUESTION_TYPES = new Set(["choice", "score", "noul"]);

const serverDir = path.dirname(fileURLToPath(import.meta.url));

export class JevClientError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = "JevClientError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function createJevClient({
  apiKey,
  fetchImpl = globalThis.fetch,
  credentialLoader = loadJevApiKey,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== "function") throw new JevClientError("invalid_config", "A fetch implementation is required.");

  return {
    async decide({ state, questions, signal } = {}) {
      const deadline = createRequestSignal(signal, timeoutMs);
      try {
        throwIfAborted(deadline.signal);
        const prepared = buildRequest({ state, questions });
        const key = apiKey || await loadKey(credentialLoader, { signal: deadline.signal });
        return await callWithSingleRetry({ fetchImpl, apiKey: key, prepared, signal: deadline.signal });
      } finally { deadline.dispose(); }
    }
  };
}

export async function loadJevApiKey({ env = process.env, pythonRunner = runCredentialHelper, signal } = {}) {
  const envKey = String(env.TYPESAFE_API_KEY || "").trim();
  if (envKey) return envKey;
  if (process.platform !== "win32" && pythonRunner === runCredentialHelper) {
    throw new JevClientError("missing_api_key", "Set TYPESAFE_API_KEY or save a TypeSafe API key in Windows Credential Manager.");
  }
  let result;
  try {
    result = await withAbort(Promise.resolve().then(() => pythonRunner({ signal })), signal);
  } catch (error) {
    if (error instanceof JevClientError) throw error;
    throw new JevClientError("credential_error", "Could not read the JEV key from Windows Credential Manager.");
  }
  const key = String(result?.stdout || "").trim();
  if (!key) throw new JevClientError("missing_api_key", "Set TYPESAFE_API_KEY or save a TypeSafe API key in Windows Credential Manager.");
  return key;
}

export default loadJevApiKey;

function buildRequest({ state, questions }) {
  if (!isPlainObject(state)) throw new JevClientError("invalid_input", "JEV state must be an object.");
  if (!isPlainObject(questions) || !Object.keys(questions).length) throw new JevClientError("invalid_input", "JEV questions must be a non-empty object.");
  const entries = Object.entries(questions);
  if (entries.length > MAX_QUESTIONS) throw new JevClientError("invalid_input", `JEV supports at most ${MAX_QUESTIONS} questions per request.`);

  const normalizedQuestions = {};
  for (const [id, question] of entries) {
    if (!QUESTION_ID.test(id)) throw new JevClientError("invalid_input", `JEV question id ${id} is not allowed.`);
    normalizedQuestions[id] = normalizeQuestion(id, question);
  }
  const request = { model: MODEL, state, questions: normalizedQuestions };
  const bytes = Buffer.byteLength(JSON.stringify(request), "utf8");
  if (bytes > MAX_REQUEST_BYTES) throw new JevClientError("invalid_input", "JEV request is too large.");
  return request;
}

function normalizeQuestion(id, question) {
  if (!isPlainObject(question)) throw new JevClientError("invalid_input", `JEV question ${id} must be an object.`);
  const type = question.type;
  if (!QUESTION_TYPES.has(type)) throw new JevClientError("invalid_input", `JEV question ${id} has an unsupported type.`);
  const instructions = boundedString(question.instructions, `JEV question ${id}.instructions`, { min: 1, max: 2000 });
  if (type === "choice") {
    const criteria = normalizeChoiceCriteria(id, question.criteria);
    return { type, instructions, criteria };
  }
  if (type === "score") {
    const criteria = normalizeScoreCriteria(id, question.criteria);
    return { type, instructions, criteria };
  }
  const criteria = normalizeNoulCriteria(id, question.criteria);
  return criteria ? { type, instructions, criteria } : { type, instructions };
}

function normalizeChoiceCriteria(id, criteria) {
  if (!isPlainObject(criteria)) throw new JevClientError("invalid_input", `JEV question ${id}.criteria must be an object.`);
  const entries = Object.entries(criteria);
  if (entries.length < 2 || entries.length > 255) throw new JevClientError("invalid_input", `JEV choice question ${id} must have 2 to 255 criteria.`);
  const normalized = {};
  for (const [key, value] of entries) {
    if (!key || key.length > 255) throw new JevClientError("invalid_input", `JEV choice question ${id} has an invalid criterion key.`);
    normalized[key] = boundedString(value, `JEV choice question ${id}.criteria.${key}`, { min: 1, max: 1000 });
  }
  return normalized;
}

function normalizeScoreCriteria(id, criteria) {
  if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 10) {
    throw new JevClientError("invalid_input", `JEV score question ${id} must have 2 to 10 ordered criteria.`);
  }
  return criteria.map((value, index) => boundedString(value, `JEV score question ${id}.criteria.${index}`, { min: 1, max: 1000 }));
}

function normalizeNoulCriteria(id, criteria) {
  if (criteria === undefined) return null;
  if (!isPlainObject(criteria) || !Object.hasOwn(criteria, "true") || !Object.hasOwn(criteria, "false")) {
    throw new JevClientError("invalid_input", `JEV noul question ${id}.criteria must describe true and false.`);
  }
  return {
    true: boundedString(criteria.true, `JEV noul question ${id}.criteria.true`, { min: 1, max: 1000 }),
    false: boundedString(criteria.false, `JEV noul question ${id}.criteria.false`, { min: 1, max: 1000 })
  };
}

async function callWithSingleRetry(args) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await callJev(args);
    } catch (error) {
      lastError = normalizeError(error);
      if (!lastError.retryable || attempt === 1) throw lastError;
    }
  }
  throw lastError;
}

async function callJev({ fetchImpl, apiKey, prepared, signal }) {
  throwIfAborted(signal);
  let response;
  try {
    response = await withAbort(fetchImpl(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(prepared),
      redirect: "error",
      signal
    }), signal);
  } catch (error) {
    if (signal?.aborted) throwSignalError(signal);
    throw new JevClientError("connection_error", "Could not connect to the TypeSafe API.", { retryable: true });
  }
  if (!response?.ok) {
    response?.body?.cancel().catch(() => {});
    const status = Number(response?.status || 0);
    if (status === 401 || status === 403) throw new JevClientError("authentication_failed", "TypeSafe authentication failed.");
    if (status >= 300 && status < 400) throw new JevClientError("redirect_error", "TypeSafe API returned a redirect.");
    throw new JevClientError("http_error", `TypeSafe API returned HTTP ${status || "unknown"}.`, { retryable: status === 429 || status >= 500 });
  }
  return validateResponse(await readJsonResponse(response, signal), prepared.questions);
}

async function readJsonResponse(response, signal) {
  const text = response.body
    ? await readStreamBody(response.body, signal)
    : await readTextBody(response, signal);
  if (Buffer.byteLength(text || "", "utf8") > MAX_RESPONSE_BYTES) throw new JevClientError("invalid_response", "JEV response is too large.");
  try {
    return JSON.parse(text || "{}");
  } catch (error) {
    throw new JevClientError("invalid_response", "JEV returned invalid JSON.");
  }
}

async function readStreamBody(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      throwIfAborted(signal);
      const { value, done } = await withAbort(reader.read(), signal);
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        reader.cancel().catch(() => {});
        throw new JevClientError("invalid_response", "JEV response is too large.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    reader.cancel().catch(() => {});
    if (error instanceof JevClientError) throw error;
    if (signal?.aborted) throwSignalError(signal);
    throw new JevClientError("invalid_response", "JEV response stream could not be read.");
  } finally {
    reader.releaseLock();
  }
}

async function readTextBody(response, signal) {
  const text = await withAbort(response.text(), signal);
  if (Buffer.byteLength(text || "", "utf8") > MAX_RESPONSE_BYTES) throw new JevClientError("invalid_response", "JEV response is too large.");
  return text;
}

function validateResponse(result, questions) {
  if (!isPlainObject(result)) throw new JevClientError("invalid_response", "JEV response must be an object.");
  if (!nonEmptyString(result.model)) throw new JevClientError("invalid_response", "JEV response is missing model.");
  if (!isPlainObject(result.answers)) throw new JevClientError("invalid_response", "JEV response is missing answers.");

  const expected = Object.keys(questions).sort();
  const actual = Object.keys(result.answers).sort();
  const missing = expected.filter((id) => !actual.includes(id));
  const extra = actual.filter((id) => !expected.includes(id));
  if (missing.length) throw new JevClientError("invalid_response", `JEV response is missing answer(s): ${missing.join(", ")}.`);
  if (extra.length) throw new JevClientError("invalid_response", `JEV response included unrequested answer(s): ${extra.join(", ")}.`);

  const usage = validateUsage(result.usage);
  const answers = {};
  for (const id of expected) answers[id] = validateAnswer(id, questions[id], result.answers[id]);
  return { model: result.model, answers, usage };
}

function validateUsage(usage) {
  if (!isPlainObject(usage)) throw new JevClientError("invalid_response", "JEV response is missing usage.");
  const normalized = {};
  for (const field of ["input_tokens", "output_tokens"]) {
    const value = usage[field];
    if (!Number.isInteger(value) || value < 0) throw new JevClientError("invalid_response", `JEV usage.${field} must be a non-negative integer.`);
    normalized[field] = value;
  }
  return normalized;
}

function validateAnswer(id, question, answer) {
  if (!isPlainObject(answer)) throw new JevClientError("invalid_response", `JEV answer ${id} must be an object.`);
  if (answer.type !== question.type) throw new JevClientError("invalid_response", `JEV answer ${id}.type does not match the question.`);
  if (question.type === "choice") return validateChoiceAnswer(id, question, answer);
  if (question.type === "score") return validateScoreAnswer(id, question, answer);
  return validateNoulAnswer(id, answer);
}

function validateChoiceAnswer(id, question, answer) {
  assertAnswerKeys(id, answer, ["type", "choice", "probabilities", "confidence"]);
  if (!nonEmptyString(answer.choice)) throw new JevClientError("invalid_response", `JEV choice answer ${id}.choice must be a string.`);
  validateProbability(answer.confidence, `JEV choice answer ${id}.confidence`, { optional: true });
  const probabilities = validateProbabilities(answer.probabilities, `JEV choice answer ${id}.probabilities`);
  const expected = Object.keys(question.criteria).sort();
  const actual = Object.keys(probabilities).sort();
  if (expected.join("\u0000") !== actual.join("\u0000")) throw new JevClientError("invalid_response", `JEV choice answer ${id}.probabilities must match the requested criteria.`);
  const max = Math.max(...Object.values(probabilities));
  if (probabilities[answer.choice] !== max) throw new JevClientError("invalid_response", `JEV choice answer ${id}.choice must be the highest probability option.`);
  return copyKnown(answer, ["type", "choice", "probabilities", "confidence"]);
}

function validateScoreAnswer(id, question, answer) {
  assertAnswerKeys(id, answer, ["type", "score", "legend", "probabilities", "confidence"]);
  if (!isNumber(answer.score)) throw new JevClientError("invalid_response", `JEV score answer ${id}.score must be numeric.`);
  validateProbability(answer.confidence, `JEV score answer ${id}.confidence`, { optional: true });
  const legend = answer.legend;
  if (!isPlainObject(legend)) throw new JevClientError("invalid_response", `JEV score answer ${id}.legend must be an object.`);
  const expectedLegend = Object.fromEntries(question.criteria.map((value, index) => [String(index), value]));
  if (JSON.stringify(legend) !== JSON.stringify(expectedLegend)) throw new JevClientError("invalid_response", `JEV score answer ${id}.legend must match the requested criteria.`);
  const probabilities = validateProbabilities(answer.probabilities, `JEV score answer ${id}.probabilities`);
  if (Object.keys(probabilities).sort().join("\u0000") !== Object.keys(expectedLegend).sort().join("\u0000")) {
    throw new JevClientError("invalid_response", `JEV score answer ${id}.probabilities must match the legend.`);
  }
  const weighted = Object.entries(probabilities).reduce((sum, [level, probability]) => sum + Number(level) * probability, 0);
  if (Math.abs(answer.score - weighted) > 1e-9) throw new JevClientError("invalid_response", `JEV score answer ${id}.score must equal the probability weighted mean.`);
  return copyKnown(answer, ["type", "score", "legend", "probabilities", "confidence"]);
}

function validateNoulAnswer(id, answer) {
  assertAnswerKeys(id, answer, ["type", "noul", "confidence"]);
  validateProbability(answer.noul, `JEV noul answer ${id}.noul`);
  validateProbability(answer.confidence, `JEV noul answer ${id}.confidence`, { optional: true });
  return copyKnown(answer, ["type", "noul", "confidence"]);
}

function validateProbabilities(value, field) {
  if (!isPlainObject(value) || !Object.keys(value).length) throw new JevClientError("invalid_response", `${field} must be a non-empty object.`);
  const copy = {};
  let sum = 0;
  for (const [key, probability] of Object.entries(value)) {
    validateProbability(probability, `${field}.${key}`);
    copy[key] = probability;
    sum += probability;
  }
  if (Math.abs(sum - 1) > 0.001) throw new JevClientError("invalid_response", `${field} probabilities must sum to 1.`);
  return copy;
}

function assertAnswerKeys(id, answer, allowed) {
  const extras = Object.keys(answer).filter((key) => !allowed.includes(key));
  if (extras.length) throw new JevClientError("invalid_response", `JEV answer ${id} contains unsupported field(s): ${extras.join(", ")}.`);
}

function validateProbability(value, field, { optional = false } = {}) {
  if (value === undefined && optional) return;
  if (!isNumber(value) || value < 0 || value > 1) throw new JevClientError("invalid_response", `${field} must be a probability from 0 to 1.`);
}

function copyKnown(source, keys) {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

function boundedString(value, field, { min, max }) {
  if (typeof value !== "string") throw new JevClientError("invalid_input", `${field} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new JevClientError("invalid_input", `${field} has an invalid length.`);
  return trimmed;
}

function loadKey(loader, { signal } = {}) {
  throwIfAborted(signal);
  return Promise.resolve()
    .then(() => withAbort(Promise.resolve().then(() => loader({ signal })), signal))
    .then((key) => {
      const text = String(key || "").trim();
      if (!text) throw new JevClientError("missing_api_key", "Set TYPESAFE_API_KEY or save a TypeSafe API key in Windows Credential Manager.");
      return text;
    })
    .catch((error) => {
      if (error instanceof JevClientError) throw error;
      throw new JevClientError("credential_error", "Could not read the JEV key from Windows Credential Manager.");
    });
}

function runCredentialHelper({ signal } = {}) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const child = spawn(process.env.PYTHON || "python", [path.join(serverDir, "jevCredential.py")], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      env: createCredentialHelperEnv()
    });
    let stdout = "";
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      fn(value);
    };
    const onAbort = () => {
      child.kill();
      finish(reject, signalError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 4096) {
        child.kill();
        finish(reject, new JevClientError("credential_error", "Could not read the JEV key from Windows Credential Manager."));
      }
    });
    child.on("error", () => finish(reject, new JevClientError("credential_error", "Could not read the JEV key from Windows Credential Manager.")));
    child.on("close", (code) => {
      if (code === 0) finish(resolve, { stdout });
      else finish(reject, new JevClientError("credential_error", "Could not read the JEV key from Windows Credential Manager."));
    });
  });
}

function createCredentialHelperEnv({ env = process.env } = {}) {
  const allowed = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "COMSPEC"]) {
    if (env[key]) allowed[key] = env[key];
  }
  return {
    ...allowed,
    PYTHONIOENCODING: "utf-8",
    PYTHONDONTWRITEBYTECODE: "1",
    RESUME_PROTOCOL_JEV_CREDENTIAL_HELPER: "1"
  };
}

function normalizeError(error) {
  if (error instanceof JevClientError) return error;
  return new JevClientError("connection_error", "Could not connect to the TypeSafe API.", { retryable: true });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && !Number.isNaN(value);
}

function createRequestSignal(signal, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new JevClientError('invalid_config', 'JEV timeout must be between 1 and 120000 milliseconds.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timed out', 'TimeoutError')), timeoutMs);
  return { signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, dispose: () => clearTimeout(timer) };
}

function signalError(signal) {
  const timedOut = signal?.reason?.name === 'TimeoutError';
  return new JevClientError(timedOut ? 'timeout' : 'aborted', timedOut ? 'JEV request timed out.' : 'JEV request aborted.');
}

function throwSignalError(signal) { throw signalError(signal); }
function throwIfAborted(signal) { if (signal?.aborted) throwSignalError(signal); }

function withAbort(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signalError(signal));
    if (signal.aborted) { promise.catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export const __testing = { createCredentialHelperEnv };
