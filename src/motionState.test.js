import assert from 'node:assert/strict';
import { startRun, appendRunStatus, motionDuration, runTiming } from './motionState.js';

assert.equal(motionDuration('240ms'), 240);
assert.equal(motionDuration(' .24s '), 240);
assert.equal(motionDuration('0s'), 0);
assert.equal(motionDuration('invalid', 380), 380);

const run = startRun('c1', '正在分析资料', 1000);
assert.deepEqual(run.steps, [{ label: '正在分析资料', tool: undefined, at: 1000 }]);
assert.equal(run.startedAt, 1000);
const next = appendRunStatus(run, { label: '正在读取材料', tool: 'read_document' }, 2200);
assert.equal(next.startedAt, 1000);
assert.deepEqual(next.steps.map(step => step.label), ['正在分析资料', '正在读取材料']);
assert.equal(appendRunStatus(next, { label: '正在读取材料' }, 2400).steps.length, 2);
assert.equal(appendRunStatus(next, { label: '' }, 2500), next);
assert.equal(appendRunStatus(null, { label: 'late event' }, 2600), null);
assert.equal(appendRunStatus({ ...next, stopping: true }, { label: 'late event' }, 2600).label, next.label);
assert.equal(startRun('c2', '正在读取 resume.pdf', 3000).steps.length, 1);
assert.equal(run.steps.length, 1);
assert.deepEqual(runTiming(next, 3450), { total: '2.5', steps: ['1.2', '1.3'] });
assert.deepEqual(runTiming(next, 1500), { total: '0.5', steps: ['1.2', '0.0'] });
console.log('Motion run status tests passed');
