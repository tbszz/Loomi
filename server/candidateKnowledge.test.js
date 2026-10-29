import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractCandidateMaterial } from './candidateKnowledge.js';

await test('only source-located parser values become durable candidate facts', () => {
  const document = {id:'doc-1',text:'张三\n项目经历\nGreenSteps 项目使用 React 开发\n技能\nReact'};
  const {facts,chunks} = extractCandidateMaterial(document, {
    name:'张三',projects:['GreenSteps 项目使用 React 开发'],skills:['React','Docker'],sourceConfidence:80
  });
  assert.equal(facts.some(fact => fact.value === 'Docker'), false);
  assert.ok(facts.some(fact => fact.type === 'project' && fact.sourceQuote === 'GreenSteps 项目使用 React 开发'));
  assert.ok(facts.every(fact => document.text.slice(fact.sourcePosition, fact.sourcePosition + fact.sourceQuote.length) === fact.sourceQuote));
  assert.equal(chunks[0].text, document.text);
  assert.deepEqual(extractCandidateMaterial(document, {name:'张三'}).facts.map(fact => fact.id), extractCandidateMaterial(document, {name:'张三'}).facts.map(fact => fact.id));
});

await test('headings and misclassified education do not become Candidate facts', () => {
  const text = '张三\n教育经历\n某大学计算机本科\n项目经历\n用 React 制作课程项目\n技能\nReact';
  const {facts} = extractCandidateMaterial({id:'doc-2',text}, {
    name:'张三', education:['教育经历','某大学计算机本科','用 React 制作课程项目'],
    projects:['用 React 制作课程项目'],skills:['技能','React']
  });
  assert.equal(facts.some(fact => ['教育经历','项目经历','技能'].includes(fact.value)),false);
  assert.equal(facts.filter(fact => fact.value === '用 React 制作课程项目').length,1);
  assert.equal(facts.find(fact => fact.value === '用 React 制作课程项目').type,'project');
});

await test('a Java parser guess is not grounded by JavaScript', () => {
  const document = {id:'doc-java',text:'项目使用 JavaScript 开发，也使用 Java 开发。'};
  const {facts} = extractCandidateMaterial(document,{skills:['JavaScript','Java']});
  assert.ok(facts.some(fact => fact.value === 'JavaScript'));
  assert.equal(facts.find(fact => fact.value === 'Java').sourcePosition, document.text.lastIndexOf('Java'));
  const onlyScript = extractCandidateMaterial({id:'doc-script',text:'项目使用 JavaScript 开发。'},{skills:['Java']});
  assert.equal(onlyScript.facts.length,0);
  const negated = extractCandidateMaterial({id:'doc-negated',text:'项目未使用 Java。'},{skills:['Java']});
  assert.equal(negated.facts.length,0);
});

// Reading a page and parsing it normalise whitespace differently. Facts must still be
// grounded, and the stored quote must be the real page text, not the parser's version.
await test('values that differ from the page only by whitespace keep an exact source span', () => {
  const text = '张三\n教育经历\n2021.09-2025.06  郑州轻工业大学  计算机科学与技术  本科\n工作经历\n2024.07-2024.09  某互联网公司  前端开发实习生';
  const {facts} = extractCandidateMaterial({id:'doc-space',text},{
    name:'张三',
    education:['2021.09-2025.06 郑州轻工业大学 计算机科学与技术 本科'],
    experience:['2024.07-2024.09 某互联网公司 前端开发实习生']
  });
  const education = facts.find(fact => fact.type === 'education');
  assert.ok(education,'an education line must survive a whitespace difference');
  assert.equal(education.sourceQuote,'2021.09-2025.06  郑州轻工业大学  计算机科学与技术  本科');
  assert.equal(education.value,education.sourceQuote);
  assert.ok(facts.some(fact => fact.type === 'experience'));
  for (const fact of facts) {
    assert.equal(text.slice(fact.sourcePosition,fact.sourcePosition + fact.sourceQuote.length),fact.sourceQuote);
  }
});

await test('whitespace tolerance does not invent facts for absent values', () => {
  // 'React Native' is on the page only with a line break, so it must be grounded;
  // 'Kubernetes' is nowhere on the page, so it must not become a fact.
  const grounded = extractCandidateMaterial({id:'doc-present',text:'张三\n技能\nReact\nNative'},{name:'张三',skills:['React Native']});
  assert.deepEqual(grounded.facts.map(fact => fact.value),['张三','React\nNative']);
  const absent = extractCandidateMaterial({id:'doc-absent',text:'张三\n技能\nReact'},{name:'张三',skills:['Kubernetes','Java']});
  assert.deepEqual(absent.facts.map(fact => fact.value),['张三']);
});

await test('compound section headings and awards are not stored as skills', () => {
  const text = '张三\n专业技能\nReact\n荣誉奖项\n2023 年校级一等奖学金';
  const profile = {name:'张三',skills:['React','荣誉奖项','2023 年校级一等奖学金'],awards:['荣誉奖项','2023 年校级一等奖学金']};
  const {facts} = extractCandidateMaterial({id:'doc-award',text},profile);
  assert.equal(facts.some(fact => fact.value === '荣誉奖项'),false,'a heading must never become a durable fact');
  // The parser listed the award under skills too; the specific field must win.
  assert.equal(facts.find(fact => fact.value === '2023 年校级一等奖学金').type,'achievement');
  assert.equal(facts.find(fact => fact.value === 'React').type,'skill');
});

await test('career preferences use explicit source statements, never an inferred title',()=>{
  const text='张三\n求职意向：前端工程师\n期望工作地点：上海\nReact';
  const {facts}=extractCandidateMaterial({id:'preferences',text},{name:'张三',title:'AI架构师',skills:['React']});
  assert.ok(facts.some(f=>f.type==='career_preference' && f.value==='求职意向：前端工程师'));
  assert.ok(facts.some(f=>f.type==='career_preference' && f.value==='期望工作地点：上海'));
  assert.ok(!facts.some(f=>f.value.includes('AI架构师')));
});

await test('chunks keep a CJK section heading with its body when the heading is near a boundary', () => {
  const text = `${'背景'.repeat(218)}\r\n项目经历\r\nGreenSteps 项目使用 React Native 完成碳账户页面\r\n技能\r\nReact`;
  const { chunks } = extractCandidateMaterial({ id: 'chunk-heading', text }, {});

  assert.ok(chunks.some(chunk => chunk.text.startsWith('项目经历\r\nGreenSteps')), 'section heading should start the chunk that contains its body');
  for (const chunk of chunks) {
    assert.equal(text.slice(chunk.start, chunk.end), chunk.text);
    assert.ok(chunk.text.trim(), 'empty chunks are not emitted');
  }
});

await test('long paragraph chunks overlap so a lexical target is not lost at the cut point', () => {
  const target = 'React Native 关键项目';
  const text = `${'甲'.repeat(435)}${target}${'乙'.repeat(700)}`;
  const { chunks } = extractCandidateMaterial({ id: 'chunk-overlap', text }, {});

  assert.ok(chunks.some(chunk => chunk.text.includes(target)), 'overlap should keep the full cross-boundary target searchable');
  assert.ok(chunks.some((chunk, index) => index > 0 && chunk.start < chunks[index - 1].end), 'long paragraphs should use small overlap between chunks');
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    assert.equal(chunk.text, text.slice(chunk.start, chunk.end));
    assert.ok(chunk.end > chunk.start, 'chunk spans always move forward');
    if (index > 0) assert.ok(chunk.start > chunks[index - 1].start, 'chunk starts must be strictly increasing');
  }
});

await test('long CRLF source chunks are exact, stable, non-empty spans without rewriting text', () => {
  const paragraph = `${'第一段内容\r\n'.repeat(55)}${'超长段落'.repeat(230)}\r\n教育经历\r\n郑州轻工业大学计算机本科`;
  const first = extractCandidateMaterial({ id: 'chunk-stable', text: paragraph }, {});
  const second = extractCandidateMaterial({ id: 'chunk-stable', text: paragraph }, {});

  assert.ok(first.chunks.length > 3, 'long material should be split into multiple bounded chunks');
  assert.deepEqual(first.chunks.map(chunk => chunk.id), second.chunks.map(chunk => chunk.id));
  for (const chunk of first.chunks) {
    assert.equal(chunk.text, paragraph.slice(chunk.start, chunk.end));
    assert.ok(chunk.text.length <= 450);
    assert.ok(chunk.text.trim());
  }
});
