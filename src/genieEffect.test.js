import assert from 'node:assert/strict';
import * as genie from './genieEffect.js';

const { genieSlice } = genie;
const W = { left: 100, top: 80, width: 560, height: 660 };
const N = 48;
const T = { x: 720, y: 900 };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

assert.equal(typeof genie.genieEdge, 'function', 'the funnel exposes shared boundary geometry');
const { genieEdge, opaqueGenieSurface } = genie;
for (const target of [T, { x: 720, y: -100 }, { x: 360, y: 430 }, { x: 340, y: 110 }]) {
  const mirrored = target.y < W.top + W.height / 2;
  for (let i = 0; i <= N; i++) {
    const start = genieEdge(W, target, i / N, 0, mirrored);
    near(start.left, W.left);
    near(start.right, W.left + W.width);
    near(start.y, W.top + i * W.height / N);
    assert.deepEqual(genieEdge(W, target, i / N, 1, mirrored), { left: target.x, right: target.x, y: target.y });
  }
  for (let step = 0; step <= 100; step++) {
    for (let i = 0; i < N; i++) {
      const frame = genieSlice(W, target, N, i, step / 100, mirrored);
      assert.ok([frame.x, frame.y, frame.width, frame.height, frame.sx, frame.sy, frame.opacity].every(Number.isFinite));
      assert.ok(frame.width >= 0 && frame.height >= 0);
      assert.ok(frame.sx >= 0 && frame.sx <= 1 && frame.sy >= 0 && frame.sy <= 1);
      assert.ok(frame.opacity >= 0 && frame.opacity <= 1);
      assert.ok(frame.top.left >= frame.x && frame.bottom.left >= frame.x);
      assert.ok(frame.top.right <= frame.x + frame.width + 1e-8 && frame.bottom.right <= frame.x + frame.width + 1e-8);
      near(frame.y, frame.top.y);
      near(frame.height, frame.bottom.y - frame.top.y);
    }
  }
  for (const time of [.3, .7]) {
    for (let i = 0; i < N - 1; i++) {
      const a = genieSlice(W, target, N, i, time, mirrored);
      const b = genieSlice(W, target, N, i + 1, time, mirrored);
      assert.deepEqual(a.bottom, b.top, 'adjacent trapezoids share exact left, right and y coordinates');
      assert.deepEqual(a.top, genieEdge(W, target, i / N, time, mirrored));
      near(a.y + a.height, b.y);
    }
  }
}
assert.ok(genieSlice(W, T, N, N - 1, .3).sx < genieSlice(W, T, N, 0, .3).sx, 'the bottom narrows first');
assert.ok(genieSlice(W, { x: 720, y: -100 }, N, 0, .3, true).sx < genieSlice(W, T, N, 0, .3).sx, 'mirroring narrows the top first');
for (const mirrored of [false, true]) {
  const target = mirrored ? { x: 720, y: -100 } : T;
  near(genieEdge(W, target, .5, .4, mirrored).y, W.top + W.height / 2);
  assert.notEqual(genieEdge(W, target, .5, .7, mirrored).y, W.top + W.height / 2, 'sucking begins after the 40% squeeze');
}

assert.equal(opaqueGenieSurface('rgba(15, 16, 17, .85)', '#0f1011'), 'rgb(15, 16, 17)');
assert.equal(opaqueGenieSurface('rgba(255, 255, 255, .85)', '#fafafa'), 'rgb(254, 254, 254)');
assert.equal(opaqueGenieSurface('rgba(100, 150, 200, .5)', '#14283c'), 'rgb(60, 95, 130)');
assert.equal(opaqueGenieSurface('rgba(0, 0, 0, 0)', '#fff'), 'rgb(255, 255, 255)');
assert.equal(opaqueGenieSurface('rgb(15 16 17 / 85%)', '#0f1011'), 'rgb(15, 16, 17)');
console.log('genie geometry and opaque surface tests passed');
