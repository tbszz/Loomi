# Workspace Motion Spec

Updated: 2026-10-28
Scope: interaction motion and the job card component in the logged-in workspace.
Parent contract: `DESIGN.md` §8 (restrained editorial workspace, respect reduced motion).

Reference catalog: detail.design. Patterns borrowed (concept only, no code copied):

| Ref | detail.design pattern | Where it lands here |
| --- | --- | --- |
| R1 | Staggered Animation for Event Order | job cards, agent step trail, suggestions, sidebar lists, result-list rows |
| R2 | Animated State-Based Icons | send ↔ stop, copy → check, theme sun ↔ moon, sidebar chevron, "选择" → "已选择" |
| R3 | Animated Action Button | send, primary actions, job select button: press-scale + state morph |
| R4 | Self-Explanatory Load Bar | agent progress and file reading: a bar whose label says what is happening |
| R5 | Animate the transition between two open tooltips (tooltip in a group) | one sliding hover/active indicator shared by a group (document tabs, sidebar conversation list, skill menu options) |
| R6 | Smart Corner Morph / Music Player Layout Shift | skill menu, notice, context chip, drop overlay, drawers, modals grow from their origin instead of popping |
| R7 | Hold to Reveal Shortcut Hint | holding Ctrl/⌘ ≥ 400ms reveals small kbd badges (Ctrl+B sidebar, Enter send, Esc close) |
| R8 | Overscroll Effect in Nested Scrollers | `overscroll-behavior: contain` on skill menu, evidence panel, sidebar lists |
| R9 | Handle CJK Input Method Differently | already implemented in the composer; motion must not break IME (no animation tied to keydown during composition) |

## 1. Rules

1. Motion is feedback, not decoration. Every animation answers "what just happened" or "what is happening now".
2. Motion never fakes progress or success. Progress visuals bind to real `pending` / status events. No percentage that is not computed from real data. Errors animate as errors.
3. Only animate `transform`, `opacity`, `clip-path`, `background-color`, `color`, `border-color`, `box-shadow`. Never animate width/height/top/left on large containers (grid-template-rows 0fr→1fr is allowed for disclosure).
4. Tokens (define once in `src/motion.css`, imported first from `src/main.jsx`):
   - `--ease-out: cubic-bezier(0.22, 1, 0.36, 1)`
   - `--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)`
   - `--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)` (only for small icon/press morphs)
   - `--dur-instant: 90ms`, `--dur-fast: 160ms`, `--dur-base: 240ms`, `--dur-slow: 380ms`
   - `--stagger: 40ms` (cap total stagger at 8 items; later items use the 8th delay)
   - `--lift: translateY(-2px)`; `--press: scale(0.97)`
   - `--accent-pass`, `--accent-verify`, `--accent-reject` for job status, defined for light and dark (`.workspace-shell[data-theme="dark"]`), muted, not saturated.
5. Reduced motion: under `prefers-reduced-motion: reduce` all transforms/keyframes are removed; color/opacity changes may remain instant. The existing block in `workspace.css` stays; new files add their own block. UI must remain fully usable and every state still visible without motion. `scripts/test-workspace-ui.mjs` runs with `reducedMotion: 'reduce'` and must keep passing.
6. Keyboard parity: every hover effect has the same effect on `:focus-visible`. Focus ring uses `--focus`.
7. Light/dark themes both readable. Narrow screens (≤ 720px): no horizontal overflow; job cards become one column.
8. No new runtime dependency. CSS + existing React only. Small helper hooks are fine.
9. Keep existing class names and DOM that tests rely on: `.job-list`, `.job-notes`, `.aui-status`, `.agent-spinner .spinner-motion`, all aria labels and roles.

## 2. Interaction inventory

Every row must have its effect. "Enter" = mount animation. Ref column points to §0 table.

### 2.1 Global / shell (`src/main.jsx`)

| # | Interaction | Effect | Ref |
| --- | --- | --- | --- |
| G1 | Any button / link hover | background/color fade `--dur-fast`; icon buttons get soft circular hover plate | – |
| G2 | Any button press (`:active`) | `--press` scale, `--dur-instant` | R3 |
| G3 | Keyboard focus | focus ring fades in (outline-offset 1→2px) | – |
| G4 | Disabled controls | opacity transition; no hover lift | – |
| G5 | Theme toggle | sun/moon icon rotates+crossfades; page colors transition `--dur-base` on `background-color, color, border-color` of shell surfaces only | R2 |
| G6 | Sidebar collapse/expand (Ctrl+B, chevron) | width change via grid transition on desktop; chevron rotates 180° | R2 |
| G7 | Mobile sidebar / evidence drawer open/close | panel slides from its edge, backdrop fades; close reverses (keep element mounted for exit, or use a closing class) | R6 |
| G8 | Settings / project editor / auth modal | scale 0.98→1 + fade from center; backdrop fade; exit reverses | R6 |
| G9 | Landing page "Get Started" / login / register buttons | R3 press + arrow nudge on hover | R3 |
| G10 | Hold Ctrl/⌘ | kbd hint badges fade in next to header sidebar toggle (Ctrl B), send button (Enter), drawers' close (Esc); hide on keyup/blur | R7 |
| G11 | Conversation title inline edit | input underline grows from left on focus | – |

### 2.2 Sidebar

| # | Interaction | Effect | Ref |
| --- | --- | --- | --- |
| S1 | Conversation / project list hover | one shared hover plate that slides between rows (absolute-positioned indicator following hovered row, `--dur-fast`) | R5 |
| S2 | Active conversation change | active plate slides to new row; row text weight change | R5 |
| S3 | List mount / new conversation added | rows enter with R1 stagger; a newly created row highlights once | R1 |
| S4 | Delete conversation/project | row collapses (opacity + grid-row 1fr→0fr) before removal if feasible; otherwise fade-out of next render | – |
| S5 | Candidate create toggle (+) | form expands (grid rows), `+` rotates 45° | R2, R6 |
| S6 | Candidate switch (select) | conversation area does a short crossfade (`--dur-base`) keyed by candidate id so the change of working subject is visible | – |
| S7 | Row action icons (rename/delete/move) | reveal on row hover/focus-within with fade+slide 4px | – |

### 2.3 Conversation (`src/components/WorkspaceChat.jsx`)

| # | Interaction | Effect | Ref |
| --- | --- | --- | --- |
| C1 | Welcome mount | emblem, eyebrow, h1, p enter with R1 stagger (fade + 6px rise) | R1 |
| C2 | Suggestion chips | enter staggered; hover lift + icon nudge; click → press | R1, R3 |
| C3 | User message sent | bubble enters from bottom-right (fade + 8px rise + scale .98→1) | – |
| C4 | Assistant message appears | fade + 6px rise; result panels inside stagger their sections | R1 |
| C5 | Message hover | action bar (copy / 查看资料) fades in; keyboard focus-within too | – |
| C6 | Copy reply | copy icon morphs to check (scale+rotate), returns when `isCopied` false | R2 |
| C7 | Scroll-to-bottom button | appears with fade + rise; arrow bobs once on appear | – |
| C8 | Notice (`.aui-notice`) | slides down from composer top edge; dismiss collapses | R6 |
| C9 | Context chip (当前目标) | morphs in (scale-x from left) when a job is selected; content crossfades when the job changes | R6 |
| C10 | Composer focus | border color + soft shadow transition; container grows smoothly with rows | – |
| C11 | Typing `/` → skill menu | menu grows from composer top-left (clip-path/scale-y origin bottom), options stagger | R6, R1 |
| C12 | Skill option hover / ↑↓ | shared active plate slides between options | R5 |
| C13 | Skill selected | inserted command flashes background once in the input area (composer highlight pulse) | – |
| C14 | Skill catalog loading / error / retry | loading text shimmer; error row fades in with warning tint; retry button press | R4 |
| C15 | Send button | enabled state color fade; press; on submit the arrow flies up 4px and returns | R3 |
| C16 | Send ↔ Stop swap | icon morph (rotate + scale crossfade) when `canCancel` flips | R2 |
| C17 | Attach (paperclip) | hover tilt -12°, press | R2 |
| C18 | Drag file over thread | overlay fades in, card scales 0.96→1, dashed border marches (CSS animated dash); leave reverses | R6 |
| C19 | Drop file | card does a quick "accept" pulse before overlay hides | – |
| C20 | Resume artifact card | hover lift; 打开优化稿 press; PDF/DOCX download links: download icon drops 2px on hover | R3 |
| C21 | Error message (`kind: error`) | enters with left accent bar drawing top→bottom in error tone; no bouncing, no success colors | – |

### 2.4 Agent run (real status only)

`main.jsx` currently replaces `pending` on every `status` event. Change it to also keep an ordered, de-duplicated list of step labels for the current run: `pending.steps = [{ label, tool, at }]` (append when the label differs from the last; reset on new run). Nothing is invented: steps come only from real `status` events and the initial label already set when the run starts. Cleared exactly when `pending` is cleared today.

| # | Interaction | Effect | Ref |
| --- | --- | --- | --- |
| A1 | Run starts | `.aui-status` enters (fade + rise). Contains a step trail component (`AgentRunTrail`) | R4 |
| A2 | Current step | label with a moving shimmer gradient over text + pulsing dot; elapsed seconds counter (real `Date.now() - startedAt`, updates each second) | R4 |
| A3 | Step completes (next status arrives) | previous step row collapses to a compact line with a check icon drawn via stroke-dashoffset; new step enters below with R1 | R1, R2 |
| A4 | Indeterminate bar | thin bar under the trail with a sliding segment while running; it is never a percentage | R4 |
| A5 | User presses Stop | stop button press; status label changes to "正在停止…" only if the app actually is still waiting for abort; trail fades out when `pending` clears | – |
| A6 | Run ends | trail fades out; the assistant reply enters (C4). If the run failed, the error message uses C21 | – |
| A7 | File upload reading (`正在读取 <name>`) | same trail component, first step label is the file read | R4 |
| A8 | Streaming text | if assistant text grows while running, new text fades in (no per-character typing simulation) | – |

The step trail shows business labels only (existing `event.label`), never tool or Skill internals (`DESIGN.md` §4).

### 2.5 Job results → job cards (`src/components/ChatResultCards.jsx`)

Replace the `.job-row` list with a card grid. `.job-list` stays as the grid container: `grid-template-columns: repeat(auto-fill, minmax(232px, 1fr))`, gap 10px; 1 column ≤ 720px.

Card anatomy (`.job-card`, also keep `.job-row` class on the same element so selectors/tests keep working):

```
┌──────────────────────────────┐
│ [icon]  Company        原文↗ │  company line + source link (top-right)
│ Job title (2-line clamp)     │
│ 📍 Location · 实习/校招/社招  │
│ ── status pill ───────────── │  passed / verify / announcement wording (eligibilityLabel)
│ 参考 72        [ 选择 ]       │  score is labelled "参考", never a probability
└──────────────────────────────┘
```

- Whole card is the select target (keep a real `<button>` for select; source link stays a separate `<a>`, not nested inside the button).
- Status pill colors from `--accent-pass` / `--accent-verify`; a thin top border in the same tone.

| # | Interaction | Effect | Ref |
| --- | --- | --- | --- |
| J1 | Cards mount | R1 stagger (fade + 8px rise), max 8 delays | R1 |
| J2 | Card hover / focus-visible | lift `--lift`, shadow deepens, border tone strengthens, a soft radial highlight follows the cursor (CSS vars `--mx/--my` set on pointermove, throttled with rAF; static centered highlight on keyboard focus) | – |
| J3 | Source link hover | arrow ↗ nudges 2px up-right | R2 |
| J4 | Card press | `--press` | R3 |
| J5 | Select | "选择" morphs to "✓ 已选择" (check draws), card gets selected ring that animates in; previously selected card's ring fades out | R2, R3 |
| J6 | Uncertain / related / rejected notes | `<details>` open/close animates height (grid rows or `interpolate-size` with fallback), summary chevron rotates | R6 |
| J7 | Job note row hover | background fade, 原文 link nudge | – |

### 2.6 Other result panels

| # | Interaction | Effect | Ref |
| --- | --- | --- | --- |
| P1 | Diagnosis / resume / interview / target panels mount | header then sections stagger | R1 |
| P2 | Diagnosis completeness number | counts up from 0 to the real value once on mount (rAF, ≤ 600ms); reduced motion shows final value | – |
| P3 | Result list rows (已识别证据 / 下一步补充) | stagger; check icons draw | R1, R2 |
| P4 | Interview topics chips | stagger; hover lift | R1 |
| P5 | Resume toolbar copy/print | press; copy icon → check for 1.5s after real success only | R2, R3 |

### 2.7 Evidence panel (right)

| # | Interaction | Effect | Ref |
| --- | --- | --- | --- |
| E1 | Panel open/close on desktop | slide + fade from right; content fades in after slide | R6 |
| E2 | Tabs (原文与优化稿 / 网申填表) | shared active underline/pill slides between tabs; content crossfades | R5 |
| E3 | Document list switch | shared active plate slides; document body crossfades | R5 |
| E4 | Annotation cards | stagger in; hover lift; evidence quote highlight sweeps once on hover | R1 |
| E5 | Empty state buttons (分析这份简历 / 生成优化稿) | press + hover | R3 |
| E6 | Template select / downloads | select focus transition; download icon drop | – |

### 2.8 Application panel (`src/components/ApplicationPanel.jsx`)

| # | Interaction | Effect | Ref |
| --- | --- | --- | --- |
| F1 | `<details>` sections | animated disclosure | R6 |
| F2 | Action buttons while `locked` (request in flight) | the clicked button shows an inline spinner + label kept; others disabled with opacity transition | R3, R4 |
| F3 | Scanned field list | rows stagger in; fill result state chips crossfade when the state changes | R1 |
| F4 | Add / remove record | fieldset enters/leaves with fade + height | – |

## 3. Acceptance

- [ ] Every row in §2 implemented; implementation notes list which file/selector covers it.
- [ ] Job results render as cards with J1–J5; DOM keeps `.job-list` and `<details class="job-notes">` order expected by `src/chatUi.contract.test.js`.
- [ ] Agent trail shows only real status labels; disappears when `pending` clears; failure path shows error styling.
- [ ] `prefers-reduced-motion: reduce` removes motion; everything still visible and usable.
- [ ] Light + dark readable; 375px width without horizontal overflow.
- [ ] `npm test`, `npm run build`, `npm run test:workspace-ui` pass.
