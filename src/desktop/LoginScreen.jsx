import { LanguageToggle, useI18n } from '../i18nContext.js';
import React, { useEffect, useId, useReducer, useRef } from 'react';
import { ArrowRight, Check, Eye, EyeOff, LoaderCircle, LockKeyhole } from 'lucide-react';
import LoomiFigure from './LoomiFigure.jsx';
import { initialLoginState, loginReducer, loomiMood, pupilOffset, validateLogin } from './loginState.js';
import { useReducedMotion } from './useReducedMotion.js';
import { cornerWebPaths } from './introTimeline.js';
import './desktopTheme.css';
import './loginScreen.css';

export default function LoginScreen({ onSubmit, onSuccess }) {
  const { t } = useI18n();
  const [state, dispatch] = useReducer(loginReducer, initialLoginState);
  const id = useId();
  const fields = useRef({});
  const locked = useRef(false);
  const mounted = useRef(false);
  const successCallback = useRef(onSuccess);
  const successSent = useRef(false);
  successCallback.current = onSuccess;
  const reduced = useReducedMotion();
  const busy = state.status === 'submitting' || state.status === 'success';
  const register = state.mode === 'register';

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (state.status !== 'success') return;
    const timer = setTimeout(() => {
      if (successSent.current) return;
      successSent.current = true;
      successCallback.current?.();
    }, reduced ? 150 : 750);
    return () => clearTimeout(timer);
  }, [state.status, reduced]);

  async function submit(event) {
    event.preventDefault();
    if (locked.current) return;
    const { values, errors } = validateLogin(state, t);
    if (Object.keys(errors).length) {
      dispatch({ type: 'invalid', errors });
      fields.current[Object.keys(errors)[0]]?.focus();
      return;
    }
    locked.current = true;
    dispatch({ type: 'submit' });
    try {
      if (typeof onSubmit !== 'function') throw new Error(t("desktop.signInServiceIsTemporarilyUnavailable"));
      await onSubmit(values);
    } catch (error) {
      if (mounted.current) dispatch({ type: 'reject', message: error instanceof Error ? error.message : String(error) });
      locked.current = false;
      return;
    }
    if (mounted.current) dispatch({ type: 'resolve' });
  }

  function inputProps(field) {
    return {
      id: `${id}-${field}`, name: field, value: state[field], disabled: busy, required: true,
      ref: node => { fields.current[field] = node; },
      onChange: event => dispatch({ type: 'change', field, value: event.target.value }),
      onFocus: () => dispatch({ type: 'focus', field }),
      onBlur: () => dispatch({ type: 'focus', field: null }),
      'aria-invalid': Boolean(state.errors[field]),
      'aria-describedby': [state.errors[field] ? `${id}-${field}-error` : '', field === 'password' ? `${id}-password-hint ${id}-caps` : ''].filter(Boolean).join(' ') || undefined,
    };
  }
  const fieldError = field => state.errors[field] && <span className="login-field-error" id={`${id}-${field}-error`}>{validateLogin(state, t).errors[field]}</span>;

  return <main className="rp-desktop desktop-login" data-status={state.status} data-mode={state.mode}>
    <div className="desktop-drag-region" aria-hidden="true" />
    <LanguageToggle className="login-language-toggle" />
    <div className="login-stack">
      <section className="login-card" aria-labelledby={`${id}-title`} style={{ animationName: state.status === 'error' ? (state.attempt % 2 ? 'login-shake' : 'login-shake-again') : 'none' }}>
        <svg className="login-corner-web" viewBox="0 0 105 75" aria-hidden="true">{cornerWebPaths().map((path, i) => <path key={i} d={path} />)}</svg>
        <div className="login-card-content">
          <header className="login-heading">
            <h1 id={`${id}-title`} className="desktop-wordmark">Loomi<sup>®</sup></h1>
            <p className="login-subtitle">{t("desktop.yourLongTermCareerAssistantRememberingEvery")}</p>
          </header>
          <div className="login-mode" role="group" aria-label={t("desktop.accountActions")}>
            {['login', 'register'].map(mode => <button type="button" key={mode} aria-pressed={state.mode === mode} disabled={busy} onClick={() => dispatch({ type: 'mode', mode })}>{mode === 'login' ? t("login.signIn") : t("login.signUp")}</button>)}
          </div>
          <form onSubmit={submit} noValidate aria-busy={state.status === 'submitting'}>
            {register && <div className="login-field">
              <label htmlFor={`${id}-name`}>{t("desktop.name")}</label>
              <input {...inputProps('name')} type="text" autoComplete="nickname" maxLength={120} placeholder={t("desktop.whatShouldLoomiCallYou")} />
              {fieldError('name')}
            </div>}
            <div className="login-field">
              <label htmlFor={`${id}-email`}>{t("login.email")}</label>
              <input {...inputProps('email')} type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} placeholder="you@example.com" />
              {fieldError('email')}
            </div>
            <div className="login-field">
              <label htmlFor={`${id}-password`}>{t("login.password")}</label>
              <div className="login-password">
                <input {...inputProps('password')} type={state.showPassword ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} minLength={10} maxLength={128} placeholder={register ? t("desktop.createA10128CharacterPassword") : t("desktop.enterYourPassword")} onKeyDown={event => dispatch({ type: 'caps', value: event.getModifierState('CapsLock') })} onKeyUp={event => dispatch({ type: 'caps', value: event.getModifierState('CapsLock') })} />
                <button type="button" className="login-visibility" disabled={busy} aria-label={state.showPassword ? t("desktop.hidePassword") : t("desktop.showPassword")} aria-pressed={state.showPassword} onPointerDown={event => event.preventDefault()} onClick={() => { dispatch({ type: 'visibility' }); fields.current.password?.focus(); }}>{state.showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </div>
              {fieldError('password')}
              <div className="login-password-help"><span id={`${id}-password-hint`}>{register ? t("desktop.10128CharactersAnyCharacterTypes") : ''}</span><span id={`${id}-caps`} role="status">{state.capsLock && state.focus === 'password' ? t("desktop.capsLockIsOn") : ''}</span></div>
            </div>
            <div className="login-notice" role="alert" aria-atomic="true">{state.error || (Object.keys(state.errors).some(key => state.errors[key]) ? t("desktop.checkTheInformationAbove") : '')}</div>
            <button className="login-submit" type="submit" disabled={busy}>
              {state.status === 'submitting' ? <><LoaderCircle className="login-spinner" size={17} /><span>{register ? t("desktop.creatingAccount") : t("desktop.signingIn")}</span></> : state.status === 'success' ? <><Check size={17} /><span>{t("desktop.signedInReadyToGo")}</span></> : <><span>{register ? t("desktop.createAccount") : t("login.signIn")}</span><ArrowRight size={17} /></>}
            </button>
            <span className="desktop-sr-only" role="status">{state.status === 'success' ? t("desktop.signedInOpeningWorkspace") : state.status === 'submitting' ? t("desktop.submittingPleaseWait") : ''}</span>
          </form>
        </div>
        <div className="login-loomi" data-error={state.status === 'error'} key={`loomi-${state.attempt}`}><LoomiFigure mood={loomiMood(state)} gaze={pupilOffset(state[state.focus]?.length || 0)} silk={state.status === 'submitting'} /></div>
      </section>
      <footer className="login-footer"><LockKeyhole size={12} aria-hidden="true" /><span>{t("desktop.yourMaterialsStayOnThisComputer")}</span></footer>
    </div>
  </main>;
}
