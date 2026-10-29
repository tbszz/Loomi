import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDefaultModel, createCustomModel } from './modelClient.js';
import { createClaudeAgentModel } from './claudeAgent.js';

await test('BigModel retains SDK runtime and confines credentials to official endpoint', async () => {
  const previous = process.env.RESUME_PROTOCOL_AGENT_RUNTIME;
  try {
    process.env.RESUME_PROTOCOL_AGENT_RUNTIME = 'bigmodel';
    assert.equal(createDefaultModel().provider, 'bigmodel');
    assert.equal(createDefaultModel().runtime, 'claude-agent-sdk');
  } finally {
    if (previous === undefined) delete process.env.RESUME_PROTOCOL_AGENT_RUNTIME; else process.env.RESUME_PROTOCOL_AGENT_RUNTIME = previous;
  }
  const model = createClaudeAgentModel({provider:'bigmodel',apiKey:'fixture',baseUrl:'https://open.bigmodel.cn/api/anthropic',model:'glm-5.3'}, {sdk:{query:({options})=>(async function*(){
    assert.equal(options.env.ANTHROPIC_BASE_URL,'https://open.bigmodel.cn/api/anthropic');
    assert.equal(options.env.ANTHROPIC_AUTH_TOKEN,'fixture');
    assert.equal(options.model,'glm-5.3');
    yield {type:'result',subtype:'success',result:'ok'};
  })()}});
  assert.equal((await model({messages:[]})).content[0].text,'ok');
  await assert.rejects(createClaudeAgentModel({provider:'bigmodel',apiKey:'fixture',baseUrl:'https://untrusted.example'})({messages:[]}),/官方/);
});

await test('auto routes MiniMax credentials through Claude Agent SDK, not an application tool loop', () => {
  const previous = Object.fromEntries(['RESUME_PROTOCOL_AGENT_RUNTIME', 'ANTHROPIC_API_KEY', 'MINIMAX_API_KEY'].map(key => [key, process.env[key]]));
  try {
    process.env.RESUME_PROTOCOL_AGENT_RUNTIME = 'auto';
    delete process.env.ANTHROPIC_API_KEY;
    process.env.MINIMAX_API_KEY = 'test';
    const model = createDefaultModel();
    assert.equal(model.runtime, 'claude-agent-sdk');
    assert.equal(model.provider, 'minimax');
    assert.equal(typeof model.runTools, 'function');
    delete process.env.MINIMAX_API_KEY;
    assert.equal(createDefaultModel().runtime, 'claude-agent-sdk', 'missing credentials must fail honestly at execution');
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

await test('compatible models retain helper calls but refuse a second primary runtime', async () => {
  const model = createCustomModel({ protocol: 'openai', baseUrl: 'https://api.example.com', model: 'test', apiKey: 'test' });
  assert.equal(model.runtime, 'compatible-helper');
  await assert.rejects(model.runTools({ tools: [] }), /SDK|辅助/);
});
