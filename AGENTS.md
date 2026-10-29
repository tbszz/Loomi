# Loomi project contract

Before planning or changing the project, read these canonical docs in order:

1. `PRD.md` — P0 product scope and acceptance criteria.
2. `ARCHITECTURE.md` — target system boundaries.
3. `DEVELOPMENT_RULES.md` — implementation rules and anti-duplication principles.
4. `DESIGN.md` — current UI/UX constraints when changing the workspace.

The latest explicit user instruction takes precedence.

## Non-negotiable rules

- Claude Agent SDK is the Primary Career Agent runtime. Reuse SDK session, agent-loop, Skill, Tool/MCP, permission/hook and future subagent capabilities before building custom equivalents.
- Do not add a second Brain LLM, Router Agent, custom planner loop or P0 workflow engine.
- Keep the always-loaded system policy small. Put task-specific career methods into first-party Skills.
- P0 Skills are `resume-analysis`, `jd-analysis`, `resume-tailoring`, and `interview-prep`.
- Candidate Knowledge Base is long-term candidate memory; SDK Session/Conversation History is short-term thread continuity.
- Evidence/provenance belongs to Candidate Facts; assistant-generated text and JD requirements are not candidate facts.
- Candidate ownership and tool authorization must be enforced by deterministic code, not prompt instructions.
- Candidate retrieval must always scope by `user_id + candidate_id`.
- Tool failure must never be presented as success.
- Job aggregator text is not automatically a full official JD; incomplete requirements remain unverified.
- P0 stays single-agent. Multi-agent, broad third-party Plugins, Knowledge Graph, automated applications and fine-tuning are future work only.

## Legacy migration note

`server/brain.js`, `knowledge/brain.md` and Brain-specific tests are legacy migration code. Do not extend this architecture. Remove it only when the new Primary Career Agent + Candidate KB path has equivalent regression coverage.

`knowledge/career-sop.md` may be used as migration source material for the four Career Skills, but task-specific rules should ultimately live with the relevant Skill rather than a growing global prompt.

Run the relevant unit/integration tests plus `npm test` and `npm run build` when changing P0 architecture contracts.
