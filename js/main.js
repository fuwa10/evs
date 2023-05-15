var delay_tuned = true;
var ahead_time = 200; //先読み(ms)

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
    width: "720",
    height: "480",
    videoId: "M7lc1UVf-VE",
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
    },
    playerVars: {
      rel: 0, // 関連動画の有無(default:1)
      showinfo: 0, // 動画情報表示(default:1)
      controls: 0, // コントロール有無(default:1)
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
  // console.log(delay_tuned);
  // console.log(event.data);
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

  
  changeScene(0, "0.5s");
  delay_tuned = false;
  const videoInfo = JSON.parse(document.getElementById("videoInfo").value);
  receive_event_unixtime = videoInfo.systemUnixTime; // 発火時の日時を取得
  player.loadVideoById(
    videoInfo.videoId,
    ahead_time / 1000 + videoInfo.targetTime
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
  // 遅延処理
  if (!delay_tuned) {
    dt = now_milsecond() - receive_event_unixtime; // 遅延時間
    console.log("再生時間からLoadまでに要した時間 : " + dt);
    player.seekTo((dt) / 1000 + player.getCurrentTime())
    }
    delay_tuned = true;
    setTimeout(changeScene(1, "2s"), 3000);
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
