const oneLine = (value, max) => String(value || '').replace(/\s+/gu, ' ').trim().slice(0, max);
const pendingReason = (eligibility = {}) => eligibility.reason || (eligibility.checks || [])
  .filter(check => ['fail', 'unknown'].includes(check.status)).map(check => check.message).join('；');

// Model-facing allowlists only. Never mutate the full search/UI records.
export function compactJobCard(job) {
  return {
    id: job.id, title: job.title, company: job.company, location: job.location, type: job.type,
    ...(job.deadline ? { deadline: job.deadline } : {}), largeCompany: job.largeCompany,
    retrievalMatch: job.retrievalMatch, fullDescriptionVerified: job.fullDescriptionVerified,
    eligibility: { status: job.eligibility?.status, reason: oneLine(pendingReason(job.eligibility), 120) }
  };
}

export function compactRejectedJob(job) {
  const failed = job.eligibility?.checks?.find(check => check.status === 'fail');
  return { id: job.id, title: job.title, company: job.company, reason: oneLine(failed?.message || pendingReason(job.eligibility), 120) };
}

export function compactSources(sources = []) {
  const failed = sources.filter(source => source?.error || source?.ok === false || source?.syncStatus === 'failed' || source?.status === 'failed');
  const failures = new Set(failed);
  const ok = sources.filter(source => source && !failures.has(source) && (
    source.ok === true || ['synced', 'reachable'].includes(source.syncStatus)
    || source.fetchedAt || source.lastSuccess || source.last_success || source.count > 0
  )).length;
  return {
    total: sources.length, ok, failed: failed.length,
    failedSample: failed.slice(0, 3).map(source => ({
      ...(source.id ? { id: source.id } : { name: source.name || source.label || source.company || '未知来源' }),
      error: oneLine(source.error || '来源读取失败', 80)
    }))
  };
}

export function jobDetails(job) {
  const description = String(job.description || '');
  return {
    id: job.id, title: job.title, company: job.company, location: job.location, type: job.type,
    url: job.url, deadline: job.deadline, source: job.source, fullDescriptionVerified: job.fullDescriptionVerified,
    description: description.slice(0, 4000), ...(description.length > 4000 ? { descriptionTruncated: true } : {}),
    requirements: (job.requirements || []).slice(0, 30),
    eligibility: {
      status: job.eligibility?.status, reason: job.eligibility?.reason,
      checks: (job.eligibility?.checks || []).map(({ dimension, status, message, question }) => ({
        dimension, status, message, ...(question ? { question } : {})
      }))
    }
  };
}
