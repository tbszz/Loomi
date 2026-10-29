import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { toAssistantMessage, visibleMessages, promptText } from './workspaceRuntime.js';

await test('localized landing markup, original CSS and English document head stay stable', () => {
  const main = readFileSync(new URL('./main.jsx', import.meta.url), 'utf8');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const normalizedFile = url => readFileSync(url, 'utf8').replace(/\r\n/g, '\n');
  // Re-frozen for the explicit desktop i18n change: localized landing copy,
  // a locale button, and lang="en". Structural snapshot coverage is retained.
  assert.equal(hash(main.slice(main.indexOf('function LandingPage('), main.indexOf('function MobileBar('))), 'c28aabec8505426987c8bb21939a5c8ca2147917a214d2bdbf1b959bedbbb77d');
  // These two digests were re-frozen by commit 1d3b422 ("fix(ui): remove blocking
  // external font dependency"), which deliberately rewrote the document head and the
  // font stacks. The guard keeps its meaning: any later edit to either file still
  // fails until someone re-freezes on purpose. Re-frozen again for the landing
  // scroll fix (min-height -> height on .landing-page), same deliberate path.
  // The pending merge also adds the existing job-note source-link styles;
  // preserve those additions while retaining the landing scroll fix above.
  assert.equal(hash(normalizedFile(new URL('./styles.css', import.meta.url))), '292390c244690243bb52c9a71e5a5be7d8445b9afc24ad8775c5b6f1156cbb3d');
  assert.equal(hash(normalizedFile(new URL('../index.html', import.meta.url))), '9432ccc4e213eef12b8339979f7ad8cd3c5ca328ab95bef910c28273f0ec8933');
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
