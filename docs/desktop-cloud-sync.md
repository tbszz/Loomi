# Desktop + Cloud Sync Contract

Status: draft v1 (2026-10-28). Shared contract between the desktop session and the web/cloud session. Change it only by editing this file in both branches.

## 1. Product shape

```text
Web (cloud)                         Desktop (Electron, Windows first)
browser → Cloud Express (same       Electron main → local Express (same server/ code,
server/ code, multi-user,           single local user, SQLite in userData)
SQLite on a persistent volume)      └─ Sync Client ⇄ Cloud /api/sync/*
```

- Both run the **same** `server/` + `src/` code. No fork of the Primary Career Agent, Skills or Tools.
- The desktop works fully offline against its local server. Sync is additive and optional: signing in to a cloud account turns it on.
- The cloud is the source of truth for cross-device state. Local state is a replica plus not-yet-pushed changes.

## 2. Ownership split

| Area | Owner |
| --- | --- |
| `desktop/` (Electron main, preload, packaging, installer) | desktop session |
| `server/sync/client.js` (push/pull loop run by the local server) | desktop session |
| Desktop-only UI: account binding, sync status pill, offline banner, native title bar | desktop session (`src/desktop/`) |
| `server/sync/routes.js` (`/api/sync/*` on the cloud) | web session |
| Schema migration for sync columns (`server/database.js`) | web session |
| Cloud deployment (Dockerfile, env, HTTPS, CORS, cookies) and token auth for API clients | web session |
| Shared workspace UI in `src/` | neither session redesigns it; the motion session owns current workspace motion work |

Shared pure helpers (`server/sync/protocol.js`: record shapes, validation, merge rules) are written once by the web session; the desktop client imports them.

## 3. Synced entities

All scoped by `user_id`; candidate-scoped tables are additionally scoped by `candidate_id`.

| Table | Sync | Conflict rule |
| --- | --- | --- |
| `candidates` | yes | last-write-wins on `updated_at` |
| `conversations` | yes | last-write-wins on `updated_at` (whole `data` blob) |
| `documents` (+ original file blob) | yes | immutable after create except name/status; LWW |
| `document_chunks` | **no** — rebuilt locally from document text | — |
| `candidate_facts` | yes | **never silently overwrite**: differing `value` for same `id` → keep server row, insert incoming as new row with `status: 'disputed'` |
| `target_jobs` | yes | LWW |
| `resume_variants` + `claim_evidence` | yes, together | variant is immutable once created; claim_evidence travels with its variant |
| `user_states` | yes | LWW |
| `semantic_embedding_cache`, `sessions`, `agent_session_id` | **no** — device-local | — |
| Model settings / API keys | **no** — device-local, never leave the device | — |

## 4. Schema additions (web session)

For each synced table: `updated_at` (ms epoch, INTEGER), `deleted_at` (INTEGER NULL, tombstone), `rev` (INTEGER, server-assigned, monotonic per user). Existing TEXT timestamps stay; `updated_at` is added where missing. Deletes in synced tables become soft deletes (`deleted_at`), read paths filter them out.

## 5. API (cloud)

Auth: `Authorization: Bearer <token>` for API clients. `POST /api/auth/token` (email + password) → `{ token, user }`; `POST /api/auth/token/revoke`. Browser keeps cookie sessions.

```text
GET  /api/sync/pull?since=<rev>&limit=500
  → { changes: [{ table, id, rev, updated_at, deleted_at, record }], next: <rev>, more: bool }

POST /api/sync/push
  { device_id, changes: [{ table, id, base_rev, updated_at, deleted_at, record }] }
  → { applied: [{ table, id, rev }], conflicts: [{ table, id, server: {...}, resolution }] }

PUT  /api/sync/blobs/:documentId   (raw bytes, Content-Type, max 25 MB)
GET  /api/sync/blobs/:documentId
```

Rules enforced in deterministic code on the server:
- `record.user_id` is ignored and replaced by the token's user; candidate ownership is checked for every candidate-scoped record.
- Unknown tables / fields are rejected. Assistant-generated text never arrives as a candidate fact with `source_type` other than what the local server already allowed.
- A failed push item is reported as a conflict or error, never as applied.

## 6. Desktop client behaviour

- Local user ↔ cloud user mapping stored locally; local rows keep the cloud `user_id` after first binding (first bind re-keys local rows once).
- Loop: push dirty rows → pull since last rev → apply → rebuild chunks/FTS for changed documents. Triggers: app start, every 60 s while online, after each conversation turn, manual "Sync now".
- Token stored with Electron `safeStorage`; never written to the SQLite file in clear text.
- UI states: `local only` · `syncing` · `synced <time>` · `offline (n pending)` · `error: <message>` — errors are visible, not swallowed.

## 7. Out of scope for v1

Real-time collaboration, end-to-end encryption, mobile apps, multi-account on one desktop, syncing model API keys.
