/**
 * B站 AI BOT 评论净化器 - 核心内容脚本 (Shadow DOM 穿透强化版)
 */

(function () {
  'use strict';

  console.log('[BiliAntiBot] 脚本注入成功，正在初始化...');

  // 默认配置
  const DEFAULT_CONFIG = {
    enabled: true,
    blockMode: 'hide', // 默认彻底隐藏
    enableClusterDetect: true,
    enablePatternDetect: true,
    enableAtSpamDetect: true,
    clusterMinMatches: 2,
    nameKeywords: ['大肥鱼', '家的DSH', '包鱼的DSH', '小鲛鱼', '鲸鲸'],
    customKeywords: ['作为AI', '主人拿', '语言模型', '生成完毕', '选对壳真的影响钱包喵'],
    blacklistUsers: []
  };

  let config = { ...DEFAULT_CONFIG };
  let blockedCount = 0;

  // 缓存池: 保存解析后的评论对象
  // key: uniqueDomId, value: CommentInfo
  const commentPool = new Map();

  // 监听来自 hook.js 的拦截计数上报
  let pendingBlockCount = 0;
  let saveTimer = null;
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'BILI_ANTIBOT_ADD_STATS' && e.data.count) {
      pendingBlockCount += e.data.count;
      if (saveTimer) clearTimeout(saveTimer);
      // 500ms 轻量防抖写库，完全零性能损耗
      saveTimer = setTimeout(() => {
        blockedCount += pendingBlockCount;
        pendingBlockCount = 0;
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({
            bili_antibot_stats: {
              blockedCount,
              lastActive: Date.now()
            }
          });
          // 同步工具栏图标右下角的捕获数字 Badge
          try {
            chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', count: blockedCount });
          } catch (e) {}
        }
      }, 500);
    }
  });

  // 读取配置
  function loadConfig(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['bili_antibot_config', 'bili_antibot_stats'], (res) => {
        if (res.bili_antibot_config) {
          config = { ...DEFAULT_CONFIG, ...res.bili_antibot_config };
        }
        if (res.bili_antibot_stats && res.bili_antibot_stats.blockedCount) {
          blockedCount = res.bili_antibot_stats.blockedCount;
        }
        try {
          localStorage.setItem('bili_antibot_config', JSON.stringify(config));
        } catch (e) {}
        console.log('[BiliAntiBot] 配置加载完成:', config);
        // 主动向 hook.js 同步一次配置
        window.postMessage({ type: 'BILI_ANTIBOT_SYNC_CONFIG', data: config }, '*');
        if (callback) callback();
      });
    } else {
      if (callback) callback();
    }
  }

  // 监听配置变更实时生效
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.bili_antibot_config) {
        config = { ...config, ...changes.bili_antibot_config.newValue };
        try {
          localStorage.setItem('bili_antibot_config', JSON.stringify(config));
        } catch (e) {}
        console.log('[BiliAntiBot] 配置更新，重新扫描页面...');
        window.postMessage({ type: 'BILI_ANTIBOT_SYNC_CONFIG', data: config }, '*');
        scanAllComments();
      }
    });
  }

  function recordBlock() {
    blockedCount++;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        bili_antibot_stats: {
          blockedCount,
          lastActive: Date.now()
        }
      });
    }
  }

  function addToBlacklist(uid, name, reason = '手动标记') {
    if (!uid && !name) return;
    const exists = config.blacklistUsers.some(item => (uid && item.uid === uid) || (name && item.name === name));
    if (!exists) {
      config.blacklistUsers.push({
        uid: uid || '',
        name: name || '',
        reason,
        time: new Date().toLocaleDateString()
      });
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ bili_antibot_config: config });
      }
    }
    scanAllComments();
  }

  function removeFromBlacklist(uid, name) {
    config.blacklistUsers = config.blacklistUsers.filter(item => {
      if (uid && item.uid === uid) return false;
      if (name && item.name === name) return false;
      return true;
    });
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ bili_antibot_config: config }, () => {
        // 同步给页面内 MAIN world 的 hook 脚本
        window.postMessage({ type: 'BILI_ANTIBOT_SYNC_CONFIG', data: config }, '*');
      });
    }
    scanAllComments();
  }

  // 特征抽取：数值 + N-gram
  function extractFeatures(text) {
    if (!text) return { numbers: [], ngrams: new Set() };
    const numMatches = text.match(/\d+(?:\.\d+)?(?:%|倍|元|分|款|颗)?/g) || [];
    const specificNums = numMatches.filter(n => n.length > 1 || /\d\.\d/.test(n));
    const cleanText = text.replace(/[\s\p{P}\p{S}]/gu, '');
    const ngrams = new Set();
    const gramLen = 3;
    for (let i = 0; i <= cleanText.length - gramLen; i++) {
      ngrams.add(cleanText.substring(i, i + gramLen));
    }
    return {
      numbers: Array.from(new Set(specificNums)),
      ngrams
    };
  }

  function calculateSimilarity(ngramsA, ngramsB) {
    if (!ngramsA.size || !ngramsB.size) return 0;
    let intersection = 0;
    for (const item of ngramsA) {
      if (ngramsB.has(item)) intersection++;
    }
    const union = ngramsA.size + ngramsB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  function countCommonNumbers(numsA, numsB) {
    if (!numsA.length || !numsB.length) return 0;
    const setB = new Set(numsB);
    return numsA.filter(n => setB.has(n)).length;
  }

  // 深度查找元素（穿透 Shadow DOM）
  function deepFind(root, selector) {
    if (!root) return null;
    if (root.querySelector) {
      const found = root.querySelector(selector);
      if (found) return found;
    }
    // 检查 shadowRoot
    if (root.shadowRoot) {
      const found = root.shadowRoot.querySelector(selector);
      if (found) return found;
      // 遍历 shadowRoot 内部元素
      for (const child of root.shadowRoot.children) {
        const sub = deepFind(child, selector);
        if (sub) return sub;
      }
    }
    // 遍历子元素
    if (root.children) {
      for (const child of root.children) {
        const sub = deepFind(child, selector);
        if (sub) return sub;
      }
    }
    return null;
  }

  // 深度遍历所有评论节点（包括 Shadow Root 内部）
  function collectAllCommentElements(root, result = []) {
    if (!root) return result;

    // 判断当前节点是否是评论外壳
    const tagName = (root.tagName || '').toLowerCase();
    const isCommentThread = tagName === 'bili-comment-thread-renderer';
    const isCommentReply = tagName === 'bili-comment-reply-renderer';
    const isClassicItem = root.classList && (root.classList.contains('reply-item') || root.classList.contains('sub-reply-item'));

    if (isCommentThread || isCommentReply || isClassicItem) {
      result.push(root);
    }

    // 递归普通子节点
    if (root.children) {
      for (let i = 0; i < root.children.length; i++) {
        collectAllCommentElements(root.children[i], result);
      }
    }

    // 递归 shadowRoot
    if (root.shadowRoot && root.shadowRoot.children) {
      for (let i = 0; i < root.shadowRoot.children.length; i++) {
        collectAllCommentElements(root.shadowRoot.children[i], result);
      }
    }

    return result;
  }

  // 从评论容器中解析 用户名、UID、评论文本
  function parseCommentNode(el) {
    let userName = '';
    let uid = '';
    let text = '';

    // 1. 查找用户名和主页链接
    const userLink = deepFind(el, 'a[href*="space.bilibili.com"]');
    if (userLink) {
      const match = userLink.href.match(/space\.bilibili\.com\/(\d+)/);
      if (match) uid = match[1];
      userName = userLink.innerText.trim();
    }

    if (!userName) {
      const userInfoEl = deepFind(el, 'bili-comment-user-info, #user-name, .user-name, .name');
      if (userInfoEl) userName = userInfoEl.innerText.trim();
    }

    // 2. 查找评论正文
    const richTextEl = deepFind(el, 'bili-rich-text, #contents, #content, .reply-content, .text-con');
    if (richTextEl) {
      text = richTextEl.innerText.trim();
    } else {
      // 兜底直接获取文本
      text = el.innerText || '';
    }

    return {
      el,
      uid,
      userName,
      text
    };
  }

  // 屏蔽处理
  function applyBlock(info, reason) {
    if (info.isBlocked) return;
    info.isBlocked = true;
    info.blockReason = reason;

    console.warn(`[BiliAntiBot] 🚫 拦截 BOT 评论: [${info.userName || info.uid}] 原因: ${reason}\n内容: ${info.text.slice(0, 60)}...`);
    recordBlock();

    const el = info.el;
    el.classList.add('bili-antibot-blocked');

    if (config.blockMode === 'hide') {
      // 彻底隐藏：直接强制 style
      el.style.setProperty('display', 'none', 'important');
    } else {
      // 折叠模式
      el.classList.add('bili-antibot-folded');
      insertFoldBanner(info, reason);
    }
  }

  // 恢复放行
  function removeBlock(info) {
    info.isBlocked = false;
    info.blockReason = null;
    const el = info.el;
    el.classList.remove('bili-antibot-blocked', 'bili-antibot-folded', 'bili-antibot-folded-expanded');
    el.style.removeProperty('display');

    const banner = el.querySelector('.bili-antibot-fold-banner');
    if (banner) banner.remove();
  }

  // 插入折叠占位条
  function insertFoldBanner(info, reason) {
    const el = info.el;
    if (el.querySelector('.bili-antibot-fold-banner')) return;

    const banner = document.createElement('div');
    banner.className = 'bili-antibot-fold-banner';
    banner.innerHTML = `
      <div class="bili-antibot-banner-left">
        <span class="bili-antibot-badge">🤖 已拦截BOT</span>
        <span class="bili-antibot-user">${escapeHtml(info.userName || '未知账号')}</span>
        <span class="bili-antibot-reason">(${escapeHtml(reason)})</span>
      </div>
      <div class="bili-antibot-banner-actions">
        <button class="bili-antibot-btn-toggle">展开</button>
        <button class="bili-antibot-btn-unblock">放行</button>
      </div>
    `;

    const toggleBtn = banner.querySelector('.bili-antibot-btn-toggle');
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.classList.contains('bili-antibot-folded-expanded')) {
        el.classList.remove('bili-antibot-folded-expanded');
        toggleBtn.innerText = '展开';
      } else {
        el.classList.add('bili-antibot-folded-expanded');
        toggleBtn.innerText = '收起';
      }
    });

    const unblockBtn = banner.querySelector('.bili-antibot-btn-unblock');
    unblockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromBlacklist(info.uid, info.userName);
      removeBlock(info);
    });

    el.insertBefore(banner, el.firstChild);
  }

  // 注入「🤖屏蔽BOT」快捷按钮
  function injectManualBlockButton(info) {
    const el = info.el;
    if (el.querySelector('.bili-antibot-manual-btn')) return;

    const actionWrap = deepFind(el, 'bili-comment-action-buttons-renderer, .reply-info, .sub-reply-info, #action-list');
    if (!actionWrap) return;

    const btn = document.createElement('span');
    btn.className = 'bili-antibot-manual-btn';
    btn.innerHTML = `<span class="bili-antibot-icon">🤖</span>屏蔽BOT`;
    btn.title = '一键拉黑此BOT账号并隐藏';

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (window.confirm(`确认将账号「${info.userName || info.uid}」拉黑并屏蔽吗？`)) {
        addToBlacklist(info.uid, info.userName, '手动标记');
        applyBlock(info, '手动标记拉黑');
      }
    });

    actionWrap.appendChild(btn);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
  }

  // 判定逻辑
  function checkAndBlock(info) {
    if (!config.enabled) return;
    const { text, userName, uid } = info;
    if (!text) return;

    // 0. 昵称特征词/正则匹配 (严格仅匹配用户名称，绝不触碰评论正文)
    const nameList = config.nameKeywords || [];
    // 精准获取用户名（统一转小写）
    const targetUname = (info.userName || '').toLowerCase().trim();

    if (targetUname) {
      for (let kw of nameList) {
        if (!kw) continue;
        let cleanKw = kw.toLowerCase().trim().replace(/^\*+|\*+$/g, '');
        if (!cleanKw) continue;

        if (cleanKw.startsWith('/') && cleanKw.endsWith('/')) {
          try {
            const reg = new RegExp(cleanKw.slice(1, -1), 'i');
            if (reg.test(targetUname)) {
              applyBlock(info, `命中昵称正则: ${kw}`);
              return;
            }
          } catch (e) {}
        } else {
          // 仅当用户昵称包含关键词时命中，与评论内容完全解耦
          if (targetUname.includes(cleanKw)) {
            applyBlock(info, `命中昵称关键词: [${kw}] -> 用户名「${info.userName}」`);
            return;
          }
        }
      }
    }

    // 1. 黑名单判定 (UID 或 昵称模糊匹配)
    const matchedBlack = config.blacklistUsers.find(b => {
      if (uid && b.uid && b.uid === uid) return true;
      if (userName && b.name) {
        if (b.name === userName) return true;
        // 支持包含匹配 (例如黑名单填 '大肥鱼'，所有 'xxx的大肥鱼' 都会被命中)
        if (b.name.length >= 3 && (userName.includes(b.name) || b.name.includes(userName))) return true;
      }
      return false;
    });

    if (matchedBlack) {
      applyBlock(info, `命中黑名单: ${matchedBlack.name || matchedBlack.uid}`);
      return;
    }

    // 2. 自定义特征词与 Prompt 残留
    if (config.enablePatternDetect) {
      for (const kw of config.customKeywords) {
        if (kw && text.includes(kw)) {
          applyBlock(info, `命中关键词:「${kw}」`);
          return;
        }
      }

      const aiPatterns = [
        /作为(?:一个)?(?:AI|人工智能|语言模型)/i,
        /主人(?:拿|让|叫|给|的)/,
        /选对壳.*影响钱包喵/,
        /输出\s*token\s*才是账单/,
        /同用\s*V\d+\.\d+\s*Flash/i,
        /缓存命中.*输入几乎白送/,
        /最贵和最省差\s*\d+(?:\.\d+)?\s*倍/
      ];

      for (const p of aiPatterns) {
        if (p.test(text)) {
          applyBlock(info, `命中AI指令或句式特征`);
          return;
        }
      }
    }

    // 3. 强行 @路人 + 密集数值刷量
    if (config.enableAtSpamDetect) {
      // 类似 @xxx [内容]，且包含 3 组以上数字特征
      if (/^@\S+/.test(text)) {
        const numCount = (text.match(/\d+(?:\.\d+)?/g) || []).length;
        if (numCount >= 3) {
          applyBlock(info, `疑似@路人密集数据洗稿机 (${numCount}组同频数值)`);
          return;
        }
      }
    }

    // 4. 同屏跨评论聚类检测 (N-gram 与 数值交集)
    if (config.enableClusterDetect) {
      const { numbers, ngrams } = extractFeatures(text);
      info.numbers = numbers;
      info.ngrams = ngrams;

      for (const [id, other] of commentPool.entries()) {
        if (other.el === info.el) continue;
        if (other.userName === info.userName) continue;

        const commonNums = countCommonNumbers(info.numbers, other.numbers);
        const sim = calculateSimilarity(info.ngrams, other.ngrams);

        // 如果同屏评论中共享了 3 个以上相同数值（如 96.5, 97.6%, 2.2），极大概率是同视频提取洗稿矩阵
        if (commonNums >= 3 || (commonNums >= 2 && sim > 0.2)) {
          applyBlock(info, `同屏数值矩阵复读 (与[${other.userName}]重合${commonNums}组关键数据)`);
          if (!other.isBlocked) {
            applyBlock(other, `同屏数值矩阵复读 (与[${info.userName}]重合${commonNums}组关键数据)`);
          }
          return;
        }
      }
    }

    // 如果未被屏蔽，挂载手动标记按钮
    injectManualBlockButton(info);
  }

  let counter = 0;
  // 扫描全页面所有评论
  function scanAllComments() {
    const commentEls = collectAllCommentElements(document.body);
    if (!commentEls.length) return;

    for (const el of commentEls) {
      let id = el.dataset.antibotId;
      if (!id) {
        id = 'ab_' + (++counter);
        el.dataset.antibotId = id;
      }

      let info = commentPool.get(id);
      if (!info) {
        info = parseCommentNode(el);
        info.id = id;
        commentPool.set(id, info);
      } else {
        // 更新可能延迟加载出来的文本或用户名
        if (!info.text || !info.userName) {
          const fresh = parseCommentNode(el);
          info.text = fresh.text || info.text;
          info.userName = fresh.userName || info.userName;
          info.uid = fresh.uid || info.uid;
        }
      }

      checkAndBlock(info);
    }
  }

  // 轮询与 MutationObserver 双引擎
  function initEngine() {
    // 1. 每 1.2 秒轻量扫描一次（有效应对 B站 滚动加载和 Shadow DOM 异步渲染）
    setInterval(() => {
      scanAllComments();
    }, 1200);

    // 2. 监听 DOM 树变化
    const observer = new MutationObserver(() => {
      scanAllComments();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // 首次立即扫描
    setTimeout(scanAllComments, 800);
    setTimeout(scanAllComments, 2000);
  }

  // 启动
  loadConfig(() => {
    initEngine();
    console.log('[BiliAntiBot] 评论区净化器已全面就绪！');
  });

})();
