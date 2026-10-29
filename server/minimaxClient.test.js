import assert from "node:assert/strict";
import { createServer } from "node:http";
import { requestMiniMax, parseJsonObject } from "./minimaxClient.js";

assert.deepEqual(parseJsonObject('```json\n[{"quote":"a } b"},{"quote":"c"}]\n```'), [{quote:'a } b'},{quote:'c'}]);
assert.deepEqual(parseJsonObject('说明 {"annotations":[{"quote":"原文"}]} 完成'), {annotations:[{quote:'原文'}]});
assert.throws(() => parseJsonObject('{"annotations":['), /结构不完整/);

const previous = { key: process.env.MINIMAX_API_KEY, url: process.env.MINIMAX_API_URL };
let failure = false;
const server = createServer(async (req, res) => {
  assert.equal(req.url, "/anthropic/v1/messages");
  assert.equal(req.headers["x-api-key"], "test-key-not-real");
  assert.equal(req.headers["anthropic-version"], "2023-06-01");
  let text = "";
  for await (const chunk of req) text += chunk;
  const body = JSON.parse(text);
  assert.equal(body.messages[0].role, "user");
  assert.equal(body.tools[0].name, "analyze_resume");
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(failure ? {base_resp:{status_code:1008,status_msg:"insufficient balance"}} : {content:[{type:"tool_use",id:"t1",name:"analyze_resume",input:{}}],stop_reason:"tool_use"}));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  process.env.MINIMAX_API_KEY = "test-key-not-real";
  process.env.MINIMAX_API_URL = `http://127.0.0.1:${server.address().port}/anthropic`;
  const payload = { system: "test", messages: [{role:"user",content:"hello"}], tools:[{name:"analyze_resume",input_schema:{type:"object",properties:{}}}] };
  assert.equal((await requestMiniMax(payload)).content[0].id, "t1");
  failure = true;
  await assert.rejects(requestMiniMax(payload), /默认模型请求失败/);
  console.log("MiniMax adapter protocol and provider-error tests passed");
} finally {
  for (const [name, value] of [["MINIMAX_API_KEY",previous.key],["MINIMAX_API_URL",previous.url]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
