import { createTranslator } from './i18n.js';
export function normalizeResultItems(items = []) {
  return items
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (!item || typeof item !== "object") return "";
      const label = String(item.label || item.title || "").trim();
      const detail = String(item.prompt || item.evidence || item.description || "").trim();
      if (label && detail) return label + "：" + detail;
      return label || detail;
    })
    .filter(Boolean);
}

export function formatJobPoolSummary(data = {}, t = createTranslator()) {
  const shown = countShownJobs(data);
  const total = finiteNonNegative(data.total);
  const offset = finiteNonNegative(data.offset) ?? 0;
  const hasMore = data.hasMore === true;
  if(Number(data.mergedSearches)>1) return t("jobs.collectedJobLeads", { count: shown, more: hasMore ? t("jobs.moreAvailable") : "" });
  if (total !== null && shown > 0) {
    const start = Math.min(offset + 1, total);
    const end = Math.min(offset + shown, total);
    return t("jobs.thisPage", { start: start, end: end, total: total, more: hasMore ? t("jobs.moreAvailable") : "" });
  }
  if (total !== null) return t("jobs.jobPool", { total: total, more: hasMore ? t("jobs.moreAvailable") : "" });
  return hasMore ? t("jobs.moreSourceResultsAvailable") : "";
}

function countShownJobs(data) {
  const explicit = finiteNonNegative(data.count ?? data.currentCount);
  if (explicit !== null) return explicit;
  return ["jobs", "uncertainties", "related", "rejected"].reduce((sum, key) => (
    sum + (Array.isArray(data[key]) ? data[key].length : 0)
  ), 0);
}

function finiteNonNegative(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.trunc(number);
}
