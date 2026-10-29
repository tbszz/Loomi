import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createTranslator, readStoredLocale, storeLocale } from './i18n.js';

const I18nContext = createContext(null);

export function I18nProvider({ children, initialLocale }) {
  const [locale, updateLocale] = useState(() => ['en', 'zh'].includes(initialLocale) ? initialLocale : readStoredLocale());
  const setLocale = useCallback(next => {
    if (next !== 'en' && next !== 'zh') return;
    storeLocale(next);
    updateLocale(next);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    window.resumeDesktop?.setLocale?.(locale);
  }, [locale]);
  const value = useMemo(() => ({ locale, setLocale, t: createTranslator(locale) }), [locale, setLocale]);
  return React.createElement(I18nContext.Provider, { value }, children);
}

export function useI18n() {
  // Static renderers and independently imported presentation components default
  // to the stored locale. Interactive app roots always mount the provider.
  return useContext(I18nContext) ?? { locale: readStoredLocale(), setLocale: storeLocale, t: createTranslator() };
}

export function LanguageToggle({ className = 'header-icon' }) {
  const { locale, setLocale, t } = useI18n();
  return React.createElement('button', {
    type: 'button', className: `${className} language-toggle`,
    'aria-label': t('language.switch'), title: t('language.switch'),
    onClick: () => setLocale(locale === 'en' ? 'zh' : 'en'),
  }, locale === 'en' ? '中' : 'EN');
}
