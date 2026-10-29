const { contextBridge, ipcRenderer } = require('electron');

// Each launch uses a free localhost port, hence a new storage origin. Restore
// the desktop preferences main saved in window.json before React reads them.
const argument = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const restore = (key, value, allowed) => {
  try { if (allowed.includes(value)) localStorage.setItem(key, value); } catch { /* Denied storage must not prevent startup. */ }
};
restore('loomi.locale', argument('loomi-locale'), ['en', 'zh']);
restore('resume-protocol.theme', argument('loomi-theme'), ['light', 'dark']);

/** @typedef {{state:'local'|'syncing'|'synced'|'offline'|'error',pending?:number,message?:string}} SyncStatus */
/** @param {string} channel @param {(value:any)=>void} callback @returns {()=>void} */
const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') throw new TypeError('callback required');
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
/** Minimal desktop bridge. No tokens, passwords, filesystem or generic IPC exposed. */
contextBridge.exposeInMainWorld('resumeDesktop', {
  platform: process.platform,
  version: process.argv.find(arg => arg.startsWith('--resume-version='))?.split('=')[1] || '',
  openDataFolder: () => ipcRenderer.invoke('desktop:open-data'),
  openLogs: () => ipcRenderer.invoke('desktop:open-logs'),
  onThemeChange: callback => subscribe('desktop:theme-changed', callback),
  setLocale: locale => { if (locale === 'en' || locale === 'zh') ipcRenderer.send('desktop:set-locale', locale); },
  getDiagnostics: () => ipcRenderer.invoke('desktop:diagnostics'),
  installPythonDeps: () => ipcRenderer.invoke('desktop:install-python-deps'),
  onWarnings: callback => subscribe('desktop:warnings', callback),
  sync: {
    /** @returns {Promise<SyncStatus>} */
    getStatus: () => ipcRenderer.invoke('desktop:sync-status'),
    onStatus: callback => subscribe('desktop:sync-status-changed', callback),
    /** @param {{email:string,password:string,cloudUrl:string}} credentials */
    signIn: credentials => ipcRenderer.invoke('desktop:sync-sign-in', credentials),
    signOut: () => ipcRenderer.invoke('desktop:sync-sign-out'),
    syncNow: () => ipcRenderer.invoke('desktop:sync-now'),
  },
});
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.desktop = 'true';
  const update = () => ipcRenderer.send('desktop:theme', document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  new MutationObserver(update).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  update();
});
