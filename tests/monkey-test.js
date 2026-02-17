/**
 * EVS モンキーテスト
 * ブラウザを自動操作して、ランダムな動画IDを次々に投げ込む。
 * コンソールエラー・クラッシュ・ハングを検知して記録する。
 *
 * 使い方: npm run test:monkey
 * 前提: MAMP で http://localhost:8888/ が動いていること
 */

const { chromium } = require('playwright');

// ========== 設定 ==========
const EVS_URL = 'http://localhost:8888/';
const TEST_DURATION_MS = 5 * 60 * 1000; // 5分間テスト
const SWITCH_INTERVAL_MIN = 1000;       // 最短切り替え間隔(ms)
const SWITCH_INTERVAL_MAX = 4000;       // 最長切り替え間隔(ms)
const RAPID_FIRE_CHANCE = 0.15;         // 15% の確率で連射モード（100ms間隔で3-5回）

// ========== テストデータ ==========
const VALID_YOUTUBE_IDS = [
  'dQw4w9WgXcQ', 'jNQXAC9IVRw', '9bZkp7q19f0',
  'kJQP7kiw5Fk', 'RgKAFK5djSk', 'Rg6EB9RTHfc',
  'JGwWNGJdvx8', 'OPf0YbXqDm0', 'LsoLEjrDogU',
];

const VALID_BILIBILI_IDS = [
  'BV1GJ411x7h7', 'BV1xx411c7mD', 'BV1es411D7sW',
  'BV1Gs411E7TG',
];

const INVALID_IDS = [
  '', '!!!', 'null', 'undefined', '<script>alert(1)</script>',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '🎵🎵🎵',
  'DROP TABLE videos', '../../../etc/passwd',
  'BV' + 'x'.repeat(100), // 超長ID
];

const EDGE_CASE_TIMES = [
  0, -1, -999, 0.001, 99999, NaN, Infinity,
  Number.MAX_SAFE_INTEGER, 0.5, 1.5,
];

// ========== ユーティリティ ==========
function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateVideoInfo() {
  const rand = Math.random();

  // 50%: 正常な YouTube
  if (rand < 0.50) {
    return {
      platform: 'youtube',
      videoId: randomFrom(VALID_YOUTUBE_IDS),
      targetTime: Math.random() * 60,
      systemUnixTime: Date.now(),
      syncEnabled: Math.random() > 0.3,
      page: '1',
      duration: randomBetween(60, 600),
    };
  }

  // 15%: 正常な Bilibili
  if (rand < 0.65) {
    return {
      platform: 'bilibili',
      videoId: randomFrom(VALID_BILIBILI_IDS),
      targetTime: Math.random() * 60,
      systemUnixTime: Date.now(),
      syncEnabled: Math.random() > 0.3,
      page: String(randomBetween(1, 3)),
      duration: randomBetween(60, 600),
    };
  }

  // 15%: 不正な動画ID
  if (rand < 0.80) {
    return {
      platform: Math.random() > 0.5 ? 'youtube' : 'bilibili',
      videoId: randomFrom(INVALID_IDS),
      targetTime: Math.random() * 60,
      systemUnixTime: Date.now(),
      syncEnabled: true,
      page: '1',
      duration: 0,
    };
  }

  // 10%: 異常な targetTime
  if (rand < 0.90) {
    return {
      platform: 'youtube',
      videoId: randomFrom(VALID_YOUTUBE_IDS),
      targetTime: randomFrom(EDGE_CASE_TIMES),
      systemUnixTime: Date.now(),
      syncEnabled: true,
      page: '1',
      duration: randomBetween(60, 600),
    };
  }

  // 10%: 完全にランダムなゴミデータ
  return {
    platform: randomFrom(['youtube', 'bilibili', '', 'niconico', null, 123]),
    videoId: Math.random().toString(36).substring(2),
    targetTime: Math.random() * 1000 - 500,
    systemUnixTime: Math.random() > 0.5 ? Date.now() : 0,
    syncEnabled: randomFrom([true, false, null, 'yes', 0]),
    page: randomFrom(['1', '0', '-1', 'abc', '']),
    duration: randomFrom([0, -1, NaN, 9999999]),
  };
}

// ========== メインテスト ==========
async function runMonkeyTest() {
  console.log('========================================');
  console.log('  EVS モンキーテスト開始');
  console.log(`  URL: ${EVS_URL}`);
  console.log(`  テスト時間: ${TEST_DURATION_MS / 1000}秒`);
  console.log('========================================\n');

  const stats = {
    totalSwitches: 0,
    consoleErrors: [],
    pageCrashes: 0,
    uncaughtErrors: [],
    thirdPartyErrors: 0,
    startTime: Date.now(),
  };

  const browser = await chromium.launch({
    headless: false, // ブラウザを表示（VJソフトなので目視確認したい）
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();

  // サードパーティ由来のエラーを無視するフィルタ
  const IGNORE_PATTERNS = [
    'doubleclick.net',
    'googleads',
    'googlesyndication',
    'ERR_FAILED',
    'bili-user-fingerprint',
    'bvc.bilivideo.com',
    'net::ERR_',
  ];
  const isThirdPartyError = (text) => IGNORE_PATTERNS.some(p => text.includes(p));

  // コンソールメッセージを監視
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (isThirdPartyError(text)) {
        // サードパーティのエラーは記録だけ（FAIL判定に含めない）
        stats.thirdPartyErrors++;
        return;
      }
      stats.consoleErrors.push({
        time: new Date().toISOString(),
        text: text.substring(0, 200),
        switch: stats.totalSwitches,
      });
      console.log(`  ❌ console.error (#${stats.totalSwitches}): ${text.substring(0, 100)}`);
    }
  });

  // ページクラッシュを監視
  page.on('crash', () => {
    stats.pageCrashes++;
    console.log(`  💥 ページクラッシュ！ (#${stats.totalSwitches})`);
  });

  // uncaught exception を監視
  page.on('pageerror', (err) => {
    const msg = err.message || String(err);
    if (isThirdPartyError(msg)) {
      stats.thirdPartyErrors++;
      return;
    }
    // Bilibili iframe 内部のエラー（"Request Error", "Object", 1文字のエラー）を除外
    if (/^(Object|U|Request Error)/.test(msg)) {
      stats.thirdPartyErrors++;
      return;
    }
    stats.uncaughtErrors.push({
      time: new Date().toISOString(),
      message: msg.substring(0, 200),
      switch: stats.totalSwitches,
    });
    console.log(`  🔥 未処理例外 (#${stats.totalSwitches}): ${msg.substring(0, 100)}`);
  });

  // ページを開く
  console.log('ページを読み込み中...');
  try {
    await page.goto(EVS_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch (e) {
    console.error(`\n❌ ページの読み込みに失敗しました: ${EVS_URL}`);
    console.error('  MAMP が起動しているか確認してください。');
    await browser.close();
    process.exit(1);
  }

  // SweetAlert が出たら閉じる
  await page.waitForTimeout(2000);
  try {
    await page.click('.swal2-close', { timeout: 3000 });
    console.log('SweetAlert を閉じました');
  } catch {
    // SweetAlert が出ない場合もある
  }

  // YouTube API の読み込みを待つ
  console.log('YouTube API の読み込みを待機中...');
  await page.waitForTimeout(5000);

  console.log('\n--- テスト開始 ---\n');

  const endTime = Date.now() + TEST_DURATION_MS;

  while (Date.now() < endTime) {
    // 連射モード判定
    if (Math.random() < RAPID_FIRE_CHANCE) {
      const burstCount = randomBetween(3, 5);
      console.log(`  ⚡ 連射モード: ${burstCount}回`);
      for (let i = 0; i < burstCount; i++) {
        await injectVideoInfo(page, stats);
        await page.waitForTimeout(100);
      }
    } else {
      await injectVideoInfo(page, stats);
    }

    // ページが生きているか確認
    try {
      await page.evaluate(() => true);
    } catch {
      console.log('  💀 ページが応答しません！リロードします...');
      stats.pageCrashes++;
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(5000);
    }

    // 次の切り替えまで待機
    const wait = randomBetween(SWITCH_INTERVAL_MIN, SWITCH_INTERVAL_MAX);
    await page.waitForTimeout(wait);
  }

  // ========== 結果レポート ==========
  const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);

  console.log('\n========================================');
  console.log('  テスト結果');
  console.log('========================================');
  console.log(`  経過時間:        ${elapsed}秒`);
  console.log(`  切り替え回数:    ${stats.totalSwitches}`);
  console.log(`  EVSエラー:       ${stats.consoleErrors.length}`);
  console.log(`  未処理例外:      ${stats.uncaughtErrors.length}`);
  console.log(`  ページクラッシュ: ${stats.pageCrashes}`);
  console.log(`  外部エラー(無視): ${stats.thirdPartyErrors}`);

  if (stats.consoleErrors.length > 0) {
    console.log('\n--- コンソールエラー一覧 ---');
    // 重複を排除して表示
    const unique = [...new Set(stats.consoleErrors.map(e => e.text))];
    unique.forEach((text, i) => {
      const count = stats.consoleErrors.filter(e => e.text === text).length;
      console.log(`  [${i + 1}] (${count}回) ${text.substring(0, 150)}`);
    });
  }

  if (stats.uncaughtErrors.length > 0) {
    console.log('\n--- 未処理例外一覧 ---');
    const unique = [...new Set(stats.uncaughtErrors.map(e => e.message))];
    unique.forEach((msg, i) => {
      const count = stats.uncaughtErrors.filter(e => e.message === msg).length;
      console.log(`  [${i + 1}] (${count}回) ${msg.substring(0, 150)}`);
    });
  }

  const passed = stats.pageCrashes === 0 && stats.uncaughtErrors.length === 0;
  console.log(`\n  結果: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log('========================================\n');

  await browser.close();
  process.exit(passed ? 0 : 1);
}

async function injectVideoInfo(page, stats) {
  const videoInfo = generateVideoInfo();
  stats.totalSwitches++;

  const label = `#${stats.totalSwitches} [${videoInfo.platform}] ${String(videoInfo.videoId).substring(0, 15)}`;
  console.log(`  → ${label}`);

  try {
    await page.evaluate((info) => {
      const elem = document.getElementById('videoInfo');
      if (elem) {
        elem.setAttribute('value', JSON.stringify(info));
      }
    }, videoInfo);
  } catch (e) {
    console.log(`  ⚠️ 注入失敗: ${e.message.substring(0, 80)}`);
  }
}

// 実行
runMonkeyTest().catch((err) => {
  console.error('テスト実行エラー:', err);
  process.exit(1);
});
