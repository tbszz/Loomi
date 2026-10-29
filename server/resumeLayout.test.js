import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveResumeLayout } from './resumeLayout.js';
import { renderResume } from './resumeExport.js';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { mkdir, writeFile } from 'node:fs/promises';

// Synthetic content is only an export fixture, never Candidate KB input.
const base = { name: '陈同学', targetTitle: '软件开发实习', contact: { email: 'synthetic@example.test' }, summary: '', education: ['示例大学 · 计算机科学本科 · 2023—2027'], skills: ['JavaScript', 'React'], projects: ['课程项目：参与校园图书检索页面开发，完成筛选交互及课程演示。'], experience: [], awards: [] };
const paragraph = '负责已确认业务模块的开发和维护，与团队核对需求，编写接口测试，定位异常并记录验收结果。';
export const layoutFixtures = [
  { id: 'campus-short', resume: base, template: 'minimal', pages: 1 },
  { id: 'social-short', resume: { ...base, targetTitle: '软件开发工程师', experience: [paragraph] }, template: 'experienced', pages: 1 },
  { id: 'campus-project', resume: { ...base, projects: Array.from({ length: 4 }, (_, i) => `课程项目${i + 1}：${paragraph.repeat(3)}`) }, template: 'campus-project', pages: 1 },
  { id: 'social-two-pages', resume: { ...base, name: '陈工程师', targetTitle: '软件开发工程师', experience: Array.from({ length: 18 }, (_, i) => `示例工作${i + 1}：${paragraph.repeat(3)}`) }, template: 'experienced', pages: 2 },
  { id: 'long-paragraph', resume: { ...base, projects: [paragraph.repeat(110) + '全文保留终点', 'https://example.test/' + 'abcdefgh'.repeat(50)] }, template: 'campus-project', minPages: 3 }
];

await test('layout choices validate and reorder without deleting confirmed modules', () => {
  assert.equal(resolveResumeLayout(base).template, 'minimal');
  assert.equal(resolveResumeLayout(layoutFixtures[2].resume).template, 'campus-project');
  assert.equal(resolveResumeLayout(layoutFixtures[3].resume).template, 'experienced');
  assert.deepEqual(resolveResumeLayout(base, { template: 'experienced', sectionOrder: ['projects'] }).sectionOrder, ['projects', 'experience', 'skills', 'education', 'awards']);
  for (const options of [{ template: 'foreign' }, { sectionOrder: ['skills', 'skills'] }, { sectionOrder: ['name'] }, { sectionOrder: 'projects' }, null]) assert.throws(() => resolveResumeLayout(base, options));
});

for (const fixture of layoutFixtures) await test(`Chinese selectable PDF and editable DOCX preserve ${fixture.id}`, async () => {
  const before = structuredClone(fixture.resume);
  const layout = { template: fixture.template, sectionOrder: ['projects', 'experience', 'education', 'skills', 'awards'] };
  const pdf = await renderResume(fixture.resume, 'pdf', layout);
  const parser = new PDFParse({ data: pdf });
  let pages;
  try {
    pages = (await parser.getInfo()).total;
    if (fixture.pages) assert.equal(pages, fixture.pages);
    if (fixture.minPages) assert.ok(pages >= fixture.minPages);
    const text = (await parser.getText()).pages.map(page => page.text.replace(new RegExp(`^${page.num}\\s*`), '')).join('').replace(/\s/gu, '');
    for (const key of ['education', 'projects', 'experience', 'skills', 'awards']) for (const value of fixture.resume[key]) assert.ok(text.includes(value.replace(/\s/gu, '')), `lost PDF content: ${key}`);
    assert.ok(text.indexOf('项目经历') < text.indexOf('教育经历'), 'requested order must reach PDF');
    if (process.env.RESUME_LAYOUT_OUTPUT) {
      await mkdir(process.env.RESUME_LAYOUT_OUTPUT, { recursive: true });
      await writeFile(`${process.env.RESUME_LAYOUT_OUTPUT}/${fixture.id}.pdf`, pdf);
      const screenshots = await parser.getScreenshot({ desiredWidth: 1000, imageBuffer: true, imageDataUrl: false });
      for (const page of screenshots.pages) await writeFile(`${process.env.RESUME_LAYOUT_OUTPUT}/${fixture.id}-${page.pageNumber}.png`, page.data);
    }
  } finally { await parser.destroy(); }
  const docx = await renderResume(fixture.resume, 'docx', layout);
  const text = (await mammoth.extractRawText({ buffer: docx })).value;
  for (const key of ['education', 'projects', 'experience', 'skills', 'awards']) for (const value of fixture.resume[key]) assert.ok(text.includes(value), `lost DOCX content: ${key}`);
  assert.ok(text.indexOf('项目经历') < text.indexOf('教育经历'));
  assert.deepEqual(fixture.resume, before, 'renderer must not mutate candidate text');
  if (process.env.RESUME_LAYOUT_OUTPUT) await writeFile(`${process.env.RESUME_LAYOUT_OUTPUT}/${fixture.id}.docx`, docx);
});
