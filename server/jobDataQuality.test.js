import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { cleanJobRecord, deduplicateJobs } from './jobDataQuality.js';
import { createJobKnowledge } from './jobKnowledge.js';
import { isLargeCompany } from './companyScale.js';

const at = Date.parse('2026-10-27T10:00:00Z');
const job = (over = {}) => ({ id: 'a', feedId: 'one', company: '腾讯', title: '后端开发工程师', location: '深圳', type: 'social', url: 'https://careers.tencent.com/jobdesc.html?postId=123', source: 'domestic-feed', description: '负责后端系统开发。', observedAt: at, ...over });

test('company cleanup preserves originals and does not confuse 京东方 with 京东', () => {
  const cleaned = cleanJobRecord(job({ company: ' offerstar·腾讯 ' }));
  assert.equal(cleaned.company, '腾讯');
  assert.equal(cleaned.rawCompany, ' offerstar·腾讯 ');
  assert.deepEqual(cleanJobRecord(cleaned), cleaned);
  assert.equal(isLargeCompany('京东方科技集团股份有限公司'), false);
  assert.equal(isLargeCompany('京东集团'), true);
});

test('recruitment events are quarantined, batches remain explicit leads, real event-related roles survive', () => {
  assert.equal(cleanJobRecord(job({ company: '2026年秋季招聘会', title: '全国人才双选会' })).quarantineReason, 'recruitment_event');
  assert.equal(cleanJobRecord(job({ title: '2027届校园招聘' })).recordKind, 'recruitment_batch');
  assert.equal(cleanJobRecord(job({ title: '直播活动运营' })).recordKind, 'posting');
  assert.equal(cleanJobRecord(job({ title: '招聘专员' })).quarantineReason, null);
});

test('exact posting copies merge with all provenance and the verified copy wins', () => {
  const result = deduplicateJobs([
    job({ company: 'offerstar·腾讯', url: 'http://careers.tencent.com/jobdesc.html?postId=123&utm_source=x' }),
    job({ id: 'b', feedId: 'two', fullDescriptionVerified: true, source: 'official-career-site', description: '完整官方职责与任职要求' })
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'b');
  assert.equal(result[0].provenance.length, 2);
  assert.deepEqual(new Set(result[0].provenance.map(p => p.feedId)), new Set(['one', 'two']));
  assert.deepEqual(deduplicateJobs(result), result);
});

test('different cities, employment types, requisitions and shared list URLs are not guessed to be duplicates', () => {
  const rows = [job(), job({ id: 'b', url: 'https://careers.tencent.com/jobdesc.html?postId=456' }), job({ id: 'c', location: '北京', url: 'https://example.com/3' }), job({ id: 'd', type: 'internship', url: 'https://example.com/4' }), job({ id: 'e', sharedUrl: true, sourceJobId: '1', url: 'https://example.com/list' }), job({ id: 'f', sharedUrl: true, sourceJobId: '2', url: 'https://example.com/list' })];
  assert.equal(deduplicateJobs(rows).length, 6);
  assert.equal(deduplicateJobs([job(), job({ id: 'other-city', location: '北京' }), job({ id: 'other-type', type: 'internship' })]).length, 3);
});

test('an unknown employment type can merge into one uniquely identified copy without joining conflicting copies', () => {
  assert.equal(deduplicateJobs([job({ type: null }), job({ id: 'official' })]).length, 1);
  assert.equal(deduplicateJobs([job({ type: null }), job({ id: 'official' }), job({ id: 'intern', type: 'internship' })]).length, 3);
});

test('a generic portal URL repeated across feeds cannot merge different employers, titles or source requisitions', () => {
  const base=job({url:'https://example.com/careers',feedId:'first'});
  for(const over of [{company:'其他公司'},{title:'产品经理'},{sourceJobId:'second'}]) {
    const a={...base,sourceJobId:'first'};
    assert.equal(deduplicateJobs([a,{...a,id:'b',feedId:'second',...over}]).length,2);
  }
});

test('a known official posting URL identifies copies even if aggregators assign their own opaque row IDs', () => {
  const copies=[job({sourceJobId:'cn-tencent:abc'}),job({id:'official',feedId:'tencent',sourceJobId:'some-local-hash',source:'official-career-site'})];
  const merged=deduplicateJobs(copies);
  assert.equal(merged.length,1);
  assert.equal(merged[0].provenance.length,2);
});

test('cache cleanup is idempotent, backs up original rows and preserves candidate tables', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE candidate_facts(value TEXT); INSERT INTO candidate_facts VALUES ('untouched')");
  const feeds = [{ id: 'one' }, { id: 'two' }];
  const row = { company: 'offerstar·腾讯', title: '后端开发工程师', location: '深圳', job_type: 'social', url: 'https://example.com/job/1', jd_text: '真实职责', last_seen: new Date(at).toISOString() };
  const service = createJobKnowledge(db, { clock: () => at, feeds, loader: async feed => feed.id === 'one' ? [row, { ...row, company: '人才招聘会', title: '校园双选会', url: 'https://example.com/event' }] : [row] });
  await service.sync();
  // Simulate a cache written before the cleaning rules existed.
  for (const r of db.prepare('SELECT rowid,payload FROM job_knowledge_records').all()) {
    const data = JSON.parse(r.payload);
    delete data.dataQualityVersion; delete data.rawCompany; delete data.recordKind; delete data.quarantineReason;
    data.company = data.title.includes('双选会') ? '人才招聘会' : 'offerstar·腾讯';
    db.prepare('UPDATE job_knowledge_records SET payload=? WHERE rowid=?').run(JSON.stringify(data), r.rowid);
  }
  const preview = service.cleanRecords();
  assert.ok(preview.changedRecords > 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM job_knowledge_cleaning_originals').get().n, 0);
  const applied = service.cleanRecords({ apply: true });
  assert.equal(applied.changedRecords, preview.changedRecords);
  assert.equal(service.cleanRecords({ apply: true }).changedRecords, 0);
  assert.equal(db.prepare('SELECT value FROM candidate_facts').get().value, 'untouched');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM job_knowledge_records').get().n, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM job_knowledge_cleaning_originals').get().n, 3);
  const found = await service.search({ query: '后端' });
  assert.equal(found.total, 1);
  assert.equal(found.jobs[0].company, '腾讯');
  assert.equal(found.jobs[0].provenance.length, 2);
  assert.equal((await service.search({})).jobs.some(j => j.quarantineReason), false);
  db.close();
});

test('a background collection does not block searches of an existing fresh cache', async () => {
  const db = new DatabaseSync(':memory:');
  let release, block = false;
  const row = { company: '腾讯', title: '后端开发', url: 'https://example.com/one', last_seen: new Date(at).toISOString() };
  const service = createJobKnowledge(db, { clock: () => at, feeds: [{ id: 'one' }], loader: () => block ? new Promise(resolve => { release = () => resolve([row]); }) : Promise.resolve([row]) });
  await service.sync(); block = true;
  const collecting = service.sync({ force: true });
  try {
    const result = await Promise.race([service.search({ query: '后端' }), new Promise((_, reject) => setTimeout(() => reject(new Error('search blocked by background collection')), 100))]);
    assert.equal(result.jobs.length, 1);
  } finally { release(); await collecting; db.close(); }
});

test('cache-only operator queries never start a collection', async () => {
  const db = new DatabaseSync(':memory:');
  let calls=0;
  const service=createJobKnowledge(db,{feeds:[{id:'one'}],loader:async()=>{calls++;throw new Error('must not fetch');}});
  assert.equal((await service.search({cacheOnly:true})).total,0);
  assert.equal(calls,0);
  db.close();
});

test('cleanup preserves searchability using a source company alias', async () => {
  const db=new DatabaseSync(':memory:');
  const service=createJobKnowledge(db,{clock:()=>at,feeds:[{id:'one'}],loader:async()=>[{company:'Tencent',title:'Backend Engineer',url:'https://example.com/jobs/one',last_seen:new Date(at).toISOString()}]});
  await service.sync();
  assert.equal((await service.search({query:'Tencent',cacheOnly:true})).total,1);
  assert.equal((await service.search({query:'腾讯',cacheOnly:true})).total,1);
  db.close();
});
