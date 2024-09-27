var delay_tuned = true;
videoInfo = null;
receive_event_unixtime = 0;
var ahead_time = 1.3; //先読み(s)

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
    if (testWait >= 0) {
      setTimeout(() => {
        player.playVideo();
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
  waitTime = dt * 1.5;
  shiftMilisecond = dt + waitTime;
  player.seekTo(shiftMilisecond / 1000 + ahead_time + videoInfo.targetTime);
  player.pauseVideo();
  setTimeout(() => {
    player.playVideo()
  }, waitTime)
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


  // アニメーションが完了したらクラスを削除してリセット
  setTimeout(function () {
    overlay.style.opacity = 0;
    box.classList.remove("active");
    overlay.classList.remove("active");
  }, 3000); // アニメーションの時間に合わせて
}