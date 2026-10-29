// Deterministic cleanup of public job data. Original source rows remain in storage.
export const JOB_DATA_QUALITY_VERSION = 2;
const cleanText = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const aliases = new Map([['tencent', '腾讯'], ['bytedance', '字节跳动'], ['xiaomi', '小米'], ['netease', '网易'], ['baidu', '百度'], ['jd.com', '京东']]);

export function cleanCompanyName(value) {
  const name = cleanText(value).replace(/^offerstar\s*[·:：-]\s*/i, '');
  return aliases.get(name.toLowerCase()) || name;
}

export function deadlineEnd(job) {
  const deadline=String(job.deadline||'');
  if(/可能|待定|延期|延长|暂定|tentative|extend/i.test(deadline)) return null;
  const matches=[...deadline.matchAll(/(\d{4})[-/.年]\s*(\d{1,2})[-/.月]\s*(\d{1,2})/g)];
  if(matches.length!==1) return null;
  const [,year,month,day]=matches[0].map(Number);
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year || date.getUTCMonth()!==month-1 || date.getUTCDate()!==day) return null;
  return date.getTime()+86400000;
}

export function deadlinePassed(job, now=Date.now()) {
  const end=deadlineEnd(job);
  return end!==null && end<=now;
}

export function cleanJobRecord(job, {now=Date.now()}={}) {
  const company = cleanCompanyName(job.company);
  const title = cleanText(job.title);
  // Shared social-recruitment portals also publish campus/intern positions.
  // An explicit role title is stronger evidence than that generic route.
  let type=job.type;
  if(job.source==='official-career-site' && (!type || type==='social')) {
    if(/实习|\bintern(?:ship)?\b/i.test(title)) type='internship';
    else if(/(?:20\d{2}|\d{2})届|(?:^|[（(·\s-])(?:秋招|春招|校招)(?:[）)·\s-]|$)/.test(title)) type='campus';
  }
  // Do not confuse people working on events with event announcements.
  const event = /招聘会|双选会|宣讲会|人才.{0,12}(?:洽谈会|交流会)|招才引智.{0,8}推进会|组团招聘会/.test(company)
    || /招聘会|双选会|宣讲会|招录宣讲|专场招聘活动|招聘活动公告|人才.{0,12}洽谈会|招才引智.{0,8}推进会/.test(title) && !/(?:经理|专员|工程师|策划师|运营师)$/.test(title);
  const navigation = /^(?:首页|职位列表|岗位列表|招聘动态|招聘帮助|联系我们|登录|注册)$/.test(title);
  const explicitNotice=/招聘启事|招聘简章|招聘公告|招录.{0,15}公告|选调.{0,25}公告/.test(title);
  const batch = explicitNotice || /(?:20\d{2}\s*届|校园|秋季|春季|秋招|春招).{0,20}(?:招聘|招募|计划|公告)|^(?:秋招|春招)[·/]/.test(title)
    && !/(?:工程师|开发|算法|经理|专员|设计师|分析师|研究员|实习生)/.test(title);
  const published=Date.parse(job.publishedAt||'');
  const officialObserved=Number(job.officialListingVerifiedAt);
  const observedOpen=job.source==='official-career-site' && officialObserved>0 && officialObserved<=now && now-officialObserved<=7*86400000;
  const oldPublication=Number.isFinite(published) && now-published>365*86400000;
  const years=[...title.matchAll(/(?<!\d)(20\d{2})(?:年|年度|\s*届)/g)].map(match=>Number(match[1]));
  const historicalNotice=batch && !observedOpen && oldPublication && years.length>0 && years.every(year=>year<new Date(now).getUTCFullYear());
  const expiryReason=job.closed?'source_closed':deadlinePassed(job,now)?'deadline_passed':null;
  return { ...job, rawCompany: job.rawCompany ?? job.company, rawTitle: job.rawTitle ?? job.title, company, title,
    ...(type!==job.type?{type,rawType:job.rawType??job.type??null}:{}),
    recordKind: event || navigation ? 'non_posting' : batch ? 'recruitment_batch' : 'posting',
    quarantineReason: event ? 'recruitment_event' : navigation ? 'navigation' : !company || !title ? 'invalid_identity' : historicalNotice ? 'historical_recruitment_notice' : null,
    expiryReason, freshnessStatus:expiryReason?'expired':observedOpen?'observed_open':'unverified',
    freshnessWarnings:oldPublication?['old_publication_date']:[],
    ...(batch && job.fullDescriptionVerified ? {fullDescriptionVerified:false} : {}),
    dataQualityVersion: JOB_DATA_QUALITY_VERSION };
}

export function canonicalJobUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    url.protocol = 'https:';
    if (!/^#\//.test(url.hash)) url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(?:ref|source|from|spm|trackingId)$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  } catch { return ''; }
}

function duplicateKey(job) {
  const url = canonicalJobUrl(job.url);
  // Shared portal links cannot identify an individual opening. Never merge
  // unrelated requisitions merely because company/title happen to match.
  return job.sharedUrl
    ? JSON.stringify([url, job.company, job.sourceJobId || job.id, job.title, job.location, job.type])
    : officialPostingIdentity(job) || url || JSON.stringify([job.feedId, job.id]);
}

function officialPostingIdentity(job) {
  try {
    const url=new URL(job.url);
    if(url.hostname==='careers.tencent.com' && /^\/jobdesc\.html$/.test(url.pathname) && /^\d+$/.test(url.searchParams.get('postId')||'')) return `tencent:${url.searchParams.get('postId')}`;
    const feishu=url.pathname.match(/\/position\/(\d+)(?:\/detail)?\/?$/);
    if(feishu && (/\.jobs\.feishu\.cn$/.test(url.hostname) || url.hostname==='jobs.bytedance.com')) return `feishu:${url.hostname}:${feishu[1]}`;
    const moka=url.pathname.match(/^\/(?:social|campus)-recruitment\/([^/]+)\/(\d+)\/job\/([^/]+)\/?$/);
    if(url.hostname==='app.mokahr.com' && moka) return `moka:${moka[1]}:${moka[2]}:${moka[3]}`;
    return '';
  } catch {return '';}
}

function sourceReference(job) {
  return { feedId: job.feedId || '', jobId: job.id || '', sourceJobId: job.sourceJobId || '', url: job.url || '', originSourceUrl: job.originSourceUrl || '', observedAt: job.observedAt ?? null, sourceFetchedAt: job.sourceFetchedAt ?? null, rawCompany: job.rawCompany ?? job.company, sourceRevision: job.sourceRevision || '', sourceProvider: job.sourceProvider || '' };
}

function references(job) {
  return [...(job.provenance || []), sourceReference(job)];
}

function mergeReferences(a, b) {
  return [...new Map([...references(a), ...references(b)].map(ref => [JSON.stringify([ref.feedId, ref.jobId, ref.url]), ref])).values()];
}

function quality(job) {
  return [Number(Boolean(job.fullDescriptionVerified)), Number(job.source === 'official-career-site'), String(job.description || '').length, Number(job.observedAt || 0)];
}

export function deduplicateJobs(jobs, {now=Date.now()}={}) {
  const buckets = new Map();
  for (const raw of jobs) {
    const job = cleanJobRecord(raw,{now});
    if (job.quarantineReason || job.expiryReason) continue;
    const key = duplicateKey(job);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(job);
  }
  const results = [];
  const location = job => /^(?:未标注|未知|地点待确认)$/.test(cleanText(job.location)) ? '' : cleanText(job.location);
  const specificity = job => Number(Boolean(job.type)) + Number(Boolean(location(job)));
  const compatible = (a, b) => a.company.toLowerCase() === b.company.toLowerCase() && a.title.toLowerCase() === b.title.toLowerCase()
    && (!a.sourceJobId || !b.sourceJobId || a.sourceJobId === b.sourceJobId || (officialPostingIdentity(a) && officialPostingIdentity(a)===officialPostingIdentity(b)))
    && (!a.type || !b.type || a.type === b.type) && (!location(a) || !location(b) || location(a) === location(b));
  for (const bucket of buckets.values()) {
    const groups = [];
    // Resolve known conflicting city/type copies before considering unknowns.
    // An ambiguous unknown is kept separately instead of bridging two jobs.
    for (const job of bucket.sort((a,b) => specificity(b)-specificity(a))) {
      const matches = groups.map((prior,index) => compatible(prior,job) ? index : -1).filter(index => index >= 0);
      if (matches.length !== 1) {
        groups.push({ ...job, provenance: mergeReferences(job, job) });
        continue;
      }
      const index=matches[0],prior=groups[index];
      const a = quality(prior), b = quality(job);
      const difference = b.map((value, i) => value - a[i]).find(value => value !== 0) || 0;
      const preferred = difference > 0 ? job : prior;
      groups[index] = { ...preferred, type: preferred.type || prior.type || job.type, location: location(preferred) ? preferred.location : location(prior) ? prior.location : job.location,
        provenance: mergeReferences(prior, job),
        retrievalHits: Math.max(prior.retrievalHits || 0, job.retrievalHits || 0),
        retrievalTitleHits: Math.max(prior.retrievalTitleHits || 0, job.retrievalTitleHits || 0) };
    }
    results.push(...groups);
  }
  return results;
}
