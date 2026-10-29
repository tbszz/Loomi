import { uiMessage, resolveUiMessage } from '../i18n.js';
import { useI18n } from '../i18nContext.js';
import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { requestJson } from '../api.js';

const RESEND_SECONDS = 60;
const post = (url, body, t) => requestJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, t);

// Two steps in one form: get a code by email, then set the new password with it.
export function PasswordResetForm({ onBack, onClose, onReset }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState('');
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errorValue, setError] = useState('');
  const error = resolveUiMessage(errorValue, t);

  useEffect(() => {
    if (!wait) return;
    const timer = setTimeout(() => setWait(seconds => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function sendCode() {
    setError('');
    if (!email.trim()) { setError(uiMessage("password.enterYourEmailFirst")); return; }
    setBusy(true);
    try {
      const result = await post('/api/auth/password-reset/request', { email: email.trim() }, t);
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
    if (password.length < 10) { setError(uiMessage("password.newPasswordMustBeAtLeastLabel")); return; }
    if (password !== String(form.get('confirm') || '')) { setError(uiMessage("password.theNewPasswordsDoNotMatch")); return; }
    setBusy(true);
    try {
      const result = await post('/api/auth/password-reset/confirm', { email: email.trim(), code: String(form.get('code') || '').trim(), password }, t);
      await onReset(result.user);
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  }

  return <form className="auth-panel" onSubmit={submit}>
    <button type="button" className="drawer-close" onClick={onClose} aria-label={t("workspace.close")}><X size={18} /></button>
    <h2>{t("workspace.resetPassword")}</h2>
    <label>{t("login.email")}<input name="email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /></label>
    <button type="button" className="text-button" onClick={sendCode} disabled={busy || wait > 0}>
      {wait > 0 ? t("password.resendInSeconds", { seconds: wait }) : sent ? t("password.resendCode") : t("password.sendCode")}
    </button>
    {sent ? <p role="status">{sent}</p> : null}
    {sent ? <>
      <label>{t("password.verificationCode")}<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required /></label>
      <label>{t("password.newPassword")}<input name="password" type="password" autoComplete="new-password" minLength={10} required /></label>
      <label>{t("password.confirmNewPassword")}<input name="confirm" type="password" autoComplete="new-password" minLength={10} required /></label>
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
    {sent ? <button type="submit" disabled={busy}>{t("password.resetSignIn")}</button> : null}
    <button type="button" className="text-button" onClick={onBack}>{t("password.rememberedYourPasswordSignIn")}</button>
  </form>;
}
