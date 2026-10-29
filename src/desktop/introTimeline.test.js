import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INTRO_DURATION, INTRO_PHASES, phaseAt, shouldSkipIntro, introDuration, hasPlayedIntro, markIntroPlayed } from './introTimeline.js';
import * as timeline from './introTimeline.js';

const layout = { width: 1280, height: 800, card: { left: 440, top: 260, width: 400, height: 330 }, rest: { x: 640, y: 205, width: 88 } };
const frame = (time, geometry = layout) => {
  assert.equal(typeof timeline.introFrame, 'function', 'pure introFrame is exported');
  return timeline.introFrame(time, geometry);
};

test('timeline has continuous exclusive boundaries and completes at 7100 ms', () => {
  assert.equal(INTRO_DURATION, 7100);
  assert.equal(INTRO_PHASES[0].start, 0);
  INTRO_PHASES.forEach((phase, i) => {
    assert.equal(phaseAt(phase.start), phase.name);
    assert.equal(phaseAt(phase.end - 1), phase.name);
    if (i) assert.equal(phase.start, INTRO_PHASES[i - 1].end);
  });
  assert.equal(phaseAt(-50), 'peek');
  assert.equal(phaseAt(7100), 'done');
  assert.equal(phaseAt(9000), 'done');
});

test('every 8ms and phase boundary stays continuous, including blink/pull-back and roll/silk', () => {
  const layouts = [layout,
    { width: 390, height: 844, card: { left: 24, top: 200, width: 342, height: 462 }, rest: { x: 288, y: 185, width: 88 } },
    { width: 1920, height: 1080, card: { left: 740, top: 310, width: 440, height: 462 }, rest: { x: 1092, y: 295, width: 88 } },
  ];
  for (const geometry of layouts) {
    const borderStep = timeline.borderGeometry(geometry.card).length * 3 / 1800 * 8;
    const samples = new Set([0, INTRO_DURATION]);
    for (let time = 0; time <= INTRO_DURATION; time += 8) samples.add(time);
    for (const time of [200, 290, 500, ...INTRO_PHASES.map(phase => phase.end)]) {
      samples.add(Math.max(0, time - .001)); samples.add(time);
    }
    let previous;
    for (const time of [...samples].sort((a, b) => a - b)) {
      const current = frame(time, geometry);
      if (previous) {
        const { value: before, time: priorTime } = previous;
        const step = Math.max(.001, time - priorTime) / 8;
        // The 450ms cubic climb peaks at 3 * travel / 450 px/ms.
        // Bound it by the actual climb distance, including tall narrow windows.
        const climbStep = Math.abs(geometry.height - 88 * Math.min(geometry.width / 1280, geometry.height / 800) - geometry.card.top) * 3 / 450 * 8;
        for (const [key, bound] of [['x', Math.max(geometry.width * .025, borderStep)], ['y', Math.max(geometry.height * .035, climbStep, borderStep)], ['scale', .5], ['tuck', .15], ['squash', .08]]) {
          assert(Math.abs(current.loomi[key] - before.loomi[key]) <= bound * step + 1e-7, `${key} jumps at ${time}ms`);
        }
        const angle = ((current.loomi.rotation - before.loomi.rotation + 540) % 360) - 180;
        assert(Math.abs(angle) <= 16 * step + 1e-7, `rotation jumps at ${time}ms`);
        for (const [key, bound] of [['scale', .04], ['x', Math.max(geometry.width * .06, 1.6 * borderStep)], ['y', Math.max(geometry.height * .06, 1.6 * climbStep, 1.6 * borderStep)]]) {
          assert(Math.abs(current.camera[key] - before.camera[key]) <= bound * step + 1e-7, `camera ${key} jumps at ${time}ms`);
        }
      }
      previous = { time, value: current };
    }
  }
});

test('peek has exactly one blink; pull-back starts moving immediately and lands before rolling', () => {
  assert.equal(frame(0).loomi.scale, 16);
  assert.equal(frame(240).loomi.blink, true);
  assert.equal(frame(300).loomi.blink, false);
  let blinks = 0, wasBlinking = false;
  for (let time = 0; time <= INTRO_DURATION; time += 8) {
    const blinking = frame(time).loomi.blink;
    if (blinking && !wasBlinking) blinks++;
    wasBlinking = blinking;
  }
  assert.equal(blinks, 1);
  assert(frame(508).loomi.x < frame(500).loomi.x - 10);
  assert.equal(frame(1550).loomi.rotation, 0);
  assert.equal(frame(2750).loomi.rotation, 720);
  assert.equal(frame(2750).loomi.tuck, 0);
  assert.equal(Math.abs(frame(2750).loomi.squash), 0);
  assert.equal(frame(2750).loomi.rotation % 360, 0);
  assert.equal(frame(3400).loomi.rotation % 360, 0);
});

test('border closes on the measured rounded card and Loomi follows its progressively drawn outline', () => {
  assert.equal(typeof timeline.borderGeometry, 'function');
  const border = timeline.borderGeometry(layout.card);
  assert.deepEqual(border.points[0], { x: 460, y: 260, distance: 0 });
  assert.equal(border.points.at(-1).x, 460);
  assert.equal(border.points.at(-1).y, 260);
  assert(border.path.endsWith('Z'));
  for (const point of border.points) {
    assert(point.x >= 440 && point.x <= 840 && point.y >= 260 && point.y <= 590);
    assert(point.x <= 460 || point.x >= 820 || point.y <= 280 || point.y >= 570, 'no silk through inner fields');
  }
  assert.equal(frame(3400).border.progress, 0);
  assert.equal(frame(5200).border.progress, 1);
  assert.equal(frame(5200).loomi.x, 460);
  assert.equal(frame(5200).loomi.y, 260);
});

test('camera uses the continuous zoom curve, stays within the viewport and resets before revealing the real card', () => {
  for (let time = 0; time <= INTRO_DURATION; time += 8) {
    const current = frame(time);
    assert(current.camera.scale >= 1 && current.camera.scale <= 1.6);
    assert(current.camera.x <= 1e-8 && current.camera.y <= 1e-8);
    assert(current.camera.x + layout.width * current.camera.scale >= layout.width - 1e-8);
    assert(current.camera.y + layout.height * current.camera.scale >= layout.height - 1e-8);
    if (current.reveal.background > 0) assert.equal(current.camera.scale, 1);
  }
  assert.equal(frame(5600).camera.scale, 1);
  const final = frame(INTRO_DURATION);
  assert.deepEqual({ x: final.loomi.x, y: final.loomi.y }, { x: layout.rest.x, y: layout.rest.y });
  assert(Math.abs(final.loomi.scale * 76.8 - layout.rest.width) < 1e-10);
  assert.equal(final.loomi.mood, 'hello');
  assert.equal(final.reveal.button, 1);
  assert(final.web.progress.every(value => value === 1));
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
