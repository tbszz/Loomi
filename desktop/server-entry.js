// Runs in Electron's Node mode, from the unpacked resources directory.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('node:sqlite');
console.log(`Desktop runtime: Electron ${process.versions.electron}; Node ${process.versions.node}; node:sqlite available`);
process.on('message', data => {
  if (data === 'shutdown') process.emit('SIGTERM');
});
// If the desktop crashes, its IPC pipe closes. Do not orphan a local server.
process.on('disconnect', () => process.emit('SIGTERM'));
await import('../server/index.js');
