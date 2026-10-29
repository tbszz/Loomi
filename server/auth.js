import crypto from "node:crypto";
import { promisify } from "node:util";
import express from "express";
import { createMailer, passwordResetEmail } from "./mailer.js";

const scrypt = promisify(crypto.scrypt);
const COOKIE_NAME = "resume_protocol_session";
const SESSION_DAYS = 30;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_MAX_ENTRIES = 1000;
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 128;
const EMAIL_MAX = 254;
const NAME_MAX = 120;
const RESET_CODE_MINUTES = 10;
const RESET_RESEND_MS = 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;
const RESET_SENT = `如果这个邮箱已注册，验证码已发送，${RESET_CODE_MINUTES} 分钟内有效。`;
const RESET_INVALID = "验证码无效或已过期，请重新获取。";

const rateLimits = new Map();

export function createAuthRouter(database, { mailer = createMailer() } = {}) {
  const router = express.Router();

  // The reply never says whether the email is registered; only a real send
  // failure surfaces, so a missing code is never reported as sent.
  router.post("/password-reset/request", rateLimit("password-reset"), async (req, res, next) => {
    try {
      const email = validateEmail(req.body?.email);
      if (!mailer.configured) {
        res.status(503).json({ ok: false, error: "邮件服务未配置，暂时无法发送验证码。" });
        return;
      }
      const user = database.getUserByEmail(email);
      const previous = user && database.getPasswordReset(user.id);
      if (user && !(previous && Date.now() - previous.createdAt < RESET_RESEND_MS)) {
        const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
        const reset = database.createPasswordReset(user.id, hashResetCode(user.id, code), Date.now() + RESET_CODE_MINUTES * 60 * 1000);
        try {
          await mailer.send({ to: user.email, ...passwordResetEmail(code, RESET_CODE_MINUTES) });
        } catch (error) {
          database.deletePasswordReset(reset.id);
          throw error;
        }
      }
      res.json({ ok: true, message: RESET_SENT });
    } catch (error) {
      next(error);
    }
  });

  router.post("/password-reset/confirm", rateLimit("password-reset-confirm"), async (req, res, next) => {
    try {
      const email = validateEmail(req.body?.email);
      const code = String(req.body?.code || "").trim();
      const password = validatePassword(req.body?.password);
      const user = database.getUserByEmail(email);
      const reset = user && database.getPasswordReset(user.id);
      if (!reset || reset.expiresAt <= Date.now() || reset.attempts >= RESET_MAX_ATTEMPTS || !/^\d{6}$/.test(code)) {
        res.status(400).json({ ok: false, error: RESET_INVALID });
        return;
      }
      const expected = Buffer.from(reset.codeHash, "hex");
      const actual = Buffer.from(hashResetCode(user.id, code), "hex");
      if (!crypto.timingSafeEqual(expected, actual)) {
        database.recordPasswordResetAttempt(reset.id);
        res.status(400).json({ ok: false, error: RESET_INVALID });
        return;
      }
      database.resetUserPassword(user.id, await hashPassword(password));
      const token = createSession(database, user.id);
      setSessionCookie(res, req, token);
      res.json({ user: toPublicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/register", rateLimit("register"), async (req, res, next) => {
    try {
      const input = validateRegister(req.body);
      const passwordHash = await hashPassword(input.password);
      const user = database.createUser({ email: input.email, name: input.name, passwordHash });
      const token = createSession(database, user.id);
      setSessionCookie(res, req, token);
      res.json({ user });
    } catch (error) {
      if (isUniqueEmailError(error)) {
        res.status(409).json({ ok: false, error: "这个邮箱已经注册。" });
        return;
      }
      next(error);
    }
  });

  router.post("/login", rateLimit("login"), async (req, res, next) => {
    try {
      const input = validateLogin(req.body);
      const stored = database.getUserByEmail(input.email);
      if (!stored || !(await verifyPassword(input.password, stored.passwordHash))) {
        res.status(401).json({ ok: false, error: "邮箱或密码错误。" });
        return;
      }
      const token = createSession(database, stored.id);
      setSessionCookie(res, req, token);
      res.json({ user: toPublicUser(stored) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", (req, res) => {
    const token = getSessionToken(req);
    if (token) database.deleteSession(hashToken(token));
    clearSessionCookie(res, req);
    res.json({ user: null });
  });

  router.get("/me", (req, res) => {
    const session = readSession(database, req);
    res.json({ user: session?.user || null });
  });

  router.use((error, _req, res, _next) => {
    const status = error.statusCode || 400;
    res.status(status).json({ ok: false, error: error.message || "请求无效。" });
  });

  return router;
}

export function requireUser(database) {
  return (req, res, next) => {
    const session = readSession(database, req);
    if (!session) {
      res.status(401).json({ ok: false, error: "请先登录。" });
      return;
    }
    req.user = session.user;
    req.session = {
      id: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt
    };
    next();
  };
}

export async function hashPassword(password) {
  const input = validatePassword(password);
  const salt = crypto.randomBytes(16).toString("base64url");
  const key = await scrypt(input, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt}$${key.toString("base64url")}`;
}

export async function verifyPassword(password, storedHash) {
  const input = validatePassword(password);
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nRaw, rRaw, pRaw, salt, expectedRaw] = parts;
  const params = { N: Number(nRaw), r: Number(rRaw), p: Number(pRaw) };
  if (!Number.isFinite(params.N) || !Number.isFinite(params.r) || !Number.isFinite(params.p)) return false;
  const expected = Buffer.from(expectedRaw, "base64url");
  if (!expected.length) return false;
  const derived = await scrypt(input, salt, expected.length, { ...params, maxmem: 64 * 1024 * 1024 });
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

function createSession(database, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  database.createSession(userId, hashToken(token), Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  return token;
}

function readSession(database, req) {
  const token = getSessionToken(req);
  if (!token) return null;
  return database.getSession(hashToken(token));
}

function hashResetCode(userId, code) {
  return crypto.createHash("sha256").update(`${userId}:${code}`).digest("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  return cookies[COOKIE_NAME] || "";
}

function setSessionCookie(res, req, token) {
  res.setHeader("Set-Cookie", serializeCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    secure: shouldUseSecureCookie(req)
  }));
}

function clearSessionCookie(res, req) {
  res.setHeader("Set-Cookie", serializeCookie(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 0,
    secure: shouldUseSecureCookie(req)
  }));
}

function serializeCookie(name, value, options) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header).split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      continue;
    }
  }
  return cookies;
}

function shouldUseSecureCookie(req) {
  const explicit = process.env.RESUME_PROTOCOL_SECURE_COOKIES;
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return Boolean(req.secure);
}

function rateLimit(scope) {
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const key = `${scope}:${ip}`;
    const entry = rateLimits.get(key) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    if (entry.resetAt <= now) {
      entry.count = 0;
      entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
    }
    entry.count += 1;
    rateLimits.set(key, entry);
    pruneRateLimits(now);
    if (entry.count > RATE_LIMIT_MAX) {
      res.status(429).json({ ok: false, error: "Too many attempts. Try again later." });
      return;
    }
    next();
  };
}

function pruneRateLimits(now) {
  if (rateLimits.size <= RATE_LIMIT_MAX_ENTRIES) return;
  for (const [key, entry] of rateLimits) {
    if (entry.resetAt <= now) rateLimits.delete(key);
    if (rateLimits.size <= RATE_LIMIT_MAX_ENTRIES) return;
  }
  for (const key of rateLimits.keys()) {
    rateLimits.delete(key);
    if (rateLimits.size <= RATE_LIMIT_MAX_ENTRIES) return;
  }
}

function validateRegister(body) {
  return {
    email: validateEmail(body?.email),
    name: validateName(body?.name),
    password: validatePassword(body?.password)
  };
}

function validateLogin(body) {
  return {
    email: validateEmail(body?.email),
    password: validatePassword(body?.password)
  };
}

function validateEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || normalized.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("请填写有效邮箱。");
  }
  return normalized;
}

function validateName(name) {
  const normalized = String(name || "").trim();
  if (!normalized || normalized.length > NAME_MAX) throw new Error("请填写有效姓名。");
  return normalized;
}

function validatePassword(password) {
  const input = String(password || "");
  if (input.length < PASSWORD_MIN || input.length > PASSWORD_MAX) {
    throw new Error(`密码长度必须为 ${PASSWORD_MIN}-${PASSWORD_MAX} 个字符。`);
  }
  return input;
}

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt
  };
}

function isUniqueEmailError(error) {
  return /UNIQUE constraint failed: users\.email/i.test(error?.message || "");
}

export const __testing = {
  RATE_LIMIT_MAX_ENTRIES,
  clearRateLimits() {
    rateLimits.clear();
  },
  rateLimit,
  rateLimitSize() {
    return rateLimits.size;
  }
};
