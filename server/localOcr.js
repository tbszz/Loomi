import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./ocr-image.ps1", import.meta.url));
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 512 * 1024;

export async function recognizeImage(buffer, options = {}) {
  const platform = options.platform || process.platform;
  if (!["win32", "linux"].includes(platform)) {
    throw new Error("本机OCR仅支持 Windows 或 Linux。");
  }
  throwIfAborted(options.signal);
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    throw new Error("OCR图片内容格式无效。");
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), "resume-ocr-"));
  const filename = path.join(directory, "page.png");
  try {
    throwIfAborted(options.signal);
    await writeFile(filename, Buffer.from(buffer));
    throwIfAborted(options.signal);
    const runner = options.runScript || (platform === "linux" ? runTesseractOcr : runPowerShellOcr);
    const result = await runner({ path: filename, signal: options.signal, timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS });
    if (result.code !== 0) throw new Error("本机OCR识别失败。");
    return cleanOcrText(result.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

function runTesseractOcr({ path: imagePath, signal, timeoutMs }) {
  return runOcrProcess({
    command: process.env.RESUME_PROTOCOL_TESSERACT || "tesseract",
    args: [imagePath, "stdout", "-l", "chi_sim+eng", "--psm", "3"],
    signal,
    timeoutMs,
    unavailableMessage: "本机OCR运行环境不可用。"
  });
}

function runPowerShellOcr({ path: imagePath, signal, timeoutMs }) {
  return runOcrProcess({
    command: process.env.RESUME_PROTOCOL_POWERSHELL || "powershell.exe",
    args: [
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      SCRIPT,
      "-Path",
      imagePath
    ],
    signal,
    timeoutMs,
    windowsHide: true,
    unavailableMessage: "本机OCR运行环境不可用。"
  });
}

function runOcrProcess({ command, args, signal, timeoutMs, windowsHide = false, unavailableMessage }) {
  return new Promise((resolve, reject) => {
    try {
      throwIfAborted(signal);
    } catch (error) {
      reject(error);
      return;
    }
    const child = spawn(command, args, { windowsHide, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", abort);
      fn(value);
    };
    const abort = () => {
      child.kill();
      finish(reject, signal?.reason instanceof Error ? signal.reason : new Error("本机OCR识别已取消。"));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error("本机OCR识别超时。"));
    }, timeoutMs);

    signal?.addEventListener?.("abort", abort, { once: true });
    try {
      throwIfAborted(signal);
    } catch (error) {
      abort();
      return;
    }
    child.stdout.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        child.kill();
        finish(reject, new Error("本机OCR输出过大。"));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.resume();
    child.on("error", () => finish(reject, new Error(unavailableMessage)));
    child.on("close", code => finish(resolve, { code, stdout: Buffer.concat(chunks).toString("utf8") }));
  }).catch(error => {
    if (/取消|超时|输出过大|不可用/.test(error.message)) throw error;
    throw new Error("本机OCR识别失败。");
  });
}

function cleanOcrText(text) {
  return String(text || "")
    .replace(/\u0000/g, "")
    .split(/\r?\n/)
    .map(line => line
      .replace(/(?<=\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu, "")
      .replace(/[ \t]+/g, " ")
      .trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("本机OCR识别已取消。");
}
