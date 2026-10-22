/**
 * B站 AI BOT 评论净化器 - 网络数据源拦截 Hook (MAIN World)
 * v2.2.0 - 专门强化针对批量号昵称关键词与正则的无情斩杀
 */

(function () {
  'use strict';

  console.log('%c[BiliAntiBot]%c ⚡ 网络数据源拦截引擎就绪 (MAIN World v2.2.0)', 'color:#00aeec;font-weight:bold;font-size:13px;', 'color:inherit;');

  const CONFIG = {
    // 专门针对账号昵称的关键词与正则
    nameKeywords: ['大肥鱼', '家的DSH', '包鱼的DSH', '小鲛鱼', '鲸鲸'],
    nameRegexRules: [],

    // 精确拉黑的 UID / 完整昵称
    blacklistUIDs: [],
    blacklistNames: ['喵诗的鱼鱼', '摸鱼哦鲸鲸'],

    // 针对评论正文的关键词与正则
    contentKeywords: [
      '作为AI', '语言模型', '生成完毕',
      '选对壳真的影响钱包喵',
      '主人拿自己的活',
      '输出token才是账单',
      '输入几乎白送'
    ],
    contentRegexRules: [],

    // 典型密集复读数值特征
    suspiciousNumbers: ['96.5', '97.6%', '2.2倍', '3.9倍', '6.77', 'V4.1 Flash', 'DSH']
  };

  // 编译文本为普通词或正则表达式
  function compileRuleList(inputList) {
    const plain = [];
    const regexes = [];
    if (!Array.isArray(inputList)) return { plain, regexes };

    for (const item of inputList) {
      if (!item) continue;
      const str = String(item).trim();
      const regMatch = str.match(/^\/(.+)\/([gimsuy]*)$/);
      if (regMatch) {
        try {
          regexes.push(new RegExp(regMatch[1], regMatch[2]));
        } catch (e) {
          plain.push(str);
        }
      } else {
        plain.push(str);
      }
    }
    return { plain, regexes };
  }

  // 从 localStorage 恢复用户自定义规则 (在 document_start 瞬间完成，零延迟)
  function loadLocalSavedConfig() {
    try {
      const saved = localStorage.getItem('bili_antibot_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.nameKeywords && Array.isArray(parsed.nameKeywords)) {
          const res = compileRuleList(parsed.nameKeywords);
          CONFIG.nameKeywords = res.plain;
          CONFIG.nameRegexRules = res.regexes;
        }
        if (parsed.customKeywords && Array.isArray(parsed.customKeywords)) {
          const res = compileRuleList(parsed.customKeywords);
          CONFIG.contentKeywords = res.plain;
          CONFIG.contentRegexRules = res.regexes;
        }
        if (parsed.blacklistUsers && Array.isArray(parsed.blacklistUsers)) {
          CONFIG.blacklistUIDs = [];
          CONFIG.blacklistNames = [];
          parsed.blacklistUsers.forEach(u => {
            if (u.uid) CONFIG.blacklistUIDs.push(String(u.uid));
            if (u.name) CONFIG.blacklistNames.push(u.name);
          });
        }
        console.log(`[BiliAntiBot] 成功从本地缓存装载: 昵称规则(${CONFIG.nameKeywords.length + CONFIG.nameRegexRules.length}条), 内容规则(${CONFIG.contentKeywords.length + CONFIG.contentRegexRules.length}条)`);
      }
    } catch (e) {
      console.warn('[BiliAntiBot] 读取本地配置失败:', e);
    }
  }

  // 立即在第一毫秒执行装载
  loadLocalSavedConfig();

  // 监听来自 content.js / popup 的规则实时热同步
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'BILI_ANTIBOT_SYNC_CONFIG' && e.data.data) {
      const parsed = e.data.data;

      // 1. 同步昵称规则
      if (parsed.nameKeywords && Array.isArray(parsed.nameKeywords)) {
        const res = compileRuleList(parsed.nameKeywords);
        CONFIG.nameKeywords = res.plain;
        CONFIG.nameRegexRules = res.regexes;
      }

      // 2. 同步评论正文规则
      if (parsed.customKeywords && Array.isArray(parsed.customKeywords)) {
        const res = compileRuleList(parsed.customKeywords);
        CONFIG.contentKeywords = res.plain;
        CONFIG.contentRegexRules = res.regexes;
      }

      // 3. 同步精确黑名单
      if (parsed.blacklistUsers && Array.isArray(parsed.blacklistUsers)) {
        CONFIG.blacklistUIDs = [];
        CONFIG.blacklistNames = [];
        parsed.blacklistUsers.forEach(u => {
          if (u.uid) CONFIG.blacklistUIDs.push(String(u.uid));
          if (u.name) CONFIG.blacklistNames.push(u.name);
        });
      }

      try {
        localStorage.setItem('bili_antibot_config', JSON.stringify(parsed));
      } catch (e) {}

      console.log(`[BiliAntiBot] 规则已热更新并持久化: 昵称规则(${CONFIG.nameKeywords.length + CONFIG.nameRegexRules.length}条), 内容规则(${CONFIG.contentKeywords.length + CONFIG.contentRegexRules.length}条)`);
    }
  });

  // 核心判定：昵称优先 + 评论内容兜底
  function isBotReply(reply) {
    if (!reply) return false;

    const uname = (reply.member && reply.member.uname) || '';
    const mid = String((reply.member && reply.member.mid) || '');
    const message = (reply.content && reply.content.message) || '';

    // ==========================================
    // 维度一：精准靶向【账号昵称】（全面通杀任何前后变体）
    // ==========================================
    if (uname) {
      const lowerUname = uname.toLowerCase().trim();

      // 1. 昵称关键词通配包含（如 '的肥鱼' 击杀 'niulium的肥鱼'、'XX家的肥鱼'）
      for (let kw of CONFIG.nameKeywords) {
        if (!kw) continue;
        let cleanKw = kw.toLowerCase().trim();
        // 兼容用户可能输入的通配符 *
        cleanKw = cleanKw.replace(/^\*+|\*+$/g, '');
        if (cleanKw && lowerUname.includes(cleanKw)) {
          return { isBot: true, reason: `命中昵称关键词: [${kw}] -> 用户名「${uname}」` };
        }
      }

      // 2. 昵称正则表达式（如 /.*肥鱼/i）
      for (const reg of CONFIG.nameRegexRules) {
        if (reg.test(uname)) {
          return { isBot: true, reason: `命中昵称正则: ${reg.toString()} -> 用户名「${uname}」` };
        }
      }

      // 3. 精确黑名单
      if (CONFIG.blacklistNames.some(b => b.toLowerCase() === lowerUname)) {
        return { isBot: true, reason: `命中黑名单昵称: ${uname}` };
      }
    }

    // UID 精确拉黑
    if (mid && CONFIG.blacklistUIDs.includes(mid)) {
      return { isBot: true, reason: `命中黑名单UID: ${mid}` };
    }

    // ==========================================
    // 维度二：【评论正文】Prompt 残留与违禁词过滤
    // ==========================================
    if (message) {
      for (const kw of CONFIG.contentKeywords) {
        if (kw && message.includes(kw)) {
          return { isBot: true, reason: `命中评论关键词: [${kw}]` };
        }
      }

      for (const reg of CONFIG.contentRegexRules) {
        if (reg.test(message)) {
          return { isBot: true, reason: `命中评论正则: ${reg.toString()}` };
        }
      }

      // 密集特定洗稿数值共现检测
      let hitNums = 0;
      for (const num of CONFIG.suspiciousNumbers) {
        if (message.includes(num)) hitNums++;
      }
      if (hitNums >= 2) {
        return { isBot: true, reason: `命中同屏洗稿矩阵数值 (重合 ${hitNums} 组特征)` };
      }

      // 强行 @路人 + 密集数值提要模式
      if (/^@\S+/.test(message)) {
        const numbersInMsg = message.match(/\d+(?:\.\d+)?%?/g) || [];
        if (numbersInMsg.length >= 3) {
          return { isBot: true, reason: `疑似@路人密集数据洗稿机 (${numbersInMsg.length}组数值)` };
        }
      }
    }

    return { isBot: false };
  }

  // 递归过滤评论数组
  function cleanReplies(replies, counterRef = { count: 0 }) {
    if (!Array.isArray(replies)) return replies;

    const filtered = [];
    for (const item of replies) {
      const check = isBotReply(item);
      if (check.isBot) {
        counterRef.count++;
        console.warn(
          `%c[BiliAntiBot 斩断拦截]%c 账号: %c${item.member?.uname}%c | 原因: ${check.reason}\n内容: ${item.content?.message}`,
          'background:#ff4d4f;color:#fff;padding:2px 5px;border-radius:3px;font-weight:bold;',
          'color:#ff4d4f;font-weight:bold;',
          'color:#00aeec;font-weight:bold;',
          'color:inherit;'
        );
        continue; // 彻底剔除，不返回给B站前端组件
      }

      // 递归处理楼中楼（二级回复）
      if (item.replies && Array.isArray(item.replies)) {
        item.replies = cleanReplies(item.replies, counterRef);
      }

      filtered.push(item);
    }
    return filtered;
  }

  // 清洗响应 JSON 数据
  function cleanResponseData(json) {
    if (!json || typeof json !== 'object') return json;

    const counterRef = { count: 0 };

    if (json.data) {
      if (Array.isArray(json.data.replies)) {
        json.data.replies = cleanReplies(json.data.replies, counterRef);
      }
      if (Array.isArray(json.data.top_replies)) {
        json.data.top_replies = cleanReplies(json.data.top_replies, counterRef);
      }
      if (Array.isArray(json.data.hots)) {
        json.data.hots = cleanReplies(json.data.hots, counterRef);
      }
      if (Array.isArray(json.data.root)) {
        json.data.root = cleanReplies(json.data.root, counterRef);
      }
    }

    // 上报拦截计数给扩展存储
    if (counterRef.count > 0) {
      window.postMessage({ type: 'BILI_ANTIBOT_ADD_STATS', count: counterRef.count }, '*');
    }

    return json;
  }

  // ========================================================
  // Hook 1: window.fetch
  // ========================================================
  const rawFetch = window.fetch;
  window.fetch = async function (...args) {
    let url = '';
    if (typeof args[0] === 'string') {
      url = args[0];
    } else if (args[0] && args[0].url) {
      url = args[0].url;
    } else if (args[0] && args[0].href) {
      url = args[0].href;
    }

    const isReplyApi = typeof url === 'string' && (
      url.includes('/x/v2/reply') ||
      url.includes('api.bilibili.com/x/v2/reply')
    );

    const response = await rawFetch.apply(this, args);

    if (isReplyApi) {
      const originalJson = response.json.bind(response);
      response.json = async function () {
        const data = await originalJson();
        return cleanResponseData(data);
      };

      const originalText = response.text.bind(response);
      response.text = async function () {
        const text = await originalText();
        try {
          const parsed = JSON.parse(text);
          return JSON.stringify(cleanResponseData(parsed));
        } catch (e) {
          return text;
        }
      };
    }

    return response;
  };

  // ========================================================
  // Hook 2: XMLHttpRequest
  // ========================================================
  const rawOpen = XMLHttpRequest.prototype.open;
  const rawSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._antibot_url = url;
    return rawOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    const isReplyApi = typeof this._antibot_url === 'string' && (
      this._antibot_url.includes('/x/v2/reply') ||
      this._antibot_url.includes('api.bilibili.com/x/v2/reply')
    );

    if (isReplyApi) {
      const onReady = () => {
        if (this.readyState === 4 && this.status === 200) {
          try {
            const data = JSON.parse(this.responseText);
            const cleaned = cleanResponseData(data);
            const cleanedText = JSON.stringify(cleaned);

            Object.defineProperty(this, 'responseText', {
              get: () => cleanedText,
              configurable: true
            });
            Object.defineProperty(this, 'response', {
              get: () => (this.responseType === 'json' ? cleaned : cleanedText),
              configurable: true
            });
          } catch (e) {}
        }
      };
      this.addEventListener('readystatechange', onReady, false);
    }

    return rawSend.apply(this, args);
  };

})();
