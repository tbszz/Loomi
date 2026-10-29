import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { toAssistantMessage, visibleMessages, promptText } from './workspaceRuntime.js';

await test('workspace refactor leaves landing markup, original CSS and document head intact', () => {
  const main = readFileSync(new URL('./main.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const normalizedFile = url => readFileSync(url, 'utf8').replace(/\r\n/g, '\n');
  // Frozen so an accidental edit to the landing page still fails loudly.
  //
  // The previously recorded value here (d740863b…) matched no commit in the
  // repository's history: scanning all 78 commits, the LandingPage slice has only
  // ever hashed to 61fa7c91… (66 of them, going back to the first commit that
  // defines both LandingPage and MobileBar). The constant was simply wrong, and it
  // went unnoticed until commit 29f465f wired this file into `npm test` — before
  // that the guard never actually ran. Corrected to the real value; assertion
  // strength is unchanged.
  assert.equal(hash(main.slice(main.indexOf('function LandingPage('), main.indexOf('function MobileBar('))), '61fa7c912158c411e5c6f1664ee16246e37f13f8305c142855854b148d08c7e9');
  // These two digests were re-frozen by commit 1d3b422 ("fix(ui): remove blocking
  // external font dependency"), which deliberately rewrote the document head and the
  // font stacks. The guard keeps its meaning: any later edit to either file still
  // fails until someone re-freezes on purpose. Re-frozen again for the landing
  // scroll fix (min-height -> height on .landing-page), same deliberate path.
  // The pending merge also adds the existing job-note source-link styles;
  // preserve those additions while retaining the landing scroll fix above.
  assert.equal(hash(normalizedFile(new URL('./styles.css', import.meta.url))), '292390c244690243bb52c9a71e5a5be7d8445b9afc24ad8775c5b6f1156cbb3d');
  assert.equal(hash(normalizedFile(new URL('../index.html', import.meta.url))), 'fee7723ea4dd1eb8723661976fd83a9133d6f1113a0d3c1810306e3434e1d2ff');
});
await test('runtime preserves attachment and business result identity without inventing messages', () => {
  const message = { id: 'file-1', role: 'user', content: '简历', kind: 'attachment', data: { documentId: 'doc-1', parseStatus: { status: 'unreadable' } } };
  const converted = toAssistantMessage(message);
  assert.equal(converted.id, message.id);
  assert.equal(converted.role, 'user');
  assert.deepEqual(converted.metadata.custom.careerMessage, message);
  const diagnosis = { id: 'a', role: 'assistant', kind: 'diagnosis', content: '核对原文', data: { completeness: null } };
  assert.deepEqual(toAssistantMessage(diagnosis).metadata.custom.careerMessage.data, diagnosis.data);
});
await test('only server welcome placeholder is replaced by the new empty state', () => {
  const welcome = { id: 'c-welcome', role: 'assistant', content: 'welcome' };
  assert.deepEqual(visibleMessages({ id: 'c', messages: [welcome] }), []);
  const real = { id: 'real', role: 'assistant', content: '说明' };
  assert.deepEqual(visibleMessages({ id: 'c', messages: [welcome, real] }), [real]);
});
await test('composer extracts text only and preserves line breaks', () => {
  assert.equal(promptText({content:[{type:'text',text:'第一行\n第二行'},{type:'image',image:'not text'}]}), '第一行\n第二行');
});
