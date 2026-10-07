/* 앱 셸(정적 파일)만 캐시한다. 시세 데이터(klines)는 항상 최신을 받아야 하므로
   Binance API 요청은 캐시하지 않는다. */
const CACHE_NAME = "signal-watch-v36";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./style.css",
  "./config.js",
  "./i18n.js",
  "./heikinAshi.js",
  "./macd.js",
  "./rsi.js",
  "./signals.js",
  "./signalLog.js",
  "./tradeLog.js",
  "./lossAnalysis.js",
  "./lockRange.js",
  "./patternSnapshot.js",
  "./patternLearn.js",
  "./patternAnalysis.js",
  "./patternSimilarity.js",
  "./confidenceAdjust.js",
  "./signalPerformance.js",
  "./confBlockLog.js",
  "./volumeProfile.js",
  "./wyckoff.js",
  "./alertDetail.js",
  "./backgroundMonitor.js",
  "./binanceApi.js",
  "./state.js",
  "./charts.js",
  "./ui.js",
  "./app.js",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Binance API(시세 데이터)는 절대 캐시하지 않고 네트워크로만 요청한다.
  if (url.hostname.includes("binance.com")) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
