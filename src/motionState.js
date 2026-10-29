// Optimized production CSS can express the same token in seconds or milliseconds.
export function motionDuration(value, fallback = 240) {
  const token = String(value).trim();
  const number = Number.parseFloat(token);
  if (!Number.isFinite(number) || number < 0) return fallback;
  if (token.endsWith('ms')) return number;
  return token.endsWith('s') ? number * 1000 : fallback;
}

export function startRun(conversationId, label, at = Date.now()) {
  return { conversationId, label, startedAt: at, steps: [{ label, tool: undefined, at }] };
}

export function appendRunStatus(pending, event, at = Date.now()) {
  if (!pending || pending.stopping || !event.label?.trim()) return pending;
  const steps = pending.steps || [];
  return { ...pending, label: event.label, tool: event.tool,
    steps: steps.at(-1)?.label === event.label ? steps : [...steps, { label: event.label, tool: event.tool, at }] };
}

// Step boundaries come from received run events; no estimated progress or totals.
export function runTiming(run, now) {
  const seconds = milliseconds => (Math.max(0, milliseconds) / 1000).toFixed(1);
  return {
    total: seconds(now - run.startedAt),
    steps: run.steps.map((step, index) => seconds((run.steps[index + 1]?.at ?? now) - step.at)),
  };
}
