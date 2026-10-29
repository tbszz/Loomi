import { createHash } from "node:crypto";

// Order decides which type wins when the parser puts one string in several fields.
// More specific fields come first so an award the parser also listed as a skill is
// not stored as a skill.
const FIELDS = [
  ["projects", "project"], ["experience", "experience"], ["education", "education"],
  ["awards", "achievement"], ["metrics", "metric"], ["skills", "skill"]
];
const HEADINGS = new Set([
  '个人信息', '基本信息', '联系方式', '求职意向', '个人简介', '自我评价',
  '教育经历', '教育背景', '主修课程', '校园经历',
  '项目经历', '项目经验', '实践经历',
  '实习经历', '工作经历', '工作经验',
  '专业技能', '技能栈', '技能特长', '技能',
  '证书', '荣誉', '奖项', '荣誉奖项', '获奖情况', '获奖经历'
]);
const CHUNK_SIZE = 450;
const CHUNK_OVERLAP = 80;
const MIN_CHUNK_SIZE = 180;

function stableId(...parts) {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 40);
}

function isSectionHeading(value) {
  return HEADINGS.has(String(value).replace(/[\s：:]/g, ''));
}

function acceptable(source, start, end, quote) {
  const before = source[start - 1] || '';
  const after = source[end] || '';
  const leftBounded = !/^[A-Za-z0-9]$/.test(quote[0]) || !/[A-Za-z0-9]/.test(before);
  const rightBounded = !/[A-Za-z0-9]$/.test(quote) || !/[A-Za-z0-9]/.test(after);
  const prefix = source.slice(Math.max(0, start - 10), start);
  const negated = /(?:没有|尚未|未|不|不会)(?:使用|掌握|熟悉|会|做过)?\s*$/.test(prefix);
  return leftBounded && rightBounded && !negated;
}

export function validFactSourceSpan(source,fact) {
  const quote=String(fact.sourceQuote || '');
  const start=fact.sourcePosition;
  return Number.isInteger(start) && start>=0 && quote.length>0 && source.slice(start,start+quote.length)===quote && acceptable(source,start,start+quote.length,quote);
}

function findExact(source, value) {
  const haystack = source.toLocaleLowerCase();
  const needle = value.toLocaleLowerCase();
  let from = 0;
  while (from <= source.length - needle.length) {
    const start = haystack.indexOf(needle, from);
    if (start < 0) return null;
    const end = start + value.length;
    if (acceptable(source, start, end, value)) return { start, end, quote: value };
    from = start + 1;
  }
  return null;
}

// Reading a page and parsing it normalise whitespace differently, so a value that
// is genuinely on the page may not match byte for byte. Compare ignoring
// whitespace, but always return the exact span from the original page so the fact
// still points at real source text.
function findIgnoringWhitespace(source, value) {
  const positions = [];
  let compact = '';
  for (let index = 0; index < source.length; index += 1) {
    if (!/\s/.test(source[index])) { compact += source[index]; positions.push(index); }
  }
  const needle = value.replace(/\s/g, '');
  if (needle.length < 2 || needle.length > compact.length) return null;
  const haystack = compact.toLocaleLowerCase();
  const lowerNeedle = needle.toLocaleLowerCase();
  let from = 0;
  while (from <= compact.length - needle.length) {
    const at = haystack.indexOf(lowerNeedle, from);
    if (at < 0) return null;
    const start = positions[at];
    const end = positions[at + needle.length - 1] + 1;
    const quote = source.slice(start, end);
    if (acceptable(source, start, end, quote)) return { start, end, quote };
    from = at + 1;
  }
  return null;
}

export function extractCandidateMaterial(document, profile = {}) {
  const source = String(document.text || "");
  const facts = [];
  const seen = new Set();
  const add = (type, raw) => {
    const value = String(raw || "").trim();
    if (value.length < 2) return;
    if (isSectionHeading(value)) return;
    if (type === 'education' && !/大学|学院|本科|硕士|研究生|博士|学历|专业|毕业/.test(value)) return;
    // A parser guess that cannot be located in the page never becomes a durable fact.
    const span = findExact(source, value) || findIgnoringWhitespace(source, value);
    if (!span) return;
    const sourceQuote = span.quote;
    const key = `${span.start}\u0000${sourceQuote}`;
    if (seen.has(key)) return;
    seen.add(key);
    facts.push({
      id: stableId(document.id, key), type, value: sourceQuote,
      sourceQuote, sourcePosition: span.start,
      confidence: Math.min(0.95, Math.max(0.55, Number(profile.sourceConfidence || 75) / 100)),
      status: "user_asserted"
    });
  };
  add("identity", profile.name);
  for (const [field, type] of FIELDS) {
    for (const value of Array.isArray(profile[field]) ? profile[field] : []) add(type, value);
  }
  for (const value of Object.values(profile.contact || {})) add("contact", value);
  for(const line of source.split(/\r?\n/u)) {
    if(/^(?:求职意向|意向岗位|期望工作地点|期望薪资|求职偏好|职业目标)\s*[：:]\s*\S/u.test(line.trim())) add('career_preference',line);
  }

  const chunks = chunkSource(document.id, source);
  return { facts, chunks };
}

function chunkSource(documentId, source) {
  const chunks = [];
  let start = 0;
  while (start < source.length) {
    const hardEnd = Math.min(source.length, start + CHUNK_SIZE);
    const end = chooseChunkEnd(source, start, hardEnd);
    const text = source.slice(start, end);
    if (text.trim()) chunks.push({ id: stableId(documentId, "chunk", start), text, start, end });
    if (end >= source.length) break;
    const nextStart = end < hardEnd ? end : Math.max(start + 1, end - CHUNK_OVERLAP);
    start = nextStart <= start ? end : nextStart;
  }
  return chunks;
}

function chooseChunkEnd(source, start, hardEnd) {
  if (hardEnd >= source.length) return source.length;
  const minEnd = Math.min(hardEnd, start + MIN_CHUNK_SIZE);
  const headingStart = findSectionHeadingStart(source, minEnd, hardEnd);
  if (headingStart !== null && headingStart > start) return headingStart;
  const paragraphEnd = findLastBoundary(source, minEnd, hardEnd, /\r?\n\s*\r?\n/g);
  if (paragraphEnd !== null) return paragraphEnd;
  const lineEnd = findLastBoundary(source, Math.max(minEnd, hardEnd - 120), hardEnd, /\r?\n/g);
  return lineEnd ?? hardEnd;
}

function findSectionHeadingStart(source, from, to) {
  const start = Math.max(0, from - 2);
  const segment = source.slice(start, to);
  const pattern = /(^|\r?\n)([^\r\n]{2,24})\r?\n/g;
  let match;
  while ((match = pattern.exec(segment))) {
    const lineStart = start + match.index + match[1].length;
    if (lineStart < from || lineStart >= to) continue;
    if (isSectionHeading(match[2])) return lineStart;
  }
  return null;
}

function findLastBoundary(source, from, to, pattern) {
  let best = null;
  const segment = source.slice(from, to);
  let match;
  while ((match = pattern.exec(segment))) best = from + match.index + match[0].length;
  return best && best > from ? best : null;
}
