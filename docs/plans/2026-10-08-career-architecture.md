# Career architecture completion implementation plan

> **For Claude:** Execute with native implementation agents, independent file ownership, and specification then quality review. Preserve the existing uncommitted migration.

**Goal:** Complete the PRD P0 contracts and add the user-requested, opt-in JEV-assisted enterprise application form filling: empty fields only, preserve entered answers, human final submission.

**Architecture:** One Claude Agent SDK Career Agent owns reasoning, session continuity and on-demand Skills. Deterministic scoped services own candidate evidence, persisted variants, exports, encrypted application profile and browser execution. JEV contributes an application decision Skill, not a second generic agent loop; typed JEV judgments are optional and must never be represented as observed when not called.

**Tech stack:** Existing Node/Express/SQLite FTS5, Claude Agent SDK 0.3.269, React, Playwright, Zod. No new dependencies.

## Baseline

Worktree contains user-owned migration edits to PRD, architecture, runtime, database, app and tests. Brain deletions are already staged. Preserve them. Work on `codex/complete-career-architecture`; do not commit unrelated/user changes or reset files.

## Task 1 — Runtime, sessions and Skills

Ownership: `server/claudeAgent.js`, its tests, `server/modelClient.js`, `server/modelSettings.js`, `server/careerPolicy.js`, `server/careerSkills.test.js`, runtime-related test fixtures and first-party `.claude/skills`.

1. Add failing regression tests for stable scoped SDK cwd/config, session resume, unavailable-session recovery, no replay after attempted tool execution, and real project Skill discovery.
2. Confirm SDK 0.3.269 options against installed source/types. Keep a stable caller-scoped workspace; do not rename/delete a live session transcript workspace. Isolate each conversation and distinguish temporary no-session helper calls.
3. Load only first-party Skills into an isolated project directory, use SDK discovery/permissions, keep global policy small and move task methods into Skills. Primary production runtime uses SDK; compatible protocol remains a helper, not a custom second runtime loop.
4. Run `node --test server/claudeAgent.test.js server/careerSkills.test.js server/modelSettings.test.js server/minimaxClient.test.js`.

## Task 2 — Candidate truth and persistence

Ownership: `server/database.js`, `server/databaseHybrid.test.js`, `server/database.test.js`, `server/candidateKnowledge.js`, `server/candidateRetrieval.js`, their tests; new `server/claimEvidence.js` and tests.

1. Test cross-candidate record IDs, invalid/disabled evidence, empty claim links, assistant/JD statement writes, punctuation retrieval, FTS lifecycle and reopen.
2. Verify scoped provenance for source documents and user messages; use supported fact statuses, keep conflicting facts rather than overwrite, persist source conversation/message IDs.
3. Preserve FTS5/bigram retrieval, repopulate and synchronize index deterministically; enforce ownership before lookup.
4. Validate each factual resume field against actual candidate source spans and active facts; similarity is retrieval, not proof. Reject unsupported claims before saving or exporting. Cover identity, contact, summary, education, skills, project, experience and awards; no ungrounded factual fallback.
5. Enforce TargetJob/Variant/claim ownership and completeness in DB and revalidate on export. Save atomically.
6. Run `node --test server/database.test.js server/databaseHybrid.test.js server/candidateKnowledge.test.js server/candidateRetrieval.test.js server/claimEvidence.test.js`.

## Task 3 — Career closed loop integration

Ownership: leader `server/careerAgent.js`, `server/app.js`, `server/agent.test.js`, `server/agentConversation.test.js`, `server/app.test.js`, new integration tests, acceptance scripts.

1. Add regression for fresh conversation tailoring from existing Candidate KB without uploads, persistence failure, invalid claims and persisted-only export.
2. Feed bounded evidence pack to generation/audit, build claims from facts/source references, save before publishing successful artifacts, expose trace and source links. All callbacks are server-scoped and awaitable.
3. Read documents explicitly and truthfully; write user facts only from grounded user statements, never JD/assistant inference. Export materializes persisted verified variants only.
4. Prove candidate upload → new thread → JD → retrieve → tailor → persist/verify → PDF/DOCX through application API; cancellation/errors remain truthful.

## Task 4 — Opt-in JEV application form service

Ownership: new `server/applicationProfile.js`, `server/applicationForms.js`, `server/applicationAnswers.js`, `server/applicationRoutes.js` and tests. Browser adapter receives a scoped browser session/page, not global BOSS state. Leader owns app/Agent/UI wiring and application Skill integration.

1. Test on real local HTML with repeated education/project rows, textarea limits, date/select/radio/checkbox, stale scan, changed values, required missing fields, file upload and final submission traps.
2. Encrypt explicitly saved application profiles at rest per user+candidate; secrets never enter routine chat/session/logs. Missing values remain missing. Identity facts use direct references; decision answers use preferences/evidence. Existing `0`/`false`/selected answers are preserved.
3. Scanner produces field descriptors/options, stable handles and scope/page binding. Build answers only for blank fields; map repeated groups and select options, ground open answers, return skipped/failed fields honestly.
4. Filler rechecks blankness and page identity immediately before each write. Navigate only explicit safe next steps; never click final submit/send/sign/consent. Keep actual browser open for user final review and submission. Autosave can transmit during fill, so execution is only on explicit requested target site.
5. Add accessible workspace controls for URL/open/current page fill, profile/preferences and result summary; also provide natural-language tools gated by explicit request and local execution.
6. Validate routes with user/candidate isolation and browser fixture through API; remote deployment reports local-browser unavailable, never falsely succeeds.

## Task 5 — Completion evidence and documentation

1. Independent spec review maps every PRD §6/§7 requirement and user behavior to current tests/code; fix omissions.
2. Independent code quality review covers sessions, evidence and browser boundary; fix critical/important findings.
3. Run `npm test`, `npm run build`, `npm run test:acceptance`, `npm run test:workspace-ui`, real-model smoke when configured (record actual success/failure; no fabricated routing). Add new tests to package scripts.
4. Update canonical docs/README to accurately describe implemented versus unverified capability, remove stale Brain/stateless descriptions. Keep unfinished work and verification gaps visible; goal remains active until every requirement is proven.
