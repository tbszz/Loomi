import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createAuthRouter, requireUser, __testing } from "./auth.js";
import { createDatabase } from "./database.js";
import { createMailer } from "./mailer.js";

const dir = mkdtempSync(path.join(os.tmpdir(), "resume-protocol-reset-"));
const database = createDatabase({ filename: path.join(dir, "reset.sqlite") });
const sent = [];
let failNext = false;
const mailer = { configured: true, async send(mail) { if (failNext) { failNext = false; throw Object.assign(new Error("验证码邮件发送失败，请稍后再试。"), { statusCode: 502 }); } sent.push(mail); } };

async function start(withMailer) {
  const app = express();
  app.use(express.json());
  app.use("/auth", createAuthRouter(database, { mailer: withMailer }));
  app.get("/private", requireUser(database), (req, res) => res.json({ user: req.user }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
const post = (base, route, body, cookie) => fetch(base + route, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = response => (response.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).join("; ");
const codeOf = mail => mail.text.match(/\d{6}/)[0];

const server = await start(mailer);
try {
  const email = "reset@example.test";
  const register = await post(server.url, "/auth/register", { email, name: "重置用户", password: "old-passphrase-42" });
  const oldCookie = cookieOf(register);
  assert.equal(register.status, 200);

  // Unknown emails get the same reply and no mail.
  const unknown = await post(server.url, "/auth/password-reset/request", { email: "nobody@example.test" });
  assert.equal(unknown.status, 200);
  assert.equal(sent.length, 0);

  const request = await post(server.url, "/auth/password-reset/request", { email: "  RESET@example.test " });
  assert.deepEqual(await request.json(), await unknown.json());
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, email);
  const code = codeOf(sent[0]);

  // Within the cooldown no second code is issued, and the first stays valid.
  await post(server.url, "/auth/password-reset/request", { email });
  assert.equal(sent.length, 1);

  const wrong = await post(server.url, "/auth/password-reset/confirm", { email, code: code === "000000" ? "111111" : "000000", password: "new-passphrase-42" });
  assert.equal(wrong.status, 400);
  assert.equal(database.getPasswordReset(database.getUserByEmail(email).id).attempts, 1);

  const shortPassword = await post(server.url, "/auth/password-reset/confirm", { email, code, password: "short" });
  assert.equal(shortPassword.status, 400);

  const confirm = await post(server.url, "/auth/password-reset/confirm", { email, code, password: "new-passphrase-42" });
  assert.equal(confirm.status, 200);
  assert.equal((await confirm.json()).user.email, email);
  assert.equal((await fetch(server.url + "/private", { headers: { cookie: cookieOf(confirm) } })).status, 200);
  assert.equal((await fetch(server.url + "/private", { headers: { cookie: oldCookie } })).status, 401, "old sessions are signed out");
  assert.equal((await post(server.url, "/auth/login", { email, password: "old-passphrase-42" })).status, 401);
  assert.equal((await post(server.url, "/auth/login", { email, password: "new-passphrase-42" })).status, 200);
  assert.equal((await post(server.url, "/auth/password-reset/confirm", { email, code, password: "third-passphrase-42" })).status, 400, "a code works once");

  // Too many wrong guesses burn the code even if the right one follows.
  const user = database.getUserByEmail(email);
  database.createPasswordReset(user.id, "0".repeat(64), Date.now() - 1);
  await post(server.url, "/auth/password-reset/request", { email });
  const fresh = codeOf(sent.at(-1));
  for (let i = 0; i < 5; i += 1) await post(server.url, "/auth/password-reset/confirm", { email, code: fresh === "000000" ? "111111" : "000000", password: "third-passphrase-42" });
  assert.equal((await post(server.url, "/auth/password-reset/confirm", { email, code: fresh, password: "third-passphrase-42" })).status, 400);

  // Expired codes are rejected.
  database.createPasswordReset(user.id, "0".repeat(64), Date.now() - 1);
  assert.equal((await post(server.url, "/auth/password-reset/confirm", { email, code: "000000", password: "third-passphrase-42" })).status, 400);

  // A failed send is reported as a failure and leaves no usable code behind.
  database.deletePasswordReset(database.getPasswordReset(user.id).id);
  failNext = true;
  const failed = await post(server.url, "/auth/password-reset/request", { email });
  assert.equal(failed.status, 502);
  assert.equal(database.getPasswordReset(user.id), null);
} finally {
  await server.close();
}

__testing.clearRateLimits();
const unconfigured = await start(createMailer({}));
try {
  const response = await post(unconfigured.url, "/auth/password-reset/request", { email: "reset@example.test" });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /未配置/);
} finally {
  await unconfigured.close();
  database.close?.();
  rmSync(dir, { recursive: true, force: true });
}
console.log("password reset tests passed");
