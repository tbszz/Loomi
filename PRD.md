# Loomi PRD — P0

Updated: 2026-09-22
Status: P0 implementation baseline

## 1. Product definition

Loomi is a long-term Personal Career Agent, not a one-shot resume generator.

For each candidate, the product builds a private, continuously growing background library and reuses it across conversations for resume analysis, JD analysis, job evaluation, tailored resumes, and interview preparation.

The P0 promise is simple:

> Upload your materials once; Loomi should remember the candidate through a traceable Candidate Knowledge Base and use those real facts again whenever the user asks for career help.

## 2. P0 goals

P0 must deliver this complete loop:

```text
Create Candidate
→ upload resume / project material
→ extract structured facts + searchable chunks
→ keep conversation continuity
→ paste or select a JD
→ Agent retrieves relevant candidate evidence
→ analyze JD
→ tailor resume
→ verify factual claims
→ export PDF / DOCX
```

Export always reads the persisted Resume Variant (with its claim evidence), never an in-memory or ad-hoc draft.

P0 succeeds when the user no longer needs to repeatedly explain the same background and the system can produce job-specific outputs without inventing experience.

## 3. Product principles

- **Candidate-first**: Candidate is the long-lived entity; Conversation is a work thread.
- **Evidence-first**: factual career claims need a source.
- **Agent-first**: the Primary Career Agent is powered by Claude Agent SDK; do not add a separate Brain LLM.
- **SDK-first**: use SDK session, agent loop, Skill, Tool/MCP and permission capabilities before building custom orchestration.
- **RAG, not only RAG**: personal knowledge combines structured facts and semantic retrieval.
- **Simple P0**: one Primary Career Agent only; no multi-agent framework in P0.
- **Skill-first verticalization**: domain methods live in first-party Career Skills, not one giant system prompt.

## 4. P0 user scenarios

### A. Build a candidate background library

The user creates a Candidate and uploads PDF, DOCX, TXT, Markdown, or pasted text.

The system stores the original material, extracts text, creates chunks for retrieval, and extracts structured Candidate Facts with provenance.

### B. Grow the background library through conversation

When a user explicitly adds durable career information in chat, such as responsibilities on a project, the system may store it as `user_asserted` evidence for that Candidate.

Assistant-generated text or model inference must never silently become a candidate fact.

### C. Tailor a resume to a JD

The user provides a JD. The Primary Career Agent:

1. uses `jd-analysis`;
2. retrieves relevant evidence from Candidate KB;
3. uses `resume-tailoring`;
4. generates a Resume Variant;
5. runs Claim → Evidence verification;
6. exports PDF / DOCX.

### D. Analyze resume and prepare for interview

The same Candidate KB supports `resume-analysis` and `interview-prep`, so the user does not need to re-upload or re-explain the same projects.

## 5. P0 requirements

### 5.1 Candidate

- A user can create multiple Candidates.
- Every Conversation is bound to exactly one `candidate_id`.
- Candidate data must be isolated by `user_id + candidate_id` in deterministic application code.
- P0 does not silently switch Candidate inside one Conversation.

### 5.2 Documents and ingestion

Supported inputs:

- PDF
- DOCX
- TXT
- Markdown
- pasted text

For each document, preserve:

- original file/text;
- extracted text;
- page/position when available;
- parsing method/status;
- failure reason when parsing is incomplete.

Create searchable `DocumentChunk` records for retrieval.

### 5.3 Candidate Facts and provenance

P0 extracts at least:

- education;
- experience;
- projects;
- skills;
- achievements;
- metrics;
- career preferences.

A Candidate Fact must contain enough information to trace where it came from:

```text
fact_id
candidate_id
type
value
source_type
source_id
source_quote
source_page / source_position (when available)
confidence
status
```

Supported status values:

- `verified`
- `user_asserted`
- `disputed`
- `disabled`

Conflicting sources must not silently overwrite each other.

### 5.4 Candidate retrieval

Expose one unified Agent tool:

```text
search_candidate_knowledge
```

P0 retrieval combines:

```text
Structured Fact Search
+
Keyword / BM25
+
Semantic Vector Search
→ deduplicate / rerank
→ Evidence Pack
```

Every query is filtered by `candidate_id`. The Agent receives a bounded Evidence Pack, not the entire Candidate KB.

### 5.5 Session and history

Keep only two memory concepts:

```text
Agent Session / Conversation History
= short-term conversation continuity

Candidate Knowledge Base
= long-term candidate background across conversations
```

Evidence / Provenance belongs inside Candidate KB; it is not a third memory system.

Requirements:

- application DB persists Conversation History;
- same Conversation should use continuous Agent Session when supported;
- new Conversation may use a new Agent Session while sharing the same Candidate KB;
- if an SDK Session cannot be resumed, rebuild context from application history + Candidate KB.

### 5.6 Primary Career Agent

P0 has one Primary Career Agent powered by `@anthropic-ai/claude-agent-sdk`.

Claude Agent SDK is responsible for the generic agent runtime capabilities: multi-step agent loop, planning, Skill use, Tool/MCP use, session continuity, streaming/abort, and supported permission/hook mechanisms.

Loomi supplies the career-domain layer: Candidate KB, Career Skills, Career Tools, Job Knowledge, Candidate isolation, and factual verification.

Do not implement a second Brain LLM, custom Agent Loop, or P0 Workflow Engine.

### 5.7 P0 Career Skills

The first implementation round must establish these four first-party Skills:

```text
skills/
├── resume-analysis/
│   ├── SKILL.md
│   └── references/
├── jd-analysis/
│   ├── SKILL.md
│   └── references/
├── resume-tailoring/
│   ├── SKILL.md
│   └── references/
└── interview-prep/
    ├── SKILL.md
    └── references/
```

#### `resume-analysis`

Diagnose resume structure, weak evidence, weak bullets, unclear responsibility boundaries, and unsupported metrics without inventing content.

Useful references: `srbhr/Resume-Matcher`, `liangdabiao/resume-matcher-agent-cn`, `yanliudesign/resume-builder-skill`.

#### `jd-analysis`

Convert a JD into transparent requirements: must-haves, responsibilities, core skills, preferences, eligibility constraints, and uncertainties.

Useful references: `yanliudesign/job-description-skill`, `career-ops-hq/career-ops`, `srbhr/Resume-Matcher`.

#### `resume-tailoring`

Select and rewrite only supported Candidate Evidence for the target role. It may reorder, compress, clarify, and use job-relevant language, but may not add unsupported skills, responsibilities, numbers, or outcomes.

Useful references: `varunr89/resume-tailoring-skill`, `proficientlyjobs/proficiently-claude-skills/skills/tailor-resume`, `yanliudesign/resume-builder-skill`.

#### `interview-prep`

Use the target JD plus Candidate Evidence to prepare likely follow-ups, STAR story preparation, weak-evidence warnings, and role-specific review topics.

Useful references: interview modes in `career-ops-hq/career-ops` and interview-predictor ideas from `yanliudesign/job-description-skill`.

Skills define **how to work**. They must not store specific Candidate facts.

### 5.8 Career Tools / MCP

P0 tool surface remains small:

```text
search_candidate_knowledge
read_document
search_jobs
select_job
generate_resume
prepare_interview
export_resume
```

Tool authorization, ownership, parameter validation, and business preconditions are deterministic server logic / SDK permission controls, not a second LLM decision.

Document parsing, OCR, DB queries, retrieval, fact persistence and file rendering are Services/Tools, not Skills or Agents.

### 5.9 Job Knowledge

Candidate Knowledge and Job Knowledge are separate.

P0 may keep the existing locally cached public job knowledge service. Each job record should preserve source, original URL, source ID, observed/fetched time, and validity state.

Aggregator text is not automatically a complete official JD. Missing or uncertain requirements remain `unverified`.

P0 does not require user-configurable monitoring, notifications, or automatic job application.

### 5.10 Resume generation and verification

A tailored resume requires Candidate Evidence and a target JD/Job.

Every factual Resume Claim must map to Candidate Facts or source evidence.

Verification must catch at least:

- unsupported technologies;
- unsupported numbers/results;
- responsibility inflation;
- JD requirements copied into the candidate profile;
- cross-Candidate contamination.

Claims without evidence cannot enter the final resume.

P0 supports PDF and DOCX export.

### 5.11 Basic observability and evaluation

P0 does not build a separate observability platform. A task should still be traceable by:

```text
user_id
candidate_id
conversation_id
agent_session_id (when available)
tool_calls
retrieval_queries
retrieved_fact_ids
errors
artifact_id (when produced)
```

Maintain a small Golden Case suite for Candidate isolation, retrieval, fact extraction, JD hard requirements, Claim grounding, session continuity, Skill use, and truthful tool failure handling.

## 6. P0 acceptance criteria

P0 is complete only when these end-to-end cases pass:

1. **Background library**: upload a real resume → document persists → chunks + Candidate Facts are created → facts link back to source text.
2. **Cross-conversation memory**: Candidate information added in Conversation A can be retrieved in Conversation B without re-uploading.
3. **Candidate isolation**: Candidate A never retrieves Candidate B's facts or files.
4. **Agent continuity**: follow-up requests in one Conversation retain context; if SDK session recovery fails, application history + Candidate KB can reconstruct the task context.
5. **Skill use**: the Primary Career Agent can use the four first-party Career Skills for appropriate tasks.
6. **Tailored resume**: JD → candidate retrieval → tailored resume → Claim verification → PDF/DOCX succeeds without unsupported facts.

## 7. P0 completion scope (2026-09-22 revision)

These items define what "P0 done" means as of this revision. Each has a testable, deterministic acceptance criterion.

### 7.1 Brain-free primary loop

The Primary Career Agent must run directly on the Claude Agent SDK agent loop. No `understandRequest` / Brain decision may gate tool calls. Deterministic guards (candidate binding, ownership scoping) remain in application code.

Acceptance: no production request path imports `server/brain.js`; tests no longer assert Brain gating.

### 7.2 SDK Session continuity

Each conversation persists its `agent_session_id`; follow-up messages in the same conversation resume the SDK session.

Acceptance: the conversation row stores `agent_session_id`; `claudeAgent` passes resume options on follow-up turns.

### 7.3 Domain models

`target_jobs` and `resume_variants` tables exist, with claim evidence mapping `(variant_id, claim_text, fact_ids)`.

Acceptance: generated resume variants are persisted with per-claim `fact_ids`; export reads the persisted variant.

### 7.4 Hybrid retrieval

SQLite FTS5 (BM25) over `candidate_facts` + `document_chunks`, with a Han-character bigram fallback tokenizer. Retrieval is always scoped by `user_id + candidate_id`.

Acceptance: retrieval uses the FTS index; an ownership violation still throws.

### 7.5 Tool contract

`CAREER_TOOLS` must include `read_document`, `export_resume`, and `save_candidate_fact` alongside the existing six tools.

### 7.6 User-asserted facts

Facts stated by the user in chat are persisted with `source_type: 'user_asserted'` via `save_candidate_fact`.

### 7.7 Closed loop

JD → evidence retrieval → tailoring → claim verification → PDF/DOCX export consumes the Candidate KB evidence pack and the persisted variant end to end.

### 7.8 Acceptance / golden case

An end-to-end scenario covers: create candidate → upload → paste JD → tailor → export PDF/DOCX with claim evidence. Plus a real-model skill routing smoke test.

## 8. First implementation round

Do these in order:

```text
1. Establish the four Career Skill directories and load them through the SDK
2. Remove Brain LLM from the target request path
3. Introduce Candidate + candidate_id binding
4. Introduce CandidateFact + DocumentChunk
5. Implement search_candidate_knowledge / Hybrid Retrieval
6. Enable conversation/session continuity through the SDK
7. Connect JD → RAG → resume-tailoring → verification → export
8. Add P0 Golden Cases and traces
```

Do not expand old `server/brain.js` / `knowledge/brain.md`; they are legacy migration code until the new path is complete.

## 9. Explicitly out of P0 / Future Vision

Not P0:

- Multi-Agent workers / custom orchestration framework;
- large third-party Plugin ecosystem;
- Knowledge Graph;
- advanced reranker / Learning-to-Rank;
- Cover Letter, company research, application tracking, offer comparison;
- job monitoring UI and notification system;
- automated application/submission (the explicitly requested local semi-automatic extension below is separate from P0);
- large evaluation platform;
- fine-tuning.

Future features must reuse Candidate KB + Skills + Tools + Claude Agent SDK instead of adding a new Brain or duplicate runtime layer.

## 10. Explicit user extension: on-demand semi-automatic application forms

Confirmed user scope: enterprise recruitment/campus long forms, filled only when requested; blank fields only; preserve existing and newly entered values including zero/false; ordinary identity/education/experience plus explicitly supplied sensitive fields and career preferences; no invented missing values; final review/submission by the user.

The extension must reuse the single Career Agent, Candidate Facts and controlled tools. Sensitive profiles stay separate from routine chat, facts and model inputs. Filling can trigger website autosave before final submission, so only the requested local page may be mutated. Ambiguous/custom fields remain pending rather than being guessed.

Native-field/local-fixture coverage is not universal portal support. JEV's typed decision-provider bridge, explicit per-field original-document attachment selection, same-origin frames, Jiandaoyun controls and bounded confirmed-record row expansion are integrated. On the supplied single-page recruitment form, the configured Primary Career Agent matched 54/54 synthetic content fields, while four source-known real-candidate fields were independently verified. The explicitly authorized original resume upload also passed receipt and source-DOM verification; other attachments remain blank at the user's request. Unknown portals/widgets, other upload receipts and automatic multi-page handling remain outside proven coverage. Synthetic data tests report DOM consistency and coverage, not universal inference quality or submitted applications. Adopting the JEV method alone does not satisfy real JEV capability integration; synthetic provider tests do not prove live inference or real embedding-model quality.

## User-requested resume layout extension

Confirmed scope: domestic campus/internship and experienced hiring; curated upstream template principles plus original single-column layouts. Preserve confirmed facts, use readable Chinese type, allow natural one/two/more page flow instead of shrinking or deleting content. Reuse PDF/DOCX exports from persisted grounded variants and expose actual PDF page preview. This adds `resume-layout` alongside the four baseline P0 Skills; it does not add multi-agent runtime or a new workflow engine. Source/license and verification details: `docs/resume-layout.md`.
