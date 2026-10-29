const { contextBridge, ipcRenderer } = require('electron');

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
  getDiagnostics: () => ipcRenderer.invoke('desktop:diagnostics'),
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
