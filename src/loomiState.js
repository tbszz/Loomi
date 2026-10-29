// Loomi mirrors the run state; it never decides anything about the run itself.
export const LOOMI_TRAVEL_MS = 900;
export const LOOMI_DONE_MS = 2600;

const failed = message => message?.kind === 'error' || message?.tone === 'warning';

export function loomiMood({ pending, typing, lastMessage }) {
  if (pending && !pending.stopping) return 'work';
  // Typing is the user answering the alert, so it outranks attn.
  if (typing) return 'typing';
  return failed(lastMessage) ? 'attn' : 'idle';
}

// Only a run that ended on its own and without a failure earns the celebration;
// a stopped run passes through idle first, and a failed one lands on attn.
export function settleMood(previous, next) {
  return previous === 'work' && (next === 'idle' || next === 'typing') ? 'done' : next;
}

// Steps are { phase, hang, at }: `hang` means Loomi is on its silk beside the run card.
export function loomiPlan(mood, atHang) {
  const back = (phase, at = 0) => atHang
    ? [{ phase: 'travel', hang: false, at }, { phase, hang: false, at: at + LOOMI_TRAVEL_MS }]
    : [{ phase, hang: false, at }];
  if (mood === 'work') return atHang ? [{ phase: 'hang', hang: true, at: 0 }] : [
    { phase: 'crouch', hang: false, at: 0 },
    { phase: 'shoot', hang: false, at: 260 },
    { phase: 'travel', hang: true, at: 600 },
    { phase: 'hang', hang: true, at: 600 + LOOMI_TRAVEL_MS },
  ];
  if (mood === 'done') return [{ phase: 'done', hang: atHang, at: 0 }, ...back('idle', LOOMI_DONE_MS)];
  return back(mood);
}
