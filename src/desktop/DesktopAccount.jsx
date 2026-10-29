import React, { useEffect, useRef, useState } from 'react';
import { Cloud, FolderOpen, ArrowUpRight, X, AlertCircle, Check, LoaderCircle } from 'lucide-react';
import { syncStatusLabel } from './sync-status.js';
import './desktop.css';

const desktop = window.resumeDesktop;

export function DesktopChrome() {
  return <div className="desktop-titlebar"><span className="desktop-monogram" aria-hidden="true">RP</span><span>Resume Protocol</span><span className="desktop-titlebar-caption">个人职业工作区</span></div>;
}

export function DesktopAccount({ user }) {
  const [status, setStatus] = useState({ state: 'local' });
  const [warnings, setWarnings] = useState([]);
  const [cloudUrl, setCloudUrl] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
  return <div className="desktop-account-area">
    {warnings.length > 0 && <div className="desktop-warning" role="status"><AlertCircle size={15} aria-hidden="true" /><div>{warnings.map((warning, i) => <p key={i}>{warning}</p>)}<button type="button" onClick={() => desktop.openLogs().catch(error => setWarnings([error.message]))}>查看日志 <ArrowUpRight size={12} /></button></div><button type="button" aria-label="收起环境提示" onClick={() => setWarnings([])}><X size={13} /></button></div>}
    <div className="desktop-account-card">
      <div className="desktop-account-identity"><span className="desktop-avatar" aria-hidden="true">{Array.from(user?.name || 'R')[0].toUpperCase()}</span><div><strong>本机账户</strong><span className="desktop-account-caption">你的职业积累，随时继续</span></div><button type="button" className="desktop-data-button" aria-label="打开本机数据文件夹" title="打开本机数据文件夹" onClick={openData}><FolderOpen size={16} /></button></div>
      <span className="desktop-status" data-state={status.state} title={syncStatusLabel(status)}><span className="desktop-status-dot" />{syncStatusLabel(status)}</span>
      <button type="button" ref={trigger} className="desktop-connect" onClick={() => setVisible(true)}><Cloud size={15} /><span>连接云端账户</span><ArrowUpRight size={14} /></button>
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
