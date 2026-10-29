export const INTRO_PHASES = Object.freeze([
  { name: 'peek', start: 0, end: 500 },
  { name: 'pull-back', start: 500, end: 1550 },
  { name: 'roll', start: 1550, end: 2750 },
  { name: 'climb', start: 2750, end: 3400 },
  { name: 'weave', start: 3400, end: 5200 },
  { name: 'rest', start: 5200, end: 7100 },
].map(Object.freeze));
export const INTRO_DURATION = INTRO_PHASES.at(-1).end;
export const INTRO_STORAGE_KEY = 'resume-protocol:desktop-intro-played';

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const lerp = (a, b, progress) => a + (b - a) * progress;
const easeOut = value => 1 - (1 - value) ** 3;
const easeInOut = value => value < .5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;

// The approved prototype samples straight edges every 6px and quadratic corners
// in eight steps. Reuse those lengths for both the traveler and SVG dash progress.
// Build once per measured layout, never read DOM geometry in the frame loop.
export function borderGeometry({ left, top, width, height }) {
  const right = left + width, bottom = top + height;
  const radius = Math.min(20, width / 2, height / 2);
  const points = [{ x: left + radius, y: top, distance: 0 }];
  const push = (x, y) => {
    const previous = points.at(-1);
    points.push({ x, y, distance: previous.distance + Math.hypot(x - previous.x, y - previous.y) });
  };
  const line = (x, y) => {
    const start = points.at(-1), count = Math.max(1, Math.ceil(Math.hypot(x - start.x, y - start.y) / 6));
    for (let i = 1; i <= count; i++) push(lerp(start.x, x, i / count), lerp(start.y, y, i / count));
  };
  const corner = (cx, cy, x, y) => {
    const start = points.at(-1);
    for (let i = 1; i <= 8; i++) {
      const u = i / 8, v = 1 - u;
      push(v * v * start.x + 2 * v * u * cx + u * u * x, v * v * start.y + 2 * v * u * cy + u * u * y);
    }
  };
  line(right - radius, top); corner(right, top, right, top + radius);
  line(right, bottom - radius); corner(right, bottom, right - radius, bottom);
  line(left + radius, bottom); corner(left, bottom, left, bottom - radius);
  line(left, top + radius); corner(left, top, left + radius, top);
  return { points, length: points.at(-1).distance, path: points.map((point, i) => `${i ? 'L' : 'M'}${point.x} ${point.y}`).join('') + 'Z' };
}

function borderPoint(border, progress) {
  const distance = border.length * progress;
  const index = border.points.findIndex(point => point.distance >= distance);
  if (index <= 0) return border.points[index === 0 ? 0 : border.points.length - 1];
  const a = border.points[index - 1], b = border.points[index];
  const u = (distance - a.distance) / (b.distance - a.distance);
  return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) };
}

// Shared with LoginScreen so the animated small web and the resting web are the
// same eleven paths, including on a narrow window. Coordinates are viewport px.
export function cornerWebPaths({ left = 0, top = 0, width = 105, height = 75 } = {}) {
  const x = left + width / 2, y = top + height / 2;
  const radius = Math.min(width / 2, height / 2) - 6;
  const point = (i, r) => {
    const angle = -Math.PI / 2 + i * Math.PI / 4;
    return `${x + Math.cos(angle) * r} ${y + Math.sin(angle) * r * .9}`;
  };
  return [
    ...Array.from({ length: 8 }, (_, i) => `M${x} ${y}L${point(i, radius)}`),
    ...[.32, .63, .94].map(r => 'M' + Array.from({ length: 9 }, (_, i) => point(i, radius * r)).join('L')),
  ];
}

/** Pure, seekable choreography. time is REAL elapsed ms, not prototype time.
 * layout: viewport size plus measured .login-card, .login-loomi body anchor and
 * .login-corner-web. Scale uses a 76.8px LoomiFigure (its body matches the spec's
 * 32px body), then lands at the actual resting SVG width without a size snap.
 */
export function introFrame(time, layout) {
  const raw = clamp(time, 0, INTRO_DURATION), t = raw < 500 ? raw : raw + 500;
  const k = (a, b) => clamp((t - a) / (b - a));
  const { width, height, card } = layout;
  const unit = Math.min(width / 1280, height / 800);
  const border = layout.border || borderGeometry(card);
  const start = border.points[0];
  const rest = layout.rest || { x: card.left + card.width / 2 + 132, y: card.top - 66 + 88 * 70 / 120, width: 88 };
  const floor = height - 88 * unit, left = width * 180 / 1280;
  const bob = Math.sin(raw / 160) * 4 * unit * (1 - k(1000, 1400));
  let x = width * 1000 / 1280, y = height * 690 / 800 + bob;
  let scale = 16 * unit, rotation = -6, tuck = 0, squash = 0, crawl = 0;
  const thread = { x: start.x, y1: 0, y2: 0, opacity: 0 };
  const progress = easeInOut(k(3900, 5700));

  if (t >= 1000 && t < 2050) {
    const pull = 1 - (1 - k(1000, 1950)) ** 2.2;
    x = lerp(x, left, pull); y = lerp(height * 690 / 800, floor, pull) + bob;
    scale = lerp(16, 1.8, pull) * unit; rotation = lerp(-6, 0, pull);
    squash = Math.sin(Math.PI * k(1800, 2020)) * .2;
  } else if (t >= 2050 && t < 3250) {
    const roll = easeInOut(k(2050, 3250)), p = k(2050, 3250);
    tuck = easeInOut(clamp(Math.min(p / .2, (1 - p) / .2)));
    x = lerp(left, start.x, roll); y = floor + 3 * unit * tuck;
    scale = 1.8 * unit; rotation = 720 * roll;
  } else if (t >= 3250 && t < 3900) {
    const up = easeInOut(k(3450, 3900)), shot = easeOut(k(3250, 3480));
    x = start.x; y = lerp(floor, start.y, up); scale = lerp(1.8, 1.6, up) * unit;
    rotation = 720; squash = -Math.sin(Math.PI * k(3250, 3480)) * .12;
    crawl = up > 0 && up < 1 ? Math.sin(raw / 55) * 7 : 0;
    thread.y2 = y - 22 * unit; thread.y1 = lerp(thread.y2, 0, shot);
    thread.opacity = k(3250, 3280);
  } else if (t >= 3900 && t < 5700) {
    const point = borderPoint(border, progress);
    x = point.x; y = point.y; scale = 1.6 * unit; rotation = 720;
    crawl = Math.sin(raw / 55) * 7;
    thread.y2 = start.y - 22 * unit; thread.opacity = 1 - k(3900, 4300);
  } else if (t >= 5700) {
    const hop = easeInOut(k(5700, 6300));
    x = lerp(start.x, rest.x, hop); y = lerp(start.y, rest.y, hop) - Math.sin(Math.PI * hop) * 28 * unit;
    scale = lerp(1.6 * unit, rest.width / 76.8, hop); rotation = 720;
  }

  const zoom = easeInOut(k(3100, 3700)) * (1 - easeInOut(k(5200, 6100)));
  const cameraScale = 1 + .6 * zoom;
  const focusX = clamp(lerp(width / 2, x, zoom), width / (2 * cameraScale), width - width / (2 * cameraScale));
  const focusY = clamp(lerp(height / 2, y, zoom), height / (2 * cameraScale), height - height / (2 * cameraScale));
  // The prototype starts its card at t5300, while its camera is still zoomed.
  // Keep the specified camera curve, but expose the REAL card only once it is
  // back at 1 (t6100), so the woven border and the DOM card coincide at reveal.
  const appear = (a, b) => easeOut(k(a, b));
  const blink = raw > 200 && raw < 290;
  return {
    phase: phaseAt(raw),
    loomi: { x, y, scale, rotation, tuck, squash, crawl, blink,
      eyeScale: blink ? 1 - .85 * Math.sin(Math.PI * (raw - 200) / 90) : 1,
      mood: t >= 6900 ? 'hello' : t >= 2050 && t < 3250 ? 'roll' : 'intro' },
    camera: { scale: cameraScale, x: width / 2 - cameraScale * focusX, y: height / 2 - cameraScale * focusY },
    thread,
    border: { path: border.path, progress, opacity: 1 - k(6900, 7300) },
    shadow: { x, y: floor + 40 * unit, scale: unit, opacity: .12 * k(1700, 2000) * (1 - k(3350, 3700)) },
    web: { progress: [ ...Array(8).fill(easeOut(k(6200, 6700))), ...[0, 1, 2].map(i => k(6700 + i * 200, 6900 + i * 200)) ] },
    reveal: { background: appear(6100, 6500), heading: appear(6150, 6600),
      email: appear(6300, 6750), password: appear(6450, 6900), button: appear(6600, 7050) },
  };
}

export function phaseAt(time) {
  return INTRO_PHASES.find(phase => Math.max(0, time) < phase.end)?.name || 'done';
}

export function shouldSkipIntro(event) {
  return event.type === 'click' || (event.type === 'keydown' && ['Escape', 'Enter', ' '].includes(event.key));
}

export function introDuration(reducedMotion) {
  return reducedMotion ? 400 : INTRO_DURATION;
}

export function hasPlayedIntro(storage) {
  try { return (storage ?? globalThis.sessionStorage)?.getItem(INTRO_STORAGE_KEY) === '1'; } catch { return false; }
}

export function markIntroPlayed(storage) {
  try { (storage ?? globalThis.sessionStorage)?.setItem(INTRO_STORAGE_KEY, '1'); } catch { /* Private / sandboxed windows may deny storage. */ }
}
