import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFParse } from 'pdf-parse';
import { renderResume } from './resumeExport.js';
import { renderPdfPages } from './pdfPages.js';

const resume = {
  name: '布局测试', targetTitle: '软件工程师', contact: { email: 'layout@example.com' },
  summary: '有可读文本的 PDF 也必须提供原页面图片，才能判断分栏、间距与阅读顺序。',
  education: ['测试大学，计算机科学本科'], skills: ['JavaScript', 'React'],
  projects: ['开发招聘系统，完成履历展示和筛选功能。'], experience: [], awards: [],
};
const pdf = await renderResume(resume, 'pdf');

test('readable text PDF supplies an original full page PNG independent of OCR', async () => {
  const parser = new PDFParse({ data: pdf });
  try { assert.match((await parser.getText()).text, /布局测试/); }
  finally { await parser.destroy(); }
  const result = await renderPdfPages(pdf);
  assert.equal(result.method, 'page-images');
  assert.equal(result.complete, true);
  assert.equal(result.totalPages, 1);
  assert.deepEqual(result.pages.map(page => page.pageNumber), [1]);
  const image = result.pages[0].image;
  assert.equal(image.type, 'image');
  assert.equal(image.source.media_type, 'image/png');
  const bytes = Buffer.from(image.source.data, 'base64');
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), 1200);
  assert.ok(bytes.readUInt32BE(20) > 1200, 'full portrait page, not a text crop');
});

test('multi-page PDF preserves page order and states clipping explicitly', async () => {
  const longPdf = await renderResume({ ...resume, projects: Array.from({ length: 75 }, (_, i) => `项目 ${i + 1}：开发招聘系统，测试简历渲染与内容阅读顺序。`) }, 'pdf');
  const result = await renderPdfPages(longPdf, { maxPages: 2, desiredWidth: 400 });
  assert.ok(result.totalPages > 2);
  assert.equal(result.complete, false);
  assert.deepEqual(result.pages.map(page => page.pageNumber), [1, 2]);
});

test('invalid PDF and oversized rendered payload are explicit failures', async () => {
  await assert.rejects(renderPdfPages(Buffer.from('not a PDF')), /有效的 PDF/);
  await assert.rejects(renderPdfPages(pdf, { maxTotalBytes: 1 }), /超过大小限制/);
  await assert.rejects(renderPdfPages(pdf, { maxPages: 9 }), /1 至 8 页/);
});

test('cancellation rejects before and during rendering', async () => {
  const alreadyAborted = new AbortController();
  alreadyAborted.abort(new Error('用户停止查看'));
  await assert.rejects(renderPdfPages(pdf, { signal: alreadyAborted.signal }), /用户停止查看/);
  const active = new AbortController();
  const operation = renderPdfPages(pdf, { signal: active.signal });
  queueMicrotask(() => active.abort(new Error('查看已取消')));
  await assert.rejects(operation, /查看已取消/);
});
