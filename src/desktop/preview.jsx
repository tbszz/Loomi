import { I18nProvider, useI18n } from '../i18nContext.js';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import LoomiIntro from './LoomiIntro.jsx';
import LoginScreen from './LoginScreen.jsx';

const params = new URLSearchParams(window.location.search);
if (['light', 'dark'].includes(params.get('theme'))) document.documentElement.dataset.theme = params.get('theme');

function Preview() {
  const { t } = useI18n();
  const [intro, setIntro] = useState(params.get('skipIntro') !== '1');
  const [success, setSuccess] = useState(false);
  return <>
    {/* Mount beneath the intro so its real card receives the final silk handoff. */}
    <div inert={intro || undefined} aria-hidden={intro || undefined}>
      <LoginScreen onSubmit={async ({ password }) => {
        await new Promise(resolve => setTimeout(resolve, 900));
        if (password === 'wrongpassword1') throw new Error(t("intro.incorrectEmailOrPassword"));
      }} onSuccess={() => setSuccess(true)} />
    </div>
    {intro && <LoomiIntro onDone={() => setIntro(false)} />}
    {success && <div className="desktop-sr-only" role="status" data-preview-success="true">{t("intro.previewOnsuccessTriggered")}</div>}
  </>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><I18nProvider><Preview /></I18nProvider></React.StrictMode>);
