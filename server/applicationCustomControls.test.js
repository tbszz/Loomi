import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createApplicationBrowser } from './applicationForms.js';
import { prepareApplicationAnswers } from './applicationAnswers.js';
import { fillCustomControl, scanCustomControls } from './applicationCustomControls.js';

const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);

await test('custom controls use scoped second-stage options and preserve occupied fields', async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://recruit.example.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
      <form onsubmit="window.submits++;return false">
      <div role="radiogroup" aria-label="性别"><label><input type="radio" name="sex" value="男">男</label><label><input type="radio" name="sex" value="女">女</label></div>
      <div role="combobox" tabindex="0" aria-label="最高学历" aria-controls="degree-options" aria-expanded="false" aria-placeholder="请选择">请选择</div>
      <div role="combobox" tabindex="0" aria-label="国籍" aria-controls="country-options" aria-expanded="false" aria-placeholder="请选择">中国</div>
      <div class="custom-datepicker" aria-label="出生日期">请选择日期</div>
      <div class="dropdown-form"><label>姓名<input name="name"></label></div>
      <div role="listbox" id="unrelated"><div role="option">本科</div></div>
      <button>提交</button></form>
      <script>window.submits=0;window.opens=0;
      document.querySelector('[aria-controls="degree-options"]').onclick=function(){window.opens++;this.setAttribute('aria-expanded','true');setTimeout(()=>{const list=document.createElement('div');list.id='degree-options';list.role='listbox';list.innerHTML='<div role="option" data-value="bachelor">本科</div><div role="option">硕士</div>';list.onclick=e=>{if(e.target.role==='option'){this.textContent=e.target.textContent;this.setAttribute('aria-expanded','false');list.remove()}};document.body.append(list)},30)};
      </script>` }));
    await page.goto('https://recruit.example.test/form');
    const driver = createApplicationBrowser({ pageProvider: async () => page });
    const scope = { userId: 'u', candidateId: 'c', conversationId: 't' };
    await driver.start(scope);
    const scan = await driver.scan(scope);
    assert.equal(await page.evaluate(() => window.opens), 0, 'scan is read-only');
    assert.equal(scan.fields.find(field => field.name === 'sex').label, '性别');
    const degree = scan.fields.find(field => field.label === '最高学历');
    assert.ok(degree, 'custom dropdown is discoverable');
    assert.equal(degree.unsupported, false);
    assert.equal(scan.fields.find(field => field.label === '国籍').occupied, true);
    assert.ok(!JSON.stringify(scan).includes('中国'), 'occupied values stay private');
    assert.equal(scan.fields.find(field => field.label === '出生日期').unsupported, true);
    assert.ok(scan.fields.find(field => field.name === 'name' && field.type === 'text'), 'discovery class hints do not hide native fields');
    const prepared = await prepareApplicationAnswers({ fields: scan.fields, profile: { degree: '本科', gender: '女', nationality: '其他' } });
    const result = await driver.fill(scope, { scanId: scan.scanId, answers: prepared.answers });
    assert.equal(result.filled, 2);
    assert.equal(await page.locator('[aria-controls="degree-options"]').textContent(), '本科');
    assert.equal(await page.locator('[name=sex]:checked').inputValue(), '女');
    assert.equal(await page.locator('[aria-controls="country-options"]').textContent(), '中国');
    assert.equal(await page.evaluate(() => window.submits), 0);
    assert.ok(!JSON.stringify(result).includes('本科'));
  } finally { await browser.close(); }
});

await test('second-stage selection rejects drift, ambiguity, lost evidence and cancellation', async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://recruit.example.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
      <div role="combobox" tabindex="0" aria-label="最高学历" aria-controls="opts" aria-expanded="false" aria-placeholder="请选择">请选择</div>
      <script>window.selections=0; document.querySelector('[role=combobox]').onclick=function(){
      this.setAttribute('aria-expanded','true');if(window.mode==='occupied')this.textContent='用户刚选择';
      if(window.mode==='label')this.setAttribute('aria-label','同意隐私授权');
      if(window.mode==='url')history.pushState({},'', '/new-step');
      if(window.mode==='cancel')return;
      const panel=document.createElement('div');panel.id='opts';panel.role='listbox';
      panel.innerHTML='<div role="option">本科</div>'+(window.mode==='duplicate'?'<div role="option">本科</div>':window.mode==='forbidden'?'<div role="option">同意隐私授权</div>':'');
      panel.onclick=()=>{window.selections++;this.textContent='本科'};document.body.append(panel);
      };</script>` }));
    const scope = { userId: 'u', candidateId: 'c', conversationId: 't' };
    const driver = createApplicationBrowser({ pageProvider: async () => page });
    await driver.start(scope);
    for (const [mode, expected] of [['occupied','preserved'],['label','changed'],['url','changed'],['duplicate','unsupported'],['forbidden','unsupported'],['evidence','missing_evidence'],['cancel',null]]) {
      await page.goto('https://recruit.example.test/form');
      await page.evaluate(mode => { window.mode = mode; }, mode);
      const scan = await driver.scan(scope);
      const field = scan.fields.find(field => field.label === '最高学历');
      const controller = new AbortController();
      let validations = 0;
      const filling = driver.fill(scope, { scanId: scan.scanId, signal: controller.signal, answers: [{ fieldId: field.id, value: '本科' }], validateAnswer: () => mode !== 'evidence' || ++validations === 1 });
      if (mode === 'cancel') {
        await page.waitForFunction(() => document.querySelector('[role=combobox]').getAttribute('aria-expanded') === 'true');
        controller.abort();
        await assert.rejects(filling, /abort/i);
      } else assert.equal((await filling).results[0].status, expected, mode);
      assert.equal(await page.evaluate(() => window.selections), 0, mode);
    }
    assert.equal(driver.status(scope).connected, true, 'abort releases the busy state');
    await driver.scan(scope);
  } finally { await browser.close(); }
});

await test('searchable custom comboboxes preserve user search changes', async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://recruit.example.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
      <div class="ant-select">
        <span class="ant-select-selection-placeholder">请选择</span>
        <input role="combobox" aria-label="最高学历" aria-controls="degree-options" aria-expanded="false" aria-placeholder="请选择">
      </div>
      <script>
      window.selections=0; window.inputs=[];
      const combo = document.querySelector('[role=combobox]');
      combo.onclick = () => {
        combo.setAttribute('aria-expanded','true');
        if (!document.getElementById('degree-options')) {
          const panel = document.createElement('div');
          panel.id = 'degree-options';
          panel.role = 'listbox';
          panel.innerHTML = '<div role="option">请选择学历</div>';
          panel.onclick = event => {
            if (event.target.role === 'option') {
              document.querySelector('.ant-select-selection-placeholder').remove();
              const selected = document.createElement('span');
              selected.className = 'ant-select-selection-item';
              selected.textContent = event.target.textContent;
              document.querySelector('.ant-select').append(selected);
              window.selections++;
            }
          };
          document.body.append(panel);
        }
      };
      combo.addEventListener('input', () => {
        window.inputs.push(combo.value);
        if (window.mode === 'user-replace') combo.value = '用户改写';
        setTimeout(() => {
          const panel = document.getElementById('degree-options');
          panel.innerHTML = combo.value === '本科' ? '<div role="option">本科</div>' : '<div role="option">请选择学历</div>';
        }, 20);
      });
      </script>` }));
    const scope = { userId: 'u', candidateId: 'c', conversationId: 't' };
    const driver = createApplicationBrowser({ pageProvider: async () => page });
    await driver.start(scope);

    await page.goto('https://recruit.example.test/form');
    let scan = await driver.scan(scope);
    let field = scan.fields.find(item => item.label === '最高学历');
    let result = await driver.fill(scope, { scanId: scan.scanId, answers: [{ fieldId: field.id, value: '本科' }] });
    assert.equal(result.results[0].status, 'filled');
    assert.equal(await page.locator('.ant-select-selection-item').textContent(), '本科');
    assert.deepEqual(await page.evaluate(() => window.inputs), ['本科']);
    assert.equal(await page.evaluate(() => window.selections), 1);

    await page.goto('https://recruit.example.test/form');
    await page.evaluate(() => { window.mode = 'user-replace'; });
    scan = await driver.scan(scope);
    field = scan.fields.find(item => item.label === '最高学历');
    result = await driver.fill(scope, { scanId: scan.scanId, answers: [{ fieldId: field.id, value: '本科' }] });
    assert.equal(result.results[0].status, 'changed');
    assert.equal(await page.locator('.ant-select-selection-item').count(), 0);
  } finally { await browser.close(); }
});

await test('custom controls bind to their scanned frame owner chain', async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://recruit.example.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
      <iframe id="job-frame" srcdoc="
        <div role='combobox' tabindex='0' aria-label='最高学历' aria-controls='opts' aria-expanded='false' aria-placeholder='请选择'>请选择</div>
        <script>
        document.querySelector('[role=combobox]').onclick=function(){
          this.setAttribute('aria-expanded','true');
          const panel=document.createElement('div');
          panel.id='opts'; panel.role='listbox';
          panel.innerHTML='<div role=option>本科</div>';
          panel.onclick=e=>{ if(e.target.role==='option') this.textContent=e.target.textContent; };
          document.body.append(panel);
        };
        <\/script>
      "></iframe>` }));
    await page.goto('https://recruit.example.test/form');
    const frame = page.frameLocator('#job-frame').owner();
    const iframe = await frame.elementHandle();
    const child = page.frames().find(item => item.parentFrame() === page.mainFrame());
    const parentDocument = await page.evaluateHandle(() => document);
    const frameDocument = await child.evaluateHandle(() => document);
    const frameOwners = [{ element: iframe, document: parentDocument }];

    const entries = await scanCustomControls(child, /同意|授权|隐私/.source, { frameOwners });
    assert.equal(entries.length, 1);
    assert.equal(await fillCustomControl(entries[0], { document: frameDocument, url: child.url(), value: '本科', forbiddenPattern: /同意|授权|隐私/.source, frameOwners }), 'filled');
    assert.equal(await child.locator('[role=combobox]').textContent(), '本科');

    const changedEntries = await scanCustomControls(child, /同意|授权|隐私/.source, { frameOwners });
    assert.equal(await fillCustomControl(changedEntries[0], { document: frameDocument, url: child.url(), value: '本科', forbiddenPattern: /同意|授权|隐私/.source, frameOwners: [] }), 'changed');
  } finally { await browser.close(); }
});

await test('custom controls validate nested frame owners from inner to top', async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://recruit.example.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
      <iframe id="outer-frame" srcdoc="
        <iframe id='inner-frame' srcdoc=&quot;
          <div role='combobox' tabindex='0' aria-label='最高学历' aria-controls='opts' aria-expanded='false' aria-placeholder='请选择'>请选择</div>
          <script>
          document.querySelector('[role=combobox]').onclick=function(){
            this.setAttribute('aria-expanded','true');
            const panel=document.createElement('div');
            panel.id='opts'; panel.role='listbox';
            panel.innerHTML='<div role=option>本科</div>';
            panel.onclick=e=>{ if(e.target.role==='option') this.textContent=e.target.textContent; };
            document.body.append(panel);
          };
          <\/script>
        &quot;></iframe>
      "></iframe>` }));
    await page.goto('https://recruit.example.test/form');
    const outer = page.frames().find(item => item.parentFrame() === page.mainFrame());
    const inner = page.frames().find(item => item.parentFrame() === outer);
    const outerFrameElement = await page.locator('#outer-frame').elementHandle();
    const innerFrameElement = await outer.locator('#inner-frame').elementHandle();
    const topDocument = await page.evaluateHandle(() => document);
    const outerDocument = await outer.evaluateHandle(() => document);
    const innerDocument = await inner.evaluateHandle(() => document);
    const frameOwners = [
      { element: innerFrameElement, document: outerDocument },
      { element: outerFrameElement, document: topDocument }
    ];

    const entries = await scanCustomControls(inner, /同意|授权|隐私/.source, { frameOwners });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].meta.unsupported, false);
    assert.equal(await fillCustomControl(entries[0], { document: innerDocument, url: inner.url(), value: '本科', forbiddenPattern: /同意|授权|隐私/.source, frameOwners }), 'filled');
    assert.equal(await inner.locator('[role=combobox]').textContent(), '本科');
  } finally { await browser.close(); }
});
