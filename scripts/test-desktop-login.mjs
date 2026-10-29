import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.DESKTOP_TEST_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
if (!executablePath) throw new Error('Set DESKTOP_TEST_BROWSER to a locally installed Chrome or Edge.');
const base = process.env.DESKTOP_PREVIEW_URL || 'http://127.0.0.1:5178/desktop-preview.html';
const output = 'output/desktop-login';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const errors = [];
const shots = [];
const checks = [];
async function newPage(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ...options });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.stack));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return page;
}
async function shot(page, name) {
  await page.screenshot({ path: `${output}/${name}.png` });
  shots.push(`${name}.png`);
}
async function loginPage(theme = 'light', viewport) {
  const page = await newPage(viewport ? { viewport } : {});
  await page.goto(`${base}?skipIntro=1&theme=${theme}`);
  await page.locator('.login-card').waitFor();
  return page;
}
try {
  // Freeze CSS animations at precise times; advance the real component timers
  // using Playwright's clock. This exercises the same timeline as production.
  const intro = await newPage();
  const clockStart = new Date('2026-10-28T00:00:00Z');
  await intro.clock.install({ time: clockStart });
  await intro.clock.pauseAt(clockStart);
  await intro.goto(`${base}?theme=light`);
  await intro.locator('.loomi-intro').waitFor();
  let elapsed = 0;
  for (const time of [300, 1000, 1700, 2400, 3200]) {
    await intro.clock.runFor(time - elapsed);
    elapsed = time;
    await intro.evaluate(time => {
      const phaseStart = { silk: 0, arrival: 600, hello: 1400, weave: 2000, handoff: 2800 }[document.querySelector('.loomi-intro').dataset.phase];
      for (const animation of document.getAnimations()) {
        animation.pause();
        animation.currentTime = animation.effect.target.closest('.loomi-figure') ? time - phaseStart : time;
      }
    }, time);
    await shot(intro, `intro-${(time / 1000).toFixed(1)}s-1920x1080`);
  }
  await intro.clock.runFor(200);
  assert.equal(await intro.locator('.loomi-intro').count(), 0);
  await intro.reload();
  await intro.locator('.login-card').waitFor();
  assert.equal(await intro.locator('.loomi-intro').count(), 0);
  checks.push('3300ms completion and once-per-session reload');
  await intro.context().close();

  for (const theme of ['light', 'dark']) {
    for (const viewport of [{ width: 960, height: 640 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
      const page = await loginPage(theme, viewport);
      await shot(page, `login-idle-${theme}-${viewport.width}x${viewport.height}`);
      const geometry = await page.evaluate(() => {
        const card = document.querySelector('.login-card').getBoundingClientRect();
        const footer = document.querySelector('.login-footer').getBoundingClientRect();
        return { left: card.left, right: card.right, bottom: footer.bottom, scrollWidth: document.querySelector('.desktop-login').scrollWidth, width: innerWidth, height: innerHeight };
      });
      assert(geometry.left >= 0 && geometry.right <= geometry.width && geometry.bottom <= geometry.height);
      assert(geometry.scrollWidth <= geometry.width);
      if (viewport.width === 960 && theme === 'light') {
        await page.getByRole('button', { name: '注册', exact: true }).click();
        await page.getByLabel('称呼', { exact: true }).fill('小林');
        await shot(page, 'login-register-light-960x640');
        assert(await page.locator('.login-footer').evaluate(node => node.getBoundingClientRect().bottom <= innerHeight), 'register footer fits at 640px height');
        await page.getByLabel('密码', { exact: true }).fill('short');
        await page.getByRole('button', { name: '创建账户', exact: true }).click();
        assert.equal(await page.getByText('密码长度必须为 10-128 个字符。', { exact: true }).count(), 1);
        assert.equal(await page.locator('[data-preview-success]').count(), 0);
      }
      await page.context().close();
    }
  }
  checks.push('light/dark 960x640, 1920x1080, 2560x1440; register validation');

  const page = await loginPage();
  await page.getByLabel('邮箱', { exact: true }).fill('loomi@example.com');
  await page.getByLabel('密码', { exact: true }).focus();
  assert.equal(await page.locator('.login-loomi svg').getAttribute('data-mood'), 'covered');
  await shot(page, 'login-password-covered-1920x1080');
  await page.getByRole('button', { name: '显示密码' }).click();
  assert.equal(await page.locator('.login-loomi svg').getAttribute('data-mood'), 'peek');
  assert.equal(await page.getByLabel('密码', { exact: true }).getAttribute('type'), 'text');
  await page.waitForTimeout(220);
  await shot(page, 'login-password-peek-1920x1080');
  await page.getByRole('button', { name: '隐藏密码' }).click();
  await page.getByLabel('密码', { exact: true }).evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'CapsLock', modifierCapsLock: true, bubbles: true })));
  assert.equal(await page.getByText('大写锁定已开启', { exact: true }).count(), 1);
  await page.getByLabel('密码', { exact: true }).fill('wrongpassword1');
  await page.getByLabel('密码', { exact: true }).press('Enter');
  assert.equal(await page.getByRole('button', { name: '正在登录' }).isDisabled(), true);
  await shot(page, 'login-submitting-1920x1080');
  await page.getByRole('alert').filter({ hasText: '邮箱或密码错误。' }).waitFor();
  assert.equal(await page.locator('[data-preview-success]').count(), 0);
  assert.equal(await page.locator('.desktop-login').getAttribute('data-status'), 'error');
  await shot(page, 'login-error-1920x1080');
  await page.getByLabel('密码', { exact: true }).focus();
  assert.equal(await page.locator('.login-loomi svg').getAttribute('data-mood'), 'covered');
  assert.equal(await page.getByRole('alert').textContent(), '邮箱或密码错误。');
  await page.getByLabel('密码', { exact: true }).fill('correctpassword1');
  await page.getByLabel('密码', { exact: true }).press('Enter');
  await page.locator('.desktop-login[data-status="success"]').waitFor();
  await page.evaluate(() => {
    for (const animation of document.querySelector('.login-loomi').getAnimations({ subtree: true })) {
      animation.pause(); animation.currentTime = 320;
    }
  });
  await shot(page, 'login-success-1920x1080');
  await page.locator('[data-preview-success="true"]').waitFor();
  checks.push('password cover/peek; Caps Lock hint; Enter submits; thrown error verbatim; retry and onSuccess after resolution');
  await page.context().close();

  for (const gesture of ['Escape', 'Enter', 'Space', 'click', 'button']) {
    const page = await newPage();
    await page.goto(base);
    await page.locator('.loomi-intro').waitFor();
    if (gesture === 'click') await page.locator('.loomi-intro').click({ position: { x: 200, y: 300 } });
    else if (gesture === 'button') await page.getByRole('button', { name: '跳过' }).click();
    else await page.keyboard.press(gesture);
    await page.locator('.loomi-intro').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '登录', exact: true }).first().focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('button', { name: '注册', exact: true }).evaluate(node => node === document.activeElement), true);
    await page.context().close();
  }
  checks.push('all five skip gestures; keyboard focus enters login and mode buttons');

  const reduced = await newPage({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await reduced.clock.install({ time: clockStart });
  await reduced.clock.pauseAt(clockStart);
  await reduced.goto(base);
  await reduced.locator('.loomi-intro').waitFor();
  await shot(reduced, 'intro-reduced-motion-dark');
  assert.equal(await reduced.locator('.intro-traveler').evaluate(node => getComputedStyle(node).transform), 'none');
  await reduced.clock.runFor(450);
  assert.equal(await reduced.locator('.loomi-intro').count(), 0);
  assert.equal(await reduced.locator('.desktop-login').evaluate(node => getComputedStyle(node).colorScheme), 'dark');
  await reduced.goto(`${base}?skipIntro=1&theme=light`);
  assert.equal(await reduced.locator('.desktop-login').evaluate(node => getComputedStyle(node).colorScheme), 'light');
  checks.push('400ms static reduced-motion intro; OS dark preference and explicit light override');
  await reduced.context().close();

  const blocked = await newPage();
  await blocked.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('Denied', 'SecurityError'); } }));
  await blocked.goto(base);
  await blocked.locator('.loomi-intro').waitFor();
  await blocked.keyboard.press('Escape');
  await blocked.locator('.loomi-intro').waitFor({ state: 'detached' });
  checks.push('denied sessionStorage does not break intro or skip');
  await blocked.context().close();
} finally {
  await browser.close();
}
assert.deepEqual(errors, [], 'browser console and runtime errors');
await writeFile(`${output}/verification.json`, JSON.stringify({ executablePath, screenshots: shots, checks, errors }, null, 2));
console.log(`Saved ${shots.length} screenshots. No browser errors.`);
