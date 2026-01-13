/**
 * EVS - Dual Player Architecture with Adaptive Buffering
 * YouTube / Bilibili 対応
 */

// ========== デバッグ設定 ==========
const DEBUG = true; // 本番では false に

const log = (...args) => {
  if (DEBUG) console.log(...args);
};

const warn = (...args) => {
  if (DEBUG) console.warn(...args);
};

const error = (...args) => {
  console.error(...args); // エラーは常に出力
};

// ========== トランジション設定 ==========
const TRANSITION_DURATION_NEW_VIDEO = 6000; // 新しい動画への切り替え時(ms)
const TRANSITION_DURATION_SAME_VIDEO = 4000; // 同じ動画内での位置変更時(ms)
const DEFAULT_VIDEO_ID = "Rg6EB9RTHfc";
const DEFAULT_PLATFORM = "youtube";

// ========== 同期・タイミング設定 ==========
const SYNC_THRESHOLD_WAIT = 50;       // 同期待機の閾値(ms)
const SYNC_THRESHOLD_LATE = -100;     // 遅延判定の閾値(ms)
const BILIBILI_BUFFER_WAIT = 2000;    // Bilibili バッファリング待機(ms)
const BILIBILI_LOOP_MARGIN = 0.5;     // ループ前の余裕(秒)

// ========== Bilibili iframe スタイル ==========
const BILIBILI_IFRAME_STYLE = 'position:absolute;top:-14%;left:0;width:100%;height:135%;border:none;z-index:5;';

// ========== ユーティリティ関数 ==========
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ========== NetworkMonitor: 通信状況の監視・学習（プラットフォーム別） ==========
const NetworkMonitor = {
  // プラットフォーム別のデータ（キャッシュ付き）
  platforms: {
    youtube: { loadTimes: [], lateCount: 0, totalCount: 0, _cache: { valid: false } },
    bilibili: { loadTimes: [], lateCount: 0, totalCount: 0, _cache: { valid: false } },
  },
  maxSamples: 15,

  // プラットフォーム別の設定
  config: {
    youtube: {
      minAheadTime: 0.5,
      maxAheadTime: 5.0,
      defaultAheadTime: 1.5,
      safetyMargin: 1.2,
    },
    bilibili: {
      minAheadTime: 2.0,      // Bilibili は遅いので最低2秒
      maxAheadTime: 15.0,     // 最大15秒まで許容
      defaultAheadTime: 4.0,  // デフォルト4秒
      safetyMargin: 1.5,      // 安全マージンも大きめ
    },
  },

  getData(platform) {
    const data = this.platforms[platform] || this.platforms.youtube;
    if (!data._cache) {
      data._cache = { valid: false };
    }
    return data;
  },

  getConfig(platform) {
    return this.config[platform] || this.config.youtube;
  },

  /**
   * キャッシュを無効化
   */
  invalidateCache(platform) {
    const data = this.getData(platform);
    data._cache.valid = false;
  },

  /**
   * キャッシュを更新（計算結果を保存）
   */
  updateCache(platform) {
    const data = this.getData(platform);
    const config = this.getConfig(platform);

    if (data.loadTimes.length === 0) {
      data._cache = {
        valid: true,
        avg: config.defaultAheadTime * 1000,
        stdDev: 0,
        p95: config.defaultAheadTime * 1000,
      };
      return;
    }

    // 平均値
    const avg = data.loadTimes.reduce((a, b) => a + b, 0) / data.loadTimes.length;

    // 標準偏差
    let stdDev = 0;
    if (data.loadTimes.length >= 2) {
      const squareDiffs = data.loadTimes.map(t => Math.pow(t - avg, 2));
      stdDev = Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / data.loadTimes.length);
    }

    // 95パーセンタイル
    const sorted = [...data.loadTimes].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * 0.95);
    const p95 = sorted[Math.min(index, sorted.length - 1)];

    data._cache = { valid: true, avg, stdDev, p95 };
  },

  /**
   * キャッシュが有効か確認し、無効なら更新
   */
  ensureCache(platform) {
    const data = this.getData(platform);
    if (!data._cache.valid) {
      this.updateCache(platform);
    }
  },

  recordLoadTime(platform, loadTimeMs) {
    const data = this.getData(platform);
    data.loadTimes.push(loadTimeMs);
    if (data.loadTimes.length > this.maxSamples) {
      data.loadTimes.shift();
    }
    data.totalCount++;
    this.invalidateCache(platform); // キャッシュ無効化
    log(`[Network:${platform}] ロード時間記録: ${loadTimeMs}ms (サンプル数: ${data.loadTimes.length})`);
  },

  recordLate(platform, lateMs) {
    const data = this.getData(platform);
    data.lateCount++;
    const lateRate = (data.lateCount / data.totalCount * 100).toFixed(1);
    log(`[Network:${platform}] 遅延発生: ${lateMs}ms (遅延率: ${lateRate}%)`);
  },

  getAverageLoadTime(platform) {
    this.ensureCache(platform);
    return this.getData(platform)._cache.avg;
  },

  getStdDev(platform) {
    this.ensureCache(platform);
    return this.getData(platform)._cache.stdDev;
  },

  getPercentileLoadTime(platform, percentile = 0.95) {
    // 0.95 以外のパーセンタイルは都度計算
    if (percentile !== 0.95) {
      const data = this.getData(platform);
      const config = this.getConfig(platform);
      if (data.loadTimes.length === 0) {
        return config.defaultAheadTime * 1000;
      }
      const sorted = [...data.loadTimes].sort((a, b) => a - b);
      const index = Math.floor(sorted.length * percentile);
      return sorted[Math.min(index, sorted.length - 1)];
    }
    this.ensureCache(platform);
    return this.getData(platform)._cache.p95;
  },

  getRecommendedAheadTime(platform) {
    const data = this.getData(platform);
    const config = this.getConfig(platform);
    const { minAheadTime, maxAheadTime, defaultAheadTime, safetyMargin } = config;

    if (data.loadTimes.length < 3) {
      return defaultAheadTime;
    }

    const p95LoadTime = this.getPercentileLoadTime(platform, 0.95);
    const stdDev = this.getStdDev(platform);
    let recommended = (p95LoadTime + stdDev * safetyMargin) / 1000;

    if (data.totalCount > 5) {
      const lateRate = data.lateCount / data.totalCount;
      if (lateRate > 0.1) {
        recommended *= 1.2;
        log(`[Network:${platform}] 遅延率 ${(lateRate * 100).toFixed(1)}% のため ahead_time を増加`);
      }
    }

    recommended = Math.max(minAheadTime, Math.min(maxAheadTime, recommended));
    return recommended;
  },

  getNetworkQuality(platform) {
    const avg = this.getAverageLoadTime(platform);
    // Bilibili は基準を緩める
    if (platform === "bilibili") {
      if (avg < 2000) return "excellent";
      if (avg < 4000) return "good";
      if (avg < 6000) return "fair";
      if (avg < 10000) return "poor";
      return "bad";
    }
    // YouTube
    if (avg < 500) return "excellent";
    if (avg < 1000) return "good";
    if (avg < 2000) return "fair";
    if (avg < 4000) return "poor";
    return "bad";
  },

  printStats(platform = null) {
    const platforms = platform ? [platform] : ["youtube", "bilibili"];

    platforms.forEach(p => {
      const data = this.getData(p);
      if (data.loadTimes.length === 0) {
        log(`[Network:${p}] データなし`);
        return;
      }

      const avg = this.getAverageLoadTime(p);
      const stdDev = this.getStdDev(p);
      const p95 = this.getPercentileLoadTime(p, 0.95);
      const min = Math.min(...data.loadTimes);
      const max = Math.max(...data.loadTimes);
      const quality = this.getNetworkQuality(p);
      const recommended = this.getRecommendedAheadTime(p);
      const successRate = data.totalCount > 0
        ? ((data.totalCount - data.lateCount) / data.totalCount * 100).toFixed(1)
        : 100;

      log(`
╔════════════════════════════════════════════╗
║   Network Stats: ${p.toUpperCase().padEnd(24)}║
╠════════════════════════════════════════════╣
║ Quality: ${quality.padEnd(10)} Samples: ${String(data.loadTimes.length).padStart(3)}       ║
╠════════════════════════════════════════════╣
║ Load Time (ms)                             ║
║   Average: ${String(Math.round(avg)).padStart(6)}   StdDev: ${String(Math.round(stdDev)).padStart(6)}     ║
║   Min: ${String(Math.round(min)).padStart(6)}       Max: ${String(Math.round(max)).padStart(6)}        ║
║   95th Percentile: ${String(Math.round(p95)).padStart(6)}                ║
╠════════════════════════════════════════════╣
║ Sync Performance                           ║
║   Success Rate: ${successRate.padStart(5)}%                    ║
║   Late Count: ${String(data.lateCount).padStart(3)} / ${String(data.totalCount).padStart(3)}                   ║
╠════════════════════════════════════════════╣
║ Recommended ahead_time: ${recommended.toFixed(2)}s             ║
╚════════════════════════════════════════════╝
      `);
    });
  },
};

// ========== VideoPlayer クラス（YouTube / Bilibili 両対応） ==========
class VideoPlayer {
  constructor(containerId, index) {
    this.index = index;
    this.containerId = containerId;
    this.wrapper = document.getElementById(`${containerId}-wrapper`);
    this.container = document.getElementById(containerId);
    this.isReady = false;
    this.pendingResolve = null;
    this.videoInfo = null;
    this.loadStartTime = 0;

    // プラットフォーム別
    this.platform = null;
    this.ytPlayer = null;      // YouTube Player
    this.bilibiliIframe = null; // Bilibili iframe
  }

  /**
   * YouTube Player を初期化
   */
  initYouTube(videoId = null) {
    this.platform = "youtube";
    return new Promise((resolve) => {
      const config = {
        width: "100%",
        height: "100%",
        events: {
          onReady: (event) => {
            this.isReady = true;
            event.target.mute();
            if (videoId) {
              event.target.playVideo();
            }
            resolve();
          },
          onStateChange: (event) => this.onYouTubeStateChange(event),
        },
        playerVars: {
          rel: 0,
          controls: 0,
          cc_load_policy: 0,
          iv_load_policy: 3,
        },
      };

      if (videoId) {
        config.videoId = videoId;
      }

      this.ytPlayer = new YT.Player(this.containerId, config);
    });
  }

  /**
   * Bilibili iframe を作成
   */
  createBilibiliIframe(videoId, startTime = 0, page = 1) {
    // 既存の Bilibili iframe を削除
    if (this.bilibiliIframe) {
      this.bilibiliIframe.remove();
      this.bilibiliIframe = null;
    }

    // YouTube Player があれば停止
    if (this.ytPlayer) {
      try {
        this.ytPlayer.pauseVideo();
      } catch (e) {}
    }

    // wrapper 内の全ての既存 iframe を非表示（YouTube iframe）
    const existingIframes = this.wrapper.querySelectorAll('iframe');
    existingIframes.forEach(iframe => {
      iframe.style.display = 'none';
      iframe.style.visibility = 'hidden';
      log(`[Player ${this.index}] Hiding existing iframe for Bilibili`);
    });

    this.platform = "bilibili";

    // BV形式かAV形式かを判定
    // Note: Bilibili埋め込みプレイヤーはループ非対応
    // パラメータ:
    //   autoplay=1 - 自動再生
    //   danmaku=0 - コメント非表示
    //   high_quality=1 - 高画質
    //   as_wide=1 - ワイドモード
    //   muted=1 - ミュート状態で開始
    //   volume=0 - 音量0で開始（二重保険）
    const biliParams = `&autoplay=1&danmaku=0&high_quality=1&as_wide=1&muted=1&volume=0`;
    let src;
    if (videoId.startsWith("BV")) {
      src = `//player.bilibili.com/player.html?bvid=${videoId}&page=${page}&t=${Math.floor(startTime)}${biliParams}`;
    } else if (videoId.startsWith("av")) {
      const aid = videoId.replace("av", "");
      src = `//player.bilibili.com/player.html?aid=${aid}&page=${page}&t=${Math.floor(startTime)}${biliParams}`;
    } else {
      // デフォルトは BV形式として扱う
      src = `//player.bilibili.com/player.html?bvid=${videoId}&page=${page}&t=${Math.floor(startTime)}${biliParams}`;
    }

    log(`[Player ${this.index}] Creating Bilibili iframe: ${src}`);

    this.bilibiliIframe = document.createElement('iframe');
    // Bilibili プレイヤーのUI を隠すため、拡大して上下を画面外に
    this.bilibiliIframe.style.cssText = BILIBILI_IFRAME_STYLE;
    this.bilibiliIframe.setAttribute('scrolling', 'no');
    this.bilibiliIframe.setAttribute('allow', 'autoplay; fullscreen');
    // ミュート強制（効くかは環境依存だが試す）
    this.bilibiliIframe.setAttribute('muted', '');
    this.bilibiliIframe.muted = true;
    // src は loadBilibiliAndWait で onload 設定後にセットする
    this.bilibiliIframe.dataset.src = src;

    // Bilibili からの postMessage を監視（対応していれば）
    this.setupBilibiliMessageListener();

    return this.bilibiliIframe;
  }

  /**
   * Bilibili プレイヤーからの postMessage を監視
   */
  setupBilibiliMessageListener() {
    // 既存のリスナーがあれば削除
    if (this.bilibiliMessageHandler) {
      window.removeEventListener('message', this.bilibiliMessageHandler);
    }

    this.bilibiliMessageHandler = (event) => {
      // Bilibili からのメッセージのみ処理
      if (event.origin.includes('bilibili.com')) {
        log(`[Player ${this.index}] Bilibili message:`, event.data);

        // 動画終了を検知できたらループ
        if (event.data && (event.data.event === 'ended' || event.data.type === 'ended')) {
          log(`[Player ${this.index}] Bilibili video ended, restarting...`);
          this.restartBilibili();
        }
      }
    };

    window.addEventListener('message', this.bilibiliMessageHandler);
  }

  /**
   * Bilibili 動画を最初から再生し直す
   */
  restartBilibili() {
    if (this.bilibiliIframe && this.bilibiliIframe.dataset.src) {
      // t=0 にして再読み込み
      const src = this.bilibiliIframe.dataset.src.replace(/&t=\d+/, '&t=0');
      this.bilibiliIframe.src = src;
      log(`[Player ${this.index}] Bilibili restarted from beginning`);
    }
  }

  /**
   * YouTube の状態変化を処理
   */
  onYouTubeStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING && this.pendingResolve) {
      const loadTime = Date.now() - this.loadStartTime;
      NetworkMonitor.recordLoadTime("youtube", loadTime);

      if (this.ytPlayer) {
        try {
          this.ytPlayer.pauseVideo();
        } catch (e) {
          warn(`[Player ${this.index}] pauseVideo error in stateChange:`, e);
        }
      }
      const resolver = this.pendingResolve;
      this.pendingResolve = null;
      resolver(loadTime);
      return;
    }

    if (event.data === YT.PlayerState.ENDED) {
      if (this.ytPlayer) {
        try {
          this.ytPlayer.playVideo();
        } catch (e) {
          warn(`[Player ${this.index}] playVideo error in stateChange:`, e);
        }
      }
    }
  }

  /**
   * 動画をロードして待機状態にする
   */
  loadAndWait(videoInfo) {
    this.loadStartTime = Date.now();
    const platform = videoInfo.platform || "youtube";
    const videoId = videoInfo.videoId;
    const startTime = videoInfo.targetTime + (videoInfo.aheadTime || 0);
    const page = videoInfo.page || 1;

    if (platform === "youtube") {
      return this.loadYouTubeAndWait(videoId, startTime);
    } else if (platform === "bilibili") {
      return this.loadBilibiliAndWait(videoId, startTime, page);
    }

    return Promise.resolve();
  }

  /**
   * YouTube 動画をロード
   */
  loadYouTubeAndWait(videoId, startTime) {
    // Bilibili iframe があれば削除
    if (this.bilibiliIframe) {
      this.bilibiliIframe.remove();
      this.bilibiliIframe = null;
    }

    // YouTube Player の iframe を表示（非表示になっていた場合）
    // YouTube API が container を置き換えるので wrapper から検索
    const ytIframe = this.wrapper.querySelector('iframe');
    if (ytIframe) {
      ytIframe.style.display = '';
      ytIframe.style.visibility = 'visible';
      log(`[Player ${this.index}] YouTube iframe restored`);
    }

    this.platform = "youtube";

    return new Promise((resolve) => {
      this.pendingResolve = resolve;
      try {
        this.ytPlayer.loadVideoById({
          videoId: videoId,
          startSeconds: startTime,
        });
        this.ytPlayer.mute();
      } catch (e) {
        warn(`[Player ${this.index}] loadYouTubeAndWait error:`, e);
        resolve();
      }
    });
  }

  /**
   * Bilibili 動画をロード
   * Note: クロスオリジンのため onload イベントが発火しないことがある
   *       そのため固定の待機時間を使用
   */
  loadBilibiliAndWait(videoId, startTime, page) {
    return new Promise((resolve) => {
      const iframe = this.createBilibiliIframe(videoId, startTime, page);

      // DOM に追加（wrapper に追加）
      this.wrapper.appendChild(iframe);

      // src をセット（これでロード開始）
      iframe.src = iframe.dataset.src;
      log(`[Player ${this.index}] Bilibili iframe src set`);

      // Bilibili はクロスオリジンのため onload が発火しないことがある
      // 固定時間待ってから続行（バッファリング時間）
      setTimeout(() => {
        const loadTime = Date.now() - this.loadStartTime;
        NetworkMonitor.recordLoadTime("bilibili", loadTime);
        log(`[Player ${this.index}] Bilibili ready (waited ${loadTime}ms)`);
        resolve(loadTime);
      }, BILIBILI_BUFFER_WAIT);
    });
  }

  /**
   * 再生開始
   */
  play() {
    if (this.platform === "youtube" && this.ytPlayer) {
      try {
        this.ytPlayer.mute();
        this.ytPlayer.playVideo();
      } catch (e) {
        warn(`[Player ${this.index}] YouTube play error:`, e);
      }
    }
    // Bilibili は autoplay=1 で自動再生されるので何もしない
  }

  /**
   * 停止
   */
  stop() {
    log(`[Player ${this.index}] stop() called`);

    // YouTube Player を停止・非表示
    if (this.ytPlayer) {
      try {
        this.ytPlayer.pauseVideo();
        this.ytPlayer.mute();
      } catch (e) {
        warn(`[Player ${this.index}] YouTube stop error:`, e);
      }
    }

    // wrapper 内の全ての iframe を非表示（YouTube API が container を置き換えるため wrapper を使用）
    const iframes = this.wrapper.querySelectorAll('iframe');
    iframes.forEach((iframe, i) => {
      iframe.style.display = 'none';
      iframe.style.visibility = 'hidden';
      log(`[Player ${this.index}] iframe ${i} hidden (src: ${iframe.src?.substring(0, 50)}...)`);
    });

    // Bilibili iframe があれば削除
    if (this.bilibiliIframe) {
      this.bilibiliIframe.remove();
      this.bilibiliIframe = null;
    }

    // メモリリーク対策: Bilibili message listener を削除
    if (this.bilibiliMessageHandler) {
      window.removeEventListener('message', this.bilibiliMessageHandler);
      this.bilibiliMessageHandler = null;
      log(`[Player ${this.index}] Bilibili message listener removed`);
    }
  }

  /**
   * 表示（前面に出す）
   */
  show() {
    this.wrapper.classList.remove('player-standby');
    this.wrapper.classList.add('player-active');
    this.wrapper.style.opacity = "1";
    this.wrapper.style.zIndex = "2";
  }

  /**
   * 非表示（背面に下げる）
   */
  hide() {
    this.wrapper.classList.remove('player-active');
    this.wrapper.classList.add('player-standby');
    this.wrapper.style.opacity = "0";
    this.wrapper.style.zIndex = "1";
  }

  /**
   * トランジションを無効化
   */
  disableTransition() {
    this.wrapper.classList.add('no-transition');
    this.wrapper.classList.remove('transition-new-video', 'transition-same-video');
    this.wrapper.style.transition = "none";
  }

  /**
   * トランジションを設定
   * @param {boolean} isSameVideo - 同じ動画かどうか
   */
  setTransition(isSameVideo) {
    this.wrapper.classList.remove('no-transition');
    if (isSameVideo) {
      this.wrapper.classList.add('transition-same-video');
      this.wrapper.classList.remove('transition-new-video');
    } else {
      this.wrapper.classList.add('transition-new-video');
      this.wrapper.classList.remove('transition-same-video');
    }
  }

  /**
   * シーク（YouTube のみ）
   */
  seekTo(seconds) {
    if (this.platform === "youtube" && this.ytPlayer) {
      try {
        this.ytPlayer.seekTo(seconds, true);
      } catch (e) {
        warn(`[Player ${this.index}] seekTo error:`, e);
      }
    }
    // Bilibili は seekTo 非対応
  }
}

// ========== PlayerManager ==========
const PlayerManager = {
  players: [],
  activeIndex: 0,
  isTransitioning: false,
  switchCount: 0,
  lastVideoId: null,
  lastPlatform: null,
  bilibiliLoopTimer: null, // Bilibili 自動ループ用タイマー

  get active() {
    return this.players[this.activeIndex];
  },

  get standby() {
    return this.players[1 - this.activeIndex];
  },

  async init() {
    this.players = [
      new VideoPlayer("player-a", 0),
      new VideoPlayer("player-b", 1),
    ];

    // 両方の YouTube Player を初期化
    await this.players[0].initYouTube(DEFAULT_VIDEO_ID);
    this.players[0].show();

    await this.players[1].initYouTube(null);
    this.players[1].hide();

    log("PlayerManager initialized with dual players (YouTube/Bilibili support)");
  },

  async switchTo(videoInfo) {
    if (this.isTransitioning) {
      log("トランジション中のため、リクエストをスキップします");
      return;
    }

    this.isTransitioning = true;
    this.switchCount++;
    const switchId = this.switchCount;

    const next = this.standby;
    const current = this.active;

    const platform = videoInfo.platform || "youtube";
    const ahead_time = NetworkMonitor.getRecommendedAheadTime(platform);

    // 同じ動画かどうかを判定
    const isSameVideo = this.lastVideoId === videoInfo.videoId && this.lastPlatform === platform;
    const transitionDuration = isSameVideo ? TRANSITION_DURATION_SAME_VIDEO : TRANSITION_DURATION_NEW_VIDEO;

    log(`\n[Switch #${switchId}] ========================================`);
    log(`[Switch #${switchId}] Platform: ${platform}`);
    log(`[Switch #${switchId}] Active: Player ${current.index} → Standby: Player ${next.index}`);
    log(`[Switch #${switchId}] Video: ${videoInfo.videoId} ${isSameVideo ? '(同じ動画)' : '(新しい動画)'}`);
    log(`[Switch #${switchId}] targetTime: ${videoInfo.targetTime.toFixed(2)}s`);
    log(`[Switch #${switchId}] ahead_time: ${ahead_time.toFixed(2)}s (adaptive)`);
    log(`[Switch #${switchId}] トランジション: ${transitionDuration}ms`);

    const requestTime = Date.now();

    try {
      // 1. 裏でロード
      const loadStartTime = Date.now();
      const loadInfo = {
        ...videoInfo,
        aheadTime: ahead_time,
      };
      await next.loadAndWait(loadInfo);
      const actualLoadTime = Date.now() - loadStartTime;

      log(`[Switch #${switchId}] ロード完了: ${actualLoadTime}ms`);

      // 2. 同期タイミングを計算（YouTube のみ）
      const syncEnabled = videoInfo.syncEnabled !== false;
      const targetPlayTime = videoInfo.systemUnixTime + ahead_time * 1000;
      const now = Date.now();
      const timeToTarget = targetPlayTime - now;

      log(`[Switch #${switchId}] 同期: ${syncEnabled ? 'ON' : 'OFF'}, 残り時間: ${timeToTarget}ms`);

      // 3. 同期処理（YouTube のみ）
      if (syncEnabled && platform === "youtube") {
        if (timeToTarget > SYNC_THRESHOLD_WAIT) {
          log(`[Switch #${switchId}] ${timeToTarget}ms 待機...`);
          await sleep(timeToTarget);
        } else if (timeToTarget < SYNC_THRESHOLD_LATE) {
          const lateMs = Math.abs(timeToTarget);
          const lateSeconds = lateMs / 1000;
          const adjustedTime = videoInfo.targetTime + ahead_time + lateSeconds;

          log(`[Switch #${switchId}] ⚠️ ${lateMs}ms 遅延 → ${adjustedTime.toFixed(2)}s にシーク`);
          next.seekTo(adjustedTime);
          NetworkMonitor.recordLate(platform, lateMs);
        }
      }

      // 4. 旧プレイヤーを背面に移動
      current.wrapper.style.zIndex = "1";

      // 5. 次のプレイヤーを準備（トランジション無効で初期状態にセット）
      next.disableTransition();
      next.wrapper.style.opacity = "0";
      next.wrapper.style.zIndex = "2";

      // 6. 強制リフロー
      void next.wrapper.offsetHeight;

      log(`[Switch #${switchId}] 準備完了:`);
      log(`  current(${current.index}): opacity=${current.wrapper.style.opacity}, z=${current.wrapper.style.zIndex}`);
      log(`  next(${next.index}): opacity=${next.wrapper.style.opacity}, z=${next.wrapper.style.zIndex}`);

      // 7. 再生開始
      next.play();

      // 8. 次フレームで transition を設定
      await nextFrame();
      next.setTransition(isSameVideo);
      next.wrapper.style.transition = `opacity ${transitionDuration}ms ease`;

      // 9. さらに次フレームで opacity を変更
      await nextFrame();
      log(`[Switch #${switchId}] トランジション開始: opacity 0 → 1 (${transitionDuration}ms)`);
      next.wrapper.style.opacity = "1";

      // 10. トランジション完了を待つ
      await sleep(transitionDuration);

      // 11. 旧プレイヤー停止 & 非表示
      current.stop();
      current.disableTransition();
      current.hide();

      // 12. 役割交代
      this.activeIndex = 1 - this.activeIndex;
      this.lastVideoId = videoInfo.videoId;
      this.lastPlatform = platform;

      const totalTime = Date.now() - requestTime;
      log(`[Switch #${switchId}] ✓ 完了 (総時間: ${totalTime}ms)`);

      // 13. Bilibili 自動ループの設定
      // 実際の開始位置と経過時間を考慮
      const actualStartTime = videoInfo.targetTime + ahead_time;
      const elapsedDuringSwitch = (Date.now() - requestTime) / 1000;
      this.setupBilibiliAutoLoop(videoInfo, platform, actualStartTime, elapsedDuringSwitch);

      if (this.switchCount % 5 === 0) {
        NetworkMonitor.printStats(platform);
      }

    } catch (err) {
      error(`[Switch #${switchId}] エラー:`, err);
    } finally {
      this.isTransitioning = false;
    }
  },

  /**
   * Bilibili 自動ループの設定
   * @param {Object} videoInfo - 動画情報
   * @param {string} platform - プラットフォーム
   * @param {number} actualStartTime - 実際の開始位置（aheadTime込み）
   * @param {number} elapsedDuringSwitch - スイッチ処理中に経過した時間（秒）
   */
  setupBilibiliAutoLoop(videoInfo, platform, actualStartTime = null, elapsedDuringSwitch = 0) {
    // 既存のタイマーをクリア
    if (this.bilibiliLoopTimer) {
      clearTimeout(this.bilibiliLoopTimer);
      this.bilibiliLoopTimer = null;
    }

    // Bilibili 以外は何もしない
    if (platform !== "bilibili") {
      return;
    }

    // duration がない場合は何もしない
    const duration = videoInfo.duration;
    if (!duration || duration <= 0) {
      log(`[AutoLoop] duration が不明のため自動ループ無効`);
      return;
    }

    // 実際の開始位置（指定がなければ targetTime を使用）
    const startPosition = actualStartTime !== null ? actualStartTime : (videoInfo.targetTime || 0);

    // 残り再生時間を計算（スイッチ処理中の経過時間を引く）
    const remainingTime = duration - startPosition - elapsedDuringSwitch;

    if (remainingTime <= 0) {
      log(`[AutoLoop] 残り時間が0以下のためスキップ (duration=${duration}, start=${startPosition}, elapsed=${elapsedDuringSwitch})`);
      return;
    }

    // 残り時間（ミリ秒）+ 少し余裕を持たせる
    const loopDelay = (remainingTime + BILIBILI_LOOP_MARGIN) * 1000;

    log(`[AutoLoop] Bilibili 自動ループ設定: ${remainingTime.toFixed(1)}秒後 (duration=${duration}s, startPos=${startPosition.toFixed(1)}s, elapsed=${elapsedDuringSwitch.toFixed(1)}s)`);

    // 次回ループ用にdurationを保存
    this.lastBilibiliDuration = duration;

    this.bilibiliLoopTimer = setTimeout(() => {
      log(`[AutoLoop] Bilibili 動画終了 → 最初から再生`);
      const activePlayer = this.active;
      if (activePlayer && activePlayer.platform === "bilibili") {
        activePlayer.restartBilibili();

        // 再度ループを設定（最初から再生なので duration 分待つ）
        this.setupBilibiliAutoLoop({
          ...videoInfo,
          targetTime: 0,
        }, "bilibili", 0, 0);
      }
    }, loopDelay);
  },

  /**
   * Bilibili 自動ループを停止
   */
  cancelBilibiliAutoLoop() {
    if (this.bilibiliLoopTimer) {
      clearTimeout(this.bilibiliLoopTimer);
      this.bilibiliLoopTimer = null;
      log(`[AutoLoop] Bilibili 自動ループ解除`);
    }
  },

  waitTransitionEnd(element) {
    return new Promise((resolve) => {
      const handler = () => {
        element.removeEventListener("transitionend", handler);
        resolve();
      };
      element.addEventListener("transitionend", handler);
      setTimeout(resolve, TRANSITION_DURATION_NEW_VIDEO + 100);
    });
  },
};

// ========== YouTube IFrame API ==========

const tag = document.createElement("script");
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName("script")[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

function onYouTubeIframeAPIReady() {
  PlayerManager.init().then(() => {
    setupVideoInfoObserver();
  });
}

// ========== MutationObserver ==========

function setupVideoInfoObserver() {
  const elem = document.getElementById("videoInfo");
  if (!elem) {
    error("videoInfo element not found");
    return;
  }

  const observer = new MutationObserver(() => {
    try {
      const videoInfo = JSON.parse(elem.value);
      log("videoInfo changed:", videoInfo);
      PlayerManager.switchTo(videoInfo);
    } catch (e) {
      error("videoInfo parse error:", e);
    }
  });

  observer.observe(elem, {
    attributes: true,
    attributeFilter: ["value"],
    childList: false,
    characterData: false,
  });

  log("videoInfo observer started");
}

// ========== 初期化時のダイアログ ==========

window.onload = function () {
  const os = platform.os.toString().toLowerCase();
  let imageUrl = null;
  if (os.indexOf("windows") !== -1) {
    imageUrl = "../evs/img/announce_windows.png";
  } else if (os.indexOf("os x") !== -1) {
    imageUrl = "../evs/img/announce_osx.png";
  } else {
    imageUrl = "../evs/img/announce_windows.png";
  }
  Swal.fire({
    imageUrl: imageUrl,
    confirmButtonColor: "#6C58A3",
    showCloseButton: true,
    grow: "fullscreen",
    showConfirmButton: false,
  });
};

// ========== デバッグ用グローバルアクセス ==========
window.EVS = {
  NetworkMonitor,
  PlayerManager,
  printStats: (platform) => NetworkMonitor.printStats(platform),
  // 便利メソッド
  youtubeStats: () => NetworkMonitor.printStats("youtube"),
  bilibiliStats: () => NetworkMonitor.printStats("bilibili"),
};
