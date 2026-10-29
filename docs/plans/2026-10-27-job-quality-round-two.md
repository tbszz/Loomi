# Second job quality pass

Goal: classify remaining recruitment notices, handle explicit expiration conservatively, identify duplicate ATS URLs without merging distinct requisitions, and extract auditable sections already present in official cached JDs.

Keep the existing Job Knowledge service, source rows, single SDK Agent and search tool. No candidate facts are changed. Reuse the first-pass backup/apply audit command. User authorization covers applying verified cleanup rules to the local cache.

1. Audit the complete active cache, stratify samples by source/type, and retain the baseline under ignored `tmp/job-round-two/`.
2. Add failing regressions for recruitment activities versus HR jobs, announcements versus individual roles, historical notices, exact valid deadlines, ATS tenant/job IDs, multilingual headings and official-origin checks.
3. Extend deterministic quality rules and the existing JD section parser. Permit cache evidence promotion only for a declared official origin, a bounded complete cached body and one explicit responsibilities/requirements pair. Aggregator copies stay unverified.
4. Feed the same rules into ingestion, cache search and apply cleanup. Keep rejected/expired records and their reason recoverable; retain distinct official requisitions even when titles/descriptions match.
5. Run focused regressions, full npm tests and build; apply backed-up cleanup; compare audit counts and non-job table contents; verify the second apply is idempotent. Record suspicious duplicates that cannot be safely merged.
