// Operator-only recovery/bootstrap entry point. Not exposed through the website.
import {createDatabase} from '../server/database.js';
import {createJobKnowledge} from '../server/jobKnowledge.js';
try {process.loadEnvFile('.env');} catch(error) {if(error.code!=='ENOENT') throw error;}
const database=createDatabase();
const knowledge=createJobKnowledge(database.raw);
try {
  await knowledge.sync({force:process.argv.includes('--force')});
  console.log(database.raw.prepare('SELECT source_id,last_success,error,count FROM job_knowledge_sources').all());
} finally {await knowledge.stop();database.close();}
