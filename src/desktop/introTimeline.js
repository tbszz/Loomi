export const INTRO_PHASES = Object.freeze([
  { name: 'silk', start: 0, end: 600 },
  { name: 'arrival', start: 600, end: 1400 },
  { name: 'hello', start: 1400, end: 2000 },
  { name: 'weave', start: 2000, end: 2800 },
  { name: 'handoff', start: 2800, end: 3300 },
].map(Object.freeze));
export const INTRO_DURATION = INTRO_PHASES.at(-1).end;
export const INTRO_STORAGE_KEY = 'resume-protocol:desktop-intro-played';

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
