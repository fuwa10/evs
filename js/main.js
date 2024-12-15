var delay_tuned = true;
videoInfo = null;
receive_event_unixtime = 0;
let ahead_time = 1.3; //先読み(s)
let bufferCallCount = 0;  // buffer関数の呼び出し回数をカウント
let prePlayWaitTime = 0;　// 先読み再生タイミングまでの待ち時間を格納する変数

// 2. This code loads the IFrame Player API code asynchronously.
var tag = document.createElement("script");

tag.src = "https://www.youtube.com/iframe_api";
var firstScriptTag = document.getElementsByTagName("script")[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

// 3. This function creates an <iframe> (and YouTube player)
//    after the API code downloads.
var player;
function onYouTubeIframeAPIReady() {
  player = new YT.Player("player", {
    width: "768",
    height: "432",
    videoId: "Rg6EB9RTHfc",
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
    },
    playerVars: {
      rel: 0, // 関連動画の有無(default:1)
      controls: 0, // コントロール有無(default:1)
      cc_load_policy: 0, // 字幕有無(1:ON、defaultはユーザー設定)
      iv_load_policy: 3, // アノテーション有無(default:1, 3で無効)
    },
  });
}

// 4. The API will call this function when the video player is ready.
function onPlayerReady(event) {
  event.target.mute();
  event.target.playVideo();
}

var done = false;
function onPlayerStateChange(event) {
  if (event.data == YT.PlayerState.ENDED) {
    player.playVideo();
  }
  if (event.data == YT.PlayerState.PLAYING) {
    calDelayAndFixView();
  }
}

/**
 * 【VJ側】画面切替
 */
var observer = new MutationObserver(function () {

  delay_tuned = false;
  videoInfo = JSON.parse(document.getElementById("videoInfo").value);

  receive_event_unixtime = videoInfo.systemUnixTime; // 発火時の日時を取得

  // 新しい動画指定が来た時にカウントをリセット
  resetBufferCallCount();

  player.loadVideoById(
    videoInfo.videoId,
    videoInfo.targetTime + ahead_time
  );
  triggerTransition();
});

/** 監視対象の要素オブジェクト */
const elem = document.getElementById("videoInfo");

/** 監視時のオプション */
const config2 = {
  attributes: true,
  attributeFilter: ['value'], // 特定の属性のみを監視
  childList: false,
  characterData: false
};

/** 要素の変化監視をスタート */
observer.observe(elem, config2);

/**
 * 先読み時刻到達時に再生
 */
function calDelayAndFixView() {
  if (!delay_tuned) {
    player.pauseVideo();
    testWait = receive_event_unixtime + ahead_time * 1000 - nowMilsecond(); // 送信日時 + 先読み時間 - 現在時刻
    prePlayWaitTime = testWait;
    console.log(`先読み再生タイミングまでの待ち時間 prePlayWaitTime: ${prePlayWaitTime}`);
    if (testWait >= 0) {
      setTimeout(() => {
        player.playVideo();
        resetAnimationOnPlay(); // 動画が再生状態になったときにアニメーションをリセット
      }, testWait)
    } else {
      console.log("先読みの再生時間を過ぎました");
      buffer(-1 * testWait); // 遅延秒(s)を再バッファ関数に送信
    }
  }
  delay_tuned = true;
}

/**
 * 再バッファ処理
 */
function buffer(dt) {
  bufferCallCount++;  // buffer関数が呼ばれた回数をカウント
  console.log("Buffer function called:", bufferCallCount, "times");
  waitTime = dt * 1.5;
  shiftMilisecond = dt + waitTime;
  player.seekTo(shiftMilisecond / 1000 + ahead_time + videoInfo.targetTime);
  player.pauseVideo();
  setTimeout(() => {
    player.playVideo();
    resetAnimationOnPlay(); // 動画が再生状態になったときにアニメーションをリセット
  }, waitTime)
}

/**
 * 新しい動画指定が来た時にカウントをリセット
 */
function resetBufferCallCount() {
  // bufferCallCountが1以上だった場合、ahead_timeを調整
  if (bufferCallCount >= 1) {
    // 動的に倍率を計算してahead_timeを調整
    const multiplier = calculateMultiplier(ahead_time);
    ahead_time = ahead_time * multiplier;  // 計算された倍率でahead_timeを調整
    console.log(`先読み秒数を増加させました。新しい ahead_time: ${ahead_time}, 倍率: ${multiplier}`);
  }

  if (bufferCallCount === 0 && ahead_time > 1.3 && prePlayWaitTime > 1200) {
    let multiplier = adjustAheadTimeMultiplier(ahead_time);
    ahead_time = ahead_time - multiplier;
    console.log(`先読み秒数を減少させました。新しい ahead_time: ${ahead_time}, 減少秒数: ${multiplier}`);
  }

  bufferCallCount = 0;
  console.log("Buffer call count has been reset.");
}


/**
 * 現在のシステム時刻を取得
 * @returns 
 */
function nowMilsecond() {
  var date = new Date();
  return date.getTime();
}

window.onload = function () {
  var os = platform.os.toString().toLowerCase();
  console.log(os);
  imageUrl = null;
  if (os.indexOf("windows") !== -1) {
    imageUrl = '../evs/img/announce_windows.png';
  } else if (os.indexOf("os x") !== -1) {
    imageUrl = '../evs/img/announce_osx.png';
  } else {
    imageUrl = '../evs/img/announce_windows.png';
  }
  // ページ読み込み時に実行したい処理
  Swal.fire({
    imageUrl: imageUrl,
    confirmButtonColor: "#6C58A3",
    showCloseButton: true,
    grow: "fullscreen",
    showConfirmButton: false,
  });
};


function triggerTransition() {
  const box = document.querySelector(".box");
  const overlay = document.querySelector(".overlay");

  // activeクラスを追加してアニメーションを開始する
  setTimeout(() => {
    box.classList.add('active');
    overlay.classList.add('active');
  }, 100);  // 少し遅延させてからアニメーションを開始

}


/**
 * 動画がスタートした時に削除する
 */
function resetAnimationOnPlay() {
  const box = document.querySelector(".box");
  const overlay = document.querySelector(".overlay");

  // 新しく追加したブラー効果をセット
  box.classList.remove("active");  // ボックスのアニメーションをリセット
  overlay.classList.remove("active");  // オーバーレイのアニメーションをリセット
  box.classList.add("blurToZero"); // ブラーをゼロにするアニメーションをセット

  // 動画がスタートした時点でアニメーションをリセット
  setTimeout(() => {
    overlay.style.opacity = 0;  // アニメーションを終了させるために opacity をリセット
    box.classList.remove("blurToZero"); // ブラーをゼロにするアニメーションをリセット
  }, 1000);  // 少し遅延させてからアニメーションを開始
}

// 動的に倍率を計算する関数
function calculateMultiplier(ahead_time) {
  // ahead_time が 1.3〜5 の範囲で倍率を 1.5〜1.35 に変化させる
  const minMultiplier = 1.35;  // 最小倍率
  const maxMultiplier = 1.7;  // 最大倍率

  // `ahead_time` が 1.3 のときは最大倍率 (1.7)
  // `ahead_time` が 5 のときは最小倍率 (1.1)
  let multiplier = maxMultiplier - ((ahead_time - 1.3) / (5 - 1.3)) * (maxMultiplier - minMultiplier);

  // 値が範囲外に出ないように調整
  multiplier = Math.min(Math.max(multiplier, minMultiplier), maxMultiplier);

  console.log("Calculated multiplier:", multiplier);
  return multiplier;
}

// 動的にahead_timeを減少させる関数
function adjustAheadTimeMultiplier(ahead_time) {
  // `ahead_time` が 1.3 のとき最大倍率 (0.1)、5 のとき最小倍率 (0.3)
  let multiplier = 0.1 + (ahead_time - 1.3) * (1 - 0.1) / (5 - 1.3);
  return Math.max(0.1, Math.min(1, multiplier)); // 0.1 〜 0.3 の範囲内に制限
}
