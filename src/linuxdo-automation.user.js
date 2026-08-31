// ==UserScript==
// @name         Linux.do 自动浏览助手 v2.3
// @namespace    https://linux.do/
// @version      2.3.0
// @description  自动浏览帖子、滚动查看所有回复、随机点赞、避免重复浏览
// @author       Assistant
// @match        https://linux.do/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  // 为当前标签页生成唯一ID (用于防多开检测)
  // 必须按“浏览器标签页”稳定，不能每次页面加载都随机：脚本靠整页跳转翻话题，
  // 若跳转后 ID 变了，锁里存的旧 ID 永远对不上自己，会被误判成“其他标签页在运行”而拒绝自启。
  // sessionStorage 恰好按标签页隔离且整页跳转后保留：同一标签页翻页 ID 不变，新开标签页 ID 必然不同
  const TAB_ID = (() => {
    try {
      let id = sessionStorage.getItem('linuxdo_tab_id');
      if (!id) {
        id = Math.random().toString(36).slice(2, 11);
        sessionStorage.setItem('linuxdo_tab_id', id);
      }
      return id;
    } catch (e) {
      // sessionStorage 不可用时退回随机 ID (仅影响防多开的准确性，不影响功能)
      return Math.random().toString(36).slice(2, 11);
    }
  })();

  // ==================== 配置参数 ====================

  // 速度预设 (进一步调整避免429错误)
  const SPEED_PRESETS = {
    slow: {
      name: '慢速',
      scrollStep: 300,
      scrollInterval: 2500,
      loadWaitTime: 4000,
      minReadTime: 2000,
      maxReadTime: 4000,
      noNewContentRetry: 4
    },
    normal: {
      name: '正常',
      scrollStep: 400,
      scrollInterval: 1500,
      loadWaitTime: 2500,
      minReadTime: 800,
      maxReadTime: 1500,
      noNewContentRetry: 3
    },
    fast: {
      name: '快速',
      scrollStep: 500,
      scrollInterval: 800,
      loadWaitTime: 1500,
      minReadTime: 300,
      maxReadTime: 800,
      noNewContentRetry: 3
    },
    turbo: {
      name: '极速',
      scrollStep: 600,
      scrollInterval: 400,
      loadWaitTime: 1000,
      minReadTime: 100,
      maxReadTime: 300,
      noNewContentRetry: 2
    }
  };

  // 当前速度设置 (延迟初始化，等Storage类定义后再读取)
  let currentSpeed = 'normal';

  // 列表选择设置
  const LIST_OPTIONS = {
    latest: { name: '最新', path: '/latest' },
    new: { name: '新帖', path: '/new' },
    unread: { name: '未读', path: '/unread' }
  };
  let currentList = 'latest';

  // 点赞开关
  let enableLike = true;

  // 点赞概率预设
  const LIKE_CHANCE_PRESETS = {
    low: { name: '低', value: 0.05 },      // 5%
    medium: { name: '中', value: 0.15 },   // 15%
    high: { name: '高', value: 0.25 },     // 25%
    veryHigh: { name: '极高', value: 0.40 } // 40%
  };
  let currentLikeChance = 'medium';

  const CONFIG = {
    // 动态从速度预设获取
    get scrollStep() { return SPEED_PRESETS[currentSpeed].scrollStep; },
    get scrollInterval() { return SPEED_PRESETS[currentSpeed].scrollInterval; },
    get loadWaitTime() { return SPEED_PRESETS[currentSpeed].loadWaitTime; },
    get minReadTime() { return SPEED_PRESETS[currentSpeed].minReadTime; },
    get maxReadTime() { return SPEED_PRESETS[currentSpeed].maxReadTime; },
    get noNewContentRetry() { return SPEED_PRESETS[currentSpeed].noNewContentRetry; },

    // 点赞设置 (动态从预设获取)
    get likeChance() { return LIKE_CHANCE_PRESETS[currentLikeChance].value; },
    minLikeInterval: 2000,        // 最小点赞间隔 (ms)

    // 会话设置
    maxLikesPerSession: 50,       // 每次会话最大点赞数
    maxTopicsPerSession: 50,      // 每次会话最大浏览话题数

    // 返回列表设置
    returnToListDelay: 1000,      // 返回列表前延迟 (ms)

    // 调试 (默认关闭，避免给所有用户刷 console；需要时用 GM_setValue('debug', true) 开启)
    debug: false
  };

  function setSpeed(preset) {
    if (SPEED_PRESETS[preset]) {
      currentSpeed = preset;
      Storage.set('speed_preset', preset);
      log(`速度设置为: ${SPEED_PRESETS[preset].name}`);
    }
  }

  function setList(listType) {
    if (LIST_OPTIONS[listType]) {
      currentList = listType;
      Storage.set('list_type', listType);
      log(`列表设置为: ${LIST_OPTIONS[listType].name}`);
    }
  }

  function setEnableLike(enabled, updateUI = true) {
    enableLike = enabled;
    Storage.set('enable_like', enabled);
    log(`随机点赞: ${enabled ? '已开启' : '已关闭'}`);

    // 更新UI按钮状态
    if (updateUI) {
      document.querySelectorAll('.like-btn[data-like]').forEach(btn => {
        btn.classList.remove('active');
        if ((btn.dataset.like === 'true') === enabled) {
          btn.classList.add('active');
        }
      });
    }
  }

  // 检测点赞限制对话框
  function checkLikeLimitDialog() {
    const dialog = document.querySelector('#dialog-holder');
    if (!dialog) return false;

    const dialogText = dialog.innerText || dialog.textContent || '';
    const limitKeywords = [
      '点赞上限',
      '分享很多爱',
      'like limit',
      'sharing a lot of love'
    ];

    for (const keyword of limitKeywords) {
      if (dialogText.includes(keyword)) {
        log('检测到点赞限制提示！');
        return true;
      }
    }
    return false;
  }

  // 处理点赞限制
  function handleLikeLimit() {
    log('已达到点赞上限，自动关闭点赞功能');
    setEnableLike(false, true);

    const closeBtn = document.querySelector(
      '#dialog-holder button.btn-primary, ' +
      '#dialog-holder .dialog-footer button, ' +
      '#dialog-holder button'
    );
    if (closeBtn) {
      closeBtn.click();
      log('已关闭点赞限制对话框');
    }
  }

  function setLikeChance(preset) {
    if (LIKE_CHANCE_PRESETS[preset]) {
      currentLikeChance = preset;
      Storage.set('like_chance', preset);
      const percent = Math.round(LIKE_CHANCE_PRESETS[preset].value * 100);
      log(`点赞概率设置为: ${LIKE_CHANCE_PRESETS[preset].name} (${percent}%)`);
    }
  }

  // ==================== 工具函数 ====================

  function log(...args) {
    if (CONFIG.debug) {
      console.log(`[LinuxDo自动化|${TAB_ID}]`, new Date().toLocaleTimeString(), ...args);
    }
  }

  function randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // 登录状态三态检测：true=已登录，false=未登录，null=无法判定（页面未就绪或 Cloudflare 挑战页）
  // 优先读取 #data-preloaded（服务端直出，脚本注入时必然存在），
  // 避免与 Ember 渲染 #current-user 竞速导致误判（脚本注入时 header 尚未渲染）
  function getLoginState() {
    const preloaded = document.querySelector('#data-preloaded');
    if (preloaded) {
      try {
        return 'currentUser' in JSON.parse(preloaded.dataset.preloaded);
      } catch (e) {
        // 解析失败，回退到 DOM 检测
      }
    }
    return document.querySelector('#current-user') !== null ? true : null;
  }

  function getPageTypeFromPath(path) {
    if (path.match(/^\/t\/topic\/\d+/)) return 'topic';
    if (path === '/latest' || path === '/new' || path === '/unread' ||
        path === '/' || path === '/top' || path === '/hot' ||
        path.startsWith('/c/')) return 'list';
    return 'other';
  }

  function getPageType() {
    return getPageTypeFromPath(window.location.pathname);
  }

  function getTopicIdFromUrl(url) {
    const match = url?.match(/\/t\/topic\/(\d+)/);
    return match ? match[1] : null;
  }

  function getCurrentTopicId() {
    return getTopicIdFromUrl(window.location.pathname);
  }

  // ==================== 存储管理 ====================

  class Storage {
    static get(key, defaultValue = null) {
      try {
        if (typeof GM_getValue !== 'undefined') {
          const val = GM_getValue(key, null);
          return val !== null ? val : defaultValue;
        }
        const value = localStorage.getItem(`linuxdo_${key}`);
        return value ? JSON.parse(value) : defaultValue;
      } catch (e) {
        return defaultValue;
      }
    }

    static set(key, value) {
      try {
        if (typeof GM_setValue !== 'undefined') {
          GM_setValue(key, value);
        } else {
          localStorage.setItem(`linuxdo_${key}`, JSON.stringify(value));
        }
      } catch (e) {
        log('存储失败:', e);
      }
    }
  }

  // 初始化设置
  currentSpeed = Storage.get('speed_preset', 'normal');
  currentList = Storage.get('list_type', 'latest');
  enableLike = Storage.get('enable_like', true);
  currentLikeChance = Storage.get('like_chance', 'medium');
  CONFIG.debug = Storage.get('debug', false);

  // 数据迁移：v2.1.1 起 liked_posts 的键从话题内楼层序号改为全局 post id，
  // 旧键在新逻辑下全部失配 (脏数据)，一次性清空，避免重访旧话题时把已点赞的帖子误 toggle 取消
  // (viewed_topics 存的一直是话题 id，语义未变，保留不动)
  const STORAGE_VERSION = 2;
  if (Storage.get('storage_version', 1) < STORAGE_VERSION) {
    Storage.set('liked_posts', []);
    Storage.set('storage_version', STORAGE_VERSION);
    log('存储迁移：已重置 liked_posts (点赞去重键格式变更为全局 post id)');
  }

  // ==================== 浏览记录管理 ====================

  // 浏览/点赞记录的最大保留条数，超出后按插入顺序淘汰最旧的，避免长期运行无限膨胀
  const MAX_HISTORY = 5000;

  // 将 Set 裁剪到不超过 max 条：Set 迭代按插入顺序，从头部删除即淘汰最旧的
  function trimSet(set, max) {
    while (set.size > max) {
      set.delete(set.values().next().value);
    }
  }

  class BrowsingHistory {
    constructor() {
      this.viewed = new Set(Storage.get('viewed_topics', []));
      this.liked = new Set(Storage.get('liked_posts', []));
      this.sessionViewed = 0;
      this.sessionLiked = 0;
      this.sessionReplies = 0;
      this.totalReplies = Storage.get('total_replies', 0);
      // 节流写入的定时器句柄，避免每标记一条就全量序列化落盘
      this.saveTimer = null;
    }

    isTopicViewed(topicId) {
      return this.viewed.has(String(topicId));
    }

    markTopicViewed(topicId) {
      const id = String(topicId);
      if (!this.viewed.has(id)) {
        this.viewed.add(id);
        trimSet(this.viewed, MAX_HISTORY);
        this.sessionViewed++;
        this.scheduleSave();
        log(`标记话题 ${id} 为已浏览，本次会话已浏览 ${this.sessionViewed} 个`);
      }
    }

    isPostLiked(postId) {
      return this.liked.has(String(postId));
    }

    markPostLiked(postId) {
      const id = String(postId);
      if (!this.liked.has(id)) {
        this.liked.add(id);
        trimSet(this.liked, MAX_HISTORY);
        this.sessionLiked++;
        this.scheduleSave();
      }
    }

    addReplyViewed() {
      this.sessionReplies++;
      this.totalReplies++;
      if (this.sessionReplies % 10 === 0) {
        this.scheduleSave();
      }
    }

    // 节流写入：合并短时间内的多次变更，最多延迟 2 秒统一落盘
    // 页面卸载时由 beforeunload 调用 save() 兜底 flush，避免翻页丢失最后的记录
    scheduleSave() {
      if (this.saveTimer) return;
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.save();
      }, 2000);
    }

    save() {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      Storage.set('viewed_topics', [...this.viewed]);
      Storage.set('liked_posts', [...this.liked]);
      Storage.set('total_replies', this.totalReplies);
    }

    // 仅在有节流待写数据时落盘，供 beforeunload 兜底 flush
    // 无变更的页面 (未启动/未登录/路过) saveTimer 为 null，不写，避免用可能读空的数据覆盖已有历史
    flushPending() {
      if (this.saveTimer) this.save();
    }

    clearHistory() {
      this.viewed.clear();
      this.liked.clear();
      this.totalReplies = 0;
      this.save();
      log('已清除所有浏览历史');
    }

    getStats() {
      return {
        totalViewed: this.viewed.size,
        totalLiked: this.liked.size,
        sessionViewed: this.sessionViewed,
        sessionLiked: this.sessionLiked,
        sessionReplies: this.sessionReplies,
        totalReplies: this.totalReplies
      };
    }

    canContinue() {
      return this.sessionViewed < CONFIG.maxTopicsPerSession &&
             this.sessionLiked < CONFIG.maxLikesPerSession;
    }
  }

  // ==================== 阅读量统计 ====================

  // 监听 Discourse 的 /topics/timings 阅读上报接口，请求成功即计入阅读量。
  // 上报体格式：timings[楼层号]=毫秒&...&topic_time=毫秒&topic_id=话题ID。
  // 同一楼层长时间停留会被 Discourse 分多次重复上报，因此按「话题ID:楼层号」
  // 去重累计，与 linux.do 个人资料页「阅读的帖子数」口径一致。
  // 计数持久化存储，页面刷新/跳转后延续；仅在手动点击「开始」时清零。
  // 存储跨标签页共享：写回前先与存储对齐（见 syncFromStorage），避免本页
  // 旧快照覆盖其他标签页的新增，或清零后被其他标签页的旧数据写回
  class ReadingTracker {
    constructor() {
      this.epoch = Storage.get('session_read_epoch', 0);
      this.readKeys = new Set(Storage.get('session_read_keys', []));
      this.onUpdate = null;
    }

    get count() {
      return this.readKeys.size;
    }

    addFromBody(body) {
      try {
        const params = new URLSearchParams(body);
        const topicId = params.get('topic_id');
        if (!topicId) return;

        const newKeys = [];
        for (const [key, value] of params.entries()) {
          // 校验条目格式：楼层号与阅读毫秒数都必须是纯数字，异常条目不计入
          const match = key.match(/^timings\[(\d+)\]$/);
          if (match && /^\d+$/.test(value)) newKeys.push(`${topicId}:${match[1]}`);
        }
        if (newKeys.length === 0) return;

        this.syncFromStorage();
        let added = 0;
        for (const readKey of newKeys) {
          if (!this.readKeys.has(readKey)) {
            this.readKeys.add(readKey);
            added++;
          }
        }
        if (added > 0) {
          Storage.set('session_read_keys', [...this.readKeys]);
          log(`阅读上报成功，新增 ${added} 条，本次总阅读量 ${this.count}`);
        }
        this.onUpdate?.();
      } catch (e) {
        log('解析 timings 上报数据失败:', e);
      }
    }

    // 与存储对齐：epoch 变化说明其他标签页清零过，丢弃本页内存中的旧数据；
    // 同一 epoch 则与存储做并集，防止用本页旧快照覆盖其他标签页写入的新增
    syncFromStorage() {
      const storedEpoch = Storage.get('session_read_epoch', 0);
      const storedKeys = Storage.get('session_read_keys', []);
      if (storedEpoch !== this.epoch) {
        this.epoch = storedEpoch;
        this.readKeys = new Set(storedKeys);
      } else {
        for (const key of storedKeys) this.readKeys.add(key);
      }
    }

    reset() {
      this.epoch = Date.now();
      this.readKeys.clear();
      Storage.set('session_read_epoch', this.epoch);
      Storage.set('session_read_keys', []);
      this.onUpdate?.();
      log('本次总阅读量已清零');
    }
  }

  const readingTracker = new ReadingTracker();

  // 拦截 XHR 与 fetch 两条通道的 /topics/timings 上报，响应 2xx 才计数。
  // hook 必须装在页面真实 window（unsafeWindow）上：带 @grant 的脚本运行在
  // 脚本管理器沙箱中，改写沙箱自己的 XMLHttpRequest/fetch 拦截不到页面请求
  function installTimingsHook() {
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const TIMINGS_PATH = '/topics/timings';
    const isTimingsUrl = (url) => String(url).includes(TIMINGS_PATH);
    // 沙箱与页面可能不同 realm，不能用 instanceof Request，按结构判断
    const isRequestLike = (v) => !!v && typeof v === 'object' &&
      typeof v.url === 'string' && typeof v.clone === 'function';

    const xhrProto = pageWindow.XMLHttpRequest.prototype;
    const originalOpen = xhrProto.open;
    const originalSend = xhrProto.send;

    xhrProto.open = function(method, url) {
      this._isTimingsRequest = isTimingsUrl(url);
      return originalOpen.apply(this, arguments);
    };

    xhrProto.send = function(body) {
      if (this._isTimingsRequest) {
        this.addEventListener('load', function() {
          if (this.status >= 200 && this.status < 300) {
            readingTracker.addFromBody(body);
          }
        });
      }
      return originalSend.apply(this, arguments);
    };

    const originalFetch = pageWindow.fetch;
    pageWindow.fetch = function(input, init) {
      const url = isRequestLike(input) ? input.url : input;
      if (!isTimingsUrl(url)) {
        return originalFetch.apply(this, arguments);
      }

      // body 可能在 init 上，也可能包在 Request 对象里（后者需 clone 读取）
      const bodyPromise = init?.body !== undefined && init?.body !== null
        ? Promise.resolve(init.body)
        : (isRequestLike(input) ? input.clone().text().catch(() => null) : Promise.resolve(null));

      return originalFetch.apply(this, arguments).then(response => {
        if (response.ok) {
          bodyPromise.then(body => {
            if (body) readingTracker.addFromBody(body);
          });
        }
        return response;
      });
    };
  }

  // ==================== 滚动控制器 ====================

  class ScrollController {
    constructor() {
      this.lastScrollHeight = 0;
      this.noNewContentCount = 0;
    }

    getScrollInfo() {
      return {
        scrollTop: window.pageYOffset || document.documentElement.scrollTop,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight
      };
    }

    isAtBottom() {
      const { scrollTop, scrollHeight, clientHeight } = this.getScrollInfo();
      return scrollTop + clientHeight >= scrollHeight - 100;
    }

    isAtTop() {
      return this.getScrollInfo().scrollTop < 100;
    }

    async scrollDown() {
      const scrollAmount = CONFIG.scrollStep + randomInt(-30, 30);
      window.scrollBy({
        top: scrollAmount,
        behavior: 'auto'
      });
    }

    async scrollToTop() {
      window.scrollTo({ top: 0, behavior: 'auto' });
      await randomDelay(200, 400);
    }

    hasNewContent() {
      const currentHeight = document.documentElement.scrollHeight;
      if (currentHeight > this.lastScrollHeight) {
        this.lastScrollHeight = currentHeight;
        this.noNewContentCount = 0;
        return true;
      }
      this.noNewContentCount++;
      return false;
    }

    isContentFullyLoaded() {
      return this.noNewContentCount >= CONFIG.noNewContentRetry;
    }

    reset() {
      this.lastScrollHeight = document.documentElement.scrollHeight;
      this.noNewContentCount = 0;
    }
  }

  // ==================== 帖子详情页浏览器 ====================

  class TopicBrowser {
    constructor(history, onStatsUpdate) {
      this.history = history;
      this.onStatsUpdate = onStatsUpdate;
      this.scrollController = new ScrollController();
      this.isRunning = false;
      this.viewedPosts = new Set();
      this.lastLikeTime = 0;
    }

    async start() {
      if (this.isRunning) return;
      this.isRunning = true;

      const topicId = getCurrentTopicId();
      if (!topicId) {
        log('无法获取话题ID');
        this.stop();
        return;
      }

      log(`开始浏览话题 ${topicId}...`);
      this.history.markTopicViewed(topicId);
      this.onStatsUpdate?.();

      await this.goToFirstPost(topicId);
      await this.scrollController.scrollToTop();
      this.scrollController.reset();
      await this.browseAllReplies();

      if (this.isRunning) {
        await this.returnToList();
      }
    }

    stop() {
      this.isRunning = false;
      log('停止浏览');
    }

    async goToFirstPost(topicId) {
      const currentPath = window.location.pathname;
      const firstPostPath = `/t/topic/${topicId}/1`;

      if (currentPath === firstPostPath || currentPath === `/t/topic/${topicId}`) {
        return;
      }

      log('跳转到帖子第一楼...');
      const jumpToFirstBtn = document.querySelector('a[href*="/1"][title*="第一"], a[href*="/1"][title*="first" i], a.jump-to-first');
      if (jumpToFirstBtn) {
        jumpToFirstBtn.click();
        await randomDelay(1500, 2000);
        return;
      }

      window.location.href = firstPostPath;
      await randomDelay(2000, 2500);
    }

    async browseAllReplies() {
      log('开始滚动浏览所有回复...');

      while (this.isRunning) {
        try {
          await this.processVisiblePosts();
          this.onStatsUpdate?.();

          if (this.scrollController.isAtBottom()) {
            log('到达页面底部，等待加载新内容...');
            await randomDelay(CONFIG.loadWaitTime, CONFIG.loadWaitTime * 1.2);

            if (!this.scrollController.hasNewContent()) {
              if (this.scrollController.isContentFullyLoaded()) {
                log('所有回复已浏览完成');
                break;
              }
            }
          }

          await this.scrollController.scrollDown();
          await randomDelay(CONFIG.scrollInterval, CONFIG.scrollInterval * 1.3);
        } catch (error) {
          log('浏览回复出错:', error.message);
          await randomDelay(2000, 3000);
        }
      }
    }

    async processVisiblePosts() {
      const posts = document.querySelectorAll('article[id^="post_"]');
      const viewportHeight = window.innerHeight;
      let newPostFound = false;

      for (const post of posts) {
        if (!this.isRunning) break;

        const postId = post.id.replace('post_', '');
        // 已处理过的楼层直接跳过，避免对全部楼层反复调用 getBoundingClientRect 触发强制回流
        if (this.viewedPosts.has(postId)) continue;

        const rect = post.getBoundingClientRect();
        if (rect.top < viewportHeight * 0.9 && rect.bottom > viewportHeight * 0.1) {
          this.viewedPosts.add(postId);
          newPostFound = true;
          this.history.addReplyViewed();
          this.onStatsUpdate?.();

          if (CONFIG.minReadTime > 0) {
            await randomDelay(CONFIG.minReadTime, CONFIG.maxReadTime);
          }

          if (this.shouldLike()) {
            await this.tryLikePost(post, postId);
          }
        }
      }
      return newPostFound;
    }

    shouldLike() {
      if (!enableLike) return false;
      if (this.history.sessionLiked >= CONFIG.maxLikesPerSession) return false;
      const now = Date.now();
      if (now - this.lastLikeTime < CONFIG.minLikeInterval) return false;
      return Math.random() < CONFIG.likeChance;
    }

    async tryLikePost(postElement, postId) {
      // 去重键必须用全局唯一的 data-post-id：post.id 里的编号是话题内楼层序号，
      // 跨话题会碰撞 (话题 A 的 3 楼与话题 B 的 3 楼同号)，用它会误判为已点赞而漏赞
      const actualPostId = postElement.dataset.postId;
      if (!actualPostId) return false;

      if (this.history.isPostLiked(actualPostId)) return false;

      // 已反应检测 (关键防线)：discourse-reactions 插件把已反应状态 (has-reacted /
      // has-used-main-reaction) 加在外层 .discourse-reactions-actions 容器上、而非按钮本身。
      // 只要该帖已有任意反应就跳过——否则对已点赞的帖子再 toggle 会取消掉赞，或覆盖用户已选的其它表情
      const reactionActions = postElement.querySelector('.discourse-reactions-actions');
      if (reactionActions && /reacted/i.test(reactionActions.className)) {
        return false;
      }

      // 兜底：非 reactions 插件的标准 Discourse 点赞按钮，已赞时按钮带 has-like 等 class
      const likeBtn = postElement.querySelector(
        'button[title="点赞此帖子"], button[title="Like this post"], button.btn-toggle-reaction-like'
      );
      if (likeBtn && (likeBtn.classList.contains('has-like') ||
          likeBtn.classList.contains('my-likes') ||
          likeBtn.classList.contains('liked'))) {
        return false;
      }

      try {
        await randomDelay(200, 500);
        const result = await this.sendLikeRequest(actualPostId);

        if (result.success) {
          this.history.markPostLiked(actualPostId);
          this.lastLikeTime = Date.now();
          this.onStatsUpdate?.();
          log(`点赞帖子 #${postId} (id=${actualPostId})`);
          return true;
        } else if (result.rateLimited) {
          handleLikeLimit();
          return false;
        }
        return false;
      } catch (e) {
        return false;
      }
    }

    async sendLikeRequest(postId) {
      try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
        if (!csrfToken) return { success: false };

        const response = await fetch(`/discourse-reactions/posts/${postId}/custom-reactions/heart/toggle.json`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
          }
        });

        if (response.ok) return { success: true };

        const data = await response.json().catch(() => ({}));
        if (response.status === 429 || data.error_type === 'rate_limit') {
          return { success: false, rateLimited: true };
        }
        return { success: false };
      } catch (e) {
        return { success: false };
      }
    }

    async returnToList() {
      log('准备返回话题列表...');
      await randomDelay(CONFIG.returnToListDelay, CONFIG.returnToListDelay * 1.5);
      const returnUrl = LIST_OPTIONS[currentList]?.path || '/latest';
      window.location.href = returnUrl;
    }
  }

  // ==================== 话题列表浏览器 ====================

  class TopicListBrowser {
    constructor(history, onStatsUpdate) {
      this.history = history;
      this.onStatsUpdate = onStatsUpdate;
      this.scrollController = new ScrollController();
      this.isRunning = false;
      this.scannedTopics = new Set();
    }

    async start() {
      if (this.isRunning) return;
      this.isRunning = true;

      log('开始在列表中查找未浏览的话题...');
      this.scrollController.reset();

      let found = await this.findAndEnterUnviewedTopic();

      while (this.isRunning && !found) {
        try {
          this.onStatsUpdate?.();

          if (this.scrollController.isAtBottom()) {
            await randomDelay(CONFIG.loadWaitTime, CONFIG.loadWaitTime * 1.2);
            if (!this.scrollController.hasNewContent()) {
              if (this.scrollController.isContentFullyLoaded()) {
                await this.switchToAnotherList();
                return;
              }
            }
          }

          await this.scrollController.scrollDown();
          await randomDelay(CONFIG.scrollInterval, CONFIG.scrollInterval * 1.2);
          found = await this.findAndEnterUnviewedTopic();
        } catch (error) {
          await randomDelay(2000, 3000);
        }
      }
    }

    stop() {
      this.isRunning = false;
      log('停止列表浏览');
    }

    async findAndEnterUnviewedTopic() {
      const topicRows = document.querySelectorAll('.topic-list-item, tr[data-topic-id], .topic-list tr');

      for (const row of topicRows) {
        if (!this.isRunning) return false;

        const titleLink = row.querySelector('.title a[href*="/t/topic/"], .link-top-line a[href*="/t/topic/"], a.title[href*="/t/topic/"]');
        if (!titleLink) continue;

        const topicId = getTopicIdFromUrl(titleLink.href);
        if (!topicId) continue;

        if (this.scannedTopics.has(topicId)) continue;
        this.scannedTopics.add(topicId);

        if (this.history.isTopicViewed(topicId)) {
          this.markAsViewed(row);
          continue;
        }

        if (!this.history.canContinue()) {
          log('达到会话限制，停止');
          this.stop();
          return false;
        }

        titleLink.scrollIntoView({ behavior: 'auto', block: 'center' });
        await randomDelay(300, 600);

        log(`进入话题: ${topicId}`);
        // 直接改 location 强制当前页跳转 (不点击链接，因此无需理会其 target 属性)
        window.location.href = titleLink.href;
        return true;
      }

      return false;
    }

    markAsViewed(row) {
      if (!row.classList.contains('auto-viewed')) {
        row.classList.add('auto-viewed');
        row.style.opacity = '0.6';
        const badge = document.createElement('span');
        badge.textContent = '✓';
        badge.style.cssText = 'color: #4CAF50; margin-left: 5px; font-weight: bold;';
        badge.className = 'viewed-badge';
        const title = row.querySelector('.title, .link-top-line');
        if (title && !title.querySelector('.viewed-badge')) {
          title.appendChild(badge);
        }
      }
    }

    async switchToAnotherList() {
      const targetList = LIST_OPTIONS[currentList]?.path || '/latest';
      await randomDelay(1000, 2000);
      window.location.href = targetList;
    }
  }

  // ==================== 主控制器 ====================

  class LinuxDoAutomation {
    constructor() {
      this.history = new BrowsingHistory();
      this.topicBrowser = null;
      this.listBrowser = null;
      this.isEnabled = false;
      this.panel = null;
      this.lastActivityTime = Date.now();
      this.stuckCheckInterval = null;
      this.stuckTimeout = 30000;
      this.lastUrl = window.location.href;
      this.urlCheckInterval = null;
    }

    // 附带防多开心跳记录
    heartbeat() {
      this.lastActivityTime = Date.now();
      if (this.isEnabled) {
        Storage.set('linuxdo_active_tab_id', TAB_ID);
        Storage.set('linuxdo_active_tab_time', this.lastActivityTime);
      }
    }

    checkStuck() {
      if (!this.isEnabled) return;
      const now = Date.now();
      const elapsed = now - this.lastActivityTime;

      if (elapsed > this.stuckTimeout) {
        log(`检测到卡住 (${Math.round(elapsed/1000)}秒无活动)，自动重启...`);
        this.restartBrowsing();
      }
    }

    // 根据页面类型创建对应浏览器并启动；非目标页则跳回列表
    async runBrowserFor(pageType) {
      const onUpdate = () => {
        this.updateStats();
        this.heartbeat();
      };
      if (pageType === 'topic') {
        this.topicBrowser = new TopicBrowser(this.history, onUpdate);
        await this.topicBrowser.start();
      } else if (pageType === 'list') {
        this.listBrowser = new TopicListBrowser(this.history, onUpdate);
        await this.listBrowser.start();
      } else {
        window.location.href = LIST_OPTIONS[currentList]?.path || '/latest';
      }
    }

    async restartBrowsing() {
      this.topicBrowser?.stop();
      this.listBrowser?.stop();
      this.heartbeat();

      try {
        await this.runBrowserFor(getPageType());
      } catch (error) {
        await randomDelay(3000, 5000);
        window.location.href = LIST_OPTIONS[currentList]?.path || '/latest';
      }
    }

    startStuckDetection() {
      if (this.stuckCheckInterval) clearInterval(this.stuckCheckInterval);
      this.heartbeat();
      this.stuckCheckInterval = setInterval(() => this.checkStuck(), 10000);
    }

    stopStuckDetection() {
      if (this.stuckCheckInterval) {
        clearInterval(this.stuckCheckInterval);
        this.stuckCheckInterval = null;
      }
    }

    startUrlWatcher() {
      if (this.urlCheckInterval) clearInterval(this.urlCheckInterval);
      this.lastUrl = window.location.href;
      this.urlCheckInterval = setInterval(() => this.checkUrlChange(), 500);
    }

    stopUrlWatcher() {
      if (this.urlCheckInterval) {
        clearInterval(this.urlCheckInterval);
        this.urlCheckInterval = null;
      }
    }

    checkUrlChange() {
      const currentUrl = window.location.href;
      if (currentUrl !== this.lastUrl) {
        const oldPageType = this.getPageTypeFromUrl(this.lastUrl);
        const newPageType = getPageType();
        this.lastUrl = currentUrl;

        const pageTypeEl = document.getElementById('page-type');
        if (pageTypeEl) pageTypeEl.textContent = newPageType;

        if (this.isEnabled && oldPageType !== newPageType) {
          this.handlePageTypeChange(newPageType);
        }
      }
    }

    getPageTypeFromUrl(url) {
      try {
        return getPageTypeFromPath(new URL(url).pathname);
      } catch (e) {
        return 'other';
      }
    }

    async handlePageTypeChange(newPageType) {
      this.topicBrowser?.stop();
      this.listBrowser?.stop();
      await randomDelay(1000, 1500);
      this.heartbeat();

      try {
        await this.runBrowserFor(newPageType);
      } catch (error) {
        await randomDelay(2000, 3000);
        this.restartBrowsing();
      }
    }

    init() {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.setup());
      } else {
        this.setup();
      }
    }

    setup(retryCount = 0) {
      const loginState = getLoginState();

      // 无法判定登录状态（Ember 未渲染完成或 Cloudflare 挑战页）：轮询等待，最多 10 秒
      // 挑战页通过后会整页跳转、脚本重新注入，因此超时放弃是安全的
      if (loginState === null) {
        if (retryCount < 20) {
          setTimeout(() => this.setup(retryCount + 1), 500);
        } else {
          log('无法检测登录状态，跳过初始化');
        }
        return;
      }

      if (loginState === false) {
        log('请先登录 Linux.do');
        return;
      }

      this.createControlPanel();
      readingTracker.onUpdate = () => this.updateStats();
      this.topicBrowser = new TopicBrowser(this.history, () => this.updateStats());
      this.listBrowser = new TopicListBrowser(this.history, () => this.updateStats());

      const autoResume = Storage.get('auto_running', false);

      if (autoResume) {
        // --- 核心修复：防止多开无限自启动 ---
        const lastActiveTime = Storage.get('linuxdo_active_tab_time', 0);
        const activeTabId = Storage.get('linuxdo_active_tab_id', null);

        // 如果在15秒内有其他标签页活动，且不是当前标签页，放弃自启
        if (Date.now() - lastActiveTime < 15000 && activeTabId !== TAB_ID) {
            log('🚫 检测到其他标签页正在运行自动浏览，当前页面取消自动恢复');
            this.updateStats();
            document.getElementById('auto-status').textContent = '多开限制，未自启';
            return;
        }

        log('检测到自动运行状态，3秒后恢复运行...');
        setTimeout(() => {
          this.start();
        }, 3000);
      }
      this.updateStats();
    }

    createControlPanel() {
      const style = document.createElement('style');
      style.textContent = `
        #linuxdo-auto-panel {
          position: fixed; right: 20px; bottom: 20px; z-index: 99999;
          width: 264px; box-sizing: border-box;
          background: linear-gradient(160deg, #6d5bf0 0%, #7c4ddb 55%, #8b5cf6 100%);
          border: 1px solid rgba(255,255,255,0.14); border-radius: 16px;
          box-shadow: 0 12px 32px rgba(60,25,120,0.32), 0 2px 8px rgba(0,0,0,0.14);
          color: #fff; font-size: 13px; line-height: 1.4;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
          user-select: none; -webkit-user-select: none;
          transition: box-shadow .2s ease, border-radius .2s ease;
        }
        #linuxdo-auto-panel.dragging { box-shadow: 0 18px 44px rgba(60,25,120,0.45); }
        /* Discourse 全局样式会命中 svg 与盒模型，这里用 id 特异性顶回去 */
        #linuxdo-auto-panel, #linuxdo-auto-panel * { box-sizing: border-box; }
        #linuxdo-auto-panel svg { display: block; fill: none; stroke: currentColor; }

        /* 收起态：只留一个悬浮球 */
        #linuxdo-auto-panel.minimized { width: 56px; height: 56px; border-radius: 50%; }
        #linuxdo-auto-panel.minimized .panel-content,
        #linuxdo-auto-panel.minimized .panel-title,
        #linuxdo-auto-panel.minimized .btn-minimize { display: none; }
        #linuxdo-auto-panel.minimized .panel-header { width: 100%; height: 100%; padding: 0; justify-content: center; cursor: pointer; }
        #linuxdo-auto-panel.minimized .fab-icon { display: flex; }
        #linuxdo-auto-panel.minimized:hover { box-shadow: 0 12px 30px rgba(60,25,120,0.5); }
        /* 悬浮球上的运行指示：绿点 + 呼吸光环 */
        #linuxdo-auto-panel.minimized.running::before {
          content: ''; position: absolute; top: 3px; right: 3px; width: 10px; height: 10px;
          border-radius: 50%; background: #22c55e; border: 2px solid rgba(255,255,255,0.92);
        }
        #linuxdo-auto-panel.minimized.running::after {
          content: ''; position: absolute; inset: -3px; border-radius: 50%;
          border: 2px solid rgba(74,222,128,0.7); animation: fab-pulse 1.8s ease-out infinite;
        }
        @keyframes fab-pulse {
          0% { transform: scale(1); opacity: .8; }
          100% { transform: scale(1.35); opacity: 0; }
        }

        /* 标题栏同时是拖动手柄 */
        #linuxdo-auto-panel .panel-header {
          display: flex; align-items: center; gap: 8px; padding: 12px 12px 8px 14px;
          cursor: grab; touch-action: none;
        }
        #linuxdo-auto-panel.dragging .panel-header { cursor: grabbing; }
        #linuxdo-auto-panel .panel-title { flex: 1; font-size: 14px; font-weight: 600; letter-spacing: .2px; }
        #linuxdo-auto-panel .fab-icon { display: none; align-items: center; justify-content: center; }
        #linuxdo-auto-panel .btn-minimize {
          display: flex; align-items: center; justify-content: center; flex: none;
          width: 22px; height: 22px; padding: 0; border: 0; border-radius: 7px;
          background: rgba(255,255,255,0.16); color: #fff; cursor: pointer; transition: background .15s;
        }
        #linuxdo-auto-panel .btn-minimize:hover { background: rgba(255,255,255,0.3); }

        #linuxdo-auto-panel .panel-content { padding: 0 14px 14px; animation: panel-in .18s ease; }
        @keyframes panel-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }

        /* 分段选择器 */
        #linuxdo-auto-panel .row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        #linuxdo-auto-panel .row-label { flex: none; width: 28px; font-size: 12px; color: rgba(255,255,255,0.72); }
        #linuxdo-auto-panel .seg { display: flex; flex: 1; gap: 2px; padding: 2px; background: rgba(0,0,0,0.16); border-radius: 9px; }
        #linuxdo-auto-panel .speed-btn {
          flex: 1 1 0; padding: 5px 0; border: 0; border-radius: 7px; background: transparent;
          color: rgba(255,255,255,0.78); font-size: 11px; font-family: inherit; cursor: pointer;
          transition: background .15s, color .15s;
        }
        #linuxdo-auto-panel .speed-btn:hover { background: rgba(255,255,255,0.14); color: #fff; }
        #linuxdo-auto-panel .speed-btn.active { background: #fff; color: #5b3bc4; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.18); }

        /* 动作按钮 */
        #linuxdo-auto-panel .action-btn {
          width: 100%; margin-top: 8px; padding: 9px; border: 0; border-radius: 10px;
          font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer; transition: filter .15s, background .15s;
        }
        #linuxdo-auto-panel .action-btn:hover { filter: brightness(1.08); }
        #linuxdo-auto-panel .btn-start { background: #22c55e; color: #fff; box-shadow: 0 2px 10px rgba(34,197,94,0.32); }
        #linuxdo-auto-panel .btn-stop { background: #ef4444; color: #fff; box-shadow: 0 2px 10px rgba(239,68,68,0.32); }
        #linuxdo-auto-panel .btn-clear {
          padding: 7px; background: transparent; border: 1px solid rgba(255,255,255,0.26);
          color: rgba(255,255,255,0.82); font-size: 12px; font-weight: 500;
        }
        #linuxdo-auto-panel .btn-clear:hover { background: rgba(255,255,255,0.12); }

        /* 统计区 */
        #linuxdo-auto-panel .stats { margin-top: 10px; padding: 9px 12px; background: rgba(0,0,0,0.14); border-radius: 10px; }
        #linuxdo-auto-panel .stats-row { display: flex; justify-content: space-between; align-items: center; margin: 5px 0; font-size: 12px; }
        #linuxdo-auto-panel .stats-label { color: rgba(255,255,255,0.68); }
        #linuxdo-auto-panel .stats-value { font-weight: 600; font-variant-numeric: tabular-nums; }
        #linuxdo-auto-panel .status-indicator { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
        #linuxdo-auto-panel .status-indicator.running { background: #22c55e; animation: pulse 1.5s infinite; }
        #linuxdo-auto-panel .status-indicator.stopped { background: #f87171; }

        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .auto-viewed { opacity: 0.6; }
      `;
      document.head.appendChild(style);

      const panel = document.createElement('div');
      panel.id = 'linuxdo-auto-panel';
      panel.innerHTML = `
        <div class="panel-header">
          <span class="fab-icon">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 7v14"/>
              <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>
            </svg>
          </span>
          <span class="panel-title">Linux.do 自动助手</span>
          <button class="btn-minimize" id="btn-minimize" title="收起">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14"/></svg>
          </button>
        </div>
        <div class="panel-content">
          <div class="row"><span class="row-label">速度</span><div class="seg">
            <button class="speed-btn ${currentSpeed==='slow'?'active':''}" data-speed="slow">慢</button>
            <button class="speed-btn ${currentSpeed==='normal'?'active':''}" data-speed="normal">正常</button>
            <button class="speed-btn ${currentSpeed==='fast'?'active':''}" data-speed="fast">快</button>
            <button class="speed-btn ${currentSpeed==='turbo'?'active':''}" data-speed="turbo">极速</button>
          </div></div>
          <div class="row"><span class="row-label">列表</span><div class="seg">
            <button class="speed-btn list-btn ${currentList==='latest'?'active':''}" data-list="latest">最新</button>
            <button class="speed-btn list-btn ${currentList==='new'?'active':''}" data-list="new">新帖</button>
            <button class="speed-btn list-btn ${currentList==='unread'?'active':''}" data-list="unread">未读</button>
          </div></div>
          <div class="row"><span class="row-label">点赞</span><div class="seg">
            <button class="speed-btn like-btn ${enableLike?'active':''}" data-like="true">开启</button>
            <button class="speed-btn like-btn ${!enableLike?'active':''}" data-like="false">关闭</button>
          </div></div>
          <button class="action-btn btn-start" id="btn-auto-start">开始自动浏览</button>
          <button class="action-btn btn-stop" id="btn-auto-stop" style="display:none;">停止运行</button>
          <button class="action-btn btn-clear" id="btn-clear-history">清除浏览记录</button>
          <div class="stats">
            <div class="stats-row"><span class="stats-label">状态</span><span class="stats-value"><span class="status-indicator stopped" id="status-dot"></span><span id="auto-status">未启动</span></span></div>
            <div class="stats-row"><span class="stats-label">页面类型</span><span class="stats-value" id="page-type">-</span></div>
            <div class="stats-row"><span class="stats-label">本次帖子/回复</span><span class="stats-value"><span id="session-viewed">0</span> / <span id="session-replies">0</span></span></div>
            <div class="stats-row"><span class="stats-label">本次点赞</span><span class="stats-value" id="session-liked">0</span></div>
            <div class="stats-row"><span class="stats-label">本次总阅读量</span><span class="stats-value" id="session-read-count">0</span></div>
          </div>
        </div>
      `;
      document.body.appendChild(panel);
      this.panel = panel;

      // 默认收起成悬浮球，只在用户展开过后才记住展开态
      if (Storage.get('panel_minimized', true)) {
        panel.classList.add('minimized');
      }
      this.restorePosition();
      this.initDrag();

      document.getElementById('btn-auto-start').addEventListener('click', () => this.start(true));
      document.getElementById('btn-auto-stop').addEventListener('click', () => this.stop());
      document.getElementById('btn-minimize').addEventListener('click', () => this.toggleMinimize());
      document.getElementById('btn-clear-history').addEventListener('click', () => this.clearHistory());

      document.querySelectorAll('.speed-btn[data-speed]').forEach(btn => btn.addEventListener('click', (e) => {
        setSpeed(e.target.dataset.speed);
        document.querySelectorAll('.speed-btn[data-speed]').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
      }));
      document.querySelectorAll('.list-btn[data-list]').forEach(btn => btn.addEventListener('click', (e) => {
        setList(e.target.dataset.list);
        document.querySelectorAll('.list-btn[data-list]').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
      }));
      document.querySelectorAll('.like-btn[data-like]').forEach(btn => btn.addEventListener('click', (e) => {
        setEnableLike(e.target.dataset.like === 'true');
        document.querySelectorAll('.like-btn[data-like]').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
      }));

      document.getElementById('page-type').textContent = getPageType();
    }

    // 拖动：手柄是标题栏（收起态下它就是整个悬浮球），松手后记住位置
    // 位移不超过阈值视为点击，收起态下即展开面板
    initDrag() {
      const panel = this.panel;
      const handle = panel.querySelector('.panel-header');
      const DRAG_THRESHOLD = 4;

      let pointerId = null;
      let startX = 0, startY = 0, originLeft = 0, originTop = 0, moved = false;

      const onMove = (e) => {
        if (e.pointerId !== pointerId) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        if (!moved) {
          moved = true;
          panel.classList.add('dragging');
        }
        this.setPosition(originLeft + dx, originTop + dy);
      };

      const onUp = (e) => {
        if (e.pointerId !== pointerId) return;
        try { handle.releasePointerCapture(pointerId); } catch (err) { /* 捕获可能已自动释放 */ }
        pointerId = null;
        panel.classList.remove('dragging');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);

        if (moved) {
          this.savePosition();
        } else if (panel.classList.contains('minimized')) {
          this.toggleMinimize();
        }
      };

      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || pointerId !== null) return;
        if (e.target.closest('button')) return; // 收起按钮走自己的 click

        const rect = panel.getBoundingClientRect();
        originLeft = rect.left;
        originTop = rect.top;
        startX = e.clientX;
        startY = e.clientY;
        moved = false;
        pointerId = e.pointerId;

        try { handle.setPointerCapture(e.pointerId); } catch (err) { /* 部分环境不支持指针捕获 */ }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        e.preventDefault();
      });

      window.addEventListener('resize', () => this.clampPosition());
    }

    // 改用视口左上角定位，并把面板钳制在可视范围内
    setPosition(left, top) {
      const panel = this.panel;
      const margin = 8;
      const maxLeft = Math.max(margin, window.innerWidth - panel.offsetWidth - margin);
      const maxTop = Math.max(margin, window.innerHeight - panel.offsetHeight - margin);
      panel.style.left = `${Math.round(Math.min(Math.max(left, margin), maxLeft))}px`;
      panel.style.top = `${Math.round(Math.min(Math.max(top, margin), maxTop))}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }

    clampPosition() {
      if (!this.panel.style.left) return; // 没拖动过，保持默认右下角锚定
      const rect = this.panel.getBoundingClientRect();
      this.setPosition(rect.left, rect.top);
    }

    savePosition() {
      const rect = this.panel.getBoundingClientRect();
      Storage.set('panel_pos', {
        left: rect.left,
        top: rect.top,
        right: window.innerWidth - rect.right,
        alignRight: rect.left + rect.width / 2 > window.innerWidth / 2
      });
    }

    restorePosition() {
      const pos = Storage.get('panel_pos', null);
      if (!pos || !Number.isFinite(pos.top)) return;
      const left = pos.alignRight && Number.isFinite(pos.right)
        ? window.innerWidth - pos.right - this.panel.offsetWidth
        : pos.left;
      if (Number.isFinite(left)) this.setPosition(left, pos.top);
    }

    toggleMinimize() {
      const panel = this.panel;
      const before = panel.getBoundingClientRect();
      // 面板在屏幕右半边时保持右边缘不动，展开才不会往视口外顶
      const keepRight = before.left + before.width / 2 > window.innerWidth / 2;

      const minimized = panel.classList.toggle('minimized');
      Storage.set('panel_minimized', minimized);

      if (panel.style.left) {
        this.setPosition(keepRight ? before.right - panel.offsetWidth : before.left, before.top);
      } else if (panel.getBoundingClientRect().top < 0) {
        // 默认锚在右下角，视口太矮时展开会顶出屏幕，转为绝对定位兜底
        const rect = panel.getBoundingClientRect();
        this.setPosition(rect.left, 8);
      }
    }

    updateStats() {
      const stats = this.history.getStats();
      document.getElementById('session-viewed').textContent = stats.sessionViewed;
      document.getElementById('session-replies').textContent = stats.sessionReplies;
      document.getElementById('session-liked').textContent = stats.sessionLiked;
      document.getElementById('session-read-count').textContent = readingTracker.count;
    }

    async start(isManual = false) {
      // 如果是手动启动，检查是否有其他正在运行的进程
      if (isManual) {
        const lastActiveTime = Storage.get('linuxdo_active_tab_time', 0);
        const activeTabId = Storage.get('linuxdo_active_tab_id', null);
        if (Date.now() - lastActiveTime < 15000 && activeTabId !== TAB_ID && Storage.get('auto_running', false)) {
            if (!confirm('⚠️ 警告：检测到后台已有其他页面正在自动浏览。\\n\\n如果在多页同时运行可能会导致浏览器卡死。强制接管此页码？')) {
                return;
            }
        }

        // 手动点击「开始」时清零本次总阅读量（自动恢复运行时不清零，保证刷新/跳转后延续）
        readingTracker.reset();
      }

      this.isEnabled = true;
      Storage.set('auto_running', true);
      this.heartbeat();

      document.getElementById('btn-auto-start').style.display = 'none';
      document.getElementById('btn-auto-stop').style.display = 'block';
      document.getElementById('auto-status').textContent = '运行中';
      document.getElementById('status-dot').className = 'status-indicator running';
      this.panel.classList.add('running');

      this.startStuckDetection();
      this.startUrlWatcher();

      try {
        await this.runBrowserFor(getPageType());
      } catch (error) {
        if (this.isEnabled) {
          document.getElementById('auto-status').textContent = '出错，重试中...';
          await randomDelay(5000, 8000);
          if (this.isEnabled) this.restartBrowsing();
        }
      }
    }

    stop() {
      this.isEnabled = false;
      Storage.set('auto_running', false);
      Storage.set('linuxdo_active_tab_time', 0); // 释放占用锁

      this.stopStuckDetection();
      this.stopUrlWatcher();
      this.topicBrowser?.stop();
      this.listBrowser?.stop();

      document.getElementById('btn-auto-start').style.display = 'block';
      document.getElementById('btn-auto-stop').style.display = 'none';
      document.getElementById('auto-status').textContent = '已停止';
      document.getElementById('status-dot').className = 'status-indicator stopped';
      this.panel.classList.remove('running');
    }

    clearHistory() {
      if (confirm('确定要清除所有浏览记录吗？这将允许重新浏览所有话题。')) {
        this.history.clearHistory();
        this.updateStats();
        alert('浏览记录已清除');
      }
    }
  }

  // ==================== 启动 ====================
  installTimingsHook();
  const automation = new LinuxDoAutomation();
  automation.init();

  // 页面卸载时把节流未落盘的浏览记录 flush 掉，避免翻页时丢失最后几条记录
  // flushPending 只在确有待写数据时才写，路过/未登录页面不会触发，避免空数据覆盖历史
  // 注意：这里不再释放防多开锁——脚本自身翻页也会触发 beforeunload，会导致锁在每次
  // 跳转间隙被误释放；锁改为依赖 15 秒心跳超时自然失效，手动停止时由 stop() 主动释放
  window.addEventListener('beforeunload', () => {
    automation.history.flushPending();
  });

})();
