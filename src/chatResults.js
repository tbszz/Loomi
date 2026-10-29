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

export function formatJobPoolSummary(data = {}) {
  const shown = countShownJobs(data);
  const total = finiteNonNegative(data.total);
  const offset = finiteNonNegative(data.offset) ?? 0;
  const hasMore = data.hasMore === true;
  if(Number(data.mergedSearches)>1) return `已汇总 ${shown} 条岗位线索${hasMore ? " · 可换一批" : ""}`;
  if (total !== null && shown > 0) {
    const start = Math.min(offset + 1, total);
    const end = Math.min(offset + shown, total);
    return `本页 ${start}-${end} / ${total}${hasMore ? " · 可换一批" : ""}`;
  }
  if (total !== null) return `岗位池 ${total} 条${hasMore ? " · 可换一批" : ""}`;
  return hasMore ? "还有更多来源结果" : "";
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
