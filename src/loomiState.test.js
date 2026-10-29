import assert from 'node:assert/strict';
import { LOOMI_DONE_MS, LOOMI_TRAVEL_MS, loomiMood, loomiPlan, settleMood } from './loomiState.js';

const run = { label: '正在分析资料' };
assert.equal(loomiMood({ pending: run, typing: true }), 'work');
assert.equal(loomiMood({ pending: { ...run, stopping: true } }), 'idle');
assert.equal(loomiMood({ typing: true }), 'typing');
assert.equal(loomiMood({}), 'idle');
assert.equal(loomiMood({ lastMessage: { kind: 'error' } }), 'attn');
assert.equal(loomiMood({ lastMessage: { kind: 'text', tone: 'warning' } }), 'attn');
assert.equal(loomiMood({ lastMessage: { kind: 'error' }, typing: true }), 'typing');
assert.equal(loomiMood({ pending: run, lastMessage: { kind: 'error' } }), 'work');

// A failed or stopped run must never look like success.
assert.equal(settleMood('work', 'idle'), 'done');
assert.equal(settleMood('work', 'typing'), 'done');
assert.equal(settleMood('work', 'attn'), 'attn');
assert.equal(settleMood('idle', 'idle'), 'idle');
assert.equal(settleMood('typing', 'idle'), 'idle');

assert.deepEqual(loomiPlan('work', false).map(step => [step.phase, step.hang]), [['crouch', false], ['shoot', false], ['travel', true], ['hang', true]]);
assert.deepEqual(loomiPlan('work', true), [{ phase: 'hang', hang: true, at: 0 }]);
assert.deepEqual(loomiPlan('idle', false), [{ phase: 'idle', hang: false, at: 0 }]);
assert.deepEqual(loomiPlan('attn', true), [{ phase: 'travel', hang: false, at: 0 }, { phase: 'attn', hang: false, at: LOOMI_TRAVEL_MS }]);
const done = loomiPlan('done', true);
assert.deepEqual(done[0], { phase: 'done', hang: true, at: 0 });
assert.deepEqual(done.at(-1), { phase: 'idle', hang: false, at: LOOMI_DONE_MS + LOOMI_TRAVEL_MS });
for (const mood of ['idle', 'typing', 'work', 'done', 'attn']) {
  for (const atHang of [true, false]) {
    const plan = loomiPlan(mood, atHang);
    assert.ok(plan.every((step, index) => index === 0 || step.at >= plan[index - 1].at), `${mood} plan is ordered`);
  }
}
console.log('loomiState tests passed');
