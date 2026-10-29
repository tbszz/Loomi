// Do not leak a terminal's Electron Node-mode setting into the GUI process.
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [join(__dirname, '..')], { stdio: 'inherit', windowsHide: true, env });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
