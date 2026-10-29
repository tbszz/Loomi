module.exports = {
  appId: 'com.resumeprotocol.desktop',
  productName: 'Resume Protocol',
  directories: { output: 'release', buildResources: 'desktop/assets' },
  asar: true,
  // Server resources and every dependency are real files: SDK native CLI,
  // Playwright drivers, PDF workers, and system Python scripts all need this.
  asarUnpack: ['server/**', 'src/*.js', 'dist/**', 'desktop/server-entry.js', 'desktop/assets/**', 'scripts/**', 'knowledge/**', 'skills/**', '.claude/**', 'node_modules/**'],
  files: [
    'dist/**', 'server/**', 'src/*.js', 'desktop/main.js', 'desktop/core.js', 'desktop/preload.cjs', 'desktop/server-entry.js', 'desktop/assets/**',
    'scripts/hiring-radar-bridge.py', 'scripts/lib/**', 'knowledge/**', 'skills/**', '.claude/skills/**', 'package.json',
    '!**/*.test.*', '!**/__tests__/**', '!**/test/**', '!**/tests/**', '!**/*.map', '!**/__pycache__/**', '!**/*.pyc',
    '!data/**', '!tmp/**', '!output/**', '!competitor-analysis/**', '!.scan/**', '!release/**', '!**/.env*',
  ],
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'desktop/assets/icon.ico', artifactName: 'Resume-Protocol-${version}-Setup-${arch}.${ext}' },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, deleteAppDataOnUninstall: false },
};
