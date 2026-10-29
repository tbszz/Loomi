import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardMode, visibleCards, activateCard, closeCard, defaultLayout, validateLayout, columnWidth, stackSplit, clampFrame, readLayout, writeLayout, contextCards } from './cardLayout.js';

test('breakpoints, ordered stacking and least recently used tabs', () => {
  assert.deepEqual([1199, 1200, 1439, 1440].map(cardMode), ['overlay', 'single', 'single', 'stack']);
  let state = defaultLayout();
  for (const id of ['documents', 'apply']) state = activateCard(state, id);
  assert.deepEqual(visibleCards(state, 1440), ['documents', 'apply']);
  assert.deepEqual(visibleCards(state, 1280), ['apply']);
  state = activateCard(state, 'documents');
  state = activateCard(state, 'sidechat');
  assert.deepEqual(visibleCards(state, 1440), ['documents', 'sidechat']);
  assert.deepEqual(state.open, ['documents', 'apply', 'sidechat']);
  assert.deepEqual(visibleCards(state, 1440, 480), ['sidechat']);
});
test('width preserves at least 480px for main chat', () => {
  assert.equal(columnWidth(640, 1200, 248), 440);
  assert.equal(columnWidth(100, 1920, 248), 360);
  assert.equal(columnWidth(900, 1920, 248), 640);
});
test('corrupt layout and offscreen persisted frames recover safely', () => {
  assert.deepEqual(validateLayout(null), defaultLayout());
  const state = validateLayout({ open: ['documents', 'evil', 'documents'], recent: [], width: -8, split: Infinity, popped: { documents: { x: -800, y: 20, width: 400, height: 300 } } });
  assert.deepEqual(state.open, ['documents']);
  assert.equal(state.width, 448);
  assert.equal(state.split, .6);
  assert.deepEqual(state.popped, {});
  const safe = clampFrame({ x: 3000, y: -9, width: 800, height: 900 }, { width: 960, top: 82, bottom: 440 });
  assert.ok(safe.x >= 12 && safe.x + safe.width <= 948);
  assert.ok(safe.y >= 82 && safe.y + safe.height <= 440);
});
test('storage is user scoped and tolerates malformed/unavailable storage', () => {
  const map = new Map();
  const storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) };
  const state = activateCard(defaultLayout(), 'apply');
  writeLayout(storage, 'a', state);
  assert.deepEqual(readLayout(storage, 'a'), state);
  assert.deepEqual(readLayout(storage, 'b'), defaultLayout());
  map.set('loomi.cards.a', '{broken');
  assert.deepEqual(readLayout(storage, 'a'), defaultLayout());
  assert.doesNotThrow(() => writeLayout({ setItem() { throw Error('denied'); } }, 'a', state));
  writeLayout(storage, 'a', { ...state, popped: { apply: { x: 900, y: 80, width: 400, height: 300 } } });
  assert.deepEqual(readLayout(storage, 'a', { width: 960, height: 640 }).popped, {});
});
test('context notifications reflect actual new artifacts/applying state', () => {
  assert.deepEqual(contextCards({}, { variantId: 'v' }), ['documents']);
  assert.deepEqual(contextCards({ variantId: 'v' }, { variantId: 'v' }), []);
  assert.deepEqual(contextCards({}, { selectedJob: { id: 'j' } }), []);
  assert.deepEqual(contextCards({}, { selectedJob: { id: 'j' }, application: { status: 'ready' } }), ['apply']);
  assert.deepEqual(contextCards({ export: { variantId: 'v' } }, { export: { variantId: 'v' } }), []);
});
test('popped cards do not consume dock slots; closing cleans geometry and recency', () => {
  let state = defaultLayout();
  for (const id of ['documents', 'apply', 'sidechat']) state = activateCard(state, id);
  state.popped.sidechat = { x: 12, y: 80, width: 400, height: 300 };
  assert.deepEqual(visibleCards(state, 1440), ['documents', 'apply']);
  const closed = closeCard(state, 'sidechat');
  assert.deepEqual(closed.popped, {});
  assert.deepEqual(closed.recent, ['documents', 'apply']);
  assert.equal(stackSplit(.1, 500), .4);
  assert.equal(stackSplit(.9, 500), .6);
});
