import { createTranslator } from '../i18n.js';
/** Phase 2 supplies these contract states through the preload bridge. */
export function syncStatusLabel(status, t = createTranslator()) {
  switch (status?.state) {
    case 'local': case 'local only': return t("sync.storedOnlyOnThisComputer");
    case 'syncing': return t("sync.syncing");
    case 'synced': return t("sync.synced");
    case 'offline': return t("sync.offlinePendingUploads", { count: Math.max(0, Math.floor(Number(status.pending) || 0)) });
    case 'error': return t("sync.syncError", { message: status.message || t("sync.tryAgainLater") });
    default: return t("sync.syncErrorUnknownAccountStatus");
  }
}
