import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HIRING_RADAR_FEEDS, mapHiringRadarRows, loadHiringRadarFeed, HIRING_RADAR_REVISION } from './hiringRadar.js';
import { JOB_FEEDS } from './jobKnowledge.js';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createJobKnowledge } from './jobKnowledge.js';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hiringRadarRoot } from './hiringRadar.js';
import path from 'node:path';

test('Hiring Radar domestic employer feeds enter the existing registry with pinned provenance', () => {
  assert.ok(HIRING_RADAR_FEEDS.length > 20);
  assert.match(HIRING_RADAR_REVISION, /^[a-f0-9]{40}$/);
  assert.equal(new Set(HIRING_RADAR_FEEDS.map(f => f.id)).size, HIRING_RADAR_FEEDS.length);
  assert.ok(HIRING_RADAR_FEEDS.every(f => JOB_FEEDS.some(j => j.id === f.id)));
});

test('runtime fingerprints are independent of Git checkout line endings', {skip:!existsSync(path.join(hiringRadarRoot(),'radar','http.py'))}, () => {
  const manifest=JSON.parse(readFileSync(new URL('./hiringRadarSources.json',import.meta.url),'utf8'));
  for(const [relative,expected] of Object.entries(manifest.runtimeFiles)) {
    const content=readFileSync(path.join(hiringRadarRoot(),relative),'utf8').replace(/\r\n/g,'\n');
    assert.equal(createHash('sha256').update(content).digest('hex'),expected,relative);
  }
});

test('adapter maps real upstream schema, fresh observation and official sections without inferring a cohort', () => {
  const feed = HIRING_RADAR_FEEDS.find(f => f.localKey === 'moonshot');
  const rows = mapHiringRadarRows([{ id: '123', company: feed.company, title: '后端工程师', location: '北京', type: '全职', jd: '工作职责：负责后端系统设计、开发与维护。任职要求：熟悉 Python。', url: `${feed.url}/position/123/detail`, requirements: ['熟悉 Python'], verifiedSections: true }], feed, Date.parse('2026-10-27T00:00:00Z'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].job_id, '123');
  assert.equal(rows[0].last_seen, '2026-10-27T00:00:00.000Z');
  assert.equal(rows[0].job_type, 'social');
  assert.equal(rows[0].full_description_verified, true);
  assert.equal(rows[0].source_revision, HIRING_RADAR_REVISION);
  assert.equal(mapHiringRadarRows([{ id: 'x', title: '工程师', url: 'https://evil.example/jobs' }], feed).length, 0);
});

test('partial, invalid and failed collections cannot appear as successful syncs', async () => {
  const feed = HIRING_RADAR_FEEDS[0];
  await assert.rejects(loadHiringRadarFeed(feed, { runner: async () => ({ complete: false, jobs: [], source: feed.localKey }) }), /incomplete/);
  await assert.rejects(loadHiringRadarFeed(feed, { runner: async () => ({ complete: true, jobs: [], source: 'wrong' }) }), /invalid/);
  await assert.rejects(loadHiringRadarFeed(feed, { runner: async () => { throw new Error('source_failed'); } }), /source_failed/);
  assert.deepEqual(await loadHiringRadarFeed(feed, { runner: async () => ({ complete: true, jobs: [], source: feed.localKey, revision: HIRING_RADAR_REVISION }) }), []);
});

test('pinned Python bridge checks the upstream parser against offline response fixtures', () => {
  const result = spawnSync(process.env.RESUME_PROTOCOL_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-I', 'scripts/test-hiring-radar-bridge.py'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});

test('a failed Hiring Radar walk is reported as failed by the unified service and cannot erase prior postings', async () => {
  const db=new DatabaseSync(':memory:');
  let fail=false;
  const feed=HIRING_RADAR_FEEDS.find(f=>f.localKey==='moonshot');
  const now=Date.parse('2026-10-27T00:00:00Z');
  const service=createJobKnowledge(db,{clock:()=>now,feeds:[feed],loader:(source,options)=>loadHiringRadarFeed(source,{...options,runner:async()=>{
    if(fail) throw new Error('incomplete_page_budget');
    return {complete:true,source:feed.localKey,revision:HIRING_RADAR_REVISION,jobs:[{id:'1',title:'后端工程师',url:`${feed.url}/index/position/1/detail`,location:'北京'}]};
  }})});
  await service.sync();fail=true;await service.sync({force:true});
  const result=await service.search({cacheOnly:true,query:'后端'});
  assert.equal(result.jobs.length,1);
  assert.equal(result.sources[0].syncStatus,'failed');
  assert.match(result.sources[0].error,/incomplete_page_budget/);
  assert.equal(result.jobs[0].fullDescriptionVerified,false);
  db.close();
});
