import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { I18nProvider } from "./i18nContext.js";
const renderToStaticMarkup = element => renderMarkup(React.createElement(I18nProvider, { initialLocale: "zh" }, element));
import { transformWithOxc } from "vite";
import { SafeMarkdown } from "./components/SafeMarkdown.js";
import './chatSpacing.test.js';

const main = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const api = readFileSync(new URL("./api.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

// Fonts must resolve from the local system stack. A <link rel=stylesheet> pointing at
// an unreachable font host blocks DOMContentLoaded, so the page renders blank on a
// slow or offline network. Keep the document free of external stylesheets.
assert.doesNotMatch(html, /<link[^>]+href="https?:\/\//i, "index.html must not load an external stylesheet");
assert.doesNotMatch(html, /onlinewebfonts|fonts\.googleapis|fonts\.gstatic/i);
assert.match(html, /Loomi/);

assert.match(main, /LANDING_VIDEO_URL/);
assert.match(main, /hf_20260715_112512_f3b7a972-83dd-4401-9c4b-f08d3733f5ca\.mp4/);
assert.match(main, /loop=\{false\}/);
assert.match(main, /onEnded=\{\(event\) => event\.currentTarget\.pause\(\)\}/);
assert.match(main, /(?:t|uiMessage)\("landing\.start"\)/);
assert.match(main, /Loomi/);
assert.match(main, /window\.location\.hash === "#workspace"/);
assert.match(main, /window\.location\.hash = "workspace"/);
assert.match(main, /window\.history\.replaceState/);
assert.doesNotMatch(main, /Studio|Journal|Reach Us/);

assert.match(main, /workspace-shell/);
assert.match(main, /project-sidebar/);
assert.match(main, /workspace-chat/);
assert.match(main, /evidence-panel/);
assert.match(main, /WorkspaceChat/);
assert.match(main, /theme-toggle/);
assert.match(main, /localStorage\.setItem\(THEME_STORAGE_KEY/);
assert.match(main, /\/api\/projects/);
assert.match(main, /projectId/);
assert.match(main, /\/api\/model-settings/);
assert.match(main, /\/api\/conversations\/\$\{encodeURIComponent\((conversationId|conversation\.id)\)\}\/documents/);
assert.match(main, /annotated\.pdf\?inline=1/);
assert.match(main, /annotated-download/);
assert.match(main, /\/api\/documents\/\$\{encodeURIComponent\(activeDocument\.id\)\}\?inline=1/);
assert.match(main, /resume\.pdf/);
assert.match(main, /resume\.docx/);
assert.match(main, /variant\?\.name \? <ResumeDownloads/);
assert.match(main, /(?:t|uiMessage)\("workspace\.analyzeThisResume"\)/);
assert.match(main, /(?:t|uiMessage)\("workspace\.generateARevisedResume"\)/);
assert.match(main, /(?:t|uiMessage)\("workspace\.basicChecks"\)/);
assert.match(main, /(?:t|uiMessage)\("workspace\.aiAnnotation"\)/);
assert.match(main, /annotations/);
assert.match(main, /theme\.light|theme\.dark/);
assert.match(readFileSync(new URL('./components/WorkspaceChat.jsx', import.meta.url), 'utf8'), /chat\.letSPrepareYourNextStep/);
{
  // 拖拽上传必须与回形针上传共用同一条 uploadResumeFile 链路，遮罩层不拦截指针。
  const workspaceChat = readFileSync(new URL('./components/WorkspaceChat.jsx', import.meta.url), 'utf8');
  const workspaceStyles = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
  assert.match(workspaceChat, /onDropFiles/);
  assert.match(workspaceChat, /dataTransfer\?\.types/);
  assert.match(workspaceChat, /aui-drop-overlay/);
  assert.match(workspaceChat, /(?:t|uiMessage)\("chat\.uploadResumeOrDropIntoTheConversation"\)/);
  assert.match(main, /handleDroppedFiles/);
  assert.match(main, /onDropFiles=\{handleDroppedFiles\}/);
  assert.match(main, /uploadResumeFile\(file\)/);
  assert.match(main, /(?:t|uiMessage)\("workspace\.uploadOneFileAtATimeThe"\)/);
  assert.match(workspaceStyles, /\.aui-drop-overlay \{[^}]*pointer-events: none;/s);
}
assert.match(main, /AttachmentStatus/);
assert.match(main, /(?:t|uiMessage)\("workspace\.fileSavedWaitingForExtractionNoCompleteness"\)/);
assert.match(main, /documents\.find\(\(document\) => document\.id === documentId\)\?\.parseStatus/);
assert.match(main, /attachmentStatusBadge/);
assert.match(main, /unreadable/);
assert.match(main, /(?:t|uiMessage)\("workspace\.useTheSystemModelNoSetupRequired"\)/);
assert.match(main, /ProjectEditor/);
assert.doesNotMatch(main, /window\.prompt/);
assert.doesNotMatch(main, /中间只保留对话/);

assert.doesNotMatch(main, /MiniMax/i);
assert.doesNotMatch(main, /video-backdrop|hero-empty|AI 已配置/);
assert.doesNotMatch(main, /from "\.\/chatStore\.js"/);
assert.doesNotMatch(main, /runAgent|dangerouslySetInnerHTML/);
assert.doesNotMatch(main, /\/api\/intake|\/api\/jobs|\/api\/resume/);
assert.match(api, /credentials: "include"/);
assert.match(api, /timeoutMs = (180_000|310_000)/);

assert.match(styles, /#fff/);
// Both stacks must lead with a font that ships with the OS, so nothing depends on a
// download. Inter and 微软雅黑/PingFang stay as local fallbacks only.
assert.match(styles, /--font-serif: Georgia, "Songti SC", "SimSun", "Times New Roman", serif;/);
assert.match(styles, /--font-sans: Inter, "Segoe UI", Arial, "Microsoft YaHei", "PingFang SC", sans-serif;/);
assert.doesNotMatch(styles, /P22|Mackinac|onlinewebfonts/, "no downloaded webfont may remain in the stylesheet");
assert.match(styles, /"Microsoft YaHei", "PingFang SC", sans-serif/);
assert.match(styles, /--panel-bg: #f7f7f8/);
assert.match(styles, /--panel-bg: #000/);
assert.match(styles, /\.empty-workspace h2 \{[^}]*font-size: 26px/s);
assert.match(styles, /object-fit: contain/);
assert.match(styles, /translateY\(-50%\)/);
assert.match(styles, /workspace-shell/);
assert.match(styles, /grid-template-columns: 260px minmax\(0, 1fr\) 360px/);
assert.match(styles, /mobile-drawer/);
assert.match(styles, /\.mobile-drawer,\r?\n\.mobile-bar \{\r?\n  display: none;\r?\n\}/);
assert.match(styles, /prefers-color-scheme/);
assert.match(styles, /\.attachment-status/);
assert.match(styles, /\.attachment-status\.unreadable/);
assert.match(styles, /\.diagnosis-summary/);
assert.match(styles, /\.diagnosis-state/);
assert.doesNotMatch(styles, /#2B3534|video-fade|bokeh|gradient-orb/);

{
  const rendered = renderToStaticMarkup(React.createElement(SafeMarkdown, {
    text: "## 结论\n### 项目\n1. **先修复** API\n- 打开 https://example.com\n\n```js\nconst ok = true;\n```"
  }));
  assert.match(rendered, /<h2>结论<\/h2>/);
  assert.match(rendered, /<h3>项目<\/h3>/);
  assert.match(rendered, /<ol>/);
  assert.match(rendered, /<ul>/);
  assert.match(rendered, /<strong>先修复<\/strong>/);
  assert.match(rendered, /rel="noopener noreferrer"/);
  assert.match(rendered, /<pre><code>const ok = true;<\/code><\/pre>/);
  assert.doesNotMatch(rendered, /\*\*先修复\*\*/);
}


const resultCards = readFileSync(new URL("./components/ChatResultCards.jsx", import.meta.url), "utf8");
assert.doesNotMatch(resultCards, /job-deck-edge|--deck-scale|--deck-order/, 'job rows must not retain overlapping stack geometry');
assert.match(resultCards, /(?:t|uiMessage)\("results\.noConclusionYet"\)/);
assert.match(resultCards, /(?:t|uiMessage)\("results\.fileSavedWaitingForReliableExtraction"\)/);
assert.match(resultCards, /data\.materialStatus \|\| data\.parseStatus/);
assert.match(resultCards, /(?:t|uiMessage)\("results\.fileSavedNoUsableTextFound"\)/);
assert.match(resultCards, /(?:t|uiMessage)\("results\.cannotAnalyzeResumeContentYet"\)/);
assert.match(resultCards, /value: hasKnownCompleteness \? Math.round\(displayCompleteness\) : null/);
assert.doesNotMatch(resultCards, /context\?\.uploadStatus/);
assert.doesNotMatch(resultCards, /data\.completeness \|\| 0/);
assert.match(resultCards, /eligibility\?\.status !== "rejected"/);
assert.match(resultCards, /(?:t|uiMessage)\("results\.jobsThatFailHardRequirementsAreNot"\)/);
assert.match(resultCards, /fitScore \?\? job\.opportunityScore \?\? job\.matchScore/);
assert.match(resultCards, /(?:t|uiMessage)\("results\.hardRequirementsMatch"\)/);
assert.match(resultCards, /(?:t|uiMessage)\("results\.requirementsNotReadOpenSourceSelectingThe"\)/);
assert.match(resultCards, /(?:t|uiMessage)\("results\.someRequirementsNeedVerification"\)/);
assert.match(resultCards, /data\.uncertainties/);
assert.match(resultCards, /data\.rejected/);
assert.match(resultCards, /data\.related/);
assert.match(resultCards, /!related\.length/);
assert.match(resultCards, /<JobNotes title=\{t\("results\.keywordsInDescriptionOnlyDifferentJobTitle"\)\} items=\{related\} collapsed \/>/);
assert.ok(resultCards.indexOf('items={related}') < resultCards.indexOf('items={rejected}'));
assert.match(resultCards, /(?:t|uiMessage)\("results\.noJobsWithConfirmedMatchingHardRequirements"\)/);
assert.match(resultCards, /<JobDisclosure className="job-note"/);
assert.match(resultCards, /formatJobPoolSummary/);
assert.match(resultCards, /formatJobTitle/);
assert.match(resultCards, /formatJobMeta/);
assert.match(resultCards, /(?:t|uiMessage)\("results\.sourceLinkMissing"\)/);
assert.match(resultCards, /className="job-note-row"/);
assert.match(resultCards, /className="job-note-link"/);
assert.match(resultCards, /(?:t|uiMessage)\("results\.rejected"\)/);
assert.match(resultCards, /<small>\{t\("results\.reference"\)\}<\/small>/);
assert.match(resultCards, /rel="noopener noreferrer"/);
assert.doesNotMatch(resultCards, /function formatJobNote/);
assert.doesNotMatch(resultCards, />查看原文<\/a>/);
assert.match(styles, /\.job-note-row \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/s);
assert.match(styles, /\.job-note-link \{/);

{
  // Compile the real card in memory so the contract checks rendered groups,
  // including the related-only case, without a browser, server or build output.
  // Node renders the JSX contract without Vite's stylesheet loader.
  const nodeResultCards = resultCards.replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, '') + '\nexport { JobRequirements, JobSpacesIndicator };';
  const { code } = await transformWithOxc(nodeResultCards, 'ChatResultCards.jsx', { jsx: { runtime: 'automatic' } });
  const moduleCode = code.replace(/from\s+(["'])([^"']+)\1/g, (_, quote, specifier) =>
    `from ${JSON.stringify(specifier.startsWith('.') ? new URL(specifier, new URL('./components/ChatResultCards.jsx', import.meta.url)).href : import.meta.resolve(specifier))}`);
  const { MessageResult, JobRequirements, JobSpacesIndicator } = await import(`data:text/javascript;base64,${Buffer.from(moduleCode).toString('base64')}`);
  const englishJobs = renderMarkup(React.createElement(MessageResult, { message: { kind: 'jobs', data: { jobs: [{ title: '前端工程师', eligibility: { status: 'passed' } }] } } }));
  assert.match(englishJobs, /View job: 前端工程师/);
  assert.match(englishJobs, /Hard requirements match/);
  assert.doesNotMatch(englishJobs, /硬性条件匹配/);
  const renderJobs = (data) => renderToStaticMarkup(React.createElement(MessageResult, { message: { kind: 'jobs', data } }));
  const mainJob = { id: 'main', title: '前端工程师', eligibility: { status: 'passed' } };
  const relatedJob = { id: 'related', title: '软件工程师', retrievalMatch: 'description', url: 'https://example.com/related', eligibility: { status: 'passed' } };
  const rejectedJob = { id: 'rejected', title: '博士研究员', eligibility: { status: 'rejected' } };
  const rendered = renderJobs({ jobs: [mainJob], related: [relatedJob], rejected: [rejectedJob] });
  const mainList = rendered.match(/<div class="job-list">([\s\S]*?)<details class="job-notes">/)?.[1];
  assert.ok(mainList);
  assert.match(mainList, /前端工程师/);
  assert.match(mainList, /class="job-row job-card passed"/);
  assert.match(mainList, /<button[^>]*aria-label="查看岗位：前端工程师"[^>]*aria-haspopup="dialog"/);
  assert.doesNotMatch(mainList, /选择岗位：|要求与核验|role="dialog"/);
  const withRequirements = renderToStaticMarkup(React.createElement(JobRequirements, { job: {
    ...mainJob,
    deadline: '2026-11-30',
    requirements: ['熟悉 React'],
    fullDescriptionVerified: false,
    eligibility: { status: 'passed', checks: [{ dimension: '技能', status: 'pass', message: '有相关项目', evidence: '简历项目记录' }] }
  } }));
  assert.match(withRequirements, /aria-expanded="true" aria-controls="[^"]+"[^>]*>要求与核验[\s\S]*要求未经企业原文核实[\s\S]*岗位要求[\s\S]*熟悉 React[\s\S]*技能[\s\S]*有相关项目[\s\S]*简历项目记录/);
  const selected = renderToStaticMarkup(React.createElement(MessageResult, {
    message: { kind: 'jobs', data: { jobs: [{ ...mainJob, url: 'https://example.com/main' }] } },
    context: { selectedJob: mainJob }
  }));
  assert.match(selected, /class="job-row job-card passed selected"/);
  assert.match(selected, /已选择/);
  assert.doesNotMatch(selected, /选择岗位：|href="https:\/\/example.com\/main"/);
  const folded = renderJobs({ jobs: Array.from({ length: 6 }, (_, index) => ({ ...mainJob, id: `deck-${index}`, title: `岗位 ${index}`, fitScore: index })) });
  assert.equal((folded.match(/class="job-row job-card passed"/g) || []).length, 6);
  assert.match(folded, /aria-expanded="false"[^>]*>\+1 MORE · 展开全部/);
  assert.match(folded, /class="job-deck-more"[^>]*aria-hidden="true"[^>]*inert=""/);
  assert.doesNotMatch(folded, /job-deck-edge|--deck-scale|--deck-order|margin[^;]*-\d/);
  const motionCss = readFileSync(new URL('./results-motion.css', import.meta.url), 'utf8');
  assert.doesNotMatch(motionCss.split('/* The portal')[0], /job-deck-edge|--deck-scale|margin(?:-top)?:\s*-\d/);
  const indicator = count => renderToStaticMarkup(React.createElement(JobSpacesIndicator, { count, activeIndex: 1, onJump() {} }));
  assert.equal((indicator(5).match(/class="job-space-dot"/g) || []).length, 5);
  assert.equal((indicator(1).match(/class="job-space-dot"/g) || []).length, 1);
  assert.match(indicator(5), /aria-label="切换到岗位 2" aria-current="true"/);
  assert.equal(indicator(10), '', 'large decks use the existing counter instead of dots');
  assert.match(resultCards, /<JobSpacesIndicator count=\{jobs.length\}/);
  assert.doesNotMatch(mainList, /软件工程师|博士研究员/);
  assert.match(rendered, /<details class="job-notes"><summary[^>]*>仅正文提及关键词（标题非该岗位，仅供参考）/);
  assert.doesNotMatch(rendered, /<details[^>]*\bopen(?:=|\s|>)/);
  assert.ok(rendered.indexOf('仅正文提及关键词') < rendered.indexOf('不符条件</h3>'));
  assert.match(rendered, /href="https:\/\/example.com\/related"/);
  const relatedOnly = renderJobs({ jobs: [], related: [relatedJob], total: 1 });
  assert.match(relatedOnly, /本页 1-1 \/ 1/);
  assert.match(relatedOnly, /软件工程师/);
  assert.doesNotMatch(relatedOnly, /class="job-list"/);
  assert.doesNotMatch(renderJobs({ jobs: [mainJob] }), /仅正文提及关键词/);
  const zeroScore = renderJobs({ jobs: [{ ...mainJob, fitScore: 0 }] });
  assert.match(zeroScore, /class="job-strip-score"[^>]*><b>0<\/b>/, 'a real zero score is retained on the strip');
  assert.doesNotMatch(renderJobs({ jobs: [mainJob] }), /class="job-strip-score"/);
  assert.doesNotMatch(renderJobs({ jobs: [mainJob] }), /<b>--<\/b>/);
  const renderDiagnosis = data => renderToStaticMarkup(React.createElement(MessageResult, { message: { kind: 'diagnosis', data } }));
  assert.doesNotMatch(renderDiagnosis({ materialStatus: { status: 'unreadable' } }), /class="result-stats"/);
  const diagnosis = renderDiagnosis({ materialStatus: { status: 'parsed' }, completeness: 75, strengths: ['React 项目'], gaps: [] });
  assert.match(diagnosis, /75<small>%<\/small>/);
  assert.match(diagnosis, /<strong>1<\/strong><span>EVIDENCE/);
  assert.match(diagnosis, /<strong>0<\/strong><span>GAPS/);
}

{
  // Render the actual run card, including its shared presence hook, in memory.
  const compiled = new Map();
  async function jsxModule(url) {
    if (compiled.has(url.href)) return compiled.get(url.href);
    const source = readFileSync(url, 'utf8').replace(/^import\s+["'][^"']+\.css["'];?\s*$/gm, '');
    const { code } = await transformWithOxc(source, url.pathname, { jsx: { runtime: 'automatic' } });
    const imports = [...code.matchAll(/from\s+(["'])([^"']+)\1/g)];
    let resolved = code;
    for (const match of imports) {
      const specifier = match[2];
      const dependency = specifier.startsWith('.') ? new URL(specifier, url) : null;
      const target = dependency?.pathname.endsWith('.jsx') ? await jsxModule(dependency) : dependency?.href || import.meta.resolve(specifier);
      resolved = resolved.replace(match[0], `from ${JSON.stringify(target)}`);
    }
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(resolved).toString('base64')}`;
    compiled.set(url.href, moduleUrl);
    return moduleUrl;
  }
  const { AgentRunTrail } = await import(await jsxModule(new URL('./components/WorkspaceChat.jsx', import.meta.url)));
  const originalNow = Date.now;
  try {
    Date.now = () => 5500;
    const pending = { startedAt: 1000, steps: [{ label: '读取材料', at: 1000 }, { label: '分析岗位', at: 2200 }] };
    const renderRun = props => renderToStaticMarkup(React.createElement(AgentRunTrail, props));
    const markup = renderRun({ pending, canCancel: true, onCancel() {} });
    assert.match(markup, /role="status"/);
    assert.match(markup, /class="agent-step-duration" aria-live="off">1\.2秒/);
    assert.match(markup, /class="agent-step-duration" aria-live="off">3\.3秒/);
    assert.match(markup, /步骤 2 · 4\.5秒/);
    assert.match(markup, /aria-label="停止当前任务"/);
    assert.match(renderRun({ pending: { ...pending, stopping: true }, canCancel: true }), /disabled=""[^>]*>正在停止…/);
    assert.equal(renderRun({ pending: null }), '');
    assert.doesNotMatch(renderRun({ pending, canCancel: false }), /aria-label="停止当前任务"/);
  } finally { Date.now = originalNow; }
}

// Optional browser coverage: --job-spaces-browser or --genie-close-browser.
if (process.argv.includes('--job-spaces-browser') || process.argv.includes('--genie-close-browser')) {
  const { createServer } = await import('vite');
  const { createServer: httpServer } = await import('node:http');
  const { chromium } = await import('playwright-core');
  const { findLocalBrowser } = await import('../server/applicationForms.js');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  const fixture = `<!doctype html><html><body style="margin:0">
    <div class="aui-workspace" data-theme="light"><div class="aui-message-body" id="root" style="width:min(760px,100%);margin:auto"></div>
      <textarea aria-label="Regression composer" style="position:fixed;bottom:20px;left:400px;width:500px;height:80px"></textarea></div>
    <script type="module">
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import { MessageResult } from '/src/components/ChatResultCards.jsx';
      import '/src/styles.css'; import '/src/workspace.css';
      const jobs = Array.from({length:5}, (_, i) => ({id:'job-'+i, title:'Engineer '+(i+1), company:'Company '+(i+1), location:'Remote', fitScore:80+i,
        requirements:Array.from({length:16}, (_, j) => ('Requirement '+j+' with enough detail to scroll independently. ').repeat(4)), eligibility:{status:'passed'}}));
      window.jobRoot = createRoot(document.getElementById('root'));
      window.jobRoot.render(React.createElement(MessageResult, {message:{kind:'jobs',data:{jobs}}, onSelectJob() {}}));
    </script></body></html>`;
  const composerFixture = `<!doctype html><html><body><div id="root"></div>
    <script type="module">
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import { WorkspaceChat } from '/src/components/WorkspaceChat.jsx';
      import '/src/motion.css';
      window.sent = [];
      createRoot(document.getElementById('root')).render(React.createElement(WorkspaceChat, {
        conversation: { id: 'keyboard-regression', messages: [] }, documents: [], busy: false,
        canCancel: false, scrubMessage: message => message,
        onSend: text => { window.sent.push(text); }, onCancel() {}, onAttach() {}
      }));
    </script></body></html>`;
  const server = httpServer(async (request, response) => {
    if (request.url === '/__composer') {
      response.setHeader('Content-Type', 'text/html');
      response.end(await vite.transformIndexHtml('/__composer', composerFixture));
      return;
    }
    if (request.url === '/__job-spaces') {
      response.setHeader('Content-Type', 'text/html');
      response.end(await vite.transformIndexHtml('/__job-spaces', fixture));
    } else vite.middlewares(request, response, () => { response.statusCode = 404; response.end(); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: findLocalBrowser(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
    await page.addInitScript(() => localStorage.setItem("loomi.locale", "zh"));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/__composer`);
    await page.evaluate(() => localStorage.setItem("loomi.locale", "zh"));
    const input = page.getByRole('textbox', { name: '给 Loomi 发消息' });
    const sent = () => page.evaluate(() => window.sent);
    await input.fill('Plain Enter');
    await input.press('Enter');
    assert.deepEqual(await sent(), ['Plain Enter'], 'plain Enter sends exactly once through assistant-ui');
    await input.fill('First line');
    await input.press('Shift+Enter');
    await page.keyboard.insertText('Second line');
    assert.equal(await input.inputValue(), 'First line\nSecond line');
    assert.equal((await sent()).length, 1, 'Shift+Enter does not send');
    await input.dispatchEvent('compositionstart');
    await input.evaluate(element => {
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true }));
    });
    await input.press('Enter');
    assert.equal((await sent()).length, 1, 'composition ref guards IME confirmation');
    await input.dispatchEvent('compositionend');
    await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    await input.dispatchEvent('keydown', { key: 'Enter', keyCode: 229 });
    assert.equal((await sent()).length, 1, 'native composition and legacy 229 Enter do not send');
    await input.press('Enter');
    assert.deepEqual(await sent(), ['Plain Enter', 'First line\nSecond line']);
    // Some IMEs lose compositionend but subsequently emit ordinary input while
    // focus stays in the composer. The stale ref must not block Enter forever.
    await input.dispatchEvent('compositionstart');
    await input.evaluate(element => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(element, '中文已提交');
      element.dispatchEvent(new InputEvent('input', { bubbles: true, data: '中文已提交', inputType: 'insertText', isComposing: false }));
    });
    assert.equal(await page.getByRole('button', { name: '发送消息', exact: true }).isEnabled(), true);
    await input.press('Enter');
    assert.deepEqual(await sent(), ['Plain Enter', 'First line\nSecond line', '中文已提交'], 'plain Enter recovers after input ends an interrupted composition without blur');
    await page.goto(`http://127.0.0.1:${server.address().port}/__job-spaces`);
    await page.evaluate(() => localStorage.setItem("loomi.locale", "zh"));
    if (process.argv.includes('--genie-close-browser')) {
      const closeTimings = {};
      const unlocked = async () => {
        assert.deepEqual(await page.evaluate(() => {
          const input = document.querySelector('textarea');
          const rect = input.getBoundingClientRect();
          return {
            layers: document.querySelectorAll('.job-window-layer, .job-genie-overlay').length,
            overflow: document.body.style.overflow,
            inert: document.querySelector('.aui-workspace').inert,
            hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === input,
          };
        }), { layers: 0, overflow: '', inert: false, hit: true });
      };
      for (const pause of ['before-close', 'mid-close']) {
        await page.locator('.job-strip').first().click();
        await page.waitForFunction(() => !document.querySelector('.job-genie-overlay'));
        const elapsed = await page.evaluate(async pause => {
          const raf = window.requestAnimationFrame;
          window.requestAnimationFrame = pause === 'before-close' ? () => 0 : callback =>
            raf(now => { window.requestAnimationFrame = () => 0; callback(now); });
          const start = performance.now();
          // Document targets must be accepted by the capture keydown handler.
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          try {
            while (document.querySelector('.job-window-layer') && performance.now() - start < 1300) {
              await new Promise(resolve => setTimeout(resolve, 10));
            }
            return performance.now() - start;
          } finally { window.requestAnimationFrame = raf; }
        }, pause);
        assert.ok(elapsed < 1300, `${pause} closes within 1.3s (${elapsed}ms)`);
        closeTimings[pause] = Math.round(elapsed);
        await unlocked();
      }
      // Escape reverses an opening run; its canceled watchdog must not affect the new run.
      await page.locator('.job-strip').first().click();
      await page.waitForFunction(() => document.querySelector('.job-window')?.style.visibility === 'hidden');
      await page.keyboard.press('Escape');
      await page.locator('.job-window-layer').waitFor({ state: 'detached', timeout: 1300 });
      await unlocked();
      // Opening also completes if no frame is ever delivered.
      await page.evaluate(() => {
        window.savedRaf = window.requestAnimationFrame;
        window.requestAnimationFrame = () => 0;
        document.querySelector('.job-strip').click();
      });
      await page.locator('.job-genie-overlay').waitFor({ state: 'attached' });
      await page.waitForFunction(() => !document.querySelector('.job-genie-overlay'), null, { timeout: 1100, polling: 10 });
      assert.equal(await page.locator('.job-window').evaluate(element => getComputedStyle(element).visibility), 'visible');
      await page.evaluate(() => { window.requestAnimationFrame = window.savedRaf; });
      await page.keyboard.press('Escape');
      await page.locator('.job-window-layer').waitFor({ state: 'detached', timeout: 1300 });
      await unlocked();

      // A stalled WAAPI finished promise exercises the independent close deadline.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.locator('.job-strip').first().click();
      const fallbackElapsed = await page.evaluate(async () => {
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          const animation = animate.apply(this, args);
          Object.defineProperty(animation, 'finished', { value: new Promise(() => {}) });
          return animation;
        };
        const start = performance.now();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        try {
          while (document.querySelector('.job-window-layer') && performance.now() - start < 1300) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          return performance.now() - start;
        } finally { Element.prototype.animate = animate; }
      });
      assert.ok(fallbackElapsed >= 1200 && fallbackElapsed < 1300, `overall close deadline: ${fallbackElapsed}ms`);
      closeTimings['overall-fallback'] = Math.round(fallbackElapsed);
      await unlocked();
      await page.emulateMedia({ reducedMotion: 'no-preference' });

      // Hidden pages skip both opening and closing motion entirely.
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.querySelector('.job-strip').click();
      });
      await page.locator('.job-window-layer').waitFor({ state: 'attached' });
      assert.equal(await page.locator('.job-genie-overlay').count(), 0);
      assert.equal(await page.locator('.job-window-layer').evaluate(element => element.getAnimations({ subtree: true }).length), 0);
      await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      await page.locator('.job-window-layer').waitFor({ state: 'detached', timeout: 200 });
      await unlocked();
      await page.evaluate(() => { delete document.visibilityState; });
      assert.deepEqual(errors, []);
      console.log('genie stalled-rAF close browser checks passed', JSON.stringify(closeTimings));
    } else {
    const rows = await page.locator('.job-card').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { top: rect.top, bottom: rect.bottom, height: rect.height, shadow: style.boxShadow };
    }));
    assert.equal(rows.length, 5);
    rows.forEach((row, index) => {
      assert.equal(row.height, 52);
      assert.equal(row.shadow, 'none');
      if (index) assert.ok(row.top >= rows[index - 1].bottom, 'rows never overlap');
    });
    await page.locator('.job-strip').nth(1).click();
    await page.waitForTimeout(460);
    assert.equal(await page.locator('.job-space-dot').count(), 5);
    assert.equal(await page.locator('.job-space').count(), 3, 'only adjacent spaces mount at rest');
    const height = await page.locator('.job-window').evaluate(element => element.getBoundingClientRect().height);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    const sample = await page.evaluate(() => {
      const viewport = document.querySelector('.job-spaces-viewport').getBoundingClientRect();
      return {
        transform: getComputedStyle(document.querySelector('.job-spaces-track')).transform,
        visible: [...document.querySelectorAll('.job-space')].filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.right > viewport.left && rect.left < viewport.right;
        }).map(element => Number(element.dataset.spaceIndex))
      };
    });
    assert.deepEqual(sample.visible, [1, 2], 'outgoing job 2 and incoming job 3 share the viewport at 200ms');
    await page.waitForTimeout(380);
    assert.equal(await page.locator('.job-window-counter').innerText(), '3 / 5');
    assert.equal(await page.locator('.job-window').evaluate(element => element.getBoundingClientRect().height), height);
    const viewport = page.locator('.job-spaces-viewport');
    await page.locator('.job-space[data-space-index="2"]').evaluate(element => { element.scrollTop = 150; });
    assert.ok(await page.locator('.job-space[data-space-index="2"]').evaluate(element => element.scrollTop) > 0);
    await viewport.dispatchEvent('wheel', { deltaX: 160, deltaY: 0 });
    await page.waitForTimeout(700);
    assert.equal(await page.locator('.job-window-counter').innerText(), '4 / 5');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(580);
    assert.equal(await page.locator('.job-space[data-space-index="2"]').evaluate(element => element.scrollTop), 0, 'reactivating a space resets its scroll');
    await viewport.dispatchEvent('wheel', { deltaX: 1, deltaY: 0 });
    await page.waitForTimeout(700);
    assert.equal(await page.locator('.job-window-counter').innerText(), '3 / 5', 'a small gesture snaps back');
    await viewport.dispatchEvent('wheel', { deltaX: 0, deltaY: 160 });
    await page.waitForTimeout(160);
    assert.equal(await page.locator('.job-window-counter').innerText(), '3 / 5', 'vertical scrolling never switches jobs');
    await page.locator('.job-space-dot').first().click();
    await page.waitForTimeout(720);
    assert.equal(await page.locator('.job-window-counter').innerText(), '1 / 5');
    assert.equal(await page.getByRole('button', { name: '上一个岗位' }).isDisabled(), true);
    await viewport.dispatchEvent('wheel', { deltaX: -400, deltaY: 0 });
    const edgeOffset = await page.locator('.job-spaces-track').evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m41);
    assert.ok(edgeOffset > 0 && edgeOffset <= 60, 'edge resistance caps the follow offset');
    await page.waitForTimeout(700);
    assert.equal(await page.locator('.job-window-counter').innerText(), '1 / 5');
    const box = await viewport.boundingBox();
    await page.mouse.move(box.x + box.width - 40, box.y + box.height - 35);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 210, box.y + box.height - 35, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(580);
    assert.equal(await page.locator('.job-window-counter').innerText(), '2 / 5', 'pointer drag shares the snap threshold');
    const closeSample = await page.evaluate(() => {
      const panel = document.querySelector('.job-window');
      const row = document.querySelectorAll('.job-strip')[1];
      const anchor = row.querySelector('.job-strip-chevron').getBoundingClientRect();
      const rowBefore = row.getBoundingClientRect().toJSON();
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const animation = panel.getAnimations().find(item => item.effect.getKeyframes().some(frame => frame.transform));
      animation.pause();
      animation.currentTime = 180;
      const matrix = new DOMMatrix(getComputedStyle(panel).transform);
      animation.currentTime = animation.effect.getTiming().duration - .01;
      const end = panel.getBoundingClientRect();
      const result = { a: matrix.a, d: matrix.d, duration: animation.effect.getTiming().duration,
        distance: Math.hypot(end.x + end.width / 2 - anchor.x - anchor.width / 2, end.y + end.height / 2 - anchor.y - anchor.height / 2),
        rowStable: JSON.stringify(rowBefore) === JSON.stringify(row.getBoundingClientRect().toJSON()) };
      animation.finish();
      return result;
    });
    assert.ok(Math.abs(closeSample.a - closeSample.d) < .000001, 'closing keeps the window uniformly scaled at 180ms');
    assert.equal(closeSample.duration, 360);
    assert.ok(closeSample.distance <= 12, `window lands at the active chevron: ${JSON.stringify(closeSample)}`);
    assert.equal(closeSample.rowStable, true, 'receiving row never moves or squashes');
    await page.locator('.job-window').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.job-window').count(), 0);
    assert.equal(await page.locator('.job-strip').nth(1).evaluate(element => element === document.activeElement), true);
    assert.equal(await page.locator('.job-strip').nth(1).getAttribute('data-receiving'), 'true');
    await page.locator('.job-strip').nth(0).click();
    const interruption = await page.evaluate(() => {
      const panel = document.querySelector('.job-window');
      const snapshot = () => {
        const style = getComputedStyle(panel);
        return { transform: style.transform, opacity: style.opacity, rect: panel.getBoundingClientRect().toJSON(),
          content: getComputedStyle(panel.querySelector('.job-window-body')).opacity,
          backdrop: getComputedStyle(document.querySelector('.job-window-backdrop')).opacity };
      };
      document.querySelector('.job-window-layer').getAnimations({ subtree: true }).forEach(animation => {
        animation.pause();
        animation.currentTime = 80;
      });
      const before = snapshot();
      // The anchor may move during opening (for example after a workspace resize).
      document.querySelector('.job-strip').style.marginTop = '8px';
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.querySelector('.job-window-layer').getAnimations({ subtree: true }).forEach(animation => {
        animation.pause();
        animation.currentTime = 0;
      });
      const after = snapshot();
      document.querySelector('.job-window-layer').getAnimations({ subtree: true }).forEach(animation => animation.finish());
      return { before, after };
    });
    for (const key of ['transform', 'opacity', 'content', 'backdrop']) assert.equal(interruption.after[key], interruption.before[key], `interrupted opening preserves ${key}`);
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(interruption.after.rect[key] - interruption.before.rect[key]) < .01, `interrupted opening preserves ${key} within browser matrix precision`);
    await page.locator('.job-window').waitFor({ state: 'detached' });
    await page.locator('.job-strip').nth(0).evaluate(element => { element.style.marginTop = ''; });
    for (const fallback of ['row-center', 'offscreen', 'detached']) {
      await page.locator('.job-strip').nth(0).click();
      await page.waitForTimeout(440);
      const fallbackSample = await page.evaluate(kind => {
        const panel = document.querySelector('.job-window');
        const row = document.querySelector('.job-strip');
        const rect = (kind === 'row-center' ? row : panel).getBoundingClientRect();
        const chevron = row.querySelector('.job-strip-chevron');
        if (kind === 'row-center') chevron.remove();
        if (kind === 'offscreen') row.style.transform = 'translateY(-2000px)';
        if (kind === 'detached') row.remove();
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const movement = panel.getAnimations().find(animation => animation.effect.getKeyframes().some(frame => frame.transform));
        movement.pause();
        movement.currentTime = 359.99;
        const end = panel.getBoundingClientRect();
        const distance = Math.hypot(end.x + end.width / 2 - rect.x - rect.width / 2, end.y + end.height / 2 - rect.y - rect.height / 2);
        movement.finish();
        // Restore manually detached DOM before React unmounts the dialog.
        if (kind === 'detached') document.querySelector('.job-card').append(row);
        if (kind === 'row-center') row.append(chevron);
        row.style.transform = '';
        return distance;
      }, fallback);
      assert.ok(fallbackSample <= 12, `${fallback} uses the expected point: ${fallbackSample}`);
      await page.locator('.job-window').waitFor({ state: 'detached' });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.job-strip').nth(1).click();
    assert.equal(await page.locator('.job-window-layer').evaluate(element => element.getAnimations({ subtree: true }).every(animation =>
      animation.effect.getTiming().duration <= 120 && animation.effect.getKeyframes().every(frame => !frame.transform && !frame.backdropFilter))), true, 'reduced motion uses only short opacity fades');
    const reducedStart = await page.locator('.job-spaces-track').evaluate(element => getComputedStyle(element).transform);
    await viewport.dispatchEvent('wheel', { deltaX: 160, deltaY: 0 });
    assert.equal(await page.locator('.job-spaces-track').evaluate(element => getComputedStyle(element).transform), reducedStart, 'reduced motion disables gesture follow');
    await page.waitForTimeout(160);
    assert.equal(await page.locator('.job-window-counter').innerText(), '3 / 5');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('.job-window').evaluate(element => Math.round(element.getBoundingClientRect().bottom)), 844);
    await page.keyboard.press('Escape');
    await page.locator('.job-window').waitFor({ state: 'detached' });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('.job-strip').nth(1).click();
    await page.waitForTimeout(440);
    await page.keyboard.press('Escape');
    const mobileMotion = await page.locator('.job-window').evaluate(element => {
      const animation = element.getAnimations().find(item => item.effect.getKeyframes().some(frame => frame.transform));
      animation.pause();
      animation.currentTime = 180;
      const matrix = new DOMMatrix(getComputedStyle(element).transform);
      animation.finish();
      return { a: matrix.a, d: matrix.d, y: matrix.m42 };
    });
    assert.equal(mobileMotion.a, 1);
    assert.equal(mobileMotion.d, 1);
    assert.ok(mobileMotion.y > 0, 'mobile retains slide-down closing');
    await page.locator('.job-window').waitFor({ state: 'detached' });
    await page.locator('.job-strip').nth(1).click();
    const unmount = await page.evaluate(() => {
      const animations = document.querySelector('.job-window-layer').getAnimations({ subtree: true });
      const row = document.querySelectorAll('.job-strip')[1];
      window.jobRoot.unmount();
      return { canceled: animations.every(animation => animation.playState === 'idle'),
        unlocked: document.body.style.overflow !== 'hidden', inert: document.querySelector('.aui-workspace').inert,
        rowVisible: row.style.visibility !== 'hidden' };
    });
    assert.deepEqual(unmount, { canceled: true, unlocked: true, inert: false, rowVisible: true }, 'unmount cancels motion and restores the workspace');
    assert.deepEqual(errors, []);
    console.log('job Spaces browser checks passed', JSON.stringify({ ...sample, closeSample }));
    }
  } finally {
    await browser?.close();
    await vite.close();
    await new Promise(resolve => server.close(resolve));
  }
}

console.log("chat UI contract tests passed");
