import { randomUUID, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { scanCustomControls, fillCustomControl } from './applicationCustomControls.js';
import { scanJiandaoyunControls, fillJiandaoyunControl } from './applicationJiandaoyun.js';
import { ensureApplicationRows } from './applicationRows.js';

const FORBIDDEN = /同意|授权|隐私|签名|签署|声明|验证码|密码|password|captcha|consent|signature|submit|提交|发送/i;
/**
 * Local browser binaries, in preference order, across the platforms the team
 * actually works on.  Exported because the tests that drive a real DOM need the
 * same list: they used to carry a Windows-only copy, so on macOS they failed
 * with "A real local browser is required" even with Chrome installed.
 */
export const BROWSER_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
];
export const findLocalBrowser = () => BROWSER_CANDIDATES.find(existsSync);
const keyOf = scope => {
  if (![scope?.userId, scope?.candidateId, scope?.conversationId].every(value => typeof value === 'string' && value)) throw new Error('浏览器必须绑定当前账号、求职者和会话。');
  return JSON.stringify([scope.userId, scope.candidateId, scope.conversationId]);
};

async function disposeScan(scan) {
  if (!scan) return;
  const handles = new Set([scan.document, ...(scan.documents || []).flatMap(item => [item.document, item.owners]), ...(scan.entries || []).flatMap(item => [item.handle, item.identity])]);
  await Promise.allSettled([...handles].filter(Boolean).map(handle => handle.dispose()));
}

export function createApplicationBrowser({ dataDir = path.join(os.homedir(), '.resume-protocol'), pageProvider, launch = options => chromium.launchPersistentContext(options.directory, options.launchOptions) } = {}) {
  const sessions = new Map();
  const obtain = scope => {
    const session = sessions.get(keyOf(scope));
    if (!session || session.page?.isClosed()) throw new Error('网申浏览器未连接，请先打开并选择网页。');
    return session;
  };
  const status = scope => {
    const session = sessions.get(keyOf(scope));
    return { connected: Boolean(session && !session.page.isClosed()), currentUrl: session ? safeUrl(session.page.url()) : '', tabId: session?.tabId || null, capabilities: ['native-input','textarea','native-select','radio','existing-repeat-rows','scoped-attachment','custom-control-discovery','aria-single-select','same-origin-frames','jiandaoyun-text-radio-single-select-date-file','jiandaoyun-multi-select','jiandaoyun-award-proof-selection','jiandaoyun-native-upload-receipt','bounded-confirmed-record-rows'], limitations: ['ambiguous-checkboxes','unverified-custom-controls','unverified-date-panels','cascaders','automatic-next-page','unverified-add-row-buttons','cross-origin-frames','unverified-other-upload-receipts'], mode: 'blank-only', finalSubmission: 'manual' };
  };
  return {
    status,
    async ensureRows(scope, { records, signal, validateScope } = {}) {
      const session = obtain(scope);
      if (session.busy) throw new Error('当前网页正在填写。');
      validateUrl(session.page.url());
      session.busy = true;
      try {
        const result = await ensureApplicationRows(session.page, { records, signal, validateScope, forbiddenPattern: FORBIDDEN.source });
        return result;
      } finally { await disposeScan(session.scan); session.scan = null; session.busy = false; }
    },
    async start(scope, { url } = {}) {
      keyOf(scope);
      if (sessions.has(keyOf(scope))) return status(scope);
      if (url) validateUrl(url);
      let context, page;
      if (pageProvider) { page = await pageProvider(scope); context = page.context(); }
      else {
        const executablePath = findLocalBrowser();
        if (!executablePath) throw new Error('未找到本机 Chrome 或 Edge。');
        const directory = path.join(dataDir, 'application-browser', createHash('sha256').update(keyOf(scope)).digest('hex'));
        await mkdir(directory, { recursive: true, mode: 0o700 });
        context = await launch({ directory, launchOptions: { executablePath, headless: false, viewport: null } });
        page = context.pages()[0] || await context.newPage();
      }
      const session = { context, page, tabs: new Map(), tabId: randomUUID(), scan: null, injected: Boolean(pageProvider), busy: false };
      session.tabs.set(session.tabId, page);
      sessions.set(keyOf(scope), session);
      if (url) { try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); } catch { throw new Error('网申网页无法打开，请在浏览器中手动打开。'); } }
      return status(scope);
    },
    async tabs(scope) {
      const session = obtain(scope);
      for (const page of session.context.pages()) if (![...session.tabs.values()].includes(page)) session.tabs.set(randomUUID(), page);
      return { tabs: [...session.tabs].filter(([, page]) => !page.isClosed()).map(([id, page]) => ({ id, url: safeUrl(page.url()), selected: page === session.page })) };
    },
    async selectTab(scope, { tabId }) {
      const session = obtain(scope);
      if (session.busy) throw new Error('填写进行中，暂时不能切换网页。');
      const page = session.tabs.get(tabId);
      if (!page || page.isClosed()) throw new Error('所选网页不属于当前会话或已关闭。');
      await disposeScan(session.scan);
      session.page = page; session.tabId = tabId; session.scan = null;
      await page.bringToFront();
      return status(scope);
    },
    async scan(scope) {
      const session = obtain(scope);
      if (session.busy) throw new Error('填写进行中，请稍后扫描。');
      validateUrl(session.page.url());
      await disposeScan(session.scan);
      session.scan = null;
      const document = await session.page.evaluateHandle(() => globalThis.document);
      const entries = [];
      const documents = [];
      let skippedFrames = 0;
      try {
      for (const frame of session.page.frames()) {
      // The present authorization covers this site, not third-party embedded
      // documents. Same-origin nested frames keep their own private identity.
      const origin = await frame.evaluate(() => location.origin).catch(() => null);
      if (origin !== new URL(session.page.url()).origin || documents.length >= 30) { skippedFrames++; continue; }
      const frameDocument = await frame.evaluateHandle(() => document);
      const frameOwners = await frame.evaluateHandle(() => {
        const owners = [];
        for (let current = window; current !== top; current = current.parent) owners.push({ element: current.frameElement, document: current.parent.document });
        return owners;
      });
      const frameUrl = frame.url();
      documents.push({ frame, document: frameDocument, owners: frameOwners, url: frameUrl });
      const portalEntries = await scanJiandaoyunControls(frame, FORBIDDEN.source, { frameOwners });
      if (portalEntries.length) {
        entries.push(...portalEntries.map(entry => ({ ...entry, frame, document: frameDocument, frameOwners, url: frameUrl })));
        if (!await frame.evaluate(doc => document === doc, frameDocument).catch(() => false) || frame.url() !== frameUrl) throw new Error('页面已变化，请重新扫描。');
        continue;
      }
      const handles = await frame.locator('input,textarea,select').elementHandles();
      const radioGroups = new Set();
      for (const handle of handles.slice(0, Math.max(0, 300 - entries.length))) {
        // Discovery class hints must not suppress ordinary inputs just because
        // a larger form container happens to have "dropdown" in its class.
        if (await handle.evaluate(node => Boolean(node.closest('[role="combobox"],.ant-select,.el-select,[data-application-control]')))) { await handle.dispose(); continue; }
        // Public metadata and private DOM identities must share a snapshot;
        // an await between them could bind an old mapping to a reused option.
        const identity = await handle.evaluateHandle((node, forbiddenPattern) => {
          const describe = (item, option = false, radio = false) => {
            const associated = [...(item.labels || [])].map(label => label.textContent.trim()).join(' ');
            const aria = item.getAttribute('aria-label') || '', by = item.getAttribute('aria-labelledby') || '';
            const referenced = by.split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
            const native = option ? radio ? associated || item.value : item.label.trim() : associated || item.getAttribute('placeholder') || item.name || '';
            let groupLabel = '';
            if (!option && item.type === 'radio') {
              const group = item.closest('[role="radiogroup"]');
              const refs = (group?.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
              const container = item.closest('.ant-form-item,.el-form-item,[data-field]');
              groupLabel = refs || group?.getAttribute('aria-label') || container?.querySelector('.ant-form-item-label,.el-form-item__label,label:not(:has(input))')?.textContent?.trim() || item.name;
            }
            return { label: groupLabel || referenced || aria || native, purpose: JSON.stringify([associated, aria, by, referenced, native, groupLabel, option && !radio ? item.textContent : null]) };
          };
          const type = node.tagName === 'SELECT' ? 'select' : node.tagName === 'TEXTAREA' ? 'textarea' : node.type;
          const visible = node.getClientRects().length > 0 && getComputedStyle(node).visibility === 'visible' && !node.closest('[inert]');
          const descriptor = describe(node), label = descriptor.label;
          const section = node.closest('fieldset')?.querySelector('legend')?.textContent || node.closest('[data-section]')?.getAttribute('data-section') || '';
          const rowNode = node.closest('[data-row]') || node.closest('fieldset');
          const row = rowNode ? `row:${[...document.querySelectorAll('[data-row],fieldset')].indexOf(rowNode)}` : '';
          const familyOf = label => /教育|学历经历|education/i.test(label) ? 'education' : /实习|工作经历|工作经验|employment|experience/i.test(label) ? 'employment' : /项目|project/i.test(label) ? 'projects' : null;
          const family = familyOf(section);
          // Include disabled/hidden rows in the slot count: their omission from
          // actionable fields must not shift later rows onto an earlier record.
          const familyRows = family ? [...new Set([...document.querySelectorAll('input,textarea,select')].filter(item => familyOf(item.closest('fieldset')?.querySelector('legend')?.textContent || item.closest('[data-section]')?.getAttribute('data-section') || '') === family).map(item => item.closest('[data-row]') || item.closest('fieldset')).filter(Boolean))] : [];
          const recordIndex = family && rowNode ? familyRows.indexOf(rowNode) : null;
          const formKey = node.form ? `form:${[...document.forms].indexOf(node.form)}` : 'no-form';
          let members = [], occupied;
          if (type === 'radio') {
            members = [...document.querySelectorAll('input[type=radio]')].filter(item => item.name === node.name && item.form === node.form);
            occupied = members.some(item => item.checked);
          } else if (type === 'select') {
            members = [...node.options];
            occupied = Boolean(node.value && !node.selectedOptions[0]?.disabled);
          } else if (type === 'checkbox') occupied = node.checked;
          else if (type === 'file') occupied = node.files.length > 0;
          else occupied = node.value !== '';
          const optionIdentities = members.map(item => ({ node: item, value: item.value, ...describe(item, true, type === 'radio'), disabled: item.disabled, row: type === 'radio' ? item.closest('[data-row]') || item.closest('fieldset') : null }));
          const options = optionIdentities.filter(item => type === 'radio' || (item.value && !item.disabled)).map(({ value, label }) => ({ value, label }));
          const meta = { name: node.name, label: label.slice(0, 200), section: section.slice(0, 160), forbidden: new RegExp(forbiddenPattern, 'i').test(descriptor.purpose + ' ' + node.name + ' ' + section + ' ' + optionIdentities.map(option => option.purpose).join(' ')), row, recordIndex, formKey, type, visible, disabled: node.disabled || node.readOnly, required: node.required, occupied, options, maxLength: node.maxLength > 0 ? node.maxLength : null, accept: node.accept || '' };
          return { meta, form: node.form, row: rowNode, ...descriptor, section, options: optionIdentities };
        }, FORBIDDEN.source);
        const meta = await identity.evaluate(snapshot => snapshot.meta);
        if (!meta.visible || meta.disabled || ['hidden','password','submit','button','reset','image'].includes(meta.type)) { await identity.dispose(); await handle.dispose(); continue; }
        if (meta.type === 'radio') {
          const group = `${meta.formKey}/${meta.name}`;
          if (radioGroups.has(group)) { await identity.dispose(); await handle.dispose(); continue; }
          radioGroups.add(group);
          meta.label = meta.section || meta.label;
        }
        delete meta.visible; delete meta.disabled;
        // Native checkboxes always contain a boolean, not an observable blank;
        // indeterminate can also represent existing aggregate selections.
        const unsupported = meta.type === 'checkbox' || meta.forbidden;
        delete meta.forbidden;
        entries.push({ meta: { id: randomUUID(), ...meta, unsupported }, handle, identity, frame, document: frameDocument, frameOwners, url: frameUrl });
      }
      const custom = await scanCustomControls(frame, FORBIDDEN.source, { frameOwners });
      entries.push(...custom.map(entry => ({ ...entry, frame, document: frameDocument, frameOwners, url: frameUrl })));
      if (!await frame.evaluate(doc => document === doc, frameDocument).catch(() => false) || frame.url() !== frameUrl) throw new Error('页面已变化，请重新扫描。');
      }
      if (!await session.page.evaluate(doc => document === doc, document).catch(() => false)) throw new Error('页面已变化，请重新扫描。');
      session.scan = { id: randomUUID(), page: session.page, url: session.page.url(), document, documents, entries };
      return { scanId: session.scan.id, url: safeUrl(session.scan.url), fields: entries.map(entry => entry.meta), skippedFrames, ...status(scope), notice: '网页可能在填写时自动保存资料；最终提交由你完成。' };
      } catch (error) { await disposeScan({ document, documents, entries }); throw error; }
    },
    async fill(scope, { scanId, answers = [], signal, validateAnswer } = {}) {
      const session = obtain(scope);
      const snapshot = session.scan;
      if (session.busy) throw new Error('当前网页正在填写。');
      if (!snapshot || snapshot.id !== scanId || snapshot.page !== session.page || snapshot.url !== session.page.url() || !await session.page.evaluate(doc => document === doc, snapshot.document).catch(() => false)) throw new Error('页面已变化，请重新扫描。');
      session.busy = true;
      const results = [];
      try {
        for (const answer of answers) {
          signal?.throwIfAborted();
          const entry = snapshot.entries.find(item => item.meta.id === answer.fieldId);
          const record = { fieldId: answer.fieldId, status: 'unsupported' };
          if (!entry || entry.meta.unsupported) { results.push(record); continue; }
          const { handle, meta } = entry;
          try {
            if (session.page.url() !== snapshot.url || entry.frame.isDetached() || entry.frame.url() !== entry.url || !await entry.frame.evaluate(doc => document === doc, entry.document).catch(() => false)) { record.status = 'changed'; results.push(record); continue; }
            if (entry.jiandaoyun) {
              record.status = await fillJiandaoyunControl(entry, { document: entry.document, frameOwners: entry.frameOwners, url: entry.url, value: answer.value, attachment: answer.attachment, forbiddenPattern: FORBIDDEN.source, signal, validateAnswer, answer });
              results.push(record); continue;
            }
            if (entry.custom) {
              if (session.page.url() !== snapshot.url) { record.status = 'changed'; results.push(record); continue; }
              record.status = await fillCustomControl(entry, { document: entry.document, frameOwners: entry.frameOwners, url: entry.url, value: answer.value, forbiddenPattern: FORBIDDEN.source, signal, validateAnswer, answer });
              results.push(record); continue;
            }
            const current = await handle.evaluate(node => {
              if (!node.isConnected || node.disabled || node.readOnly) return 'changed';
              if (!node.getClientRects().length || getComputedStyle(node).visibility !== 'visible' || node.closest('[inert]')) return 'changed';
              if (node.type === 'radio') return [...document.querySelectorAll('input[type=radio]')].some(item => item.name === node.name && item.form === node.form && item.checked) ? 'occupied' : 'blank';
              if (node.type === 'checkbox') return 'occupied';
              if (node.tagName === 'SELECT') return node.value && !node.selectedOptions[0]?.disabled ? 'occupied' : 'blank';
              if (node.type === 'file') return node.files.length ? 'occupied' : 'blank';
              return node.value !== '' ? 'occupied' : 'blank';
            });
            if (current !== 'blank') { record.status = current === 'occupied' ? 'preserved' : current; results.push(record); continue; }
            const value = answer.value;
            if (meta.maxLength && String(value).length > meta.maxLength) { record.status = 'too_long'; results.push(record); continue; }
            const option = ['select','radio'].includes(meta.type) ? meta.options.find(option => option.value === String(value) || option.label === String(value)) : null;
            if (['select','radio'].includes(meta.type) && !option) { results.push(record); continue; }
            if (meta.type === 'file' && (!answer.attachment?.buffer || !answer.attachment?.name)) { results.push(record); continue; }
            if (!['select','radio','file'].includes(meta.type) && (!['text','email','tel','number','url','date','month','textarea','search'].includes(meta.type) || typeof value !== 'string')) { results.push(record); continue; }
            signal?.throwIfAborted();
            if (validateAnswer && validateAnswer(answer) !== true) { record.status = 'missing_evidence'; results.push(record); continue; }
            // The final blank check and native write share one synchronous DOM
            // operation. An awaited Playwright fill/check would leave a window
            // in which an intervening user input could be cleared or replaced.
            record.status = await handle.evaluate((node, state) => {
              let current = window;
              for (const owner of state.frameOwners) {
                const frame = current.frameElement;
                if (frame !== owner.element || current.parent.document !== owner.document || !frame?.isConnected || !frame.getClientRects().length || current.parent.getComputedStyle(frame).visibility !== 'visible' || frame.closest('[inert],[aria-hidden="true"]')) return 'changed';
                current = current.parent;
              }
              if (current !== top || location.href !== state.url) return 'changed';
              const describe = (item, option = false, radio = false) => {
                const associated = [...(item.labels || [])].map(label => label.textContent.trim()).join(' ');
                const aria = item.getAttribute('aria-label') || '', by = item.getAttribute('aria-labelledby') || '';
                const referenced = by.split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
                const native = option ? radio ? associated || item.value : item.label.trim() : associated || item.getAttribute('placeholder') || item.name || '';
                let groupLabel = '';
                if (!option && item.type === 'radio') {
                  const group = item.closest('[role="radiogroup"]');
                  const refs = (group?.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
                  const container = item.closest('.ant-form-item,.el-form-item,[data-field]');
                  groupLabel = refs || group?.getAttribute('aria-label') || container?.querySelector('.ant-form-item-label,.el-form-item__label,label:not(:has(input))')?.textContent?.trim() || item.name;
                }
                return { label: groupLabel || referenced || aria || native, purpose: JSON.stringify([associated, aria, by, referenced, native, groupLabel, option && !radio ? item.textContent : null]) };
              };
              if (!node.isConnected || node.ownerDocument !== state.document || document !== state.document || node.disabled || node.readOnly || node.name !== state.name) return 'changed';
              const type = node.tagName === 'SELECT' ? 'select' : node.tagName === 'TEXTAREA' ? 'textarea' : node.type;
              if (type !== state.type) return 'changed';
              const group = type === 'radio' ? [...document.querySelectorAll('input[type=radio]')].filter(item => item.name === node.name && item.form === node.form) : [];
              const occupied = type === 'radio' ? group.some(item => item.checked) : type === 'checkbox' ? true : type === 'file' ? node.files.length > 0 : type === 'select' ? Boolean(node.value && !node.selectedOptions[0]?.disabled) : node.value !== '';
              if (occupied) return 'preserved';
              // Same-document wizards can hide an old step without replacing
              // its controls or URL. Revalidate in this atomic write as well.
              if (!node.getClientRects().length || getComputedStyle(node).visibility !== 'visible' || node.closest('[inert]')) return 'changed';
              const identityMatches = () => {
                const descriptor = describe(node), rawLabel = descriptor.label;
                const section = node.closest('fieldset')?.querySelector('legend')?.textContent || node.closest('[data-section]')?.getAttribute('data-section') || '';
                const label = type === 'radio' ? section.slice(0, 160) || rawLabel : rawLabel;
                const actualType = node.tagName === 'SELECT' ? 'select' : node.tagName === 'TEXTAREA' ? 'textarea' : node.type;
                return node.isConnected && node.ownerDocument === state.document && document === state.document && node.name === state.name && actualType === state.type && !node.disabled && !node.readOnly && node.getClientRects().length > 0 && getComputedStyle(node).visibility === 'visible' && !node.closest('[inert]') && descriptor.purpose === state.identity.purpose && rawLabel === state.identity.label && section === state.identity.section && label.slice(0, 200) === state.label && section.slice(0, 160) === state.section && node.form === state.identity.form && (node.closest('[data-row]') || node.closest('fieldset')) === state.identity.row && (type !== 'file' || node.accept === state.accept);
              };
              if (!identityMatches()) return 'changed';
              const members = type === 'radio' ? group : type === 'select' ? [...node.options] : [];
              if (members.length !== state.identity.options.length || members.some((item, index) => {
                const expected = state.identity.options[index];
                const descriptor = describe(item, true, type === 'radio');
                return item !== expected.node || item.value !== expected.value || descriptor.purpose !== expected.purpose || descriptor.label !== expected.label || item.disabled !== expected.disabled || (type === 'radio' && (item.closest('[data-row]') || item.closest('fieldset')) !== expected.row);
              })) return 'changed';
              let target = node, property = 'value', next = state.value;
              if (type === 'radio') {
                target = group.find(item => item.value === state.value && !item.disabled);
                if (!target || target.getClientRects().length === 0 || getComputedStyle(target).visibility !== 'visible' || target.closest('[inert]')) return 'changed';
                property = 'checked'; next = true;
              } else if (type === 'select' && ![...node.options].some(item => item.value === next && !item.disabled)) return 'changed';
              else if (type === 'file') {
                const transfer = new DataTransfer();
                transfer.items.add(new File([new Uint8Array(state.attachment.bytes)], state.attachment.name, { type: state.attachment.mimeType }));
                property = 'files'; next = transfer.files;
              }
              const prototype = target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : target.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
              // Use native setters so controlled inputs observe the same value
              // transition; do not click controls or trigger submit handlers.
              Object.getOwnPropertyDescriptor(prototype, property).set.call(target, next);
              target.dispatchEvent(new Event('input', { bubbles: true }));
              target.dispatchEvent(new Event('change', { bubbles: true }));
              if (type === 'file') {
                if (!identityMatches() || location.href !== state.url) return 'changed';
                let after = window;
                for (const owner of state.frameOwners) {
                  const frame = after.frameElement;
                  if (frame !== owner.element || after.parent.document !== owner.document || !frame?.isConnected || !frame.getClientRects().length || after.parent.getComputedStyle(frame).visibility !== 'visible' || frame.closest('[inert],[aria-hidden="true"]')) return 'changed';
                  after = after.parent;
                }
                if (after !== top) return 'changed';
              }
              return type === 'file' ? (target.files.length === 1 && target.files[0].name === state.attachment.name && target.files[0].size === state.attachment.bytes.length ? 'attachment_selected' : 'failed') : property === 'checked' ? (target.checked === next ? 'filled' : 'failed') : (target.value === next ? 'filled' : 'failed');
            }, { document: entry.document, frameOwners: entry.frameOwners, url: entry.url, name: meta.name, type: meta.type, accept: meta.accept, label: meta.label, section: meta.section, identity: entry.identity, value: option?.value ?? value, attachment: meta.type === 'file' ? { name: answer.attachment.name, mimeType: answer.attachment.mimeType || '', bytes: Array.from(answer.attachment.buffer) } : null });
          } catch { signal?.throwIfAborted(); record.status = 'failed'; }
          results.push(record);
        }
        return { results, filled: results.filter(item => item.status === 'filled').length, preserved: results.filter(item => item.status === 'preserved').length, finalSubmission: 'manual', mode: 'blank-only' };
      } finally { session.busy = false; }
    },
    async close(scope) {
      const session = sessions.get(keyOf(scope));
      if (session?.busy) throw new Error('填写进行中，请先取消。');
      sessions.delete(keyOf(scope));
      await disposeScan(session?.scan);
      if (session && !session.injected) await session.context.close();
      return status(scope);
    }
  };
}

function validateUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入完整的网申网页地址。'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('只允许 HTTP/HTTPS 网申网页。');
}
function safeUrl(value) {
  try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return ''; }
}
