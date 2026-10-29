import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createAuthRouter, requireUser, __testing } from "./auth.js";
import { createDatabase } from "./database.js";

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "resume-protocol-auth-"));
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

async function startServer(database, configure = () => {}) {
  const app = express();
  configure(app);
  app.use(express.json());
  app.use("/auth", createAuthRouter(database));
  app.get("/private", requireUser(database), (req, res) => {
    res.json({ user: req.user });
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function cookieFrom(response) {
  const raw = response.headers.getSetCookie?.() || [];
  return raw.map((cookie) => cookie.split(";")[0]).join("; ");
}

async function request(baseUrl, pathName, { method = "GET", body, cookie, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  return { response, data, cookie: cookieFrom(response) };
}

{
  const dir = tempDir();
  __testing.clearRateLimits();
  const database = createDatabase({ filename: path.join(dir, "auth.sqlite") });
  const server = await startServer(database);
  try {
    const shortPassword = await request(server.baseUrl, "/auth/register", {
      method: "POST",
      body: { email: "bad@example.com", name: "Bad", password: "short" }
    });
    assert.equal(shortPassword.response.status, 400);
    assert.equal(shortPassword.data.error, "密码长度必须为 10-128 个字符。");

    const registered = await request(server.baseUrl, "/auth/register", {
      method: "POST",
      body: { email: "USER@example.com", name: "User", password: "correct horse" }
    });
    assert.equal(registered.response.status, 200);
    assert.equal(registered.data.user.email, "user@example.com");
    assert.match(registered.cookie, /resume_protocol_session=/);
    assert.equal(registered.response.headers.get("set-cookie").includes("HttpOnly"), true);
    assert.equal(registered.response.headers.get("set-cookie").includes("SameSite=Lax"), true);
    assert.equal(registered.response.headers.get("set-cookie").includes("Secure"), false);

    const me = await request(server.baseUrl, "/auth/me", { cookie: registered.cookie });
    assert.equal(me.data.user.email, "user@example.com");

    const privateOk = await request(server.baseUrl, "/private", { cookie: registered.cookie });
    assert.equal(privateOk.response.status, 200);
    assert.equal(privateOk.data.user.email, "user@example.com");

    const wrong = await request(server.baseUrl, "/auth/login", {
      method: "POST",
      body: { email: "user@example.com", password: "wrong password" }
    });
    assert.equal(wrong.response.status, 401);
    assert.equal(wrong.data.error, "邮箱或密码错误。");

    const login = await request(server.baseUrl, "/auth/login", {
      method: "POST",
      body: { email: "USER@example.com", password: "correct horse" }
    });
    assert.equal(login.response.status, 200);
    assert.match(login.cookie, /resume_protocol_session=/);

    const logout = await request(server.baseUrl, "/auth/logout", { method: "POST", cookie: login.cookie });
    assert.equal(logout.response.status, 200);
    const afterLogout = await request(server.baseUrl, "/private", { cookie: login.cookie });
    assert.equal(afterLogout.response.status, 401);

    database.createSession(registered.data.user.id, crypto.createHash("sha256").update("expired-token").digest("hex"), Date.now() - 1);
    const expired = await request(server.baseUrl, "/private", { cookie: "resume_protocol_session=expired-token" });
    assert.equal(expired.response.status, 401);

    const malformed = await request(server.baseUrl, "/auth/me", { cookie: "resume_protocol_session=%E0%A4%A" });
    assert.deepEqual(malformed.data, { user: null });
  } finally {
    await server.close();
    database.close();
    cleanup(dir);
  }
}

{
  const dir = tempDir();
  __testing.clearRateLimits();
  const database = createDatabase({ filename: path.join(dir, "secure.sqlite") });
  const server = await startServer(database);
  try {
    const spoofed = await request(server.baseUrl, "/auth/register", {
      method: "POST",
      body: { email: "spoofed@example.com", name: "Spoofed", password: "correct horse" },
      headers: { "x-forwarded-proto": "https" }
    });
    assert.equal(spoofed.response.headers.get("set-cookie").includes("Secure"), false);
  } finally {
    await server.close();
    database.close();
    cleanup(dir);
  }
}

{
  __testing.clearRateLimits();
  const fakeRes = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    }
  };
  const limiter = __testing.rateLimit("test");
  for (let index = 0; index < __testing.RATE_LIMIT_MAX_ENTRIES + 50; index += 1) {
    limiter({ ip: `192.0.2.${index}` }, fakeRes, () => {});
  }
  assert.equal(__testing.rateLimitSize() <= __testing.RATE_LIMIT_MAX_ENTRIES, true);
  __testing.clearRateLimits();
}

console.log("auth tests passed");
