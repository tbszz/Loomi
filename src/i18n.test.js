import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, translate, readStoredLocale, storeLocale, createTranslator, uiMessage, resolveUiMessage } from './i18n.js';

test('English and Chinese dictionaries have the same nonempty keys and placeholders', () => {
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.zh).sort());
  for (const key of Object.keys(messages.en)) {
    for (const locale of ['en', 'zh']) assert.ok(messages[locale][key].trim(), `${locale}: ${key}`);
    const params = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(params(messages.en[key]), params(messages.zh[key]), key);
  }
});

test('translation interpolates values and falls back safely', () => {
  assert.equal(translate('en', 'jobs.switchTo', { index: 3 }), 'Switch to job 3');
  assert.equal(translate('zh', 'jobs.switchTo', { index: 3 }), '切换到岗位 3');
  assert.equal(translate('unknown', 'language.switch'), 'Switch language');
  assert.equal(translate('en', 'missing.key'), 'missing.key');
  assert.equal(translate('en', 'toString'), 'toString');
  assert.equal(translate('en', 'jobs.switchTo', { index: 0 }), 'Switch to job 0');
  assert.equal(translate('en', 'jobs.switchTo', { index: '$&' }), 'Switch to job $&');
  assert.equal(translate('en', 'jobs.switchTo'), 'Switch to job {index}');
  const previous = messages.zh['language.switch'];
  try {
    delete messages.zh['language.switch'];
    assert.equal(translate('zh', 'language.switch'), 'Switch language');
  } finally { messages.zh['language.switch'] = previous; }
});

test('locale storage defaults to English, validates values, and tolerates denial', () => {
  const storage = new Map();
  const adapter = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  assert.equal(readStoredLocale(adapter), 'en');
  storeLocale('zh', adapter);
  assert.equal(storage.get('loomi.locale'), 'zh');
  assert.equal(readStoredLocale(adapter), 'zh');
  storeLocale('invalid', adapter);
  assert.equal(readStoredLocale(adapter), 'zh');
  storage.set('loomi.locale', 'fr');
  assert.equal(readStoredLocale(adapter), 'en');
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readStoredLocale(denied), 'en');
  assert.doesNotThrow(() => storeLocale('zh', denied));
  assert.equal(readStoredLocale(), 'en');
});

test('local notices switch language while raw server content stays untouched', () => {
  const notice = uiMessage('language.switch');
  assert.equal(resolveUiMessage(notice, createTranslator('en')), 'Switch language');
  assert.equal(resolveUiMessage(notice, createTranslator('zh')), '切换语言');
  assert.equal(resolveUiMessage('模型调用失败：原始详情', createTranslator('en')), '模型调用失败：原始详情');
});

test('denied access to the localStorage property is harmless', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    assert.equal(readStoredLocale(), 'en');
    assert.doesNotThrow(() => storeLocale('zh'));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
