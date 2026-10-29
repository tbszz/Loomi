import express from 'express';
import { createApplicationProfiles } from './applicationProfile.js';
import { createApplicationBrowser } from './applicationForms.js';
import { prepareApplicationAnswers } from './applicationAnswers.js';
import { listApplicationAttachments, prepareApplicationAttachments } from './applicationAttachments.js';

export function createApplicationRouter({ database, dataDir, browserService, answerModel, decisionClient } = {}) {
  if (!database || !dataDir) throw new Error('申请服务需要数据库和本地资料目录。');
  const profiles = createApplicationProfiles({ dataDir });
  const browser = browserService || createApplicationBrowser({ dataDir });
  const scans = new Map();
  const mutations = new Set();
  const scopeKey = scope => JSON.stringify([scope.userId, scope.candidateId, scope.conversationId]);
  const requireScope = scope => {
    const conversation = database.getConversation(scope?.userId, scope?.conversationId);
    if (!conversation || conversation.candidateId !== scope?.candidateId || !database.getCandidate(scope.userId, scope.candidateId)) throw Object.assign(new Error('网申会话不存在或不属于当前求职者。'), { status: 404 });
    return scope;
  };
  const mutate = async (scope, action) => {
    requireScope(scope);
    const key = JSON.stringify([scope.userId, scope.candidateId]);
    if (mutations.has(key)) throw new Error('网申操作进行中，请完成后再修改资料或网页。');
    mutations.add(key);
    try { return await action(); } finally { mutations.delete(key); }
  };
  const takeScan = async scope => {
    const scan = await browser.scan(scope);
    scans.set(scopeKey(scope), scan);
    return scan;
  };
  const service = {
    status(scope) { requireScope(scope); return browser.status(scope); },
    async start(scope, input = {}) { return mutate(scope, () => browser.start(scope, { url: input.url })); },
    async tabs(scope) { requireScope(scope); return browser.tabs(scope); },
    async selectTab(scope, input) { return mutate(scope, () => { scans.delete(scopeKey(scope)); return browser.selectTab(scope, input); }); },
    async scan(scope) {
      return mutate(scope, () => takeScan(scope));
    },
    async ensureRows(scope, { signal } = {}) {
      return mutate(scope, async () => {
        signal?.throwIfAborted();
        if (!browser.ensureRows) return { added: 0, pending: 1, results: [{ status: 'unsupported' }] };
        const profile = await profiles.read(scope);
        const records = Object.fromEntries(['education','employment','projects','awards','campusLeadership'].map(family => [family, profile[family]?.length || 0]));
        const result = await browser.ensureRows(scope, { records, signal, validateScope: () => { requireScope(scope); return true; } });
        scans.delete(scopeKey(scope));
        return result;
      });
    },
    attachments(scope) { requireScope(scope); return { documents: listApplicationAttachments(database, scope) }; },
    async fill(scope, { scanId, signal, drafts, attachments = [] } = {}) {
      return mutate(scope, async () => {
      signal?.throwIfAborted();
      if (!Array.isArray(attachments) || (attachments.length && !scanId)) throw new Error('网申附件选择需要当前页面扫描。');
      let scan = scans.get(scopeKey(scope));
      if (!scanId) scan = await takeScan(scope);
      else if (!scan || scan.scanId !== scanId) throw new Error('页面扫描已失效，请重新扫描。');
      const selected = await prepareApplicationAttachments({ database, dataDir, scope, fields: scan.fields, selections: attachments, signal });
      const profile = await profiles.read(scope);
      const facts = database.listCandidateFacts(scope.userId, scope.candidateId);
      const factSnapshots = new Map(facts.map(fact => [fact.id, factSnapshot(fact)]));
      const prepared = await prepareApplicationAnswers({ fields: scan.fields, profile, facts, answerModel, decisionClient, drafts, signal });
      const selectedFields = new Set([...selected.answers, ...selected.skipped].map(item => item.fieldId));
      prepared.skipped = prepared.skipped.filter(item => !selectedFields.has(item.fieldId));
      prepared.answers.push(...selected.answers);
      prepared.skipped.push(...selected.skipped);
      signal?.throwIfAborted();
      requireScope(scope);
      const validateAnswer = answer => {
        requireScope(scope);
        if (answer.source === 'selected_attachment') return selected.validateAnswer(answer);
        if (!answer.factIds?.length) return answer.source === 'application_profile';
        const current = new Map(database.listCandidateFacts(scope.userId, scope.candidateId)
          .filter(fact => ['verified','user_asserted'].includes(fact.status)).map(fact => [fact.id, factSnapshot(fact)]));
        return answer.factIds.every(id => factSnapshots.has(id) && current.get(id) === factSnapshots.get(id));
      };
      const validAnswers = prepared.answers.filter(answer => {
        if (validateAnswer(answer)) return true;
        prepared.skipped.push({ fieldId: answer.fieldId, status: 'missing_evidence' });
        return false;
      });
      const filled = await browser.fill(scope, { scanId: scan.scanId, answers: validAnswers, signal, validateAnswer });
      const results = [...filled.results, ...prepared.skipped];
      return { ...filled, results, selectedAttachments: results.filter(item => item.status === 'attachment_selected').length, uploadedAttachments: results.filter(item => item.status === 'attachment_uploaded').length, preserved: results.filter(item => item.status === 'preserved').length, pending: results.filter(item => !['filled','preserved','attachment_uploaded'].includes(item.status)).length, decisionRuntime: prepared.decisionRuntime, realJevCalled: prepared.realJevCalled, decisionStatus: prepared.decisionStatus, decisions: prepared.decisions };
      });
    },
    async close(scope) { return mutate(scope, () => { scans.delete(scopeKey(scope)); return browser.close(scope); }); },
    async readProfile(scope) { requireScope(scope); return profiles.publicRead(scope); },
    async saveProfile(scope, profile) { return mutate(scope, () => profiles.write(scope, profile)); }
  };
  const router = express.Router({ mergeParams: true });
  router.use((req, res, next) => {
    // No remote server browser can operate a user's local desktop. Also reject
    // reverse-proxied remote clients even if the proxy itself is loopback.
    if (!isLocalApplicationRequest(req)) return res.status(403).json({ error: '网申填写仅支持本机服务，请在本机打开应用。' });
    const conversation = database.getConversation(req.user?.id, req.params.id);
    if (!conversation?.candidateId || !database.getCandidate(req.user.id, conversation.candidateId)) return res.status(404).json({ error: '网申会话不存在。' });
    req.applicationScope = { userId: req.user.id, candidateId: conversation.candidateId, conversationId: conversation.id };
    next();
  });
  const route = handler => async (req, res) => {
    try { res.json(await handler(req, res)); }
    catch (error) {
      if (res.destroyed || res.writableEnded) return;
      res.status(error.status || 400).json({ error: publicApplicationError(error) });
    }
  };
  router.get('/status', route(req => service.status(req.applicationScope)));
  router.get('/tabs', route(req => service.tabs(req.applicationScope)));
  router.get('/attachments', route(req => service.attachments(req.applicationScope)));
  router.post('/start', route(req => service.start(req.applicationScope, { url: req.body?.url })));
  router.post('/tab', route(req => service.selectTab(req.applicationScope, { tabId: req.body?.tabId })));
  router.post('/scan', route(req => service.scan(req.applicationScope)));
  router.post('/rows', route(async (req, res) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', abort); res.once('close', onClose);
    try { return await service.ensureRows(req.applicationScope, { signal: controller.signal }); }
    finally { req.off('aborted', abort); res.off('close', onClose); }
  }));
  router.post('/fill', route(async (req, res) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const abortOnResponseClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.once('aborted', abort);
    res.once('close', abortOnResponseClose);
    try {
      return await service.fill(req.applicationScope, { scanId: req.body?.scanId, attachments: req.body?.attachments, signal: controller.signal });
    } finally {
      req.off('aborted', abort);
      res.off('close', abortOnResponseClose);
    }
  }));
  router.post('/close', route(req => service.close(req.applicationScope)));
  router.get('/profile', route(async req => ({ profile: await service.readProfile(req.applicationScope) })));
  router.post('/profile', route(async req => ({ profile: await service.saveProfile(req.applicationScope, req.body?.profile) })));
  return { router, service, profiles };
}

function factSnapshot(fact) {
  return JSON.stringify([fact.type, fact.value, fact.sourceType, fact.sourceId, fact.sourceQuote, fact.sourcePosition, fact.sourceMessageId]);
}

export function isLocalApplicationRequest(req) {
  const loopback = ['127.0.0.1','::1','::ffff:127.0.0.1'];
  const forwarded = (req.get('x-forwarded-for') || '').split(',').map(item => item.trim()).filter(Boolean);
  return loopback.includes(req.socket?.remoteAddress) && forwarded.every(value => loopback.includes(value));
}

function publicApplicationError(error) {
  // Exceptions from browser/OS/model providers can contain paths or raw values.
  // Only known application messages reach HTTP; Playwright messages never do.
  const message = String(error?.message || '');
  const publicPrefixes = ['网申','浏览器必须','当前网页','填写进行中','页面','所选网页','申请资料','申请字段','经历','只允许','请输入完整','未找到本机','异地意愿'];
  return publicPrefixes.some(prefix => message.startsWith(prefix)) ? message : '网申步骤未完成，已填写内容保留。请检查网页后重试。';
}
