/**
 * 鱼篓 (Creel) - 后台服务脚本 (Badge 角标实时联动)
 */

function updateBadge(count, enabled = true) {
  if (!enabled || !count || count <= 0) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const text = count > 999 ? '999+' : String(count);
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: '#ff5449' });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'UPDATE_BADGE') {
    chrome.storage.local.get(['bili_antibot_config'], (res) => {
      const enabled = res.bili_antibot_config?.enabled !== false;
      updateBadge(msg.count, enabled);
    });
  }
});

// 监听 storage 改变
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    chrome.storage.local.get(['bili_antibot_stats', 'bili_antibot_config'], (res) => {
      const enabled = res.bili_antibot_config?.enabled !== false;
      const count = res.bili_antibot_stats?.blockedCount || 0;
      updateBadge(count, enabled);
    });
  }
});

// 初始化
chrome.storage.local.get(['bili_antibot_stats', 'bili_antibot_config'], (res) => {
  const enabled = res.bili_antibot_config?.enabled !== false;
  const count = res.bili_antibot_stats?.blockedCount || 0;
  updateBadge(count, enabled);
});
