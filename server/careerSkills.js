import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { copyFile, cp, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAREER_SKILLS } from './careerPolicy.js';

// The only Skills the P0 runtime loads. The SDK `skills` option is a context
// filter rather than a sandbox, so this exact list is combined with an isolated
// runtime directory and disabled file/shell tools in createClaudeAgentModel.
// Anything not named here is neither installed nor passed to the SDK.
export const CAREER_SKILL_NAMES = Object.freeze([
  'resume-analysis',
  'jd-analysis',
  'resume-tailoring',
  'interview-prep',
]);

const REPO_SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');

export function isAllowedCareerSkill(name) {
  return CAREER_SKILL_NAMES.includes(name);
}

function skillFailure(message) {
  return Object.assign(new Error(message), { careerSkillError: true });
}

export function parseSkillDocument(text) {
  const raw = String(text || '').replace(/^﻿/, '');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw skillFailure('SKILL.md 缺少 YAML frontmatter。');
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const entry = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (entry) frontmatter[entry[1]] = entry[2].trim().replace(/^["']|["']$/g, '');
  }
  return { frontmatter, body: match[2] || '' };
}

// Reads the four P0 first-party Skills from the repository. Never reads the user
// home directory, CLAUDE_CONFIG_DIR, plugins or any directory outside the repo.
export async function readCareerSkillManifest({ skillsDir = REPO_SKILLS_DIR } = {}) {
  const manifest = [];
  for (const name of CAREER_SKILL_NAMES) {
    const dir = path.join(skillsDir, name);
    let document;
    try {
      document = await readFile(path.join(dir, 'SKILL.md'), 'utf8');
    } catch {
      throw skillFailure(`求职 Skill「${name}」缺少 SKILL.md，本次未加载任何 Skill。`);
    }
    const { frontmatter, body } = parseSkillDocument(document);
    if (frontmatter.name !== name) {
      throw skillFailure(`求职 Skill「${name}」的 frontmatter name 与目录名不一致（${frontmatter.name || '空'}）。`);
    }
    if (!frontmatter.description || frontmatter.description.length < 20) {
      throw skillFailure(`求职 Skill「${name}」的 description 过短，模型无法区分使用场景。`);
    }
    if (!body.trim()) throw skillFailure(`求职 Skill「${name}」正文为空。`);
    manifest.push({ name, description: frontmatter.description, dir, references: await listReferences(dir) });
  }
  return manifest;
}

async function listReferences(dir) {
  const target = path.join(dir, 'references');
  try {
    const info = await stat(target);
    if (!info.isDirectory()) return [];
    return (await readdir(target)).filter(file => file.endsWith('.md')).sort();
  } catch {
    return [];
  }
}

// Copies the allow-listed Skills into the isolated run directory so the SDK
// discovers only these. Two locations are populated on purpose: the SDK
// resolves project Skills under `<cwd>/.claude/skills/` and user Skills under
// `$CLAUDE_CONFIG_DIR/skills/`; the agent runtime points both at this
// throwaway directory, so neither can reach `~/.claude/skills`.
export async function installCareerSkills(directory, options = {}) {
  if (!directory) throw skillFailure('缺少隔离运行目录，无法装载求职 Skill。');
  const manifest = await readCareerSkillManifest(options);
  const installed = [];
  for (const skill of manifest) {
    const targets = [
      path.join(directory, '.claude', 'skills', skill.name),
      path.join(directory, 'skills', skill.name),
    ];
    for (const target of targets) {
      await mkdir(path.dirname(target), { recursive: true });
      await cp(skill.dir, target, { recursive: true });
    }
    installed.push({ name: skill.name, targets });
  }
  return { names: [...CAREER_SKILL_NAMES], installed, manifest };
}

const labels = { 'resume-analysis': '简历分析', 'jd-analysis': '岗位分析', 'resume-tailoring': '简历定制', 'interview-prep': '面试准备', 'resume-layout': '简历排版' };

export function listCareerSkills() {
  return CAREER_SKILLS.map(({ name }) => {
    const raw = readFileSync(path.join(REPO_SKILLS_DIR, name, 'SKILL.md'), 'utf8');
    const metadata = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
    const description = metadata?.match(/^description:\s*(.+)$/m)?.[1]?.trim();
    if (!description || !metadata.match(new RegExp(`^name: ${name}\\s*$`, 'm'))) throw new Error(`Skill 文档无效：${name}`);
    return { name, label: labels[name], description };
  });
}

// Only audited plain method/reference files enter a session workspace. These
// exact paths are the SDK Read permission set, never the candidate data tree.
export async function stageCareerSkills(directory, skills) {
  const paths = new Set();
  for (const name of skills) {
    if (![...CAREER_SKILLS.map(skill => skill.name), 'application-form'].includes(name)) throw new Error('未经审核的 Skill。');
    await copyTree(path.join(REPO_SKILLS_DIR, name), path.join(directory, '.claude', 'skills', name));
  }
  if (skills.some(name => CAREER_SKILLS.some(skill => skill.name === name))) {
    await copyTree(path.join(REPO_SKILLS_DIR, '_schema'), path.join(directory, '.claude', 'skills', '_schema'));
  }
  return paths;

  async function copyTree(source, destination) {
    const stat = lstatSync(source);
    if (stat.isSymbolicLink()) throw new Error('Skill 不允许符号链接。');
    if (stat.isDirectory()) {
      await mkdir(destination, { recursive: true });
      for (const entry of readdirSync(source)) await copyTree(path.join(source, entry), path.join(destination, entry));
    } else {
      if (!stat.isFile() || (!/\.(md|yaml|yml|json|txt)$/i.test(source) && path.basename(source) !== 'DATA_VERSION')) throw new Error('未经审核的 Skill 文件类型。');
      await copyFile(source, destination);
      paths.add(path.resolve(destination));
    }
  }
}
