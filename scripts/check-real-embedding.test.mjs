import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-real-embedding.mjs', import.meta.url));
async function entry() {
  const module = await import('./check-real-embedding.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
  assert.equal(typeof module.runEmbeddingAcceptance, 'function', 'embedding acceptance entrypoint is missing');
  return module.runEmbeddingAcceptance;
}

// This provider proves the runner contract only, not trained-model quality.
function controlledProvider(vectorFor = text => {
  if (/React|交互式|browser interface/.test(text)) return [1, 0, 0, 0];
  if (/SQLite|关系存储|relational persistence/.test(text)) return [0, 1, 0, 0];
  if (/公众号|读者增长|audience outreach/.test(text)) return [0, 0, 1, 0];
  return [0, 0, 0, 1];
}) {
  return { id: 'contract-fixture', async embed({ texts }) { return texts.map(vectorFor); } };
}

await test('fixture contract: genuine SQLite retrieval, restart cache, provenance and scoped revocation pass', async () => {
  const run = await entry();
  const report = await run({ embeddingProvider: controlledProvider() });
  assert.equal(report.status, 'passed');
  assert.equal(report.cases.length, 6);
  assert.match(report.providerNamespaceHash, /^[a-f0-9]{64}$/);
  for (const item of report.cases) {
    assert.equal(item.semanticFactRank, 1);
    assert.equal(item.semanticPassageRank, 1);
    assert.equal(item.unifiedFactRank, 1);
    assert.equal(item.unifiedPassageRank, 1);
    assert.equal(item.lexicalTargetHits, 0);
    assert.ok(Number.isFinite(item.score) && item.margin >= 0.03);
    assert.ok(Number.isFinite(item.passageScore) && item.passageMargin >= 0.03);
    assert.ok(Number.isFinite(item.latencyMs) && item.latencyMs >= 0);
  }
  assert.equal(report.scope.unauthorizedProviderCalls, 0);
  assert.equal(report.scope.foreignDocumentTexts, 0);
  assert.equal(report.cache.documentTextsBeforeRestart, 8);
  assert.equal(report.cache.documentTextsAfterRestart, 0);
  assert.equal(report.cache.queryCallsAfterRestart, 2);
  assert.equal(report.cache.persistedRows, 8);
  assert.equal(report.revocation.staleEvidence, 0);
  assert.equal(report.revocation.staleCacheRows, 0);
  assert.equal(report.revocation.remainingCacheRows, 6);
});

await test('fixture contract: identical vectors cannot pass stable-sort ties as semantic quality', async () => {
  const run = await entry();
  const report = await run({ embeddingProvider: controlledProvider(() => [1, 1]) });
  assert.equal(report.status, 'failed');
  assert.ok(report.cases.some(item => item.margin === 0));
  assert.ok(report.failures.includes('semantic_quality'));
});

await test('fixture contract: good fact vectors cannot hide degenerate passage-vector ties', async () => {
  const run = await entry();
  const normal = controlledProvider();
  const provider = { id: 'passage-tie-fixture', async embed(input) {
    const vectors = await normal.embed(input);
    return input.purpose === 'document' ? vectors.map((vector, index) => index < 4 ? vector : [1, 1, 1, 1]) : vectors;
  } };
  const report = await run({ embeddingProvider: provider });
  assert.equal(report.status, 'failed');
  assert.ok(report.cases.some(item => item.passageMargin === 0));
  assert.ok(report.failures.includes('semantic_quality'));
});

await test('fixture contract: unavailable or malformed vectors fail without exposing provider messages', async () => {
  const run = await entry();
  for (const provider of [
    { id: 'fixture', async embed() { throw new Error('secret-token private-material'); } },
    controlledProvider(() => [NaN, 1])
  ]) {
    const report = await run({ embeddingProvider: provider });
    assert.equal(report.status, 'failed');
    assert.ok(report.failures.includes('embedding_unavailable'));
    assert.doesNotMatch(JSON.stringify(report), /secret-token|private-material|NaN/);
  }
  assert.equal((await run({ embeddingProvider: null })).status, 'unconfigured');
});

await test('CLI fails closed without configuration and does not load the working-directory .env', async () => {
  await entry();
  const directory = mkdtempSync(path.join(os.tmpdir(), 'resume-embedding-cli-'));
  try {
    writeFileSync(path.join(directory, '.env'), 'RESUME_EMBEDDING_MODEL=must-not-load\n');
    const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: os.tmpdir() };
    const missing = spawnSync(process.execPath, [script], { cwd: directory, env, encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.equal(JSON.parse(missing.stdout).status, 'unconfigured');
    const invalid = spawnSync(process.execPath, [script], { cwd: directory, env: { ...env, RESUME_EMBEDDING_MODEL: 'fixture', RESUME_EMBEDDING_BASE_URL: 'https://private-token.example/' }, encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.equal(JSON.parse(invalid.stdout).status, 'invalid_configuration');
    assert.doesNotMatch(invalid.stdout + invalid.stderr, /private-token/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

await test('startup and configured acceptance explicitly load only the dedicated embedding env file', async () => {
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.scripts.server, 'node --env-file-if-exists=.env.embedding server/index.js');
  assert.equal(manifest.scripts.app, 'npm run build && npm run server');
  assert.equal(manifest.scripts['test:configured-embedding'], 'node --env-file=.env.embedding scripts/check-real-embedding.mjs');
  const directory = mkdtempSync(path.join(os.tmpdir(), 'resume-explicit-embedding-env-'));
  try {
    // Wrong provider configuration must be consumed and rejected before any
    // network call, rather than appearing unconfigured or reading .env.
    writeFileSync(path.join(directory, '.env.embedding'), 'RESUME_EMBEDDING_MODEL=fixture\nRESUME_EMBEDDING_BASE_URL=https://invalid.example/\n');
    const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: os.tmpdir() };
    const result = spawnSync(process.execPath, ['--env-file=.env.embedding', script], { cwd: directory, env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).status, 'invalid_configuration');
    assert.doesNotMatch(result.stdout + result.stderr, /invalid\.example/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
