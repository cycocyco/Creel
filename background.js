/**
 * 鱼篓 (Creel) - 后台服务脚本 (Badge 标签页专属角标与统计管理)
 */

// 维护每个 Tab 的本页捕获计数: Map<tabId, number>
const tabBlockedCounts = new Map();

// 更新指定 Tab 的角标
function updateTabBadge(tabId, count, enabled = true) {
  if (!tabId) return;
  if (!enabled || !count || count <= 0) {
    chrome.action.setBadgeText({ tabId, text: '' });
    return;
  }
  const text = count > 999 ? '999+' : String(count);
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#ff5449' });
}

// 监听来自 content.js 的本页数据更新
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'UPDATE_PAGE_STATS') {
    const tabId = sender.tab?.id;
    const pageCount = msg.pageCount || 0;
    const addCount = msg.addCount || 0;

    if (tabId) {
      tabBlockedCounts.set(tabId, pageCount);
      chrome.storage.local.get(['bili_antibot_config'], (res) => {
        const enabled = res.bili_antibot_config?.enabled !== false;
        updateTabBadge(tabId, pageCount, enabled);
      });
    }

    // 累加全局历史总数
    if (addCount > 0) {
      chrome.storage.local.get(['bili_antibot_stats'], (res) => {
        const currentTotal = res.bili_antibot_stats?.totalBlockedCount ?? res.bili_antibot_stats?.blockedCount ?? 0;
        const newTotal = currentTotal + addCount;
        chrome.storage.local.set({
          bili_antibot_stats: {
            totalBlockedCount: newTotal,
            blockedCount: newTotal,
            lastActive: Date.now()
          }
        });
      });
    }
    sendResponse({ ok: true });
    return true;
  }

  // Popup 查询当前 Tab 的本页拦截数
  if (msg.type === 'GET_TAB_PAGE_COUNT') {
    const count = (msg.tabId && tabBlockedCounts.get(msg.tabId)) || 0;
    sendResponse({ pageCount: count });
    return true;
  }

  // 重置全局累计计数
  if (msg.type === 'RESET_TOTAL_STATS') {
    chrome.storage.local.set({
      bili_antibot_stats: {
        totalBlockedCount: 0,
        blockedCount: 0,
        lastActive: Date.now()
      }
    }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }
});

// 当 Tab 刷新或跳转导航时，当前页计数归零
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabBlockedCounts.set(tabId, 0);
    chrome.action.setBadgeText({ tabId, text: '' });
  }
});

// 当 Tab 关闭时清理内存
chrome.tabs.onRemoved.addListener((tabId) => {
  tabBlockedCounts.delete(tabId);
});

// 全局配置变更（如开启/关闭主开关）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.bili_antibot_config) {
    const enabled = changes.bili_antibot_config.newValue?.enabled !== false;
    for (const [tabId, count] of tabBlockedCounts.entries()) {
      updateTabBadge(tabId, count, enabled);
    }
  }
});
