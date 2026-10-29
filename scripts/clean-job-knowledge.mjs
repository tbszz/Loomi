// Operator command; never reads candidate records into a model or an output file.
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJobKnowledge } from '../server/jobKnowledge.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = process.env.RESUME_PROTOCOL_DATA_DIR || path.join(root, 'data');
const filename = path.join(dataDir, 'resume-protocol.sqlite');
if (!existsSync(filename)) throw new Error('Existing job database not found; no cleanup performed.');
const apply = process.argv.includes('--apply');
const db = new DatabaseSync(filename, { readOnly: !apply });
const folder = path.join(dataDir, 'job-audits');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
let service;
try {
  if (apply) {
    mkdirSync(folder, { recursive: true });
    const backupPath = path.join(folder, `before-cleanup-${stamp}.sqlite`);
    await backup(db, backupPath);
    service = createJobKnowledge(db);
    const report = service.cleanRecords({ apply: true });
    const reportPath = path.join(folder, `cleanup-${stamp}.json`);
    writeFileSync(reportPath, JSON.stringify({ ...report, backupPath, at: new Date().toISOString() }, null, 2) + '\n');
    console.log(JSON.stringify({ ...report, backupPath, reportPath }));
  } else {
    // Copy to memory so dry-run neither migrates nor writes to the real file.
    const temp = path.join(root, 'tmp', `job-cleanup-preview-${stamp}.sqlite`);
    mkdirSync(path.dirname(temp), { recursive: true });
    await backup(db, temp);
    const previewDb = new DatabaseSync(temp);
    try { service = createJobKnowledge(previewDb); console.log(JSON.stringify(service.cleanRecords())); }
    finally { previewDb.close(); }
  }
} finally { db.close(); }
