/* 기존 웹앱 파일을 android-app/www/ 로 그대로 복사한다.
 * 신호 계산/LOCK/기록/자가학습 등 로직 파일은 절대 수정하지 않고 원본을 그대로 복사만 한다.
 * 상위 폴더(pwa-flat)의 웹앱 파일을 고쳤다면, 배포 전 `npm run copy-web`(또는 `npm run sync`)로
 * 다시 실행해서 www/를 최신 상태로 맞추면 된다.
 */
const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..");
const DEST_DIR = path.join(__dirname, "www");

// 기존 웹앱을 이루는 파일만 명시적으로 나열 (테스트 파일, .nojekyll, .gitignore 등은 앱에 불필요하므로 제외)
const FILES = [
  "index.html",
  "style.css",
  "manifest.webmanifest",
  "sw.js",
  "config.js",
  "i18n.js",
  "heikinAshi.js",
  "macd.js",
  "rsi.js",
  "signals.js",
  "signalLog.js",
  "tradeLog.js",
  "lossAnalysis.js",
  "lockRange.js",
  "patternSnapshot.js",
  "patternLearn.js",
  "patternAnalysis.js",
  "patternSimilarity.js",
  "confidenceAdjust.js",
  "signalPerformance.js",
  "confBlockLog.js",
  "volumeProfile.js",
  "wyckoff.js",
  "alertDetail.js",
  "backgroundMonitor.js",
  "binanceApi.js",
  "state.js",
  "charts.js",
  "ui.js",
  "app.js",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
];

fs.mkdirSync(DEST_DIR, { recursive: true });

let copied = 0;
FILES.forEach((name) => {
  const src = path.join(SRC_DIR, name);
  const dest = path.join(DEST_DIR, name);
  if (!fs.existsSync(src)) {
    console.warn("건너뜀(원본 없음):", name);
    return;
  }
  fs.copyFileSync(src, dest);
  copied++;
});

console.log(`${copied}/${FILES.length}개 파일을 www/로 복사했습니다.`);
