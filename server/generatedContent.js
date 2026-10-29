const QUESTION_ENDING = /[?？]$/;
const FIRST_PERSON_FACT = /(我|我的|本人)(独立|负责|参与|使用|用了|用|实现|开发|优化|设计|完成|解决|处理|联调|确认|调整|提升|降低|支持|邀请|测试|掌握|具备|熟悉|对比|选择)/;
const NUMBER_PATTERN = /\d+(?:\.\d+)?%?/g;

const trimString = (value) => (typeof value === "string" ? value.trim() : value);

const compactText = (value) => String(value ?? "").replace(/\s+/g, "").toLowerCase();

const sourceTextFrom = ({ material = "", profile = {} } = {}) => {
  const parts = [material, profile.name, profile.title];
  for (const value of Object.values(profile.contact || {})) parts.push(value);
  for (const key of ["education", "projects", "experience", "skills", "awards", "links", "metrics"]) {
    if (Array.isArray(profile[key])) parts.push(...profile[key]);
  }
  return parts.filter(Boolean).join("\n");
};

const assertObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}必须是对象，方便模型重试。`);
  }
};

const normalizeStringArray = (value, label, { min = 0 } = {}) => {
  if (!Array.isArray(value)) {
    throw new Error(`${label}必须是数组，方便模型重试。`);
  }
  const normalized = value.map((item) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${label}每一项都必须是非空字符串，方便模型重试。`);
    }
    return item.trim();
  });
  if (normalized.length < min) {
    throw new Error(`${label}数量不足，方便模型重试。`);
  }
  return normalized;
};

const normalizeScheduleItem = (item, index) => {
  if (typeof item === "string") {
    const title = item.trim();
    if (!title) throw new Error("7天复习计划每一天都必须是非空字符串，方便模型重试。");
    return { day: `Day ${index + 1}`, title };
  }
  assertObject(item, "7天复习计划每一天");
  const day = trimString(item.day);
  const title = trimString(item.title);
  if (typeof day !== "string" || !day || typeof title !== "string" || !title) {
    throw new Error("7天复习计划的day和title必须是非空字符串，方便模型重试。");
  }
  const normalized = { ...item, day, title };
  if (item.tasks !== undefined) normalized.tasks = normalizeStringArray(item.tasks, "7天复习计划tasks");
  return normalized;
};

export function validateInterviewPlan(candidate) {
  assertObject(candidate, "面试计划");
  const roleLabel = trimString(candidate.roleLabel || candidate.targetTitle || candidate.role || "目标岗位");
  const topic = trimString(candidate.topic || candidate.interviewTopic || `${roleLabel}项目追问`);
  if (!roleLabel || !topic) {
    throw new Error("面试计划必须包含非空roleLabel和topic，方便模型重试。");
  }

  const resumeDefense = normalizeStringArray(candidate.resumeDefense, "面试追问resumeDefense", { min: 1 });
  for (const question of resumeDefense) {
    if (!QUESTION_ENDING.test(question)) {
      throw new Error("面试追问resumeDefense必须是以?或？结尾的非空问句，不能写成答案陈述，方便模型重试。");
    }
    if (FIRST_PERSON_FACT.test(question)) {
      throw new Error("面试追问resumeDefense不能包含第一人称事实陈述，请改成面试官追问，方便模型重试。");
    }
  }

  if (!Array.isArray(candidate.schedule) || candidate.schedule.length !== 7) {
    throw new Error("面试计划必须包含刚好7天schedule，方便模型重试。");
  }
  const schedule = candidate.schedule.map(normalizeScheduleItem);

  return {
    ...candidate,
    roleLabel,
    topic,
    resumeDefense,
    schedule
  };
}

const skillKey = (value) => String(value ?? "").trim().toLowerCase().replace(/[^\p{Letter}\p{Number}+#.]/gu, "");

const allowedSkillKeys = ({ material = "", profile = {} }) => {
  const allowed = new Set();
  for (const skill of profile.skills || []) allowed.add(skillKey(skill));
  return { allowed, material: compactText(material) };
};

const normalizeNumbers = (text) => String(text ?? "").match(NUMBER_PATTERN) || [];

const numberKey = (token) => {
  const hasPercent = token.endsWith("%");
  const numeric = token.replace(/%$/, "").split(".").map((part) => String(Number(part))).join(".");
  return `${numeric}${hasPercent ? "%" : ""}`;
};

const sourceNumberSet = (sourceText) => new Set(normalizeNumbers(sourceText).map(numberKey));

export function assertGroundedNumbers(text, sourceText) {
  assertNoNewNumbers(text, sourceNumberSet(sourceText));
}

const isDateTransform = (token, sourceNumbers) => {
  const value = token.replace(/%$/, "");
  if (token.endsWith("%")) return false;
  const match = value.match(/^(\d{4})\.(\d{1,2})$/);
  if (!match) return false;
  const [, year, month] = match;
  return sourceNumbers.has(numberKey(year)) && sourceNumbers.has(numberKey(month));
};

const assertNoNewNumbers = (candidateText, sourceNumbers) => {
  for (const token of normalizeNumbers(candidateText)) {
    const key = numberKey(token);
    if (!sourceNumbers.has(key) && !isDateTransform(token, sourceNumbers)) {
      throw new Error(`简历生成内容包含未提供的数字或指标「${token}」，请删除或让用户补充证据后重试。`);
    }
  }
};

const assertKnownValue = (value, sourceText, label) => {
  if (!value) return;
  if (!compactText(sourceText).includes(compactText(value))) {
    throw new Error(`简历${label}包含原始材料中没有的事实「${value}」，请勿编造，方便模型重试。`);
  }
};

const assertEducationKnown = (items, sourceText) => {
  const source = compactText(sourceText);
  for (const item of items) {
    const tokens = item.match(/[\p{Script=Han}A-Za-z0-9]+/gu) || [];
    for (const token of tokens) {
      if (token.length >= 2 && !source.includes(compactText(token))) {
        throw new Error(`简历教育经历包含原始材料中没有的事实「${token}」，请勿编造，方便模型重试。`);
      }
    }
  }
};

const assertItemsKnown = (items, sourceText, label) => {
  const source = compactText(sourceText);
  for (const item of items) {
    if (!source.includes(compactText(item))) {
      throw new Error(`简历${label}包含原始材料中没有的内容「${item}」，请勿编造，方便模型重试。`);
    }
  }
};

const normalizeContact = (contact = {}, sourceText) => {
  assertObject(contact, "简历contact");
  const normalized = {};
  for (const [key, raw] of Object.entries(contact)) {
    const value = trimString(raw);
    if (typeof value !== "string") {
      throw new Error("简历contact字段必须是字符串，方便模型重试。");
    }
    if (value) assertKnownValue(value, sourceText, "基本信息/contact");
    normalized[key] = value;
  }
  return normalized;
};

export function validateResumeDraft(candidate, { material = "", profile = {} } = {}) {
  assertObject(candidate, "简历草稿");
  const sourceText = sourceTextFrom({ material, profile });
  const sourceNumbers = sourceNumberSet(sourceText);
  const source = compactText(sourceText);

  const name = trimString(candidate.name);
  if (typeof name !== "string" || !name) {
    throw new Error("简历必须包含非空name，方便模型重试。");
  }
  if (profile.name && name !== profile.name) {
    throw new Error("简历基本信息/name与用户资料不一致，请勿编造，方便模型重试。");
  }
  assertKnownValue(name, sourceText, "基本信息/name");

  const contact = normalizeContact(candidate.contact || {}, sourceText);
  const education = normalizeStringArray(candidate.education, "简历education", { min: 1 });
  assertEducationKnown(education, sourceText);

  const projects = normalizeStringArray(candidate.projects || [], "简历projects");
  const experience = normalizeStringArray(candidate.experience || [], "简历experience");
  const awards = normalizeStringArray(candidate.awards || [], "简历awards");
  assertItemsKnown(awards, sourceText, "荣誉/奖项");
  const skills = normalizeStringArray(candidate.skills, "简历skills");
  const { allowed: allowedSkills, material: materialText } = allowedSkillKeys({ material, profile });
  for (const skill of skills) {
    const key = skillKey(skill);
    if (!allowedSkills.has(key) && !materialText.includes(key)) {
      throw new Error(`简历技能不得凭空补技能「${skill}」，请只使用用户材料中出现的技能，方便模型重试。`);
    }
  }

  for (const item of [...education, ...projects, ...experience]) {
    assertNoNewNumbers(item, sourceNumbers);
  }
  for (const value of [candidate.summary, candidate.greeting]) {
    if (typeof value === "string") assertNoNewNumbers(value, sourceNumbers);
  }

  if (name && !source.includes(compactText(name))) {
    throw new Error("简历基本信息与用户资料不一致，请勿编造，方便模型重试。");
  }

  return {
    ...candidate,
    name,
    contact,
    education,
    skills,
    projects,
    experience,
    awards
  };
}
