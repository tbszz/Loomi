/**
 * Reconcile "how many rows we fetch" against "how many the API says it has".
 *
 * This is the check that found the seventh round's three silent truncations
 * (字节社招 3%, 字节校招 7%, 腾讯社招 13%).  All three looked healthy: HTTP 200,
 * valid shape, plausible row counts, a sync that reported success.  The only
 * thing wrong with them was that the page walk ended because it ran out of
 * *declared* pages, not because it ran out of board — and nothing compared the
 * two numbers, so nothing noticed.
 *
 * It is deliberately NOT part of `npm test`: it makes live requests to real
 * employer sites.  Run it on demand, or from a nightly job, next to the other
 * network checks (`test:live`, `test:real-model`).
 *
 * Two independent signals, because each covers the other's blind spot:
 *
 *   1. the total the API reports about itself (primary, when discoverable)
 *   2. whether the LAST declared page comes back full (fallback)
 *
 * A full last page means the board continues past where we stopped.  That is
 * the exact condition the loader treats as "keep going" — except here it has
 * nothing left to keep going with.
 *
 * Exit code is non-zero if any source is truncated, so this can gate a job.
 */

import { getOfficialJobSources } from "../server/officialJobSources.js";

const USER_AGENT = "ResumeProtocol-OfficialJobSource/1.1";
const TIMEOUT_MS = 15_000;
const CONCURRENCY = 4;

async function fetchJson(request) {
  const hasBody = request.body !== undefined;
  const response = await fetch(request.url, {
    method: request.method || "GET",
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(request.headers || {})
    },
    body: hasBody ? JSON.stringify(request.body) : undefined,
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`source_invalid_json (HTTP ${response.status}, ${raw.length} bytes)`);
  }
}

/**
 * Find the total the API reports about itself, without hard-coding one field
 * name per platform.  Each family spells it differently — ATSX `count`, 北森
 * `Count`, 腾讯 `Data.Count`, 网易 `data.total`, 美团 `data.totalCount` — and a
 * hard-coded table would rot silently, which is the failure mode this script
 * exists to catch.  So: walk the payload's scalars, keep the numeric ones that
 * are at least as large as the page we just read, and prefer count-ish names.
 */
function discoverTotals(payload, minimum) {
  const found = [];
  const walk = (value, path, depth) => {
    if (depth > 4 || found.length > 60) return;
    if (Array.isArray(value)) return; // never descend into the rows themselves
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const next = path ? `${path}.${key}` : key;
      if (typeof child === "number" && Number.isFinite(child)) found.push({ path: next, value: child });
      else if (typeof child === "string" && /^\d+$/.test(child)) found.push({ path: next, value: Number(child) });
      else walk(child, next, depth + 1);
    }
  };
  walk(payload, "", 0);
  const plausible = found.filter(entry => entry.value >= minimum);
  const named = plausible.filter(entry => /count|total/i.test(entry.path));
  return { best: (named[0] || plausible[0]) || null, all: plausible };
}

function declaredReach(adapter) {
  const pages = Math.max(1, Math.min(Number(adapter.pages) || 1, 50));
  const pageSize = Number(adapter.pageSize) || 100;
  return { pages, pageSize, reach: pages * pageSize };
}

/** What the request actually asks for, which is not always what the adapter declares. */
function askedForPageSize(request, body) {
  const url = new URL(request.url);
  return body?.limit ?? body?.pageSize ?? body?.PageSize ?? body?.page?.pageSize
    ?? Number(url.searchParams.get("pageSize")) ?? null;
}

async function probe(source) {
  const adapter = source.adapter;
  const { pages, pageSize, reach } = declaredReach(adapter);
  const firstRequest = adapter.request(1, source);
  const firstBody = typeof firstRequest.body === "string" ? JSON.parse(firstRequest.body) : firstRequest.body;
  const firstPayload = await fetchJson(firstRequest);
  const firstItems = adapter.pick(firstPayload);
  if (!Array.isArray(firstItems)) throw new Error("source_invalid_shape");

  const { best, all } = discoverTotals(firstPayload, firstItems.length);

  // Only fetch a second page when the source actually declares more than one.
  let lastLength = null;
  if (pages > 1) {
    const lastPayload = await fetchJson(adapter.request(pages, source));
    const lastItems = adapter.pick(lastPayload);
    if (Array.isArray(lastItems)) lastLength = lastItems.length;
  }

  const asked = askedForPageSize(firstRequest, firstBody);
  const problems = [];

  // A declared page size that the request does not actually send makes page 1
  // look "short", and the walk stops after it — a whole source silently becomes
  // zero rows while still reporting success.  The offline test asserts this too;
  // re-checking live costs nothing and catches an adapter built after the test.
  if (asked !== pageSize) problems.push(`declares pageSize ${pageSize} but the request sends ${asked}`);

  // Headroom is the whole point of declaring pages at all.  Less than one page
  // of it means the source is one hiring round away from silently truncating —
  // which is how 字节社招 sat at 3% for as long as it did, unnoticed.
  const headroom = best ? reach - best.value : null;

  let verdict = "ok";
  if (best && best.value > reach) {
    verdict = "truncated";
    problems.push(`API reports ${best.value} rows (${best.path}); declared reach is only ${reach}`);
  } else if (lastLength !== null && lastLength === pageSize) {
    verdict = "truncated";
    problems.push(`page ${pages} came back full (${lastLength} rows), so the board continues past our declared reach`);
  } else if (headroom !== null && headroom < pageSize) {
    verdict = "tight";
    problems.push(`only ${headroom} rows of headroom: reach ${reach} vs reported ${best.value} (${best.path}) — one more page of listings tips this into truncation`);
  } else if (best === null) {
    verdict = "unreconciled";
    problems.push(`no self-reported total found; page 1 alone cannot prove coverage`);
  } else if (lastLength === 0) {
    verdict = "slack";
  }

  return {
    id: source.id, company: source.company, pages, pageSize, reach,
    firstPage: firstItems.length, lastPage: lastLength,
    reportedTotal: best ? best.value : null,
    reportedTotalPath: best ? best.path : null,
    candidates: all.filter(entry => entry.path !== best?.path).slice(0, 3),
    asked, verdict, problems
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

const targets = getOfficialJobSources().filter(source => source.adapter.kind === "json-api");
console.log(`Reconciling ${targets.length} json-api sources against their own reported totals…\n`);

const results = await mapWithConcurrency(targets, CONCURRENCY, async (source) => {
  try {
    return await probe(source);
  } catch (error) {
    return { id: source.id, company: source.company, verdict: "error", problems: [String(error.message || error)], candidates: [] };
  }
});

const order = { truncated: 0, error: 1, tight: 2, unreconciled: 3, slack: 4, ok: 5 };
results.sort((a, b) => (order[a.verdict] - order[b.verdict]) || a.id.localeCompare(b.id));

const pad = (value, width) => String(value ?? "—").padEnd(width);
console.log(`${pad("source", 22)}${pad("verdict", 14)}${pad("declared", 14)}${pad("reported", 12)}${pad("page1", 8)}${pad("last", 8)}`);
console.log("-".repeat(78));
for (const row of results) {
  const declared = row.pages ? `${row.pages}×${row.pageSize}=${row.reach}` : "—";
  console.log(
    `${pad(row.id, 22)}${pad(row.verdict, 14)}${pad(declared, 14)}${pad(row.reportedTotal, 12)}${pad(row.firstPage, 8)}${pad(row.lastPage, 8)}`
  );
}

const flagged = results.filter(row => ["truncated", "error", "tight", "unreconciled"].includes(row.verdict));
if (flagged.length) {
  console.log("");
  for (const row of flagged) {
    console.log(`${row.verdict.toUpperCase()} ${row.id}`);
    for (const problem of row.problems) console.log(`  - ${problem}`);
    for (const candidate of row.candidates) console.log(`  (other numeric fields: ${candidate.path} = ${candidate.value})`);
  }
}

const truncated = results.filter(row => row.verdict === "truncated").length;
const count = verdict => results.filter(row => row.verdict === verdict).length;
console.log(`\n${results.length} sources: ${truncated} truncated, ${count("tight")} tight, ${count("error")} errored, ${count("unreconciled")} unreconciled, ${count("slack")} slack, ${count("ok")} ok`);
process.exit(truncated || results.some(r => r.verdict === "error") ? 1 : 0);
