import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
assert.match(css, /\.result-list\s*\{[^}]*padding:\s*20px 24px/s, '诊断正文必须有独立内边距');
assert.match(css, /\.result-list p\s*\{[^}]*grid-template-columns:\s*16px minmax\(0, 1fr\)/s, '列表标记与可换行正文分列');
assert.match(css, /\.result-panel[^}]*overflow-wrap:\s*anywhere/s, '长字段不能撑开卡片');
assert.match(css, /prefers-reduced-motion: reduce[^]*\.agent-spinner \.spinner-motion/, 'SVG 动画需要静态替代');
console.log('Chat spacing contracts passed');
