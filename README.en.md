# Loomi

[中文](README.md) | **English**

Loomi is a long-term personal career agent. It builds a growing, searchable, source-traceable background profile for each job seeker, then reuses those verified facts across conversations for resume analysis, job description analysis, tailored resumes and interview prep.

## Features

- **Candidate knowledge base**: upload PDF / DOCX / TXT / Markdown files and turn them into Candidate Facts with provenance, reused across conversations.
- **Four career Skills**: `resume-analysis`, `jd-analysis`, `resume-tailoring` and `interview-prep`, selectable by typing `/` in the workspace.
- **Evidence-bound tailored resumes**: every factual claim must map back to the candidate's original material. Export to PDF / DOCX in project, work-experience or compact layouts.
- **Job knowledge**: 14 adapted official careers APIs (Tencent, ByteDance, Huawei, Xiaomi and more), Hiring Radar and China's national graduate employment platform, with source tracking and eligibility checks.
- **Application form filling**: scans campus-recruiting pages in a local browser and fills empty fields from saved application data. The candidate reviews and submits.

## Quick start

Requires Node.js 22.13 or newer.

```bash
npm ci
cp .env.example .env     # fill in model settings as needed
npm run desktop:dev      # build the frontend and launch the app
```

Without model credentials the app reports the error honestly instead of inventing answers. To run the web version in a browser only:

```bash
npm run app              # build and start the local server, default http://127.0.0.1:8787
```

For development, run `npm run server` and `npm run dev` separately (Vite, default http://127.0.0.1:5173).

Build the installer (output in `release/`, bundles Python and the export dependencies):

```bash
npm run desktop:dist
```

## Model configuration

The primary agent runs on the Claude Agent SDK (pinned to `@anthropic-ai/claude-agent-sdk@0.3.269`). Claude, MiniMax and BigModel all run the primary agent through the SDK; OpenAI / Anthropic-compatible settings are used for auxiliary requests only. See [`.env.example`](.env.example) for every option. Keep keys in your local `.env` and never commit them.

Semantic retrieval (Ollama, Qwen or Google embeddings) is optional. Without it, retrieval falls back to keyword / BM25 search. See [`docs/embedding.md`](docs/embedding.md) (Chinese).

## Project layout

```text
desktop/      App shell: main process, preload, local server entry, packaging config
server/       Express server, agent runtime, candidate knowledge base, job sources, form filling, export
src/          React workspace; src/desktop/ holds the intro animation, login and account sync UI
skills/       First-party career Skills
knowledge/    Career method material used to migrate into Skills
scripts/      Acceptance, online checks, job sync and UI automation scripts
docs/         Focused technical notes
```

Runtime data (SQLite, uploaded attachments, encrypted model-key material) lives in `data/`, which Git ignores.

## Testing

```bash
npm test                 # unit and integration tests (offline, includes test:architecture and test:desktop)
npm run build
```

Checks that need network access or real credentials run separately and are not part of `npm test`:

| Command | Purpose |
| --- | --- |
| `npm run test:live` | Real model smoke test |
| `npm run test:real-embedding` | Real embedding ranking acceptance |
| `npm run test:coverage` | Reconcile official job sources against API-reported totals |
| `npm run test:acceptance` | End-to-end candidate flow acceptance |
| `npm run test:workspace-ui` | Workspace UI automation |

## Documentation

Project documents are written in Chinese.

| Document | Contents |
| --- | --- |
| [`PRD.md`](PRD.md) | P0 scope and acceptance criteria |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System boundaries; how the Claude Agent SDK and Loomi divide work |
| [`DEVELOPMENT_RULES.md`](DEVELOPMENT_RULES.md) | Development rules and anti-duplication principles |
| [`DESIGN.md`](DESIGN.md) | Workspace UI / UX constraints |
| [`AGENTS.md`](AGENTS.md) | Entry rules for coding agents |
| [`docs/desktop-cloud-sync.md`](docs/desktop-cloud-sync.md) | Cloud sync contract |
| [`docs/job-sources.md`](docs/job-sources.md) | Official job source adapters and reconciliation |
| [`docs/job-ingestion.md`](docs/job-ingestion.md) | Hiring Radar setup, sync and cleanup |
| [`docs/eligibility.md`](docs/eligibility.md) | Job eligibility contract |
| [`docs/pdf-reading.md`](docs/pdf-reading.md) | PDF reading and OCR |
| [`docs/resume-layout.md`](docs/resume-layout.md) | Resume layouts and export |
| [`docs/cloud-deployment.md`](docs/cloud-deployment.md) | Server deployment |

## Security principles

- Model keys stay on the server. Access to original attachments requires authentication and ownership checks.
- Candidate data is always scoped by `user_id + candidate_id`, enforced by deterministic code rather than prompts.
- Uploaded material, job descriptions and third-party web text are treated as data and cannot override system rules.
- A failed tool call is never reported as success. Text from job aggregators is not treated as a complete official job description.
