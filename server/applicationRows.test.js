import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { ensureApplicationRows } from './applicationRows.js';

const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const forbiddenPattern = /同意|授权|隐私|签名|签署|声明|验证码|密码|password|captcha|consent|signature|submit|提交|发送|保存|删除|下一步|next|save|delete/i.source;

function rowHtml(family = 'employment', title = '实习经历', body = '') {
  return `<form onsubmit="window.submits++;return false"><div class="fx-external-form">
    <div class="fx-field x-grid-col-12" data-widgetname="_widget_${family}">
      <div class="field-label"><div class="field-name field-name-bigger">${title}</div></div>
      <div class="field-component"><div class="fx-subform"><div class="subform-table-wrapper">
        <div class="subform-content"><div>${body || '<div class="fx-subform-row" data-id="row-1"><input value=""></div>'}</div></div>
      </div><div class="btn-pane"><button type="button" class="btn-add"><span>\u200b添加\u200b</span></button><button type="button" class="btn-paste"><span>快速填报</span></button></div></div></div>
    </div>
    <button type="submit">提交</button>
  </div></form><script>
    window.submits = 0; window.adds = 0; window.pastes = 0;
    {
    const root = document.currentScript.previousElementSibling;
    root.querySelector('.btn-add')?.addEventListener('click', () => {
      window.adds++;
      const row = document.createElement('div');
      row.className = 'fx-subform-row';
      row.setAttribute('data-id', 'row-' + (document.querySelectorAll('.fx-subform-row').length + 1));
      row.innerHTML = '<input value="">';
      root.querySelector('.subform-content > div').append(row);
    });
    root.querySelector('.btn-paste')?.addEventListener('click', () => { window.pastes++; });
    }
  </script>`;
}

async function withPage(html, fn, url = 'https://demo.jiandaoyun.com/form') {
  assert.ok(executablePath, 'A real local browser is required');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://demo.jiandaoyun.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await page.route('https://recruit.example.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto(url);
    return await fn(page);
  } finally { await browser.close(); }
}

test('ensureApplicationRows adds only the exact missing Jiandaoyun row and never submits or quick-fills', async () => {
  await withPage(rowHtml(), async page => {
    const result = await ensureApplicationRows(page, { records: { employment: 2 }, forbiddenPattern, validateScope: () => true });
    assert.equal(result.added, 1);
    assert.equal(result.pending, 0);
    assert.equal(await page.locator('.fx-subform-row').count(), 2);
    assert.equal(await page.evaluate(() => window.adds), 1);
    assert.equal(await page.evaluate(() => window.pastes), 0);
    assert.equal(await page.evaluate(() => window.submits), 0);
    assert.equal(result.results[0].status, 'added');
  });
});

test('ensureApplicationRows ignores wrong sections and dangerous buttons', async () => {
  const html = rowHtml('club', '社团经历') + rowHtml('award', '获奖经历').replace('type="button"', 'type="submit"');
  await withPage(html, async page => {
    const result = await ensureApplicationRows(page, { records: { projects: 2, employment: 2 }, forbiddenPattern, validateScope: () => true });
    assert.equal(result.added, 0);
    assert.equal(result.pending, 4);
    assert.equal(await page.evaluate(() => window.adds), 0);
    assert.equal(await page.evaluate(() => window.submits), 0);
  });
});

test('ensureApplicationRows reports pending when a row action detaches old rows', async () => {
  const html = rowHtml('employment', '工作经历') + `<script>
    document.querySelector('.btn-add').replaceWith(document.querySelector('.btn-add').cloneNode(true));
    document.querySelector('.btn-add').addEventListener('click', () => {
      window.adds++;
      document.querySelector('.subform-content > div').innerHTML = '<div class="fx-subform-row" data-id="replacement"></div><div class="fx-subform-row" data-id="new"></div>';
    });
  </script>`;
  await withPage(html, async page => {
    const result = await ensureApplicationRows(page, { records: { employment: 2 }, forbiddenPattern, validateScope: () => true });
    assert.equal(result.added, 0);
    assert.equal(result.pending, 1);
    assert.equal(result.results[0].status, 'changed');
  });
});

test('ensureApplicationRows honors cancellation and revoked candidate scope before clicking', async () => {
  await withPage(rowHtml(), async page => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(ensureApplicationRows(page, { records: { employment: 2 }, forbiddenPattern, signal: controller.signal, validateScope: () => true }), { name: 'AbortError' });
    assert.equal(await page.evaluate(() => window.adds), 0);
  });

  await withPage(rowHtml(), async page => {
    const result = await ensureApplicationRows(page, { records: { employment: 2 }, forbiddenPattern, validateScope: () => false });
    assert.equal(result.added, 0);
    assert.equal(result.pending, 1);
    assert.equal(result.results[0].status, 'missing_scope');
    assert.equal(await page.evaluate(() => window.adds), 0);
  });
});

test('ensureApplicationRows rechecks target count after user-created rows and supports explicit data containers in frames', async () => {
  await withPage(rowHtml(), async page => {
    const result = await ensureApplicationRows(page, { records: { employment: 2 }, forbiddenPattern, validateScope: async () => {
      await page.evaluate(() => {
        const row = document.createElement('div');
        row.className = 'fx-subform-row';
        document.querySelector('.subform-content > div').append(row);
      });
      return true;
    } });
    assert.equal(result.added, 0);
    assert.equal(result.pending, 0);
    assert.equal(result.results[0].status, 'satisfied');
    assert.equal(await page.evaluate(() => window.adds), 0);
  });

  const frameHtml = `<iframe src="/inner"></iframe>`;
  const inner = `<div data-application-records="education"><div data-application-row></div><button type="button">新增</button><script>
    window.adds = 0;
    document.querySelector('button').onclick = () => { window.adds++; const row = document.createElement('div'); row.setAttribute('data-application-row', ''); document.querySelector('[data-application-records]').prepend(row); };
  </script></div>`;
  assert.ok(executablePath, 'A real local browser is required');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://recruit.example.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: route.request().url().endsWith('/inner') ? inner : frameHtml }));
    await page.goto('https://recruit.example.test/form');
    const result = await ensureApplicationRows(page, { records: { education: 2 }, forbiddenPattern, validateScope: () => true });
    const frame = page.frames().find(item => item.url().endsWith('/inner'));
    assert.equal(result.added, 1);
    assert.equal(await frame.locator('[data-application-row]').count(), 2);
    assert.equal(await frame.evaluate(() => window.adds), 1);
  } finally { await browser.close(); }
});

test('ensureApplicationRows validates requested record counts', async () => {
  await withPage(rowHtml(), async page => {
    await assert.rejects(ensureApplicationRows(page, { records: { employment: 21 }, forbiddenPattern }), /records/);
    await assert.rejects(ensureApplicationRows(page, { records: { clubs: 1 }, forbiddenPattern }), /records/);
  });
});

test('ensureApplicationRows supports confirmed awards and campus leadership rows only by exact section', async () => {
  const html = rowHtml('awards', '获奖经历') + rowHtml('campusLeadership', '社团干部经历') + rowHtml('clubActivity', '社团活动') + rowHtml('clubAward', '社团获奖');
  await withPage(html, async page => {
    const result = await ensureApplicationRows(page, { records: { awards: 2, campusLeadership: 2 }, forbiddenPattern, validateScope: () => true });
    assert.equal(result.added, 2);
    assert.equal(result.pending, 0);
    assert.equal(result.results.find(item => item.family === 'awards').status, 'added');
    assert.equal(result.results.find(item => item.family === 'campusLeadership').status, 'added');
    assert.equal(await page.locator('[data-widgetname="_widget_awards"] .fx-subform-row').count(), 2);
    assert.equal(await page.locator('[data-widgetname="_widget_campusLeadership"] .fx-subform-row').count(), 2);
    assert.equal(await page.locator('[data-widgetname="_widget_clubActivity"] .fx-subform-row').count(), 1);
    assert.equal(await page.locator('[data-widgetname="_widget_clubAward"] .fx-subform-row').count(), 1);
    assert.equal(await page.evaluate(() => window.submits), 0);
    assert.equal(await page.evaluate(() => window.pastes), 0);
  });
});

test('ensureApplicationRows preserves old awards rows and rejects near-miss campus sections', async () => {
  await withPage(rowHtml('awards', '获奖经历') + rowHtml('campusLeadership', '社团经历'), async page => {
    const result = await ensureApplicationRows(page, { records: { awards: 3, campusLeadership: 2 }, forbiddenPattern, validateScope: () => true });
    assert.equal(result.added, 3);
    assert.equal(result.pending, 0);
    assert.equal(await page.locator('[data-widgetname="_widget_awards"] .fx-subform-row').count(), 3);
    assert.equal(await page.locator('[data-widgetname="_widget_campusLeadership"] .fx-subform-row').count(), 2);
  });

  await withPage(rowHtml('campusActivity', '社团活动') + rowHtml('campusAward', '社团获奖'), async page => {
    const result = await ensureApplicationRows(page, { records: { campusLeadership: 2 }, forbiddenPattern, validateScope: () => true });
    assert.equal(result.added, 0);
    assert.equal(result.pending, 2);
    assert.equal(result.results[0].reason, 'container_not_found');
    assert.equal(await page.locator('.fx-subform-row').count(), 2);
  });
});

test('ensureApplicationRows matches awards and campus leadership by Jiandaoyun titles without data attributes', async () => {
  const html = rowHtml('', '获奖经历') + rowHtml('', '社团干部经历');
  await withPage(html, async page => {
    const result = await ensureApplicationRows(page, { records: { awards: 2, campusLeadership: 2 }, forbiddenPattern, validateScope: () => true });
    assert.equal(result.added, 2);
    assert.equal(result.pending, 0);
    assert.equal(await page.locator('.fx-field').nth(0).locator('.fx-subform-row').count(), 2);
    assert.equal(await page.locator('.fx-field').nth(1).locator('.fx-subform-row').count(), 2);
    assert.equal(await page.evaluate(() => window.submits), 0);
  }, 'https://demo.jiandaoyun.com/form');
});

test('ensureApplicationRows rechecks title and button identity after async scope validation', async () => {
  await withPage(rowHtml('employment', '实习经历'), async page => {
    const result = await ensureApplicationRows(page, { records: { employment: 2 }, forbiddenPattern, validateScope: async () => {
      await page.locator('.field-name').evaluate(node => { node.textContent = '获奖经历'; });
      return true;
    } });
    assert.equal(result.added, 0);
    assert.equal(result.pending, 1);
    assert.equal(result.results[0].status, 'changed');
    assert.equal(await page.evaluate(() => window.adds), 0);
  });

  await withPage(rowHtml('employment', '工作经历'), async page => {
    const result = await ensureApplicationRows(page, { records: { employment: 2 }, forbiddenPattern, validateScope: async () => {
      await page.locator('.btn-add').evaluate(button => {
        const next = button.cloneNode(true);
        next.addEventListener('click', () => { window.adds = 99; });
        button.replaceWith(next);
      });
      return true;
    } });
    assert.equal(result.added, 0);
    assert.equal(result.pending, 1);
    assert.equal(result.results[0].status, 'changed');
    assert.notEqual(await page.evaluate(() => window.adds), 99);
  });
});

test('ensureApplicationRows rejects same-url document replacement before click', async () => {
  await withPage(rowHtml('employment', '实习经历'), async page => {
    const result = await ensureApplicationRows(page, { records: { employment: 2 }, forbiddenPattern, validateScope: async () => {
      await page.evaluate(html => { document.open(); document.write(html); document.close(); }, rowHtml('employment', '实习经历'));
      return true;
    } });
    assert.equal(result.added, 0);
    assert.equal(result.pending, 1);
    assert.equal(result.results[0].status, 'changed');
    assert.equal(await page.locator('.fx-subform-row').count(), 1);
  });
});

test('ensureApplicationRows preserves old row objects rather than copyable tokens', async () => {
  const html = rowHtml('employment', '实习经历') + `<script>
    document.querySelector('.btn-add').replaceWith(document.querySelector('.btn-add').cloneNode(true));
    document.querySelector('.btn-add').addEventListener('click', () => {
      const old = document.querySelector('.fx-subform-row');
      const clone = old.cloneNode(true);
      old.replaceWith(clone);
      const row = document.createElement('div');
      row.className = 'fx-subform-row';
      document.querySelector('.subform-content > div').append(row);
    });
  </script>`;
  await withPage(html, async page => {
    const result = await ensureApplicationRows(page, { records: { employment: 2 }, forbiddenPattern, validateScope: () => true });
    assert.equal(result.added, 0);
    assert.equal(result.pending, 1);
    assert.equal(result.results[0].status, 'changed');
    assert.equal(result.results[0].reason, 'old_rows_changed');
  });
});

test('ensureApplicationRows keeps pending correct after one add then a failed second add', async () => {
  const html = rowHtml('employment', '实习经历') + `<script>
    document.querySelector('.btn-add').replaceWith(document.querySelector('.btn-add').cloneNode(true));
    document.querySelector('.btn-add').addEventListener('click', () => {
      window.adds++;
      if (window.adds === 1) {
        const row = document.createElement('div');
        row.className = 'fx-subform-row';
        document.querySelector('.subform-content > div').append(row);
        return;
      }
      document.querySelector('.field-name').textContent = '获奖经历';
    });
  </script>`;
  await withPage(html, async page => {
    const result = await ensureApplicationRows(page, { records: { employment: 3 }, forbiddenPattern, validateScope: () => true });
    assert.equal(result.added, 1);
    assert.equal(result.pending, 1);
    assert.equal(result.results[0].existing, 2);
    assert.equal(result.results[0].status, 'pending');
  });
});

test('ensureApplicationRows refuses ambiguous same-family containers', async () => {
  const html = rowHtml('employment', '实习经历') + rowHtml('employment2', '工作经历');
  await withPage(html, async page => {
    const result = await ensureApplicationRows(page, { records: { employment: 2 }, forbiddenPattern, validateScope: () => true });
    assert.equal(result.added, 0);
    assert.equal(result.pending, 1);
    assert.equal(result.results[0].status, 'pending');
    assert.equal(result.results[0].reason, 'ambiguous_container');
  });
});

test('ensureApplicationRows stops when a previously verified row disappears between iterations', async () => {
  const html = rowHtml('employment', '实习经历') + `<script>
    document.querySelector('.btn-add').replaceWith(document.querySelector('.btn-add').cloneNode(true));
    document.querySelector('.btn-add').addEventListener('click', () => {
      window.adds++;
      const row = document.createElement('div');
      row.className = 'fx-subform-row';
      row.textContent = 'row ' + window.adds;
      document.querySelector('.subform-content > div').append(row);
    });
  </script>`;
  await withPage(html, async page => {
    let scopes = 0;
    const result = await ensureApplicationRows(page, { records: { employment: 3 }, forbiddenPattern, validateScope: async () => {
      scopes++;
      if (scopes === 2) await page.locator('.fx-subform-row').last().evaluate(row => row.remove());
      return true;
    } });
    assert.equal(await page.evaluate(() => window.adds), 1);
    assert.equal(result.added, 1);
    assert.equal(result.pending, 1);
    assert.equal(result.results[0].existing, 2);
    assert.equal(result.results[0].status, 'changed');
    assert.equal(result.results[0].reason, 'old_rows_changed');
  });
});
