import React, { useRef, useState } from 'react';
import LoomiIntro from './LoomiIntro.jsx';
import LoginScreen from './LoginScreen.jsx';
import './desktop.css';

export default function DesktopEntry({ intro, booting, user, notice, onIntroDone, onSubmit, onSuccess }) {
  const authenticated = useRef(null);
  const [error, setError] = useState('');
  const [entering, setEntering] = useState(false);
  async function enter() {
    setError(''); setEntering(true);
    try { await onSuccess(authenticated.current || user); }
    catch (error) { setError(error.message); }
    finally { setEntering(false); }
  }
  return <>
    <div className="desktop-entry" inert={intro || booting || Boolean(user) || undefined} aria-hidden={intro || booting || Boolean(user) || undefined}>
      <LoginScreen onSubmit={async values => { authenticated.current = await onSubmit(values); }} onSuccess={enter} />
    </div>
    {intro && <LoomiIntro onDone={onIntroDone} />}
    {!intro && booting && <div className="rp-desktop desktop-entry-notice" role="status">正在打开本机工作区…</div>}
    {!intro && (error || notice) && <div className="rp-desktop desktop-entry-notice" role="alert">{error || notice}{(error || user) && <button type="button" onClick={enter} disabled={entering}>重新打开工作区</button>}</div>}
  </>;
}
