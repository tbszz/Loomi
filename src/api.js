import { createTranslator } from './i18n.js';
export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const LEGACY_CHAT_STORAGE_KEY = "resume-protocol.chat.v1";
const RESUME_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".json"];
const MAX_RESUME_BYTES = 8 * 1024 * 1024;

export async function requestJson(path, options = {}, t = createTranslator()) {
  const { timeoutMs = 60_000, signal, baseUrl = "", ...requestOptions } = options;
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(signal.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(baseUrl + path, {
      credentials: "include",
      ...requestOptions,
      signal: controller.signal
    });
    let data;
    try {
      data = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new ApiError(response.ok ? t("api.theServerReturnedInvalidDataTryAgain") : "HTTP " + response.status, response.status);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new ApiError(t("api.theServerReturnedInvalidDataTryAgain"), response.status);
    }
    if (!response.ok || data.ok === false) {
      throw new ApiError(data.error || "HTTP " + response.status, response.status);
    }
    return data;
  } catch (error) {
    if (timedOut) throw new ApiError(t("api.requestTimedOutTryAgainLater"));
    if (controller.signal.aborted) throw error;
    if (error instanceof TypeError) throw new ApiError(t("api.cannotConnectToTheServiceCheckThat"));
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

export async function streamConversationMessage(conversationId, content, options = {}, t = createTranslator()) {
  const { timeoutMs = 310_000, signal, baseUrl = "", onEvent = () => {} } = options;
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(signal.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  // This protects a silent/disconnected transport, not total task duration.
  // Server heartbeats keep the connection alive; the server separately checks
  // actual model/tool progress so a heartbeat cannot hide a stalled Agent.
  let timer;
  const received = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  };
  received();

  try {
    const response = await fetch(baseUrl + `/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content }),
      signal: controller.signal
    });
    if (!response.ok) {
      const error = await readJsonError(response);
      throw new ApiError(error || "HTTP " + response.status, response.status);
    }
    if (!response.body) throw new ApiError(t("api.yourBrowserDoesNotSupportStreamingUpdate"));

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let doneConversation = null;
    let sawTerminalEvent = false;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value?.byteLength) received();
      buffer += decoder.decode(chunk.value, { stream: true });
      const frames = buffer.split(/\n\n/);
      buffer = frames.pop() || "";
      for (const frame of frames) {
        const event = parseSseFrame(frame, t);
        if (!event) continue;
        onEvent(event);
        if (event.type === "error") {
          sawTerminalEvent = true;
          throw new ApiError(event.error || t("api.thisStepDidNotComplete"));
        }
        if (event.type === "done") {
          sawTerminalEvent = true;
          doneConversation = event.conversation;
        }
      }
    }
    if (buffer.trim()) {
      const event = parseSseFrame(buffer, t);
      if (event) {
        onEvent(event);
        if (event.type === "error") {
          sawTerminalEvent = true;
          throw new ApiError(event.error || t("api.thisStepDidNotComplete"));
        }
        if (event.type === "done") {
          sawTerminalEvent = true;
          doneConversation = event.conversation;
        }
      }
    }
    if (!sawTerminalEvent) throw new ApiError(t("api.connectionInterruptedTryAgain"));
    return doneConversation;
  } catch (error) {
    if (timedOut) throw new ApiError(t("api.requestTimedOutTryAgainLater"));
    if (controller.signal.aborted) throw error;
    if (error instanceof TypeError) throw new ApiError(t("api.cannotConnectToTheServiceCheckThat"));
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

export function validateResumeFile(file, t = createTranslator()) {
  if (!file) return { ok: false, error: t("api.selectAResumeFile") };
  const name = String(file.name || "").toLowerCase();
  const matchesType = RESUME_EXTENSIONS.some((extension) => name.endsWith(extension));
  if (!matchesType) return { ok: false, error: t("api.uploadAPdfDocxTxtMarkdownOr") };
  if (Number(file.size || 0) > MAX_RESUME_BYTES) return { ok: false, error: t("api.fileMustBe8mbOrSmaller") };
  return { ok: true };
}

export async function importLocalConversations(storage, requester = requestJson, t = createTranslator()) {
  const value = storage?.getItem?.(LEGACY_CHAT_STORAGE_KEY);
  if (!value) return { imported: 0 };
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ApiError(t("api.previousLocalRecordsAreCorruptedAndCannot"));
  }
  const conversations = Array.isArray(parsed.conversations) ? parsed.conversations : [];
  if (!conversations.length) return { imported: 0 };
  const result = await requester("/api/conversations/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversations })
  }, t);
  return { ...result, imported: result.imported ?? result.count ?? 0 };
}

async function readJsonError(response) {
  try {
    const data = await response.json();
    return data?.error;
  } catch {
    return "";
  }
}

function parseSseFrame(frame, t = createTranslator()) {
  let type = "message";
  const data = frame
    .split(/\r?\n/)
    .map((line) => {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      return line;
    })
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return null;
  try {
    const payload = JSON.parse(data);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("invalid payload");
    }
    if (type === "message") return { type: "message", message: payload };
    return { type, ...payload };
  } catch {
    throw new ApiError(t("api.theServerReturnedInvalidStreamData"));
  }
}

