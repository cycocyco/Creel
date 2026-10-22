/**
 * 鱼篓 (Creel) - Popup 交互逻辑 (v3.0.0 MD3 暗色规范版)
 */

const DEFAULT_CONFIG = {
  enabled: true,
  blockMode: 'hide',
  enableClusterDetect: true,
  enablePatternDetect: true,
  enableAtSpamDetect: true,
  // 默认靶向昵称池
  nameKeywords: ['大肥鱼', '家的DSH', '包鱼的DSH', '小鲛鱼', '鲸鲸', '的肥鱼'],
  // 针对评论正文的关键词/正则
  customKeywords: [
    '作为AI', '语言模型', '生成完毕',
    '选对壳真的影响钱包喵',
    '主人拿自己的活',
    '输出token才是账单',
    '输入几乎白送'
  ],
  blacklistUsers: []
};

let currentConfig = { ...DEFAULT_CONFIG };
let nameFilterQuery = '';
let keywordFilterQuery = '';

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  loadData();
  bindEvents();
});

// 选项卡切换
function initTabs() {
  const tabs = document.querySelectorAll('.tab-item');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPanel = document.getElementById(`panel-${tab.dataset.tab}`);
      if (targetPanel) targetPanel.classList.add('active');
    });
  });
}

// 加载持久化数据与状态
function loadData() {
  chrome.storage.local.get(['bili_antibot_config'], (res) => {
    if (res.bili_antibot_config) {
      currentConfig = { ...DEFAULT_CONFIG, ...res.bili_antibot_config };
    }

    updateStatusTheme(currentConfig.enabled);

    // 查询当前标签页的单页捕获数量
    queryCurrentTabPageCount();

    // 系统开关同步
    document.getElementById('mainToggle').checked = currentConfig.enabled;
    document.getElementById('enableClusterDetect').checked = currentConfig.enableClusterDetect;
    document.getElementById('enableAtSpamDetect').checked = currentConfig.enableAtSpamDetect;
    document.getElementById('enablePatternDetect').checked = currentConfig.enablePatternDetect;

    // 渲染列表
    renderNameRules();
    renderKeywords();
    renderBlacklist();
  });
}

// 查询当前活动标签页的本页捕获量
function queryCurrentTabPageCount() {
  if (typeof chrome === 'undefined' || !chrome.tabs) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs && tabs[0];
    if (currentTab && currentTab.id) {
      chrome.runtime.sendMessage({ type: 'GET_TAB_PAGE_COUNT', tabId: currentTab.id }, (res) => {
        const pageCount = (res && typeof res.pageCount === 'number') ? res.pageCount : 0;
        const pageEl = document.getElementById('pageBlockedCount');
        if (pageEl) pageEl.innerText = pageCount;
      });
    }
  });
}

// 更新状态重点色主题 (开启: 红色捕杀 | 未开启: 蓝色放行)
function updateStatusTheme(isEnabled) {
  const body = document.body;
  const statusLabel = document.getElementById('statusLabel');

  if (isEnabled) {
    body.classList.remove('theme-inactive');
    body.classList.add('theme-active');
    if (statusLabel) statusLabel.innerText = '捕杀中';
  } else {
    body.classList.remove('theme-active');
    body.classList.add('theme-inactive');
    if (statusLabel) statusLabel.innerText = '已放行';
  }
}

// 批量解析输入文本 (支持逗号、换行、分号隔开多条批量添加)
function parseBatchInput(rawText) {
  if (!rawText) return [];
  // 如果以 / 开头并且以 / 结尾，作为单条正则不拆分
  const trimmed = rawText.trim();
  if (trimmed.startsWith('/') && trimmed.length > 2 && trimmed.lastIndexOf('/') > 0) {
    return [trimmed];
  }
  // 否则按空格、中英文逗号、换行隔开
  return trimmed
    .split(/[\s,，;；\n]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// 绑定交互事件
function bindEvents() {
  // 总开关 (红蓝主题切换)
  document.getElementById('mainToggle').addEventListener('change', (e) => {
    currentConfig.enabled = e.target.checked;
    updateStatusTheme(currentConfig.enabled);
    saveConfig();
  });

  // 子功能开关
  document.getElementById('enableClusterDetect').addEventListener('change', (e) => {
    currentConfig.enableClusterDetect = e.target.checked;
    saveConfig();
  });

  document.getElementById('enableAtSpamDetect').addEventListener('change', (e) => {
    currentConfig.enableAtSpamDetect = e.target.checked;
    saveConfig();
  });

  document.getElementById('enablePatternDetect').addEventListener('change', (e) => {
    currentConfig.enablePatternDetect = e.target.checked;
    saveConfig();
  });

  // 1. 昵称规则添加 (支持批量)
  const handleAddNameRule = () => {
    const input = document.getElementById('nameRuleInput');
    const items = parseBatchInput(input.value);
    if (!items.length) return;

    if (!currentConfig.nameKeywords) currentConfig.nameKeywords = [];
    let added = 0;
    for (const item of items) {
      if (!currentConfig.nameKeywords.includes(item)) {
        currentConfig.nameKeywords.unshift(item);
        added++;
      }
    }

    if (added > 0) {
      saveConfig();
      renderNameRules();
    }
    input.value = '';
  };

  document.getElementById('addNameRuleBtn').addEventListener('click', handleAddNameRule);
  document.getElementById('nameRuleInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddNameRule();
  });

  // 昵称搜索筛选 (支持百条快速过滤)
  document.getElementById('searchNameRules').addEventListener('input', (e) => {
    nameFilterQuery = e.target.value.trim().toLowerCase();
    renderNameRules();
  });

  // 2. 正文规则添加 (支持批量)
  const handleAddKeyword = () => {
    const input = document.getElementById('keywordInput');
    const items = parseBatchInput(input.value);
    if (!items.length) return;

    if (!currentConfig.customKeywords) currentConfig.customKeywords = [];
    let added = 0;
    for (const item of items) {
      if (!currentConfig.customKeywords.includes(item)) {
        currentConfig.customKeywords.unshift(item);
        added++;
      }
    }

    if (added > 0) {
      saveConfig();
      renderKeywords();
    }
    input.value = '';
  };

  document.getElementById('addKeywordBtn').addEventListener('click', handleAddKeyword);
  document.getElementById('keywordInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddKeyword();
  });

  document.getElementById('searchKeywordRules').addEventListener('input', (e) => {
    keywordFilterQuery = e.target.value.trim().toLowerCase();
    renderKeywords();
  });

  // 3. 精确黑名单添加
  document.getElementById('addBlacklistBtn').addEventListener('click', () => {
    const input = document.getElementById('blacklistInput');
    const val = input.value.trim();
    if (!val) return;

    const isUid = /^\d+$/.test(val);
    const item = {
      uid: isUid ? val : '',
      name: isUid ? '' : val,
      reason: '精确指定',
      time: new Date().toLocaleDateString()
    };

    currentConfig.blacklistUsers.unshift(item);
    input.value = '';
    saveConfig();
    renderBlacklist();
  });

  // 导出规则
  document.getElementById('exportBtn').addEventListener('click', () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(currentConfig, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `Creel_rules_${Date.now()}.json`);
    dlAnchor.click();
    dlAnchor.remove();
  });

  // 导入规则
  const importInput = document.getElementById('importFileInput');
  document.getElementById('importBtn').addEventListener('click', () => {
    importInput.click();
  });

  importInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (imported) {
          currentConfig = { ...currentConfig, ...imported };
          saveConfig();
          loadData();
        }
      } catch (err) {
        console.error('导入文件解析错误', err);
      }
    };
    reader.readAsText(file);
  });
}

// 保存配置并更新计数
function saveConfig() {
  chrome.storage.local.set({ bili_antibot_config: currentConfig }, () => {
    const totalCount = (currentConfig.nameKeywords || []).length;
    document.getElementById('nameRuleCount').innerText = totalCount;
  });
}

// 渲染昵称规则列表 (支持百条流畅滚动与即时搜索)
function renderNameRules() {
  const container = document.getElementById('nameRulesContainer');
  const countBadge = document.getElementById('nameRuleTotal');
  const list = currentConfig.nameKeywords || [];

  countBadge.innerText = `共 ${list.length} 条`;
  document.getElementById('nameRuleCount').innerText = list.length;
  container.innerHTML = '';

  const displayList = nameFilterQuery
    ? list.filter(item => item.toLowerCase().includes(nameFilterQuery))
    : list;

  if (displayList.length === 0) {
    container.innerHTML = '<div class="empty-placeholder">无匹配规则</div>';
    return;
  }

  displayList.forEach((kw) => {
    const realIndex = list.indexOf(kw);
    const isRegex = kw.startsWith('/') && kw.length > 2;

    const chip = document.createElement('div');
    chip.className = `rule-chip ${isRegex ? 'is-regex' : ''}`;
    chip.innerHTML = `
      <span class="chip-text" title="${escapeHtml(kw)}">${escapeHtml(kw)}</span>
      <span class="chip-del" title="删除">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </span>
    `;

    chip.querySelector('.chip-del').addEventListener('click', (e) => {
      e.stopPropagation();
      if (realIndex !== -1) {
        currentConfig.nameKeywords.splice(realIndex, 1);
        saveConfig();
        renderNameRules();
      }
    });

    container.appendChild(chip);
  });
}

// 渲染评论特征规则
function renderKeywords() {
  const container = document.getElementById('keywordsContainer');
  const countBadge = document.getElementById('keywordRuleTotal');
  const list = currentConfig.customKeywords || [];

  countBadge.innerText = `共 ${list.length} 条`;
  container.innerHTML = '';

  const displayList = keywordFilterQuery
    ? list.filter(item => item.toLowerCase().includes(keywordFilterQuery))
    : list;

  if (displayList.length === 0) {
    container.innerHTML = '<div class="empty-placeholder">无匹配规则</div>';
    return;
  }

  displayList.forEach((kw) => {
    const realIndex = list.indexOf(kw);
    const isRegex = kw.startsWith('/') && kw.length > 2;

    const chip = document.createElement('div');
    chip.className = `rule-chip ${isRegex ? 'is-regex' : ''}`;
    chip.innerHTML = `
      <span class="chip-text" title="${escapeHtml(kw)}">${escapeHtml(kw)}</span>
      <span class="chip-del" title="删除">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </span>
    `;

    chip.querySelector('.chip-del').addEventListener('click', (e) => {
      e.stopPropagation();
      if (realIndex !== -1) {
        currentConfig.customKeywords.splice(realIndex, 1);
        saveConfig();
        renderKeywords();
      }
    });

    container.appendChild(chip);
  });
}

// 渲染精确黑名单
function renderBlacklist() {
  const container = document.getElementById('blacklistContainer');
  container.innerHTML = '';

  const list = currentConfig.blacklistUsers || [];
  if (list.length === 0) {
    container.innerHTML = '<div class="empty-placeholder">无指定黑名单</div>';
    return;
  }

  list.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'list-row';
    const displayName = item.name || `UID:${item.uid}`;

    row.innerHTML = `
      <span class="list-row-name">${escapeHtml(displayName)}</span>
      <span class="chip-del" title="移出">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </span>
    `;

    row.querySelector('.chip-del').addEventListener('click', () => {
      currentConfig.blacklistUsers.splice(index, 1);
      saveConfig();
      renderBlacklist();
    });

    container.appendChild(row);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, function (m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
  });
}
