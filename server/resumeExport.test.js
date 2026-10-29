import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { renderResume, annotatePdf } from './resumeExport.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'resume-export-'));
try {
  const resume = {name:'王五', targetTitle:'前端工程师',contact:{email:'wangwu@example.com'}, summary:'使用 React 开发课程列表。', education:['测试大学，计算机科学本科'], skills:['React','JavaScript'], projects:['开发课程列表，完成筛选功能。'], experience:[], awards:[]};
  const pdf = await renderResume(resume, 'pdf');
  assert.equal(pdf.subarray(0,5).toString(), '%PDF-');
  const parser = new PDFParse({data:pdf});
  try {assert.match((await parser.getText()).text,/王五/);} finally {await parser.destroy();}
  const docx = await renderResume(resume, 'docx');
  assert.match((await mammoth.extractRawText({buffer:docx})).value,/开发课程列表，完成筛选功能/);
  const partialResume = {...resume,sourceNotice:'草稿：仅依据已识别页面，仍有页面未读取。'};
  const partialPdf = new PDFParse({data:await renderResume(partialResume,'pdf')});
  try { assert.match((await partialPdf.getText()).text,/仅依据已识别页面/); } finally { await partialPdf.destroy(); }
  assert.match((await mammoth.extractRawText({buffer:await renderResume(partialResume,'docx')})).value,/仅依据已识别页面/);
  const filename = path.join(dir,'source.pdf');
  writeFileSync(filename,pdf);
  const marked = await annotatePdf(filename,[{quote:'开发课程列表，完成筛选功能。',issue:'缺少个人职责说明',suggestion:'补充你独立负责的模块。',reason:'区分个人贡献和项目范围。'}]);
  assert.match(marked.toString('latin1'), /\/Subtype \/Highlight/);
  assert.match(marked.toString('latin1'), /\/QuadPoints/);
  console.log('PDF/DOCX text, Chinese fonts and original PDF highlights verified');
} finally {rmSync(dir,{recursive:true,force:true});}
