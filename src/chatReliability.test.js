import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  ApiError,
  importLocalConversations,
  requestJson,
  streamConversationMessage,
  validateResumeFile
} from "./api.js";

const server = createServer((req, res) => {
  if (req.url === '/api/conversations/active/messages') {
    res.writeHead(200, {'Content-Type':'text/event-stream'});
    res.write(': heartbeat\n\n');
    let count = 0;
    const timer = setInterval(() => {
      if (++count === 8) { clearInterval(timer); res.end('event: done\ndata: {"conversation":{"id":"active"}}\n\n'); }
      else res.write(': heartbeat\n\n');
    }, 20);
    res.on('close',()=>clearInterval(timer));
    return;
  }
  if (req.url === '/api/conversations/silent/messages') {
    res.writeHead(200, {'Content-Type':'text/event-stream'});
    res.write(': heartbeat\n\n');
    return;
  }
  if (req.url === "/slow") return;
  if (req.url === "/slow-body") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"ok":');
    return;
  }
  if (req.url === "/html") {
    res.writeHead(502, { "Content-Type": "text/html" });
    return res.end("<html>Bad gateway</html>");
  }
  if (req.url === "/invalid") return res.end("not json");
  if (req.url === "/null") return res.end("null");
  if (req.url === "/failure") {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "需要先登录" }));
  }
  if (req.url === "/api/conversations/c1/messages") {
    assert.equal(req.method, "POST");
    assert.match(req.headers.accept, /text\/event-stream/);
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      assert.equal(JSON.parse(body).content, "生成岗位版简历");
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('event: status\ndata: {"label":"正在生成"}\n\n');
      res.write('event: message\ndata: {"id":"m2","role":"assistant","content":"已完成","createdAt":"2026-09-07T03:00:00.000Z"}\n\n');
      res.end('event: done\ndata: {"conversation":{"id":"c1","messages":[]}}\n\n');
    });
    return;
  }
  if (req.url === "/api/conversations/c2/messages") {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end('event: error\ndata: {"error":"模型调用失败","conversation":{"id":"c2","messages":[{"id":"u1","role":"user","content":"hi"}]}}\n\n');
    return;
  }
  if (req.url === "/api/conversations/c3/messages") {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end('event: status\ndata: {"label":"正在生成"}\n\n');
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, value: 42, cookie: req.headers.cookie || "" }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

try {
  await test('stream transport may outlive its idle interval while data arrives, but detects silence', async () => {
    assert.equal((await streamConversationMessage('active','test',{baseUrl,timeoutMs:80})).id,'active');
    await assert.rejects(streamConversationMessage('silent','test',{baseUrl,timeoutMs:40}),/请求超时/);
  });
  await test("requestJson keeps credentials, JSON, and server errors readable", async () => {
    const result = await requestJson("/ok", { baseUrl, headers: { Cookie: "sid=test" } });
    assert.equal(result.value, 42);
    assert.equal(result.cookie, "sid=test");
    await assert.rejects(requestJson("/failure", { baseUrl }), /需要先登录/);
  });

  await test("requestJson reports invalid responses and timeouts", async () => {
    await assert.rejects(requestJson("/html", { baseUrl }), /HTTP 502/);
    await assert.rejects(requestJson("/invalid", { baseUrl }), /服务器返回了无效数据/);
    await assert.rejects(requestJson("/null", { baseUrl }), /服务器返回了无效数据/);
    await assert.rejects(requestJson("/slow", { baseUrl, timeoutMs: 30 }), /请求超时/);
    await assert.rejects(requestJson("/slow-body", { baseUrl, timeoutMs: 30 }), /请求超时/);
  });

  await test("requestJson preserves caller cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(requestJson("/ok", { baseUrl, signal: controller.signal }), { name: "AbortError" });
  });

  await test("streamConversationMessage parses status, message, and done events", async () => {
    const events = [];
    const done = await streamConversationMessage("c1", "生成岗位版简历", {
      baseUrl,
      onEvent: (event) => events.push(event)
    });
    assert.deepEqual(events.map((event) => event.type), ["status", "message", "done"]);
    assert.equal(events[1].message.content, "已完成");
    assert.equal(done.id, "c1");
  });

  await test("streamConversationMessage emits error conversation before throwing", async () => {
    const events = [];
    await assert.rejects(streamConversationMessage("c2", "hi", {
      baseUrl,
      onEvent: (event) => events.push(event)
    }), /模型调用失败/);
    assert.equal(events[0].type, "error");
    assert.equal(events[0].conversation.id, "c2");
  });

  await test("streamConversationMessage reports interrupted streams without done or error", async () => {
    await assert.rejects(streamConversationMessage("c3", "hi", { baseUrl }), /连接中断/);
  });
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

await test("unavailable service has a readable error", async () => {
  await assert.rejects(requestJson("/ok", { baseUrl }), /无法连接服务/);
});

await test("resume file validation enforces type and size", () => {
  assert.equal(validateResumeFile({ name: "resume.pdf", size: 8 * 1024 * 1024 }).ok, true);
  assert.equal(validateResumeFile({ name: "resume.md", size: 1 }).ok, true);
  assert.equal(validateResumeFile({ name: "resume.doc", size: 1 }).ok, false);
  assert.match(validateResumeFile({ name: "resume.exe", size: 1 }).error, /PDF、DOCX、TXT、Markdown 或 JSON/);
  assert.match(validateResumeFile({ name: "resume.pdf", size: 8 * 1024 * 1024 + 1 }).error, /8MB/);
});

await test("local import reads legacy storage only when manually requested", async () => {
  const calls = [];
  const storage = {
    getItem: (key) => key === "resume-protocol.chat.v1"
      ? JSON.stringify({ conversations: [{ id: "legacy", messages: [] }] })
      : null
  };
  const result = await importLocalConversations(storage, (path, options) => {
    calls.push({ path, options });
    return Promise.resolve({ count: 1 });
  });
  assert.equal(result.imported, 1);
  assert.equal(calls[0].path, "/api/conversations/import");
  assert.deepEqual(JSON.parse(calls[0].options.body).conversations, [{ id: "legacy", messages: [] }]);
});

await test("ApiError preserves status and server message", () => {
  const error = new ApiError("需要先登录", 401);
  assert.equal(error.status, 401);
  assert.equal(error.message, "需要先登录");
});
