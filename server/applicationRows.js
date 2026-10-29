import { setTimeout as delay } from 'node:timers/promises';

const FAMILIES = new Set(['education', 'employment', 'projects', 'awards', 'campusLeadership']);
const DEFAULT_FORBIDDEN = /同意|授权|隐私|签名|签署|声明|验证码|密码|password|captcha|consent|signature|submit|提交|发送|保存|删除|下一步|快速填报|next|save|delete/i.source;

export async function ensureApplicationRows(page, { records, signal, validateScope, forbiddenPattern = DEFAULT_FORBIDDEN } = {}) {
  const desired = normalizeRecords(records);
  const results = [];
  let totalAdded = 0;

  for (const [family, target] of Object.entries(desired)) {
    signal?.throwIfAborted();
    let added = 0;
    let current = 0;
    let status = 'satisfied';
    let reason = '';
    let attempts = 0;
    let verifiedRows = null;

    while (attempts < target) {
      signal?.throwIfAborted();
      const container = await findContainer(page, family, forbiddenPattern);
      if (!container.handle) {
        current = container.count || current;
        status = 'pending';
        reason = container.reason || 'container_not_found';
        break;
      }

      let snapshot;
      try {
        snapshot = await createSnapshot(container, family, target, forbiddenPattern);
        current = snapshot.count;
        if (verifiedRows) {
          const preserved = await snapshot.handle.evaluate((node, rows) => {
            const currentRows = [...node.querySelectorAll('[data-application-row],.fx-subform-row')].filter(row => row.closest('[data-application-records],.fx-subform') === node);
            return rows.every(row => currentRows.includes(row));
          }, verifiedRows);
          if (!preserved) {
            status = 'changed';
            reason = 'old_rows_changed';
            break;
          }
        }
        if (current >= target) {
          status = added ? 'added' : 'satisfied';
          break;
        }

        if (validateScope && await validateScope({ family, target, current }) !== true) {
          status = 'missing_scope';
          reason = 'scope_revoked';
          break;
        }

        const attempt = await snapshot.handle.evaluate(clickOneRow, {
          family,
          target,
          current,
          url: container.frame.url(),
          document: snapshot.document,
          title: snapshot.title,
          button: snapshot.button,
          rows: snapshot.rows,
          previousRows: verifiedRows,
          forbiddenPattern
        });
        if (attempt.status === 'satisfied') {
          current = attempt.count;
          status = current >= target ? added ? 'added' : 'satisfied' : 'pending';
          reason = current >= target ? '' : 'row_count_changed';
          break;
        }
        if (attempt.status !== 'clicked') {
          status = attempt.status;
          reason = attempt.reason || '';
          break;
        }
        attempts += 1;

        const verified = await waitForExactIncrement(snapshot, signal);
        current = verified.count;
        if (verified.status !== 'added') {
          current = snapshot.count;
          status = added ? 'pending' : verified.status;
          reason = verified.reason || '';
          break;
        }
        added += 1;
        totalAdded += 1;
        await verifiedRows?.dispose().catch(() => {});
        verifiedRows = await snapshot.handle.evaluateHandle(node => [...node.querySelectorAll('[data-application-row],.fx-subform-row')].filter(row => row.closest('[data-application-records],.fx-subform') === node));
      } finally {
        await disposeSnapshot(snapshot);
        await container.handle.dispose().catch(() => {});
      }
    }
    if (current < target && !reason && attempts >= target) {
      status = 'pending';
      reason = 'row_budget_exhausted';
    }
    await verifiedRows?.dispose().catch(() => {});

    const pending = Math.max(0, target - current);
    results.push({ family, target, existing: current, added, pending, status, ...(reason ? { reason } : {}) });
  }

  return { added: totalAdded, pending: results.reduce((sum, item) => sum + item.pending, 0), results };
}

function normalizeRecords(records) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) throw new Error('application row records must be an object.');
  const normalized = {};
  for (const [family, count] of Object.entries(records)) {
    if (!FAMILIES.has(family) || !Number.isInteger(count) || count < 0 || count > 20) throw new Error('application row records must use education/employment/projects/awards/campusLeadership counts from 0 to 20.');
    if (count > 0) normalized[family] = count;
  }
  return normalized;
}

async function findContainer(page, family, forbiddenPattern) {
  const top = new URL(page.url());
  const topOrigin = top.origin;
  const candidates = [];
  for (const frame of page.frames()) {
    let url;
    try { url = new URL(frame.url()); } catch { continue; }
    if (url.origin !== topOrigin) continue;
    const handle = await frame.evaluateHandle(findContainersAction, { family, forbiddenPattern });
    const count = await handle.evaluate(items => items.length);
    const rows = count ? await handle.evaluate(items => Math.max(...items.map(item => [...item.querySelectorAll('[data-application-row],.fx-subform-row')].filter(row => row.closest('[data-application-records],.fx-subform') === item).length))) : 0;
    if (count) candidates.push({ frame, handle, count, rows });
    else await handle.dispose();
  }
  const total = candidates.reduce((sum, item) => sum + item.count, 0);
  if (total !== 1) {
    await Promise.allSettled(candidates.map(item => item.handle.dispose()));
    return { handle: null, reason: total ? 'ambiguous_container' : 'container_not_found', count: total ? Math.max(...candidates.map(item => item.rows)) : 0 };
  }
  const item = candidates[0];
  const handle = await item.handle.evaluateHandle(items => items[0]);
  await item.handle.dispose();
  return { frame: item.frame, handle };
}

function findContainersAction({ family, forbiddenPattern }) {
  const text = value => (value || '').replace(/[\u200b-\u200f\ufeff]/g, '').replace(/\s+/g, '').trim();
  const visible = node => node?.isConnected && node.getClientRects().length > 0 && getComputedStyle(node).visibility === 'visible' && !node.closest('[inert],[aria-hidden="true"],.ui-invisible');
  const titleOfFieldLocal = field => field?.querySelector(':scope > .field-label .field-name, :scope > .field-label [title]')?.textContent || field?.querySelector(':scope > .field-label [title]')?.getAttribute('title') || '';
  const familyOfTitleLocal = title => {
    const normalized = text(title);
    if (normalized === '教育经历' || normalized === '教育背景' || normalized === 'education') return 'education';
    if (normalized === '实习经历' || normalized === '工作经历' || normalized === 'employment') return 'employment';
    if (normalized === '项目经历' || normalized === 'projects') return 'projects';
    if (normalized === '获奖经历' || normalized === 'awards') return 'awards';
    if (normalized === '社团干部经历' || normalized === '社团经历' || normalized === 'campusLeadership') return 'campusLeadership';
    return null;
  };
  const safeButtons = new Set(['添加', '新增']);
  const forbidden = new RegExp(forbiddenPattern || '同意|授权|隐私|签名|签署|声明|验证码|密码|password|captcha|consent|signature|submit|提交|发送|保存|删除|下一步|快速填报|next|save|delete', 'i');
  const buttonsFor = container => [...container.querySelectorAll('button')].filter(button => {
    const label = text(button.textContent || button.getAttribute('title') || button.value);
    const type = (button.getAttribute('type') || 'submit').toLowerCase();
    if (type !== 'button' || !visible(button) || button.disabled) return false;
    if (forbidden.test([label, button.className, button.id, button.name, button.getAttribute('title')].join(' '))) return false;
    return safeButtons.has(label);
  });
  const allowed = container => visible(container) && buttonsFor(container).length === 1;
  const explicit = [...document.querySelectorAll(`[data-application-records="${family}"]`)].filter(allowed);
  if (explicit.length) return explicit;
  const protocol = location.protocol === 'https:';
  const jiandaoyun = protocol && /\.jiandaoyun\.com$/i.test(location.hostname) && document.querySelector('.fx-external-form');
  if (!jiandaoyun) return explicit;
  const matches = [...document.querySelectorAll('.fx-field')].flatMap(field => {
    if (!visible(field)) return [];
    const title = titleOfFieldLocal(field);
    if (familyOfTitleLocal(title) !== family) return [];
    const container = field.querySelector(':scope > .field-component > .fx-subform');
    return container && allowed(container) ? [container] : [];
  });
  return [...explicit, ...matches];
}

async function createSnapshot(container, family, target, forbiddenPattern) {
  const snapshot = await container.handle.evaluateHandle((node, state) => {
    const text = value => (value || '').replace(/[\u200b-\u200f\ufeff]/g, '').replace(/\s+/g, '').trim();
    const visible = item => item?.isConnected && item.getClientRects().length > 0 && getComputedStyle(item).visibility === 'visible' && !item.closest('[inert],[aria-hidden="true"],.ui-invisible');
    const familyOfTitleLocal = title => {
      const normalized = text(title);
      if (normalized === '教育经历' || normalized === '教育背景' || normalized === 'education') return 'education';
      if (normalized === '实习经历' || normalized === '工作经历' || normalized === 'employment') return 'employment';
      if (normalized === '项目经历' || normalized === 'projects') return 'projects';
      if (normalized === '获奖经历' || normalized === 'awards') return 'awards';
      if (normalized === '社团干部经历' || normalized === '社团经历' || normalized === 'campusLeadership') return 'campusLeadership';
      return null;
    };
    const titleOfFieldLocal = field => field?.querySelector(':scope > .field-label .field-name, :scope > .field-label [title]')?.textContent || field?.querySelector(':scope > .field-label [title]')?.getAttribute('title') || '';
    const titleOfContainerLocal = item => item.hasAttribute('data-application-records') ? item.getAttribute('data-application-records') : titleOfFieldLocal(item.closest('.fx-field'));
    const rowsOfLocal = item => [...item.querySelectorAll('[data-application-row],.fx-subform-row')].filter(row => row.closest('[data-application-records],.fx-subform') === item);
    const addButtonsLocal = item => {
      const safeButtons = new Set(['添加', '新增']);
      const forbidden = new RegExp(state.forbiddenPattern || '同意|授权|隐私|签名|签署|声明|验证码|密码|password|captcha|consent|signature|submit|提交|发送|保存|删除|下一步|快速填报|next|save|delete', 'i');
      return [...item.querySelectorAll('button')].filter(button => {
        const label = text(button.textContent || button.getAttribute('title') || button.value);
        const type = (button.getAttribute('type') || 'submit').toLowerCase();
        if (type !== 'button' || !visible(button) || button.disabled) return false;
        if (forbidden.test([label, button.className, button.id, button.name, button.getAttribute('title')].join(' '))) return false;
        return safeButtons.has(label);
      });
    };
    const ancestorsVisibleLocal = () => {
      try {
        let current = window;
        while (current !== top) {
          const frame = current.frameElement;
          if (!frame?.isConnected || !frame.getClientRects().length || current.parent.getComputedStyle(frame).visibility !== 'visible' || frame.closest('[inert],[aria-hidden="true"]')) return false;
          current = current.parent;
        }
        return true;
      } catch { return false; }
    };
    const title = titleOfContainerLocal(node);
    const rows = rowsOfLocal(node);
    const button = addButtonsLocal(node)[0] || null;
    return {
      document,
      node,
      title,
      family: familyOfTitleLocal(title) || node.getAttribute('data-application-records') || null,
      count: rows.length,
      rows,
      button,
      ok: Boolean(button) && visible(node) && ancestorsVisibleLocal() && location.href === state.url
    };
  }, { family, target, forbiddenPattern, url: container.frame.url() });
  const meta = await snapshot.evaluate(item => ({ title: item.title, family: item.family, count: item.count, ok: item.ok }));
  return { frame: container.frame, handle: container.handle, identity: snapshot, document: await snapshot.getProperty('document'), button: await snapshot.getProperty('button'), rows: await snapshot.getProperty('rows'), title: meta.title, count: meta.count, ok: meta.ok, family: meta.family };
}

function clickOneRow(container, state) {
  const text = value => (value || '').replace(/[\u200b-\u200f\ufeff]/g, '').replace(/\s+/g, '').trim();
  const visible = node => node?.isConnected && node.getClientRects().length > 0 && getComputedStyle(node).visibility === 'visible' && !node.closest('[inert],[aria-hidden="true"],.ui-invisible');
  const titleOfFieldLocal = field => field?.querySelector(':scope > .field-label .field-name, :scope > .field-label [title]')?.textContent || field?.querySelector(':scope > .field-label [title]')?.getAttribute('title') || '';
  const titleOfContainerLocal = item => item.hasAttribute('data-application-records') ? item.getAttribute('data-application-records') : titleOfFieldLocal(item.closest('.fx-field'));
  const ancestorsVisibleLocal = () => {
    try {
      let current = window;
      while (current !== top) {
        const frame = current.frameElement;
        if (!frame?.isConnected || !frame.getClientRects().length || current.parent.getComputedStyle(frame).visibility !== 'visible' || frame.closest('[inert],[aria-hidden="true"]')) return false;
        current = current.parent;
      }
      return true;
    } catch { return false; }
  };
  const rowsOfLocal = item => [...item.querySelectorAll('[data-application-row],.fx-subform-row')].filter(row => row.closest('[data-application-records],.fx-subform') === item);
  const addButtonsLocal = item => {
    const safeButtons = new Set(['添加', '新增']);
    const forbidden = new RegExp(state.forbiddenPattern || '同意|授权|隐私|签名|签署|声明|验证码|密码|password|captcha|consent|signature|submit|提交|发送|保存|删除|下一步|快速填报|next|save|delete', 'i');
    return [...item.querySelectorAll('button')].filter(button => {
      const label = text(button.textContent || button.getAttribute('title') || button.value);
      const type = (button.getAttribute('type') || 'submit').toLowerCase();
      if (type !== 'button' || !visible(button) || button.disabled) return false;
      if (forbidden.test([label, button.className, button.id, button.name, button.getAttribute('title')].join(' '))) return false;
      return safeButtons.has(label);
    });
  };
  if (!container?.isConnected || document !== state.document || container.ownerDocument !== state.document || location.href !== state.url || !visible(container) || !ancestorsVisibleLocal() || titleOfContainerLocal(container) !== state.title) return { status: 'changed', reason: 'container_changed' };
  const rows = rowsOfLocal(container);
  if (rows.length >= state.target) return { status: 'satisfied', count: rows.length };
  if (state.previousRows && !state.previousRows.every(row => rows.includes(row))) return { status: 'changed', reason: 'old_rows_changed' };
  if (rows.length !== state.current) return { status: rows.length >= state.target ? 'satisfied' : 'pending', count: rows.length, reason: 'row_count_changed' };
  if (rows.length !== state.rows.length || rows.some((row, index) => row !== state.rows[index])) return { status: 'changed', reason: 'old_rows_changed' };
  const buttons = addButtonsLocal(container);
  if (buttons.length !== 1 || buttons[0] !== state.button) return { status: 'changed', reason: 'button_changed' };
  state.button.click();
  return { status: 'clicked' };
}

async function waitForExactIncrement(snapshot, signal) {
  const deadline = Date.now() + 1200;
  let last = { status: 'pending', count: snapshot.count, reason: 'timeout' };
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    last = await snapshot.handle.evaluate((node, state) => {
      const visible = item => item?.isConnected && item.getClientRects().length > 0 && getComputedStyle(item).visibility === 'visible' && !item.closest('[inert],[aria-hidden="true"],.ui-invisible');
      const titleOfFieldLocal = field => field?.querySelector(':scope > .field-label .field-name, :scope > .field-label [title]')?.textContent || field?.querySelector(':scope > .field-label [title]')?.getAttribute('title') || '';
      const titleOfContainerLocal = item => item.hasAttribute('data-application-records') ? item.getAttribute('data-application-records') : titleOfFieldLocal(item.closest('.fx-field'));
      const ancestorsVisibleLocal = () => {
        try {
          let current = window;
          while (current !== top) {
            const frame = current.frameElement;
            if (!frame?.isConnected || !frame.getClientRects().length || current.parent.getComputedStyle(frame).visibility !== 'visible' || frame.closest('[inert],[aria-hidden="true"]')) return false;
            current = current.parent;
          }
          return true;
        } catch { return false; }
      };
      const rowsOfLocal = item => [...item.querySelectorAll('[data-application-row],.fx-subform-row')].filter(row => row.closest('[data-application-records],.fx-subform') === item);
      const rows = rowsOfLocal(node);
      if (!node?.isConnected || document !== state.document || node.ownerDocument !== state.document || location.href !== state.url || !visible(node) || !ancestorsVisibleLocal() || titleOfContainerLocal(node) !== state.title) return { status: 'changed', count: rows.length, reason: 'container_changed' };
      const oldPreserved = state.rows.every(row => rows.includes(row));
      if (!oldPreserved) return { status: 'changed', count: rows.length, reason: 'old_rows_changed' };
      if (rows.length === state.rows.length + 1) return { status: 'added', count: rows.length };
      if (rows.length > state.rows.length + 1) return { status: 'changed', count: rows.length, reason: 'unexpected_increment' };
      return { status: 'pending', count: rows.length, reason: 'timeout' };
    }, { document: snapshot.document, title: snapshot.title, rows: snapshot.rows, button: snapshot.button, url: snapshot.frame.url() });
    if (last.status !== 'pending') return last;
    await delay(50, undefined, { signal });
  }
  return last;
}

async function disposeSnapshot(snapshot) {
  await Promise.allSettled([snapshot?.identity, snapshot?.document, snapshot?.button, snapshot?.rows].filter(Boolean).map(handle => handle.dispose()));
}
