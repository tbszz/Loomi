import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterSkills, insertSkillCommand, skillCommandQuery } from './skillMenu.js';

test('completion only edits an opening slash command, never a URL or path', () => {
  assert.equal(skillCommandQuery('/'), '');
  assert.equal(skillCommandQuery('/RESUME'), 'resume');
  assert.equal(skillCommandQuery('/简历'), '简历');
  assert.equal(skillCommandQuery('/res 请核对项目', 4), 'res');
  for (const value of ['https://example.test', '请看 /resume', '/tmp/resume.txt', '//host', 'C:/resume', '/resume.md', '/res 后续文字']) assert.equal(skillCommandQuery(value), null, value);
});
test('catalog searches names, labels and descriptions and preserves task text on selection', () => {
  const skills = [{ name: 'resume-analysis', label: '简历分析', description: '诊断结构和经历证据' }, { name: 'jd-analysis', label: '岗位分析', description: '理解招聘要求' }];
  for (const query of ['resume', '简历', '证据']) assert.deepEqual(filterSkills(skills, query), [skills[0]]);
  assert.deepEqual(filterSkills(skills, 'missing'), []);
  assert.equal(insertSkillCommand('/res 请核对项目\n和数字', 'resume-analysis'), '/resume-analysis 请核对项目\n和数字');
  assert.equal(insertSkillCommand('/', 'jd-analysis'), '/jd-analysis ');
});
