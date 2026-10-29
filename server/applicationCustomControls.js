import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Class heuristics discover manual fields only. Automatic writes require an
// explicit combobox -> listbox relationship and an observable blank state.
export const CUSTOM_CONTROL_SELECTOR = '[role="combobox"],.ant-select,.el-select,.custom-select,[class*="dropdown"],[class*="datepicker"],[class*="date-picker"],[class*="cascader"],[data-application-control]';

function customControlAction(node, state) {
  const visible = item => item?.isConnected && item.getClientRects().length > 0 && item.ownerDocument.defaultView.getComputedStyle(item).visibility === 'visible' && !item.closest('[inert],[aria-hidden="true"]');
  const disabled = item => item.disabled || item.closest('[aria-disabled="true"],:disabled');
  const text = item => (item?.textContent || '').trim();
  const referenced = item => (item.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => text(document.getElementById(id))).join(' ');
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
  const frameMatched = frameOwnersMatch(state.frameOwners);
  if (state.action !== 'scan' && !frameMatched) return 'changed';
  const wrapper = node.closest('.ant-select,.el-select,[data-application-control]') || node;
  const container = node.closest('.ant-form-item,.el-form-item,[data-field]');
  const labelText = item => {
    if (!item) return '';
    const copy = item.cloneNode(true);
    for (const control of copy.querySelectorAll('input,select,textarea,[role="combobox"],[role="listbox"],.ant-select,.el-select')) control.remove();
    return text(copy);
  };
  const label = referenced(node) || node.getAttribute('aria-label') || [...(node.labels || [])].map(labelText).join(' ') || labelText(container?.querySelector('.ant-form-item-label,.el-form-item__label,label')) || node.getAttribute('name') || '';
  const section = node.closest('fieldset')?.querySelector('legend')?.textContent || node.closest('[data-section]')?.getAttribute('data-section') || '';
  const placeholder = node.getAttribute('aria-placeholder') || node.getAttribute('data-placeholder') || node.getAttribute('placeholder') || text(wrapper.querySelector('.ant-select-selection-placeholder'));
  const contents = node instanceof HTMLInputElement ? node.value : text(node);
  const selected = wrapper.querySelector('.ant-select-selection-item,[aria-selected="true"],[data-selected="true"]');
  const ownedSearch = state.search?.input?.isConnected && state.search.input.value === state.value ? state.search.input : null;
  const searchChanged = state.search && !ownedSearch;
  const occupied = Boolean(selected || node.getAttribute('aria-valuetext') || (contents && contents !== placeholder && node !== ownedSearch) || [...wrapper.querySelectorAll('input')].some(input => input !== ownedSearch && input.value !== ''));
  const controls = node.getAttribute('aria-controls') || '';
  const name = node.getAttribute('name') || '';
  const purpose = JSON.stringify([label, name, section, node.getAttribute('aria-labelledby'), node.getAttribute('aria-label'), placeholder]);
  const form = node.closest('form'), row = node.closest('[data-row]') || node.closest('fieldset');
  const forbidden = new RegExp(state.forbiddenPattern, 'i');
  const optionPurpose = item => [text(item), referenced(item), item.getAttribute('aria-label'), item.getAttribute('data-value')].join(' ');
  const supported = label && node.getAttribute('role') === 'combobox' && controls && !/\s/.test(controls) && placeholder && !disabled(node) &&
    !(node.tagName === 'BUTTON' && node.type !== 'button') && !(node.tagName === 'INPUT' && !['text','search','button'].includes(node.type)) &&
    !node.hasAttribute('aria-multiselectable') && !/教育|实习|工作经历|项目|education|experience|project/i.test(section) && !forbidden.test(purpose);
  const identity = { node, wrapper, container, form, row, label, section, purpose, controls, name, placeholder };
  if (state.action === 'scan') return { ...identity, meta: { id: state.id, type: 'custom-select', name, label: label.slice(0, 200), section: section.slice(0, 160), row: '', recordIndex: null, options: [], required: node.getAttribute('aria-required') === 'true', occupied, unsupported: !supported || !frameMatched, visible: visible(node) } };
  if (searchChanged || document !== state.document || node.ownerDocument !== state.document || location.href !== state.url || !visible(node) || disabled(node) || !supported) return 'changed';
  if (Object.keys(identity).some(key => identity[key] !== state.identity[key])) return 'changed';
  if (state.action === 'verify') return occupied && (contents === state.value || node.getAttribute('aria-valuetext') === state.value || text(selected) === state.value) ? 'filled' : 'failed';
  if (occupied) return 'preserved';
  if (state.action === 'open') {
    if (node.getAttribute('aria-expanded') !== 'true') node.click();
    return 'opened';
  }
  const panel = document.getElementById(controls);
  if (state.action === 'options') {
    if (!visible(panel) || panel.getAttribute('role') !== 'listbox' || panel.getAttribute('aria-multiselectable') === 'true') return { status: 'waiting' };
    const options = [...panel.querySelectorAll('[role="option"]')].filter(item => visible(item) && !disabled(item) && item.closest('[role="listbox"]') === panel);
    if (options.length > 200 || options.some(item => forbidden.test(optionPurpose(item)))) return { status: 'unsupported' };
    const matches = options.filter(item => (referenced(item) || item.getAttribute('aria-label') || text(item)) === state.value);
    if (matches.length !== 1) return { status: matches.length > 1 ? 'unsupported' : options.length ? 'no_match' : 'waiting' };
    const option = matches[0];
    return { status: 'ready', panel, option, purpose: JSON.stringify([text(option), referenced(option), option.getAttribute('aria-label'), option.getAttribute('data-value')]) };
  }
  if (state.action === 'search') {
    const input = node instanceof HTMLInputElement && ['text','search'].includes(node.type) ? node : wrapper.querySelector('input[type="search"],input[type="text"],input:not([type])');
    if (!input || input.disabled || input.readOnly || input.value !== '' || !visible(input)) return 'unsupported';
    const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, state.value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.value === state.value ? { status: 'searched', input, value: state.value } : 'changed';
  }
  if (state.action === 'choose') {
    const expected = state.option;
    if (panel !== expected.panel || !visible(panel) || panel.getAttribute('role') !== 'listbox' || panel.getAttribute('aria-multiselectable') === 'true') return 'changed';
    const option = expected.option;
    const options = [...panel.querySelectorAll('[role="option"]')].filter(item => visible(item) && !disabled(item) && item.closest('[role="listbox"]') === panel);
    const labelOf = item => referenced(item) || item.getAttribute('aria-label') || text(item);
    if (options.length > 200 || !options.includes(option) || options.filter(item => labelOf(item) === state.value).length !== 1 || labelOf(option) !== state.value ||
        JSON.stringify([text(option), referenced(option), option.getAttribute('aria-label'), option.getAttribute('data-value')]) !== expected.purpose ||
        options.some(item => forbidden.test(optionPurpose(item))) || option.closest('button:not([type="button"]),input,a[href]')) return 'changed';
    // Identity, blank state and exact option are checked in the same JS turn.
    option.click();
    return 'selected';
  }
  return 'unsupported';
}

export async function scanCustomControls(page, forbiddenPattern, { frameOwners = [] } = {}) {
  const handles = await page.locator(CUSTOM_CONTROL_SELECTOR).elementHandles();
  const entries = [];
  for (const handle of handles.slice(0, 300)) {
    // Keep the interactive combobox once, rather than also its library wrapper.
    if (await handle.evaluate((node, selector) => node.getAttribute('role') !== 'combobox' && (Boolean(node.querySelector('[role="combobox"]')) || Boolean(node.parentElement?.closest(selector))) || Boolean(node.parentElement?.closest('[role="combobox"]')), CUSTOM_CONTROL_SELECTOR)) { await handle.dispose(); continue; }
    const identity = await handle.evaluateHandle(customControlAction, { action: 'scan', id: randomUUID(), forbiddenPattern, frameOwners });
    const meta = await identity.evaluate(item => item.meta);
    if (!meta.visible) { await identity.dispose(); await handle.dispose(); continue; }
    delete meta.visible;
    entries.push({ meta, handle, identity, custom: true });
  }
  return entries;
}

export async function fillCustomControl(entry, { document, url, value, forbiddenPattern, signal, validateAnswer, answer, frameOwners = [] }) {
  if (typeof value !== 'string' || !value.trim() || value.length > 300) return 'unsupported';
  const state = { document, url, value, forbiddenPattern, identity: entry.identity, frameOwners, search: null };
  const authorize = () => { signal?.throwIfAborted(); return !validateAnswer || validateAnswer(answer) === true; };
  if (!authorize()) return 'missing_evidence';
  const opened = await entry.handle.evaluate(customControlAction, { ...state, action: 'open' });
  if (opened !== 'opened') return opened;
  let options;
  try {
    // Dynamic/portal-mounted options often do not exist in the first scan.
    // Only read the listbox named by this exact control, with bounded waiting.
    const deadline = Date.now() + 1500;
    let searched = false;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      options = await entry.handle.evaluateHandle(customControlAction, { ...state, action: 'options' });
      const status = await options.evaluate(result => typeof result === 'string' ? result : result.status);
      if (status !== 'waiting') {
        if (status === 'no_match' && !searched) {
          await options.dispose(); options = null;
          if (!authorize()) return 'missing_evidence';
          const search = await entry.handle.evaluateHandle(customControlAction, { ...state, action: 'search' });
          const searchStatus = await search.evaluate(result => typeof result === 'string' ? result : result.status);
          if (searchStatus !== 'searched') {
            await search.dispose();
            return searchStatus;
          }
          state.search = search;
          searched = true;
          await delay(50, undefined, { signal });
          continue;
        }
        if (status !== 'ready') return status;
        if (!authorize()) return 'missing_evidence';
        const chosen = await entry.handle.evaluate(customControlAction, { ...state, action: 'choose', option: options });
        if (chosen !== 'selected') return chosen;
        await delay(0);
        signal?.throwIfAborted();
        return await entry.handle.evaluate(customControlAction, { ...state, action: 'verify' });
      }
      await options.dispose(); options = null;
      await delay(50, undefined, { signal });
    }
    return 'unsupported';
  } finally { await options?.dispose(); await state.search?.dispose(); }
}
