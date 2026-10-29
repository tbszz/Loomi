import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { createDatabase } from './database.js';

await test('knowledge HTTP search uses the same scoped hybrid provider as the Agent', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'app-semantic-'));
  const database = createDatabase({ filename: path.join(dir, 'state.sqlite') });
  const calls = [];
  const provider = { id: 'synthetic-http-fixture', embed: async ({ texts, purpose, signal }) => {
    assert.ok(signal);
    calls.push({ texts, purpose });
    return texts.map(() => [1, 0]);
  } };
  const server = createApp({ database, dataDir: dir, embeddingProvider: provider }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const registration = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Fixture', email: 'semantic@example.test', password: 'A-secure-passphrase-42' }) });
    assert.equal(registration.status, 200);
    const cookie = registration.headers.get('set-cookie').split(';')[0];
    const owner = database.raw.prepare('SELECT id FROM users WHERE email = ?').get('semantic@example.test').id;
    const candidate = database.createCandidate(owner, 'Fixture');
    database.saveConversation(owner, { id: 't', candidateId: candidate.id, messages: [], context: {} });
    const text = 'React 构建交互页面';
    const doc = database.saveDocument(owner, { id: 'd', conversationId: 't', candidateId: candidate.id, name: 'fixture.txt', mimeType: 'text/plain', text });
    database.saveCandidateMaterial(owner, candidate.id, doc, [{ id: 'f', type: 'project', value: text, sourceQuote: text, sourcePosition: 0, status: 'user_asserted', confidence: .9 }], [{ id: 'c', text, start: 0, end: text.length }]);
    const response = await fetch(`${base}/api/candidates/${candidate.id}/knowledge?q=front-end%20framework`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.coverage?.semantic?.status, 'success');
    assert.equal(result.facts[0]?.id, 'f');
    assert.equal(result.facts[0]?.sourceId, 'd');
    assert.equal(result.chunks[0]?.id, 'c');
    assert.ok(calls.some(call => call.purpose === 'query'));
    const foreign = database.createUser({ email: 'other-semantic@example.test', name: 'Other', passwordHash: 'fixture' });
    const forbidden = database.createCandidate(foreign.id, 'Private');
    const count = calls.length;
    const denied = await fetch(`${base}/api/candidates/${forbidden.id}/knowledge?q=React`, { headers: { Cookie: cookie } });
    assert.equal(denied.status, 404);
    assert.equal(calls.length, count);
  } finally {
    await new Promise(resolve => server.close(resolve));
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
