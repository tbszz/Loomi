import { buildClaimEvidence } from './claimEvidence.js';
import { SENSITIVE_APPLICATION_FIELDS } from './applicationProfile.js';
import { decideApplicationFields } from './applicationDecisions.js';

const SIMPLE = [
  ['preferredRoleCategory', { zh: ['意向岗位大类'], en: [] }],
  ['preferredRoles', { zh: ['意向岗位'], en: [] }],
  ['preferredTeams', { zh: ['意向团队'], en: [] }],
  ['acceptRoleAdjustment', { zh: ['是否接受岗位调剂'], en: [] }],
  ['degreeName', { zh: ['学位'], en: [] }],
  ['studentNumber', { zh: ['学号'], en: [] }],
  ['nativePlace', { zh: ['籍贯'], en: [] }],
  ['referred', { zh: ['是否内推'], en: [] }],
  ['referralCode', { zh: ['内推码'], en: [] }],
  ['hasAwards', { zh: ['是否有获奖经历'], en: [] }],
  ['hasCampusLeadership', { zh: ['是否有社团干部经历'], en: [] }],
  ['hasInternship', { zh: ['是否有实习经历'], en: [] }],
  ['languages', { zh: ['语言特长'], en: [] }],
  ['recruitmentChannel', { zh: ['什么渠道了解到招聘消息'], en: [] }],
  ['identityNumber', { zh: ['身份证', '证件号码'], en: [['identity', 'number'], ['id', 'number']] }],
  ['phone', { zh: ['手机号', '手机', '联系电话'], en: [['phone'], ['mobile'], ['tel']] }],
  ['email', { zh: ['邮箱', '电子邮件'], en: [['email']] }],
  ['expectedSalary', { zh: ['期望薪资', '期望薪酬', '薪资要求'], en: [['expected', 'salary']] }],
  ['availableDate', { zh: ['到岗', '入职日期'], en: [['available', 'date']] }],
  ['preferredLocation', { zh: ['意向城市', '期望地点', '工作地点'], en: [['preferred', 'location']] }],
  ['leaveReason', { zh: ['离职原因'], en: [['leaving', 'reason'], ['leave', 'reason']] }],
  ['householdRegistration', { zh: ['户籍', '户口'], en: [] }],
  ['address', { zh: ['住址', '居住地址', '通讯地址'], en: [['address']] }],
  ['nationality', { zh: ['国籍'], en: [['nationality']] }],
  ['ethnicity', { zh: ['民族'], en: [['ethnicity']] }],
  ['politicalStatus', { zh: ['政治面貌'], en: [['political', 'status']] }],
  ['birthDate', { zh: ['出生日期', '出生年月', '生日'], en: [['birth', 'date']] }],
  ['gender', { zh: ['性别'], en: [['gender'], ['sex']] }],
  ['willingToRelocate', { zh: ['接受异地', '愿意搬迁'], en: [['relocate'], ['relocation']] }],
  ['website', { zh: ['个人网站', '作品链接'], en: [['website'], ['portfolio']] }],
  ['name', { zh: ['姓名'], en: [['full', 'name'], ['name']], exactEn: true }],
  ['degree', { zh: ['最高学历', '学历'], en: [['degree']] }]
];
const RECORD_FIELDS = {
  education: [['school', /学校|院校|school|university/i],['major', /专业|major/i],['degree', /学历|学位|degree/i],['startDate', /开始|入学|start/i],['endDate', /结束|毕业|end/i],['ranking', /成绩排名/],['description', /描述|description/i]],
  employment: [['company', /公司|单位|company|employer/i],['title', /职位|岗位|职务|title|position/i],['startDate', /开始|入职|start/i],['endDate', /结束|离职|end/i],['description', /职责|描述|工作内容|description/i]],
  projects: [['name', /名称|项目名|name|title/i],['role', /角色|职责|role/i],['startDate', /开始|start/i],['endDate', /结束|end/i],['description', /介绍|描述|内容|description/i]],
  awards: [['type', /获奖类型|奖项类型/],['level', /奖项级别|获奖级别/],['name', /奖项名称|获奖名称/],['date', /获奖时间|获奖日期/]],
  campusLeadership: [['organization', /社团名称|组织名称/],['title', /职位|职务/],['startDate', /开始/],['endDate', /结束/],['description', /工作描述|职责|工作内容/]]
};
const FORBIDDEN = /同意|授权|隐私|签名|签署|声明|验证码|密码|password|captcha|consent|signature/i;
const OPEN = /自我介绍|个人优势|项目介绍|项目描述|实习总结|为什么|开放题|自我评价|motivation|cover|introduce|describe/i;

// Plain Candidate facts remain the authoritative fallback; a structured profile
// is an explicit user-confirmed mapping, not an LLM-created candidate record.
export async function prepareApplicationAnswers({ fields = [], profile = {}, facts = [], answerModel, decisionClient, drafts, signal }) {
  const activeFacts = facts.filter(fact => ['verified','user_asserted'].includes(fact.status));
  const answers = [], skipped = [], pending = [];
  const draftTypes = new Map();
  const recordPlan = buildRecordPlan(fields, profile);
  const judgments = await decideApplicationFields({ fields: fields.filter(field => !recordPlan.has(field) && !matchSimpleProperty(field) && !/教育|education|实习|工作经历|employment|experience|项目|project/i.test(field.section || '')), profile, decisionClient, signal });
  const decisionSkips = new Map(judgments.skipped.map(item => [item.fieldId, item]));
  for (const field of fields) {
    const text = `${field.label || ''} ${field.name || ''}`;
    const plan = recordPlan.get(field);
    const family = plan?.family || null;
    const recordKey = plan?.recordKey || null;
    const recordIndex = plan?.recordIndex || 0;
    if (field.occupied) { skipped.push({ fieldId: field.id, status: 'preserved' }); continue; }
    if (plan?.manualRequired) { skipped.push({ fieldId: field.id, status: 'manual_required' }); continue; }
    if (!plan && /经历|获奖|教育|education|experience|project|award/i.test(field.section || '')) { skipped.push({ fieldId: field.id, status: 'manual_required' }); continue; }
    if (field.unsupported || FORBIDDEN.test(text)) { skipped.push({ fieldId: field.id, status: 'manual_required' }); continue; }
    if (field.type === 'file') { skipped.push({ fieldId: field.id, status: 'attachment_required' }); continue; }
    if (decisionSkips.has(field.id)) { skipped.push(decisionSkips.get(field.id)); continue; }
    const property = matchSimpleProperty(field) || judgments.mappings.get(field.id);
    let value = recordKey ? profile[family]?.[recordIndex]?.[recordKey] : property ? profile[property] : undefined;
    let source = value === undefined ? null : 'application_profile';
    let factIds = [];
    if (value === undefined && !recordKey && ['name','phone','email'].includes(property)) {
      const type = property === 'name' ? 'identity' : 'contact';
      const candidates = activeFacts.filter(fact => fact.type === type).map(fact => {
        const raw = fact.value || fact.sourceQuote || '';
        const found = property === 'phone' ? raw.match(/(?:\+?86[-\s]?)?1[3-9]\d{9}/)?.[0] : property === 'email' ? raw.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] : raw.replace(/^姓名\s*[:：]?\s*/, '').trim();
        return { value: found, id: fact.id || fact.factId };
      }).filter(item => item.value && (property !== 'name' || item.value.length <= 80));
      const unique = [...new Set(candidates.map(item => item.value))];
      if (unique.length === 1) { value = unique[0]; factIds = candidates.filter(item => item.value === value).map(item => item.id); source = 'candidate_fact'; }
    }
    if (value !== undefined && (typeof value !== 'string' || value.trim())) {
      value = normalizeForField(value, field);
      if (value !== undefined) { answers.push({ fieldId: field.id, value, source, factIds, sensitive: SENSITIVE_APPLICATION_FIELDS.includes(property) }); continue; }
    }
    const evidenceType = recordKey ? { education: 'education', employment: 'experience', projects: 'project' }[family] : property === 'degree' ? 'education' : null;
    if (evidenceType && activeFacts.some(fact => fact.type === evidenceType)) { pending.push(field); draftTypes.set(field.id, evidenceType); }
    else if (!recordKey && !property && (field.type === 'textarea' || OPEN.test(text))) pending.push(field);
    else skipped.push({ fieldId: field.id, status: 'missing' });
  }
  const careerFacts = [];
  let evidenceChars = 0;
  const neededTypes = new Set(draftTypes.values());
  const namedFacts = new Set(Array.isArray(drafts) ? drafts.flatMap(draft => Array.isArray(draft?.factIds) ? draft.factIds : []) : []);
  const priority = fact => namedFacts.has(fact.id || fact.factId) ? 0 : neededTypes.has(fact.type) ? 1 : 2;
  for (const fact of [...activeFacts].sort((a,b) => priority(a) - priority(b))) {
    if (!['education','project','experience','skill','achievement','career_preference'].includes(fact.type)) continue;
    const value = String(fact.value || ''), quote = String(fact.sourceQuote || '');
    // Pick whole evidence records within bounds. Truncation could erase a
    // negation or turn incomplete context into apparently complete proof.
    if (value.length > 1200 || quote.length > 1200 || /\b\d{17}[\dXx]\b/.test(value + quote)) continue;
    if (careerFacts.length >= 32 || evidenceChars + value.length + quote.length > 12000) break;
    careerFacts.push({ id: fact.id || fact.factId, type: fact.type, value, sourceQuote: quote, status: fact.status });
    evidenceChars += value.length + quote.length;
  }
  const actionable = pending.slice(0, 8);
  for (const field of pending.slice(8)) skipped.push({ fieldId: field.id, status: 'manual_required' });
  if (pending.length && (answerModel || drafts)) {
    signal?.throwIfAborted();
    let generated;
    try {
      generated = drafts || await answerModel({ fields: actionable, facts: careerFacts, preferences: Object.fromEntries(['expectedSalary','availableDate','preferredLocation','leaveReason'].filter(key => profile[key] !== undefined).map(key => [key, profile[key]])), signal });
    } catch { generated = []; }
    signal?.throwIfAborted();
    for (const field of actionable) {
      const draft = Array.isArray(generated) ? generated.find(item => item?.fieldId === field.id) : null;
      try {
        if (!draft || typeof draft.value !== 'string' || !draft.value.trim() || !Array.isArray(draft.factIds) || !draft.factIds.length) throw new Error();
        const evidence = draft.factIds.map(id => careerFacts.find(fact => (fact.id || fact.factId) === id));
        if (evidence.some(fact => !fact)) throw new Error();
        if (draftTypes.has(field.id) && evidence.some(fact => fact.type !== draftTypes.get(field.id))) throw new Error();
        const claims = buildClaimEvidence({ summary: draft.value }, evidence);
        const value = normalizeForField(draft.value, field);
        if (value === undefined) throw new Error();
        answers.push({ fieldId: field.id, value, source: 'grounded_draft', factIds: claims[0].factIds, sensitive: false });
      } catch { skipped.push({ fieldId: field.id, status: 'missing_evidence' }); }
    }
  } else for (const field of actionable) skipped.push({ fieldId: field.id, status: 'missing' });
  return { answers, skipped, decisionRuntime: judgments.realJevCalled ? 'jev-latest' : 'jev-protocol', realJevCalled: judgments.realJevCalled, decisionStatus: judgments.providerStatus, decisions: judgments.decisions };
}

function matchSimpleProperty(field) {
  return matchSimpleText(field.label) || matchSimpleText(field.name);
}

function matchSimpleText(value) {
  const text = String(value || '');
  if (!text.trim()) return null;
  const tokens = tokenizeEnglish(text);
  for (const [property, patterns] of SIMPLE) {
    if (patterns.zh.some(phrase => text.includes(phrase))) return property;
    if (patterns.en.some(pattern => patterns.exactEn ? hasExactTokenPattern(tokens, pattern) : hasTokenPattern(tokens, pattern))) return property;
  }
  return null;
}

function tokenizeEnglish(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];
}

function hasTokenPattern(tokens, pattern) {
  if (!tokens.length || pattern.length > tokens.length) return false;
  return tokens.some((_, index) => pattern.every((token, offset) => tokens[index + offset] === token));
}

function hasExactTokenPattern(tokens, pattern) {
  return tokens.length === pattern.length && pattern.every((token, index) => tokens[index] === token);
}

function buildRecordPlan(fields, profile) {
  const plan = new Map();
  const families = new Map();
  const undergraduateKeys = { '本科院校':'school', '本科学校':'school', '本科专业':'major', '本科毕业时间':'endDate', '本科成绩排名':'ranking' };
  const undergraduateIndexes = (profile.education || []).flatMap((record,index) => record.degree?.trim() === '本科' ? [index] : []);
  for (const field of fields) {
    const text = `${field.label || ''} ${field.name || ''}`;
    const section = String(field.section || '');
    const undergraduate = !section && Object.hasOwn(undergraduateKeys, field.label);
    const family = undergraduate ? 'education' : /^(获奖经历|获奖记录)$/.test(section) ? 'awards' : /^(社团干部经历|社团经历)$/.test(section) ? 'campusLeadership' : /教育|学历经历|education/i.test(section) ? 'education' : /实习|工作经历|工作经验|employment|experience/i.test(section) ? 'employment' : /项目|project/i.test(section) ? 'projects' : null;
    const recordKey = undergraduate ? undergraduateKeys[field.label] : family && RECORD_FIELDS[family].find(([, pattern]) => pattern.test(text))?.[0];
    if (!recordKey) continue;
    const explicitIndex = undergraduate ? undergraduateIndexes.length === 1 ? undergraduateIndexes[0] : null : Number.isInteger(field.recordIndex) && field.recordIndex >= 0 ? field.recordIndex : null;
    const entry = { field, family, recordKey, row: String(field.row || '').trim(), recordIndex: explicitIndex ?? 0, explicitIndex, manualRequired: undergraduate && undergraduateIndexes.length !== 1 };
    plan.set(field, entry);
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(entry);
  }
  for (const entries of families.values()) {
    const rows = [];
    const byKey = new Map();
    const groups = new Map();
    for (const entry of entries) {
      byKey.set(entry.recordKey, (byKey.get(entry.recordKey) || 0) + 1);
      if (entry.row && !rows.includes(entry.row)) rows.push(entry.row);
      const groupKey = entry.row || (entry.explicitIndex !== null ? `index:${entry.explicitIndex}` : 'missing-row');
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(entry);
    }
    for (const group of groups.values()) {
      const keys = new Map();
      for (const entry of group) keys.set(entry.recordKey, (keys.get(entry.recordKey) || 0) + 1);
      if ([...keys.values()].some(count => count > 1)) for (const entry of group) entry.manualRequired = true;
    }
    const rowIndexes = new Map(rows.map((row, index) => [row, index]));
    for (const entry of entries) {
      if (entry.manualRequired) continue;
      if (entry.explicitIndex !== null) continue;
      if (entry.row) {
        entry.recordIndex = rowIndexes.get(entry.row) || 0;
      } else if (rows.length || byKey.get(entry.recordKey) > 1) {
        entry.manualRequired = true;
      }
    }
  }
  return plan;
}

function normalizeForField(value, field) {
  if (field.type === 'jiandaoyun-multiselect') {
    const values = typeof value === 'string' ? [value] : value;
    if (!Array.isArray(values) || !values.length || values.length > 20 || values.some(item => typeof item !== 'string' || !item.trim() || item.length > 300)) return undefined;
    const labels = values.map(item => item.trim());
    return new Set(labels).size === labels.length ? labels : undefined;
  }
  if (Array.isArray(value)) return value.length === 1 ? normalizeForField(value[0], field) : undefined;
  if (field.type === 'checkbox') return typeof value === 'boolean' ? value : undefined;
  let text = String(value);
  if (typeof value === 'boolean' && ['custom-select','jiandaoyun-combo'].includes(field.type)) text = value ? '是' : '否';
  if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  if (field.type === 'month') { if (/^\d{4}-\d{2}-\d{2}$/.test(text)) text = text.slice(0, 7); if (!/^\d{4}-\d{2}$/.test(text)) return undefined; }
  if (field.type === 'number' && !/^-?\d+(?:\.\d+)?$/.test(text)) return undefined;
  if (field.maxLength && text.length > field.maxLength) return undefined;
  if (['select','radio','jiandaoyun-radio'].includes(field.type)) {
    const option = (field.options || []).find(item => item.value === text || item.label === text || (typeof value === 'boolean' && (value ? /^(是|yes|true)$/i : /^(否|no|false)$/i).test(item.label)));
    return option?.value;
  }
  return text;
}
