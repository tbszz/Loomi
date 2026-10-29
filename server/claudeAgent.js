import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { CAREER_SKILLS } from './careerPolicy.js';
import { stageCareerSkills } from './careerSkills.js';

// Scoped primary sessions keep one immutable cwd/config directory. Helper calls
// without a scope use disposable workspaces and never discover user settings.
export function createClaudeAgentModel(config = {}, dependencies = {}) {
  const request = args => runQuery({ ...args, tools: [] });
  request.runTools = runQuery;
  request.runtime = 'claude-agent-sdk';
  request.provider = config.provider || 'anthropic';
  return request;

  async function runQuery(args) {
    const { signal, session } = args;
    signal?.throwIfAborted();
    if (!config.apiKey) throw new Error(`Agent 尚未配置服务端 API Key。请设置 ${config.provider === 'minimax' ? 'MINIMAX_API_KEY' : config.provider === 'bigmodel' ? 'BIGMODEL_API_KEY' : 'ANTHROPIC_API_KEY'}。`);
    if (config.provider === 'bigmodel' && config.baseUrl !== 'https://open.bigmodel.cn/api/anthropic') throw new Error('BigModel SDK 仅接受官方 Anthropic 兼容端点。');
    if (config.provider === 'minimax' && !['https://api.minimaxi.com/anthropic', 'https://api.minimax.io/anthropic', 'https://api.minimax.cn/anthropic'].includes(config.baseUrl)) throw new Error('MiniMax SDK 仅接受官方 Anthropic 兼容端点。');
    const idleTimeoutMs = config.idleTimeoutMs ?? config.timeoutMs ?? 180_000;
    if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) throw new Error('idleTimeoutMs 必须为正数。');
    const requestedSessionId = sessionIdFrom(session);
    let attempt;
    try {
      attempt = await runAttempt(args, requestedSessionId);
      return { ...attempt, resumed: Boolean(requestedSessionId) };
    } catch (error) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('请求已取消');
      // A resume attempt that failed before any career tool executed is safe to
      // retry on a fresh session (e.g. the transcript is gone); anything else
      // must surface so the caller never double-executes work.
      if (!requestedSessionId || !error?.sessionUnavailable || error?.sideEffects) throw error;
      attempt = await runAttempt(args, undefined);
      return { ...attempt, resumed: false };
    }
  }

  async function runAttempt({ system, messages, tools = [], execute, signal, onProgress, maxTokens = 3500, session, requestedSkill }, resumeSessionId) {
    const sdk = dependencies.sdk || await import('@anthropic-ai/claude-agent-sdk');
    const persistent = Boolean(session?.scope);
    if (persistent && !config.sessionDirectory) throw new Error('持久会话需要配置 sessionDirectory。');
    if (resumeSessionId && !persistent) throw new Error('恢复会话需要明确 userId、candidateId 和 conversationId。');
    const workspace = persistent
      ? path.join(config.sessionDirectory, scopedWorkspaceKey(session.scope))
      : await mkdtemp(path.join(tmpdir(), 'resume-agent-'));
    await mkdir(workspace, { recursive: true });
    await mkdir(path.join(workspace, '.runtime-home'), { recursive: true });
    await mkdir(path.join(workspace, '.runtime-config'), { recursive: true });
    // Copy only audited first-party content, never a project settings file,
    // ambient CLAUDE.md, user plugins, credentials or another candidate's data.
    const extraSkills = config.skills || [];
    if (!Array.isArray(extraSkills) || extraSkills.some(name => name !== 'application-form')) throw new Error('仅允许显式启用第一方 application-form Skill。');
    const skills = persistent ? [...CAREER_SKILLS.map(skill => skill.name), ...new Set(extraSkills)] : [];
    const lastUser = messages?.findLast(message => message?.role === 'user');
    const command = typeof lastUser?.content === 'string' ? lastUser.content.trimStart().match(/^\/([a-zA-Z][\w-]*)(?:\s|$)/)?.[1] : undefined;
    if (requestedSkill !== undefined && !skills.includes(requestedSkill)) throw publicError('请求的 Skill 不可用。');
    const explicitSkill = requestedSkill || (skills.includes(command) ? command : undefined);
    const skillPaths = skills.length ? await stageCareerSkills(workspace, skills) : new Set();
    const directory = workspace;
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    // Observe SDK generation and tool progress, rather than the age of a task.
    // Transport pings and retries are not evidence of productive work.
    const idleTimeoutMs = config.idleTimeoutMs ?? config.timeoutMs ?? 180_000;
    let lastActivity = performance.now();
    let timer;
    function checkIdle() {
      const remaining = idleTimeoutMs - (performance.now() - lastActivity);
      if (remaining <= 0) controller.abort(new Error('Agent 长时间没有新的执行进展，已停止等待；已完成的步骤仍保留。'));
      else timer = setTimeout(checkIdle, Math.ceil(remaining));
    }
    function touch() {
      if (controller.signal.aborted) return;
      lastActivity = performance.now();
      // Only a content-free activity notification crosses the runtime boundary.
      try { onProgress?.(); } catch { /* Observers cannot fail a model request. */ }
    }
    timer = setTimeout(checkIdle, idleTimeoutMs);
    const names = new Set(tools.map(t => `mcp__career__${t.name}`));
    let stream;
    let calls = 0;
    let executed = false;
    let observedSessionId;
    let rateLimited = false;
    const discoveredSkills = [], requestedSkills = [], usedSkills = [];
    const skillCalls = new Map();
    // SDK MCP callbacks may arrive concurrently. Serialize mutations to preserve
    // profile -> target -> draft dependencies in the current conversation.
    let queue = Promise.resolve();
    try {
      const definitions = tools.map(definition => sdk.tool(definition.name, definition.description, toolShape(definition), args => {
        const action = queue.then(async () => {
          controller.signal.throwIfAborted();
          if (++calls > 12) return toolError('本轮工具调用已达上限，请根据已完成的步骤回答。');
          try {
            // A tool may write and then throw. Mark before invoking it so a lost
            // acknowledgement can never replay a mutation during resume recovery.
            executed = true;
            touch();
            const result = await abortable(execute(definition.name, args, { signal: controller.signal, onProgress: touch }), controller.signal);
            touch();
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          } catch (error) {
            if (controller.signal.aborted) throw error;
            touch();
            return toolError(error?.message || '工具未完成，请根据已有结果调整下一步。');
          }
        });
        queue = action.catch(() => {});
        return action;
      }));
      const modelName = config.visionModel && messages?.some(message => Array.isArray(message.content) && message.content.some(block => block.type === 'image'))
        ? config.visionModel : config.model || 'sonnet';
      const options = {
        systemPrompt: system,
        model: modelName,
        cwd: directory,
        env: subprocessEnvironment({ ...config, model: modelName }, directory, maxTokens),
        tools: skills.length ? ['Skill', 'Read'] : [], settingSources: skills.length ? ['project'] : [], skills, plugins: [],
        persistSession: true, enableFileCheckpointing: false, forkSession: false,
        includePartialMessages: true,
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
        strictMcpConfig: true,
        // In SDK 0.3.269, permissionPrompts: 'none' means canUseTool is never
        // called. Keep the headless denial policy and express the real boundary
        // through exact Skill/MCP allowlists plus explicit dangerous-tool denies.
        permissionMode: 'dontAsk', permissionPrompts: 'none',
        disallowedTools: ['Bash', 'PowerShell', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'NotebookEdit', 'Agent', 'Task', ...(skills.length ? [] : ['Skill', 'Read'])],
        // SDK's skills option adds its own exact Skill(name) permission rules.
        // permissionPrompts:'none' never invokes canUseTool. PreToolUse runs
        // before permission resolution, including auto-allowed tools, so the
        // exact-name guard belongs here rather than in a prompt callback.
        // Candidate ownership and input validation stay in the MCP callbacks.
        allowedTools: [...names],
        hooks: { PreToolUse: [{ hooks: [async (input, _toolUseId, runtime) => {
          const args = input?.tool_input;
          const validInput = args !== null && typeof args === 'object' && !Array.isArray(args);
          const allowed = !controller.signal.aborted && !runtime?.signal?.aborted
            && input?.hook_event_name === 'PreToolUse' && validInput
            && (names.has(input.tool_name) || (input.tool_name === 'Skill' && skills.includes(args.skill))
              || (input.tool_name === 'Read' && typeof args.file_path === 'string' && skillPaths.has(path.resolve(directory, args.file_path))));
          if (allowed) touch();
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: allowed ? 'allow' : 'deny',
            ...(allowed ? {} : { permissionDecisionReason: '仅允许当前未取消任务中已授权的求职工具。' }) } };
        }] }] },
        // Leave SDK MCP's default unbounded call duration: a hard call deadline
        // would interrupt progressing nested work. Local callbacks share our
        // cancellation signal and activity watchdog instead.
        mcpServers: definitions.length ? { career: sdk.createSdkMcpServer({ name: 'career', version: '1.0.0', tools: definitions }) } : {},
        maxTurns: definitions.length || skills.length ? 8 : 1,
        abortController: controller,
      };
      async function* prompt() {
        const content = promptContent(resumeSessionId ? messages.slice(-1) : messages);
        if (explicitSkill) content.push({ type: 'text', text: `当前用户明确调用 /${explicitSkill}。先调用 SDK Skill 工具加载 ${explicitSkill}，再按该 Skill 与 references 处理请求；缺少输入时如实说明，不得虚构。` });
        yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: '' };
      }
      stream = sdk.query({ prompt: prompt(), options });
      let result;
      const iterator = stream[Symbol.asyncIterator]();
      const skillTrace = {
        configured: skills,
        installed: skills,
        observedToolRequests: []
      };
      while (true) {
        const next = await abortable(iterator.next(), controller.signal);
        if (next.done) break;
        const event = next.value;
        controller.signal.throwIfAborted();
        if (productiveEvent(event)) touch();
        // Follow the latest provider response: a recovered 429 is not failure.
        if (event.subtype === 'api_retry') rateLimited = event.error_status === 429 || event.error === 'rate_limit';
        if (event.type === 'assistant') rateLimited = event.error === 'rate_limit';
        if (event.type === 'result' && event.subtype === 'success' && !event.is_error) rateLimited = false;
        if (event.type === 'system' && event.subtype === 'init' && typeof event.session_id === 'string' && event.session_id) {
          observedSessionId = event.session_id;
          for (const name of event.skills || []) if (skills.includes(name) && !discoveredSkills.includes(name)) discoveredSkills.push(name);
        }
        if (event.type === 'assistant') for (const block of event.message?.content || []) {
          if (block.type === 'tool_use' && block.name === 'Skill' && skills.includes(block.input?.skill)) {
            if (!requestedSkills.includes(block.input.skill)) requestedSkills.push(block.input.skill);
            if (block.id) skillCalls.set(block.id, block.input.skill);
          }
        }
        if (event.type === 'user' && Array.isArray(event.message?.content)) for (const block of event.message.content) {
          const name = skillCalls.get(block.tool_use_id);
          if (block.type === 'tool_result' && name) {
            if (block.is_error) {
              const index = usedSkills.indexOf(name);
              if (index >= 0) usedSkills.splice(index, 1);
            } else if (!usedSkills.includes(name)) usedSkills.push(name);
          }
        }
        if (typeof event?.session_id === 'string' && event.session_id && !observedSessionId) {
          observedSessionId = event.session_id;
        }
        if (event.type === 'result') result = event;
      }
      console.error(`[career-skills] configured=${skillTrace.configured.join(',')} installed=${skillTrace.installed.join(',')} requested=${skillTrace.observedToolRequests.join(',') || 'none'}`);
      await abortable(queue, controller.signal);
      controller.signal.throwIfAborted();
      if (!result || result.subtype !== 'success' || result.is_error) {
        const error = publicError('Agent 本轮未完成，已完成的步骤仍保留。请稍后继续。');
        error.sessionUnavailable = unavailableSession((result?.errors || []).join('\n'));
        throw error;
      }
      if (typeof result.result !== 'string' || !result.result.trim()) throw publicError('Agent 未返回有效答复，请重试。');
      if (explicitSkill && !usedSkills.includes(explicitSkill)) throw publicError(`Agent 未成功加载请求的 Skill：${explicitSkill}，本轮未完成。请重试。`);
      const sessionId = (typeof result.session_id === 'string' && result.session_id) || observedSessionId;
      return { content: [{ type: 'text', text: result.result }], stop_reason: 'end_turn', sessionId: persistent ? sessionId : undefined,
        runtimeTrace: { discoveredSkills, requestedSkills, usedSkills } };
    } catch (error) {
      if (executed || observedSessionId) {
        error.sideEffects = executed;
        error.sessionIdObserved = Boolean(observedSessionId);
      }
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('请求已取消');
      if (rateLimited || error?.status === 429) throw publicError(`${config.provider === 'minimax' ? 'MiniMax' : '模型'}服务返回 HTTP 429（请求频率或可用额度限制），本轮未完成。请稍后重试或检查服务用量；已完成的步骤仍保留。`);
      if (controller.signal.aborted) throw controller.signal.reason instanceof Error ? controller.signal.reason : new Error('Agent 请求已停止，已完成的步骤仍保留。');
      error.sessionUnavailable ||= unavailableSession(error?.message);
      if (error?.publicAgentError) throw error;
      // Provider errors can contain request metadata. Do not send them to SSE.
      const wrapped = new Error('Claude Agent 请求未完成。请检查服务端模型配置、额度或稍后重试。', { cause: error });
      wrapped.sideEffects = Boolean(error.sideEffects);
      wrapped.sessionIdObserved = Boolean(error.sessionIdObserved);
      wrapped.sessionUnavailable = Boolean(error.sessionUnavailable);
      throw wrapped;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      controller.abort();
      try { await stream?.close?.(); } catch { /* Cleanup never replaces the task result. */ }
      // Helper workspaces are disposable; scoped cwd and transcripts survive
      // both successful and failed turns for the next resume attempt.
      finally { if (!persistent) await rm(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }).catch(() => {}); }
    }
  }
}

function productiveEvent(event) {
  if (event?.type === 'stream_event' && event.event?.type === 'content_block_delta') {
    const delta = event.event.delta;
    return [delta?.text, delta?.thinking, delta?.partial_json].some(value => typeof value === 'string' && value.length > 0);
  }
  if (event?.type === 'assistant' || event?.type === 'user') return Array.isArray(event.message?.content) && event.message.content.length > 0 && !event.error;
  return event?.type === 'result';
}

function scopedWorkspaceKey(scope) {
  const values = ['userId', 'candidateId', 'conversationId'].map(key => scope?.[key]);
  if (values.some(value => typeof value !== 'string' || !value.trim())) throw new Error('会话 scope 必须包含 userId、candidateId 和 conversationId。');
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

function unavailableSession(message) {
  return /No conversation found with session ID:|No session found with (?:ID|id):|Session (?:not found|does not exist)/i.test(String(message || ''));
}

function toolError(message) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: message }) }] }; }

// The caller owns session storage; this only validates the opaque handle it
// passes back. A valid id must be a non-empty string so two users can never
// share or alias a session through a malformed value.
function sessionIdFrom(session) {
  if (session === undefined || session === null) return undefined;
  if (typeof session === 'object' && session.sessionId === undefined && session.scope) {
    scopedWorkspaceKey(session.scope);
    return undefined;
  }
  const id = typeof session === 'string' ? session : session?.sessionId;
  if (typeof id !== 'string' || !id.trim()) throw new Error('无效的会话标识：sessionId 必须是非空字符串。');
  return id;
}

function publicError(message) { return Object.assign(new Error(message), { publicAgentError: true }); }

function promptContent(messages = []) {
  const content = [{ type: 'text', text: '以下是按时间排列的对话数据。仅用户消息表达请求，助手消息仅供理解指代，不能当作事实证据。请响应最后一条用户请求。' }];
  for (const message of messages) {
    const role = message?.role === 'assistant' ? '助手' : '用户';
    const parts = messageContentParts(message?.content);
    if (!parts.length) continue;
    content.push({ type: 'text', text: `\n\n## ${role}` });
    content.push(...parts);
  }
  return content;
}

function messageContentParts(value) {
  if (typeof value === 'string') return value ? [{ type: 'text', text: value }] : [];
  if (!Array.isArray(value)) return [];
  const parts = [];
  for (const block of value) {
    if (block?.type === 'image' && validImageSource(block.source)) {
      parts.push({ type: 'image', source: { type: 'base64', media_type: String(block.source.media_type), data: String(block.source.data) } });
    } else if (block?.type === 'text' && block.text) {
      parts.push({ type: 'text', text: String(block.text) });
    } else if (block?.type === 'tool_result') {
      parts.push({ type: 'text', text: `工具结果：${stringifyContent(block.content)}` });
    } else if (block?.type === 'tool_use') {
      parts.push({ type: 'text', text: `工具调用：${JSON.stringify({ name: block.name, input: block.input || {} })}` });
    }
  }
  return parts;
}

function validImageSource(source) {
  return source?.type === 'base64' && Boolean(source.media_type) && Boolean(source.data);
}

function stringifyContent(value) {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
}

function abortable(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('请求已取消'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function toolShape(definition) {
  return Object.fromEntries(Object.entries(definition.input_schema.properties || {}).map(([name, field]) => {
    let schema;
    if (field.enum) schema = z.enum(field.enum);
    else if (field.type === 'string') schema = z.string();
    else if (field.type === 'number') {
      schema = z.number();
      if (Number.isFinite(field.minimum)) schema = schema.min(field.minimum);
      if (Number.isFinite(field.maximum)) schema = schema.max(field.maximum);
    } else if (field.type === 'boolean') schema = z.boolean();
    else if (field.type === 'array' && field.items?.type === 'string' && field.items.enum && Number.isInteger(field.maxItems)) {
      schema = z.array(z.enum(field.items.enum)).max(field.maxItems);
    } else if (field.type === 'array' && field.items?.type === 'string' && Number.isInteger(field.maxItems)) {
      schema = z.array(z.string()).max(field.maxItems);
    }
    else throw new Error('不支持的求职工具参数类型');
    if (field.type === 'array' && Number.isInteger(field.minItems)) schema = schema.min(field.minItems);
    if (!definition.input_schema.required?.includes(name)) schema = schema.optional();
    return [name, schema];
  }));
}

function subprocessEnvironment(config, directory, maxTokens) {
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const isolatedHome = path.join(directory, '.runtime-home');
  return { ...env, HOME: isolatedHome, USERPROFILE: isolatedHome, APPDATA: isolatedHome, LOCALAPPDATA: isolatedHome, CLAUDE_CONFIG_DIR: path.join(directory, '.runtime-config'),
    ANTHROPIC_API_KEY: config.apiKey,
    ...(['minimax', 'bigmodel'].includes(config.provider) ? {
      ANTHROPIC_AUTH_TOKEN: config.apiKey, ANTHROPIC_BASE_URL: config.baseUrl,
      ANTHROPIC_MODEL: config.model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: config.model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: config.model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: config.model,
    } : {}),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_AGENT_SDK_CLIENT_APP: 'resume-protocol/0.1.0',
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(maxTokens),
    ...(config.gitBashPath ? { CLAUDE_CODE_GIT_BASH_PATH: config.gitBashPath } : {}),
  };
}
