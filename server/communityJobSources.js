// Community-maintained public job aggregations on GitHub. These cover the long
// tail of mid-size and small employers that official career-site feeds miss.
// Rows are observation leads: the aggregation text is not a verified official
// JD, and 更新时间/last_seen marks when the curator last saw the entry.
const HU_EUN_REPO = 'HU-eun/campus-recruitment';

export const COMMUNITY_JOB_SOURCES = [
  {
    id: 'hu-eun-campus',
    title: '2027届校招信息汇总（社区每日聚合）',
    url: `https://raw.githubusercontent.com/${HU_EUN_REPO}/main/data/jobs.json`,
    fallback: `https://api.github.com/repos/${HU_EUN_REPO}/contents/data/jobs.json?ref=main`,
    format: 'json',
    sourceType: 'github-aggregator',
    originSourceUrl: `https://github.com/${HU_EUN_REPO}`,
    official: false,
    types: ['campus', 'internship'],
    // 更新时间 is when a batch was added; campus batches stay open for the
    // season, so a 7-day window would retire most small employers early.
    freshMs: 60 * 24 * 3600000,
    mapRows: mapHuEunCampusRows
  }
];

export function mapHuEunCampusRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(mapHuEunCampusRow).filter(Boolean);
}

// One row is one employer recruitment batch, not a single position: 招聘岗位
// lists every open role in the batch. Only rows with a real apply/announcement
// link and an explicit update time survive; the rest cannot serve as leads.
export function mapHuEunCampusRow(row = {}) {
  const company = toText(row['公司名称'], 200);
  const url = toText(row['官方公告'], 2000) || toText(row['投递方式'], 2000);
  const lastSeen = toText(row['更新时间'], 30);
  // Without an explicit update time the row cannot renew freshness downstream;
  // normalizeFeedJob would drop it, so it never becomes a lead at all.
  if (!company || !url || !lastSeen) return null;
  const positions = toText(Array.isArray(row['招聘岗位']) ? row['招聘岗位'].join('、') : row['招聘岗位'], 20000);
  const batch = toList(row['批次']).join('/');
  const cohort = toList(row['招聘对象']).join('/');
  const deadline = toText(row['截止时间'], 50);
  const note = toText(row['备注/提示'], 200);
  const title = positions && positions.length <= 60
    ? positions
    : [batch || '校招', cohort].filter(Boolean).join('·');
  const typeText = `${positions} ${batch} ${cohort}`;
  const jdText = [
    listLine('行业', row['行业大类']),
    listLine('性质', row['企业性质']),
    positions ? `岗位：${positions}` : '',
    listLine('笔试', row['是否需要笔试']),
    cohort ? `对象：${cohort}` : '',
    batch ? `批次：${batch}` : '',
    deadline ? `截止：${deadline}` : '',
    note && note !== company ? `备注：${note}` : ''
  ].filter(Boolean).join('\n');
  return {
    company,
    title,
    url,
    official_url: url,
    location: toList(row['工作地点']).join('/'),
    country: '中国',
    job_type: /实习/.test(typeText) ? 'internship' : 'campus',
    jd_text: jdText,
    publish_time: '',
    deadline,
    last_seen: lastSeen,
    status: 'active'
  };
}

function toText(value, max) {
  return stripTags(String(value ?? '')).replace(/\s+/g, ' ').trim().slice(0, max);
}

function toList(value) {
  const items = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  return items.map((item) => toText(item, 100)).filter(Boolean);
}

function listLine(label, value) {
  const items = toList(value).join('/');
  return items ? `${label}：${items}` : '';
}

function stripTags(value) {
  return value.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ');
}
