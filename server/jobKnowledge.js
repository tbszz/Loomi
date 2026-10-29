import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { OFFICIAL_JOB_SOURCES, loadOfficialJobFeed } from './officialJobSources.js';
import { COMMUNITY_JOB_SOURCES } from './communityJobSources.js';
import { LIVE_GITHUB_JOB_FEEDS, loadLiveGitHubJobFeed } from './liveGitHubJobFeeds.js';
import { loadJobDetail, fromHtml } from './jobDetailFetchers.js';
import { NCSS_JOB_FEEDS, loadNcssJobFeed } from './ncssJobFeed.js';
import { detectJobRegion, evaluateJobEligibility, jobCareerSignals } from './jobEligibility.js';
import { isLargeCompany } from './companyScale.js';
import { HIRING_RADAR_FEEDS, loadHiringRadarFeed } from './hiringRadar.js';
import { cleanJobRecord, deduplicateJobs, deadlinePassed } from './jobDataQuality.js';

export const AGGREGATED_JOB_FEEDS = [
  {id:'job-radar',url:'https://raw.githubusercontent.com/Jasmine-Liu-min/job-radar/main/data/jobs.json',fallback:'https://api.github.com/repos/Jasmine-Liu-min/job-radar/contents/data/jobs.json?ref=main',format:'json'},
  // Campus announcements stay open for the whole season; last_seen is when the
  // curator added them, not when they closed.
  {id:'campus-radar',url:'https://raw.githubusercontent.com/ruyi1/campus-radar/main/data/jobs.db',fallback:'https://api.github.com/repos/ruyi1/campus-radar/contents/data/jobs.db?ref=main',format:'sqlite',freshMs:60*24*3600000},
  ...LIVE_GITHUB_JOB_FEEDS,
  ...NCSS_JOB_FEEDS,
  ...COMMUNITY_JOB_SOURCES,
  ...HIRING_RADAR_FEEDS
];
export const JOB_FEEDS = [...AGGREGATED_JOB_FEEDS, ...OFFICIAL_JOB_SOURCES];
const LIVE_GITHUB_FORMATS=new Set(LIVE_GITHUB_JOB_FEEDS.map(feed=>feed.format));
const HOUR=3600000, DAY=24*HOUR;
// Archived records are kept as history; only run logs expire.
export const JOB_RETENTION = {refreshMs:6*HOUR,retryMs:HOUR,freshMs:7*DAY,logMs:30*DAY};
/** Career sites are fetched in parallel; SQLite writes stay synchronous. */
const SOURCE_CONCURRENCY = 4;
const NORMALIZED_JOB_TYPES = new Set(['campus','internship','social']);
// Fields an on-demand detail fetch adds; a later list sync must not erase them.
const DETAIL_FIELDS=['description','requirements','fullDescriptionVerified','officiallyVerifiedAt','detailFetchedAt','detailUrl','detailProvider','jdEvidence'];
// Bump to rebuild the full-text index when indexBody changes.
const FTS_VERSION=2;
const CJK=/[㐀-鿿]/u;

// CJK runs are indexed as overlapping bigrams so two-character terms (前端,
// 算法) match inside longer words; Latin runs stay whole words.
function indexTokens(value) {
  const tokens=[];
  for(const run of String(value||'').toLowerCase().match(/[㐀-鿿]+|[a-z0-9]+/gu)||[]) {
    if(!CJK.test(run) || run.length===1) {tokens.push(run);continue;}
    for(let index=0;index<run.length-1;index++) tokens.push(run.slice(index,index+2));
  }
  return tokens;
}

function indexBody(job) {
  return [...indexTokens([job.title,job.company,job.rawCompany,job.location,job.description,...(job.requirements||[])].join(' ')),job.type?`zztype${job.type}`:''].join(' ');
}

// The index only narrows candidates; matchesQueryGroup still decides every
// hit, so the phrase for a term must match whatever the exact rule matches.
// A lone CJK character has no bigram, so such a query scans instead (null).
function ftsPhrase(term) {
  const runs=term.match(/[㐀-鿿]+|[a-z0-9]+/gu)||[];
  if(!runs.length || runs.some(run=>CJK.test(run) && run.length===1)) return null;
  return `"${indexTokens(term).join(' ')}"`;
}

function ftsQuery(branches) {
  if(!branches.length) return null;
  const parts=[];
  for(const groups of branches) {
    const clauses=[];
    for(const group of groups) {
      const phrases=group.terms.map(ftsPhrase);
      if(phrases.includes(null)) return null;
      clauses.push(`(${unique([...phrases,...group.employmentTypes.map(type=>`zztype${type}`)]).join(' OR ')})`);
    }
    parts.push(`(${clauses.join(' AND ')})`);
  }
  return parts.join(' OR ');
}

/** An official entry with no adapter can never yield records, so skip it. */
export function isSyncableFeed(feed) {
  return feed?.adapter?.status !== 'unadapted';
}

function canonicalUrl(value) {
  try {
    const u=new URL(value);
    if (!['https:','http:'].includes(u.protocol) || u.username || u.password) return '';
    // Keep hash routes (`#/details?id=…`); only strip scroll anchors.
    if (!/^#\//.test(u.hash)) u.hash='';
    for(const key of [...u.searchParams.keys()]) if (/^utm_|^(ref|source)$/i.test(key)) u.searchParams.delete(key);
    u.searchParams.sort(); return u.href;
  } catch { return ''; }
}
const text=(value,max=20000)=>String(value ?? '').trim().slice(0,max);
const millis=value=> {const n=Date.parse(value);return Number.isFinite(n)?n:null};
const EMPLOYMENT_TYPES=new Map([
  ['实习生','internship'],['实习','internship'],['internship','internship'],['intern','internship'],
  ['graduate','campus'],['campus','campus'],['校招','campus'],['应届','campus'],
  ['社招','social'],['全职','social']
]);
const COMPOUND_EMPLOYMENT_TERMS=[...EMPLOYMENT_TYPES.keys()];
// Small tech-stack/tool vocabulary for ranking only, not a role vocabulary.
// Mixed branches require only non-tech groups in the title; tech evidence is
// a tie-breaker. matchesTerm's token boundaries and the AND pool stay intact.
const TECH_STACK_TERMS=new Set([
  'java','python','c++','c','c#','go','golang','rust','javascript','typescript','js','ts','php','kotlin','swift','scala','sql',
  'spring','spring boot','springboot','mysql','redis','kafka','react','vue','node','node.js','pytorch','tensorflow','linux','k8s','kubernetes','docker'
]);
const QUERY_ALIASES=new Map([
  ['ai',['人工智能','机器学习','深度学习','大模型','算法','llm','aigc','nlp','computer vision','machine learning']],
  ['人工智能',['ai','机器学习','深度学习','大模型','算法','llm','aigc','nlp']],
  ['计算机',['软件','开发','前端','后端','算法','机器学习','深度学习','大模型','人工智能','ai','llm','swe','software','backend','frontend','数据','测试','运维','安全']],
  ['computer',['计算机','software','swe','backend','frontend','ai','machine learning']],
  ['后端',['backend','back end','服务端']],
  ['前端',['frontend','front end']],
  ['大模型',['llm','large language model','aigc']],
  ['llm',['大模型','large language model','aigc']]
]);
// Only role synonyms may expand compound prefixes. Broad categories such as
// 计算机 / AI include related fields, not interchangeable compound meanings:
// 计算机网络 must not become 数据网络 or 安全网络.
const COMPOUND_SYNONYM_KEYS=new Set(['后端','前端','大模型']);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function queryAlternates(term) {
  const terms=[term,...(QUERY_ALIASES.get(term)||[])];
  // One prefix-alias pass, then one 开发/研发 suffix swap. Compound forms
  // use Chinese aliases only; whole-term aliases retain today's behaviour.
  const compounds=[...QUERY_ALIASES].flatMap(([key,aliases])=>COMPOUND_SYNONYM_KEYS.has(key) && term.startsWith(key) && term.length>key.length
    ?aliases.filter(alias=>/^[㐀-鿿]+$/u.test(alias)).map(alias=>alias+term.slice(key.length)):[]);
  const variants=[...terms,...compounds].filter(value=>/(开发|研发)$/u.test(value))
    .map(value=>value.replace(/(开发|研发)$/u,suffix=>suffix==='开发'?'研发':'开发'));
  // Never introduce an unindexable alternate that would make ftsQuery scan.
  // Original terms keep the intentional single-CJK-character fallback.
  return unique([...terms,...[...compounds,...variants].filter(value=>ftsPhrase(value)!==null)]);
}

function queryGroup(term) {
  const terms=queryAlternates(term);
  return {term,terms,employmentTypes:unique(terms.map(value=>EMPLOYMENT_TYPES.get(value)))};
}

// Short role words have multiple professions behind them. These title-only
// signals DEMOTE, never exclude: uncertain domain matches remain in `total`.
// Explicit domain wording anywhere in the same OR branch disables its rule
// ("芯片 后端" and "芯片后端" both retain the user's semiconductor intent).
const QUERY_DISAMBIGUATION = [
  {query:/前端|后端|\b(?:frontend|backend|front end|back end)\b/i,otherDomain:/芯片|\bic\b|\bsoc\b|数字(?!化)|模拟|版图|验证|流程|工艺/i},
  {query:/测试|\b(?:testing|qa)\b/i,otherDomain:/硬件|电池|电气|整机|操作员|测试员|派遣|产线|芯片|电芯|可靠性|射频/i},
  {query:/运营/,otherDomain:/安全运营|运维/},
  {query:/大模型|\bllm\b/i,otherDomain:/设计师|美术|动画|视频/,titleContext:/aigc/i}
];

function parseJobQuery(query) {
  const branch=text(query,100).toLowerCase();
  return branch.split(/[\s,，、]+/).filter(Boolean).flatMap(term=>{
    const suffix=COMPOUND_EMPLOYMENT_TERMS.find(value=>term.endsWith(value) && term.length>value.length);
    if(!suffix) return [queryGroup(term)];
    const role=term.slice(0,-suffix.length);
    return [queryGroup(role),queryGroup(suffix)];
  }).filter(group=>group.terms.length).map(group=>({...group,disambiguation:QUERY_DISAMBIGUATION.filter(rule=>rule.query.test(group.term) && !rule.otherDomain.test(branch))}));
}

function matchesTerm(haystack,term) {
  const firstIndex=haystack.indexOf(term);
  if(firstIndex<0) return false;
  if(!/[a-z0-9.+#]/i.test(term) || /[\u3400-\u9fff]/u.test(term)) return true;
  const tokenChar=/[a-z0-9.+#]/i;
  let index=firstIndex;
  while(index>=0) {
    const before=index>0?haystack[index-1]:'';
    const after=haystack[index+term.length]||'';
    if(!tokenChar.test(before) && !tokenChar.test(after)) return true;
    index=haystack.indexOf(term,index+term.length);
  }
  return false;
}

function matchesQueryGroup(job,haystack,group) {
  return group.employmentTypes.includes(job.type) || group.terms.some(term=>matchesTerm(haystack,term));
}

// Small ranking-only heuristic: slash-separated alternatives (C/C++/MATLAB),
// or comma/、/或 lists in a clause with an example/choose-one cue. Remove only
// the list spans before checking again: a separate "精通C++" still counts.
// This does not parse skill requirements or filter records out of the pool.
function withoutAlternativeLists(value) {
  return value.split(/([。；;！!？?\n])/u).map(clause=>clause.replace(
    /(?:[a-z][a-z0-9.+#-]*|[㐀-鿿]+)(?:[ \t]*(?:[/／、,，|]|或)[ \t]*(?:[a-z][a-z0-9.+#-]*|[㐀-鿿]+))+/giu,
    (list,offset)=>/[/／|]/.test(list)
      || /(?:至少|其中|任意|任一)\s*(?:一|1)\s*(?:种|门|项|个)/.test(clause)
      || /(?:例如|比如|诸如|如)\s*$/.test(clause.slice(0,offset))
      || /^(?:例如|比如|诸如|如)/.test(list) ? ' ' : list
  )).join('');
}

function queryDomainPenalty(job,branches) {
  if(!branches.length) return 0;
  return Math.min(...branches.map(groups=>Number(groups.some(group=>group.disambiguation.some(rule=>rule.otherDomain.test(job.title) && (!rule.titleContext || rule.titleContext.test(job.title)))))));
}

function campusStageTier(job) {
  const signals=jobCareerSignals(job);
  if(signals.graduateEvidence) return 0;
  return !job.type && (signals.seniorityEvidence || signals.workExperienceRequirements.some(requirement=>requirement.years>0)) ? 2 : 1;
}

// Ranking-only fallback for season/cohort leads mislabeled as postings. Strip
// only known company names, batch labels and punctuation; any role text left
// over keeps the row a posting. Never rewrite the stored recordKind.
function isRecruitmentBatchForRanking(job) {
  if(job.recordKind==='recruitment_batch') return true;
  let title=job.title.toLowerCase();
  for(const company of unique([job.company,job.rawCompany])) title=title.split(company.toLowerCase()).join('');
  const labels=/(?:20\d{2}|\d{2})\s*届|校园招聘|(?:春季|秋季)(?:招聘)?|秋招|春招|校招/g;
  return labels.test(title) && !title.replace(labels,'').replace(/[\s\p{P}]/gu,'');
}

// Relevance bands precede all secondary quality scores. Without a campus
// filter, career-stage evidence has no effect on role relevance.
function retrievalBand(job,type) {
  if(job.retrievalDomainPenalty) return 5;
  if(type!=='campus') return job.retrievalTitleMatch?0:1;
  if(job.retrievalTitleMatch) return [0,1,3][job.retrievalStageTier];
  return job.retrievalStageTier===0?2:4;
}

export function normalizeFeedJob(row,feed,now=Date.now()) {
  const url=canonicalUrl(row.official_url || row.url);
  const title=text(row.title,300),company=text(row.company_name || row.company,200);
  if(!url || !title || !company) return null;
  const observed=millis(row.last_seen);
  // Fetching an old repository snapshot must not renew its records' freshness.
  if(!observed || observed>now+DAY) return null;
  const description=text(row.jd_text || '');
  const typeText=text(row.job_type || row.category,100);
  // An adapter that already resolved the type is authoritative; the URL/title
  // heuristics below only exist for aggregated feeds that do not.
  const type=NORMALIZED_JOB_TYPES.has(typeText) ? typeText
    : /实习|intern/i.test(typeText+' '+title)?'internship'
    : /校招|campus|应届/i.test(typeText)?'campus'
    : /社招|social|experienced/i.test(typeText+' '+url)?'social':null;
  const official=feed.kind==='official';
  const sourceType = feed.sourceType || (official ? 'official-company' : 'domestic-feed');
  const sourceName = official ? 'official-career-site' : feed.sourceType==='github-aggregator' ? 'github-job-source' : 'domestic-feed';
  // Only an official adapter can vouch for a full JD; aggregator jd_text can
  // contain duties only.
  const fullDescriptionVerified = official && Boolean(row.full_description_verified ?? row.fullDescriptionVerified);
  // A careers site that links every posting to one list page needs the
  // job_id, or all its postings collapse into one record.
  const sharedUrl=row.sharedUrl===true;
  const identity=sharedUrl?`${feed.id}|${text(row.job_id,300)||[url,company,title,row.location].join('|')}`:url;
  return cleanJobRecord({id:createHash('sha256').update(identity).digest('hex'),company,title,url,sourceUrl:url,
    sourceJobId:text(row.job_id,300),sharedUrl,
    location:text(row.location,300),country:text(row.country,100),postingAge:text(row.postingAge,50),companySize:text(row.companySize,30),
    type,description,requirements:fullDescriptionVerified && Array.isArray(row.requirements)?row.requirements.map(value=>text(value,10000)).slice(0,30):[],source:sourceName,sourceType,feedId:feed.id,
    sourceProvider:text(row.source_provider,100),sourceRevision:text(row.source_revision,100),
    sourceGroup:text(row.source_group || feed.group,100),trust:Number(row.source_trust ?? feed.trust) || undefined,
    originSourceUrl:canonicalUrl(row.origin_source_url || feed.officialUrl || feed.originSourceUrl || feed.url),
    fullDescriptionVerified,officiallyVerifiedAt:fullDescriptionVerified ? (row.last_seen || new Date(now).toISOString()) : null,
    // An official list fetch is itself evidence the posting was open then.
    officialListingVerifiedAt:official?observed:null,
    publishedAt:text(row.publish_time,50),deadline:text(row.deadline,50),observedAt:observed,
    sourceFetchedAt:now,closed:Boolean(row.gone)||/^(closed|expired|下线|已关闭)$/i.test(row.status || '')},{now});
}

export async function loadJobFeed(feed,{signal,knownDetails,now}={}) {
  if(feed.format==='hiring-radar') return loadHiringRadarFeed(feed,{signal,now});
  if (feed.kind === 'official' || feed.sourceType === 'official-company') {
    return loadOfficialJobFeed(feed, { signal, knownDetails, now });
  }
  if(LIVE_GITHUB_FORMATS.has(feed.format)) return loadLiveGitHubJobFeed(feed,{signal});
  if(feed.format==='ncss') return loadNcssJobFeed(feed,{signal});
  let bytes,lastError;
  for(const url of [feed.url,feed.fallback].filter(Boolean)) {
    try {
      signal?.throwIfAborted();
      const response=await fetch(url,{headers:{accept:'application/vnd.github.raw+json','user-agent':'ResumeProtocol-JobKnowledge'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000),redirect:'error'});
      if(!response.ok) throw new Error(`source_http_${response.status}`);
      const chunks=[];let size=0;
      for await(const chunk of response.body) {size+=chunk.length;if(size>20*1024*1024) throw new Error('source_too_large');chunks.push(chunk);}
      bytes=Buffer.concat(chunks);break;
    } catch(error) {lastError=error;if(signal?.aborted || error.message==='source_too_large') throw error;}
  }
  if(!bytes) throw lastError;
  if(feed.format==='json') {
    const rows=JSON.parse(bytes.toString('utf8'));
    if(!Array.isArray(rows) || rows.length>50000) throw new Error('invalid_source_shape');
    return typeof feed.mapRows==='function' ? feed.mapRows(rows) : rows;
  }
  const folder=await mkdtemp(path.join(tmpdir(),'resume-job-feed-'));
  const filename=path.join(folder,'feed.sqlite');let db;
  try {
    await writeFile(filename,bytes);
    db=new DatabaseSync(filename,{readOnly:true});
    db.exec('PRAGMA trusted_schema=OFF');
    const table=db.prepare("SELECT type FROM sqlite_master WHERE name='jobs'").get();
    if(table?.type!=='table') throw new Error('invalid_jobs_table');
    // Never read/import applications, profiles, feedback or tracking tables.
    const rows=db.prepare('SELECT company,job_id,title,category,location,url,publish_time,last_seen FROM jobs LIMIT 50000').all();
    return rows;
  } finally {db?.close();await unlink(filename).catch(()=>{});await rmdir(folder).catch(()=>{});}
}

export function createJobKnowledge(db,{clock=Date.now,loader=loadJobFeed,detailLoader=loadJobDetail,feeds=JOB_FEEDS}={}) {
  db.exec(`CREATE TABLE IF NOT EXISTS job_knowledge_records (
    source_id TEXT NOT NULL, job_id TEXT NOT NULL, payload TEXT NOT NULL,
    observed_at INTEGER NOT NULL, archived_at INTEGER, PRIMARY KEY(source_id,job_id));
    CREATE TABLE IF NOT EXISTS job_knowledge_sources (
    source_id TEXT PRIMARY KEY,last_attempt INTEGER,last_success INTEGER,lease_until INTEGER,lease_owner TEXT,error TEXT,count INTEGER);
    CREATE TABLE IF NOT EXISTS job_knowledge_runs (id TEXT PRIMARY KEY,source_id TEXT,created_at INTEGER,ok INTEGER,count INTEGER,error TEXT);
    CREATE TABLE IF NOT EXISTS job_knowledge_meta (key TEXT PRIMARY KEY,value INTEGER);
    CREATE TABLE IF NOT EXISTS job_knowledge_cleaning_originals (
    source_id TEXT NOT NULL, job_id TEXT NOT NULL, payload TEXT NOT NULL, archived_at INTEGER,
    cleaned_at INTEGER NOT NULL, PRIMARY KEY(source_id,job_id));`);
  let timer,controller,working=null;
  const freshness=new Map(feeds.filter(feed=>feed.freshMs>0).map(feed=>[feed.id,feed.freshMs]));
  const freshFor=sourceId=>freshness.get(sourceId)||JOB_RETENTION.freshMs;
  const maxFresh=Math.max(JOB_RETENTION.freshMs,...freshness.values());
  const isActive=(job,now)=>job.observedAt>=now-freshFor(job.feedId) && !deadlinePassed(job,now) && !job.closed && !job.expiryReason;
  const feedsById=new Map(feeds.map(feed=>[feed.id,feed]));

  function withCachedSections(original,now) {
    const job=cleanJobRecord(original,{now}),feed=feedsById.get(job.feedId);
    if(job.quarantineReason || job.expiryReason || job.recordKind!=='posting' || job.fullDescriptionVerified || !feed || feed.kind!=='official' || job.source!=='official-career-site' || !job.description || job.description.length>=20000) return job;
    let url,declared;
    try {url=new URL(job.url);declared=new URL(feed.officialUrl||feed.entryUrl||feed.url);} catch {return job;}
    if(!['http:','https:'].includes(url.protocol) || url.username || url.password || ![declared.hostname,...(feed.allowedHosts||[])].includes(url.hostname)) return job;
    // Shared ATS hosts serve many unrelated employers; the tenant/site prefix
    // must also match the deterministic registry entry before promoting text.
    if(feed.parser==='moka' && !url.pathname.startsWith(declared.pathname.replace(/\/$/,'')+'/job/')) return job;
    const parsed=fromHtml(job.description,job.url,'cached-official-sections');
    if(!parsed.sectionEvidenceComplete) return job;
    return {...job,requirements:parsed.requirements,fullDescriptionVerified:true,
      officiallyVerifiedAt:job.sourceFetchedAt||job.observedAt||now,
      jdEvidence:{method:'explicit_cached_sections',sourceUrl:job.url,sourceRevision:job.sourceRevision||'',observedAt:job.observedAt}};
  }

  // rowid of job_knowledge_records is stable (records are archived, never deleted).
  if(db.prepare("SELECT value FROM job_knowledge_meta WHERE key='fts'").get()?.value!==FTS_VERSION) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec("DROP TABLE IF EXISTS job_knowledge_fts; CREATE VIRTUAL TABLE job_knowledge_fts USING fts5(body, content='', contentless_delete=1);");
      const insert=db.prepare('INSERT INTO job_knowledge_fts(rowid,body) VALUES (?,?)');
      for(const row of db.prepare('SELECT rowid,payload FROM job_knowledge_records').iterate()) insert.run(row.rowid,indexBody(JSON.parse(row.payload)));
      db.prepare("INSERT OR REPLACE INTO job_knowledge_meta VALUES ('fts',?)").run(FTS_VERSION);
      db.exec('COMMIT');
    } catch(error) {db.exec('ROLLBACK');throw error;}
  }
  const ftsRow=db.prepare('SELECT rowid FROM job_knowledge_records WHERE source_id=? AND job_id=?');
  const ftsDelete=db.prepare('DELETE FROM job_knowledge_fts WHERE rowid=?');
  const ftsInsert=db.prepare('INSERT INTO job_knowledge_fts(rowid,body) VALUES (?,?)');
  function reindex(sourceId,jobId,job) {
    const rowid=ftsRow.get(sourceId,jobId)?.rowid;
    if(rowid===undefined) return;
    ftsDelete.run(rowid);ftsInsert.run(rowid,indexBody(job));
  }

  function cleanup(force=false) {
    const now=clock(); const last=db.prepare("SELECT value FROM job_knowledge_meta WHERE key='cleanup'").get()?.value || 0;
    if(!force && now-last<DAY) return;
    db.prepare(`UPDATE job_knowledge_records SET archived_at=? WHERE archived_at IS NULL AND source_id NOT IN (${[...freshness.keys()].map(()=>'?').join(',')}) AND observed_at<?`).run(now,...freshness.keys(),now-JOB_RETENTION.freshMs);
    for(const [sourceId,freshMs] of freshness) db.prepare('UPDATE job_knowledge_records SET archived_at=? WHERE archived_at IS NULL AND source_id=? AND observed_at<?').run(now,sourceId,now-freshMs);
    // Passed deadlines retire postings even while their source still lists them.
    const archive=db.prepare('UPDATE job_knowledge_records SET archived_at=? WHERE rowid=?');
    for(const row of db.prepare("SELECT rowid,json_extract(payload,'$.deadline') deadline FROM job_knowledge_records WHERE archived_at IS NULL AND json_extract(payload,'$.deadline')<>''").all()) if(deadlinePassed(row,now)) archive.run(now,row.rowid);
    db.prepare('DELETE FROM job_knowledge_runs WHERE created_at<?').run(now-JOB_RETENTION.logMs);
    db.prepare("INSERT OR REPLACE INTO job_knowledge_meta VALUES ('cleanup',?)").run(now);
  }

  async function mapWithConcurrency(items,limit,worker) {
    const queue=[...items];
    const runners=Array.from({length:Math.min(limit,queue.length)},async()=>{
      while(queue.length) {const item=queue.shift();await worker(item);}
    });
    await Promise.all(runners);
  }

  async function syncFeed(feed,{signal,force}) {
    if(signal?.aborted) return;
    const now=clock(), owner=randomUUID();
    db.prepare('INSERT OR IGNORE INTO job_knowledge_sources(source_id) VALUES (?)').run(feed.id);
    const state=db.prepare('SELECT * FROM job_knowledge_sources WHERE source_id=?').get(feed.id);
    if(!force && now-(state.last_attempt||0)<(state.error?JOB_RETENTION.retryMs:feed.refreshMs||JOB_RETENTION.refreshMs)) return;
    const lock=db.prepare('UPDATE job_knowledge_sources SET lease_until=?,lease_owner=?,last_attempt=? WHERE source_id=? AND COALESCE(lease_until,0)<?').run(now+5*60*1000,owner,now,feed.id,now);
    if(!lock.changes) return;
    try {
      // A source with a bounded detail budget is told which rows already have a
      // verified JD, so each run completes the next batch instead of re-fetching
      // the same rows.  The completed text is handed back too: the list endpoint
      // carries duties only, so rebuilding a row from the list alone would
      // downgrade a JD that an earlier sync already finished.
      const knownDetails=new Map(db.prepare(
        "SELECT json_extract(payload,'$.url') AS url, json_extract(payload,'$.description') AS jdText FROM job_knowledge_records WHERE source_id=? AND archived_at IS NULL AND json_extract(payload,'$.fullDescriptionVerified')=1"
      ).all(feed.id).filter(row=>row.url).map(row=>[row.url,row.jdText||'']));
      // Loaders stamp last_seen from the same clock that judges freshness.
      const rows=await loader(feed,{signal,knownDetails,now:clock()});
      const urlCounts=new Map();
      for(const r of rows) {const u=canonicalUrl(r.official_url || r.url);if(u) urlCounts.set(u,(urlCounts.get(u)||0)+1);}
      const normalized=rows.map(r=>normalizeFeedJob(urlCounts.get(canonicalUrl(r.official_url || r.url))>1?{...r,sharedUrl:true}:r,feed,clock())).filter(Boolean);
      // A reachable official career page may render its job list only in the
      // browser.  Treat that as a successful source check with zero imported
      // records; it is different from a broken/empty third-party feed.
      if(!normalized.length && feed.kind !== 'official' && !(feed.allowEmpty && rows.length===0)) throw new Error('empty_or_incompatible_source');
      const at=clock();
      if(db.prepare('SELECT lease_owner FROM job_knowledge_sources WHERE source_id=?').get(feed.id)?.lease_owner!==owner) return;
      db.exec('BEGIN IMMEDIATE');
      try {
        // Only an explicitly complete snapshot can retire missing records.
        // A failed/partial fetch never reaches this transaction.
        if(feed.snapshot) db.prepare('UPDATE job_knowledge_records SET archived_at=COALESCE(archived_at,?) WHERE source_id=?').run(at,feed.id);
        const upsert=db.prepare('INSERT INTO job_knowledge_records VALUES (?,?,?,?,?) ON CONFLICT(source_id,job_id) DO UPDATE SET payload=excluded.payload,observed_at=excluded.observed_at,archived_at=CASE WHEN excluded.archived_at IS NULL THEN NULL ELSE COALESCE(job_knowledge_records.archived_at,excluded.archived_at) END');
        const previous=db.prepare('SELECT payload FROM job_knowledge_records WHERE source_id=? AND job_id=?');
        for(const job of normalized) {
          let stored=withCachedSections(job,at);
          if(!job.fullDescriptionVerified) {
            const earlier=previous.get(feed.id,job.id);
            const prior=earlier?JSON.parse(earlier.payload):null;
            if(prior?.detailFetchedAt && (!stored.fullDescriptionVerified || prior.fullDescriptionVerified)) stored={...job,...Object.fromEntries(DETAIL_FIELDS.filter(key=>key in prior).map(key=>[key,prior[key]]))};
          }
          upsert.run(feed.id,job.id,JSON.stringify(stored),job.observedAt,job.closed||job.quarantineReason||!isActive(job,at)?at:null);
          reindex(feed.id,job.id,stored);
        }
        const activeCount=db.prepare('SELECT COUNT(*) n FROM job_knowledge_records WHERE source_id=? AND archived_at IS NULL AND observed_at>=?').get(feed.id,at-freshFor(feed.id)).n;
        db.prepare('UPDATE job_knowledge_sources SET last_success=?,error=NULL,count=?,lease_until=0,lease_owner=NULL WHERE source_id=?').run(at,activeCount,feed.id);
        db.prepare('INSERT INTO job_knowledge_runs VALUES (?,?,?,?,?,?)').run(randomUUID(),feed.id,at,1,normalized.length,null);
        db.exec('COMMIT');
      } catch(error) {db.exec('ROLLBACK');throw error;}
    } catch(error) {
      const message=String(error.message).slice(0,300);
      db.prepare('UPDATE job_knowledge_sources SET error=?,lease_until=0,lease_owner=NULL WHERE source_id=? AND lease_owner=?').run(message,feed.id,owner);
      db.prepare('INSERT INTO job_knowledge_runs VALUES (?,?,?,?,?,?)').run(randomUUID(),feed.id,clock(),0,0,message);
      console.warn(`[job-knowledge] ${feed.id}: ${message}`);
    }
  }

  async function synchronize({force=false,signal,sourceIds}={}) {
    cleanup();
    const selected=sourceIds?new Set(sourceIds):null;
    if(selected && [...selected].some(id=>!feeds.some(feed=>feed.id===id))) throw new Error('unknown_job_source');
    await mapWithConcurrency(feeds.filter(feed=>isSyncableFeed(feed) && (!selected || selected.has(feed.id))),SOURCE_CONCURRENCY,feed=>syncFeed(feed,{signal,force}));
  }

  async function sync(options={}) {
    if(working) {await working;if(!options.force) return;}
    working=synchronize(options).finally(()=>{working=null;});
    return working;
  }

  async function search({query='',type,region,location='',companyScale='any',profile,material='',userStatements=[],educationFacts=[],exclude=[],limit=20,offset=0,refresh=false,cacheOnly=false,signal}={}) {
    // Long multi-employer walks run in the existing background synchronizer.
    // A normal search may use a fresh cache while it runs; explicit refresh
    // still waits and failures remain visible in per-source state.
    const cached=working && db.prepare('SELECT 1 FROM job_knowledge_records WHERE archived_at IS NULL AND observed_at>=? LIMIT 1').get(clock()-maxFresh);
    if(!cacheOnly && (refresh || !cached)) await sync({force:refresh,signal});
    signal?.throwIfAborted();
    const now=clock();
    const queryBranches=text(query,100).split('|').map(parseJobQuery).filter(groups=>groups.length);
    // The full-text index narrows candidates before any payload is parsed.
    const match=ftsQuery(queryBranches);
    const records=match
      ?db.prepare('SELECT r.payload FROM job_knowledge_fts f JOIN job_knowledge_records r ON r.rowid=f.rowid WHERE job_knowledge_fts MATCH ? AND r.archived_at IS NULL AND r.observed_at>=?').all(match,now-maxFresh)
      :db.prepare('SELECT payload FROM job_knowledge_records WHERE archived_at IS NULL AND observed_at>=?').all(now-maxFresh);
    const matching=[];
    for(const row of records) {
      const job=withCachedSections(JSON.parse(row.payload),now);
      if(job.quarantineReason) continue;
      if(!isActive(job,now)) continue;
      if(type && job.type && job.type!==type) continue;
      const jobRegion=detectJobRegion(job);
      if((region==='domestic' && jobRegion==='overseas') || (region==='overseas' && jobRegion==='domestic')) continue;
      if(region==='domestic' && job.source==='github-job-source' && jobRegion==='unknown') continue;
      if(location && !text(job.location).toLowerCase().includes(text(location,100).toLowerCase())) continue;
      // A platform-stated headcount of 5000+ counts as large even off the name list.
      const largeCompany=isLargeCompany(job.company) || /^(5000|10000)/.test(job.companySize||'');
      if((companyScale==='small_mid' && largeCompany) || (companyScale==='large' && !largeCompany)) continue;
      const haystack=(job.title+' '+job.description+' '+job.location+' '+job.company+' '+(job.rawCompany||'')).toLowerCase();
      const matchingBranches=queryBranches.filter(groups=>groups.every(group=>matchesQueryGroup(job,haystack,group)));
      if(queryBranches.length && !matchingBranches.length) continue;
      const queryGroups=matchingBranches.flat();
      const hits=queryGroups.filter(group=>matchesQueryGroup(job,haystack,group)).length;
      const titleHits=queryGroups.filter(group=>group.terms.some(term=>matchesTerm(job.title.toLowerCase(),term))).length;
      const substantiveText=(job.title+' '+withoutAlternativeLists(job.description)).toLowerCase();
      const titleMatch=!queryBranches.length || matchingBranches.some(groups=>{
        const hasNonTech=groups.some(group=>!TECH_STACK_TERMS.has(group.term));
        // Every group already passed the AND pool check, including tech
        // terms found only in alternatives lists. Tech-only titles stay strict.
        return groups.every(group=>hasNonTech && TECH_STACK_TERMS.has(group.term)
          || group.terms.some(term=>matchesTerm(job.title.toLowerCase(),term)));
      });
      const techHits=matchingBranches.filter(groups=>groups.some(group=>!TECH_STACK_TERMS.has(group.term))).flat()
        .filter(group=>TECH_STACK_TERMS.has(group.term) && group.terms.some(term=>matchesTerm(substantiveText,term))).length;
      const substantive=(substantiveText+' '+job.location+' '+job.company+' '+(job.rawCompany||'')).toLowerCase();
      const retrievalMatch=titleMatch?'title':matchingBranches.some(groups=>groups.every(group=>matchesQueryGroup(job,substantive,group)))?'description':'mention';
      // The same posting reaches us from several feeds (often http vs https);
      // keep its best copy. Rows that share one list-page URL keep their own id.
      matching.push({...job,largeCompany,retrievalMatch,retrievalHits:hits,retrievalTitleHits:titleHits,retrievalTechHits:techHits,retrievalTitleMatch:titleMatch,
        retrievalDomainPenalty:queryDomainPenalty(job,matchingBranches),retrievalStageTier:type==='campus'?campusStageTier(job):0});
    }
    const ranked=deduplicateJobs(matching,{now}).map(job=>profile || userStatements.length || educationFacts.length || exclude.length
      ? {...job,eligibility:evaluateJobEligibility(job,profile||{},{material,userStatements,educationFacts,type,region,exclude,now:new Date(now).toISOString()})}
      : job);
    // Check the matching pool before pagination. Candidate decisions stay in
    // this response, never in shared source rows. Unknowns remain available.
    // Role/stage/domain bands precede JD completeness. Known eligibility
    // failures still follow every non-rejected match.
    const priority=job=>(job.eligibility?.status==='rejected'?100000:0)
      +retrievalBand(job,type)*1000
      +(job.retrievalMatch==='mention'?100:0)
      +(isRecruitmentBatchForRanking(job)?60:0)
      +(job.fullDescriptionVerified?0:10)
      +(type && job.type!==type?5:0)
      +(job.eligibility?.status==='verify'?1:0);
    ranked.sort((a,b)=>priority(a)-priority(b)||(type?Number(b.type===type)-Number(a.type===type):0)||b.retrievalTitleHits-a.retrievalTitleHits||b.retrievalTechHits-a.retrievalTechHits||b.retrievalHits-a.retrievalHits||b.observedAt-a.observedAt);
    // Rotate companies within relevance bands and the same passed status.
    // JD quality offsets only order a company's own rows within each group.
    const tiers=new Map();
    for(const job of ranked) {
      const tier=[job.eligibility?.status==='rejected',retrievalBand(job,type),job.retrievalMatch==='mention',job.eligibility?.status==='passed'].join(':');
      if(!tiers.has(tier)) tiers.set(tier,new Map());
      const companies=tiers.get(tier);
      if(!companies.has(job.company)) companies.set(job.company,[]);
      companies.get(job.company).push(job);
    }
    const diverse=[];
    for(const companies of tiers.values()) {
      const count=[...companies.values()].reduce((sum,group)=>sum+group.length,0),start=diverse.length;
      for(let index=0;diverse.length-start<count;index++) for(const group of companies.values()) if(group[index]) diverse.push(group[index]);
    }
    const pageSize=Math.max(1,Math.min(100,Math.trunc(Number(limit)||20)));
    const start=Math.max(0,Math.trunc(Number(offset)||0));
    const jobs=diverse.slice(start,start+pageSize);
    // The source list is registry metadata merged with runtime state, so a
    // source that has never synced (or has no adapter yet) is still reported
    // instead of silently disappearing.
    const stateById=new Map(db.prepare('SELECT source_id AS id,last_attempt AS attemptedAt,last_success AS fetchedAt,error,count,(SELECT COUNT(*) FROM job_knowledge_records r WHERE r.source_id=s.source_id) AS historyCount FROM job_knowledge_sources s').all().map(row=>[row.id,row]));
    const sources=feeds.map(feed=>{
      const state=stateById.get(feed.id) || {};
      const adapterStatus=feed.adapter?.status || null;
      const syncStatus=state.error?'failed'
        :adapterStatus==='unadapted'?'unadapted'
        :state.fetchedAt?(state.count?'synced':'reachable')
        :'idle';
      return {
        id:feed.id,
        attemptedAt:state.attemptedAt ?? null,
        fetchedAt:state.fetchedAt ?? null,
        error:state.error ?? null,
        count:state.count ?? null,
        historyCount:state.historyCount ?? 0,
        company:feed.company,
        label:feed.label || feed.title || feed.company,
        group:feed.group,
        trust:feed.trust,
        sourceType:feed.sourceType || (feed.kind === 'official' ? 'official-company' : 'domestic-feed'),
        officialUrl:feed.officialUrl || feed.url,
        types:feed.types ? [...feed.types] : undefined,
        adapterKind:feed.adapter?.kind || null,
        adapterStatus,
        reason:feed.adapter?.reason || feed.note || '',
        syncStatus
      };
    });
    const titleMatches=ranked.filter(job=>job.retrievalMatch==='title').length;
    // descriptionOnly includes weak alternatives-list mentions as well.
    const summary={titleMatches,descriptionOnly:ranked.length-titleMatches,registered:sources.length,...sources.reduce((counts,source)=>{counts[source.syncStatus]=(counts[source.syncStatus]||0)+1;return counts;},{})};
    return {jobs,total:ranked.length,offset:start,hasMore:start+jobs.length<ranked.length,sources,summary,note:jobs.length?'已检索公开岗位资料；官方源只覆盖已适配接口的公司，开放状态及完整招聘要求以官方投递页为准。':'当前资料没有匹配结果，不能据此断言市场没有岗位。'};
  }

  // Fetches the employer's own JD for one selected job and stores it on the
  // record. status: verified | partial | unsupported | failed | already —
  // only "verified" means the full requirements were actually read.
  async function enrich(job,{signal}={}) {
    if(!job?.url) return {job,status:'unsupported'};
    if(job.fullDescriptionVerified) return {job,status:'already'};
    let detail;
    try {detail=await detailLoader(job,{signal});}
    catch(error) {signal?.throwIfAborted();return {job,status:'failed',error:String(error.message).slice(0,200)};}
    if(!detail) return {job,status:'unsupported'};
    const at=clock();
    const verified=detail.verified===true;
    const enriched={...job,description:text(detail.description)||job.description,requirements:verified?detail.requirements.map(value=>text(value,10000)).slice(0,30):(job.requirements||[]),
      fullDescriptionVerified:verified,officiallyVerifiedAt:verified?at:null,detailFetchedAt:at,detailUrl:text(detail.url,2000),detailProvider:text(detail.provider,50)};
    if(job.feedId) {
      const row=db.prepare('SELECT payload FROM job_knowledge_records WHERE source_id=? AND job_id=?').get(job.feedId,job.id);
      if(row) {
        const stored={...JSON.parse(row.payload),...Object.fromEntries(DETAIL_FIELDS.map(key=>[key,enriched[key]]))};
        db.prepare('UPDATE job_knowledge_records SET payload=? WHERE source_id=? AND job_id=?').run(JSON.stringify(stored),job.feedId,job.id);
        reindex(job.feedId,job.id,stored);
      }
    }
    // Platform text (e.g. ncss) is readable but is not the employer's own JD.
    return {job:enriched,status:verified?'verified':detail.aggregator?'aggregator':'partial'};
  }

  function cleanRecords({apply=false}={}) {
    const now=clock();
    const rows=db.prepare('SELECT source_id,job_id,payload,archived_at FROM job_knowledge_records').all();
    const report={apply,totalRecords:rows.length,changedRecords:0,quarantinedRecords:0,newlyQuarantinedRecords:0,expiredRecords:0,newlyExpiredRecords:0,reclassifiedRecords:0,jdEvidenceUpgrades:0,activeJdEvidenceUpgrades:0,activeSourceRecords:0,uniqueResults:0,duplicateCopies:0,companies:0,kinds:{},verifiedActiveRecords:0,oldPublicationWarnings:0};
    const visible=[];
    const backup=db.prepare('INSERT OR IGNORE INTO job_knowledge_cleaning_originals VALUES (?,?,?,?,?)');
    const update=db.prepare('UPDATE job_knowledge_records SET payload=?,archived_at=? WHERE source_id=? AND job_id=?');
    if(apply) db.exec('BEGIN IMMEDIATE');
    try {
      for(const row of rows) {
        const original=JSON.parse(row.payload),job=withCachedSections(original,now),payload=JSON.stringify(job);
        const archived=job.quarantineReason||job.expiryReason?(row.archived_at??now):row.archived_at;
        if(!original.quarantineReason && job.quarantineReason) report.newlyQuarantinedRecords++;
        if(row.archived_at===null && job.expiryReason) report.newlyExpiredRecords++;
        if(original.recordKind!==job.recordKind) report.reclassifiedRecords++;
        if(!original.fullDescriptionVerified && job.fullDescriptionVerified) report.jdEvidenceUpgrades++;
        if(payload!==row.payload || archived!==row.archived_at) {
          report.changedRecords++;
          if(apply) {
            backup.run(row.source_id,row.job_id,row.payload,row.archived_at,now);
            update.run(payload,archived,row.source_id,row.job_id);
            reindex(row.source_id,row.job_id,job);
          }
        }
        if(job.quarantineReason) report.quarantinedRecords++;
        if(job.expiryReason) report.expiredRecords++;
        if(archived===null && isActive(job,now) && !job.closed && !job.quarantineReason) {
          visible.push(job);report.kinds[job.recordKind]=(report.kinds[job.recordKind]||0)+1;
          if(job.fullDescriptionVerified) report.verifiedActiveRecords++;
          if(!original.fullDescriptionVerified && job.fullDescriptionVerified) report.activeJdEvidenceUpgrades++;
          if(job.freshnessWarnings.includes('old_publication_date')) report.oldPublicationWarnings++;
        }
      }
      const unique=deduplicateJobs(visible,{now});
      report.activeSourceRecords=visible.length;report.uniqueResults=unique.length;
      report.duplicateCopies=visible.length-unique.length;
      report.companies=new Set(unique.map(job=>job.company)).size;
      if(apply) {
        const count=db.prepare('SELECT COUNT(*) n FROM job_knowledge_records WHERE source_id=? AND archived_at IS NULL AND observed_at>=?');
        const updateSource=db.prepare('UPDATE job_knowledge_sources SET count=? WHERE source_id=?');
        for(const source of db.prepare('SELECT source_id FROM job_knowledge_sources').all()) updateSource.run(count.get(source.source_id,now-freshFor(source.source_id)).n,source.source_id);
        db.exec('COMMIT');
      }
      return report;
    } catch(error) {if(apply) db.exec('ROLLBACK');throw error;}
  }

  function start() {
    if(timer) return;
    controller=new AbortController();
    const tick=()=>{if(!working) sync({signal:controller.signal}).catch(e=>console.warn('[job-knowledge]',e.message));};
    tick();timer=setInterval(tick,60*1000);timer.unref();
  }
  async function stop(){clearInterval(timer);timer=null;controller?.abort();await working;}
  return {start,stop,sync,search,enrich,cleanup,cleanRecords};
}
