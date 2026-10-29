import React, { useEffect, useRef, useState } from 'react';
import { Cloud, FolderOpen, ArrowUpRight, LogOut, X, AlertCircle, Check, LoaderCircle } from 'lucide-react';
import { syncStatusLabel } from './sync-status.js';
import './desktop.css';

const desktop = window.resumeDesktop;

export function DesktopChrome() {
  return <div className="desktop-titlebar"><span>Loomi</span><span className="desktop-titlebar-caption">个人职业工作区</span></div>;
}

export function DesktopAccount({ user, onLogout }) {
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
      <div className="desktop-warning-heading"><AlertCircle size={13} aria-hidden="true" /><span>环境提示</span><button type="button" aria-label="收起环境提示" onClick={() => { setWarnings([]); setInstallError(''); }} disabled={installing}><X size={13} /></button></div>
      <div className="desktop-warning-details">{warnings.map((warning, i) => <p key={i}>{warning.message || warning}</p>)}{installError && <p role="alert">{installError}</p>}</div>
      <div className="desktop-warning-actions">{(warnings.some(warning => warning.code === 'python-deps') || installing) && <button type="button" onClick={installDeps} disabled={installing}>{installing && <LoaderCircle size={12} className="desktop-spin" />}{installing ? '正在安装…' : '一键安装'}</button>}<button type="button" onClick={() => desktop.openLogs().catch(error => setWarnings(current => [...current, error.message]))}>查看日志 <ArrowUpRight size={12} /></button></div>
    </div>}
    <div className="desktop-account-card">
      <span className="desktop-avatar" aria-hidden="true">{Array.from(user?.name || 'L')[0].toUpperCase()}</span>
      <div className="desktop-account-identity"><strong title={user?.name || user?.email}>{user?.name || user?.email || '本机账户'}</strong><span className="desktop-status" data-state={status.state} title={syncStatusLabel(status)}><span className="desktop-status-dot" />{syncStatusLabel(status)}</span></div>
      <button type="button" className="desktop-data-button" aria-label="打开本机数据文件夹" title="打开本机数据文件夹" onClick={openData}><FolderOpen size={15} /></button>
      <button type="button" ref={trigger} className="desktop-connect" aria-label="连接云端账户" title="连接云端账户" onClick={() => setVisible(true)}><Cloud size={15} /></button>
      <button type="button" className="desktop-logout" aria-label="退出登录" title="退出登录" onClick={onLogout}><LogOut size={15} /></button>
    </div>
    {visible && <dialog ref={dialog} className="desktop-dialog" aria-labelledby="desktop-connect-title" aria-describedby="desktop-connect-description" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
      <form onSubmit={signIn}>
        <button type="button" className="desktop-dialog-close" aria-label="关闭云端账户窗口" onClick={close} disabled={busy}><X size={18} /></button>
        <div className="desktop-cloud-icon"><Cloud size={25} /></div>
        <span className="desktop-eyebrow">把积累，带到下一站</span>
        <h2 id="desktop-connect-title">连接云端账户</h2>
        <p id="desktop-connect-description">在不同设备间继续你的求职准备。<br />云端连接即将开放，当前材料与对话仅保存在本机。</p>
        <label>邮箱<input name="email" type="email" autoComplete="username" placeholder="you@example.com" autoFocus required disabled={busy} /></label>
        <label>密码<input name="password" type="password" autoComplete="current-password" placeholder="输入云端账户密码" required disabled={busy} /></label>
        <label>云端地址<input name="cloudUrl" type="url" defaultValue={cloudUrl} placeholder="https://" required disabled={busy} /></label>
        {error && <div className="desktop-dialog-error" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}
        <button type="submit" className="desktop-submit" disabled={busy}>{busy ? <LoaderCircle size={16} className="desktop-spin" /> : <Cloud size={16} />}{busy ? '正在连接…' : '连接账户'}</button>
        <div className="desktop-local-assurance"><Check size={13} /> 现在也可以安心使用本机工作区</div>
      </form>
    </dialog>}
  </div>;
}
