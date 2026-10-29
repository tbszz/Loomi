# Unified public job ingestion

Loomi reads source data/API outputs, not upstream workspaces. The existing `search_jobs` → `jobKnowledge.search` contract serves official company adapters, GitHub JSON/SQLite/Markdown, NCSS and Hiring Radar. Candidate KB and the single Claude Agent SDK runtime are unchanged.

## Hiring Radar

The local runtime is pinned to [simonlin1212/Hiring-Radar](https://github.com/simonlin1212/Hiring-Radar) commit `dae32964f9c3b7289a85eac8693225e5248e7c82`. `server/hiringRadarSources.json` records 164 domestic Feishu/Moka/Beisen employer entries and hashes for runtime Python files. Setup clones into the ignored private data directory and checks the hashes; an existing checkout is never reset or automatically upgraded. The upstream MIT notice remains in that checkout. No external company directory dataset, private plugins, upstream workspace, MCP server or additional Agent is loaded.

```powershell
npm run jobs:setup-hiring-radar
npm run jobs:sync-hiring-radar
# Collect selected employers only; --force bypasses the normal sync interval.
npm run jobs:sync-hiring-radar -- minimax modelbest bambulab --force
```

Optional `RESUME_PROTOCOL_HIRING_RADAR_DIR` selects the pinned runtime checkout. The existing `RESUME_PROTOCOL_PYTHON` selects Python; Moka requires `pycryptodome` in that interpreter. Its absence is a source failure, never a zero-job success.

The bounded subprocess bridge calls the pinned existing parsers. It observes their page requests, validates structure and unique source IDs, and refuses swallowed failures, incomplete totals and full final pages at the page budget. Moka retains its supported page size of 50. Response size, collection time and parallelism are bounded. The process receives runtime/proxy environment only; model keys and candidate facts are not passed. Public results are validated against the declared employer host and IDs before import. Only explicit separate duties and requirements establish a verified JD; longer text alone does not. A source returning zero records is reachable, not proof that an employer has no openings.

Registered entries are not a claim of live coverage. `job_knowledge_sources` and timestamped `data/job-audits/hiring-radar-sync-*.json` contain actual successes, empty results and failures. A partial run returns a nonzero exit code while preserving successful sources and previous nonexpired cache records. Normal searches can use a fresh cache during background collection; operator `cacheOnly` queries never fetch.

## Cleaning and duplicate results

```powershell
npm run jobs:clean
npm run jobs:clean -- --apply
```

The default command previews changes using a copy. Apply first creates a SQLite backup in `data/job-audits/`, then atomically cleans public job rows and rebuilds their index entries. `job_knowledge_cleaning_originals` preserves the first original normalized payload for each source record. Candidate tables, selected target jobs and resume variants are never rewritten. Repeating the command is idempotent.

- Company/title text uses Unicode normalization and whitespace cleanup. Known source prefixes are removed from the company display name; original names/titles remain available. Only a small explicit company alias mapping is used; legal subsidiaries are not broadly collapsed into parent brands.
- Recruitment events/navigation are quarantined from search, retaining source rows and a reason. Recruitment batches remain identifiable `recruitment_batch` leads; they do not become complete individual JDs.
- Results merge copies with the same canonical posting URL, stripping tracking parameters and normalizing HTTP/HTTPS. Alternate Tencent/Feishu/Moka portal URLs can also merge when the official tenant/site and requisition identity agree. Conflicting known cities/types stay separate; unknown metadata only joins one unambiguous group. Shared list pages use original source posting IDs. Similar titles at different URLs are not enough to merge jobs; distinct official requisition IDs stay separate.
- The best supported copy is shown and `provenance` retains each contributing feed, source job ID, URL, observed/fetched time and provider revision. Raw per-source records are retained so merges remain reversible and source failures stay attributable.
- Large-company name matching excludes the `京东方`/`京东` substring collision. Absence from the large-company list still means unknown size, not a verified small employer.

Deduplication affects the query result view, rather than destroying duplicate source rows. Audit reports distinguish retained source records from unique visible results.

The second quality pass also distinguishes recruitment announcements from individual positions. Batches are shown as `招聘公告 · 需确认具体岗位` and cannot pass source-completeness eligibility checks. Explicit closure or one valid unambiguous past deadline excludes a listing; invalid dates, date ranges and tentative extensions do not establish expiration. Deadline comparisons use UTC calendar dates. A historical aggregated notice can be quarantined using its old recruitment year and publication date, but a recent official observation takes precedence. An old publication date alone creates a warning, not automatic removal.

Cached official text can supply missing structured requirements through the existing JD parser. Promotion requires the registry's declared official host (and Moka tenant/site path), one explicit responsibilities section and one explicit requirements section, both complete and nonempty within parser bounds. Benefits/culture sections are excluded; ambiguous alternative roles and truncated bodies remain unverified. `jdEvidence` records the cached-source URL, observation time and provider revision. This extraction does not imply a fresh network read or independent semantic validation of every requirement. Aggregator summaries remain unverified.

## Verification

`node --test server/hiringRadar.test.js server/jobDataQuality.test.js` covers the adapter, upstream subprocess bridge fixtures (when installed), truthful failure/cache retention, event filtering, conservative merges, provenance, idempotent cleanup and candidate-table preservation. Existing job source/service and app integration regressions cover the shared call path. Live collection is separate from offline tests; upstream advertised company counts are never acceptance evidence.

2026-10-27 local acceptance: all 164 declared domestic entries were attempted. After correcting Moka's supported page size and rechecking failures, 156 returned postings, five returned empty lists, and three remained failed (智谱: incompatible Feishu response; 乐元素: invalid posting identity; Marriott: page budget reached). The provider added 30,545 active source rows. The combined cache held 34,624 active source rows and 34,562 unique visible results; 62 proven duplicate copies were merged in the result view, 480 historical/source records were quarantined as events/navigation, and 318 active records remained labelled recruitment batches. These are snapshot counts across industries, not candidate matches or a count of verified small/mid-size companies. The idempotent cleanup reported zero further record changes. Local backup, individual-source status and search samples are recorded in `data/job-audits/hiring-radar-acceptance.json` and timestamped audit files.

2026-10-27 second-pass acceptance supersedes those cache counts: 34,618 active source rows produce 34,546 unique visible results, merging 72 duplicate copies (10 additional). All 43,541 stored source identities remain recoverable. Six additional event/historical records were quarantined, bringing the historical/source total to 486. Of the active source rows, 34,294 are individual postings and 324 are recruitment batches. Explicit official sections supplemented requirements on 4,082 records; 14,969 active source records now have verified description evidence. No additional record had a provable expired deadline in this snapshot; 11,955 active rows retain an old-publication warning instead of being silently removed. The 840 distinct company strings are not a verified company-size census.

The repeat preview reports zero changed records and zero evidence upgrades. All 19 non-job tables matched the pre-apply backup exactly, all source record identities were preserved, and all 171 persisted source counts matched their retained active records while other source-state metadata stayed unchanged. Unified cache searches verified an upgraded official role, an excluded historical notice, a labelled batch, retained distinct Tencent requisitions and merged provenance. Eight live examples from Boke and Geely matched their cached text; this is a sample, not a freshness claim for the entire cache. The 482 same-title/location/type candidate groups were not bulk-merged. Detailed evidence and the full backup location are in `data/job-audits/job-quality-round-two-acceptance.json`.

The subsequent candidate-oriented search acceptance corrected 702 official source rows whose explicit campus/intern titles conflicted with a generic social portal type; `rawType` and the pre-apply SQLite backup preserve their prior values. Overall retained/unique counts above remain unchanged. Candidate eligibility now influences ordering before pagination, with complete relevant individual postings preferred to incomplete summaries. Candidate decisions remain response-local. See `docs/job-search-acceptance.md` and `npm run jobs:check-search` for the sample scenarios, limitations and repeatable cache checks.
