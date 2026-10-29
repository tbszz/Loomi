# Hiring Radar integration and job data cleanup

**Goal:** Import public employer postings through Hiring Radar into the existing Job Knowledge service and clean the existing cache without destroying source evidence.

**Architecture:** Keep the single SDK Career Agent and `search_jobs`. A pinned, locally installed Hiring Radar provides its existing domestic parsers. Our bounded Python bridge verifies pagination and failures, and the Node adapter maps results to the current feed contract. Source workspaces, plugins, candidate data and additional agents are not involved.

**Implementation:**
1. Preserve the working tree and reconcile existing merge markers that prevent tests/builds. Do not stage unrelated changes or complete the user's merge.
2. Add failing regressions for source mapping, incomplete/failed collection, company cleaning, announcement classification, conservative cross-source deduplication, provenance retention and idempotent cache cleanup.
3. Add the pinned source manifest, runtime setup command, Python bridge and feed adapter. Start with the upstream domestic generic parsers; retain individual source status. Failures and truncated pagination cannot masquerade as success.
4. Normalize company display names while preserving originals; distinguish postings, recruitment batches and recruitment events. Quarantine obvious non-postings. Merge only proven duplicates and retain each source reference; different cities, requisitions and employment types remain separate.
5. Integrate into the existing registry, index, search and detail-evidence contract. Add a dry-run/apply cleanup command with a database backup and an audit report. Preserve all raw source rows, target jobs and candidate tables.
6. Run focused regressions, `npm test` and `npm run build`. Install the pinned runtime, perform bounded real collection, apply the verified cleanup to the local job cache and report actual results and source failures.

**Validation:** Offline regression fixtures cover real subprocess JSON handling and local HTTP/parser behavior; live acceptance separately proves provider reachability and import/search. Compare cache counts before/after and verify repeated cleanup makes no further changes. Never count upstream advertised coverage as successful local collection.
