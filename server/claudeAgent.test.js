import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClaudeAgentModel } from './claudeAgent.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as installedSdk from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';

const config = { apiKey: 'test-key', model: 'test-model', timeoutMs: 1000 };
const fakeSdk = query => ({ query, tool: (name, description, schema, handler) => ({ name, handler }), createSdkMcpServer: value => value });
const scope = { userId: 'u1', candidateId: 'c1', conversationId: 'thread1' };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
await test('productive partial SDK output keeps a task alive beyond its former total budget', async () => {
  let notifications = 0;
  const model = createClaudeAgentModel({ ...config, idleTimeoutMs: 40 }, { sdk: fakeSdk(({ options }) => (async function* () {
    assert.equal(options.includePartialMessages, true);
    for (let i = 0; i < 6; i++) {
      await pause(15);
      yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'private reasoning' } } };
    }
    yield { type: 'result', subtype: 'success', result: '完成' };
  })()) });
  assert.equal((await model({ messages: [], onProgress: (...args) => { assert.deepEqual(args, []); notifications++; } })).content[0].text, '完成');
  assert(notifications >= 6);
});
await test('SDK pings, empty deltas and api retries do not indefinitely extend idle work', async () => {
  for (const event of [{ type: 'stream_event', event: { type: 'ping' } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { text: '' } } },
    { type: 'system', subtype: 'api_retry', error_status: 500 }]) {
    const model = createClaudeAgentModel({ ...config, idleTimeoutMs: 35 }, { sdk: fakeSdk(({ options }) => (async function* () {
      while (!options.abortController.signal.aborted) { await pause(10); yield event; }
    })()) });
    await assert.rejects(model({ messages: [] }), /没有新的执行进展/);
  }
});
await test('nested tool activity keeps the parent alive and caller cancellation still stops it', async () => {
  const controller = new AbortController();
  let toolSignal;
  const model = createClaudeAgentModel({ ...config, idleTimeoutMs: 40 }, { sdk: fakeSdk(({ options }) => (async function* () {
    assert.equal(options.mcpServers.career.timeout, undefined);
    await options.mcpServers.career.tools[0].handler({});
    yield { type: 'result', subtype: 'success', result: '完成' };
  })()) });
  const execute = async (_, __, runtime) => {
    toolSignal = runtime.signal;
    for (let i = 0; i < 6; i++) { await pause(15); runtime.onProgress(); }
    return {};
  };
  const args = { messages: [], tools: [{ name: 'search_jobs', input_schema: { properties: {} } }], execute };
  assert.equal((await model.runTools(args)).content[0].text, '完成');
  const pending = model.runTools({ ...args, signal: controller.signal, execute: async (_, __, runtime) => {
    toolSignal = runtime.signal;
    controller.abort(new Error('用户取消'));
    return new Promise(() => {});
  } });
  await assert.rejects(pending, /用户取消/);
  assert.equal(toolSignal.aborted, true);
});
async function preToolDecision(options, name, input, signal = new AbortController().signal) {
  assert.ok(options.hooks?.PreToolUse?.length, 'the noninteractive runtime needs a registered PreToolUse guard');
  assert.equal(options.hooks.PreToolUse.length, 1);
  const matcher = options.hooks.PreToolUse[0];
  assert.equal(matcher.matcher, undefined, 'the guard must cover every tool, including unknown names');
  assert.equal(matcher.hooks.length, 1);
  const result = await matcher.hooks[0]({ hook_event_name: 'PreToolUse', tool_name: name, tool_input: input, tool_use_id: 'audit-tool' }, 'audit-tool', { signal });
  assert.equal(result.hookSpecificOutput?.hookEventName, 'PreToolUse');
  return result.hookSpecificOutput.permissionDecision;
}
await test('MiniMax credentials and model stay on the MiniMax endpoint', async () => {
  const model = createClaudeAgentModel({ ...config, provider: 'minimax', baseUrl: 'https://api.minimaxi.com/anthropic' }, { sdk: fakeSdk(({ options }) => {
    assert.equal(options.env.ANTHROPIC_BASE_URL, 'https://api.minimaxi.com/anthropic');
    assert.equal(options.env.ANTHROPIC_AUTH_TOKEN, 'test-key');
    assert.equal(options.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'test-model');
    return (async function* () { yield { type: 'result', subtype: 'success', result: 'OK' }; })();
  }) });
  await model({ system: '', messages: [] });
});
await test('SDK has no ambient tools, settings, sessions or unrelated secrets', async () => {
  const model = createClaudeAgentModel({ ...config, sessionDirectory: '/tmp/sessions' }, { sdk: fakeSdk(({ options }) => {
    assert.deepEqual(options.settingSources, ['project'], '只从隔离工作区读取项目设置，绝不加载 user/local 设置');
    assert.deepEqual(options.plugins, [], '不得启用第三方 Plugin');
    assert.equal(options.enableFileCheckpointing, false);
    assert.equal(options.resume, undefined);
    assert.equal(options.strictMcpConfig, true);
    assert.equal(options.permissionMode, 'dontAsk');
    assert.equal(options.permissionPrompts, 'none');
    assert.equal(options.canUseTool, undefined, 'none 模式不会调用 canUseTool，不应把它伪装成权限边界');
    assert(options.disallowedTools.includes('PowerShell'));
    assert(options.disallowedTools.includes('Bash'));
    assert.equal(options.disallowedTools.includes('Read'), false, '第一方参考资料由精确路径 hook 限制');
    assert(options.disallowedTools.includes('Agent'));
    assert(options.disallowedTools.includes('Task'));
    // Skill itself must no longer be banned, otherwise the four Skills can't run.
    assert.equal(options.disallowedTools.includes('Skill'), false);
    assert.equal(options.env.ANTHROPIC_API_KEY, 'test-key');
    assert.equal(options.env.MINIMAX_API_KEY, undefined);
    return (async function* () {
      assert.equal(await preToolDecision(options, 'Read', { file_path: '/unrelated/private.txt' }), 'deny');
      yield { type: 'result', subtype: 'success', result: '你好' };
    })();
  }) });
  assert.equal((await model({ system: '规则', messages: [], session: { scope: { userId: 'u1', candidateId: 'c1', conversationId: 'conv1' } } })).content[0].text, '你好');
});
await test('无 scope 的辅助调用不获得任何 Skill 与业务工具', async () => {
  const model = createClaudeAgentModel(config, { sdk: fakeSdk(({ options }) => {
    assert.deepEqual(options.tools, [], '辅助调用不得启用 Skill 工具');
    assert.deepEqual(options.skills, [], '辅助调用不得装载 Skill');
    assert.deepEqual(options.settingSources, [], '不得加载 user/local 设置');
    assert.equal(options.disallowedTools.includes('Skill'), true, '无 Skill 时必须显式禁用 Skill 工具');
    return (async function* () { yield { type: 'result', subtype: 'success', result: '你好' }; })();
  }) });
  assert.equal((await model({ system: '规则', messages: [] })).content[0].text, '你好');
});
await test('SDK prompt keeps image blocks as multimodal content', async () => {
  const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } };
  const model = createClaudeAgentModel(config, { sdk: fakeSdk(({ prompt }) => (async function* () {
    const iterator = prompt[Symbol.asyncIterator]();
    const first = await iterator.next();
    const content = first.value.message.content;
    assert(Array.isArray(content));
    assert.deepEqual(content.find(block => block?.type === 'image'), image);
    assert.equal(JSON.stringify(content).includes('"type":"image"'), true);
    assert.equal(typeof content[0].text, 'string');
    yield { type: 'result', subtype: 'success', result: '看到了' };
  })()) });
  assert.equal((await model({ system: '规则', messages: [{ role: 'user', content: [{ type: 'text', text: '识别这页PDF' }, image] }] })).content[0].text, '看到了');
});
await test('primary PDF turns use the configured vision model and retain images on session resume', async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'pdf-vision-model-'));
  const image = {type:'image',source:{type:'base64',media_type:'image/png',data:'iVBORw0KGgo='}};
  try {
    const model=createClaudeAgentModel({...config,model:'text-model',visionModel:'vision-model',sessionDirectory:directory},{sdk:fakeSdk(({options,prompt})=>(async function*(){
      assert.equal(options.model,'vision-model');
      assert.equal(options.resume,'original-session');
      const input=await prompt[Symbol.asyncIterator]().next();
      assert.deepEqual(input.value.message.content.find(block=>block.type==='image'),image);
      yield {type:'result',subtype:'success',result:'第1页布局合理。',session_id:'original-session'};
    })())});
    await model.runTools({messages:[{role:'user',content:'old'},{role:'user',content:[{type:'text',text:'检查排版'},image]}],session:{scope,sessionId:'original-session'}});
  }finally{await rm(directory,{recursive:true,force:true});}
});
await test('only registered career tools execute and return their actual result', async () => {
  const calls = [];
  const model = createClaudeAgentModel(config, { sdk: fakeSdk(({ options }) => (async function* () {
    assert.equal(await preToolDecision(options, 'Bash', {}), 'deny');
    const t = options.mcpServers.career.tools[0];
    assert.equal(t.name, 'search_jobs');
    const result = await t.handler({ query: '设计' });
    assert.deepEqual(JSON.parse(result.content[0].text), { jobs: [] });
    yield { type: 'result', subtype: 'success', result: '没有匹配岗位' };
  })()) });
  await model.runTools({ system: '规则', messages: [], tools: [{ name: 'search_jobs', description: '搜索', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }], execute: async (name, args) => { calls.push([name, args]); return { jobs: [] }; } });
  assert.deepEqual(calls, [['search_jobs', { query: '设计' }]]);
});
await test('SDK failure and empty completion cannot masquerade as success', async () => {
  for (const result of [{ type: 'result', subtype: 'error_max_turns', errors: ['secret-key'] }, { type: 'result', subtype: 'success', result: '' }]) {
    const model = createClaudeAgentModel(config, { sdk: fakeSdk(() => (async function* () { yield result; })()) });
    await assert.rejects(model({ system: '', messages: [] }), e => !e.message.includes('secret-key'));
  }
});
await test('cancelled requests never start SDK or execute tools', async () => {
  const controller = new AbortController(); controller.abort();
  const model = createClaudeAgentModel(config, { sdk: fakeSdk(() => { assert.fail('query started after cancellation'); }) });
  await assert.rejects(model({ system: '', messages: [], signal: controller.signal }), { name: 'AbortError' });
});

await test('SDK tool writes are serialized and callback failures are returned as tool errors', async () => {
  const order = [];
  const model = createClaudeAgentModel(config, { sdk: fakeSdk(({ options }) => (async function* () {
    const handler = options.mcpServers.career.tools[0].handler;
    const results = await Promise.all([handler({ query: 'first' }), handler({ query: 'second' })]);
    assert.equal(results[1].isError, true);
    yield { type: 'result', subtype: 'success', result: '部分完成' };
  })()) });
  await model.runTools({ system: '', messages: [], tools: [{ name: 'search_jobs', description: '', input_schema: { properties: { query: { type: 'string' } } } }], execute: async (_, args) => {
    order.push('start-' + args.query);
    await new Promise(resolve => setTimeout(resolve, 5));
    order.push('end-' + args.query);
    if (args.query === 'second') throw new Error('offline');
    return {};
  } });
  assert.deepEqual(order, ['start-first', 'end-first', 'start-second', 'end-second']);
});

await test('SDK timeout aborts the query and gives a bounded public error', async () => {
  const model = createClaudeAgentModel({ ...config, timeoutMs: 10 }, { sdk: fakeSdk(({ options }) => (async function* () {
    await new Promise(resolve => options.abortController.signal.addEventListener('abort', resolve, { once: true }));
    yield { type: 'result', subtype: 'success', result: 'too late' };
  })()) });
  await assert.rejects(model({ system: '', messages: [] }), /没有新的执行进展/);
});

await test('uncooperative tool cannot keep a cancelled SDK request open', async () => {
  let closed = false;
  const model = createClaudeAgentModel({ ...config, timeoutMs: 10 }, { sdk: fakeSdk(({ options }) => {
    const stream = (async function* () {
      await options.mcpServers.career.tools[0].handler({});
      yield { type: 'result', subtype: 'success', result: 'late' };
    })();
    stream.close = () => { closed = true; };
    return stream;
  }) });
  await assert.rejects(model.runTools({ system: '', messages: [], tools: [{ name: 'prepare_interview', input_schema: { properties: {} } }], execute: () => new Promise(() => {}) }), /没有新的执行进展/);
  assert.equal(closed, true);
});

await test('first call captures the SDK session id from the stream', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sdk-first-'));
  const model = createClaudeAgentModel({ ...config, sessionDirectory: directory }, { sdk: fakeSdk(() => (async function* () {
    yield { type: 'system', subtype: 'init', session_id: 'session-first' };
    yield { type: 'result', subtype: 'success', result: '完成', session_id: 'session-first' };
  })()) });
  const outcome = await model({ system: '', messages: [], session: { scope } });
  assert.equal(outcome.sessionId, 'session-first');
  assert.equal(outcome.resumed, false);
  await rm(directory, { recursive: true, force: true });
});

await test('second call resumes the previous session instead of starting fresh', async () => {
  const seen = [];
  const directory = await mkdtemp(path.join(tmpdir(), 'sdk-continuity-'));
  const model = createClaudeAgentModel({ ...config, sessionDirectory: directory }, { sdk: fakeSdk(({ options }) => {
    seen.push(options);
    return (async function* () {
      yield { type: 'system', subtype: 'init', session_id: seen.length === 1 ? 'session-a' : 'session-a' };
      yield { type: 'result', subtype: 'success', result: '续上', session_id: 'session-a' };
    })();
  }) });
  const first = await model({ system: '', messages: [], session: { scope } });
  assert.equal(first.sessionId, 'session-a');
  const second = await model({ system: '', messages: [], session: { sessionId: first.sessionId, scope } });
  assert.equal(seen[0].cwd, seen[1].cwd, 'the SDK cwd project key must never change');
  assert.equal(seen[0].env.CLAUDE_CONFIG_DIR, seen[1].env.CLAUDE_CONFIG_DIR);
  assert.equal(seen[1].resume, 'session-a');
  assert.equal(seen[1].forkSession, false);
  assert.equal(seen[1].persistSession, true);
  assert.equal(second.resumed, true);
  assert.equal(second.sessionId, 'session-a');
  await rm(directory, { recursive: true, force: true });
});

await test('resume failure falls back once to a fresh session', async () => {
  const seen = [];
  const directory = await mkdtemp(path.join(tmpdir(), 'sdk-recovery-'));
  const model = createClaudeAgentModel({ ...config, sessionDirectory: directory }, { sdk: fakeSdk(({ options }) => {
    seen.push(options);
    if (options.resume) return (async function* () { throw new Error("No conversation found with session ID: 'gone'"); })();
    return (async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'session-new' };
      yield { type: 'result', subtype: 'success', result: '重新开始', session_id: 'session-new' };
    })();
  }) });
  const outcome = await model({ system: '', messages: [], session: { sessionId: 'gone', scope } });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].resume, 'gone');
  assert.equal(seen[1].resume, undefined);
  assert.equal(outcome.resumed, false);
  assert.equal(outcome.sessionId, 'session-new');
  await rm(directory, { recursive: true, force: true });
});

await test('scoped queries discover only first-party Skills and cannot access ambient tools', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sdk-skills-'));
  try {
    const seen = [];
    const model = createClaudeAgentModel({ ...config, sessionDirectory: directory }, { sdk: fakeSdk(({ options }) => (async function* () {
      seen.push(options);
      assert.deepEqual(options.settingSources, ['project']);
      assert.deepEqual(options.skills, ['resume-analysis', 'jd-analysis', 'resume-tailoring', 'interview-prep', 'resume-layout']);
      assert.ok(options.tools.includes('Skill'));
      assert.equal(options.disallowedTools.includes('Skill'), false);
      assert.equal(await preToolDecision(options, 'Skill', { skill: 'jd-analysis' }), 'allow');
      assert.equal(await preToolDecision(options, 'Skill', { skill: 'unrelated' }), 'deny');
      assert.equal(await preToolDecision(options, 'Read', { file_path: 'secret' }), 'deny');
      assert.ok(options.tools.includes('Read'));
      assert.equal(await preToolDecision(options, 'Read', { file_path: '.claude/skills/jd-analysis/references/_index.md' }), 'allow');
      assert.equal(await preToolDecision(options, 'Read', { file_path: '.claude/skills/_schema/role-profile-schema.md' }), 'allow');
      assert.equal(await preToolDecision(options, 'Read', { file_path: '.claude/skills/jd-analysis/references/../../../../data/resume-protocol.sqlite' }), 'deny');
      assert.match(await readFile(path.join(options.cwd, '.claude', 'skills', 'jd-analysis', 'SKILL.md'), 'utf8'), /name: jd-analysis/);
      yield { type: 'system', subtype: 'init', session_id: 'a', skills: options.skills };
      yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'skill-a', name: 'Skill', input: { skill: 'jd-analysis' } }, { type: 'tool_use', id: 'skill-b', name: 'Skill', input: { skill: 'resume-analysis' } }] } };
      yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'skill-a', content: 'Loaded jd-analysis' }, { type: 'tool_result', tool_use_id: 'skill-b', content: 'failed', is_error: true }] } };
      yield { type: 'result', subtype: 'success', result: '完成', session_id: 'a' };
    })()) });
    const result = await model.runTools({ system: '', messages: [], session: { scope } });
    assert.deepEqual(result.runtimeTrace.usedSkills, ['jd-analysis']);
    assert.deepEqual(result.runtimeTrace.requestedSkills, ['jd-analysis', 'resume-analysis']);
    await model.runTools({ system: '', messages: [], session: { scope: { ...scope, candidateId: 'c2' } } });
    assert.notEqual(seen[0].cwd, seen[1].cwd);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test('provider and post-tool failures do not replay a resumed turn', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sdk-no-replay-'));
  try {
    for (const toolAttempted of [false, true]) {
      let queries = 0, attempts = 0;
      const model = createClaudeAgentModel({ ...config, sessionDirectory: directory }, { sdk: fakeSdk(({ options }) => (async function* () {
        queries++;
        if (toolAttempted) await options.mcpServers.career.tools[0].handler({});
        throw new Error(toolAttempted ? "No conversation found with session ID: 'a'" : 'provider unavailable');
      })()) });
      await assert.rejects(model.runTools({ system: '', messages: [], session: { sessionId: 'a', scope }, tools: [{ name: 'save_candidate_fact', input_schema: { properties: {} } }], execute: async () => { attempts++; throw new Error('write committed but acknowledgement failed'); } }));
      assert.equal(queries, 1, 'only an unavailable transcript before tool invocation may retry');
      assert.equal(attempts, toolAttempted ? 1 : 0);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test('malformed session handles are rejected without calling the SDK', async () => {
  for (const session of ['', { sessionId: '' }, { sessionId: 42 }]) {
    const model = createClaudeAgentModel(config, { sdk: fakeSdk(() => { assert.fail('query started with malformed session'); }) });
    await assert.rejects(model({ system: '', messages: [], session }), /会话标识/);
  }
});

await test('missing API key still throws before any SDK session is created', async () => {
  const model = createClaudeAgentModel({ provider: 'anthropic' }, { sdk: fakeSdk(() => { assert.fail('query started without API key'); }) });
  await assert.rejects(model({ system: '', messages: [] }), /ANTHROPIC_API_KEY/);
});

await test('noninteractive SDK pre-tool guard accepts only exact registered names and valid input objects', async () => {
  const model = createClaudeAgentModel(config, { sdk: fakeSdk(({ options }) => (async function* () {
    assert.equal(options.permissionPrompts, 'none');
    assert.ok(options.hooks?.PreToolUse?.length, 'the noninteractive runtime needs a registered PreToolUse guard');
    assert.equal(options.canUseTool, undefined, 'none never invokes the prompt callback');
    assert.deepEqual(options.allowedTools, ['mcp__career__search_jobs']);
    assert.deepEqual(options.tools, []);
    assert.equal(await preToolDecision(options, 'mcp__career__search_jobs', { query: '项目' }), 'allow');
    for (const name of ['mcp__career__unknown', 'mcp__other__search_jobs', 'search_jobs', 'Bash', 'PowerShell', 'Read', 'Write', 'Agent', 'Task', 'Skill']) {
      assert.equal(await preToolDecision(options, name, {}), 'deny', name);
    }
    for (const input of [null, [], 'query', 42]) assert.equal(await preToolDecision(options, 'mcp__career__search_jobs', input), 'deny');
    yield { type: 'result', subtype: 'success', result: '已核对权限' };
  })()) });
  await model.runTools({ system: '', messages: [], tools: [{ name: 'search_jobs', input_schema: { properties: { query: { type: 'string' } }, required: ['query'] } }], execute: async () => ({}) }).catch(error => {
    if (error.cause?.code === 'ERR_ASSERTION') throw error.cause;
    throw error;
  });
});

await test('pre-tool guard denies otherwise allowed tools after callback or turn cancellation', async () => {
  const model = createClaudeAgentModel(config, { sdk: fakeSdk(({ options }) => (async function* () {
    const callback = new AbortController(); callback.abort();
    assert.equal(await preToolDecision(options, 'mcp__career__search_jobs', {}, callback.signal), 'deny');
    options.abortController.abort();
    assert.equal(await preToolDecision(options, 'mcp__career__search_jobs', {}), 'deny');
    yield { type: 'result', subtype: 'success', result: '不会执行' };
  })()) });
  await assert.rejects(model.runTools({ system: '', messages: [], tools: [{ name: 'search_jobs', input_schema: { properties: {} } }], execute: async () => assert.fail('cancelled guard must not execute') }), /abort|停止/i);
});

await test('installed MCP validates the adapter schema before execution and strips injected candidate selectors', async () => {
  const calls = [];
  const model = createClaudeAgentModel(config, { sdk: { ...installedSdk, query: ({ options }) => (async function* () {
    const server = options.mcpServers.career.instance;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'schema-audit', version: '1' });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      for (const input of [{}, { query: 42 }, { query: '项目', type: 'invalid' }]) {
        const result = await client.callTool({ name: 'search_candidate_knowledge', arguments: input });
        assert.equal(result.isError, true);
        assert.equal(calls.length, 0);
      }
      const result = await client.callTool({ name: 'search_candidate_knowledge', arguments: { query: '项目', type: 'project', candidate_id: 'foreign', candidateId: 'foreign', userId: 'foreign' } });
      assert.equal(result.isError, undefined);
      assert.deepEqual(calls, [['search_candidate_knowledge', { query: '项目', type: 'project' }]]);
    } finally {
      await client.close();
      await server.close();
    }
    yield { type: 'result', subtype: 'success', result: '参数已核对' };
  })() } });
  await model.runTools({ system: '', messages: [], tools: [{ name: 'search_candidate_knowledge', input_schema: { properties: { query: { type: 'string' }, type: { type: 'string', enum: ['project', 'education'] } }, required: ['query'], additionalProperties: false } }], execute: async (name, input) => { calls.push([name, input]); return { facts: [] }; } });
});

await test('installed MCP validates layout enum arrays before export execution', async () => {
  const calls = [];
  const model = createClaudeAgentModel(config, { sdk: { ...installedSdk, query: ({ options }) => (async function* () {
    const server = options.mcpServers.career.instance;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'layout-schema-audit', version: '1' });
    try {
      await server.connect(serverTransport); await client.connect(clientTransport);
      for (const section_order of ['projects', ['foreign'], Array(6).fill('projects')]) {
        assert.equal((await client.callTool({ name: 'export_resume', arguments: { format: 'pdf', section_order } })).isError, true);
        assert.equal(calls.length, 0);
      }
      const args = { format: 'pdf', section_order: ['projects', 'education'] };
      assert.equal((await client.callTool({ name: 'export_resume', arguments: args })).isError, undefined);
      assert.deepEqual(calls, [args]);
    } finally { await client.close(); await server.close(); }
    yield { type: 'result', subtype: 'success', result: '已验证布局参数' };
  })() } });
  await model.runTools({ messages: [], tools: [{ name: 'export_resume', input_schema: { properties: { format: { type: 'string', enum: ['pdf', 'docx'] }, section_order: { type: 'array', items: { type: 'string', enum: ['projects', 'education'] }, maxItems: 5 } }, required: ['format'] } }], execute: async (_name, args) => { calls.push(args); return { ok: true }; } });
});

await test('native SDK dispatches the pre-tool guard against a loopback-only synthetic provider', { timeout: 45_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sdk-native-guard-'));
  const dispatches = [], executions = [], requests = [];
  let turns = 0;
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) { response.writeHead(413).end(); return; }
    }
    let body;
    try { body = JSON.parse(raw || '{}'); } catch { response.writeHead(400).end(); return; }
    if (request.url?.startsWith('/v1/messages/count_tokens')) {
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ input_tokens: 100 })); return;
    }
    if (!request.url?.startsWith('/v1/messages')) { response.writeHead(404).end(); return; }
    requests.push({ tools: body.tools?.map(value => value.name) || [], messages: body.messages });
    if (++turns > 3) { response.writeHead(500).end(); return; }
    const block = turns === 1
      ? { type: 'tool_use', id: 'registered-call', name: 'mcp__career__search_candidate_knowledge', input: { query: '项目' } }
      : turns === 2 ? { type: 'tool_use', id: 'foreign-skill', name: 'Skill', input: { skill: 'foreign-unregistered-skill' } }
        : { type: 'text', text: '本机权限检查完成。' };
    const stopReason = block.type === 'tool_use' ? 'tool_use' : 'end_turn';
    const message = { id: `message-${turns}`, type: 'message', role: 'assistant', content: [block], model: body.model, stop_reason: stopReason, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } };
    if (!body.stream) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(message)); return; }
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const event = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    event('message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 100, output_tokens: 0 } } });
    event('content_block_start', { type: 'content_block_start', index: 0, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } });
    event('content_block_delta', { type: 'content_block_delta', index: 0, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
    event('content_block_stop', { type: 'content_block_stop', index: 0 });
    event('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } });
    event('message_stop', { type: 'message_stop' }); response.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const model = createClaudeAgentModel({ apiKey: 'synthetic-local-test-key', model: 'claude-sonnet-4-5', timeoutMs: 30_000, sessionDirectory: directory }, { sdk: { ...installedSdk,
      query: ({ prompt, options }) => {
        // Make a synthetic foreign Skill discoverable to the real native CLI.
        // Its SDK skill auto-allow rule must not override the application's
        // original four-Skill guard. This fixture exists only in isolated cwd.
        const foreignDirectory = path.join(options.cwd, '.claude', 'skills', 'foreign-unregistered-skill');
        mkdirSync(foreignDirectory, { recursive: true });
        writeFileSync(path.join(foreignDirectory, 'SKILL.md'), '---\nname: foreign-unregistered-skill\ndescription: Synthetic negative permission fixture\n---\nThis skill must never be loaded.\n');
        const matcher = options.hooks.PreToolUse[0];
        const hooks = matcher.hooks.map(hook => async (input, toolUseId, runtime) => {
          const result = await hook(input, toolUseId, runtime);
          dispatches.push({ name: input.tool_name, skill: input.tool_input?.skill, decision: result.hookSpecificOutput.permissionDecision });
          return result;
        });
        return installedSdk.query({ prompt, options: { ...options, skills: [...options.skills, 'foreign-unregistered-skill'], hooks: { ...options.hooks, PreToolUse: [{ ...matcher, hooks }] },
          env: { ...options.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, ANTHROPIC_MODEL: 'claude-sonnet-4-5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-5', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-5', ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-sonnet-4-5', DISABLE_PROMPT_CACHING: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } } });
      } } });
    const result = await model.runTools({ system: '只执行模拟接口返回的求职工具。', messages: [{ role: 'user', content: '核对本机权限。' }], session: { scope },
      tools: [{ name: 'search_candidate_knowledge', description: '本机只读测试', input_schema: { properties: { query: { type: 'string' } }, required: ['query'] } }],
      execute: async (name, input) => { executions.push([name, input]); return { facts: [] }; } });
    assert.equal(result.content[0].text, '本机权限检查完成。');
    assert.deepEqual(executions, [['search_candidate_knowledge', { query: '项目' }]]);
    assert.ok(dispatches.some(value => value.name === 'mcp__career__search_candidate_knowledge' && value.decision === 'allow'));
    assert.ok(dispatches.some(value => value.name === 'Skill' && value.skill === 'foreign-unregistered-skill' && value.decision === 'deny'));
    assert.equal(turns, 3);
    assert.ok(requests[0].tools.includes('mcp__career__search_candidate_knowledge'));
    assert.ok(requests[0].tools.includes('Skill'));
    const toolResults = requests.flatMap(value => value.messages || []).flatMap(value => Array.isArray(value.content) ? value.content : []).filter(value => value.type === 'tool_result');
    assert.ok(toolResults.some(value => value.tool_use_id === 'registered-call' && !value.is_error));
    assert.ok(toolResults.some(value => value.tool_use_id === 'foreign-skill' && value.is_error));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
