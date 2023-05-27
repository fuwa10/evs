var delay_tuned = true;
videoInfo = null;
receive_event_unixtime = 0;
var ahead_time = 1.2; //先読み(s)

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
    videoId: "M7lc1UVf-VE",
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
    },
    playerVars: {
      rel: 0, // 関連動画の有無(default:1)
      showinfo: 0, // 動画情報表示(default:1)
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

  player.loadVideoById({
    videoId: "BLeUas72Mzk", // 初期表示用のID
    startSeconds: 0,
    // 'endSeconds': -10,
    suggestedQuality: "small",
  });
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

var first_loaded = false; // 検証時はfalse
var receive_event_unixtime = -1;


/**
 * 【VJ側】画面切替
 */
var observer = new MutationObserver(function () {
  changeScene(0, "0.2s");
  delay_tuned = false;
  videoInfo = JSON.parse(document.getElementById("videoInfo").value);
  receive_event_unixtime = videoInfo.systemUnixTime; // 発火時の日時を取得
  player.loadVideoById(
    videoInfo.videoId,
    videoInfo.targetTime + ahead_time
  );
});

/** 監視対象の要素オブジェクト */
const elem = document.getElementById("videoInfo");

/** 監視時のオプション */
const config2 = {
  attributes: true,
  childList: true,
  characterData: true,
};

/** 要素の変化監視をスタート */
observer.observe(elem, config2);

/**
 * 遅延処理 & トランジション処理
 * Videoステータスが再読み込み→再生になった時に動作
 */
function calDelayAndFixView() {
  if (!delay_tuned) {
    player.pauseVideo();
    testWait = receive_event_unixtime + ahead_time * 1000 - now_milsecond();
    if (testWait >= 0) {
      setTimeout(() => {
        player.playVideo()
        changeScene(1, "2s")
      }, testWait)
    } else { 
      console.log("先読みの再生時間を過ぎました");
      console.log(-1 * testWait);
      buffer(-1 * testWait);
    }

  }
  delay_tuned = true;

  // // 遅延処理
  // if (!delay_tuned) {
  //   dt = now_milsecond() - receive_event_unixtime; // 遅延時間
  //   console.log("再生時間からLoadまでに要した時間 : " + dt);
  //   buffer(dt);
  // }
  // delay_tuned = true;

}

/**
 * 現在のシステム時刻を取得
 * @returns 
 */
function now_milsecond() {
  var date = new Date();
  // UNIXタイムスタンプを取得する (ミリ秒単位)
  return date.getTime();
}


/**
 * 明転・暗転制御
 *
 * @param {*} opacity 透明度 0:暗転 1:明転
 * @param {*} duration 切り替え時間(s)
 */
function changeScene(opacity, duration) {
  $(".box").css({
    "transition-duration": duration,
    "transition-timing-function": "liner",
    opacity: opacity,
    "z-index": 1,
  });

}

window.onload = function () {
  var os = platform.os.toString().toLowerCase();
  console.log(os);
  text = null;
  if (os.indexOf("windows") !== -1) {
    text = "YouTubeのシークバーの上で Ctrlキー + X";
  } else if (os.indexOf("os x") !== -1) {
    text = "YouTubeのシークバーの上で controlキー(⌃) + X";
  } else {
    text = "お使いのOSには対応していません";
  }
  // ページ読み込み時に実行したい処理
  Swal.fire({
    imageUrl: 'https://github.com/fuwa10/evs/blob/main/img/announce.png?raw=true',
    imageHeight: 130,
    imageAlt: 'HowToUse',
    text: text,
  });
};

// 追加開発用
/**
 * 1000ms超えた場合は、シークに時間を様要すため4000ms後にロードしてタイマーで発火させる
 */
function buffer(dt) {
  waitTime = dt * 1.5;
  shiftMilisecond = dt + waitTime;
  player.seekTo(shiftMilisecond / 1000 + ahead_time + videoInfo.targetTime);
  player.pauseVideo();
  setTimeout(() => {
    player.playVideo()
    changeScene(1, "2s")
  }, waitTime)
  
}