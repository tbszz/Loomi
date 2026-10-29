import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { chromium } from 'playwright-core';
import { createDatabase } from './database.js';
import { createApplicationRouter } from './applicationRoutes.js';
import { createApplicationBrowser, findLocalBrowser } from './applicationForms.js';
import { prepareApplicationAttachments } from './applicationAttachments.js';

await test('explicit attachment selections traverse the owned API into blank native file fields only', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'application-attachments-'));
  const database = createDatabase({ filename: path.join(dir, 'db.sqlite') });
  const executablePath = findLocalBrowser();
  assert.ok(executablePath, 'Actual native file controls require a local browser');
  const browser = await chromium.launch({ executablePath, headless: true });
  let server;
  try {
    const user = database.createUser({ name: 'Fixture', email: 'attachment@example.test', passwordHash: 'fixture' });
    const other = database.createUser({ name: 'Other', email: 'other-attachment@example.test', passwordHash: 'fixture' });
    const candidate = database.createCandidate(user.id, 'Current');
    const foreign = database.createCandidate(user.id, 'Other candidate');
    const outsider = database.createCandidate(other.id, 'Other user');
    for (const [owner, person, id] of [[user, candidate, 't'], [user, foreign, 'foreign-t'], [other, outsider, 'other-t']]) {
      database.saveConversation(owner.id, { id, candidateId: person.id, messages: [], context: {} });
      database.saveDocument(owner.id, { id: `${id}-doc`, conversationId: id, name: `${id}.txt`, mimeType: 'text/plain', text: `private content ${id}` });
      await mkdir(path.join(dir, 'uploads', owner.id), { recursive: true });
      await writeFile(path.join(dir, 'uploads', owner.id, `${id}-doc`), `private content ${id}`);
    }
    const page = await browser.newPage();
    await page.route('https://recruit.example.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<form onsubmit="window.submits++;return false"><label>姓名<input name="name"></label><label>简历附件<input type="file" name="resume" accept=".txt"></label><label>证件附件<input type="file" name="identity" accept=".pdf"></label><button>提交</button></form><script>window.submits=0</script>' }));
    await page.goto('https://recruit.example.test/attachments');
    const scope = { userId: user.id, candidateId: candidate.id, conversationId: 't' };
    const driver = createApplicationBrowser({ pageProvider: async () => page });
    await driver.start(scope);
    const { router, service } = createApplicationRouter({ database, dataDir: dir, browserService: driver });
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: req.get('user') || user.id }; next(); });
    app.use('/api/conversations/:id/application', router);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/conversations/t/application`;
    const request = (route, data, headers = {}) => fetch(base + route, { headers: { 'Content-Type': 'application/json', ...headers }, ...(data ? { method: 'POST', body: JSON.stringify(data) } : {}) });
    const listedResponse = await request('/attachments');
    assert.equal(listedResponse.status, 200);
    const listed = await listedResponse.json();
    assert.deepEqual(listed.documents.map(doc => doc.id), ['t-doc']);
    assert.equal(JSON.stringify(listed).includes('private content'), false);
    assert.equal((await request('/attachments', null, { user: other.id })).status, 404);
    await service.saveProfile(scope, { name: 'Owned name' });
    const scan = await (await request('/scan', {})).json();
    const file = scan.fields.find(field => field.name === 'resume');
    const pdf = scan.fields.find(field => field.name === 'identity');
    const absent = await (await request('/fill', { scanId: scan.scanId })).json();
    assert.equal(absent.results.find(item => item.fieldId === file.id).status, 'attachment_required');
    assert.equal(await page.locator('[name=resume]').evaluate(node => node.files.length), 0);
    for (const selection of [{ fieldId: file.id, documentId: 'foreign-t-doc' }, { fieldId: file.id, documentId: 'other-t-doc' }, { fieldId: file.id, documentId: '../db.sqlite' }, { fieldId: 'stale-field', documentId: 't-doc' }, { fieldId: scan.fields.find(field => field.name === 'name').id, documentId: 't-doc' }]) {
      assert.equal((await request('/fill', { scanId: scan.scanId, attachments: [selection] })).status, 400);
      assert.equal(await page.locator('[name=resume]').evaluate(node => node.files.length), 0);
    }
    const mismatch = await (await request('/fill', { scanId: scan.scanId, attachments: [{ fieldId: pdf.id, documentId: 't-doc' }] })).json();
    assert.equal(mismatch.results.find(item => item.fieldId === pdf.id).status, 'attachment_mismatch');
    await page.route('**/upload-fails', route => route.fulfill({status:403,contentType:'application/json',body:'{"error":"rejected"}'}));
    await page.locator('[name=resume]').evaluate(node => node.addEventListener('change', async () => {
      const response = await fetch('/upload-fails',{method:'POST'});
      window.uploadRejected = response.status === 403;
    }));
    const filled = await (await request('/fill', { scanId: scan.scanId, attachments: [{ fieldId: file.id, documentId: 't-doc' }] })).json();
    await page.waitForFunction(() => window.uploadRejected === true);
    assert.equal(filled.results.find(item => item.fieldId === file.id).status, 'attachment_selected');
    assert.equal(filled.selectedAttachments, 1);
    assert.equal(filled.filled, 0);
    assert.equal(filled.pending, 2, 'the selected file still needs receipt confirmation alongside the missing identity attachment');
    assert.equal(await page.locator('[name=resume]').evaluate(node => node.files[0].text()), 'private content t');
    assert.equal(JSON.stringify(filled).includes('private content'), false);
    assert.equal(JSON.stringify(filled).includes('buffer'), false);
    const occupied = await (await request('/fill', { scanId: scan.scanId, attachments: [{ fieldId: file.id, documentId: 't-doc' }] })).json();
    assert.equal(occupied.results.find(item => item.fieldId === file.id).status, 'preserved');
    await page.locator('[name=resume]').setInputFiles([]);
    const fresh = await service.scan(scope);
    await page.locator('[name=resume]').setInputFiles({ name: 'user.txt', mimeType: 'text/plain', buffer: Buffer.from('user chosen after scan') });
    const raced = await service.fill(scope, { scanId: fresh.scanId, attachments: [{ fieldId: fresh.fields.find(field => field.name === 'resume').id, documentId: 't-doc' }] });
    assert.equal(raced.results.find(item => item.fieldId === fresh.fields.find(field => field.name === 'resume').id).status, 'preserved');
    assert.equal(await page.locator('[name=resume]').evaluate(node => node.files[0].text()), 'user chosen after scan');
    await page.locator('[name=resume]').setInputFiles([]);
    const changedScan = await service.scan(scope);
    await page.locator('[name=resume]').evaluate(node => { node.accept = '.pdf'; });
    const changed = await service.fill(scope, { scanId: changedScan.scanId, attachments: [{ fieldId: changedScan.fields.find(field => field.name === 'resume').id, documentId: 't-doc' }] });
    assert.equal(changed.results.find(item => item.fieldId === changedScan.fields.find(field => field.name === 'resume').id).status, 'changed');
    assert.equal(await page.locator('[name=resume]').evaluate(node => node.files.length), 0);
    for (const changeIdentity of [
      node => { node.closest('label').firstChild.textContent = '身份证明附件'; },
      node => { const previous = node.form; const next = document.createElement('form'); previous.replaceWith(next); next.append(...previous.childNodes); },
      node => { const row = document.createElement('fieldset'); node.closest('label').before(row); row.append(node.closest('label')); }
    ]) {
      await page.goto('https://recruit.example.test/attachments');
      const identityScan = await service.scan(scope);
      const id = identityScan.fields.find(field => field.name === 'resume').id;
      await page.locator('[name=resume]').evaluate(changeIdentity);
      const drifted = await service.fill(scope, { scanId: identityScan.scanId, attachments: [{ fieldId: id, documentId: 't-doc' }] });
      assert.equal(drifted.results.find(item => item.fieldId === id).status, 'changed', 'per-field selection cannot follow a reused control into a different purpose/form/row');
      assert.equal(await page.locator('[name=resume]').evaluate(node => node.files.length), 0);
    }
    assert.equal(await page.evaluate(() => window.submits), 0);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await browser.close(); database.close(); await rm(dir, { recursive: true, force: true });
  }
});

await test('owned API binds two proof attachments to their separate Jiandaoyun rows without claiming receipt', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'application-proof-api-'));
  const database = createDatabase({ filename: path.join(dir, 'db.sqlite') });
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
  assert.ok(executablePath);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const user = database.createUser({ name: 'Fixture', email: 'proof-api@example.test', passwordHash: 'fixture' });
    const candidate = database.createCandidate(user.id, 'Synthetic');
    database.saveConversation(user.id, { id: 'proof-thread', candidateId: candidate.id, messages: [], context: {} });
    await mkdir(path.join(dir, 'uploads', user.id), { recursive: true });
    for (const [id, bytes] of [['proof-a', 'synthetic award A'], ['proof-b', 'synthetic award B']]) {
      database.saveDocument(user.id, { id, conversationId: 'proof-thread', name: `${id}.txt`, mimeType: 'text/plain', text: bytes });
      await writeFile(path.join(dir, 'uploads', user.id, id), bytes);
    }
    const page = await browser.newPage();
    const rows = [0, 1].map(index => `<div class="fx-subform-row"><div class="subform-cell"><div class="fx-sub-field" data-widgetname="proof-${index}"><div class="field-component"><div class="fx-sub-select"><div class="select-container"><input class="select-input"><i class="icon-widget-upload"></i></div></div></div></div></div></div>`).join('');
    await page.route('https://fixture.jiandaoyun.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<div class="fx-external-form"><div class="fx-form"><div class="fx-field"><div class="field-label"><div class="field-name">获奖经历</div></div><div class="field-component"><div class="fx-subform"><div class="subform-head"><div class="subform-row"><div class="subform-cell"><div class="subform-title" title="获奖证明">获奖证明</div></div></div></div><div class="subform-content">${rows}</div></div></div></div></div></div><script>
      window.selected = []; window.submits = 0;
      document.querySelectorAll('.select-container').forEach((target,index) => target.addEventListener('click', () => {
        document.querySelectorAll('.x-popup.x-popover').forEach(node => node.remove());
        const popup = document.createElement('div'); popup.className = 'x-popup placement-bottom-left x-popover x-popover-content';
        popup.innerHTML = '<input type="file" class="x-upload-input" accept=".txt"><div class="upload-area-text">单个2MB以内</div>';
        popup.querySelector('input').addEventListener('change', event => {
          window.selected.push({row:index,name:event.target.files[0].name});
          const item = document.createElement('div'); item.className = 'file-item'; item.textContent = event.target.files[0].name;
          target.closest('.fx-sub-select').append(item);
        }); document.body.append(popup);
      }));
    </script>` }));
    await page.goto('https://fixture.jiandaoyun.com/form');
    const scope = { userId: user.id, candidateId: candidate.id, conversationId: 'proof-thread' };
    const driver = createApplicationBrowser({ pageProvider: async () => page });
    await driver.start(scope);
    const { service } = createApplicationRouter({ database, dataDir: dir, browserService: driver });
    const scan = await service.scan(scope);
    assert.equal(scan.fields.length, 2);
    assert.ok(scan.fields.every(field => field.type === 'file' && !field.unsupported), JSON.stringify(scan.fields));
    assert.equal(await page.locator('.x-popup').count(), 0, 'scanning cannot open upload controls');
    const selections = scan.fields.map((field,index) => ({ fieldId: field.id, documentId: index ? 'proof-b' : 'proof-a' }));
    const result = await service.fill(scope, { scanId: scan.scanId, attachments: selections });
    assert.deepEqual(result.results.map(item => item.status), ['attachment_selected', 'attachment_selected']);
    assert.equal(result.filled, 0);
    assert.equal(result.selectedAttachments, 2);
    assert.equal(result.pending, 2);
    assert.deepEqual(await page.evaluate(() => window.selected), [{row:0,name:'proof-a.txt'},{row:1,name:'proof-b.txt'}]);
    assert.equal(JSON.stringify(result).includes('synthetic award'), false);
    const repeated = await service.fill(scope, { scanId: scan.scanId, attachments: selections });
    assert.deepEqual(repeated.results.map(item => item.status), ['preserved', 'preserved']);
    assert.equal(await page.evaluate(() => window.selected.length), 2);
  } finally {
    await browser.close(); database.close();
    const resolved = path.resolve(dir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('application-proof-api-'));
    await rm(resolved, { recursive: true, force: true });
  }
});

await test('selected attachment snapshots reject revoked sources and changed bytes before browser writes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'application-attachment-revoke-'));
  const scope = { userId: 'owner', candidateId: 'candidate', conversationId: 'thread' };
  const original = { id: 'doc', candidateId: 'candidate', conversationId: 'thread', name: 'resume.txt', mimeType: 'text/plain' };
  let docs = [original], change = () => {};
  const database = { getConversation: () => ({ id: 'thread', candidateId: 'candidate' }), getCandidate: () => ({ id: 'candidate' }), listCandidateFacts: () => [], listDocuments: () => docs };
  const fields = [{ id: 'file', type: 'file', label: '简历附件', accept: '.txt' }, { id: 'degree', type: 'text', label: '教育程度' }];
  let fileWrites = 0;
  const driver = { scan: async () => ({ scanId: 's', fields }), fill: async (_scope, { answers, validateAnswer }) => {
    const results = answers.map(answer => {
      const valid = validateAnswer(answer);
      if (valid && answer.attachment) fileWrites++;
      return { fieldId: answer.fieldId, status: valid ? 'filled' : 'missing_evidence' };
    });
    return { results, filled: results.filter(item => item.status === 'filled').length };
  } };
  const decisionClient = async () => { await change(); return { model: 'jev-fixture', answers: { field_0: { type: 'choice', choice: 'degree', confidence: .99, probabilities: { degree: .99, none: .01 } } } }; };
  try {
    await mkdir(path.join(dir, 'uploads', 'owner'), { recursive: true });
    const filename = path.join(dir, 'uploads', 'owner', 'doc');
    const { service } = createApplicationRouter({ database, dataDir: dir, browserService: driver, decisionClient });
    await service.saveProfile(scope, { degree: '本科' });
    for (const revoke of [() => { docs = []; }, () => { docs = [{ ...original, candidateId: 'another' }]; }, () => { docs = [{ ...original, name: 'replaced.txt' }]; }, async () => { await writeFile(filename, 'new bytes after read, before write'); }]) {
      docs = [original]; await writeFile(filename, 'original bytes'); change = revoke;
      await service.scan(scope);
      const result = await service.fill(scope, { scanId: 's', attachments: [{ fieldId: 'file', documentId: 'doc' }] });
      assert.equal(result.results.find(item => item.fieldId === 'file').status, 'missing_evidence');
      assert.equal(fileWrites, 0);
    }
    docs = [original]; await writeFile(filename, 'original bytes'); change = () => {};
    await service.scan(scope);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(service.fill(scope, { scanId: 's', attachments: [{ fieldId: 'file', documentId: 'doc' }], signal: controller.signal }), { name: 'AbortError' });
    assert.equal(fileWrites, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

await test('attachment loading is bounded, refuses malformed selections, and validates current files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'application-attachment-bounds-'));
  const scope = { userId: 'owner', candidateId: 'candidate', conversationId: 'thread' };
  const documents = ['large', 'a', 'b', 'empty'].map(id => ({ id, candidateId: 'candidate', name: `${id}.txt` }));
  const database = { listDocuments: () => documents };
  const fields = [{ id: 'f1', type: 'file', label: '简历' }, { id: 'f2', type: 'file', label: '补充材料' }];
  const prepare = selections => prepareApplicationAttachments({ database, dataDir: dir, scope, fields, selections });
  try {
    await mkdir(path.join(dir, 'uploads', 'owner'), { recursive: true });
    for (const [id, size] of [['large', 8 * 1024 * 1024 + 1], ['a', 5 * 1024 * 1024], ['b', 4 * 1024 * 1024], ['empty', 0]]) await writeFile(path.join(dir, 'uploads', 'owner', id), Buffer.alloc(size, 65));
    await assert.rejects(prepare([{ fieldId: 'f1', documentId: 'large' }]), /8MB/);
    await assert.rejects(prepare([{ fieldId: 'f1', documentId: 'a' }, { fieldId: 'f2', documentId: 'b' }]), /8MB/);
    await assert.rejects(prepare([{ fieldId: 'f1', documentId: 'empty' }]), /无法读取/);
    for (const selections of [null, Array(9).fill({ fieldId: 'f1', documentId: 'a' }), [{ fieldId: 'f1', documentId: 'a', path: 'arbitrary' }], [{ fieldId: 'f1', documentId: 'a', buffer: [65] }], [{ fieldId: 'f1', documentId: 'a' }, { fieldId: 'f1', documentId: 'a' }]]) await assert.rejects(prepare(selections), /选择无效/);
    const current = await prepare([{ fieldId: 'f1', documentId: 'a' }]);
    assert.equal(current.validateAnswer(current.answers[0]), true);
    const portalLimit = await prepareApplicationAttachments({ database, dataDir: dir, scope, fields: [{ ...fields[0], maxFileBytes: 2 * 1024 * 1024 }], selections: [{ fieldId: 'f1', documentId: 'a' }] });
    assert.equal(portalLimit.answers.length, 0);
    assert.equal(portalLimit.skipped[0].status, 'attachment_too_large');
    await symlink(path.join(dir, 'uploads', 'owner'), path.join(dir, 'uploads', 'linked-owner'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(prepareApplicationAttachments({ database, dataDir: dir, scope: { ...scope, userId: 'linked-owner' }, fields, selections: [{ fieldId: 'f1', documentId: 'a' }] }), /无法读取/);
    await rm(path.join(dir, 'uploads', 'owner', 'a'));
    assert.equal(current.validateAnswer(current.answers[0]), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

