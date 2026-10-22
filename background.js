/**
 * 鱼篓 (Creel) - 后台服务脚本 (仅管理当前标签页实时角标)
 */

// 维护每个 Tab 当前视频页的拦截数: Map<tabId, number>
const tabBlockedCounts = new Map();

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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 当前页面新增拦截
  if (msg.type === 'UPDATE_PAGE_STATS') {
    const tabId = sender.tab?.id;
    const pageCount = msg.pageCount || 0;

    if (tabId) {
      tabBlockedCounts.set(tabId, pageCount);
      chrome.storage.local.get(['bili_antibot_config'], (res) => {
        const enabled = res.bili_antibot_config?.enabled !== false;
        updateTabBadge(tabId, pageCount, enabled);
      });
    }
    sendResponse({ ok: true });
    return true;
  }

  // Popup 查询当前 Tab 拦截数
  if (msg.type === 'GET_TAB_PAGE_COUNT') {
    const count = (msg.tabId && tabBlockedCounts.get(msg.tabId)) || 0;
    sendResponse({ pageCount: count });
    return true;
  }
});

// 网页刷新或导航时，角标与计数自然归零
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabBlockedCounts.set(tabId, 0);
    chrome.action.setBadgeText({ tabId, text: '' });
  }
});

// 标签页关闭时清理内存
chrome.tabs.onRemoved.addListener((tabId) => {
  tabBlockedCounts.delete(tabId);
});

// 开关切换
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.bili_antibot_config) {
    const enabled = changes.bili_antibot_config.newValue?.enabled !== false;
    for (const [tabId, count] of tabBlockedCounts.entries()) {
      updateTabBadge(tabId, count, enabled);
    }
  }
});
