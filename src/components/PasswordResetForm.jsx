import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { requestJson } from '../api.js';

const RESEND_SECONDS = 60;
const post = (url, body) => requestJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Two steps in one form: get a code by email, then set the new password with it.
export function PasswordResetForm({ onBack, onClose, onReset }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState('');
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!wait) return;
    const timer = setTimeout(() => setWait(seconds => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function sendCode() {
    setError('');
    if (!email.trim()) { setError('请先填写邮箱。'); return; }
    setBusy(true);
    try {
      const result = await post('/api/auth/password-reset/request', { email: email.trim() });
      setSent(result.message);
      setWait(RESEND_SECONDS);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') || '');
    if (password.length < 10) { setError('新密码至少需要 10 位。'); return; }
    if (password !== String(form.get('confirm') || '')) { setError('两次输入的新密码不一致。'); return; }
    setBusy(true);
    try {
      const result = await post('/api/auth/password-reset/confirm', { email: email.trim(), code: String(form.get('code') || '').trim(), password });
      await onReset(result.user);
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  }

  return <form className="auth-panel" onSubmit={submit}>
    <button type="button" className="drawer-close" onClick={onClose} aria-label="关闭"><X size={18} /></button>
    <h2>重置密码</h2>
    <label>邮箱<input name="email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /></label>
    <button type="button" className="text-button" onClick={sendCode} disabled={busy || wait > 0}>
      {wait > 0 ? `${wait} 秒后可重新发送` : sent ? '重新发送验证码' : '发送验证码'}
    </button>
    {sent ? <p role="status">{sent}</p> : null}
    {sent ? <>
      <label>验证码<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required /></label>
      <label>新密码<input name="password" type="password" autoComplete="new-password" minLength={10} required /></label>
      <label>确认新密码<input name="confirm" type="password" autoComplete="new-password" minLength={10} required /></label>
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
    {sent ? <button type="submit" disabled={busy}>重置并登录</button> : null}
    <button type="button" className="text-button" onClick={onBack}>想起密码了，去登录</button>
  </form>;
}
