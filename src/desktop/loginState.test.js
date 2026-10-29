import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialLoginState, loginReducer, validateLogin, loomiMood, pupilOffset } from './loginState.js';

const valid = { mode: 'register', email: '  HELLO@example.com ', name: ' 小林 ', password: 'a'.repeat(10) };

test('normalizes identity but preserves password and enforces server boundaries', () => {
  assert.deepEqual(validateLogin(valid), { values: { mode: 'register', email: 'hello@example.com', name: '小林', password: 'a'.repeat(10) }, errors: {} });
  for (const length of [0, 9, 129]) assert.equal(validateLogin({ ...valid, password: 'a'.repeat(length) }).errors.password, '密码长度必须为 10-128 个字符。');
  for (const length of [10, 128]) assert.deepEqual(validateLogin({ ...valid, password: ' '.repeat(length) }).errors, {});
  for (const email of ['', 'a@b', 'a b@c.com', 'a'.repeat(250) + '@b.com']) assert.equal(validateLogin({ ...valid, email }).errors.email, '请填写有效邮箱。');
  assert.deepEqual(validateLogin({ ...valid, email: 'a'.repeat(248) + '@b.com' }).errors, {});
  for (const name of ['', ' '.repeat(3), 'a'.repeat(121)]) assert.equal(validateLogin({ ...valid, name }).errors.name, '请填写有效姓名。');
  assert.deepEqual(validateLogin({ ...valid, name: 'a'.repeat(120) }).errors, {});
  assert.deepEqual(validateLogin({ ...valid, mode: 'login', name: '' }).errors, {});
});

test('mode switches clear stale errors and password visibility; busy state cannot switch', () => {
  const state = { ...initialLoginState, error: '失败', showPassword: true, errors: { email: '无效' } };
  const switched = loginReducer(state, { type: 'mode', mode: 'register' });
  assert.equal(switched.mode, 'register');
  assert.equal(switched.error, '');
  assert.equal(switched.showPassword, false);
  assert.deepEqual(switched.errors, {});
  assert.equal(loginReducer({ ...state, status: 'submitting' }, { type: 'mode', mode: 'register' }).mode, 'login');
});

test('a rejected submission is an error, and only a resolved submission can succeed', () => {
  const busy = loginReducer(initialLoginState, { type: 'submit' });
  assert.equal(loomiMood(busy), 'submitting');
  const failed = loginReducer(busy, { type: 'reject', message: '邮箱或密码错误。' });
  assert.equal(failed.status, 'error');
  assert.equal(failed.error, '邮箱或密码错误。');
  assert.equal(loomiMood(failed), 'error');
  assert.equal(loginReducer(initialLoginState, { type: 'resolve' }).status, 'idle');
  assert.equal(loginReducer(busy, { type: 'resolve' }).status, 'success');
});

test('password focus conceals eyes, reveal peeks, typing tracks bounded caret position', () => {
  assert.equal(loomiMood({ ...initialLoginState, focus: 'password' }), 'covered');
  assert.equal(loomiMood({ ...initialLoginState, focus: 'password', showPassword: true }), 'peek');
  assert.equal(loomiMood({ ...initialLoginState, focus: 'email' }), 'typing');
  assert.equal(loomiMood(initialLoginState), 'idle');
  assert.equal(pupilOffset(0), -3);
  assert.equal(pupilOffset(16), 0);
  assert.equal(pupilOffset(200), 3);
});

test('refocusing a failed password preserves privacy and the server error', () => {
  const failed = loginReducer(loginReducer(initialLoginState, { type: 'submit' }), { type: 'reject', message: '邮箱或密码错误。' });
  const focused = loginReducer(failed, { type: 'focus', field: 'password' });
  assert.equal(focused.error, '邮箱或密码错误。');
  assert.equal(loomiMood(focused), 'covered');
  assert.equal(loomiMood(loginReducer(focused, { type: 'visibility' })), 'peek');
});
