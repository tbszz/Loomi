import crypto from "node:crypto";
import express from "express";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createCustomModel, createDefaultModel, validatePublicHttpsBaseUrl } from "./modelClient.js";

const SETTINGS_KEY = "modelSettings";
const KEY_FILE = "model-settings.key";
const ALGORITHMS = { key: "aes-256-gcm", ivBytes: 12 };

export function createModelSettingsRouter(database, { dataDir } = {}) {
  const router = express.Router();

  router.get("/", (req, res, next) => {
    try {
      res.json({ settings: toPublicSettings(readStoredSettings(database, req.user.id)) });
    } catch (error) {
      next(error);
    }
  });

  router.put("/", (req, res, next) => {
    try {
      const stored = saveSettings(database, req.user.id, req.body, { dataDir });
      res.json({ settings: toPublicSettings(stored) });
    } catch (error) {
      next(error);
    }
  });

  router.use((error, _req, res, _next) => {
    const status = error.statusCode || 400;
    res.status(status).json({ ok: false, error: error.message || "模型配置无效。" });
  });

  return router;
}

export function createUserModel(database, userId, { dataDir, ...clientOptions } = {}) {
  const stored = readStoredSettings(database, userId);
  if (stored.mode !== "custom") return createDefaultModel({ dataDir, skills: clientOptions.skills });
  const apiKey = decryptApiKey(stored.encryptedApiKey, { dataDir });
  return createCustomModel({ ...stored, apiKey }, clientOptions);
}

export function readStoredSettings(database, userId) {
  const state = database.getUserState(userId);
  const stored = state?.[SETTINGS_KEY];
  if (!stored || stored.mode !== "custom") return defaultStoredSettings();
  return {
    mode: "custom",
    protocol: stored.protocol === "openai" ? "openai" : "anthropic",
    baseUrl: validatePublicHttpsBaseUrl(stored.baseUrl),
    model: String(stored.model || "").trim(),
    encryptedApiKey: stored.encryptedApiKey || null,
    apiKeyHost: typeof stored.apiKeyHost === "string" ? stored.apiKeyHost : ""
  };
}

export function saveSettings(database, userId, input, { dataDir } = {}) {
  const currentState = database.getUserState(userId);
  const current = readStoredSettings(database, userId);
  const next = buildStoredSettings(input, current, { dataDir });
  database.saveUserState(userId, { ...currentState, [SETTINGS_KEY]: next });
  return next;
}

export function toPublicSettings(stored) {
  return {
    mode: stored?.mode === "custom" ? "custom" : "default",
    protocol: stored?.protocol === "openai" ? "openai" : "anthropic",
    baseUrl: stored?.mode === "custom" ? stored.baseUrl : "",
    model: stored?.mode === "custom" ? stored.model : "",
    hasApiKey: Boolean(stored?.mode === "custom" && stored.encryptedApiKey)
  };
}

function buildStoredSettings(input, current, { dataDir }) {
  const mode = input?.mode === "custom" ? "custom" : "default";
  if (mode === "default") return defaultStoredSettings();
  const protocol = input?.protocol === "openai" ? "openai" : "anthropic";
  const baseUrl = validatePublicHttpsBaseUrl(input?.baseUrl);
  const model = String(input?.model || "").trim();
  if (!model) throw publicSettingsError("请填写模型名称。");
  const host = new URL(baseUrl).host;
  const apiKeyInput = typeof input?.apiKey === "string" ? input.apiKey.trim() : "";
  const canReuseKey = current.mode === "custom" && current.encryptedApiKey && current.apiKeyHost === host && current.protocol === protocol;
  const encryptedApiKey = apiKeyInput ? encryptApiKey(apiKeyInput, { dataDir }) : (canReuseKey ? current.encryptedApiKey : null);
  if (!encryptedApiKey) throw publicSettingsError("请填写 API Key。");
  return { mode, protocol, baseUrl, model, encryptedApiKey, apiKeyHost: host };
}

function defaultStoredSettings() {
  return { mode: "default", protocol: "anthropic", baseUrl: "", model: "", encryptedApiKey: null, apiKeyHost: "" };
}

function encryptApiKey(apiKey, { dataDir } = {}) {
  const key = readOrCreateEncryptionKey(dataDir);
  const iv = crypto.randomBytes(ALGORITHMS.ivBytes);
  const cipher = crypto.createCipheriv(ALGORITHMS.key, key, iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    ciphertext: ciphertext.toString("base64url")
  };
}

function decryptApiKey(payload, { dataDir } = {}) {
  if (!payload?.iv || !payload?.tag || !payload?.ciphertext) throw publicSettingsError("自定义模型缺少 API Key，请重新保存配置。");
  try {
    const key = readOrCreateEncryptionKey(dataDir);
    const decipher = crypto.createDecipheriv(ALGORITHMS.key, key, Buffer.from(payload.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw publicSettingsError("自定义模型密钥无法读取，请重新保存配置。");
  }
}

function readOrCreateEncryptionKey(dataDir) {
  const directory = dataDir || path.join(process.cwd(), "data");
  mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, KEY_FILE);
  if (!existsSync(filename)) {
    writeFileSync(filename, crypto.randomBytes(32).toString("base64url"), { mode: 0o600 });
  }
  const key = Buffer.from(readFileSync(filename, "utf8").trim(), "base64url");
  if (key.length !== 32) throw publicSettingsError("模型配置加密密钥无效。");
  return key;
}

function publicSettingsError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

export const __testing = {
  encryptApiKey,
  decryptApiKey,
  buildStoredSettings,
  defaultStoredSettings
};
