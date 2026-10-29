import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { findLocalBrowser } from './applicationForms.js';

await test('native fields and custom dropdowns stay bound to their nested frame document', async () => {
  const { createApplicationBrowser } = await import('./applicationForms.js');
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://recruit.example.test/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      const body = pathname === '/form' ? '<label>姓名<input name="name" value="外层已有"></label><iframe src="/inner"></iframe><iframe src="https://other.example.test/form"></iframe>'
        : pathname === '/inner' ? '<label>姓名<input name="name"></label><iframe src="/nested"></iframe>'
        : `<label>姓名<input name="name"></label><div role="combobox" aria-label="最高学历" aria-controls="opts" aria-placeholder="请选择">请选择</div><script>document.querySelector('[role=combobox]').onclick=function(){this.setAttribute('aria-expanded','true');const p=document.createElement('div');p.id='opts';p.role='listbox';p.innerHTML='<div role="option">本科</div>';p.onclick=()=>{this.textContent='本科';p.remove()};document.body.append(p)}</script>`;
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body });
    });
    await page.route('https://other.example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<label>Foreign<input name="foreign"></label>' }));
    await page.goto('https://recruit.example.test/form');
    const inner = page.frames().find(frame => frame.url().endsWith('/inner'));
    const nested = page.frames().find(frame => frame.url().endsWith('/nested'));
    const driver = createApplicationBrowser({ pageProvider: async () => page });
    const scope = { userId: 'u', candidateId: 'c', conversationId: 't' };
    await driver.start(scope);
    const scan = await driver.scan(scope);
    const names = scan.fields.filter(field => field.name === 'name');
    assert.equal(names.length, 3);
    assert.equal(scan.fields.some(field => field.name === 'foreign'), false);
    assert.equal(scan.skippedFrames, 1, 'cross-origin frame is explicitly left manual');
    const result = await driver.fill(scope, { scanId: scan.scanId, answers: scan.fields.map(field => ({ fieldId: field.id, value: field.type === 'custom-select' ? '本科' : '张三' })) });
    assert.equal(result.filled, 3);
    assert.equal(result.preserved, 1);
    assert.equal(await page.locator('[name=name]').inputValue(), '外层已有');
    assert.equal(await inner.locator('[name=name]').inputValue(), '张三');
    assert.equal(await nested.locator('[role=combobox]').textContent(), '本科');
    await inner.locator('[name=name]').fill('');
    await nested.locator('[name=name]').fill('');
    const fresh = await driver.scan(scope);
    await inner.goto('https://recruit.example.test/replaced');
    const stale = await driver.fill(scope, { scanId: fresh.scanId, answers: fresh.fields.filter(field => !field.occupied).map(field => ({ fieldId: field.id, value: '禁止写入' })) });
    assert.equal(stale.filled, 0, 'navigated and detached frame handles cannot target replacement fields');
    assert.equal(await inner.locator('[name=name]').inputValue(), '');
    const next = await driver.scan(scope);
    await page.locator('iframe').first().evaluate(node => { node.style.display = 'none'; });
    const hidden = await driver.fill(scope, { scanId: next.scanId, answers: next.fields.filter(field => !field.occupied).map(field => ({ fieldId: field.id, value: '禁止写入' })) });
    assert.equal(hidden.filled, 0, 'hidden iframe does not receive writes');
  } finally { await browser.close(); }
});

await test('real DOM filling preserves existing values and never submits', async () => {
  const { createApplicationBrowser } = await import('./applicationForms.js');
  const executablePath = findLocalBrowser();
  assert.ok(executablePath, 'A real local browser is required');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('https://recruit.example.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<form onsubmit="window.submits++;return false"><label>姓名<input name="name"></label><label>手机号<input name="phone" value="已输入"></label><label>期望薪资<input name="salary" value="0"></label><label>邮箱<input name="email"></label><label>身份证号<input name="id"></label><label>学历<select name="degree"><option value="">请选择</option><option>本科</option></select></label><fieldset><legend>是否有工作经验</legend><label><input type="radio" name="experienced" value="false" checked>否</label><label><input type="radio" name="experienced" value="true">是</label></fieldset><label><input type="checkbox" name="consent">同意隐私协议</label><label>密码<input type="password"></label><button>提交申请</button></form><script>window.submits=0</script>` }));
    await page.goto('https://recruit.example.test/form');
    await page.evaluate(() => {
      const input = document.createElement('input'); input.name = 'spaces'; input.value = '   '; document.querySelector('form').append(input);
      for (const name of ['answeredFalse','neutralBoolean','mixedTrue']) {
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.name = name;
        checkbox.indeterminate = name !== 'answeredFalse'; checkbox.checked = name === 'mixedTrue'; document.querySelector('form').append(checkbox);
      }
    });
    const driver = createApplicationBrowser({ pageProvider: async () => page });
    const scope = { userId: 'a', candidateId: 'c', conversationId: 't' };
    await driver.start(scope, {});
    const scan = await driver.scan(scope);
    assert.ok(!JSON.stringify(scan).includes('已输入'));
    const byName = name => scan.fields.find(field => field.name === name);
    const writes = [{ fieldId: byName('name').id, value: '张三' }, { fieldId: byName('phone').id, value: '覆盖' }, { fieldId: byName('salary').id, value: '20000' }, { fieldId: byName('experienced').id, value: 'true' }, { fieldId: byName('email').id, value: 'test@example.test' }, { fieldId: byName('degree').id, value: '本科' }, { fieldId: byName('consent').id, value: true }, { fieldId: byName('spaces').id, value: 'overwrite' }];
    await page.locator('[name=email]').fill('用户刚输入');
    const result = await driver.fill(scope, { scanId: scan.scanId, answers: writes });
    assert.equal(await page.locator('[name=name]').inputValue(), '张三');
    assert.equal(await page.locator('[name=phone]').inputValue(), '已输入');
    assert.equal(await page.locator('[name=salary]').inputValue(), '0');
    assert.equal(await page.locator('[name=email]').inputValue(), '用户刚输入');
    assert.equal(await page.locator('[name=spaces]').inputValue(), '   ');
    assert.equal(await page.locator('[name=degree]').inputValue(), '本科');
    assert.equal(await page.locator('[name=experienced]:checked').inputValue(), 'false');
    assert.equal(await page.locator('[name=consent]').isChecked(), false);
    const falseField = scan.fields.find(field => field.name === 'answeredFalse');
    assert.equal(falseField.unsupported, true, 'unchecked does not prove an unanswered boolean');
    const neutral = scan.fields.find(field => field.name === 'neutralBoolean');
    assert.equal(neutral.unsupported, true, 'mixed appearance alone does not prove no prior answer');
    const mixed = scan.fields.find(field => field.name === 'mixedTrue');
    assert.equal(mixed.occupied, true, 'indeterminate must never hide a checked value');
    const booleans = await driver.fill(scope, { scanId: scan.scanId, answers: [{ fieldId: falseField.id, value: true }, { fieldId: neutral.id, value: false }, { fieldId: mixed.id, value: false }] });
    assert.equal(await page.locator('[name=answeredFalse]').isChecked(), false);
    assert.equal(await page.locator('[name=neutralBoolean]').isChecked(), false);
    assert.equal(await page.locator('[name=neutralBoolean]').evaluate(node => node.indeterminate), true);
    assert.equal(await page.locator('[name=mixedTrue]').isChecked(), true);
    assert.equal(await page.locator('[name=mixedTrue]').evaluate(node => node.indeterminate), true);
    assert.ok(booleans.results.every(result => result.status === 'unsupported'));
    assert.equal(await page.evaluate(() => window.submits), 0);
    assert.ok(!JSON.stringify(result).includes('张三'));
    await assert.rejects(driver.scan({ ...scope, userId: 'b' }));
    const other = await page.context().newPage();
    await other.route('https://recruit.example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Second local test page</p>' }));
    await other.goto('https://recruit.example.test/two');
    const tabs = await driver.tabs(scope);
    const targetTab = tabs.tabs.find(tab => tab.url.endsWith('/two'));
    await driver.selectTab(scope, { tabId: targetTab.id });
    assert.ok(driver.status(scope).currentUrl.endsWith('/two'));
    await driver.selectTab(scope, { tabId: tabs.tabs.find(tab => tab.url.endsWith('/form')).id });
    await assert.rejects(driver.selectTab(scope, { tabId: 'foreign-tab' }));
    const freshScan = await driver.scan(scope);
    await page.goto('https://recruit.example.test/other');
    await assert.rejects(driver.fill(scope, { scanId: freshScan.scanId, answers: writes }), /页面/);
  } finally { await browser.close(); }
});

await test('real existing repeat rows, dates and scoped attachment buffers are filled', async () => {
  const { createApplicationBrowser } = await import('./applicationForms.js');
  const { prepareApplicationAnswers } = await import('./applicationAnswers.js');
  const executablePath = findLocalBrowser();
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://recruit.example.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<fieldset><legend>教育经历</legend><label>学校<input name="school1"></label><label>入学时间<input type="month" name="start1"></label></fieldset><fieldset><legend>教育经历</legend><label>学校<input name="school2"></label><label>入学时间<input type="month" name="start2"></label></fieldset><label>简历附件<input type="file" name="resume" accept=".txt"></label>' }));
    await page.goto('https://recruit.example.test/rows');
    const driver = createApplicationBrowser({ pageProvider: async () => page });
    const scope = { userId: 'a', candidateId: 'c', conversationId: 't' };
    await driver.start(scope, {});
    const scan = await driver.scan(scope);
    const prepared = await prepareApplicationAnswers({ fields: scan.fields, profile: { education: [{ school: '本科大学', startDate: '2020-09' }, { school: '硕士大学', startDate: '2024-09' }] } });
    const attachmentField = scan.fields.find(field => field.type === 'file');
    const result = await driver.fill(scope, { scanId: scan.scanId, answers: [...prepared.answers, { fieldId: attachmentField.id, attachment: { name: 'resume.txt', mimeType: 'text/plain', buffer: Buffer.from('Candidate source') } }] });
    assert.equal(result.filled, 4);
    assert.equal(result.results.find(item => item.fieldId === attachmentField.id).status, 'attachment_selected');
    assert.equal(await page.locator('[name=school1]').inputValue(), '本科大学');
    assert.equal(await page.locator('[name=school2]').inputValue(), '硕士大学');
    assert.equal(await page.locator('[name=start2]').inputValue(), '2024-09');
    assert.equal(await page.locator('[name=resume]').evaluate(node => node.files[0].name), 'resume.txt');
  } finally { await browser.close(); }
});

await test('writes preserve intervening user input and keep same-name radio groups inside their form', async () => {
  const { createApplicationBrowser } = await import('./applicationForms.js');
  const executablePath = findLocalBrowser();
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://recruit.example.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<label>姓名<input name="name"></label><form id="other"><fieldset><legend>Other</legend><input type="radio" name="choice" value="true" checked><input type="radio" name="choice" value="false"></fieldset></form><form id="target"><fieldset><legend>Target</legend><input type="radio" name="choice" value="true"><input type="radio" name="choice" value="false"></fieldset></form>' }));
    await page.goto('https://recruit.example.test/guards');
    const driver = createApplicationBrowser({ pageProvider: async () => page });
    const scope = { userId: 'a', candidateId: 'c', conversationId: 't' };
    await driver.start(scope, {});
    const scan = await driver.scan(scope);
    await page.locator('[name=name]').evaluate(node => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      let changed = false;
      Object.defineProperty(node, 'value', { get() {
        const value = descriptor.get.call(this);
        if (!changed) { changed = true; queueMicrotask(() => descriptor.set.call(this, 'user typed after guard')); }
        return value;
      }, set(value) { descriptor.set.call(this, value); } });
    });
    const name = scan.fields.find(field => field.name === 'name');
    const target = scan.fields.find(field => field.section === 'Target');
    const result = await driver.fill(scope, { scanId: scan.scanId, answers: [{ fieldId: name.id, value: 'agent value' }, { fieldId: target.id, value: 'false' }] });
    assert.equal(await page.locator('[name=name]').inputValue(), 'user typed after guard');
    assert.equal(result.results.find(item => item.fieldId === name.id).status, 'preserved');
    assert.equal(await page.locator('#other input:checked').inputValue(), 'true');
    assert.equal(await page.locator('#target input:checked').inputValue(), 'false');
    // A new scan must not collapse distinct forms even when their legends match.
    await page.locator('#target legend').evaluate(node => { node.textContent = 'Other'; });
    const sameLabels = await driver.scan(scope);
    assert.equal(sameLabels.fields.filter(field => field.type === 'radio').length, 2);
    await page.evaluate(() => {
      for (const name of ['guard1','guard2']) { const node = document.createElement('input'); node.name = name; document.body.append(node); }
    });
    const guardedScan = await driver.scan(scope);
    const guardedAnswers = ['guard1','guard2'].map(name => ({ fieldId: guardedScan.fields.find(field => field.name === name).id, value: 'grounded' }));
    let active = true;
    const guarded = await driver.fill(scope, { scanId: guardedScan.scanId, answers: guardedAnswers, validateAnswer: () => { const valid = active; active = false; return valid; } });
    assert.equal(await page.locator('[name=guard1]').inputValue(), 'grounded');
    assert.equal(await page.locator('[name=guard2]').inputValue(), '');
    assert.equal(guarded.results[1].status, 'missing_evidence');
    await page.evaluate(() => { const label = document.createElement('label'); label.textContent = '接受异地'; const select = document.createElement('select'); select.name = 'moving'; select.innerHTML = '<option value="">未确定</option><option value="true">是</option><option value="false">否</option>'; label.append(select); document.body.append(label); });
    const consentScan = await driver.scan(scope);
    const moving = consentScan.fields.find(field => field.name === 'moving');
    await page.locator('[name=moving]').evaluate(node => { node.closest('label').firstChild.textContent = '同意隐私授权'; });
    const consentDrift = await driver.fill(scope, { scanId: consentScan.scanId, answers: [{ fieldId: moving.id, value: 'true' }] });
    assert.equal(consentDrift.results[0].status, 'changed', 'an old profile mapping cannot become consent after label drift');
    assert.equal(await page.locator('[name=moving]').inputValue(), '');
    await page.locator('[name=moving]').evaluate(node => { node.closest('label').firstChild.textContent = '接受异地' + '说明'.repeat(110); });
    const longLabelScan = await driver.scan(scope);
    await page.locator('[name=moving]').evaluate(node => { node.closest('label').firstChild.textContent += '同意隐私授权'; });
    const longDrift = await driver.fill(scope, { scanId: longLabelScan.scanId, answers: [{ fieldId: longLabelScan.fields.find(field => field.name === 'moving').id, value: 'true' }] });
    assert.equal(longDrift.results[0].status, 'changed', 'label identity must cover text beyond the public descriptor limit');
    assert.equal(await page.locator('[name=moving]').inputValue(), '');
    const forbiddenScan = await driver.scan(scope);
    assert.equal(forbiddenScan.fields.find(field => field.name === 'moving').unsupported, true, 'consent text beyond display bounds is still forbidden');
    await page.evaluate(() => { const form = document.createElement('form'); form.innerHTML = '<fieldset><legend>接受异地</legend><label><input type="radio" name="relocate" value="false">否</label><label><input type="radio" name="relocate" value="true">是</label></fieldset>'; document.body.append(form); });
    const radioScan = await driver.scan(scope);
    await page.locator('[name=relocate][value=true]').evaluate(node => { node.closest('label').lastChild.textContent = '同意隐私授权'; });
    const radioDrift = await driver.fill(scope, { scanId: radioScan.scanId, answers: [{ fieldId: radioScan.fields.find(field => field.name === 'relocate').id, value: 'true' }] });
    assert.equal(radioDrift.results[0].status, 'changed', 'radio target purpose must match, not just the group anchor');
    assert.equal(await page.locator('[name=relocate]:checked').count(), 0);
    const forbiddenRadio = await driver.scan(scope);
    assert.equal(forbiddenRadio.fields.find(field => field.name === 'relocate').unsupported, true, 'consent in any member makes the radio group manual');
    await page.evaluate(() => { const label = document.createElement('label'); label.htmlFor = 'externalMoving'; label.textContent = '接受异地'; const select = document.createElement('select'); select.id = 'externalMoving'; select.name = 'externalMoving'; select.innerHTML = '<option value="">未确定</option><option value="true">是</option><option value="false">否</option>'; document.body.append(label, select); });
    const optionScan = await driver.scan(scope);
    await page.locator('[name=externalMoving] option[value=true]').evaluate(node => { node.textContent = '同意隐私授权'; });
    const optionDrift = await driver.fill(scope, { scanId: optionScan.scanId, answers: [{ fieldId: optionScan.fields.find(field => field.name === 'externalMoving').id, value: 'true' }] });
    assert.equal(optionDrift.results[0].status, 'changed', 'external labels cannot hide select option purpose drift');
    assert.equal(await page.locator('[name=externalMoving]').inputValue(), '');
    const forbiddenSelect = await driver.scan(scope);
    assert.equal(forbiddenSelect.fields.find(field => field.name === 'externalMoving').unsupported, true);
    await page.evaluate(() => {
      const label = document.createElement('label'); label.htmlFor = 'scanRace'; label.textContent = '接受异地';
      const select = document.createElement('select'); select.id = 'scanRace'; select.name = 'scanRace'; select.innerHTML = '<option value="">未确定</option><option value="true">是</option>';
      document.body.append(label, select);
      const option = select.options[1], descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
      let scheduled = false;
      Object.defineProperty(option, 'textContent', { get() { const value = descriptor.get.call(this); if (!scheduled) { scheduled = true; queueMicrotask(() => descriptor.set.call(this, '同意隐私授权')); } return value; } });
    });
    const racedScan = await driver.scan(scope);
    const race = await driver.fill(scope, { scanId: racedScan.scanId, answers: [{ fieldId: racedScan.fields.find(field => field.name === 'scanRace').id, value: 'true' }] });
    assert.equal(race.results[0].status, 'changed', 'public metadata and private identity must be captured in one DOM operation');
    assert.equal(await page.locator('[name=scanRace]').inputValue(), '');
    await page.locator('[name=relocate][value=true]').evaluate(node => { node.closest('label').lastChild.textContent = '是'; });
    const ariaScan = await driver.scan(scope);
    await page.locator('[name=relocate][value=true]').evaluate(node => { node.setAttribute('aria-label', '同意隐私授权'); });
    const ariaDrift = await driver.fill(scope, { scanId: ariaScan.scanId, answers: [{ fieldId: ariaScan.fields.find(field => field.name === 'relocate').id, value: 'true' }] });
    assert.equal(ariaDrift.results[0].status, 'changed', 'accessible option names also define purpose');
    assert.equal(await page.locator('[name=relocate]:checked').count(), 0);
    const ariaForbidden = await driver.scan(scope);
    assert.equal(ariaForbidden.fields.find(field => field.name === 'relocate').unsupported, true);
    await page.locator('[name=externalMoving] option[value=true]').evaluate(node => { node.textContent = '是'; });
    const nativeLabelScan = await driver.scan(scope);
    await page.locator('[name=externalMoving] option[value=true]').evaluate(node => { node.label = '同意隐私授权'; });
    const nativeLabelDrift = await driver.fill(scope, { scanId: nativeLabelScan.scanId, answers: [{ fieldId: nativeLabelScan.fields.find(field => field.name === 'externalMoving').id, value: 'true' }] });
    assert.equal(nativeLabelDrift.results[0].status, 'changed', 'native option.label is displayed even when textContent stays unchanged');
    assert.equal(await page.locator('[name=externalMoving]').inputValue(), '');
    const nativeForbidden = await driver.scan(scope);
    assert.equal(nativeForbidden.fields.find(field => field.name === 'externalMoving').unsupported, true);
  } finally { await browser.close(); }
});

await test('disabled experience rows keep their original profile slot', async () => {
  const { createApplicationBrowser } = await import('./applicationForms.js');
  const { prepareApplicationAnswers } = await import('./applicationAnswers.js');
  const executablePath = findLocalBrowser();
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://recruit.example.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<fieldset><legend>教育经历</legend><label>学校<input name="school0" disabled></label></fieldset><fieldset><legend>教育经历</legend><label>学校<input name="school1"></label><label>专业<input name="major1"></label></fieldset>' }));
    await page.goto('https://recruit.example.test/sparse');
    const driver = createApplicationBrowser({ pageProvider: async () => page });
    const scope = { userId: 'a', candidateId: 'c', conversationId: 't' };
    await driver.start(scope, {});
    const scan = await driver.scan(scope);
    const prepared = await prepareApplicationAnswers({ fields: scan.fields, profile: { education: [{ school: '本科大学', major: '本科专业' }, { school: '硕士大学', major: '硕士专业' }] } });
    await driver.fill(scope, { scanId: scan.scanId, answers: prepared.answers });
    assert.equal(await page.locator('[name=school1]').inputValue(), '硕士大学');
    assert.equal(await page.locator('[name=major1]').inputValue(), '硕士专业');
  } finally { await browser.close(); }
});

await test('native attachment events cannot transfer a selected result to a changed field identity', async () => {
  const { createApplicationBrowser } = await import('./applicationForms.js');
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://recruit.example.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<form><fieldset><legend>申请附件</legend><label>简历附件<input type="file" name="resume" accept=".txt"></label></fieldset></form><form id="other"><fieldset><legend>其他附件</legend></fieldset></form>' }));
    const driver = createApplicationBrowser({ pageProvider: async () => page });
    const scope = { userId: 'a', candidateId: 'c', conversationId: 't' };
    await page.goto('https://recruit.example.test/event-drift');
    await driver.start(scope);
    for (const mutate of [
      input => { input.closest('label').firstChild.textContent = '身份证明附件'; },
      input => { document.querySelector('#other fieldset').append(input.closest('label')); },
      input => { input.accept = '.pdf'; },
      input => { input.name = 'identity'; }
    ]) {
      await page.goto('https://recruit.example.test/event-drift');
      const scan = await driver.scan(scope);
      // Install each mutation as a synchronous page event, after the scan.
      await page.locator('[name=resume]').evaluate((input, source) => {
        const mutate = (0, eval)(`(${source})`);
        input.addEventListener('change', () => mutate(input));
      }, mutate.toString());
      const result = await driver.fill(scope, { scanId: scan.scanId, answers: [{ fieldId: scan.fields[0].id, attachment: { name: 'fixture.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic source') } }] });
      assert.equal(result.results[0].status, 'changed');
      assert.equal(result.filled, 0);
    }
  } finally { await browser.close(); }
});

await test('same-URL step changes reject hidden stale fields and explicit rescan fills only the current step', async () => {
  const { createApplicationBrowser } = await import('./applicationForms.js');
  const executablePath = findLocalBrowser();
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://recruit.example.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<form onsubmit="window.submits++;return false">
      <div id="first"><label>姓名<input name="name"></label><label>介绍<textarea name="intro"></textarea></label><label>学历<select name="degree"><option value="">请选择</option><option>本科</option></select></label><label>附件<input type="file" name="resume"></label></div>
      <div id="second" hidden><label>邮箱<input name="email"></label><label>手机号<input name="phone" value="用户已有内容"></label></div>
      <label id="late">地址<input name="address"></label><label style="visibility:hidden">隐藏字段<input name="invisible"></label><div inert><label>禁用区域<input name="inertField"></label></div>
      <button>提交申请</button></form><script>window.submits=0</script>` }));
    await page.goto('https://recruit.example.test/steps');
    const driver = createApplicationBrowser({ pageProvider: async () => page });
    const scope = { userId: 'a', candidateId: 'c', conversationId: 't' };
    await driver.start(scope, {});
    const scan = await driver.scan(scope);
    await page.evaluate(() => { document.querySelector('#first').hidden = true; document.querySelector('#second').hidden = false; });
    const answers = scan.fields.filter(field => ['name','intro','degree','resume'].includes(field.name)).map(field => ({ fieldId: field.id, value: field.name === 'degree' ? '本科' : '旧步骤答案', ...(field.type === 'file' ? { attachment: { name: 'fixture.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic source') } } : {}) }));
    const stale = await driver.fill(scope, { scanId: scan.scanId, answers });
    assert.ok(stale.results.every(result => result.status === 'changed'), 'connected controls on an inactive step must not receive writes');
    assert.equal(await page.locator('[name=name]').inputValue(), '');
    assert.equal(await page.locator('[name=intro]').inputValue(), '');
    assert.equal(await page.locator('[name=degree]').inputValue(), '');
    assert.equal(await page.locator('[name=resume]').evaluate(node => node.files.length), 0);
    const next = await driver.scan(scope);
    assert.ok(!next.fields.some(field => ['name','intro','degree','resume','invisible','inertField'].includes(field.name)));
    await page.locator('[name=address]').evaluate(node => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      let changed = false;
      Object.defineProperty(node, 'value', { get() {
        const value = descriptor.get.call(this);
        if (!changed) { changed = true; queueMicrotask(() => { node.parentElement.style.visibility = 'hidden'; }); }
        return value;
      } });
    });
    const nextAnswers = ['email','phone','address'].map(name => ({ fieldId: next.fields.find(field => field.name === name).id, value: name === 'email' ? 'fixture@example.test' : '新步骤答案' }));
    const result = await driver.fill(scope, { scanId: next.scanId, answers: nextAnswers });
    assert.equal(result.results[2].status, 'changed', 'visibility is rechecked inside the final synchronous write');
    assert.equal(await page.locator('[name=address]').inputValue(), '');
    assert.equal(await page.locator('[name=email]').inputValue(), 'fixture@example.test');
    assert.equal(await page.locator('[name=phone]').inputValue(), '用户已有内容');
    assert.equal(await page.evaluate(() => window.submits), 0);
  } finally { await browser.close(); }
});
