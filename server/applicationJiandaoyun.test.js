import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { fillJiandaoyunControl, scanJiandaoyunControls } from './applicationJiandaoyun.js';

const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const forbiddenPattern = /同意|授权|隐私|签名|签署|声明|验证码|密码|password|captcha|consent|signature|submit|提交|发送/.source;

function portalHtml() {
  return `<!doctype html><html><body><div class="fx-external-form"><div class="fx-form">
    <div class="fx-field x-grid-col-6" data-widgetname="_widget_name">
      <div class="field-label"><span class="field-required">*</span><div class="field-name">姓名</div></div>
      <div class="field-component"><div class="fx-form-text"><div class="x-input"><div class="x-inner-wrapper"><input type="text" class="input-inner" autocomplete="new-password" value=""></div></div></div></div>
    </div>
    <div class="fx-field x-grid-col-6" data-widgetname="_widget_referral_code">
      <div class="field-label"><span class="field-required">*</span><div class="field-name">内推码</div></div>
      <div class="field-component"><div class="fx-form-text"><div class="x-input"><div class="x-inner-wrapper"><input type="text" class="input-inner" placeholder="若非内推，请勿填写" autocomplete="new-password" value=""></div></div></div></div>
    </div>
    <div class="fx-field x-grid-col-6" data-widgetname="_widget_gender">
      <div class="field-label"><span class="field-required">*</span><div class="field-name">性别</div></div>
      <div class="field-component"><div class="fx-form-combo" tabindex="-1"><div class="x-combo fx-combo-trigger" tabindex="0" title=""><div class="x-combo-dropdown-label"><div class="value-wrapper"><div class="value-content"><div class="dropdown-label-placeholder"></div></div></div></div></div></div></div>
    </div>
    <div class="fx-field x-grid-col-6" data-widgetname="_widget_empty_combo">
      <div class="field-label"><span class="field-required">*</span><div class="field-name">籍贯</div></div>
      <div class="field-component"><div class="fx-form-combo"><div class="x-combo fx-combo-trigger"><div class="x-combo-dropdown-label"><div class="value-wrapper"><div class="value-content"><div class="dropdown-label-placeholder"></div></div></div></div></div></div></div>
    </div>
    <div class="fx-field x-grid-col-6" data-widgetname="_widget_adjust">
      <div class="field-label"><span class="field-required">*</span><div class="field-name">是否接受岗位调剂</div></div>
      <div class="field-component"><div class="fx-form-radiogroup color-enable"><div class="x-radio-group">
        <div class="x-radio group-item"><div class="x-radio-wrapper" tabindex="0"><span class="radio-check-icon"></span><span class="radio-text"><div class="x-tag" title="是"><div class="text-wrapper">是</div></div></span></div></div>
        <div class="x-radio group-item"><div class="x-radio-wrapper" tabindex="0"><span class="radio-check-icon"></span><span class="radio-text"><div class="x-tag" title="否"><div class="text-wrapper">否</div></div></span></div></div>
      </div></div></div>
    </div>
    <div class="fx-field x-grid-col-6" data-widgetname="_widget_referral">
      <div class="field-label"><span class="field-required">*</span><div class="field-name">是否内推</div></div>
      <div class="field-component"><div class="fx-form-radiogroup color-enable"><div class="x-radio-group">
        <div class="x-radio group-item"><div class="x-radio-wrapper" tabindex="0"><span class="radio-check-icon"></span><span class="radio-text"><div class="x-tag" title="是"><div class="text-wrapper">是</div></div></span></div></div>
        <div class="x-radio group-item radio-checked"><div class="x-radio-wrapper" tabindex="0"><span class="radio-check-icon"></span><span class="radio-text"><div class="x-tag" title="否"><div class="text-wrapper">否</div></div></span></div></div>
      </div></div></div>
    </div>
    <div class="fx-field x-grid-col-6" data-widgetname="_widget_language">
      <div class="field-label"><div class="field-name">语言特长</div></div>
      <div class="field-component"><div class="fx-form-combocheck" tabindex="-1"><div class="x-combocheck fx-combocheck-trigger" tabindex="0"><div class="x-combo-dropdown-label"><div class="value-wrapper"><div class="value-content"><div class="dropdown-label-placeholder">可多选</div></div></div></div></div></div></div>
    </div>
    <div class="fx-field x-grid-col-6" data-widgetname="_widget_birth">
      <div class="field-label"><span class="field-required">*</span><div class="field-name">出生年月</div></div>
      <div class="field-component"><div class="fx-form-datetime" tabindex="-1"><div class="x-datetime"><div class="datetime-label" tabindex="0"><div class="x-input"><div class="x-inner-wrapper"><input type="text" tabindex="-1" class="input-inner" autocomplete="new-password" value=""></div></div></div></div></div></div>
    </div>
    <div class="fx-field x-grid-col-6" data-widgetname="_widget_file">
      <div class="field-label"><span class="field-required">*</span><div class="field-name">简历附件</div></div>
      <div class="field-description fx-sub-html">超过2M无法上传，请将作品集和个人简历分开上传</div>
      <div class="field-component"><div class="fx-form-file file-field"><div class="x-upload file-upload x-upload-wrapper"><input type="file" accept=".pdf,.docx" name="file" class="x-upload-input"><div class="upload-btn"><div class="select-container">选择</div></div></div></div></div>
    </div>
    <div class="fx-field x-grid-col-6" data-widgetname="_widget_portfolio">
      <div class="field-label"><div class="field-name">作品集/项目材料</div></div>
      <div class="field-description fx-sub-html">申请设计类岗位请提交个人作品集，其他岗位可自行选择材料提交</div>
      <div class="field-component"><div class="fx-form-file file-field"><input type="file" accept=".pdf,.docx,.png" name="file" class="x-upload-input"><div class="upload-btn"><div class="select-container">选择</div><div class="upload-area-text">拖拽或单击后粘贴文件，单个500MB以内</div></div></div></div>
    </div>
    <div class="fx-field x-grid-col-6" data-widgetname="_widget_strict_file">
      <div class="field-label"><div class="field-name">严格附件</div></div>
      <div class="field-description fx-sub-html">描述允许5MB以内</div>
      <div class="field-component"><div class="fx-form-file file-field"><input type="file" accept=".pdf" name="file" class="x-upload-input"><div class="upload-btn"><div class="upload-area-text">控件提示单个2MB以内</div></div><div class="file-format-tip" title="pdf,docx,999MB">支持格式：pdf,docx,999MB</div></div></div>
    </div>
    <div class="fx-field x-grid-col-6" data-widgetname="_widget_unknown_subselect">
      <div class="field-label"><div class="field-name">普通子选择</div></div>
      <div class="field-component"><div class="fx-sub-select"><div class="select-container"><input class="select-input"></div></div></div>
    </div>
    <div class="fx-field x-grid-col-12" data-widgetname="_widget_exp">
      <div class="field-label"><div class="field-name field-name-bigger">实习经历</div></div>
      <div class="field-component"><div class="fx-subform"><div class="subform-table-wrapper">
        <div class="subform-head"><div class="subform-row">
          <div class="subform-cell"><div class="subform-title" title="开始时间">开始时间</div></div>
          <div class="subform-cell"><div class="subform-title" title="公司">公司</div></div>
          <div class="subform-cell"><div class="subform-title" title="工作描述">工作描述</div></div>
          <div class="subform-cell"><div class="subform-title" title="获奖证明">获奖证明</div></div>
        </div></div>
        <div class="subform-content"><div><div class="fx-subform-row">
          <div class="subform-cell"><div class="fx-sub-field" data-widgetname="_widget_start"><div class="field-component"><div class="fx-form-datetime"><input type="text" class="input-inner" value=""></div></div></div></div>
          <div class="subform-cell"><div class="fx-sub-field" data-widgetname="_widget_company"><div class="field-component"><div class="fx-form-text"><input type="text" class="input-inner" value=""></div></div></div></div>
          <div class="subform-cell"><div class="fx-sub-field" data-widgetname="_widget_desc"><div class="field-component"><div class="fx-form-textarea editable"><textarea class="x-resize-textarea normal-textarea"></textarea></div></div></div></div>
          <div class="subform-cell"><div class="fx-sub-field" data-widgetname="_widget_proof"><div class="field-component"><div class="fx-sub-select"><div class="select-container"><input class="select-input"><i class="icon-widget-upload"></i></div></div></div></div></div>
          <div class="row-head"><div class="row-num">1</div></div>
        </div><div class="fx-subform-row">
          <div class="subform-cell"><div class="fx-sub-field" data-widgetname="_widget_start2"><div class="field-component"><div class="fx-form-datetime"><input type="text" class="input-inner" value=""></div></div></div></div>
          <div class="subform-cell"><div class="fx-sub-field" data-widgetname="_widget_company2"><div class="field-component"><div class="fx-form-text"><input type="text" class="input-inner" value=""></div></div></div></div>
          <div class="subform-cell"><div class="fx-sub-field" data-widgetname="_widget_desc2"><div class="field-component"><div class="fx-form-textarea editable"><textarea class="x-resize-textarea normal-textarea" maxlength="10"></textarea></div></div></div></div>
          <div class="subform-cell"><div class="fx-sub-field" data-widgetname="_widget_proof2"><div class="field-component"><div class="fx-sub-select"><div class="select-container"><input class="select-input"><i class="icon-widget-upload"></i></div></div></div></div></div>
          <div class="row-head"><div class="row-num">2</div></div>
        </div></div></div>
      </div><div class="btn-pane"><button type="button" class="x-button btn-add"><span>添加</span></button><button type="button" class="x-button btn-paste"><span>快速填报</span></button></div></div></div>
    </div>
    <button type="button" class="x-button style-primary button op-forward" title="提交"><span>提交</span></button>
    <script>
      window.comboClicks = 0; window.radioClicks = 0;
      document.querySelector('[data-widgetname="_widget_gender"] .x-combo-dropdown-label').addEventListener('click', event => {
        window.comboClicks++;
        document.querySelectorAll('.x-popup').forEach(node => node.remove());
        const trigger = event.currentTarget.closest('.fx-combo-trigger');
        const rect = trigger.getBoundingClientRect();
        const popup = document.createElement('div');
        popup.className = 'x-popup placement-bottom-left x-combo-dropdown x-combo-dropdown-content';
        popup.style.position = 'absolute'; popup.style.left = rect.left + 'px'; popup.style.top = (rect.bottom + 4) + 'px'; popup.style.minWidth = rect.width + 'px';
        popup.innerHTML = '<div class="x-combo-dropdown-wrapper fx-combo-wrapper has-search"><div class="inner-wrapper"><div class="x-combo-dropdown-list"><div class="x-combo-dropdown-item" title="男"><div class="x-combo-dropdown-item-content">男</div></div><div class="x-combo-dropdown-item" title="女"><div class="x-combo-dropdown-item-content">女</div></div></div></div></div>';
        popup.addEventListener('click', click => { const option = click.target.closest('.x-combo-dropdown-item'); if (!option) return; const value = trigger.querySelector('.value-content'); trigger.title = option.getAttribute('title'); value.textContent = option.getAttribute('title'); popup.remove(); });
        document.body.append(popup);
      });
      document.querySelector('[data-widgetname="_widget_empty_combo"] .x-combo-dropdown-label').addEventListener('click', event => {
        document.querySelectorAll('.x-popup').forEach(node => node.remove());
        const popup = document.createElement('div');
        popup.className = 'x-popup placement-bottom-left x-combo-dropdown x-combo-dropdown-content';
        popup.innerHTML = '<div class="x-combo-dropdown-wrapper fx-combo-wrapper"><div class="inner-wrapper"><div class="x-combo-dropdown-list"><div class="dropdown-empty">没有可选择的数据</div></div></div></div>';
        document.body.append(popup);
      });
      document.querySelector('[data-widgetname="_widget_language"] .x-combo-dropdown-label').addEventListener('click', event => {
        window.multiClicks = (window.multiClicks || 0) + 1;
        document.querySelectorAll('.x-popup').forEach(node => node.remove());
        const trigger = event.currentTarget.closest('.fx-combocheck-trigger');
        const rect = trigger.getBoundingClientRect();
        const popup = document.createElement('div');
        popup.className = 'x-popup placement-bottom-left x-combo-dropdown x-combo-dropdown-content';
        popup.style.position = 'absolute'; popup.style.left = rect.left + 'px'; popup.style.top = (rect.bottom + 4) + 'px'; popup.style.minWidth = rect.width + 'px';
        const options = window.multiMode === 'duplicate' ? ['日语N1', '日语N1'] : window.multiMode === 'empty' ? [] : ['英语六级550+', '日语N1', '粤语'];
        popup.innerHTML = '<div class="x-combo-dropdown-wrapper fx-combocheck-wrapper has-search"><div class="inner-wrapper"><div class="x-combo-dropdown-list">' + (options.length ? '<div class="x-combo-dropdown-item check-all-item is-multi"><span class="check-icon"></span><div class="x-combo-dropdown-item-content">全选</div></div>' + (window.multiMode === 'notitle' ? '<div class="x-combo-dropdown-item is-multi"><span class="check-icon"></span><div class="x-combo-dropdown-item-content">无标题选项</div></div>' : '') + options.map(label => '<div class="x-combo-dropdown-item is-multi" title="' + label + '"><span class="check-icon"></span><div class="x-combo-dropdown-item-content">' + label + '</div></div>').join('') : '<div class="dropdown-empty">没有可选择的数据</div>') + '</div></div></div>';
        popup.addEventListener('click', click => {
          const option = click.target.closest('.x-combo-dropdown-item');
          if (!option) return;
          option.classList.add('selected');
          option.querySelector('.check-icon')?.classList.add('check-checked');
          const value = trigger.querySelector('.value-content');
          const labels = option.classList.contains('check-all-item') ? options : [option.getAttribute('title')];
          if (window.multiMode === 'plain') value.textContent = labels.join(', ');
          else for (const label of labels) if (!value.querySelector('[title="' + label + '"]')) value.insertAdjacentHTML('beforeend', '<span class="value-tag" title="' + label + '">' + label + '</span>');
          if (window.multiMode === 'external-after-first' && !value.querySelector('[title="外部值"]')) value.insertAdjacentHTML('beforeend', '<span class="value-tag" title="外部值">外部值</span>');
        });
        document.body.append(popup);
      });
      document.querySelectorAll('.fx-sub-select .select-container').forEach(container => container.addEventListener('click', event => {
        window.proofClicks = (window.proofClicks || 0) + 1;
        const mode = String(window.proofMode || '');
        if (mode !== 'multi-popups' && !mode.includes('keep-popovers')) document.querySelectorAll('.x-popover').forEach(node => node.remove());
        const source = event.currentTarget.closest('.fx-sub-field')?.getAttribute('data-widgetname') || event.currentTarget.closest('.fx-field')?.getAttribute('data-widgetname') || '';
        const make = suffix => {
          const popup = document.createElement('div');
          popup.className = 'x-popup placement-bottom-left x-popover x-popover-content';
          popup.dataset.source = source + (suffix || '');
          const accept = mode.includes('accept-pdf') ? ' accept=".pdf"' : '';
          const limit = mode.includes('too-small') ? '单个1MB以内' : '单个500MB以内';
          popup.innerHTML = '<div class="select-container">选择</div><div class="upload-area-text">拖拽或Ctrl+v粘贴文件，' + limit + '</div><input type="file" name="file" class="x-upload-input" multiple' + accept + '>';
          const input = popup.querySelector('input[type=file]');
          input.addEventListener('change', () => {
            window.proofUploads = (window.proofUploads || []);
            window.proofUploads.push({ source, names: [...input.files].map(file => file.name), sizes: [...input.files].map(file => file.size) });
            if (mode === 'reset') input.value = '';
            if (mode.includes('reset-async')) setTimeout(() => { input.value = ''; }, 0);
            if (mode.includes('replace-input-after-change')) input.replaceWith(input.cloneNode(true));
            if (mode.includes('replace-popup-after-change')) popup.replaceWith(popup.cloneNode(true));
          });
          document.body.append(popup);
        };
        make('');
        if (mode === 'multi-popups') make('-extra');
      }));
      document.querySelectorAll('.x-radio-wrapper').forEach(wrapper => wrapper.addEventListener('click', () => {
        window.radioClicks++;
        const radio = wrapper.closest('.x-radio');
        setTimeout(() => {
          radio.parentElement.querySelectorAll('.x-radio').forEach(item => item.classList.remove('is-selected','checked','radio-checked'));
          radio.classList.add('radio-checked');
        }, 20);
      }));
      document.querySelectorAll('.fx-form-datetime input').forEach(input => input.addEventListener('blur', () => {
        if (/^\\d{4}-\\d{2}(-\\d{2})?$/.test(input.value)) input.closest('.fx-form-datetime').querySelector('.x-datetime')?.classList.add('select','value');
      }));
    </script>
  </div></div></body></html>`;
}

function receiptPortalHtml(mode = 'success') {
  return portalHtml().replace('</script>', `
      window.uploadFixtureMode = ${JSON.stringify(mode)};
      document.querySelectorAll('.fx-form-file input[type=file]').forEach(input => input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        const component = input.closest('.fx-form-file');
        const field = input.closest('.fx-field');
        const widget = field?.getAttribute('data-widgetname') || '';
        const mode = window.uploadFixtureMode;
        input.value = '';
        const tokenBody = { appId: 'app', entryId: 'entry', formId: 'form', fileCount: 1, fileNames: [mode === 'wrong-name' ? 'other.pdf' : file.name], widgetName: mode === 'wrong-widget' ? '_foreign_widget' : widget, widgetType: 'file', type: 'file' };
        if (mode === 'wrong-frame') {
          const frame = document.createElement('iframe');
          frame.srcdoc = '<script>fetch("https://demo.jiandaoyun.com/_/data/upload_token/file",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(' + JSON.stringify(tokenBody).replace(/</g, '\\u003c') + ')})<\\/script>';
          document.body.append(frame);
          return;
        }
        let item;
        if (mode === 'no-token-qiniu-success') item = { token: 'fixture-token', url: 'https://upload.qiniup.com' };
        else {
          const tokenEndpoint = mode === 'lookalike-origin' ? 'https://eviljiandaoyun.com/_/data/upload_token/file' : '/_/data/upload_token/file';
          const tokenResponse = await fetch(tokenEndpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(tokenBody) });
          const tokenJson = await tokenResponse.json();
          item = { token: tokenJson.tokenList[0], url: tokenJson.url };
        }
        await Promise.resolve();
        const form = new FormData();
        form.append('token', item.token);
        if (mode === 'wrong-file-original-in-text') form.append('note', await file.text());
        form.append('file', mode === 'wrong-body' || mode === 'wrong-file-original-in-text' ? new File([new Uint8Array([1,2,3])], file.name, { type: file.type }) : file, file.name);
        const uploadUrl = mode === 'delay-token-query-upload' ? item.url + '?late=1' : item.url;
        const uploadResponse = await fetch(uploadUrl, { method: 'POST', body: form });
        const uploadJson = await uploadResponse.json();
        if (mode === 'component-drift') field.querySelector('.field-name').textContent = '提交确认';
        if (mode !== 'no-dom') {
          component.querySelector('.x-upload-wrapper')?.classList.add('disable');
          const displayedName = mode === 'wrong-dom-prefix' ? 'prefix-' + uploadJson.file.name : uploadJson.file.name;
          component.insertAdjacentHTML('beforeend', '<div class="upload-list-wrapper"><div class="upload-item-wrapper"><div class="fx-file-item has-delete is-short-mode">' + displayedName + '</div></div></div>');
        }
      }));
    </script>`);
}

async function openReceiptPortal(page, mode = 'success') {
  await page.route('https://demo.jiandaoyun.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/form') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: receiptPortalHtml(mode) });
    if (url.pathname === '/_/data/upload_token/file') {
      if (mode === 'token-hang') return new Promise(() => {});
      if (mode === 'no-token') return route.abort();
      if (mode === 'duplicate-token') {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: 'https://upload.qiniup.com', tokenList: ['fixture-token-a', 'fixture-token-b'] }) });
      }
      if (mode === 'userinfo-url') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: 'https://user:pass@upload.qiniup.com', tokenList: ['fixture-token'] }) });
      if (mode === 'short-token') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: 'https://upload.qiniup.com', tokenList: ['short'] }) });
      if (mode === 'token-delay' || mode === 'delay-token-query-upload') await new Promise(resolve => setTimeout(resolve, 200));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: 'https://upload.qiniup.com' + (mode === 'query-upload' ? '?x=1' : ''), tokenList: ['fixture-token'] }) });
    }
    return route.abort();
  });
  await page.route('https://eviljiandaoyun.com/**', async route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: 'https://upload.qiniup.com', tokenList: ['fixture-token'] }) }));
  await page.route('https://upload.qiniup.com/**', async route => {
    const request = route.request();
    const body = request.postDataBuffer();
    const text = body?.toString('latin1') || '';
    const nameMatch = /filename="([^"]+)"/.exec(text);
    const name = nameMatch?.[1] || 'resume.pdf';
    const okBody = body?.includes(Buffer.from('fixture-token')) && body?.includes(Buffer.from('resume-bytes'));
    if (!okBody) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ file: { _id: 'file-id', bucket: 'b', downloadUrl: 'u', key: 'k', mime: 'application/pdf', name, previewUrl: 'p', qnKey: 'q', size: Buffer.from('resume-bytes').length, uploadTime: 1, url: 'u' } }) });
    if (mode === 'nested-file') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ data: { file: { _id: 'file-id', bucket: 'b', downloadUrl: 'u', key: 'key', mime: 'application/pdf', name, previewUrl: 'p', qnKey: 'q', size: Buffer.from('resume-bytes').length, uploadTime: 1, url: 'u' } } }) });
    const wrong = mode === 'wrong-response';
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ file: { _id: wrong ? '' : 'file-id', bucket: 'b', downloadUrl: 'u', key: wrong ? '' : 'key', mime: 'application/pdf', name: wrong ? 'other.pdf' : name, previewUrl: 'p', qnKey: 'q', size: mode === 'size-string' ? String(Buffer.from('resume-bytes').length) : wrong ? 999 : Buffer.from('resume-bytes').length, uploadTime: 1, url: 'u' } }) });
  });
  await page.goto('https://demo.jiandaoyun.com/form');
}

async function openPortal(page, html = portalHtml()) {
  await page.route('https://demo.jiandaoyun.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('https://demo.jiandaoyun.com/form');
}

test('scan discovers supported Jiandaoyun controls without opening popups', async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await openPortal(page);
    const entries = await scanJiandaoyunControls(page, forbiddenPattern);
    assert.equal(await page.locator('.x-popup.x-combo-dropdown').count(), 0);
    assert.equal(await page.evaluate(() => window.comboClicks), 0);
    assert.equal(await page.locator('[data-widgetname="_widget_gender"] .value-content').textContent(), '');
    const byLabel = Object.fromEntries(entries.map(entry => [entry.meta.label, entry]));
    assert.equal(byLabel['姓名'].meta.unsupported, false);
    assert.equal(byLabel['性别'].meta.unsupported, false);
    assert.equal(byLabel['籍贯'].meta.unsupported, false);
    assert.equal(byLabel['是否接受岗位调剂'].meta.unsupported, false);
    assert.equal(byLabel['语言特长'].meta.unsupported, false);
    assert.equal(byLabel['出生年月'].meta.unsupported, false);
    assert.equal(byLabel['简历附件'].meta.unsupported, false);
    assert.equal(byLabel['简历附件'].meta.type, 'file');
    assert.equal(byLabel['简历附件'].meta.accept, '.pdf,.docx');
    assert.equal(byLabel['简历附件'].meta.maxFileBytes, 2 * 1024 * 1024);
    assert.equal(byLabel['作品集/项目材料'].meta.maxFileBytes, 500 * 1024 * 1024);
    assert.equal(byLabel['严格附件'].meta.maxFileBytes, 2 * 1024 * 1024);
    assert.equal(entries.find(entry => entry.meta.section === '实习经历' && entry.meta.label === '公司').meta.unsupported, false);
    assert.equal(entries.find(entry => entry.meta.section === '实习经历' && entry.meta.label === '工作描述').meta.unsupported, false);
    assert.equal(entries.find(entry => entry.meta.section === '实习经历' && entry.meta.label === '开始时间').meta.unsupported, false);
    assert.equal(entries.find(entry => entry.meta.section === '实习经历' && entry.meta.label === '工作描述' && entry.meta.recordIndex === 1).meta.maxLength, 10);
    const proof = entries.find(entry => entry.meta.section === '实习经历' && entry.meta.label === '获奖证明' && entry.meta.recordIndex === 0);
    assert.equal(proof.meta.type, 'file');
    assert.equal(proof.meta.proofFile, true);
    assert.equal(proof.meta.unsupported, false);
    assert.equal(proof.meta.accept, '');
    assert.equal(proof.meta.maxFileBytes, null);
    const ordinarySubSelect = entries.find(entry => entry.meta.label === '普通子选择');
    assert.equal(ordinarySubSelect.meta.type, 'jiandaoyun-sub-select');
    assert.equal(ordinarySubSelect.meta.unsupported, true);
    assert.ok(entries.every(entry => entry.jiandaoyun));
  } finally { await browser.close(); }
});

test('Jiandaoyun file controls accept only authorized blank attachment writes', async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await openPortal(page);
    const document = await page.evaluateHandle(() => document);
    const entries = await scanJiandaoyunControls(page, forbiddenPattern);
    const resume = entries.find(item => item.meta.label === '简历附件');
    const base = { document, url: page.url(), frameOwners: [], forbiddenPattern };
    const attachment = { name: 'resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('resume-bytes') };

    assert.equal(await fillJiandaoyunControl(resume, { ...base, attachment, validateAnswer: () => false }), 'missing_evidence');
    assert.equal(await fillJiandaoyunControl(resume, { ...base, attachment, validateAnswer: () => true }), 'attachment_selected');
    assert.deepEqual(await page.locator('[data-widgetname="_widget_file"] input').evaluate(input => [...input.files].map(file => ({ name: file.name, size: file.size }))), [{ name: 'resume.pdf', size: attachment.buffer.length }]);
    assert.equal(await page.evaluate(() => window.submits || 0), 0);
    assert.equal(await fillJiandaoyunControl(resume, { ...base, attachment, validateAnswer: () => true }), 'preserved');

    await openPortal(page);
    const occupiedDocument = await page.evaluateHandle(() => document);
    await page.locator('[data-widgetname="_widget_file"] .fx-form-file').evaluate(node => { node.insertAdjacentHTML('beforeend', '<div class="file-list"><span title="old.pdf">old.pdf</span></div>'); });
    const occupiedEntry = (await scanJiandaoyunControls(page, forbiddenPattern)).find(item => item.meta.label === '简历附件');
    assert.equal(occupiedEntry.meta.occupied, true);
    assert.equal(await fillJiandaoyunControl(occupiedEntry, { document: occupiedDocument, url: page.url(), frameOwners: [], forbiddenPattern, attachment, validateAnswer: () => true }), 'preserved');

    await openPortal(page);
    const driftDocument = await page.evaluateHandle(() => document);
    const driftEntry = (await scanJiandaoyunControls(page, forbiddenPattern)).find(item => item.meta.label === '简历附件');
    await page.locator('[data-widgetname="_widget_file"] input').evaluate(input => { input.accept = '.png'; });
    assert.equal(await fillJiandaoyunControl(driftEntry, { document: driftDocument, url: page.url(), frameOwners: [], forbiddenPattern, attachment, validateAnswer: () => true }), 'changed');

    await openPortal(page);
    const labelDocument = await page.evaluateHandle(() => document);
    const labelEntry = (await scanJiandaoyunControls(page, forbiddenPattern)).find(item => item.meta.label === '简历附件');
    await page.locator('[data-widgetname="_widget_file"] .field-name').evaluate(node => { node.textContent = '提交确认'; });
    assert.equal(await fillJiandaoyunControl(labelEntry, { document: labelDocument, url: page.url(), frameOwners: [], forbiddenPattern, attachment, validateAnswer: () => true }), 'changed');

    await openPortal(page);
    const oversizeDocument = await page.evaluateHandle(() => document);
    const oversizeEntry = (await scanJiandaoyunControls(page, forbiddenPattern)).find(item => item.meta.label === '简历附件');
    assert.equal(await fillJiandaoyunControl(oversizeEntry, { document: oversizeDocument, url: page.url(), frameOwners: [], forbiddenPattern, attachment: { name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(2 * 1024 * 1024 + 1) }, validateAnswer: () => true }), 'too_large');

    await openPortal(page);
    const resetDocument = await page.evaluateHandle(() => document);
    const resetEntry = (await scanJiandaoyunControls(page, forbiddenPattern)).find(item => item.meta.label === '简历附件');
    await page.locator('[data-widgetname="_widget_file"] input').evaluate(input => input.addEventListener('change', () => { input.value = ''; }));
    assert.equal(await fillJiandaoyunControl(resetEntry, { document: resetDocument, url: page.url(), frameOwners: [], forbiddenPattern, attachment, validateAnswer: () => true }), 'failed');
  } finally { await browser.close(); }
});


test('Jiandaoyun native file receipt requires token, upload response and source DOM confirmation', async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    async function run(mode, expected, options = {}) {
      const page = await browser.newPage();
      try {
        await openReceiptPortal(page, mode);
        const document = await page.evaluateHandle(() => document);
        const [resume] = (await scanJiandaoyunControls(page, forbiddenPattern)).filter(item => item.meta.label === '简历附件');
        assert.equal(resume.frame, page.mainFrame());
        const attachment = { name: 'resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('resume-bytes') };
        const beforeRequestListeners = page.listenerCount('request');
        const beforeResponseListeners = page.listenerCount('response');
        const controller = options.abort ? new AbortController() : null;
        if (controller) setTimeout(() => controller.abort(), 80);
        const fill = fillJiandaoyunControl(resume, { document, url: page.url(), frameOwners: [], forbiddenPattern, attachment, validateAnswer: () => !options.revokeEvidence, signal: controller?.signal });
        if (options.abort) await assert.rejects(fill, { name: 'AbortError' });
        else assert.equal(await fill, expected);
        assert.equal(page.listenerCount('request'), beforeRequestListeners, 'request observer is disposed');
        assert.equal(page.listenerCount('response'), beforeResponseListeners, 'response observer is disposed');
        return page;
      } finally { await page.close(); }
    }

    await run('success', 'attachment_uploaded');
    await run('wrong-widget', 'changed');
    await run('wrong-name', 'changed');
    await run('wrong-frame', 'changed');
    await run('lookalike-origin', 'failed');
    await run('userinfo-url', 'changed');
    await run('query-upload', 'changed');
    await run('delay-token-query-upload', 'changed');
    await run('short-token', 'changed');
    await run('wrong-body', 'failed');
    await run('wrong-file-original-in-text', 'failed');
    await run('token-delay', 'attachment_uploaded');
    await run('no-token-qiniu-success', 'failed');
    await run('no-token', 'failed');
    await run('wrong-response', 'failed');
    await run('nested-file', 'failed');
    await run('size-string', 'failed');
    await run('wrong-dom-prefix', 'failed');
    await run('no-dom', 'failed');
    await run('component-drift', 'changed');
    await run('duplicate-token', 'changed');
    await run('success', 'missing_evidence', { revokeEvidence: true });
    await run('token-hang', 'aborted', { abort: true });
  } finally { await browser.close(); }
});

test('Jiandaoyun award proof file popup selects only the bound row input', async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    const attachment = { name: 'award.pdf', mimeType: 'application/pdf', buffer: Buffer.from('award-proof') };
    const baseFor = document => ({ document, url: page.url(), frameOwners: [], forbiddenPattern, attachment, validateAnswer: () => true });
    const proofEntries = entries => entries.filter(item => item.meta.section === '实习经历' && item.meta.label === '获奖证明').sort((a, b) => a.meta.recordIndex - b.meta.recordIndex);

    await openPortal(page);
    await page.evaluate(() => { window.proofMode = 'keep-popovers'; });
    let document = await page.evaluateHandle(() => document);
    let entries = await scanJiandaoyunControls(page, forbiddenPattern);
    let [firstProof, secondProof] = proofEntries(entries);
    assert.equal(await page.locator('.x-popover').count(), 0, 'scan does not open proof popovers');
    assert.equal(await page.evaluate(() => window.proofClicks || 0), 0, 'scan does not click proof controls');
    assert.equal(await fillJiandaoyunControl(firstProof, { ...baseFor(document), validateAnswer: () => false }), 'missing_evidence');
    assert.equal(await fillJiandaoyunControl(firstProof, baseFor(document)), 'attachment_selected');
    assert.equal(await page.locator('[data-widgetname="_widget_file"] input[type=file]').evaluate(input => input.files.length), 0, 'global resume input is not used');
    assert.deepEqual(await page.locator('.x-popover input[type=file]').first().evaluate(input => [...input.files].map(file => ({ name: file.name, size: file.size }))), [{ name: attachment.name, size: attachment.buffer.length }]);
    assert.deepEqual(await page.evaluate(() => window.proofUploads.map(item => item.source)), ['_widget_proof']);
    assert.equal(await fillJiandaoyunControl(firstProof, baseFor(document)), 'preserved');
    assert.equal(await fillJiandaoyunControl(secondProof, baseFor(document)), 'attachment_selected');
    assert.deepEqual(await page.evaluate(() => window.proofUploads.map(item => item.source)), ['_widget_proof', '_widget_proof2']);
    assert.deepEqual(await page.locator('.x-popover input[type=file]').evaluateAll(inputs => inputs.map(input => [...input.files].map(file => ({ name: file.name, size: file.size })))), [
      [{ name: attachment.name, size: attachment.buffer.length }],
      [{ name: attachment.name, size: attachment.buffer.length }]
    ]);

    await openPortal(page);
    document = await page.evaluateHandle(() => document);
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    [firstProof] = proofEntries(entries);
    await page.locator('[data-widgetname="_widget_proof"] .fx-sub-select').evaluate(node => { node.insertAdjacentHTML('beforeend', '<span class="upload-file">old.pdf</span>'); });
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    [firstProof] = proofEntries(entries);
    assert.equal(firstProof.meta.occupied, true);
    assert.equal(await fillJiandaoyunControl(firstProof, baseFor(document)), 'preserved');

    await openPortal(page);
    document = await page.evaluateHandle(() => document);
    await page.evaluate(() => { window.proofMode = 'multi-popups'; });
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    [firstProof] = proofEntries(entries);
    assert.equal(await fillJiandaoyunControl(firstProof, baseFor(document)), 'changed');
    assert.equal(await page.locator('[data-widgetname="_widget_file"] input[type=file]').evaluate(input => input.files.length), 0);

    await openPortal(page);
    document = await page.evaluateHandle(() => document);
    await page.evaluate(() => { window.proofMode = 'accept-pdf'; });
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    [firstProof] = proofEntries(entries);
    assert.equal(await fillJiandaoyunControl(firstProof, { ...baseFor(document), attachment: { name: 'award.png', mimeType: 'image/png', buffer: Buffer.from('png') } }), 'attachment_mismatch');

    await openPortal(page);
    document = await page.evaluateHandle(() => document);
    await page.evaluate(() => { window.proofMode = 'too-small'; });
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    [firstProof] = proofEntries(entries);
    assert.equal(await fillJiandaoyunControl(firstProof, { ...baseFor(document), attachment: { name: 'award.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(1024 * 1024 + 1) } }), 'too_large');

    await openPortal(page);
    document = await page.evaluateHandle(() => document);
    await page.evaluate(() => { window.proofMode = 'reset'; });
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    [firstProof] = proofEntries(entries);
    assert.equal(await fillJiandaoyunControl(firstProof, baseFor(document)), 'failed');

    await openPortal(page);
    document = await page.evaluateHandle(() => document);
    await page.evaluate(({ name, mimeType, size }) => {
      window.proofMode = 'keep-popovers-reset-async';
      const popup = document.createElement('div');
      popup.className = 'x-popup placement-bottom-left x-popover x-popover-content';
      popup.dataset.source = 'foreign';
      popup.innerHTML = '<div class="upload-area-text">单个500MB以内</div><input type="file" name="file" class="x-upload-input">';
      const input = popup.querySelector('input[type=file]');
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(size)], name, { type: mimeType }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files').set.call(input, transfer.files);
      document.body.append(popup);
    }, { name: attachment.name, mimeType: attachment.mimeType, size: attachment.buffer.length });
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    [firstProof] = proofEntries(entries);
    assert.equal(await fillJiandaoyunControl(firstProof, baseFor(document)), 'failed', 'foreign same-name file cannot satisfy proof verification after own async reset');
    assert.equal(await page.locator('.x-popover[data-source="foreign"] input[type=file]').evaluate(input => input.files.length), 1);

    await openPortal(page);
    document = await page.evaluateHandle(() => document);
    await page.evaluate(() => { window.proofMode = 'replace-input-after-change'; });
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    [firstProof] = proofEntries(entries);
    assert.equal(await fillJiandaoyunControl(firstProof, baseFor(document)), 'changed');

    await openPortal(page);
    document = await page.evaluateHandle(() => document);
    await page.evaluate(() => { window.proofMode = 'replace-popup-after-change'; });
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    [firstProof] = proofEntries(entries);
    assert.equal(await fillJiandaoyunControl(firstProof, baseFor(document)), 'changed');

    await openPortal(page);
    document = await page.evaluateHandle(() => document);
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    [firstProof] = proofEntries(entries);
    await page.locator('[data-widgetname="_widget_exp"] .subform-title[title="获奖证明"]').evaluate(node => { node.setAttribute('title', '提交证明'); node.textContent = '提交证明'; });
    assert.equal(await fillJiandaoyunControl(firstProof, baseFor(document)), 'changed');
  } finally { await browser.close(); }
});

test('Jiandaoyun multiselect fills only blank exact unique option arrays', async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await openPortal(page);
    let document = await page.evaluateHandle(() => document);
    let entries = await scanJiandaoyunControls(page, forbiddenPattern);
    let language = entries.find(item => item.meta.label === '语言特长');
    const base = () => ({ document, url: page.url(), frameOwners: [], forbiddenPattern });

    assert.equal(await fillJiandaoyunControl(language, { ...base(), value: '日语N1' }), 'unsupported');
    assert.equal(await fillJiandaoyunControl(language, { ...base(), value: ['英语六级550+', '日语N1'] }), 'filled');
    assert.deepEqual(await page.locator('[data-widgetname="_widget_language"] .value-tag').evaluateAll(nodes => nodes.map(node => node.getAttribute('title'))), ['英语六级550+', '日语N1']);

    await openPortal(page);
    document = await page.evaluateHandle(() => document);
    await page.evaluate(() => { window.multiMode = 'plain'; });
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    language = entries.find(item => item.meta.label === '语言特长');
    assert.equal(await fillJiandaoyunControl(language, { ...base(), value: ['日语N1'] }), 'filled');
    assert.equal(await page.locator('[data-widgetname="_widget_language"] .value-content').textContent(), '日语N1');
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    language = entries.find(item => item.meta.label === '语言特长');
    assert.equal(language.meta.occupied, true);
    assert.equal(await fillJiandaoyunControl(language, { ...base(), value: ['粤语'] }), 'preserved');

    await openPortal(page);
    document = await page.evaluateHandle(() => document);
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    language = entries.find(item => item.meta.label === '语言特长');
    await page.locator('[data-widgetname="_widget_language"] .value-content').evaluate(node => { node.innerHTML = '<span class="value-tag" title="粤语">粤语</span>'; });
    assert.equal(await fillJiandaoyunControl(language, { ...base(), value: ['日语N1'] }), 'preserved');
    assert.deepEqual(await page.locator('[data-widgetname="_widget_language"] .value-tag').evaluateAll(nodes => nodes.map(node => node.getAttribute('title'))), ['粤语']);

    await openPortal(page);
    document = await page.evaluateHandle(() => document);
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    language = entries.find(item => item.meta.label === '语言特长');
    assert.equal(await fillJiandaoyunControl(language, { ...base(), value: ['不存在'] }), 'no_match');
    assert.equal(await page.locator('[data-widgetname="_widget_language"] .value-tag').count(), 0);

    await openPortal(page);
    document = await page.evaluateHandle(() => document);
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    language = entries.find(item => item.meta.label === '语言特长');
    assert.equal(await fillJiandaoyunControl(language, { ...base(), value: ['全选'] }), 'no_match');
    assert.equal(await page.locator('[data-widgetname="_widget_language"] .value-tag').count(), 0);

    await openPortal(page);
    document = await page.evaluateHandle(() => document);
    await page.evaluate(() => { window.multiMode = 'notitle'; });
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    language = entries.find(item => item.meta.label === '语言特长');
    assert.equal(await fillJiandaoyunControl(language, { ...base(), value: ['无标题选项'] }), 'no_match');
    assert.equal(await page.locator('[data-widgetname="_widget_language"] .value-tag').count(), 0);

    await openPortal(page);
    document = await page.evaluateHandle(() => document);
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    language = entries.find(item => item.meta.label === '语言特长');
    assert.equal(await fillJiandaoyunControl(language, { ...base(), value: ['英语六级550+', '不存在'] }), 'no_match');
    assert.equal(await page.locator('[data-widgetname="_widget_language"] .value-tag').count(), 0);

    await openPortal(page);
    document = await page.evaluateHandle(() => document);
    await page.evaluate(() => { window.multiMode = 'duplicate'; });
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    language = entries.find(item => item.meta.label === '语言特长');
    assert.equal(await fillJiandaoyunControl(language, { ...base(), value: ['日语N1'] }), 'no_match');
    assert.equal(await page.locator('[data-widgetname="_widget_language"] .value-tag').count(), 0);

    await openPortal(page);
    document = await page.evaluateHandle(() => document);
    await page.evaluate(() => { window.multiMode = 'duplicate'; });
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    language = entries.find(item => item.meta.label === '语言特长');
    assert.equal(await fillJiandaoyunControl(language, { ...base(), value: ['英语六级550+', '日语N1'] }), 'no_match');
    assert.equal(await page.locator('[data-widgetname="_widget_language"] .value-tag').count(), 0);

    await openPortal(page);
    document = await page.evaluateHandle(() => document);
    await page.evaluate(() => { window.multiMode = 'external-after-first'; });
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    language = entries.find(item => item.meta.label === '语言特长');
    assert.equal(await fillJiandaoyunControl(language, { ...base(), value: ['英语六级550+', '日语N1'] }), 'changed');
    assert.deepEqual(await page.locator('[data-widgetname="_widget_language"] .value-tag').evaluateAll(nodes => nodes.map(node => node.getAttribute('title'))), ['英语六级550+', '外部值']);

    await openPortal(page);
    document = await page.evaluateHandle(() => document);
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    language = entries.find(item => item.meta.label === '语言特长');
    await page.locator('[data-widgetname="_widget_language"] .field-name').evaluate(node => { node.textContent = '同意授权'; });
    assert.equal(await fillJiandaoyunControl(language, { ...base(), value: ['日语N1'] }), 'changed');

    await openPortal(page);
    document = await page.evaluateHandle(() => document);
    await page.evaluate(() => { window.multiMode = 'empty'; });
    entries = await scanJiandaoyunControls(page, forbiddenPattern);
    language = entries.find(item => item.meta.label === '语言特长');
    assert.equal(await fillJiandaoyunControl(language, { ...base(), value: ['日语N1'] }), 'no_match');
  } finally { await browser.close(); }
});

test('fill writes only blank Jiandaoyun text, textarea, radio and single combo controls', async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await openPortal(page);
    const document = await page.evaluateHandle(() => document);
    const entries = await scanJiandaoyunControls(page, forbiddenPattern);
    const entry = label => entries.find(item => item.meta.label === label && !item.meta.section);
    const company = entries.find(item => item.meta.section === '实习经历' && item.meta.label === '公司');
    const secondCompany = entries.find(item => item.meta.section === '实习经历' && item.meta.label === '公司' && item.meta.recordIndex === 1);
    const desc = entries.find(item => item.meta.section === '实习经历' && item.meta.label === '工作描述');
    const secondDesc = entries.find(item => item.meta.section === '实习经历' && item.meta.label === '工作描述' && item.meta.recordIndex === 1);
    const base = { document, url: page.url(), frameOwners: [], forbiddenPattern };

    assert.equal(await fillJiandaoyunControl(entry('姓名'), { ...base, value: '张三', validateAnswer: () => true, answer: { fieldId: entry('姓名').meta.id } }), 'filled');
    assert.equal(await page.locator('[data-widgetname="_widget_name"] input').inputValue(), '张三');
    assert.equal(await fillJiandaoyunControl(entry('姓名'), { ...base, value: '李四', validateAnswer: () => true }), 'preserved');
    assert.equal(await page.locator('[data-widgetname="_widget_name"] input').inputValue(), '张三');

    assert.equal(await fillJiandaoyunControl(company, { ...base, value: '帆软' }), 'filled');
    assert.equal(await page.locator('[data-widgetname="_widget_company"] input').inputValue(), '帆软');
    assert.equal(await fillJiandaoyunControl(secondCompany, { ...base, value: '简道云' }), 'filled');
    assert.equal(await page.locator('[data-widgetname="_widget_company2"] input').inputValue(), '简道云');
    assert.equal(await fillJiandaoyunControl(desc, { ...base, value: '负'.repeat(600) }), 'filled');
    assert.equal(await page.locator('[data-widgetname="_widget_desc"] textarea').inputValue(), '负'.repeat(600));
    assert.equal(await fillJiandaoyunControl(secondDesc, { ...base, value: '超过十个字符的工作描述' }), 'too_long');

    assert.equal(await fillJiandaoyunControl(entry('是否接受岗位调剂'), { ...base, value: '否' }), 'filled');
    assert.equal(await page.locator('[data-widgetname="_widget_adjust"] .x-radio.radio-checked .text-wrapper').textContent(), '否');
    assert.equal(await fillJiandaoyunControl(entry('是否内推'), { ...base, value: '是' }), 'preserved');
    assert.equal(await page.locator('[data-widgetname="_widget_referral"] .x-radio.radio-checked .text-wrapper').textContent(), '否');

    assert.equal(await fillJiandaoyunControl(entry('籍贯'), { ...base, value: '上海' }), 'options_unavailable');
    await page.locator('.fx-field .field-name').filter({ hasText: /^姓名$/ }).click();
    await page.locator('.x-popup').evaluateAll(nodes => nodes.forEach(node => node.remove()));

    assert.equal(await fillJiandaoyunControl(entry('性别'), { ...base, value: '女' }), 'filled');
    assert.equal(await page.locator('[data-widgetname="_widget_gender"] .value-content').textContent(), '女');
    assert.equal(await page.locator('[data-widgetname="_widget_gender"] .fx-combo-trigger').getAttribute('title'), '女');
    assert.equal(await page.evaluate(() => window.comboClicks), 1);
    assert.equal(await fillJiandaoyunControl(entry('出生年月'), { ...base, value: '2003-04' }), 'filled');
    assert.equal(await page.locator('[data-widgetname="_widget_birth"] input').inputValue(), '2003-04');
  } finally { await browser.close(); }
});

test('Jiandaoyun adapter rejects wrong host, missing root, purpose drift, evidence loss and ambiguous combo popups', async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://evil.example.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: portalHtml() }));
    await page.goto('https://evil.example.test/form');
    assert.deepEqual(await scanJiandaoyunControls(page, forbiddenPattern), []);

    await openPortal(page, '<div class="fx-form"><input></div>');
    assert.deepEqual(await scanJiandaoyunControls(page, forbiddenPattern), []);

    await openPortal(page);
    const document = await page.evaluateHandle(() => document);
    const entries = await scanJiandaoyunControls(page, forbiddenPattern);
    const name = entries.find(item => item.meta.label === '姓名');
    const gender = entries.find(item => item.meta.label === '性别');
    const base = { document, url: page.url(), frameOwners: [], forbiddenPattern };

    await page.locator('[data-widgetname="_widget_name"] .field-name').evaluate(node => { node.textContent = '同意隐私授权'; });
    assert.equal(await fillJiandaoyunControl(name, { ...base, value: '张三' }), 'changed');

    await openPortal(page);
    const freshDocument = await page.evaluateHandle(() => document);
    const fresh = await scanJiandaoyunControls(page, forbiddenPattern);
    const referral = fresh.find(item => item.meta.label === '内推码');
    assert.equal(await fillJiandaoyunControl(referral, { document: freshDocument, url: page.url(), frameOwners: [], forbiddenPattern, value: 'ABC', validateAnswer: () => false }), 'missing_evidence');

    await page.evaluate(() => {
      document.querySelector('[data-widgetname="_widget_gender"] .fx-combo-trigger').addEventListener('click', () => {
        const extra = document.createElement('div');
        extra.className = 'x-popup placement-bottom-left x-combo-dropdown x-combo-dropdown-content';
        extra.innerHTML = '<div class="x-combo-dropdown-wrapper fx-combo-wrapper"><div class="x-combo-dropdown-list"><div class="x-combo-dropdown-item">女</div></div></div>';
        document.body.append(extra);
      });
    });
    assert.equal(await fillJiandaoyunControl(gender, { ...base, document: freshDocument, url: page.url(), value: '女' }), 'changed');
  } finally { await browser.close(); }
});

test('Jiandaoyun adapter protects radio node identity and strict datetime semantics', async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await openPortal(page);
    const document = await page.evaluateHandle(() => document);
    const entries = await scanJiandaoyunControls(page, forbiddenPattern);
    const adjust = entries.find(item => item.meta.label === '是否接受岗位调剂');
    const birth = entries.find(item => item.meta.label === '出生年月');
    const base = { document, url: page.url(), frameOwners: [], forbiddenPattern };

    await page.locator('[data-widgetname="_widget_adjust"] .x-radio').first().evaluate(node => {
      const clone = node.cloneNode(true);
      node.replaceWith(clone);
      clone.querySelector('.x-radio-wrapper').addEventListener('click', () => clone.classList.add('radio-checked'));
    });
    assert.equal(await fillJiandaoyunControl(adjust, { ...base, value: '是' }), 'changed');

    assert.equal(await fillJiandaoyunControl(birth, { ...base, value: '2003-13' }), 'unsupported');
    assert.equal(await fillJiandaoyunControl(birth, { ...base, value: '2003-02-29' }), 'unsupported');
    assert.equal(await fillJiandaoyunControl(birth, { ...base, value: '2003-04' }), 'filled');
    assert.equal(await fillJiandaoyunControl(birth, { ...base, value: '2004-04' }), 'preserved');

    await openPortal(page);
    const focusDocument = await page.evaluateHandle(() => document);
    const focusBirth = (await scanJiandaoyunControls(page, forbiddenPattern)).find(item => item.meta.label === '出生年月');
    await page.locator('[data-widgetname="_widget_birth"] input').evaluate(input => input.addEventListener('focus', () => {
      input.value = '2001-03';
      input.closest('.fx-form-datetime').querySelector('.x-datetime')?.classList.add('select','value');
    }));
    assert.equal(await fillJiandaoyunControl(focusBirth, { document: focusDocument, url: page.url(), frameOwners: [], forbiddenPattern, value: '2003-04' }), 'preserved');
    assert.equal(await page.locator('[data-widgetname="_widget_birth"] input').inputValue(), '2001-03');
  } finally { await browser.close(); }
});
