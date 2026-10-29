import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const CONTROL_SELECTOR = '.fx-form-text,.fx-form-textarea,.fx-form-radiogroup,.fx-form-combo,.fx-form-combocheck,.fx-form-datetime,.fx-form-file,.fx-sub-select';

function isJiandaoyunUrl(value) {
  try {
    const { hostname, protocol } = new URL(value);
    return protocol === 'https:' && (hostname === 'jiandaoyun.com' || hostname.endsWith('.jiandaoyun.com'));
  } catch { return false; }
}

function isStrictIsoDate(value) {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = match[3] ? Number(match[3]) : null;
  if (month < 1 || month > 12) return false;
  if (day === null) return true;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function attachmentMatchesAccept(name, mimeType, accept) {
  if (!accept) return true;
  const lowerName = String(name || '').toLowerCase();
  const lowerMime = String(mimeType || '').toLowerCase();
  return String(accept).split(',').map(item => item.trim().toLowerCase()).filter(Boolean).some(token => {
    if (token.startsWith('.')) return lowerName.endsWith(token);
    if (token.endsWith('/*')) return lowerMime.startsWith(token.slice(0, -1));
    return lowerMime === token;
  });
}

function pageForFrame(frame) {
  if (!frame) return null;
  if (typeof frame.page === 'function') return frame.page();
  if (typeof frame.mainFrame === 'function') return frame;
  return null;
}

async function readJsonCapped(response, maxBytes = 64 * 1024) {
  const length = Number(response.headers()['content-length'] || 0);
  if (length > maxBytes) throw new Error('response too large');
  const body = await response.body();
  if (body.length > maxBytes) throw new Error('response too large');
  return JSON.parse(body.toString('utf8'));
}

function installJiandaoyunAttachmentReceiptObserver(entry, attachment) {
  const frame = entry?.frame;
  const page = pageForFrame(frame);
  if (!page || entry?.meta?.proofFile) return null;
  const expected = { name: attachment.name, size: attachment.buffer.length, mimeType: attachment.mimeType || '', widgetName: entry.meta.name };
  let scannedOrigin;
  try { scannedOrigin = new URL(frame.url()).origin; } catch { scannedOrigin = null; }
  const sourceBuffer = Buffer.from(attachment.buffer);
  const state = { tokenRequest: null, tokenResponseReady: false, token: null, uploadUrl: null, uploadRequest: null, uploadBodyValid: false, uploadReceiptValid: false, uploadResponseRequest: null, result: null };
  const settle = result => { if (!state.result) state.result = result; };
  const maybeUploaded = () => {
    if (state.tokenResponseReady && state.uploadBodyValid && state.uploadReceiptValid && state.uploadRequest?.request && state.uploadResponseRequest === state.uploadRequest.request) settle({ status: 'uploaded' });
  };
  const validateUploadRequest = async () => {
    if (!state.uploadRequest || !state.token || state.uploadBodyValid) return;
    const { request, body, contentType, frame: requestFrame } = state.uploadRequest;
    let requestUrl;
    try { requestUrl = new URL(request.url()); } catch { return settle({ status: 'changed', reason: 'upload_url' }); }
    if (requestFrame !== frame || (state.uploadUrl && requestUrl.href !== state.uploadUrl) || requestUrl.search || requestUrl.hash || requestUrl.username || requestUrl.password) return settle({ status: 'changed', reason: 'upload_source' });
    if (!body || body.length < sourceBuffer.length || body.length > sourceBuffer.length + 64 * 1024) return settle({ status: 'failed', reason: 'upload_body_size' });
    try {
      const form = await new Response(body, { headers: { 'content-type': contentType || '' } }).formData();
      const tokens = form.getAll('token');
      const files = form.getAll('file');
      if (tokens.length !== 1 || tokens[0] !== state.token || files.length !== 1 || !(files[0] instanceof File)) return settle({ status: 'failed', reason: 'upload_form' });
      const file = files[0];
      if (file.name !== expected.name || file.size !== expected.size || (expected.mimeType && file.type !== expected.mimeType)) return settle({ status: 'failed', reason: 'upload_file_meta' });
      const bytes = Buffer.from(await file.arrayBuffer());
      if (!bytes.equals(sourceBuffer)) return settle({ status: 'failed', reason: 'upload_file_bytes' });
      state.uploadBodyValid = true;
      state.uploadRequest.request = request;
      maybeUploaded();
    } catch { return settle({ status: 'failed', reason: 'upload_body_parse' }); }
  };
  const requestHandler = request => {
    try {
      const url = new URL(request.url());
      if (url.pathname === '/_/data/upload_token/file' && (url.hostname === 'jiandaoyun.com' || url.hostname.endsWith('.jiandaoyun.com'))) {
        if (request.method() !== 'POST' || request.frame() !== frame || !scannedOrigin || url.origin !== scannedOrigin) return settle({ status: 'changed', reason: 'token_source' });
        let body;
        try {
          const raw = request.postDataBuffer();
          if (!raw || raw.length > 64 * 1024) return settle({ status: 'changed', reason: 'token_body_size' });
          body = JSON.parse(raw.toString('utf8'));
        } catch { return settle({ status: 'changed', reason: 'token_body' }); }
        const names = Array.isArray(body?.fileNames) ? body.fileNames : [];
        if (body?.fileCount !== 1 || names.length !== 1 || names[0] !== expected.name || body?.widgetName !== expected.widgetName) return settle({ status: 'changed', reason: 'token_identity' });
        if (state.tokenRequest) return settle({ status: 'changed', reason: 'duplicate_token' });
        state.tokenRequest = request;
        return;
      }
      if (url.origin === 'https://upload.qiniup.com' && url.pathname === '/' && request.method() === 'POST') {
        if (url.search || url.hash || url.username || url.password || (state.uploadUrl && url.href !== state.uploadUrl)) return settle({ status: 'changed', reason: 'upload_url' });
        if (state.uploadRequest) return settle({ status: 'changed', reason: 'duplicate_upload' });
        state.uploadRequest = { request, frame: request.frame(), body: request.postDataBuffer(), contentType: request.headers()['content-type'] || '' };
        validateUploadRequest();
      }
    } catch (error) { settle({ status: 'changed', reason: 'request_error' }); }
  };
  const requestFailedHandler = request => {
    try {
      const url = new URL(request.url());
      if (request === state.tokenRequest || request === state.uploadRequest?.request || (url.origin === scannedOrigin && url.pathname === '/_/data/upload_token/file') || (url.origin === 'https://upload.qiniup.com' && url.pathname === '/')) settle({ status: 'failed', reason: 'request_failed' });
    } catch { settle({ status: 'failed', reason: 'request_failed' }); }
  };
  const responseHandler = async response => {
    try {
      const url = new URL(response.url());
      if (url.pathname === '/_/data/upload_token/file' && (url.hostname === 'jiandaoyun.com' || url.hostname.endsWith('.jiandaoyun.com'))) {
        if (response.request() !== state.tokenRequest || response.request().frame() !== frame || !response.ok() || !scannedOrigin || url.origin !== scannedOrigin) return settle({ status: 'changed', reason: 'token_response_source' });
        let json;
        try { json = await readJsonCapped(response); } catch { return settle({ status: 'failed', reason: 'token_response_json' }); }
        let uploadUrl;
        try { uploadUrl = new URL(json?.url); } catch { return settle({ status: 'changed', reason: 'token_response_url' }); }
        if (uploadUrl.origin !== 'https://upload.qiniup.com' || uploadUrl.pathname !== '/' || uploadUrl.search || uploadUrl.hash || uploadUrl.username || uploadUrl.password) return settle({ status: 'changed', reason: 'token_response_url' });
        if (!Array.isArray(json?.tokenList) || json.tokenList.length !== 1 || typeof json.tokenList[0] !== 'string' || json.tokenList[0].length < 8 || json.tokenList[0].length > 8192 || !/^[\x21-\x7E]+$/.test(json.tokenList[0])) return settle({ status: 'changed', reason: 'token_response_token' });
        state.uploadUrl = uploadUrl.href;
        state.token = json.tokenList[0];
        state.tokenResponseReady = true;
        await validateUploadRequest();
        maybeUploaded();
        return;
      }
      if (url.origin === 'https://upload.qiniup.com' && url.pathname === '/') {
        if (!state.tokenRequest) return settle({ status: 'failed', reason: 'upload_without_token' });
        if (!state.uploadRequest || (state.uploadUrl && url.href !== state.uploadUrl) || response.request() !== state.uploadRequest.request || response.request().frame() !== frame) return settle({ status: 'changed', reason: 'upload_response_source' });
        if (!response.ok()) return settle({ status: 'failed', reason: 'upload_http' });
        let json;
        try { json = await readJsonCapped(response); } catch { return settle({ status: 'failed', reason: 'upload_response_json' }); }
        const file = json?.file;
        const boundedString = value => typeof value === 'string' && value.length > 0 && value.length <= 2048;
        if (!file || typeof file !== 'object' || file.name !== expected.name || typeof file.name !== 'string' || typeof file.size !== 'number' || file.size !== expected.size || (expected.mimeType && file.mime !== expected.mimeType) || typeof file.mime !== 'string' || !boundedString(file._id) || !boundedString(file.key)) return settle({ status: 'failed', reason: 'upload_response_file' });
        state.uploadReceiptValid = true;
        state.uploadResponseRequest = response.request();
        maybeUploaded();
      }
    } catch (error) { settle({ status: 'changed', reason: 'response_error' }); }
  };
  page.on('request', requestHandler);
  page.on('requestfailed', requestFailedHandler);
  page.on('response', responseHandler);
  return {
    async wait({ signal, timeoutMs = 2500 } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        signal?.throwIfAborted();
        if (state.result) return state.result;
        await delay(50, undefined, { signal });
      }
      return { status: 'none' };
    },
    dispose() {
      page.off('request', requestHandler);
      page.off('requestfailed', requestFailedHandler);
      page.off('response', responseHandler);
    }
  };
}

function jiandaoyunAction(node, state) {
  const text = item => (item?.textContent || '').replace(/\s+/g, ' ').trim();
  const sameSet = (left, right) => Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every(item => right.includes(item));
  const visible = item => item?.isConnected && item.getClientRects().length > 0 && item.ownerDocument.defaultView.getComputedStyle(item).visibility !== 'hidden' && !item.closest('[inert],[aria-hidden="true"],.ui-invisible');
  const disabled = item => item?.closest('[aria-disabled="true"],.disabled') || item?.disabled || item?.readOnly;
  const forbidden = new RegExp(state.forbiddenPattern, 'i');
  const fileLimitBytes = value => [...String(value || '').matchAll(/(\d+(?:\.\d+)?)\s*M(?:B)?/gi)].map(match => Math.floor(Number(match[1]) * 1024 * 1024)).sort((a, b) => a - b)[0] || null;
  const uploadOccupied = scope => Boolean(scope?.querySelector('input[type=file]')?.files?.length || scope?.querySelector('.file-list,.file-item,.x-upload-list,.upload-file,[class*="file-list"],[class*="file-item"],[class*="upload-list"],[class*="upload-item"]'));
  const matchesAccept = (name, mimeType, accept) => {
    if (!accept) return true;
    const lowerName = String(name || '').toLowerCase();
    const lowerMime = String(mimeType || '').toLowerCase();
    return String(accept).split(',').map(item => item.trim().toLowerCase()).filter(Boolean).some(token => {
      if (token.startsWith('.')) return lowerName.endsWith(token);
      if (token.endsWith('/*')) return lowerMime.startsWith(token.slice(0, -1));
      return lowerMime === token;
    });
  };
  const frameOwnersMatch = owners => {
    if (!owners?.length) return !window.frameElement;
    try {
      let current = window;
      for (let index = 0; index < owners.length; index++) {
        const owner = owners[index];
        if (current.frameElement !== owner.element || current.parent.document !== owner.document || !visible(owner.element)) return false;
        current = current.parent;
      }
      return current === top;
    } catch { return false; }
  };
  const hostOk = (() => {
    try {
      return location.protocol === 'https:' && (location.hostname === 'jiandaoyun.com' || location.hostname.endsWith('.jiandaoyun.com'));
    } catch { return false; }
  })();
  const root = node.closest('.fx-external-form');
  const controlSelector = '.fx-form-text,.fx-form-textarea,.fx-form-radiogroup,.fx-form-combo,.fx-form-combocheck,.fx-form-datetime,.fx-form-file,.fx-sub-select';
  const component = node.matches(controlSelector) ? node : node.closest(controlSelector);
  const subField = component?.closest('.fx-sub-field');
  const topField = component?.closest('.fx-field');
  const field = subField || topField;
  const rowNode = component?.closest('.fx-subform-row') || null;
  const cell = component?.closest('.subform-cell') || null;
  const subform = component?.closest('.fx-subform') || null;
  const labelNode = topField?.querySelector(':scope > .field-label .field-name');
  const section = subField ? text(topField?.querySelector(':scope > .field-label .field-name')) : '';
  const columnCells = rowNode ? [...rowNode.querySelectorAll(':scope > .subform-cell')] : [];
  const columnIndex = cell ? columnCells.indexOf(cell) : -1;
  const header = columnIndex >= 0 ? subform?.querySelectorAll(':scope .subform-head .subform-row > .subform-cell .subform-title')?.[columnIndex] : null;
  const label = subField ? (header?.getAttribute('title') || text(header)) : text(labelNode);
  const rowNodes = subform ? [...subform.querySelectorAll(':scope .subform-content .fx-subform-row')] : [];
  const recordIndex = rowNode ? rowNodes.indexOf(rowNode) : null;
  const row = rowNode ? `row:${recordIndex}` : '';
  const widgetName = field?.getAttribute('data-widgetname') || '';
  const required = Boolean(field?.querySelector(':scope > .field-label .field-required')) || Boolean(header?.querySelector('.required'));
  const type = component?.classList.contains('fx-form-textarea') ? 'textarea' :
    component?.classList.contains('fx-form-radiogroup') ? 'jiandaoyun-radio' :
    component?.classList.contains('fx-form-combo') ? 'jiandaoyun-combo' :
    component?.classList.contains('fx-form-combocheck') ? 'jiandaoyun-multiselect' :
    component?.classList.contains('fx-form-datetime') ? 'jiandaoyun-datetime' :
    component?.classList.contains('fx-form-file') ? 'jiandaoyun-file' :
    component?.classList.contains('fx-sub-select') ? 'jiandaoyun-sub-select' : 'text';
  const proofFile = Boolean(type === 'jiandaoyun-sub-select' && label === '获奖证明' && /获奖/.test(`${section} ${label}`) && component?.querySelector('.icon-widget-upload') && component?.querySelector('.select-container'));
  const input = type === 'textarea' ? component?.querySelector('textarea') : component?.querySelector('input');
  const accept = type === 'jiandaoyun-file' ? input?.getAttribute('accept') || '' : '';
  const fileLimitText = type === 'jiandaoyun-file' ? [text(topField?.querySelector(':scope > .field-description')), text(component?.querySelector('.upload-area-text'))] : [];
  const maxFileBytes = fileLimitText.map(fileLimitBytes).filter(Boolean).sort((a, b) => a - b)[0] || null;
  const comboLabel = ['jiandaoyun-combo','jiandaoyun-multiselect'].includes(type) ? component?.querySelector('.x-combo-dropdown-label') : null;
  const proofTarget = proofFile ? component?.querySelector('.select-container') : null;
  const proofOwner = scope => Boolean(scope?.__jiandaoyunProofSource === component && scope?.__jiandaoyunProofRow === row && scope?.__jiandaoyunProofColumn === columnIndex);
  const ownedProofInputs = () => [...document.querySelectorAll('.x-popup.x-popover input[type=file]')].filter(item => proofOwner(item) && proofOwner(item.closest('.x-popup.x-popover')));
  const ownedProofOccupied = () => ownedProofInputs().some(item => item.files?.length);
  const markProofOwner = (popup, fileInput) => {
    for (const item of [popup, fileInput]) {
      Object.defineProperty(item, '__jiandaoyunProofSource', { value: component, configurable: true });
      Object.defineProperty(item, '__jiandaoyunProofRow', { value: row, configurable: true });
      Object.defineProperty(item, '__jiandaoyunProofColumn', { value: columnIndex, configurable: true });
    }
  };
  const trigger = type === 'jiandaoyun-combo' ? component?.querySelector('.fx-combo-trigger,.x-combo') : type === 'jiandaoyun-multiselect' ? component?.querySelector('.fx-combocheck-trigger,.x-combocheck') : proofFile ? proofTarget : component?.querySelector('.x-radio-group') || input || component;
  const selectedCombo = type === 'jiandaoyun-combo' ? text(component.querySelector('.selected-label,.value-content .x-tag,.value-content span:not(.dropdown-label-placeholder),.value-content')) : '';
  const radioItems = type === 'jiandaoyun-radio' ? [...component.querySelectorAll('.x-radio')] : [];
  const selectedMulti = type === 'jiandaoyun-multiselect' ? (() => {
    const tags = [...component.querySelectorAll('.value-tag[title]')].map(item => item.getAttribute('title')).filter(Boolean);
    if (tags.length) return tags;
    const content = component.querySelector('.value-content');
    const placeholder = text(content?.querySelector('.dropdown-label-placeholder'));
    const valueText = text(content);
    if (!valueText || valueText === placeholder) return [];
    return [valueText];
  })() : [];
  const selectedMultiFromPopup = popup => [...(popup?.querySelectorAll('.x-combo-dropdown-item.is-multi.selected') || [])]
    .filter(item => item.getAttribute('title') && !item.classList.contains('check-all-item'))
    .map(item => item.getAttribute('title'))
    .filter(Boolean);
  const radioOptions = radioItems.map(item => {
    const optionLabel = item.querySelector('.x-tag')?.getAttribute('title') || text(item.querySelector('.text-wrapper,.radio-text')) || text(item);
    return { node: item, wrapper: item.querySelector('.x-radio-wrapper') || item, label: optionLabel, purpose: JSON.stringify([optionLabel, text(item)]) };
  });
  const radioSelected = radioOptions.filter(item => item.node.classList.contains('radio-checked') || item.node.classList.contains('is-selected') || item.node.classList.contains('checked') || item.wrapper.getAttribute('aria-checked') === 'true');
  const maxLength = input?.maxLength > 0 ? input.maxLength : null;
  const occupied = type === 'textarea' || type === 'text' ? Boolean(input?.value) :
    type === 'jiandaoyun-combo' ? Boolean(selectedCombo && selectedCombo !== text(component.querySelector('.dropdown-label-placeholder'))) :
    type === 'jiandaoyun-radio' ? radioSelected.length > 0 :
    type === 'jiandaoyun-file' ? uploadOccupied(component) :
    proofFile ? Boolean(text(component) || uploadOccupied(component) || ownedProofOccupied()) :
    type === 'jiandaoyun-datetime' ? Boolean(input?.value) :
    type === 'jiandaoyun-multiselect' ? selectedMulti.length > 0 : false;
  const purpose = JSON.stringify([label, section, widgetName, type, text(field?.querySelector(':scope > .field-label')), radioOptions.map(item => item.label)]);
  const unsupported = !['text','textarea','jiandaoyun-radio','jiandaoyun-combo','jiandaoyun-multiselect','jiandaoyun-datetime','jiandaoyun-file'].includes(type) && !proofFile || type === 'jiandaoyun-sub-select' && !proofFile || !label || (type === 'jiandaoyun-file' && !maxFileBytes) || forbidden.test(purpose);
  const identity = { root, field, topField, subField, component, input, trigger, comboLabel, proofTarget, rowNode, cell, header, label, section, widgetName, type, proofFile, row, recordIndex, columnIndex, purpose, accept, maxFileBytes, options: radioOptions };
  const publicType = type === 'jiandaoyun-file' || proofFile ? 'file' : type;
  const meta = { id: state.id, type: publicType, name: widgetName, label: label.slice(0, 200), section: section.slice(0, 160), row, recordIndex, options: type === 'jiandaoyun-radio' ? radioOptions.map(item => ({ value: item.label, label: item.label })) : [], required, occupied, unsupported, proofFile, maxLength, accept, maxFileBytes, visible: visible(component) && visible(root), jiandaoyun: true };
  if (state.action === 'scan') return { ...identity, meta };
  if (!hostOk || !frameOwnersMatch(state.frameOwners) || document !== state.document || node.ownerDocument !== state.document || location.href !== state.url || !visible(root) || !visible(component)) return 'changed';
  const identityKeys = ['root','field','topField','subField','component','input','trigger','comboLabel','proofTarget','rowNode','cell','header','label','section','widgetName','type','proofFile','row','recordIndex','columnIndex','purpose','accept','maxFileBytes'];
  if (identityKeys.some(key => identity[key] !== state.identity[key])) return 'changed';
  if (type === 'jiandaoyun-radio' && (radioOptions.length !== state.identity.options.length || radioOptions.some((item, index) => {
    const expected = state.identity.options[index];
    return item.node !== expected.node || item.wrapper !== expected.wrapper || item.label !== expected.label || item.purpose !== expected.purpose;
  }))) return 'changed';
  if (unsupported || forbidden.test(purpose)) return 'changed';
  if (state.action !== 'verifyFileReceipt' && (disabled(input) || disabled(component))) return 'changed';
  if (state.action === 'verify') {
    if (type === 'text' || type === 'textarea') return input?.value === state.value ? 'filled' : 'failed';
    if (type === 'jiandaoyun-radio') return radioSelected.length === 1 && radioSelected[0].label === state.value ? 'filled' : 'failed';
    if (type === 'jiandaoyun-combo') return selectedCombo === state.value ? 'filled' : 'failed';
    if (type === 'jiandaoyun-multiselect') {
      const plain = selectedMulti.length === 1 && Array.isArray(state.value) && state.value.length > 1 && selectedMulti[0] === state.value.join(', ');
      return sameSet(selectedMulti, state.value) || plain ? 'filled' : 'failed';
    }
    if (type === 'jiandaoyun-datetime') return input?.value === state.value && component.querySelector('.x-datetime')?.classList.contains('select') && component.querySelector('.x-datetime')?.classList.contains('value') ? 'filled' : 'failed';
    if (type === 'jiandaoyun-file') return input?.files?.length === 1 && input.files[0].name === state.attachment?.name && input.files[0].size === state.attachment?.size ? 'attachment_selected' : 'failed';
    if (proofFile) return 'failed';
    return 'unsupported';
  }
  const multiAction = ['openMulti','multiOptions','chooseMulti','multiSelection'].includes(state.action);
  const proofAction = ['openProofFile','proofFileInput','writeProofFile','verifyProofFile'].includes(state.action);
  const fileAction = ['verifyFileReceipt'].includes(state.action);
  if (occupied && !multiAction && !proofAction && !fileAction) return 'preserved';
  if (state.action === 'writeText') {
    if (!['text','textarea'].includes(type) || typeof state.value !== 'string') return 'unsupported';
    const prototype = type === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, state.value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.value === state.value ? 'filled' : 'failed';
  }
  if (state.action === 'chooseRadio') {
    if (type !== 'jiandaoyun-radio') return 'unsupported';
    const matches = radioOptions.filter(item => item.label === state.value);
    if (matches.length !== 1 || forbidden.test(matches[0].purpose)) return 'unsupported';
    matches[0].wrapper.click();
    return 'selected';
  }
  if (state.action === 'writeDatetime') {
    if (type !== 'jiandaoyun-datetime' || typeof state.value !== 'string') return 'unsupported';
    input.focus();
    if (input.value !== '' || component.querySelector('.x-datetime')?.classList.contains('select') || component.querySelector('.x-datetime')?.classList.contains('value')) return 'preserved';
    const prototype = HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, state.value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
    return input.value === state.value && component.querySelector('.x-datetime')?.classList.contains('select') && component.querySelector('.x-datetime')?.classList.contains('value') ? 'filled' : 'failed';
  }
  if (state.action === 'writeFile') {
    if (type !== 'jiandaoyun-file' || !state.attachment?.name || !Array.isArray(state.attachment.bytes)) return 'unsupported';
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(state.attachment.bytes)], state.attachment.name, { type: state.attachment.mimeType || '' }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files').set.call(input, transfer.files);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.files.length === 1 && input.files[0].name === state.attachment.name && input.files[0].size === state.attachment.size ? 'attachment_selected' : 'dispatch_selected';
  }
  if (state.action === 'verifyFileReceipt') {
    if (type !== 'jiandaoyun-file' || !state.attachment?.name) return 'unsupported';
    const wrapper = component.querySelector('.x-upload.file-upload.x-upload-wrapper');
    const items = [...component.querySelectorAll('.upload-list-wrapper .upload-item-wrapper .fx-file-item.has-delete.is-short-mode')];
    const disabledWrapper = wrapper && (/disable|disabled/.test(wrapper.className) || wrapper.getAttribute('aria-disabled') === 'true');
    return items.length === 1 && text(items[0]) === state.attachment.name && disabledWrapper ? 'attachment_uploaded' : 'failed';
  }
  if (state.action === 'openProofFile') {
    if (!proofFile || !proofTarget || !visible(proofTarget)) return 'unsupported';
    if (uploadOccupied(component) || text(component) || ownedProofOccupied()) return 'preserved';
    const before = [...document.querySelectorAll('.x-popup.x-popover')];
    proofTarget.click();
    return { status: 'opened', before, source: component, target: proofTarget };
  }
  if (state.action === 'proofFileInput') {
    if (!proofFile || state.open?.source !== component || state.open?.target !== proofTarget) return { status: 'changed' };
    const popups = [...document.querySelectorAll('.x-popup.x-popover')].filter(item => !state.open.before.includes(item) && visible(item));
    if (popups.length !== 1) return { status: popups.length ? 'changed' : 'waiting' };
    const popup = popups[0];
    const inputs = [...popup.querySelectorAll('input[type=file]')].filter(item => !item.disabled);
    if (inputs.length !== 1) return { status: inputs.length ? 'changed' : 'waiting' };
    if (uploadOccupied(component) || uploadOccupied(popup)) return { status: 'preserved' };
    const input = inputs[0];
    const maxFileBytes = fileLimitBytes(text(popup));
    return { status: 'ready', popup, input, accept: input.getAttribute('accept') || '', maxFileBytes };
  }
  if (state.action === 'writeProofFile') {
    if (!proofFile || state.open?.source !== component || state.open?.target !== proofTarget) return 'changed';
    const proof = state.proof;
    const popup = proof?.popup, input = proof?.input;
    if (!popup || !input || !visible(popup) || !popup.contains(input) || input.type !== 'file' || input.disabled) return 'changed';
    const actualAccept = input.getAttribute('accept') || '';
    const actualMax = fileLimitBytes(text(popup));
    if (actualAccept !== proof.accept || actualMax !== proof.maxFileBytes) return 'changed';
    if (uploadOccupied(component) || uploadOccupied(popup)) return 'preserved';
    if (actualMax && state.attachment.size > actualMax) return 'too_large';
    if (!matchesAccept(state.attachment.name, state.attachment.mimeType, actualAccept)) return 'attachment_mismatch';
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(state.attachment.bytes)], state.attachment.name, { type: state.attachment.mimeType || '' }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files').set.call(input, transfer.files);
    markProofOwner(popup, input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.files.length === 1 && input.files[0].name === state.attachment.name && input.files[0].size === state.attachment.size ? 'attachment_selected' : 'failed';
  }
  if (state.action === 'verifyProofFile') {
    if (!proofFile || state.open?.source !== component || state.open?.target !== proofTarget) return 'changed';
    const proof = state.proof;
    const popup = proof?.popup, input = proof?.input;
    if (!popup || !input || !visible(popup) || !popup.contains(input) || input.type !== 'file' || input.disabled) return 'changed';
    if (!proofOwner(popup) || !proofOwner(input)) return 'changed';
    return input.files?.length === 1 && input.files[0].name === state.attachment?.name && input.files[0].size === state.attachment?.size ? 'attachment_selected' : 'failed';
  }
  if (state.action === 'openCombo') {
    if (type !== 'jiandaoyun-combo' || !comboLabel || !visible(comboLabel) || comboLabel.querySelector('.close-icon')) return 'unsupported';
    const before = [...document.querySelectorAll('.x-popup.x-combo-dropdown')];
    comboLabel.click();
    return { status: 'opened', before, trigger };
  }
  if (state.action === 'openMulti') {
    if (type !== 'jiandaoyun-multiselect' || !comboLabel || !visible(comboLabel)) return 'unsupported';
    if (occupied) return 'preserved';
    const before = [...document.querySelectorAll('.x-popup.x-combo-dropdown')];
    comboLabel.click();
    return { status: 'opened', before, trigger };
  }
  if (state.action === 'comboOptions') {
    if (type !== 'jiandaoyun-combo' || !state.open?.before || state.open.trigger !== trigger) return { status: 'changed' };
    const triggerRect = trigger.getBoundingClientRect();
    const popups = [...document.querySelectorAll('.x-popup.x-combo-dropdown')].filter(item => !state.open.before.includes(item) && visible(item) && item.querySelector('.fx-combo-wrapper') && !item.querySelector('.fx-combocheck-wrapper')).filter(item => {
      const rect = item.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && Math.max(rect.left, triggerRect.left) <= Math.min(rect.right, triggerRect.right);
    });
    if (popups.length !== 1) return { status: popups.length ? 'changed' : 'waiting' };
    const popup = popups[0];
    if (popup.querySelector('.dropdown-loading,.loading-wrapper')) return { status: 'waiting' };
    if (popup.querySelector('.dropdown-empty')) return { status: 'options_unavailable' };
    const candidates = [...popup.querySelectorAll('.x-combo-dropdown-item,.x-combo-option,[role="option"],.combo-item,.dropdown-item')].filter(item => visible(item) && !item.closest('.disabled,[aria-disabled="true"]'));
    const optionLabel = item => item.getAttribute('title') || text(item);
    const matches = candidates.filter(item => optionLabel(item) === state.value);
    if (matches.length !== 1) return { status: matches.length > 1 ? 'unsupported' : candidates.length ? 'unsupported' : 'waiting' };
    return { status: 'ready', popup, option: matches[0], purpose: JSON.stringify([optionLabel(matches[0]), text(matches[0]), matches[0].className]) };
  }
  if (state.action === 'chooseCombo') {
    if (type !== 'jiandaoyun-combo' || state.open?.trigger !== trigger) return 'changed';
    const expected = state.option;
    const popup = expected?.popup, option = expected?.option;
    if (!popup || !option || !visible(popup) || !visible(option) || !popup.contains(option)) return 'changed';
    const options = [...popup.querySelectorAll('.x-combo-dropdown-item,.x-combo-option,[role="option"],.combo-item,.dropdown-item')].filter(item => visible(item) && !item.closest('.disabled,[aria-disabled="true"]'));
    const optionLabel = item => item.getAttribute('title') || text(item);
    if (options.filter(item => optionLabel(item) === state.value).length !== 1 || optionLabel(option) !== state.value || JSON.stringify([optionLabel(option), text(option), option.className]) !== expected.purpose || forbidden.test(expected.purpose)) return 'changed';
    option.click();
    return 'selected';
  }
  if (state.action === 'multiOptions') {
    if (type !== 'jiandaoyun-multiselect' || !state.open?.before || state.open.trigger !== trigger) return { status: 'changed' };
    const triggerRect = trigger.getBoundingClientRect();
    const popups = [...document.querySelectorAll('.x-popup.x-combo-dropdown')].filter(item => !state.open.before.includes(item) && visible(item) && item.querySelector('.fx-combocheck-wrapper')).filter(item => {
      const rect = item.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && Math.max(rect.left, triggerRect.left) <= Math.min(rect.right, triggerRect.right);
    });
    if (popups.length !== 1) return { status: popups.length ? 'changed' : 'waiting' };
    const popup = popups[0];
    if (popup.querySelector('.dropdown-loading,.loading-wrapper')) return { status: 'waiting' };
    const popupSelected = selectedMultiFromPopup(popup);
    const currentSelected = selectedMulti.length ? selectedMulti : popupSelected;
    if (!sameSet(currentSelected, state.written || [])) return { status: 'changed' };
    if (popup.querySelector('.dropdown-empty')) return { status: 'no_match' };
    const optionLabel = item => item.getAttribute('title') || text(item.querySelector('.x-combo-dropdown-item-content')) || text(item);
    const items = [...popup.querySelectorAll('.x-combo-dropdown-item.is-multi')].filter(item => visible(item) && !item.closest('.disabled,[aria-disabled="true"]') && item.getAttribute('title') && !item.classList.contains('check-all-item') && optionLabel(item) !== '全选');
    const matches = items.filter(item => optionLabel(item) === state.target);
    if (matches.length !== 1) return { status: 'no_match' };
    return { status: 'ready', popup, option: matches[0], purpose: JSON.stringify([optionLabel(matches[0]), text(matches[0])]) };
  }
  if (state.action === 'multiPreflight') {
    if (type !== 'jiandaoyun-multiselect' || !state.open?.before || state.open.trigger !== trigger || !sameSet(selectedMulti, [])) return { status: 'changed' };
    const triggerRect = trigger.getBoundingClientRect();
    const popups = [...document.querySelectorAll('.x-popup.x-combo-dropdown')].filter(item => !state.open.before.includes(item) && visible(item) && item.querySelector('.fx-combocheck-wrapper')).filter(item => {
      const rect = item.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && Math.max(rect.left, triggerRect.left) <= Math.min(rect.right, triggerRect.right);
    });
    if (popups.length !== 1) return { status: popups.length ? 'changed' : 'waiting' };
    const popup = popups[0];
    if (popup.querySelector('.dropdown-loading,.loading-wrapper')) return { status: 'waiting' };
    if (popup.querySelector('.dropdown-empty')) return { status: 'no_match' };
    const optionLabel = item => item.getAttribute('title') || text(item.querySelector('.x-combo-dropdown-item-content')) || text(item);
    const items = [...popup.querySelectorAll('.x-combo-dropdown-item.is-multi')].filter(item => visible(item) && !item.closest('.disabled,[aria-disabled="true"]') && item.getAttribute('title') && !item.classList.contains('check-all-item') && optionLabel(item) !== '全选');
    return state.targets.every(target => items.filter(item => optionLabel(item) === target).length === 1) ? { status: 'ready' } : { status: 'no_match' };
  }
  if (state.action === 'chooseMulti') {
    if (type !== 'jiandaoyun-multiselect' || state.open?.trigger !== trigger) return 'changed';
    const expected = state.option;
    const popup = expected?.popup, option = expected?.option;
    if (!popup || !option || !visible(popup) || !visible(option) || !popup.contains(option)) return 'changed';
    const popupSelected = selectedMultiFromPopup(popup);
    const currentSelected = selectedMulti.length ? selectedMulti : popupSelected;
    if (!sameSet(currentSelected, state.written || [])) return 'changed';
    const optionLabel = option.getAttribute('title') || text(option.querySelector('.x-combo-dropdown-item-content')) || text(option);
    if (!option.getAttribute('title') || option.classList.contains('check-all-item') || optionLabel === '全选' || optionLabel !== state.target || JSON.stringify([optionLabel, text(option)]) !== expected.purpose || forbidden.test(expected.purpose) || option.classList.contains('selected') || option.querySelector('.check-checked')) return 'changed';
    option.click();
    return 'selected';
  }
  if (state.action === 'multiSelection') {
    if (type !== 'jiandaoyun-multiselect') return 'unsupported';
    const expected = state.written || [];
    const popup = [...document.querySelectorAll('.x-popup.x-combo-dropdown')].find(item => visible(item) && item.querySelector('.fx-combocheck-wrapper'));
    const current = selectedMulti.length ? selectedMulti : selectedMultiFromPopup(popup);
    if (sameSet(current, expected)) return 'selected';
    return current.some(item => !expected.includes(item)) ? 'changed' : 'waiting';
  }
  if (state.action === 'closeMulti') {
    if (type !== 'jiandaoyun-multiselect') return 'unsupported';
    field?.querySelector(':scope > .field-label .field-name')?.click();
    document.body.click();
    return 'closed';
  }
  return 'unsupported';
}

export async function scanJiandaoyunControls(frame, forbiddenPattern, { frameOwners = [] } = {}) {
  if (!isJiandaoyunUrl(frame.url())) return [];
  const rootCount = await frame.locator('.fx-external-form').count();
  if (!rootCount) return [];
  const handles = await frame.locator(`.fx-external-form ${CONTROL_SELECTOR}`).elementHandles();
  const entries = [];
  for (const handle of handles.slice(0, 500)) {
    const shouldSkip = await handle.evaluate(node => {
      if (!node.closest('.fx-external-form') || node.closest('.ui-invisible')) return true;
      const directField = node.closest('.fx-sub-field') || node.closest('.fx-field');
      if (!directField) return true;
      return [...directField.querySelectorAll('.fx-form-text,.fx-form-textarea,.fx-form-radiogroup,.fx-form-combo,.fx-form-combocheck,.fx-form-datetime,.fx-form-file,.fx-sub-select')].some(item => item !== node && item.contains(node));
    });
    if (shouldSkip) { await handle.dispose(); continue; }
    const identity = await handle.evaluateHandle(jiandaoyunAction, { action: 'scan', id: randomUUID(), forbiddenPattern, frameOwners });
    const meta = await identity.evaluate(item => item.meta);
    if (!meta.visible) { await identity.dispose(); await handle.dispose(); continue; }
    delete meta.visible;
    entries.push({ meta, handle, identity, frame: typeof frame.mainFrame === 'function' ? frame.mainFrame() : frame, jiandaoyun: true });
  }
  return entries;
}


export async function fillJiandaoyunControl(entry, { document, url, frameOwners = [], value, attachment, forbiddenPattern, signal, validateAnswer, answer } = {}) {
  const isFile = entry?.meta?.type === 'file';
  const isMulti = entry?.meta?.type === 'jiandaoyun-multiselect';
  if (isFile) {
    if (!attachment?.name || !attachment?.buffer) return 'unsupported';
    if (entry.meta.maxFileBytes && attachment.buffer.length > entry.meta.maxFileBytes) return 'too_large';
  } else if (isMulti) {
    if (attachment || !Array.isArray(value) || value.length < 1 || value.length > 20 || value.some(item => typeof item !== 'string' || !item.trim()) || new Set(value).size !== value.length) return 'unsupported';
  } else if (attachment || typeof value !== 'string' || !value.trim()) return 'unsupported';
  if (!isJiandaoyunUrl(url)) return 'changed';
  if (!isFile && !isMulti) {
    const limit = entry.meta.type === 'textarea' ? 4000 : 500;
    if (value.length > limit) return 'unsupported';
    if (entry.meta.maxLength && value.length > entry.meta.maxLength) return 'too_long';
    if (entry.meta.type === 'jiandaoyun-datetime' && !isStrictIsoDate(value)) return 'unsupported';
  }
  const authorize = () => { signal?.throwIfAborted(); return !validateAnswer || validateAnswer(answer) === true; };
  const state = { document, url, frameOwners, value, forbiddenPattern, identity: entry.identity, attachment: isFile ? { name: attachment.name, mimeType: attachment.mimeType || '', size: attachment.buffer.length, bytes: Array.from(attachment.buffer) } : null };
  if (!authorize()) return 'missing_evidence';
  try {
    if (isFile) {
      if (entry.meta.proofFile) {
        let opened, proof;
        try {
          opened = await entry.handle.evaluateHandle(jiandaoyunAction, { ...state, action: 'openProofFile' });
          const openStatus = await opened.evaluate(result => typeof result === 'string' ? result : result.status);
          if (openStatus !== 'opened') return openStatus;
          const deadline = Date.now() + 1500;
          while (Date.now() < deadline) {
            signal?.throwIfAborted();
            proof = await entry.handle.evaluateHandle(jiandaoyunAction, { ...state, action: 'proofFileInput', open: opened });
            const status = await proof.evaluate(result => typeof result === 'string' ? result : result.status);
            if (status !== 'waiting') {
              if (status !== 'ready') { await proof.dispose(); proof = null; return status; }
              const actual = await proof.evaluate(result => ({ accept: result.accept || '', maxFileBytes: result.maxFileBytes || null }));
              if (actual.maxFileBytes && attachment.buffer.length > actual.maxFileBytes) { await proof.dispose(); proof = null; return 'too_large'; }
              if (!attachmentMatchesAccept(attachment.name, attachment.mimeType || '', actual.accept)) { await proof.dispose(); proof = null; return 'attachment_mismatch'; }
              if (!authorize()) { await proof.dispose(); proof = null; return 'missing_evidence'; }
              const chosen = await entry.handle.evaluate(jiandaoyunAction, { ...state, action: 'writeProofFile', open: opened, proof });
              if (chosen !== 'attachment_selected') return chosen;
              await delay(50, undefined, { signal });
              signal?.throwIfAborted();
              return await entry.handle.evaluate(jiandaoyunAction, { ...state, action: 'verifyProofFile', open: opened, proof });
            }
            await proof.dispose(); proof = null;
            await delay(50, undefined, { signal });
          }
          return 'failed';
        } finally { await proof?.dispose(); await opened?.dispose(); }
      }
      const receipt = installJiandaoyunAttachmentReceiptObserver(entry, attachment);
      try {
        const status = await entry.handle.evaluate(jiandaoyunAction, { ...state, action: 'writeFile' });
        if (status !== 'attachment_selected' && status !== 'dispatch_selected') return status;
        signal?.throwIfAborted();
        const observed = await receipt?.wait({ signal });
        if (observed?.status === 'changed' || observed?.status === 'failed') return observed.status;
        if (observed?.status === 'uploaded') {
          if (!authorize()) return 'missing_evidence';
          const verified = await entry.handle.evaluate(jiandaoyunAction, { ...state, action: 'verifyFileReceipt' });
          if (verified === 'attachment_uploaded') return verified;
          return verified === 'changed' ? 'changed' : 'failed';
        }
        if (status === 'dispatch_selected') return 'failed';
        return await entry.handle.evaluate(jiandaoyunAction, { ...state, action: 'verify' });
      } finally { receipt?.dispose(); }
    }
    if (['text','textarea'].includes(entry.meta.type)) {
      const status = await entry.handle.evaluate(jiandaoyunAction, { ...state, action: 'writeText' });
      if (status !== 'filled') return status;
      signal?.throwIfAborted();
      return await entry.handle.evaluate(jiandaoyunAction, { ...state, action: 'verify' });
    }
    if (entry.meta.type === 'jiandaoyun-radio') {
      const status = await entry.handle.evaluate(jiandaoyunAction, { ...state, action: 'chooseRadio' });
      if (status !== 'selected' && status !== 'filled') return status;
      await delay(50);
      signal?.throwIfAborted();
      return await entry.handle.evaluate(jiandaoyunAction, { ...state, action: 'verify' });
    }
    if (entry.meta.type === 'jiandaoyun-datetime') {
      const status = await entry.handle.evaluate(jiandaoyunAction, { ...state, action: 'writeDatetime' });
      if (status !== 'filled') return status;
      signal?.throwIfAborted();
      return await entry.handle.evaluate(jiandaoyunAction, { ...state, action: 'verify' });
    }
    if (isMulti) {
      let opened, options;
      const written = [];
      try {
        opened = await entry.handle.evaluateHandle(jiandaoyunAction, { ...state, action: 'openMulti' });
        const openStatus = await opened.evaluate(result => typeof result === 'string' ? result : result.status);
        if (openStatus !== 'opened') return openStatus;
        const preflightDeadline = Date.now() + 1500;
        let preflightReady = false;
        while (Date.now() < preflightDeadline) {
          signal?.throwIfAborted();
          options = await entry.handle.evaluateHandle(jiandaoyunAction, { ...state, action: 'multiPreflight', open: opened, targets: value });
          const status = await options.evaluate(result => typeof result === 'string' ? result : result.status);
          await options.dispose(); options = null;
          if (status !== 'waiting') {
            if (status !== 'ready') return status;
            preflightReady = true;
            break;
          }
          await delay(50, undefined, { signal });
        }
        if (!preflightReady) return 'no_match';
        for (const target of value) {
          const deadline = Date.now() + 1500;
          let ready = false;
          while (Date.now() < deadline) {
            signal?.throwIfAborted();
            options = await entry.handle.evaluateHandle(jiandaoyunAction, { ...state, action: 'multiOptions', open: opened, target, written });
            const status = await options.evaluate(result => typeof result === 'string' ? result : result.status);
            if (status !== 'waiting') {
              if (status !== 'ready') { await options.dispose(); options = null; return status; }
              if (!authorize()) { await options.dispose(); options = null; return 'missing_evidence'; }
              const chosen = await entry.handle.evaluate(jiandaoyunAction, { ...state, action: 'chooseMulti', open: opened, option: options, target, written });
              await options.dispose(); options = null;
              if (chosen !== 'selected') return chosen;
              const nextWritten = [...written, target];
              let settled = false;
              for (let verifyAttempt = 0; verifyAttempt < 10; verifyAttempt++) {
                await delay(50, undefined, { signal });
                signal?.throwIfAborted();
                const selected = await entry.handle.evaluate(jiandaoyunAction, { ...state, action: 'multiSelection', written: nextWritten });
                if (selected === 'selected') { settled = true; break; }
                if (selected !== 'waiting') return selected;
              }
              if (!settled) return 'failed';
              written.push(target);
              ready = true;
              break;
            }
            await options.dispose(); options = null;
            await delay(50, undefined, { signal });
          }
          if (!ready) return 'no_match';
        }
        signal?.throwIfAborted();
        await entry.handle.evaluate(jiandaoyunAction, { ...state, action: 'closeMulti' });
        await delay(100, undefined, { signal });
        return await entry.handle.evaluate(jiandaoyunAction, { ...state, action: 'verify' });
      } finally { await options?.dispose(); await opened?.dispose(); }
    }
    if (entry.meta.type !== 'jiandaoyun-combo') return 'unsupported';
    let opened, options;
    try {
      opened = await entry.handle.evaluateHandle(jiandaoyunAction, { ...state, action: 'openCombo' });
      const openStatus = await opened.evaluate(result => typeof result === 'string' ? result : result.status);
      if (openStatus !== 'opened') return openStatus;
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        signal?.throwIfAborted();
        options = await entry.handle.evaluateHandle(jiandaoyunAction, { ...state, action: 'comboOptions', open: opened });
        const status = await options.evaluate(result => typeof result === 'string' ? result : result.status);
        if (status !== 'waiting') {
          if (status !== 'ready') { await options.dispose(); options = null; return status; }
          if (!authorize()) { await options.dispose(); options = null; return 'missing_evidence'; }
          const chosen = await entry.handle.evaluate(jiandaoyunAction, { ...state, action: 'chooseCombo', open: opened, option: options });
          await options.dispose(); options = null;
          if (chosen !== 'selected') return chosen;
          await delay(0);
          signal?.throwIfAborted();
          return await entry.handle.evaluate(jiandaoyunAction, { ...state, action: 'verify' });
        }
        await options.dispose(); options = null;
        await delay(50, undefined, { signal });
      }
      return 'unsupported';
    } finally { await options?.dispose(); await opened?.dispose(); }
  } catch {
    signal?.throwIfAborted();
    return 'changed';
  }
}
