# Loomi desktop cards — implementation and verification

Verified 2026-10-29 in `D:/Loomi-cards`, branch `feat/desktop-cards`, based on `e035d16`. No push was performed.

The workspace now keeps Documents (资料), Apply (网申), and Side chat (旁聊) in separate rounded cards beside the main conversation. At 1440px and above, two cards stack with a resizable 60/40 split; a third becomes an LRU tab. At 1200–1439px, one card is visible with tabs for the others. Below 1200px, a modal sheet has a scrim, keyboard focus boundary and Escape close. Very short windows show one card to preserve the 200px stack minimum. The sidebar remains a plain column with its existing collapse/drawer behavior.

Cards share icon-only pop out/dock controls, dragging, resizing, minimization and focus restoration. Floating geometry stays inside the window and avoids the main header and composer. The column defaults to 448px, allows 360–640px, and preserves at least 480px for chat; chat content is capped at 720px. User-scoped storage validates corrupt/offscreen layouts. Actual artifact/application context changes open the corresponding card, or show a dot while the main composer has text/focus. Reduced motion is supported.

Side chat reuses `WorkspaceChat`, message/result rendering, the existing SSE transport, cancellation and the same Primary Career Agent runtime. Each side thread has its own composer/history/session, restores the parent's latest side thread, and stays out of the sidebar. It shares the parent's Candidate KB and copies the parent's context only at creation. A delayed cancellation response cannot overwrite a newer side thread or its notice.

| Area | Files |
| --- | --- |
| Pure layout, validation and regression tests | `src/cardLayout.js`, `src/cardLayout.test.js` |
| Shared card host, toggles, geometry and styles | `src/components/WorkspaceCards.jsx`, `src/components/workspaceCards.css` |
| Independent side thread | `src/components/SideChat.jsx` |
| Existing renderer integration | `src/components/WorkspaceChat.jsx`, focused changes in `src/main.jsx` |
| API and persistence | `server/app.js`, `server/database.js`, `server/app.test.js` |
| Browser/Electron verification | `scripts/test-workspace-ui.mjs`, `scripts/test-desktop-cards.mjs`, `scripts/smoke-desktop-cards.mjs` |
| Contracts/test wiring | `DESIGN.md`, `package.json`, `src/workspaceRuntime.test.js`, `.gitignore` |

The server change adds optional `parentId` to conversation creation. It looks up the parent under the authenticated user, returns 404 for another user's/missing parent, forces the parent's candidate, snapshots context, and starts with no copied messages or SDK session. JSON persistence and list/get retain `parentId`; legacy rows return `null`. No new table, agent, planner or dependency was added. Tests cover forced candidate binding, parent ownership, legacy rows, context snapshots, independent messages and session isolation.

All final verification commands exited 0:

| Command | Output/evidence |
| --- | --- |
| `node --test src/cardLayout.test.js` | 6 tests passed, 0 failed |
| `node server/app.test.js` | `app integration tests passed: auth, ownership, SSE, uploads, export, deletion` |
| `npm test` | Full existing suite plus layout tests; includes `test:desktop`; [full log](../output/desktop-cards/npm-test.log) |
| `npm run build` | `built in 333ms` in the final standalone build; [log](../output/desktop-cards/build.log) |
| `npm run test:workspace-ui` | Existing upload, preview, application, offline/mobile tests plus side Enter/newline/stop/late-cancel isolation; 41-image cards matrix passed; [log](../output/desktop-cards/workspace-ui.log) |
| `node scripts/smoke-desktop-cards.mjs` | Electron 42.0.0 / Node 24.15.0, workspace rendered, documents docked, sandbox/context isolation true; [log](../output/desktop-cards/electron-smoke.log) |
| `git diff --check` | No whitespace errors |

The browser matrix covers 960×640, 1024×680, 1280×800, 1440×900 and 1920×1080 in light and dark, including single cards, stacks and split changes, tab swaps, overlays, pop outs and side replies/errors. It asserts window boundaries, main header/composer separation, readable side-message width, LRU, storage reload, context dots, automatic opening, overlay tab keyboard access and scrim closure. All 41 images and the additional Electron image were visually inspected using review sheets and full-size samples; the side-message grid collision found during inspection was fixed and regression-tested.

Artifacts remain local under the ignored `output/desktop-cards/`: [gallery](../output/desktop-cards/gallery.html), [geometry/check manifest](../output/desktop-cards/verification.json), [Electron manifest](../output/desktop-cards/electron-verification.json), PNGs and logs. Browser contexts, local servers and Electron windows were closed; Electron shutdown also verifies its owned server is unreachable.

The real side-chat request followed the actual provider path and returned: `Agent 尚未配置服务端 API Key。请设置 ANTHROPIC_API_KEY。` Screenshots preserve that honest error. A successful real-model reply was not verified. Deterministic model/context fixtures are used separately for cancellation and notification checks; intentional ungrounded artifact fixtures produce 409 responses and do not establish resume-generation success. PDF/DOCX generation behavior was not changed by this task.

No Computer Use was used. One directory-boundary mistake occurred during the first Electron smoke: `require('electron')` automatically downloaded a missing executable through the shared `node_modules` junction, writing into `D:/Loomi-Desktop/node_modules`. This was disclosed during execution; it was not rolled back because another run uses that directory. The new smoke script now uses `fs.access` and an explicit existing `electron.exe` path, with no package entry point or automatic install path. Subsequent test profile/output writes stay in this worktree or isolated temporary directories. No dependency declarations or lockfiles changed.
