import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { createDatabase } from './database.js';

await test('application composition binds Jev decisions to the owned profile and browser, not a second agent', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'app-jev-composition-'));
  const database = createDatabase({ filename: path.join(dir, 'state.sqlite') });
  try {
    const user = database.createUser({ email: 'jev@example.test', name: 'Synthetic', passwordHash: 'fixture' });
    const candidate = database.createCandidate(user.id, 'Synthetic');
    const conversation = database.saveConversation(user.id, { id: 't', candidateId: candidate.id, messages: [], context: {} });
    const scope = { userId: user.id, candidateId: candidate.id, conversationId: conversation.id };
    let calls = 0;
    const decisionClient = async input => { calls++; assert.ok(!JSON.stringify(input).includes('本科')); return { model: 'jev-fixture', answers: { field_0: { type: 'choice', choice: 'degree', confidence: .97, probabilities: { degree: .99, none: .01 } } } }; };
    const applicationBrowser = { scan: async () => ({ scanId: 'scan', fields: [{ id: 'f', label: '教育程度', type: 'text' }] }), fill: async (bound, { answers }) => { assert.deepEqual(bound, scope); assert.equal(answers[0]?.value, '本科'); return { results: [{ fieldId: 'f', status: 'filled' }], filled: 1 }; } };
    const app = createApp({ database, dataDir: dir, applicationBrowser, decisionClient });
    const service = app.locals.application.service;
    await service.saveProfile(scope, { degree: '本科' });
    await service.scan(scope);
    const result = await service.fill(scope, { scanId: 'scan' });
    assert.equal(calls, 1);
    assert.equal(result.realJevCalled, true);
    assert.equal(result.decisionStatus, 'succeeded');
  } finally { database.close(); await rm(dir, { recursive: true, force: true }); }
});
