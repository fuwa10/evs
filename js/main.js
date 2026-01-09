/**
 * EVS - Dual Player Architecture with Adaptive Buffering
 * 通信状況を学習して最適なバッファリングを行う
 */

// ========== トランジション設定 ==========
const TRANSITION_DURATION_NEW_VIDEO = 6000; // 新しい動画への切り替え時(ms)
const TRANSITION_DURATION_SAME_VIDEO = 4000; // 同じ動画内での位置変更時(ms)
const DEFAULT_VIDEO_ID = "Rg6EB9RTHfc";

// ========== NetworkMonitor: 通信状況の監視・学習 ==========
const NetworkMonitor = {
  // ロード時間の履歴（ミリ秒）
  loadTimes: [],
  maxSamples: 15, // 直近15回を保持

  // 遅延発生の履歴
  lateCount: 0,
  totalCount: 0,

  // 設定
  config: {
    minAheadTime: 0.8,    // 最小先読み時間(秒) - 高速回線用
    maxAheadTime: 8.0,    // 最大先読み時間(秒) - 低速回線用
    defaultAheadTime: 1.5, // 初期値
    safetyMargin: 1.2,    // 安全マージン（標準偏差の倍率）
    targetSuccessRate: 0.95, // 目標成功率
  },

  /**
   * ロード時間を記録
   */
  recordLoadTime(loadTimeMs) {
    this.loadTimes.push(loadTimeMs);
    if (this.loadTimes.length > this.maxSamples) {
      this.loadTimes.shift();
    }
    this.totalCount++;
    console.log(`[Network] ロード時間記録: ${loadTimeMs}ms (サンプル数: ${this.loadTimes.length})`);
  },

  /**
   * 遅延発生を記録
   */
  recordLate(lateMs) {
    this.lateCount++;
    console.log(`[Network] 遅延発生: ${lateMs}ms (遅延率: ${(this.lateCount / this.totalCount * 100).toFixed(1)}%)`);
  },

  /**
   * 平均ロード時間を取得
   */
  getAverageLoadTime() {
    if (this.loadTimes.length === 0) {
      return this.config.defaultAheadTime * 1000;
    }
    return this.loadTimes.reduce((a, b) => a + b, 0) / this.loadTimes.length;
  },

  /**
   * ロード時間の標準偏差を取得
   */
  getStdDev() {
    if (this.loadTimes.length < 2) return 0;
    const avg = this.getAverageLoadTime();
    const squareDiffs = this.loadTimes.map(t => Math.pow(t - avg, 2));
    return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / this.loadTimes.length);
  },

  /**
   * 最大ロード時間を取得（外れ値対策で95パーセンタイル）
   */
  getPercentileLoadTime(percentile = 0.95) {
    if (this.loadTimes.length === 0) {
      return this.config.defaultAheadTime * 1000;
    }
    const sorted = [...this.loadTimes].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * percentile);
    return sorted[Math.min(index, sorted.length - 1)];
  },

  /**
   * 推奨される ahead_time を計算（秒）
   * 戦略: 95パーセンタイルのロード時間 + 安全マージン
   */
  getRecommendedAheadTime() {
    const { minAheadTime, maxAheadTime, defaultAheadTime, safetyMargin } = this.config;

    if (this.loadTimes.length < 3) {
      // サンプルが少ない場合はデフォルト値を使用
      return defaultAheadTime;
    }

    // 95パーセンタイルのロード時間を基準に
    const p95LoadTime = this.getPercentileLoadTime(0.95);
    const stdDev = this.getStdDev();

    // 推奨値 = 95パーセンタイル + (標準偏差 × 安全マージン)
    let recommended = (p95LoadTime + stdDev * safetyMargin) / 1000;

    // 遅延が多発している場合は増加
    if (this.totalCount > 5) {
      const lateRate = this.lateCount / this.totalCount;
      if (lateRate > 0.1) {
        // 10%以上遅延している場合、20%増加
        recommended *= 1.2;
        console.log(`[Network] 遅延率 ${(lateRate * 100).toFixed(1)}% のため ahead_time を増加`);
      }
    }

    // 範囲内に収める
    recommended = Math.max(minAheadTime, Math.min(maxAheadTime, recommended));

    return recommended;
  },

  /**
   * 通信品質の評価
   */
  getNetworkQuality() {
    const avg = this.getAverageLoadTime();
    if (avg < 500) return "excellent";
    if (avg < 1000) return "good";
    if (avg < 2000) return "fair";
    if (avg < 4000) return "poor";
    return "bad";
  },

  /**
   * 統計情報を出力
   */
  printStats() {
    if (this.loadTimes.length === 0) {
      console.log("[Network Stats] データなし");
      return;
    }

    const avg = this.getAverageLoadTime();
    const stdDev = this.getStdDev();
    const p95 = this.getPercentileLoadTime(0.95);
    const min = Math.min(...this.loadTimes);
    const max = Math.max(...this.loadTimes);
    const quality = this.getNetworkQuality();
    const recommended = this.getRecommendedAheadTime();
    const successRate = this.totalCount > 0
      ? ((this.totalCount - this.lateCount) / this.totalCount * 100).toFixed(1)
      : 100;

    console.log(`
╔════════════════════════════════════════════╗
║         Network Performance Stats          ║
╠════════════════════════════════════════════╣
║ Quality: ${quality.padEnd(10)} Samples: ${String(this.loadTimes.length).padStart(3)}       ║
╠════════════════════════════════════════════╣
║ Load Time (ms)                             ║
║   Average: ${String(Math.round(avg)).padStart(6)}   StdDev: ${String(Math.round(stdDev)).padStart(6)}     ║
║   Min: ${String(Math.round(min)).padStart(6)}       Max: ${String(Math.round(max)).padStart(6)}        ║
║   95th Percentile: ${String(Math.round(p95)).padStart(6)}                ║
╠════════════════════════════════════════════╣
║ Sync Performance                           ║
║   Success Rate: ${successRate.padStart(5)}%                    ║
║   Late Count: ${String(this.lateCount).padStart(3)} / ${String(this.totalCount).padStart(3)}                   ║
╠════════════════════════════════════════════╣
║ Recommended ahead_time: ${recommended.toFixed(2)}s             ║
╚════════════════════════════════════════════╝
    `);
  },
};

// ========== VideoPlayer クラス ==========
class VideoPlayer {
  constructor(containerId, index) {
    this.index = index;
    this.containerId = containerId;
    this.ytPlayer = null;
    this.wrapper = document.getElementById(`${containerId}-wrapper`);
    this.isReady = false;
    this.pendingResolve = null;
    this.videoInfo = null;
    this.loadStartTime = 0; // ロード開始時刻
  }

  /**
   * YouTube Player を初期化
   */
  init(videoId = null) {
    return new Promise((resolve) => {
      const config = {
        width: "768",
        height: "432",
        events: {
          onReady: (event) => {
            this.isReady = true;
            event.target.mute();
            if (videoId) {
              event.target.playVideo();
            }
            resolve();
          },
          onStateChange: (event) => this.onStateChange(event),
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
   * 動画をロードして待機状態にする（ロード時間を計測）
   */
  loadAndWait(videoId, startTime) {
    this.loadStartTime = Date.now();

    return new Promise((resolve) => {
      this.pendingResolve = resolve;
      try {
        this.ytPlayer.loadVideoById({
          videoId: videoId,
          startSeconds: startTime,
        });
        this.ytPlayer.mute();
      } catch (e) {
        console.warn(`[Player ${this.index}] loadAndWait error:`, e);
        resolve(); // エラー時も続行
      }
    });
  }

  /**
   * プレイヤーの状態変化を処理
   */
  onStateChange(event) {
    // ロード中のプレイヤーが再生可能になったら resolve
    if (event.data === YT.PlayerState.PLAYING && this.pendingResolve) {
      // ロード時間を計測・記録
      const loadTime = Date.now() - this.loadStartTime;
      NetworkMonitor.recordLoadTime(loadTime);

      this.ytPlayer.pauseVideo();
      const resolver = this.pendingResolve;
      this.pendingResolve = null;
      resolver(loadTime);
      return;
    }

    // 動画終了時はリプレイ
    if (event.data === YT.PlayerState.ENDED) {
      this.ytPlayer.playVideo();
    }
  }

  /**
   * 再生開始
   */
  play() {
    try {
      this.ytPlayer.mute();
      this.ytPlayer.playVideo();
    } catch (e) {
      console.warn(`[Player ${this.index}] play error:`, e);
    }
  }

  /**
   * 停止
   */
  stop() {
    try {
      this.ytPlayer.pauseVideo();
      this.ytPlayer.mute();
    } catch (e) {
      console.warn(`[Player ${this.index}] stop error:`, e);
    }
  }

  /**
   * 表示（前面に出す）
   */
  show() {
    this.wrapper.style.opacity = "1";
    this.wrapper.style.zIndex = "2";
  }

  /**
   * 非表示（背面に下げる）
   */
  hide() {
    this.wrapper.style.opacity = "0";
    this.wrapper.style.zIndex = "1";
  }

  /**
   * シーク
   */
  seekTo(seconds) {
    try {
      this.ytPlayer.seekTo(seconds, true);
    } catch (e) {
      console.warn(`[Player ${this.index}] seekTo error:`, e);
    }
  }
}

// ========== PlayerManager ==========
const PlayerManager = {
  players: [],
  activeIndex: 0,
  isTransitioning: false,
  switchCount: 0,
  lastVideoId: null, // 前回の動画ID

  get active() {
    return this.players[this.activeIndex];
  },

  get standby() {
    return this.players[1 - this.activeIndex];
  },

  /**
   * 2つのプレイヤーを初期化
   */
  async init() {
    this.players = [
      new VideoPlayer("player-a", 0),
      new VideoPlayer("player-b", 1),
    ];

    await this.players[0].init(DEFAULT_VIDEO_ID);
    this.players[0].show();

    await this.players[1].init(null);
    this.players[1].hide();

    console.log("PlayerManager initialized with dual players");
  },

  /**
   * 次の動画に切り替え（クロスフェード）
   */
  async switchTo(videoInfo) {
    if (this.isTransitioning) {
      console.log("トランジション中のため、リクエストをスキップします");
      return;
    }

    this.isTransitioning = true;
    this.switchCount++;
    const switchId = this.switchCount;

    const next = this.standby;
    const current = this.active;

    // 適応的に ahead_time を取得
    const ahead_time = NetworkMonitor.getRecommendedAheadTime();

    // 同じ動画かどうかを判定してトランジション時間を決定
    const isSameVideo = this.lastVideoId === videoInfo.videoId;
    const transitionDuration = isSameVideo ? TRANSITION_DURATION_SAME_VIDEO : TRANSITION_DURATION_NEW_VIDEO;

    console.log(`\n[Switch #${switchId}] ========================================`);
    console.log(`[Switch #${switchId}] Active: Player ${current.index} → Standby: Player ${next.index}`);
    console.log(`[Switch #${switchId}] Video: ${videoInfo.videoId} ${isSameVideo ? '(同じ動画)' : '(新しい動画)'}`);
    console.log(`[Switch #${switchId}] targetTime: ${videoInfo.targetTime.toFixed(2)}s`);
    console.log(`[Switch #${switchId}] ahead_time: ${ahead_time.toFixed(2)}s (adaptive)`);
    console.log(`[Switch #${switchId}] トランジション: ${transitionDuration}ms`);

    const requestTime = Date.now();

    try {
      // 1. 裏でロード（先読み時間を加算）
      const loadStartTime = Date.now();
      await next.loadAndWait(videoInfo.videoId, videoInfo.targetTime + ahead_time);
      const actualLoadTime = Date.now() - loadStartTime;

      console.log(`[Switch #${switchId}] ロード完了: ${actualLoadTime}ms`);

      // 2. 同期タイミングを計算
      const syncEnabled = videoInfo.syncEnabled !== false;
      const targetPlayTime = videoInfo.systemUnixTime + ahead_time * 1000;
      const now = Date.now();
      const timeToTarget = targetPlayTime - now;

      console.log(`[Switch #${switchId}] 同期: ${syncEnabled ? 'ON' : 'OFF'}, 残り時間: ${timeToTarget}ms`);

      // 3. 同期処理
      if (syncEnabled) {
        if (timeToTarget > 50) {
          // 余裕がある：待機してから再生
          console.log(`[Switch #${switchId}] ${timeToTarget}ms 待機...`);
          await this.sleep(timeToTarget);
        } else if (timeToTarget < -100) {
          // 遅れている：再生位置を調整
          const lateMs = Math.abs(timeToTarget);
          const lateSeconds = lateMs / 1000;
          const adjustedTime = videoInfo.targetTime + ahead_time + lateSeconds;

          console.log(`[Switch #${switchId}] ⚠️ ${lateMs}ms 遅延 → ${adjustedTime.toFixed(2)}s にシーク`);
          next.seekTo(adjustedTime);
          NetworkMonitor.recordLate(lateMs);
        }
        // -100ms〜50ms は許容範囲
      }

      // 4. 旧プレイヤーを背面に移動（先にやる）
      current.wrapper.style.zIndex = "1";

      // 5. 次のプレイヤーを準備（確実に opacity: 0 から開始）
      next.wrapper.style.transition = "none";
      next.wrapper.style.opacity = "0";
      next.wrapper.style.zIndex = "2";

      // 6. 強制リフロー
      void next.wrapper.offsetHeight;

      // デバッグ: 両プレイヤーの状態を確認
      console.log(`[Switch #${switchId}] 準備完了:`);
      console.log(`  current(${current.index}): opacity=${current.wrapper.style.opacity}, z=${current.wrapper.style.zIndex}`);
      console.log(`  next(${next.index}): opacity=${next.wrapper.style.opacity}, z=${next.wrapper.style.zIndex}`);

      // 7. 再生開始（トランジション前に再生を開始しておく）
      next.play();

      // 8. 次フレームで transition を設定
      await new Promise(resolve => requestAnimationFrame(resolve));
      next.wrapper.style.transition = `opacity ${transitionDuration}ms ease`;

      // 9. さらに次フレームで opacity を変更
      await new Promise(resolve => requestAnimationFrame(resolve));
      console.log(`[Switch #${switchId}] トランジション開始: opacity 0 → 1 (${transitionDuration}ms)`);
      next.wrapper.style.opacity = "1";

      // 10. トランジション完了を待つ
      await this.sleep(transitionDuration);

      // 11. 旧プレイヤー停止 & 非表示（トランジション完了後）
      current.stop();
      current.wrapper.style.transition = "none";
      current.wrapper.style.opacity = "0";
      current.wrapper.style.zIndex = "1";

      // 12. 役割交代 & 動画ID記録
      this.activeIndex = 1 - this.activeIndex;
      this.lastVideoId = videoInfo.videoId;

      const totalTime = Date.now() - requestTime;
      console.log(`[Switch #${switchId}] ✓ 完了 (総時間: ${totalTime}ms)`);

      // 5回ごとに統計を出力
      if (this.switchCount % 5 === 0) {
        NetworkMonitor.printStats();
      }

    } catch (error) {
      console.error(`[Switch #${switchId}] エラー:`, error);
    } finally {
      this.isTransitioning = false;
    }
  },

  /**
   * 指定ミリ秒待機
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * トランジション完了を待つ
   */
  waitTransitionEnd(element) {
    return new Promise((resolve) => {
      const handler = () => {
        element.removeEventListener("transitionend", handler);
        resolve();
      };
      element.addEventListener("transitionend", handler);
      setTimeout(resolve, TRANSITION_DURATION + 100);
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
    console.error("videoInfo element not found");
    return;
  }

  const observer = new MutationObserver(() => {
    const videoInfo = JSON.parse(elem.value);
    console.log("videoInfo changed:", videoInfo);
    PlayerManager.switchTo(videoInfo);
  });

  observer.observe(elem, {
    attributes: true,
    attributeFilter: ["value"],
    childList: false,
    characterData: false,
  });

  console.log("videoInfo observer started");
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
  printStats: () => NetworkMonitor.printStats(),
};
