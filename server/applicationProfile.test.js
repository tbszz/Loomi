import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

await test('application profiles encrypt personal values and isolate scopes', async () => {
  const { createApplicationProfiles } = await import('./applicationProfile.js');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'application-profile-'));
  try {
    const store = createApplicationProfiles({ dataDir: dir });
    const scope = { userId: 'user-a', candidateId: 'candidate-a' };
    await store.write(scope, { name: '真实姓名', identityNumber: '110101199001011234', phone: '13800000000', expectedSalary: '面议', availableDate: '2026-11-01' });
    assert.equal((await store.read(scope)).identityNumber, '110101199001011234');
    assert.equal((await store.read({ ...scope, candidateId: 'candidate-b' })).identityNumber, undefined);
    const files = await readdir(path.join(dir, 'application-profiles'));
    for (const file of files.filter(name => name.endsWith('.json'))) {
      const text = await readFile(path.join(dir, 'application-profiles', file), 'utf8');
      assert.ok(!text.includes('真实姓名') && !text.includes('110101199001011234'));
    }
    const masked = await store.publicRead(scope);
    assert.equal(masked.identityNumber, undefined);
    assert.ok(masked.configuredFields.includes('identityNumber'));
    await assert.rejects(store.write(scope, { arbitrary: 'value' }));
    await assert.rejects(store.write(scope, { education: [{ school: '大学', invented: true }] }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

await test('portal declarations preserve explicit false and keep student identifiers private', async () => {
  const { createApplicationProfiles } = await import('./applicationProfile.js');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'application-profile-portal-'));
  try {
    const store = createApplicationProfiles({ dataDir: dir });
    const scope = { userId: 'a', candidateId: 'c' };
    await store.write(scope, { preferredRoleCategory: '研发类', preferredRoles: '前端工程师', acceptRoleAdjustment: false, referred: false, hasInternship: false, studentNumber: '20240001', nativePlace: '河南', degreeName: '工学学士' });
    assert.equal((await store.read(scope)).acceptRoleAdjustment, false);
    const publicProfile = await store.publicRead(scope);
    assert.equal(publicProfile.studentNumber, undefined);
    assert.equal(publicProfile.nativePlace, undefined);
    assert.equal(publicProfile.hasInternship, false);
    await assert.rejects(store.write(scope, { referred: 'false' }), /布尔/);
    await store.write(scope, { preferredRoles: ['前端工程师', '研发工程师'], languages: ['英语六级550+'], referred: null });
    assert.deepEqual((await store.read(scope)).preferredRoles, ['前端工程师', '研发工程师']);
    assert.equal((await store.read(scope)).referred, undefined);
    await assert.rejects(store.write(scope, { languages: ['英语', '英语'] }));
    await assert.rejects(store.write(scope, { languages: [''] }));
    await assert.rejects(store.write(scope, { name: ['张三'] }));
    await store.write(scope, { awards: [{ type: '竞赛', level: '省级', name: '一等奖', date: '2025-06' }], campusLeadership: [{ organization: '学生会', title: '干事', startDate: '2024-10', description: '组织活动' }] });
    assert.equal((await store.read(scope)).awards[0].name, '一等奖');
    await assert.rejects(store.write(scope, { awards: [{ proofDocumentId: 'unselected-file' }] }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
