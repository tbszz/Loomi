export const CARD_IDS = ['documents', 'apply', 'sidechat'];
export const cardMode = width => width < 1200 ? 'overlay' : width < 1440 ? 'single' : 'stack';
export const defaultLayout = () => ({ open: [], recent: [], width: 448, split: .6, popped: {} });
const bounded = (value, min, max) => Math.min(max, Math.max(min, value));
const uniqueCards = value => Array.isArray(value) ? [...new Set(value.filter(id => CARD_IDS.includes(id)))] : [];

export function validateLayout(value, viewport) {
  if (!value || typeof value !== 'object') return defaultLayout();
  const open = uniqueCards(value.open);
  const recent = uniqueCards(value.recent).filter(id => open.includes(id));
  const popped = {};
  for (const id of open) {
    const frame = value.popped?.[id];
    if (frame && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(frame[key])) && frame.x >= 12 && frame.y >= 0 && frame.width >= 280 && frame.width <= 640 && frame.height >= 120 && frame.height <= 1200 && (!viewport || (frame.x + frame.width <= viewport.width - 12 && frame.y + frame.height <= viewport.height))) popped[id] = { ...frame };
  }
  return { open, recent: [...open.filter(id => !recent.includes(id)), ...recent], width: Number.isFinite(value.width) && value.width >= 360 && value.width <= 640 ? value.width : 448, split: Number.isFinite(value.split) && value.split >= .2 && value.split <= .8 ? value.split : .6, popped };
}
export function activateCard(state, id) {
  if (!CARD_IDS.includes(id)) return state;
  return { ...state, open: state.open.includes(id) ? state.open : [...state.open, id], recent: [...state.recent.filter(item => item !== id), id] };
}
export function closeCard(state, id) {
  const popped = { ...state.popped };
  delete popped[id];
  return { ...state, open: state.open.filter(item => item !== id), recent: state.recent.filter(item => item !== id), popped };
}
export function visibleCards(state, width, height = Infinity) {
  const docked = state.open.filter(id => !state.popped[id]);
  const recent = state.recent.filter(id => docked.includes(id));
  // Very short windows cannot hold two 200px bodies plus headers/tabs/gaps.
  const selected = recent.slice(cardMode(width) === 'stack' && height >= 534 ? -2 : -1);
  return docked.filter(id => selected.includes(id));
}
export function columnWidth(value, viewport, sidebar = 0) {
  return Math.min(bounded(value, 360, 640), Math.max(360, viewport - sidebar - 480 - 32));
}
export function stackSplit(value, height) {
  const minimum = Math.min(.5, 200 / Math.max(1, height));
  return bounded(value, minimum, 1 - minimum);
}
export function clampFrame(frame, bounds) {
  const width = bounded(frame.width || 448, Math.min(280, bounds.width - 24), Math.max(1, bounds.width - 24));
  const available = Math.max(1, bounds.bottom - bounds.top);
  const height = bounded(frame.height || 480, Math.min(200, available), available);
  return { x: bounded(frame.x || 0, 12, Math.max(12, bounds.width - width - 12)), y: bounded(frame.y || 0, bounds.top, bounds.bottom - height), width, height };
}
export function readLayout(storage, userId, viewport) {
  try { return userId ? validateLayout(JSON.parse(storage?.getItem(`loomi.cards.${userId}`) || 'null'), viewport) : defaultLayout(); } catch { return defaultLayout(); }
}
export function writeLayout(storage, userId, state) {
  try { if (userId) storage?.setItem(`loomi.cards.${userId}`, JSON.stringify(state)); } catch { /* Storage denial must not disable the workspace. */ }
}
export function contextCards(previous = {}, next = {}) {
  const cards = [];
  if ((next.variantId && next.variantId !== previous.variantId) || (next.export?.variantId && JSON.stringify(next.export) !== JSON.stringify(previous.export))) cards.push('documents');
  if (next.selectedJob && next.application && JSON.stringify(next.application) !== JSON.stringify(previous.application)) cards.push('apply');
  return cards;
}
