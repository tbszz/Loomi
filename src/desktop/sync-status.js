/** Phase 2 supplies these contract states through the preload bridge. */
export function syncStatusLabel(status) {
  switch (status?.state) {
    case 'local': case 'local only': return '仅保存在本机';
    case 'syncing': return '正在同步';
    case 'synced': return '已同步';
    case 'offline': return `离线（${Math.max(0, Math.floor(Number(status.pending) || 0))} 项待上传）`;
    case 'error': return `同步出错（${status.message || '请稍后重试'}）`;
    default: return '同步出错（无法识别账户状态）';
  }
}
