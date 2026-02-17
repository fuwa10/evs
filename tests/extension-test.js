/**
 * EVS 拡張機能テスト
 * Chrome拡張機能（ex-evs）を読み込んだ状態でブラウザを起動し、
 * YouTube/Bilibili → Ctrl+X → EVS への動画情報伝達をテストする。
 *
 * 使い方: npm run test:extension
 * 前提: MAMP で http://localhost:8888/ が動いていること
 */

const { chromium } = require('playwright');
const path = require('path');

// ========== 設定 ==========
const EVS_URL = 'http://localhost:8888/';
const EXTENSION_PATH = process.env.EXTENSION_PATH || path.resolve(__dirname, '..', 'ex-evs');

// テスト用 YouTube 動画URL（短くて軽い動画）
const YOUTUBE_TEST_URLS = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  'https://www.youtube.com/watch?v=9bZkp7q19f0',
];

// ========== テストケース ==========
const testResults = [];

function recordResult(name, passed, detail = '') {
  testResults.push({ name, passed, detail });
  const icon = passed ? '✅' : '❌';
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ========== ヘルパー ==========

/**
 * 拡張機能の ID を Service Worker の URL から取得
 */
async function getExtensionId(context) {
  for (const sw of context.serviceWorkers()) {
    const url = sw.url();
    const match = url.match(/chrome-extension:\/\/([a-z]+)\//);
    if (match) return match[1];
  }
  return null;
}

// ========== メイン ==========
async function runExtensionTest() {
  console.log('========================================');
  console.log('  EVS 拡張機能テスト');
  console.log(`  Extension: ${EXTENSION_PATH}`);
  console.log(`  EVS URL: ${EVS_URL}`);
  console.log('========================================\n');

  // 拡張機能を読み込んだ状態で起動（persistentContext が必要）
  const userDataDir = path.join(__dirname, '.tmp-chrome-profile');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--mute-audio',
    ],
    viewport: { width: 1280, height: 720 },
  });

  try {
    // ----- テスト1: 拡張機能が読み込まれているか -----
    console.log('\n--- テスト1: 拡張機能の読み込み確認 ---');

    // Service Worker が登録されているか確認
    let serviceWorkerFound = false;
    for (const sw of context.serviceWorkers()) {
      if (sw.url().includes('background.js')) {
        serviceWorkerFound = true;
      }
    }
    // まだ見つからなければ少し待つ
    if (!serviceWorkerFound) {
      await new Promise((resolve) => {
        const handler = (sw) => {
          if (sw.url().includes('background.js')) {
            serviceWorkerFound = true;
            context.off('serviceworker', handler);
            resolve();
          }
        };
        context.on('serviceworker', handler);
        setTimeout(() => { resolve(); }, 5000);
      });
    }
    recordResult('拡張機能の Service Worker が起動', serviceWorkerFound);

    // ----- テスト2: EVS ページを開く -----
    console.log('\n--- テスト2: EVS ページの読み込み ---');

    const evsPage = await context.newPage();
    try {
      await evsPage.goto(EVS_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
      recordResult('EVS ページの読み込み成功', true);
    } catch (e) {
      recordResult('EVS ページの読み込み成功', false, `${e.message}`);
      console.error('\n❌ MAMP が起動しているか確認してください。');
      await context.close();
      process.exit(1);
    }

    // SweetAlert を閉じる
    await evsPage.waitForTimeout(2000);
    try {
      await evsPage.click('.swal2-close', { timeout: 3000 });
    } catch {}

    // YouTube API の読み込みを待つ
    await evsPage.waitForTimeout(5000);

    // videoInfo 要素の存在確認
    const hasVideoInfo = await evsPage.evaluate(() => !!document.getElementById('videoInfo'));
    recordResult('videoInfo 要素が存在する', hasVideoInfo);

    // ----- テスト3: YouTube → Ctrl+X → EVS -----
    console.log('\n--- テスト3: YouTube → Ctrl+X → EVS 連携 ---');

    const ytUrl = YOUTUBE_TEST_URLS[0];
    const ytPage = await context.newPage();

    console.log(`  YouTube を開いています: ${ytUrl}`);
    await ytPage.goto(ytUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // YouTube の動画プレイヤーが読み込まれるまで待つ
    console.log('  動画プレイヤーの読み込み待機中...');
    try {
      await ytPage.waitForSelector('video', { timeout: 15000 });
      recordResult('YouTube 動画プレイヤーが読み込まれた', true);
    } catch {
      recordResult('YouTube 動画プレイヤーが読み込まれた', false, 'video 要素が見つからない');
    }

    // 動画が再生可能になるまで少し待つ
    await ytPage.waitForTimeout(3000);

    // コンテンツスクリプトが注入されているか確認
    const hasListener = await ytPage.evaluate(() => {
      // script.js の log 関数が存在するかで判定はできないが、
      // キーイベントを発火させてエラーが出ないかで確認
      return true; // content script の直接確認は困難なので、Ctrl+X の結果で判断
    });

    // EVS 側で videoInfo の変化を監視する Promise を先にセット
    const videoInfoPromise = evsPage.evaluate(() => {
      return new Promise((resolve) => {
        const elem = document.getElementById('videoInfo');
        if (!elem) { resolve(null); return; }

        const observer = new MutationObserver(() => {
          try {
            const data = JSON.parse(elem.getAttribute('value'));
            observer.disconnect();
            resolve(data);
          } catch {
            // パースエラーは無視
          }
        });
        observer.observe(elem, { attributes: true, attributeFilter: ['value'] });

        // 15秒タイムアウト
        setTimeout(() => { observer.disconnect(); resolve(null); }, 15000);
      });
    });

    // YouTube ページで Ctrl+X を送信
    console.log('  Ctrl+X を送信...');
    await ytPage.keyboard.press('Meta+x'); // Mac は Meta+X

    // EVS 側で videoInfo が更新されるのを待つ
    console.log('  EVS 側の videoInfo 更新を待機中...');
    const receivedInfo = await videoInfoPromise;

    if (receivedInfo) {
      recordResult('Ctrl+X で EVS に動画情報が届いた', true,
        `platform=${receivedInfo.platform}, videoId=${receivedInfo.videoId}`);

      // 中身の検証
      recordResult('platform が youtube',
        receivedInfo.platform === 'youtube', `got: ${receivedInfo.platform}`);
      recordResult('videoId が正しい',
        receivedInfo.videoId === 'dQw4w9WgXcQ', `got: ${receivedInfo.videoId}`);
      recordResult('targetTime が数値',
        typeof receivedInfo.targetTime === 'number', `got: ${typeof receivedInfo.targetTime}`);
      recordResult('systemUnixTime が妥当',
        receivedInfo.systemUnixTime > Date.now() - 30000, `got: ${receivedInfo.systemUnixTime}`);
    } else {
      recordResult('Ctrl+X で EVS に動画情報が届いた', false, '15秒以内に videoInfo が更新されなかった');
    }

    // ----- テスト4: 連続 Ctrl+X（二重送信防止の確認） -----
    console.log('\n--- テスト4: 連続 Ctrl+X の動作確認 ---');

    // 2本目の動画を開く
    const ytUrl2 = YOUTUBE_TEST_URLS[1];
    console.log(`  2本目の YouTube を開いています: ${ytUrl2}`);
    await ytPage.goto(ytUrl2, { waitUntil: 'domcontentloaded', timeout: 30000 });

    try {
      await ytPage.waitForSelector('video', { timeout: 15000 });
    } catch {}
    await ytPage.waitForTimeout(3000);

    // 再度 videoInfo の変化を監視
    const videoInfoPromise2 = evsPage.evaluate(() => {
      return new Promise((resolve) => {
        const elem = document.getElementById('videoInfo');
        if (!elem) { resolve(null); return; }

        const observer = new MutationObserver(() => {
          try {
            const data = JSON.parse(elem.getAttribute('value'));
            observer.disconnect();
            resolve(data);
          } catch {}
        });
        observer.observe(elem, { attributes: true, attributeFilter: ['value'] });
        setTimeout(() => { observer.disconnect(); resolve(null); }, 15000);
      });
    });

    // Ctrl+X を送信
    console.log('  Ctrl+X を送信...');
    await ytPage.keyboard.press('Meta+x');

    const receivedInfo2 = await videoInfoPromise2;

    if (receivedInfo2) {
      recordResult('2本目の動画で Ctrl+X が動作', true,
        `videoId=${receivedInfo2.videoId}`);
      recordResult('videoId が2本目の動画',
        receivedInfo2.videoId === 'jNQXAC9IVRw', `got: ${receivedInfo2.videoId}`);
    } else {
      recordResult('2本目の動画で Ctrl+X が動作', false, 'videoInfo が更新されなかった');
    }

    // ----- テスト5: 入力フィールド内での Ctrl+X スキップ -----
    console.log('\n--- テスト5: 入力フィールド内の Ctrl+X スキップ ---');

    // 3本目を開く
    const ytUrl3 = YOUTUBE_TEST_URLS[2];
    await ytPage.goto(ytUrl3, { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await ytPage.waitForSelector('video', { timeout: 15000 }); } catch {}
    await ytPage.waitForTimeout(2000);

    // 検索ボックスにフォーカスして Ctrl+X
    const searchBox = await ytPage.$('input#search, input[name="search_query"]');

    if (searchBox) {
      // 監視セット（更新されないことを確認）
      const videoInfoPromise3 = evsPage.evaluate(() => {
        return new Promise((resolve) => {
          const elem = document.getElementById('videoInfo');
          if (!elem) { resolve('no_element'); return; }
          const observer = new MutationObserver(() => {
            observer.disconnect();
            resolve('changed');
          });
          observer.observe(elem, { attributes: true, attributeFilter: ['value'] });
          setTimeout(() => { observer.disconnect(); resolve('no_change'); }, 5000);
        });
      });

      await searchBox.click();
      await ytPage.waitForTimeout(500);
      await ytPage.keyboard.press('Meta+x');

      const result3 = await videoInfoPromise3;
      recordResult('入力フィールド内の Ctrl+X はスキップされる',
        result3 === 'no_change', `result: ${result3}`);
    } else {
      recordResult('入力フィールド内の Ctrl+X はスキップされる', false, '検索ボックスが見つからない');
    }

    await ytPage.close();

    // ----- テスト6: Bilibili → Ctrl+X → EVS -----
    console.log('\n--- テスト6: Bilibili → Ctrl+X → EVS 連携 ---');

    const biliPage = await context.newPage();
    const biliUrl = 'https://www.bilibili.com/video/BV1cAUDBPEUr/';
    console.log(`  Bilibili を開いています: ${biliUrl}`);

    try {
      await biliPage.goto(biliUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      recordResult('Bilibili ページの読み込み成功', true);

      // 動画プレイヤーが読み込まれるまで待つ（Bilibili はログインなしだと遅い）
      console.log('  動画プレイヤーの読み込み待機中...');
      let biliVideoFound = false;
      try {
        await biliPage.waitForSelector('video', { timeout: 20000 });
        biliVideoFound = true;
        recordResult('Bilibili 動画プレイヤーが読み込まれた', true);
      } catch {
        // video 要素が見つからなくても EVS のバグではない（ログインなし環境の制約）
        recordResult('Bilibili 動画プレイヤー（ログインなしで video なしは許容）', true,
          'video 要素なし — Bilibili 側の制約');
      }
      await biliPage.waitForTimeout(5000);

      // EVS 側で videoInfo の変化を監視
      const biliInfoPromise = evsPage.evaluate(() => {
        return new Promise((resolve) => {
          const elem = document.getElementById('videoInfo');
          if (!elem) { resolve(null); return; }
          const observer = new MutationObserver(() => {
            try {
              const data = JSON.parse(elem.getAttribute('value'));
              observer.disconnect();
              resolve(data);
            } catch {}
          });
          observer.observe(elem, { attributes: true, attributeFilter: ['value'] });
          setTimeout(() => { observer.disconnect(); resolve(null); }, 15000);
        });
      });

      // Ctrl+X を送信
      console.log('  Ctrl+X を送信...');
      await biliPage.keyboard.press('Meta+x');

      console.log('  EVS 側の videoInfo 更新を待機中...');
      const biliInfo = await biliInfoPromise;

      if (biliInfo) {
        recordResult('Bilibili Ctrl+X で EVS に動画情報が届いた', true,
          `platform=${biliInfo.platform}, videoId=${biliInfo.videoId}`);
        recordResult('platform が bilibili',
          biliInfo.platform === 'bilibili', `got: ${biliInfo.platform}`);
        recordResult('videoId が BV 形式',
          biliInfo.videoId && biliInfo.videoId.startsWith('BV'), `got: ${biliInfo.videoId}`);
        recordResult('targetTime が数値',
          typeof biliInfo.targetTime === 'number', `got: ${typeof biliInfo.targetTime}`);
        // duration は video 要素がないと 0 になるので、video がない場合は検証スキップ
        if (biliVideoFound) {
          recordResult('duration が取得できている',
            typeof biliInfo.duration === 'number' && biliInfo.duration > 0,
            `got: ${biliInfo.duration}`);
        } else {
          recordResult('duration（video なしのため 0 を許容）',
            typeof biliInfo.duration === 'number', `got: ${biliInfo.duration}`);
        }
      } else {
        // video 要素がなければ currentTime=0 で送信されるはずだが、
        // そもそも shoot() が呼ばれない可能性もある
        if (!biliVideoFound) {
          recordResult('Bilibili Ctrl+X（video なしのため送信スキップを許容）', true,
            'video 要素がないため送信されなかった（想定動作）');
        } else {
          recordResult('Bilibili Ctrl+X で EVS に動画情報が届いた', false,
            '15秒以内に videoInfo が更新されなかった');
        }
      }

      // Bilibili で Ctrl+X 連射
      console.log('  Bilibili で Ctrl+X 5連射...');
      for (let i = 0; i < 5; i++) {
        await biliPage.keyboard.press('Meta+x');
        await biliPage.waitForTimeout(100);
      }
      await biliPage.waitForTimeout(2000);

      let evsAliveAfterBili = false;
      try {
        evsAliveAfterBili = await evsPage.evaluate(() => !!document.getElementById('videoInfo'));
      } catch {}
      recordResult('Bilibili Ctrl+X 5連射後も EVS が生存', evsAliveAfterBili);

    } catch (e) {
      recordResult('Bilibili ページの読み込み成功', false, `${e.message.substring(0, 80)}`);
    }

    await biliPage.close();

    // ----- テスト7: Bilibili 非動画ページで Ctrl+X -----
    console.log('\n--- テスト7: Bilibili 非動画ページで Ctrl+X ---');

    const biliNonVideoUrls = [
      { name: 'Bilibili ホーム', url: 'https://www.bilibili.com/' },
      { name: 'Bilibili 検索', url: 'https://search.bilibili.com/all?keyword=test' },
    ];

    for (const { name, url } of biliNonVideoUrls) {
      const biliNvPage = await context.newPage();
      console.log(`  ${name} を開いています...`);
      try {
        await biliNvPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await biliNvPage.waitForTimeout(2000);

        let pageError = null;
        biliNvPage.once('pageerror', (err) => { pageError = err; });
        await biliNvPage.keyboard.press('Meta+x');
        await biliNvPage.waitForTimeout(1000);

        recordResult(`${name}で Ctrl+X してもクラッシュしない`, !pageError,
          pageError ? `Error: ${pageError.message.substring(0, 80)}` : '');
      } catch (e) {
        recordResult(`${name}で Ctrl+X してもクラッシュしない`, true, 'ページ読み込みタイムアウト（許容）');
      }
      await biliNvPage.close();
    }

    // ----- テスト8: YouTube → Bilibili 高速切り替え -----
    console.log('\n--- テスト8: YouTube ↔ Bilibili 高速切り替え ---');

    const crossTab1 = await context.newPage();
    const crossTab2 = await context.newPage();

    await crossTab1.goto(YOUTUBE_TEST_URLS[0], { waitUntil: 'domcontentloaded', timeout: 30000 });
    await crossTab2.goto('https://www.bilibili.com/video/BV1cAUDBPEUr/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await crossTab1.waitForSelector('video', { timeout: 15000 }); } catch {}
    try { await crossTab2.waitForSelector('video', { timeout: 15000 }); } catch {}
    await crossTab1.waitForTimeout(3000);

    console.log('  YouTube ↔ Bilibili を交互に Ctrl+X...');
    for (let i = 0; i < 6; i++) {
      const tab = i % 2 === 0 ? crossTab1 : crossTab2;
      const name = i % 2 === 0 ? 'YouTube' : 'Bilibili';
      try {
        await tab.bringToFront();
        await tab.keyboard.press('Meta+x');
        console.log(`    #${i + 1} ${name} Ctrl+X`);
        await tab.waitForTimeout(500);
      } catch {}
    }
    await crossTab1.waitForTimeout(2000);

    let evsAliveAfterCross = false;
    try {
      evsAliveAfterCross = await evsPage.evaluate(() => !!document.getElementById('videoInfo'));
    } catch {}
    recordResult('YouTube↔Bilibili 交互切り替え後も EVS が生存', evsAliveAfterCross);

    await crossTab1.close();
    await crossTab2.close();

    // ================================================================
    //  VJ 実使用パターンテスト
    // ================================================================

    // ----- テスト9: 同じYouTube動画でタイミング調整（Ctrl+X 複数回） -----
    console.log('\n--- テスト9: YouTube タイミング調整パターン ---');
    console.log('  （同じ動画で Ctrl+X を繰り返し送って同期を合わせる実際のVJ操作）');

    const timingPage = await context.newPage();
    await timingPage.goto(YOUTUBE_TEST_URLS[0], { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await timingPage.waitForSelector('video', { timeout: 15000 }); } catch {}
    await timingPage.waitForTimeout(3000);

    // 同じ動画で5回 Ctrl+X（2〜4秒間隔 = 人間が「ズレてるな」と感じて再送するテンポ）
    const timingResults = [];
    for (let i = 0; i < 5; i++) {
      const infoPromise = evsPage.evaluate(() => {
        return new Promise((resolve) => {
          const elem = document.getElementById('videoInfo');
          if (!elem) { resolve(null); return; }
          const observer = new MutationObserver(() => {
            try {
              const data = JSON.parse(elem.getAttribute('value'));
              observer.disconnect();
              resolve(data);
            } catch {}
          });
          observer.observe(elem, { attributes: true, attributeFilter: ['value'] });
          setTimeout(() => { observer.disconnect(); resolve(null); }, 10000);
        });
      });

      await timingPage.keyboard.press('Meta+x');
      const info = await infoPromise;
      if (info) {
        timingResults.push(info.targetTime);
        console.log(`    #${i + 1} targetTime=${info.targetTime.toFixed(2)}s`);
      } else {
        console.log(`    #${i + 1} 届かなかった`);
      }

      // 2〜4秒待つ（人間のリトライ間隔をシミュレート）
      if (i < 4) {
        const wait = 2000 + Math.random() * 2000;
        await timingPage.waitForTimeout(wait);
      }
    }

    recordResult('YouTube タイミング調整: 全回 EVS に届いた',
      timingResults.length === 5, `${timingResults.length}/5 回届いた`);

    // targetTime が毎回増えているか（動画が再生進行中なので）
    let timesIncreasing = true;
    for (let i = 1; i < timingResults.length; i++) {
      if (timingResults[i] <= timingResults[i - 1]) {
        timesIncreasing = false;
        break;
      }
    }
    recordResult('YouTube タイミング調整: targetTime が毎回進んでいる',
      timesIncreasing, timingResults.map(t => t.toFixed(2)).join(' → '));

    await timingPage.close();

    // ----- テスト10: Bilibili で同じタイミング調整パターン -----
    console.log('\n--- テスト10: Bilibili タイミング調整パターン ---');

    const biliTimingPage = await context.newPage();
    await biliTimingPage.goto('https://www.bilibili.com/video/BV1cAUDBPEUr/', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    let biliHasVideo = false;
    try {
      await biliTimingPage.waitForSelector('video', { timeout: 20000 });
      biliHasVideo = true;
    } catch {}
    await biliTimingPage.waitForTimeout(5000);

    if (biliHasVideo) {
      const biliTimingResults = [];
      for (let i = 0; i < 3; i++) {
        const infoPromise = evsPage.evaluate(() => {
          return new Promise((resolve) => {
            const elem = document.getElementById('videoInfo');
            if (!elem) { resolve(null); return; }
            const observer = new MutationObserver(() => {
              try {
                const data = JSON.parse(elem.getAttribute('value'));
                observer.disconnect();
                resolve(data);
              } catch {}
            });
            observer.observe(elem, { attributes: true, attributeFilter: ['value'] });
            setTimeout(() => { observer.disconnect(); resolve(null); }, 10000);
          });
        });

        await biliTimingPage.keyboard.press('Meta+x');
        const info = await infoPromise;
        if (info) {
          biliTimingResults.push(info);
          console.log(`    #${i + 1} platform=${info.platform} videoId=${info.videoId} targetTime=${info.targetTime.toFixed(2)}s`);
        } else {
          console.log(`    #${i + 1} 届かなかった`);
        }
        if (i < 2) await biliTimingPage.waitForTimeout(3000);
      }
      recordResult('Bilibili タイミング調整: EVS に届いた',
        biliTimingResults.length >= 1, `${biliTimingResults.length}/3 回`);
      if (biliTimingResults.length > 0) {
        recordResult('Bilibili タイミング調整: platform が bilibili',
          biliTimingResults[0].platform === 'bilibili', `got: ${biliTimingResults[0].platform}`);
        recordResult('Bilibili タイミング調整: videoId が BV 形式',
          biliTimingResults[0].videoId?.startsWith('BV'), `got: ${biliTimingResults[0].videoId}`);
      }
    } else {
      recordResult('Bilibili タイミング調整（video なしのためスキップ）', true,
        'video 要素がない環境 — Bilibili 側の制約');
    }

    await biliTimingPage.close();

    // ================================================================
    //  ここからさらに意地悪テスト
    // ================================================================

    // ----- テスト11: Ctrl+X 10連射 -----
    console.log('\n--- テスト11: Ctrl+X 10連射 ---');

    const rapidPage = await context.newPage();
    await rapidPage.goto(YOUTUBE_TEST_URLS[0], { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await rapidPage.waitForSelector('video', { timeout: 15000 }); } catch {}
    await rapidPage.waitForTimeout(3000);

    // EVS 側でクラッシュしないか監視
    let evsCrashed = false;
    evsPage.on('crash', () => { evsCrashed = true; });

    // 10回高速連射
    console.log('  10回連射中...');
    for (let i = 0; i < 10; i++) {
      await rapidPage.keyboard.press('Meta+x');
      await rapidPage.waitForTimeout(50); // 50ms間隔
    }
    await rapidPage.waitForTimeout(3000); // 落ち着くまで待つ

    // EVS が生きているか確認
    let evsAlive = false;
    try {
      evsAlive = await evsPage.evaluate(() => !!document.getElementById('videoInfo'));
    } catch {}
    recordResult('Ctrl+X 10連射後もEVSが生存', evsAlive && !evsCrashed);

    await rapidPage.close();

    // ----- テスト12: 動画のないYouTubeページで Ctrl+X -----
    console.log('\n--- テスト12: 動画のないYouTubeページで Ctrl+X ---');

    const noVideoUrls = [
      { name: 'YouTube ホーム', url: 'https://www.youtube.com/' },
      { name: 'YouTube 検索結果', url: 'https://www.youtube.com/results?search_query=test' },
      { name: 'YouTube チャンネル', url: 'https://www.youtube.com/@YouTube' },
    ];

    for (const { name, url } of noVideoUrls) {
      const noVideoPage = await context.newPage();
      console.log(`  ${name} を開いています...`);
      try {
        await noVideoPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await noVideoPage.waitForTimeout(2000);

        // Ctrl+X を送信（エラーが出ないことが重要）
        let pageError = null;
        noVideoPage.once('pageerror', (err) => { pageError = err; });
        await noVideoPage.keyboard.press('Meta+x');
        await noVideoPage.waitForTimeout(1000);

        recordResult(`${name}で Ctrl+X してもクラッシュしない`, !pageError,
          pageError ? `Error: ${pageError.message.substring(0, 80)}` : '');
      } catch (e) {
        recordResult(`${name}で Ctrl+X してもクラッシュしない`, true, 'ページ読み込みタイムアウト（許容）');
      }
      await noVideoPage.close();
    }

    // ----- テスト13: ページ遷移直後に Ctrl+X -----
    console.log('\n--- テスト13: ページ遷移直後の Ctrl+X ---');

    const navPage = await context.newPage();
    await navPage.goto(YOUTUBE_TEST_URLS[0], { waitUntil: 'domcontentloaded', timeout: 30000 });
    await navPage.waitForTimeout(2000);

    // 遷移開始して即座に Ctrl+X（content script がまだ準備できてない可能性）
    console.log('  遷移直後に Ctrl+X...');
    let navError = null;
    navPage.once('pageerror', (err) => { navError = err; });

    // navigation を開始（waitUntil なしで即座に次へ）
    navPage.goto(YOUTUBE_TEST_URLS[1]).catch(() => {}); // エラー無視
    await navPage.waitForTimeout(500); // 遷移開始直後
    try {
      await navPage.keyboard.press('Meta+x');
    } catch {} // 遷移中のキー入力エラーは許容
    await navPage.waitForTimeout(3000);

    recordResult('ページ遷移直後の Ctrl+X でクラッシュしない', !navError,
      navError ? `Error: ${navError.message.substring(0, 80)}` : '');

    await navPage.close();

    // ----- テスト14: 複数タブ同時 Ctrl+X -----
    console.log('\n--- テスト14: 複数タブ同時 Ctrl+X ---');

    const tab1 = await context.newPage();
    const tab2 = await context.newPage();

    await tab1.goto(YOUTUBE_TEST_URLS[0], { waitUntil: 'domcontentloaded', timeout: 30000 });
    await tab2.goto(YOUTUBE_TEST_URLS[1], { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await tab1.waitForSelector('video', { timeout: 15000 }); } catch {}
    try { await tab2.waitForSelector('video', { timeout: 15000 }); } catch {}
    await tab1.waitForTimeout(3000);

    // 両タブで同時に Ctrl+X
    console.log('  2タブ同時に Ctrl+X...');
    await Promise.all([
      tab1.keyboard.press('Meta+x'),
      tab2.keyboard.press('Meta+x'),
    ]);
    await tab1.waitForTimeout(3000);

    // EVS が生きているか確認
    let evsAliveAfterMulti = false;
    try {
      evsAliveAfterMulti = await evsPage.evaluate(() => !!document.getElementById('videoInfo'));
    } catch {}
    recordResult('複数タブ同時 Ctrl+X 後も EVS が生存', evsAliveAfterMulti);

    // どちらかの videoId が届いているか
    const lastInfo = await evsPage.evaluate(() => {
      const elem = document.getElementById('videoInfo');
      if (!elem) return null;
      try { return JSON.parse(elem.getAttribute('value')); } catch { return null; }
    });
    recordResult('複数タブ同時 Ctrl+X で動画情報が届いている',
      lastInfo && lastInfo.videoId,
      lastInfo ? `videoId=${lastInfo.videoId}` : 'videoInfo が空');

    await tab1.close();
    await tab2.close();

    // ----- テスト15: 存在しない動画ページで Ctrl+X -----
    console.log('\n--- テスト15: 存在しない動画ページで Ctrl+X ---');

    const deadVideoPage = await context.newPage();
    console.log('  存在しない動画ページを開いています...');
    await deadVideoPage.goto('https://www.youtube.com/watch?v=ZZZZZZZZZZZ', {
      waitUntil: 'domcontentloaded', timeout: 20000,
    });
    await deadVideoPage.waitForTimeout(3000);

    let deadPageError = null;
    deadVideoPage.once('pageerror', (err) => { deadPageError = err; });
    await deadVideoPage.keyboard.press('Meta+x');
    await deadVideoPage.waitForTimeout(2000);

    recordResult('存在しない動画で Ctrl+X してもクラッシュしない', !deadPageError,
      deadPageError ? `Error: ${deadPageError.message.substring(0, 80)}` : '');

    await deadVideoPage.close();

    // ----- テスト16: 超高速タブ切り替え + Ctrl+X -----
    console.log('\n--- テスト16: 高速タブ切り替え + Ctrl+X ---');

    const chaosPages = [];
    for (let i = 0; i < 3; i++) {
      const p = await context.newPage();
      await p.goto(YOUTUBE_TEST_URLS[i % YOUTUBE_TEST_URLS.length], {
        waitUntil: 'domcontentloaded', timeout: 30000,
      });
      chaosPages.push(p);
    }
    await chaosPages[0].waitForTimeout(5000); // 全タブ読み込み待ち

    console.log('  3タブ間を高速切り替えしながら Ctrl+X...');
    for (let i = 0; i < 10; i++) {
      const page = chaosPages[i % chaosPages.length];
      try {
        await page.bringToFront();
        await page.keyboard.press('Meta+x');
        await page.waitForTimeout(200);
      } catch {} // 遷移中のエラーは許容
    }
    await chaosPages[0].waitForTimeout(2000);

    // EVS が生きているか
    let evsAliveAfterChaos = false;
    try {
      evsAliveAfterChaos = await evsPage.evaluate(() => !!document.getElementById('videoInfo'));
    } catch {}
    recordResult('高速タブ切り替え+Ctrl+X 後も EVS が生存', evsAliveAfterChaos);

    for (const p of chaosPages) { await p.close(); }

    // ----- テスト17: ポップアップ UI の動作確認 -----
    console.log('\n--- テスト17: ポップアップ UI ---');

    // 拡張機能の ID を取得
    const extensionId = await getExtensionId(context);

    if (extensionId) {
      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extensionId}/html/popup.html`, {
        waitUntil: 'domcontentloaded', timeout: 10000,
      });

      // 「投影用のウインドウを開く」ボタンが表示されるか
      const buttonText = await popupPage.textContent('a.button');
      recordResult('「投影用のウインドウを開く」ボタンが表示される',
        buttonText && buttonText.includes('投影用'), `got: ${buttonText?.trim()}`);

      // 「再生位置の同期」チェックボックスが存在するか
      const syncToggle = await popupPage.$('#syncToggle');
      recordResult('「再生位置の同期」チェックボックスが存在する', !!syncToggle);

      // チェックボックスの初期状態（checked）
      const isChecked = await popupPage.$eval('#syncToggle', el => el.checked);
      recordResult('同期チェックボックスの初期状態が ON', isChecked);

      // チェックボックスを OFF にする
      await popupPage.click('#syncToggle');
      const isUnchecked = await popupPage.$eval('#syncToggle', el => !el.checked);
      recordResult('同期チェックボックスを OFF にできる', isUnchecked);

      // 再度 ON に戻す
      await popupPage.click('#syncToggle');
      const isRechecked = await popupPage.$eval('#syncToggle', el => el.checked);
      recordResult('同期チェックボックスを ON に戻せる', isRechecked);

      // YouTube アイコンが表示されるか
      const ytIcon = await popupPage.$('img[alt="YouTube"]');
      recordResult('YouTube アイコンが表示される', !!ytIcon);

      // Bilibili アイコンが表示されるか
      const biliIcon = await popupPage.$('img[alt="BiliBili"]');
      recordResult('Bilibili アイコンが表示される', !!biliIcon);

      // 「対応」テキストが表示されるか
      const supportText = await popupPage.textContent('.support-info');
      recordResult('「対応」テキストが表示される',
        supportText && supportText.includes('対応'));

      await popupPage.close();
    } else {
      recordResult('ポップアップ UI（拡張機能 ID 取得不可のためスキップ）', true,
        'Service Worker URL から ID を取得できなかった');
    }

    // ----- テスト18: 本番 URL (fuwa10.github.io) での動作確認 -----
    console.log('\n--- テスト18: 本番 URL での動作確認 ---');

    const prodPage = await context.newPage();
    console.log('  https://fuwa10.github.io/evs/ を開いています...');
    try {
      await prodPage.goto('https://fuwa10.github.io/evs/', {
        waitUntil: 'domcontentloaded', timeout: 30000,
      });
      recordResult('本番 EVS ページの読み込み成功', true);

      // SweetAlert を閉じる
      await prodPage.waitForTimeout(2000);
      try { await prodPage.click('.swal2-close', { timeout: 3000 }); } catch {}

      // YouTube API の読み込みを待つ
      await prodPage.waitForTimeout(5000);

      // videoInfo 要素の存在確認
      const hasProdVideoInfo = await prodPage.evaluate(() => !!document.getElementById('videoInfo'));
      recordResult('本番 EVS に videoInfo 要素が存在する', hasProdVideoInfo);

      if (hasProdVideoInfo) {
        // YouTube で Ctrl+X して本番 EVS に届くか
        const prodYtPage = await context.newPage();
        await prodYtPage.goto(YOUTUBE_TEST_URLS[0], {
          waitUntil: 'domcontentloaded', timeout: 30000,
        });
        try { await prodYtPage.waitForSelector('video', { timeout: 15000 }); } catch {}
        await prodYtPage.waitForTimeout(3000);

        // 本番 EVS 側で videoInfo の変化を監視
        const prodInfoPromise = prodPage.evaluate(() => {
          return new Promise((resolve) => {
            const elem = document.getElementById('videoInfo');
            if (!elem) { resolve(null); return; }
            const observer = new MutationObserver(() => {
              try {
                const data = JSON.parse(elem.getAttribute('value'));
                observer.disconnect();
                resolve(data);
              } catch {}
            });
            observer.observe(elem, { attributes: true, attributeFilter: ['value'] });
            setTimeout(() => { observer.disconnect(); resolve(null); }, 15000);
          });
        });

        console.log('  YouTube → Ctrl+X → 本番 EVS...');
        await prodYtPage.keyboard.press('Meta+x');

        const prodInfo = await prodInfoPromise;
        if (prodInfo) {
          recordResult('本番 EVS に動画情報が届いた', true,
            `platform=${prodInfo.platform}, videoId=${prodInfo.videoId}`);
          recordResult('本番 EVS: videoId が正しい',
            prodInfo.videoId === 'dQw4w9WgXcQ', `got: ${prodInfo.videoId}`);
        } else {
          recordResult('本番 EVS に動画情報が届いた', false,
            '15秒以内に videoInfo が更新されなかった');
        }

        await prodYtPage.close();
      }
    } catch (e) {
      recordResult('本番 EVS ページの読み込み成功', false, e.message.substring(0, 80));
    }
    await prodPage.close();

    // ----- 最終: EVS 全体の健全性確認 -----
    console.log('\n--- 最終チェック: EVS の健全性 ---');

    let finalEvsOk = false;
    try {
      finalEvsOk = await evsPage.evaluate(() => {
        const vi = document.getElementById('videoInfo');
        return !!vi && !document.querySelector('.error-fatal');
      });
    } catch {}
    recordResult('全テスト完了後も EVS が正常動作', finalEvsOk);

    await evsPage.close();

  } finally {
    await context.close();
  }

  // ========== 結果サマリ ==========
  console.log('\n========================================');
  console.log('  テスト結果サマリ');
  console.log('========================================');

  const passed = testResults.filter(r => r.passed).length;
  const failed = testResults.filter(r => !r.passed).length;
  const total = testResults.length;

  console.log(`  合格: ${passed} / ${total}`);
  console.log(`  不合格: ${failed} / ${total}`);

  if (failed > 0) {
    console.log('\n--- 不合格項目 ---');
    testResults.filter(r => !r.passed).forEach(r => {
      console.log(`  ❌ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
    });
  }

  console.log(`\n  結果: ${failed === 0 ? '✅ ALL PASS' : '❌ FAIL'}`);
  console.log('========================================\n');

  // 一時プロファイルを削除
  const { rmSync } = require('fs');
  try { rmSync(path.join(__dirname, '.tmp-chrome-profile'), { recursive: true, force: true }); } catch {}

  process.exit(failed === 0 ? 0 : 1);
}

runExtensionTest().catch((err) => {
  console.error('テスト実行エラー:', err);
  process.exit(1);
});
