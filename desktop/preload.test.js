import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const source = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8');
function preload({ savedLocale, savedTheme, existingLocale, denied = false } = {}) {
  let bridge;
  const stored = { 'loomi.locale': existingLocale };
  const sends = [];
  runInNewContext(source, {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
      ipcRenderer: { send: (...args) => sends.push(args), invoke() {}, on() {}, removeListener() {} },
    }),
    process: { platform: 'win32', argv: [savedLocale && `--loomi-locale=${savedLocale}`, savedTheme && `--loomi-theme=${savedTheme}`].filter(Boolean) },
    window: { addEventListener() {} },
    localStorage: {
      getItem: key => { if (denied) throw new Error('denied'); return stored[key]; },
      setItem: (key, value) => { if (denied) throw new Error('denied'); stored[key] = value; },
    },
  });
  return { bridge, sends, stored };
}

test('preload only sends supported locales and retains the theme subscription API', () => {
  const { bridge, sends } = preload();
  assert.equal(typeof bridge.onThemeChange, 'function');
  for (const locale of ['fr', null, {}, 'EN']) bridge.setLocale(locale);
  assert.equal(sends.length, 0);
  bridge.setLocale('zh');
  bridge.setLocale('en');
  assert.deepEqual(sends, [['desktop:set-locale', 'zh'], ['desktop:set-locale', 'en']]);
});

test('locale and theme survive desktop origin changes; the saved preference wins', () => {
  assert.equal(preload({ savedLocale: 'zh' }).stored['loomi.locale'], 'zh');
  assert.equal(preload({ savedLocale: 'zh', existingLocale: 'en' }).stored['loomi.locale'], 'zh');
  assert.equal(preload({ existingLocale: 'zh' }).stored['loomi.locale'], 'zh');
  assert.equal(preload({ savedLocale: 'fr' }).stored['loomi.locale'], undefined);
  assert.equal(preload({ savedTheme: 'light' }).stored['resume-protocol.theme'], 'light');
  assert.equal(preload({ savedTheme: 'blue' }).stored['resume-protocol.theme'], undefined);
  assert.doesNotThrow(() => preload({ savedLocale: 'zh', denied: true }));
});
