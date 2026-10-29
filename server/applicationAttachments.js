import path from 'node:path';
import { open, realpath } from 'node:fs/promises';
import { realpathSync, statSync } from 'node:fs';

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = { '.txt': 'text/plain', '.md': 'text/markdown', '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const snapshot = doc => JSON.stringify([doc.id, doc.candidateId, doc.conversationId, doc.name, doc.mimeType]);
const fileSnapshot = stat => JSON.stringify([stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]);

export function listApplicationAttachments(database, scope) {
  return (database.listDocuments?.(scope.userId) || []).filter(doc => doc.candidateId === scope.candidateId && safeId(doc.id) && TYPES[path.extname(String(doc.name)).toLowerCase()])
    .map(({ id, name }) => ({ id, name: safeName(name), mimeType: TYPES[path.extname(String(name)).toLowerCase()] }));
}

// Selections are explicit per scanned control. Neither the Agent nor JEV chooses
// a file, and no caller-supplied path/buffer is accepted by the application API.
export async function prepareApplicationAttachments({ database, dataDir, scope, fields, selections, signal }) {
  if (!Array.isArray(selections) || selections.length > 8) throw new Error('网申附件选择无效。');
  const documents = database.listDocuments?.(scope.userId) || [];
  const seen = new Set(), plans = [];
  for (const selection of selections) {
    if (!selection || Object.keys(selection).some(key => !['fieldId', 'documentId'].includes(key)) || typeof selection.fieldId !== 'string' || !safeId(selection.documentId) || seen.has(selection.fieldId)) throw new Error('网申附件选择无效。');
    const field = fields.find(item => item.id === selection.fieldId);
    const document = documents.find(doc => doc.id === selection.documentId && doc.candidateId === scope.candidateId);
    if (!field || field.type !== 'file' || field.unsupported || !document || !TYPES[path.extname(String(document.name)).toLowerCase()]) throw new Error('网申附件不属于当前求职者或当前上传字段。');
    seen.add(field.id); plans.push({ field, document });
  }
  const answers = [], skipped = [], loaded = new Map();
  let totalBytes = 0;
  for (const { field, document } of plans) {
    signal?.throwIfAborted();
    if (field.occupied) { skipped.push({ fieldId: field.id, status: 'preserved' }); continue; }
    const name = safeName(document.name), mimeType = TYPES[path.extname(name).toLowerCase()];
    if (!acceptsApplicationAttachment(field.accept, name, mimeType)) { skipped.push({ fieldId: field.id, status: 'attachment_mismatch' }); continue; }
    let material = loaded.get(document.id);
    if (!material) {
      if (!safeId(scope.userId)) throw new Error('网申附件来源无效。');
      try {
        const root = await realpath(dataDir);
        const filename = path.join(root, 'uploads', scope.userId, document.id);
        if (await realpath(filename) !== filename) throw new Error();
        const file = await open(filename, 'r');
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES || totalBytes + stat.size > MAX_BYTES) throw new Error();
          // Read a bounded snapshot; a concurrently growing file cannot make
          // readFile() allocate an unbounded buffer before the size recheck.
          const buffer = Buffer.alloc(stat.size);
          let offset = 0;
          while (offset < buffer.length) {
            signal?.throwIfAborted();
            const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
            if (!bytesRead) throw new Error();
            offset += bytesRead;
          }
          if (fileSnapshot(await file.stat()) !== fileSnapshot(stat) || await realpath(filename) !== filename) throw new Error();
          material = { filename, stamp: fileSnapshot(stat), buffer };
          loaded.set(document.id, material); totalBytes += stat.size;
        } finally { await file.close(); }
      } catch {
        signal?.throwIfAborted();
        throw new Error('网申附件无法读取、已变化或超过8MB限制。');
      }
    }
    if (Number.isSafeInteger(field.maxFileBytes) && field.maxFileBytes > 0 && material.buffer.length > field.maxFileBytes) { skipped.push({ fieldId: field.id, status: 'attachment_too_large' }); continue; }
    answers.push({ fieldId: field.id, source: 'selected_attachment', documentId: document.id, documentSnapshot: snapshot(document), attachment: { name, mimeType, buffer: material.buffer } });
  }
  const validateAnswer = answer => {
    const doc = (database.listDocuments?.(scope.userId) || []).find(item => item.id === answer.documentId && item.candidateId === scope.candidateId);
    const material = loaded.get(answer.documentId);
    if (!doc || !material || snapshot(doc) !== answer.documentSnapshot) return false;
    try { return realpathSync(material.filename) === material.filename && fileSnapshot(statSync(material.filename)) === material.stamp; } catch { return false; }
  };
  return { answers, skipped, validateAnswer };
}

export function acceptsApplicationAttachment(accept, name, mimeType) {
  if (!accept) return true;
  return String(accept).split(',').some(item => {
    const token = item.trim().toLowerCase();
    return token.startsWith('.') ? path.extname(name).toLowerCase() === token : token.endsWith('/*') ? mimeType.startsWith(token.slice(0, -1)) : token === mimeType;
  });
}

function safeName(name) { return path.posix.basename(path.win32.basename(String(name))).replace(/[\x00-\x1f\x7f]/g, '_').slice(-240); }
