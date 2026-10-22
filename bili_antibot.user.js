// ==UserScript==
// @name         鱼篓 (Creel) - B站 AI BOT 评论拦截器
// @namespace    https://github.com/cycocyco/Creel
// @version      3.0.0
// @description  B站 AI BOT 评论拦截净化器 (Creel) · 从数据源底层精准捕杀批量洗稿肥鱼与复读水军
// @author       Creel
// @match        *://*.bilibili.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  console.log('%c[Creel 鱼篓]%c 数据源拦截引擎已就绪 (document-start)', 'color:#ff5449;font-weight:bold', 'color:inherit');

  // 配置项
  const CONFIG = {
    // 基础黑名单（支持模糊匹配）
    blacklistNames: ['大肥鱼', '喵诗的鱼鱼', '摸鱼哦鲸鲸', '包鱼的DSH', '软糯小鲛鱼'],
    blacklistUIDs: [],

    // 关键词/指令残留匹配
    keywords: [
      '作为AI', '语言模型', '生成完毕',
      '选对壳真的影响钱包喵',
      '主人拿自己的活',
      '输出token才是账单',
      '输入几乎白送'
    ],
    regexRules: [],

    // 针对截图中出现的洗稿矩阵特征数值
    // 当一条评论同时出现 2 个或以上这些高特异性数值时，直接拦截
    suspiciousNumbers: ['96.5', '97.6%', '2.2倍', '3.9倍', '6.77', 'V4.1 Flash', 'DSH']
  };

  function compileRules(kwList) {
    CONFIG.keywords = [];
    CONFIG.regexRules = [];
    for (const item of kwList) {
      if (!item) continue;
      const regMatch = item.match(/^\/(.+)\/([gimsuy]*)$/);
      if (regMatch) {
        try {
          CONFIG.regexRules.push(new RegExp(regMatch[1], regMatch[2]));
        } catch (e) {
          CONFIG.keywords.push(item);
        }
      } else {
        CONFIG.keywords.push(item);
      }
    }
  }

  compileRules(CONFIG.keywords);

  // 尝试从 localStorage 读取用户自定义配置
  try {
    const saved = localStorage.getItem('bili_antibot_config');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.blacklistNames) CONFIG.blacklistNames = Array.from(new Set([...CONFIG.blacklistNames, ...parsed.blacklistNames]));
      if (parsed.blacklistUIDs) CONFIG.blacklistUIDs = Array.from(new Set([...CONFIG.blacklistUIDs, ...parsed.blacklistUIDs]));
      if (parsed.keywords) CONFIG.keywords = Array.from(new Set([...CONFIG.keywords, ...parsed.keywords]));
    }
  } catch (e) {}

  // 判定单条评论是否为 BOT
  function isBotReply(reply) {
    if (!reply) return false;

    const uname = (reply.member && reply.member.uname) || '';
    const mid = String((reply.member && reply.member.mid) || '');
    const message = (reply.content && reply.content.message) || '';

    // 1. UID 命中
    if (mid && CONFIG.blacklistUIDs.includes(mid)) {
      return { isBot: true, reason: `黑名单UID: ${mid}` };
    }

    // 2. 昵称模糊匹配
    for (const name of CONFIG.blacklistNames) {
      if (name && uname.includes(name)) {
        return { isBot: true, reason: `黑名单昵称匹配: [${name}] -> ${uname}` };
      }
    }

    // 3. 关键词/Prompt残留匹配
    for (const kw of CONFIG.keywords) {
      if (kw && message.includes(kw)) {
        return { isBot: true, reason: `命中特征词/Prompt残留: [${kw}]` };
      }
    }
    for (const reg of CONFIG.regexRules) {
      if (reg.test(message)) {
        return { isBot: true, reason: `命中自定义正则: ${reg.toString()}` };
      }
    }

    // 4. 洗稿矩阵特征数值密度检测
    let hitNums = 0;
    for (const num of CONFIG.suspiciousNumbers) {
      if (message.includes(num)) {
        hitNums++;
      }
    }
    if (hitNums >= 2) {
      return { isBot: true, reason: `命中同屏洗稿矩阵数值 (重合 ${hitNums} 组特征: 如96.5/97.6%等)` };
    }

    // 5. 强行 @某人 + 密集数值提要模式
    if (/^@\S+/.test(message)) {
      const numbersInMsg = message.match(/\d+(?:\.\d+)?%?/g) || [];
      if (numbersInMsg.length >= 3) {
        return { isBot: true, reason: `疑似@路人密集数据洗稿机 (${numbersInMsg.length}组数值)` };
      }
    }

    return { isBot: false };
  }

  // 递归清洗 replies 数组
  function cleanReplies(replies) {
    if (!Array.isArray(replies)) return replies;

    const filtered = [];
    for (const item of replies) {
      const check = isBotReply(item);
      if (check.isBot) {
        console.warn(
          `%c[BiliAntiBot 斩断拦截]%c 账号: %c${item.member?.uname}%c | 原因: ${check.reason}\n内容: ${item.content?.message}`,
          'background:#ff4d4f;color:#fff;padding:2px 4px;border-radius:3px;',
          'color:#ff4d4f;font-weight:bold;',
          'color:#00aeec;font-weight:bold;',
          'color:inherit;'
        );
        continue; // 丢弃该 BOT 评论
      }

      // 递归处理子评论 (二级回复)
      if (item.replies && Array.isArray(item.replies)) {
        item.replies = cleanReplies(item.replies);
      }

      filtered.push(item);
    }
    return filtered;
  }

  // 清洗响应 JSON 数据
  function cleanResponseData(json) {
    if (!json || typeof json !== 'object') return json;

    // 针对 B站 常见评论接口结构
    // data.replies (主评论列表)
    // data.top_replies (置顶)
    // data.hots (热门评论)
    if (json.data) {
      if (Array.isArray(json.data.replies)) {
        json.data.replies = cleanReplies(json.data.replies);
      }
      if (Array.isArray(json.data.top_replies)) {
        json.data.top_replies = cleanReplies(json.data.top_replies);
      }
      if (Array.isArray(json.data.hots)) {
        json.data.hots = cleanReplies(json.data.hots);
      }
      // 子回复分页接口
      if (Array.isArray(json.data.root)) {
        json.data.root = cleanReplies(json.data.root);
      }
    }

    return json;
  }

  // ==========================================
  // 1. Hook window.fetch
  // ==========================================
  const rawFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = (args[0] && (args[0].url || args[0])) || '';
    const isReplyApi = typeof url === 'string' && (
      url.includes('/x/v2/reply') ||
      url.includes('api.bilibili.com/x/v2/reply')
    );

    const response = await rawFetch.apply(this, args);

    if (isReplyApi) {
      try {
        const clone = response.clone();
        const json = await clone.json();
        const cleanedJson = cleanResponseData(json);
        const cleanedBody = JSON.stringify(cleanedJson);

        // 返回伪装后的全新响应
        return new Response(cleanedBody, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      } catch (err) {
        // 发生异常时兜底放行
        return response;
      }
    }

    return response;
  };

  // ==========================================
  // 2. Hook XMLHttpRequest (针对部分可能使用 XHR 的模块)
  // ==========================================
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
