import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import LoomiIntro from './LoomiIntro.jsx';
import LoginScreen from './LoginScreen.jsx';

const params = new URLSearchParams(window.location.search);
if (['light', 'dark'].includes(params.get('theme'))) document.documentElement.dataset.theme = params.get('theme');

function Preview() {
  const [intro, setIntro] = useState(params.get('skipIntro') !== '1');
  const [success, setSuccess] = useState(false);
  return <>
    {/* Mount beneath the intro so its real card receives the final silk handoff. */}
    <div inert={intro || undefined} aria-hidden={intro || undefined}>
      <LoginScreen onSubmit={async ({ password }) => {
        await new Promise(resolve => setTimeout(resolve, 900));
        if (password === 'wrongpassword1') throw new Error('邮箱或密码错误。');
      }} onSuccess={() => setSuccess(true)} />
    </div>
    {intro && <LoomiIntro onDone={() => setIntro(false)} />}
    {success && <div className="desktop-sr-only" role="status" data-preview-success="true">预览：已触发 onSuccess。</div>}
  </>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><Preview /></React.StrictMode>);
