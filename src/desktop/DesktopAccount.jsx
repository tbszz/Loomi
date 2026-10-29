import { useI18n } from '../i18nContext.js';
import React, { useEffect, useRef, useState } from 'react';
import { Cloud, FolderOpen, ArrowUpRight, LogOut, X, AlertCircle, Check, LoaderCircle } from 'lucide-react';
import { syncStatusLabel } from './sync-status.js';
import './desktop.css';

const desktop = window.resumeDesktop;

export function DesktopChrome() {
  const { t } = useI18n();
  return <div className="desktop-titlebar"><span>Loomi</span><span className="desktop-titlebar-caption">{t("desktop.personalCareerWorkspace")}</span></div>;
}

export function DesktopAccount({ user, onLogout }) {
  const { locale, t } = useI18n();
  const [status, setStatus] = useState({ state: 'local' });
  const [warnings, setWarnings] = useState([]);
  const [cloudUrl, setCloudUrl] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState('');
  const installingRef = useRef(false);
  const dialog = useRef(null);
  const trigger = useRef(null);
  useEffect(() => {
    let alive = true;
    desktop.sync.getStatus().then(value => { if (alive) setStatus(value); }).catch(error => { if (alive) setStatus({ state: 'error', message: error.message }); });
    desktop.getDiagnostics().then(value => { if (alive) { setWarnings(value.warnings); setCloudUrl(value.cloudUrl); } }).catch(error => { if (alive) setWarnings([error.message]); });
    const stopStatus = desktop.sync.onStatus(setStatus);
    const stopWarnings = desktop.onWarnings(setWarnings);
    return () => { alive = false; stopStatus(); stopWarnings(); };
  }, []);
  useEffect(() => {
    if (!visible) return;
    const element = dialog.current;
    element.showModal();
    return () => { element.close(); trigger.current?.focus(); };
  }, [visible]);
  const close = () => { if (!busy) { setVisible(false); setError(''); } };
  async function signIn(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = new FormData(form);
    setError(''); setBusy(true);
    try {
      const result = await desktop.sync.signIn({ email: String(input.get('email')).trim(), password: String(input.get('password')), cloudUrl: String(input.get('cloudUrl')).trim() });
      setStatus(result); setVisible(false);
    } catch (error) { setError(error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { form.elements.password.value = ''; setBusy(false); }
  }
  async function openData() {
    try { await desktop.openDataFolder(); } catch (error) { setWarnings(current => [...current, error.message]); }
  }
  async function installDeps() {
    if (installingRef.current) return;
    installingRef.current = true;
    setInstalling(true); setInstallError('');
    try { const result = await desktop.installPythonDeps(); setWarnings(result.warnings); }
    catch (error) { setInstallError(error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { installingRef.current = false; setInstalling(false); }
  }
  return <div className="desktop-account-area">
    {(warnings.length > 0 || installError || installing) && <div className="desktop-warning" role="status">
      <div className="desktop-warning-heading"><AlertCircle size={13} aria-hidden="true" /><span>{t("desktop.setupNotice")}</span><button type="button" aria-label={t("desktop.dismissSetupNotice")} onClick={() => { setWarnings([]); setInstallError(''); }} disabled={installing}><X size={13} /></button></div>
      <div className="desktop-warning-details">{warnings.map((warning, i) => <p key={i}>{warning.code ? t(`desktop.warning.${warning.code}`, { packages: (warning.packages || []).join(locale === 'zh' ? '、' : ', ') }) : warning.message || warning}</p>)}{installError && <p role="alert">{installError}</p>}</div>
      <div className="desktop-warning-actions">{(warnings.some(warning => warning.code === 'python-deps') || installing) && <button type="button" onClick={installDeps} disabled={installing}>{installing && <LoaderCircle size={12} className="desktop-spin" />}{installing ? t("desktop.installing") : t("desktop.install")}</button>}<button type="button" onClick={() => desktop.openLogs().catch(error => setWarnings(current => [...current, error.message]))}>{t("desktop.viewLogs")}<ArrowUpRight size={12} /></button></div>
    </div>}
    <div className="desktop-account-card">
      <span className="desktop-avatar" aria-hidden="true">{Array.from(user?.name || 'L')[0].toUpperCase()}</span>
      <div className="desktop-account-identity"><strong title={user?.name || user?.email}>{user?.name || user?.email || t("desktop.localAccount")}</strong><span className="desktop-status" data-state={status.state} title={syncStatusLabel(status, t)}><span className="desktop-status-dot" />{syncStatusLabel(status, t)}</span></div>
      <button type="button" className="desktop-data-button" aria-label={t("desktop.openLocalDataFolder")} title={t("desktop.openLocalDataFolder")} onClick={openData}><FolderOpen size={15} /></button>
      <button type="button" ref={trigger} className="desktop-connect" aria-label={t("desktop.connectCloudAccount")} title={t("desktop.connectCloudAccount")} onClick={() => setVisible(true)}><Cloud size={15} /></button>
      <button type="button" className="desktop-logout" aria-label={t("desktop.signOut")} title={t("desktop.signOut")} onClick={onLogout}><LogOut size={15} /></button>
    </div>
    {visible && <dialog ref={dialog} className="desktop-dialog" aria-labelledby="desktop-connect-title" aria-describedby="desktop-connect-description" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
      <form onSubmit={signIn}>
        <button type="button" className="desktop-dialog-close" aria-label={t("desktop.closeCloudAccountWindow")} onClick={close} disabled={busy}><X size={18} /></button>
        <div className="desktop-cloud-icon"><Cloud size={25} /></div>
        <span className="desktop-eyebrow">{t("desktop.takeYourProgressWithYou")}</span>
        <h2 id="desktop-connect-title">{t("desktop.connectCloudAccount")}</h2>
        <p id="desktop-connect-description">{t("desktop.continueYourCareerPreparationAcrossDevices")}<br />{t("desktop.cloudConnectionIsComingSoonMaterialsAnd")}</p>
        <label>{t("login.email")}<input name="email" type="email" autoComplete="username" placeholder="you@example.com" autoFocus required disabled={busy} /></label>
        <label>{t("login.password")}<input name="password" type="password" autoComplete="current-password" placeholder={t("desktop.enterCloudAccountPassword")} required disabled={busy} /></label>
        <label>{t("desktop.cloudUrl")}<input name="cloudUrl" type="url" defaultValue={cloudUrl} placeholder="https://" required disabled={busy} /></label>
        {error && <div className="desktop-dialog-error" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}
        <button type="submit" className="desktop-submit" disabled={busy}>{busy ? <LoaderCircle size={16} className="desktop-spin" /> : <Cloud size={16} />}{busy ? t("desktop.connecting") : t("desktop.connectAccount")}</button>
        <div className="desktop-local-assurance"><Check size={13} />{t("desktop.youCanUseYourLocalWorkspaceNow")}</div>
      </form>
    </dialog>}
  </div>;
}
