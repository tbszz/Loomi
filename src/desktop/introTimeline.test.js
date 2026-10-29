import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INTRO_DURATION, INTRO_PHASES, phaseAt, shouldSkipIntro, introDuration, hasPlayedIntro, markIntroPlayed } from './introTimeline.js';

test('timeline has continuous exclusive boundaries and completes at 3300 ms', () => {
  assert.equal(INTRO_DURATION, 3300);
  assert.equal(INTRO_PHASES[0].start, 0);
  INTRO_PHASES.forEach((phase, i) => {
    assert.equal(phaseAt(phase.start), phase.name);
    assert.equal(phaseAt(phase.end - 1), phase.name);
    if (i) assert.equal(phase.start, INTRO_PHASES[i - 1].end);
  });
  assert.equal(phaseAt(-50), 'silk');
  assert.equal(phaseAt(3300), 'done');
  assert.equal(phaseAt(9000), 'done');
});

test('only deliberate click and supported keyboard gestures skip', () => {
  assert.equal(shouldSkipIntro({ type: 'click' }), true);
  for (const key of ['Escape', 'Enter', ' ']) assert.equal(shouldSkipIntro({ type: 'keydown', key }), true);
  for (const key of ['Tab', 'a', 'ArrowDown']) assert.equal(shouldSkipIntro({ type: 'keydown', key }), false);
  assert.equal(introDuration(true), 400);
  assert.equal(introDuration(false), INTRO_DURATION);
});

test('launch flag survives a remount and storage failures are harmless', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(hasPlayedIntro(storage), false);
  markIntroPlayed(storage);
  assert.equal(hasPlayedIntro(storage), true);
  const denied = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  assert.equal(hasPlayedIntro(denied), false);
  assert.doesNotThrow(() => markIntroPlayed(denied));
});
