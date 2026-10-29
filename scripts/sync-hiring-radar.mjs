import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJobKnowledge } from '../server/jobKnowledge.js';
import { HIRING_RADAR_FEEDS } from '../server/hiringRadar.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const keys=process.argv.slice(2).filter(arg=>!arg.startsWith('--'));
const selected=keys.length?HIRING_RADAR_FEEDS.filter(feed=>keys.includes(feed.localKey)):HIRING_RADAR_FEEDS;
if(keys.some(key=>!selected.some(feed=>feed.localKey===key))) throw new Error('Unknown Hiring Radar company key.');
const dataDir=process.env.RESUME_PROTOCOL_DATA_DIR || path.join(root,'data');
mkdirSync(dataDir,{recursive:true});
const db=new DatabaseSync(path.join(dataDir,'resume-protocol.sqlite'));
db.exec('PRAGMA busy_timeout=5000');
const knowledge=createJobKnowledge(db);
const controller=new AbortController();
process.once('SIGINT',()=>controller.abort());
try {
  await knowledge.sync({force:process.argv.includes('--force'),signal:controller.signal,sourceIds:selected.map(feed=>feed.id)});
  const states=selected.map(feed=>({key:feed.localKey,company:feed.company,...db.prepare('SELECT last_attempt,last_success,error,count FROM job_knowledge_sources WHERE source_id=?').get(feed.id)}));
  const report={at:new Date().toISOString(),sources:states,succeeded:states.filter(s=>s.last_success && !s.error).length,failed:states.filter(s=>s.error).length,cleanup:knowledge.cleanRecords()};
  const folder=path.join(dataDir,'job-audits');mkdirSync(folder,{recursive:true});
  const filename=path.join(folder,`hiring-radar-sync-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
  writeFileSync(filename,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({at:report.at,attempted:states.length,succeeded:report.succeeded,failed:report.failed,
    sourcesWithPostings:states.filter(s=>s.last_success && !s.error && s.count>0).length,
    emptySources:states.filter(s=>s.last_success && !s.error && s.count===0).length,
    failures:states.filter(s=>s.error).map(s=>({key:s.key,error:s.error})),cleanup:report.cleanup,reportPath:filename}));
  if(report.failed || controller.signal.aborted) process.exitCode=1;
} finally {await knowledge.stop();db.close();}
