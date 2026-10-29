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
  // Advance production rAF with a virtual clock. There are no traveler CSS
  // keyframes to seek: the pure timeline drives refs, SVG and the real card.
  const intro = await newPage({ colorScheme: 'light' });
  const clockStart = new Date('2026-10-28T00:00:00Z');
  await intro.clock.install({ time: clockStart });
  await intro.clock.pauseAt(clockStart);
  await intro.goto(base);
  await intro.locator('.loomi-intro').waitFor();
  assert.equal(await intro.locator('.desktop-login').evaluate(node => getComputedStyle(node).colorScheme), 'dark', 'desktop defaults dark even on a light OS');
  assert.deepEqual(await intro.locator('.loomi-intro').evaluate(node => {
    const style = getComputedStyle(node);
    return ['bg', 'surface', 'ink', 'muted', 'line'].map(name => style.getPropertyValue(`--dt-${name}`).trim());
  }), ['#121211', '#1c1c1a', '#f1eee6', '#a6a398', '#3a3935']);
  assert.equal(await intro.locator('.intro-traveler .lf-fill').first().evaluate(node => getComputedStyle(node).fill), 'rgb(241, 238, 230)', 'canonical Loomi inherits light ink');
  assert.equal(await intro.locator('.loomi-intro .desktop-drag-region').evaluate(node => node.getBoundingClientRect().height), 40);
  assert.equal(await intro.locator('.login-card').evaluate(node => node.closest('[inert]') !== null), true);
  assert.equal(await intro.locator('.login-loomi').evaluate(node => getComputedStyle(node).visibility), 'hidden');
  assert.equal(await intro.getByRole('textbox').count(), 0, 'login fields stay out of the accessibility tree');
  let elapsed = 0;
  for (const [time, phase] of [[240, 'peek'], [1000, 'pull-back'], [2200, 'roll'], [3000, 'climb'], [4000, 'weave'], [5500, 'rest'], [6000, 'rest'], [6800, 'rest'], [7050, 'rest']]) {
    await intro.clock.runFor(time - elapsed);
    elapsed = time;
    assert.equal(await intro.locator('.loomi-intro').getAttribute('data-phase'), phase);
    await shot(intro, `intro-${time}ms-1920x1080`);
    if (time === 240) {
      const eyeScale = await intro.locator('.intro-traveler .loomi-figure').evaluate(node => Number(node.style.getPropertyValue('--lf-eye-scale')));
      // rAF samples at frame boundaries, so allow the opening/closing part of
      // the blink as well as its minimum. The unit test counts the whole blink.
      assert(eyeScale < 1, `single peek blink (eye scale ${eyeScale})`);
    }
    if (time === 2200) {
      assert.equal(await intro.locator('.intro-traveler svg').getAttribute('data-mood'), 'roll');
      assert(await intro.locator('.intro-traveler svg').evaluate(node => Number(node.style.getPropertyValue('--lf-tuck')) > .9));
    }
    if (time === 6000) {
      const aligned = await intro.evaluate(() => {
        const card = document.querySelector('.login-card').getBoundingClientRect();
        const path = document.querySelector('.intro-border');
        const bounds = path.getBoundingClientRect();
        const camera = new DOMMatrix(getComputedStyle(document.querySelector('.intro-stage')).transform);
        return { card: [card.left, card.top, card.width, card.height], border: [bounds.left, bounds.top, bounds.width, bounds.height], scale: camera.a, dash: Number(path.style.strokeDashoffset) };
      });
      assert.equal(aligned.scale, 1, 'camera is reset at real-card reveal');
      assert.equal(aligned.dash, 0, 'border finishes drawing');
      aligned.card.forEach((value, i) => assert(Math.abs(value - aligned.border[i]) < .01, 'silk matches actual card'));
    }
    if (time === 7050) {
      const handoff = await intro.evaluate(() => {
        const traveler = document.querySelector('.intro-traveler');
        const pose = new DOMMatrix(getComputedStyle(traveler).transform);
        const rest = document.querySelector('.login-loomi').getBoundingClientRect();
        const web = document.querySelector('.login-corner-web').getBoundingClientRect();
        const animatedWeb = document.querySelector('.intro-corner-web').getBBox();
        return { x: pose.e, y: pose.f, width: pose.a * traveler.offsetWidth,
          targetX: rest.left + rest.width / 2, targetY: rest.top + rest.height * 70 / 120, targetWidth: rest.width,
          webX: web.left + web.width / 2, webY: web.top + web.height / 2,
          drawnX: animatedWeb.x + animatedWeb.width / 2, drawnY: animatedWeb.y + animatedWeb.height / 2,
          webProgress: [...document.querySelectorAll('.intro-corner-web path')].map(path => Number(path.style.strokeDashoffset)) };
      });
      assert(Math.abs(handoff.x - handoff.targetX) < .01 && Math.abs(handoff.y - handoff.targetY) < .01, 'pet shared-element position');
      assert(Math.abs(handoff.width - handoff.targetWidth) < .5, 'pet shared-element size');
      assert(Math.abs(handoff.webX - handoff.drawnX) < .01 && Math.abs(handoff.webY - handoff.drawnY) < .01, 'small web shared-element position');
      assert(handoff.webProgress.every(value => value === 0), 'eight spokes and three complete rings');
      assert.equal(await intro.locator('.intro-traveler svg').getAttribute('data-mood'), 'hello');
    }
  }
  await intro.clock.runFor(100);
  assert.equal(await intro.locator('.loomi-intro').count(), 0);
  assert.equal(await intro.locator('[inert]').count(), 0);
  assert.equal(await intro.locator('.desktop-login').evaluate(node => node.style.opacity), '');
  assert.equal(await intro.locator('.login-corner-web').evaluate(node => node.style.opacity), '');
  await intro.reload();
  await intro.locator('.login-card').waitFor();
  assert.equal(await intro.locator('.loomi-intro').count(), 0);
  checks.push('7100ms rAF choreography; canonical pet; single blink; tucked roll; measured border; camera reset; pet/web handoff; inert cleanup; once-per-session reload; default dark on light OS');
  await intro.context().close();

  const resized = await newPage();
  await resized.clock.install({ time: clockStart });
  await resized.clock.pauseAt(clockStart);
  await resized.goto(base);
  await resized.locator('.loomi-intro').waitFor();
  await resized.clock.runFor(4000);
  await resized.setViewportSize({ width: 390, height: 844 });
  await resized.clock.runFor(2000);
  const resizedBorder = await resized.evaluate(() => {
    const card = document.querySelector('.login-card').getBoundingClientRect();
    const border = document.querySelector('.intro-border').getBoundingClientRect();
    return { card: [card.left, card.top, card.width, card.height], border: [border.left, border.top, border.width, border.height], overflow: document.documentElement.scrollWidth > innerWidth };
  });
  resizedBorder.card.forEach((value, i) => assert(Math.abs(value - resizedBorder.border[i]) < .01, 'resize remeasures real card'));
  assert.equal(resizedBorder.overflow, false);
  await shot(resized, 'intro-resized-6000ms-390x844');
  await resized.keyboard.press('Escape');
  assert.equal(await resized.locator('.login-heading').evaluate(node => node.style.transform), '', 'skip restores borrowed reveal styles');
  await resized.context().close();
  checks.push('resize during intro remeasures border and resting anchors; 390px viewport; skip restores DOM styles');

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
  await reduced.clock.runFor(200);
  const midFade = await reduced.locator('.intro-wash').evaluate(node => Number(getComputedStyle(node).opacity));
  assert(midFade > .4 && midFade < .6, 'reduced motion is a simple 400ms fade');
  await reduced.clock.runFor(250);
  assert.equal(await reduced.locator('.loomi-intro').count(), 0);
  assert.equal(await reduced.locator('.desktop-login').evaluate(node => getComputedStyle(node).colorScheme), 'dark');
  await reduced.goto(`${base}?skipIntro=1&theme=light`);
  assert.equal(await reduced.locator('.desktop-login').evaluate(node => getComputedStyle(node).colorScheme), 'light');
  checks.push('400ms static reduced-motion fade; default dark and explicit light override');
  await reduced.context().close();

  const motionChange = await newPage();
  await motionChange.clock.install({ time: clockStart });
  await motionChange.clock.pauseAt(clockStart);
  await motionChange.goto(base);
  await motionChange.locator('.loomi-intro').waitFor();
  await motionChange.clock.runFor(3500);
  await motionChange.emulateMedia({ reducedMotion: 'reduce' });
  await motionChange.locator('.loomi-intro[data-reduced="true"]').waitFor();
  assert.equal(await motionChange.locator('.intro-stage').evaluate(node => getComputedStyle(node).transform), 'none', 'changing motion preference cancels zoom');
  assert.equal(await motionChange.locator('.intro-traveler').evaluate(node => getComputedStyle(node).transform), 'none', 'changing motion preference cancels travel');
  await motionChange.clock.runFor(450);
  assert.equal(await motionChange.locator('.loomi-intro').count(), 0);
  await motionChange.context().close();
  checks.push('changing reduced-motion preference mid-intro cancels travel/zoom and completes the static fade');

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
