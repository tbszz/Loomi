import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import https from "node:https";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";

import { createDatabase } from "./database.js";
import { createCustomModel, isPrivateAddress, resolveOpenAiChatUrl, validatePublicHttpsBaseUrl, __testing as modelClientTesting } from "./modelClient.js";
import { createModelSettingsRouter, createUserModel, saveSettings } from "./modelSettings.js";

const directory = mkdtempSync(path.join(tmpdir(), "resume-model-settings-"));
const database = createDatabase({ filename: path.join(directory, "settings.sqlite") });

try {
  const user = database.createUser({ email: "model@example.com", name: "Model User", passwordHash: "hash" });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use("/settings", createModelSettingsRouter(database, { dataDir: directory }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, options = {}) => fetch(base + url, { ...options, headers: { "Content-Type": "application/json", ...options.headers } });

  try {
    const initial = await (await request("/settings")).json();
    assert.deepEqual(initial.settings, { mode: "default", protocol: "anthropic", baseUrl: "", model: "", hasApiKey: false });

    const saved = await (await request("/settings", {
      method: "PUT",
      body: JSON.stringify({ mode: "custom", protocol: "openai", baseUrl: "https://api.example.com/custom", model: "gpt-test", apiKey: "secret-test-key" })
    })).json();
    assert.deepEqual(saved.settings, { mode: "custom", protocol: "openai", baseUrl: "https://api.example.com/custom", model: "gpt-test", hasApiKey: true });
    assert.doesNotMatch(JSON.stringify(database.getUserState(user.id)), /secret-test-key/);

    const reused = await (await request("/settings", {
      method: "PUT",
      body: JSON.stringify({ mode: "custom", protocol: "openai", baseUrl: "https://api.example.com/other-path", model: "gpt-test-2" })
    })).json();
    assert.equal(reused.settings.hasApiKey, true);
    assert.equal(reused.settings.model, "gpt-test-2");

    const changedHost = await request("/settings", {
      method: "PUT",
      body: JSON.stringify({ mode: "custom", protocol: "openai", baseUrl: "https://other.example.com/v1", model: "gpt-test" })
    });
    assert.equal(changedHost.status, 400);
    assert.match((await changedHost.json()).error, /API Key/);

    const reset = await (await request("/settings", { method: "PUT", body: JSON.stringify({ mode: "default" }) })).json();
    assert.equal(reset.settings.mode, "default");
    assert.equal(reset.settings.hasApiKey, false);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }

  assert.equal(validatePublicHttpsBaseUrl("https://api.openai.com/v1/"), "https://api.openai.com/v1");
  assert.throws(() => validatePublicHttpsBaseUrl("http://api.example.com"), /HTTPS/);
  assert.throws(() => validatePublicHttpsBaseUrl("https://127.0.0.1"), /公网/);
  assert.equal(isPrivateAddress("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateAddress("::ffff:7f00:1"), true);
  assert.equal(isPrivateAddress("::ffff:169.254.169.254"), true);
  assert.equal(isPrivateAddress("fe90::1"), true);
  assert.equal(isPrivateAddress("2001:4860:4860::8888"), false);
  assert.equal(resolveOpenAiChatUrl("https://api.openai.com/v1"), "https://api.openai.com/v1/chat/completions");

  const pinnedLookup = modelClientTesting.createPinnedLookup("api.example.com", [{ address: "93.184.216.34", family: 4 }, { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }]);
  const allAddresses = await new Promise((resolve, reject) => pinnedLookup("api.example.com", { all: true }, (error, addresses) => error ? reject(error) : resolve(addresses)));
  assert.deepEqual(allAddresses, [{ address: "93.184.216.34", family: 4 }, { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }]);

  saveSettings(database, user.id, { mode: "custom", protocol: "openai", baseUrl: "https://api.example.com/v1", model: "gpt-test", apiKey: "secret-openai" }, { dataDir: directory });
  const calls = [];
  const model = createUserModel(database, user.id, {
    dataDir: directory,
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    requestImpl: async (target, options) => {
      calls.push({ target: target.toString(), body: JSON.parse(options.body), headers: options.headers });
      return {
        statusCode: 200,
        body: JSON.stringify({
          id: "chatcmpl-test",
          model: "gpt-test",
          choices: [{
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: "我会先分析。",
              tool_calls: [{ id: "call_1", type: "function", function: { name: "analyze_resume", arguments: "{\"source_text\":\"简历\"}" } }]
            }
          }]
        })
      };
    }
  });
  const response = await model({
    system: "sys",
    messages: [
      { role: "user", content: "hello" },
      { role: "user", content: [{ type: "text", text: "请看这页PDF截图" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "hidden" }, { type: "tool_use", id: "call_0", name: "search_jobs", input: { query: "ai" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_0", content: "{\"ok\":true}" }] }
    ],
    tools: [{ name: "analyze_resume", description: "Analyze", input_schema: { type: "object", properties: { source_text: { type: "string" } } } }]
  });
  assert.equal(calls[0].target, "https://api.example.com/v1/chat/completions");
  assert.equal(calls[0].headers.Authorization, "Bearer secret-openai");
  assert.equal(calls[0].body.messages.some(message => JSON.stringify(message).includes("hidden")), false);
  assert.deepEqual(calls[0].body.messages[2].content, [
    { type: "text", text: "请看这页PDF截图" },
    { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } }
  ]);
  assert.equal(calls[0].body.tools[0].function.name, "analyze_resume");
  assert.deepEqual(response.content, [
    { type: "text", text: "我会先分析。" },
    { type: "tool_use", id: "call_1", name: "analyze_resume", input: { source_text: "简历" } }
  ]);

  const anthropic = createCustomModel({ protocol: "anthropic", baseUrl: "https://api.anthropic.example", model: "claude-test", apiKey: "secret-anthropic" }, {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    requestImpl: async (_target, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.messages[1].content[0].type, "image");
      assert.deepEqual(body.messages[1].content[0].source, { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" });
      assert.equal(body.messages[2].content[0].type, "thinking");
      assert.equal(options.headers["x-api-key"], "secret-anthropic");
      return { statusCode: 200, body: JSON.stringify({ content: [{ type: "text", text: "完成" }] }) };
    }
  });
  assert.equal((await anthropic({ messages: [
    { role: "user", content: "hi" },
    { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }] },
    { role: "assistant", content: [{ type: "thinking", thinking: "keep" }] }
  ] })).content[0].text, "完成");

  const keyFile = path.join(directory, "transport-key.pem");
  const certFile = path.join(directory, "transport-cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyFile, "-out", certFile, "-subj", "/CN=localhost", "-days", "1"], { stdio: "ignore" });
  const transportServer = https.createServer({ key: readFileSync(keyFile), cert: readFileSync(certFile) }, (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end("x".repeat(4 * 1024 * 1024 + 1));
  });
  await new Promise(resolve => transportServer.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(modelClientTesting.requestJsonWithHttps(new URL(`https://localhost:${transportServer.address().port}/`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(10_000),
      lookup: (_host, options, callback) => options?.all ? callback(null, [{ address: "127.0.0.1", family: 4 }]) : callback(null, "127.0.0.1", 4),
      rejectUnauthorized: false
    }), /自定义模型响应过大/);
  } finally {
    transportServer.closeAllConnections();
    await new Promise(resolve => transportServer.close(resolve));
  }

  console.log("model settings tests passed: storage, redaction, URL validation, OpenAI/Anthropic adapters");
} finally {
  database.close();
  rmSync(directory, { recursive: true, force: true });
}
