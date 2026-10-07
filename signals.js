/* =========================================================================
   Signals — 멀티 타임프레임 점수제 신호 판단
   지표 계산(HeikinAshi/MACD/RSI, 각 파일 그대로 재사용)과 "점수 판단" 로직을
   분리해서 나중에 배점이나 기준을 쉽게 바꿀 수 있도록 한다.
   조건별 배점/기준선은 전부 CONFIG.SCORE_* 값을 사용한다.

   전략 구조:
     15m(TF_TREND)     = 큰 추세 확인   → 방향과 일치하면 +30
     5m (TF_DIRECTION) = 방향 확인      → 방향과 일치하면 +25
     1m (TF_ENTRY)     = 진입 타이밍    → Heikin Ashi 전환 +25, MACD 크로스 +20
   1·5·15분봉이 "전부" 일치해야만 신호가 나는 방식이 아니라, 조건이 일부만
   맞아도 점수가 쌓이는 방식이라 신호가 너무 쉽게 사라지지 않는다.
   ========================================================================= */
(function (root) {
  const CONFIG = root.CONFIG;
  const W = CONFIG.SCORE_WEIGHTS;

  // 한 타임프레임의 캔들 데이터로부터 HA/MACD/RSI를 계산한다. (계산 로직 자체는 그대로)
  function computeIndicators(klines) {
    const ha = root.HeikinAshi.compute(klines);
    const closes = klines.map((k) => k.close);
    const macd = root.MACD.compute(closes, CONFIG.MACD_FAST, CONFIG.MACD_SLOW, CONFIG.MACD_SIGNAL);
    const rsi = root.RSI.compute(closes, CONFIG.RSI_PERIOD);
    return { klines, ha, macd, rsi };
  }

  function detectCross(macd, i) {
    const difLast = macd.dif[i], deaLast = macd.dea[i];
    const difPrev = macd.dif[i - 1], deaPrev = macd.dea[i - 1];
    if (difPrev == null || deaPrev == null || difLast == null || deaLast == null) {
      return { golden: false, dead: false };
    }
    return {
      golden: difPrev <= deaPrev && difLast > deaLast,
      dead: difPrev >= deaPrev && difLast < deaLast,
    };
  }

  function bandOf(score) {
    if (score >= CONFIG.SCORE_BAND_STRONG) return "strong";
    if (score >= CONFIG.SCORE_BAND_WATCH) return "watch";
    if (score >= CONFIG.SCORE_BAND_NEUTRAL) return "neutral";
    return "none";
  }

  // direction: 'long' | 'short'
  function scoreDirection(direction, tf) {
    const last15 = tf["15m"].ha.length - 1;
    const last5 = tf["5m"].ha.length - 1;
    const last1 = tf["1m"].ha.length - 1;

    const ha15Bullish = tf["15m"].ha[last15].bullish;
    const ha5Bullish = tf["5m"].ha[last5].bullish;
    const ha1 = tf["1m"].ha[last1];
    const ha1Prev = tf["1m"].ha[last1 - 1];

    const wantBullish = direction === "long";

    const trend15 = ha15Bullish === wantBullish;
    const trend5 = ha5Bullish === wantBullish;

    // 1분봉 Heikin Ashi가 "이번 캔들에서" 원하는 방향으로 막 전환됐는지 (진입 타이밍)
    const ha1Flip = !!(ha1 && ha1Prev && ha1.bullish === wantBullish && ha1Prev.bullish !== wantBullish);

    const cross1 = detectCross(tf["1m"].macd, last1);
    const macdCross = direction === "long" ? cross1.golden : cross1.dead;

    const conditions = { trend15, trend5, ha1Flip, macdCross };
    const score =
      (trend15 ? W.trend15 : 0) +
      (trend5 ? W.trend5 : 0) +
      (ha1Flip ? W.ha1Flip : 0) +
      (macdCross ? W.macdCross : 0);

    return { direction, score, band: bandOf(score), conditions };
  }

  // tf = { "15m": {klines,ha,macd,rsi}, "5m": {...}, "1m": {...} }
  function evaluate(prevState, symbol, tf) {
    const long = scoreDirection("long", tf);
    const short = scoreDirection("short", tf);
    const leading = long.score >= short.score ? long : short;
    const status = leading.score >= CONFIG.SCORE_BAND_NEUTRAL ? leading.band : "none";
    const leadingDirection = status === "none" ? null : leading.direction;

    const last1Open = tf["1m"].klines[tf["1m"].klines.length - 1].openTime;
    const prevKey = prevState ? prevState.lastSignalKey : null;
    const bandRank = { none: 0, neutral: 1, watch: 2, strong: 3 };
    const isSignalGrade = bandRank[status] >= bandRank[CONFIG.NOTIFY_MIN_BAND];
    const signalKey = isSignalGrade ? `${leadingDirection}:${last1Open}` : null;
    const isNewSignal = !!signalKey && signalKey !== prevKey;

    return {
      symbol,
      updatedAt: Date.now(),
      price: tf["1m"].klines[tf["1m"].klines.length - 1].close,
      tf,
      long,
      short,
      leadingDirection,
      status, // 'strong' | 'watch' | 'neutral' | 'none'
      isNewSignal,
      lastSignalKey: signalKey || prevKey || null,
      entryTimes: {
        "1m": tf["1m"].klines[tf["1m"].klines.length - 1].openTime,
        "5m": tf["5m"].klines[tf["5m"].klines.length - 1].openTime,
        "15m": tf["15m"].klines[tf["15m"].klines.length - 1].openTime,
      },
    };
  }

  root.Signals = { computeIndicators, evaluate, detectCross, scoreDirection, bandOf };
})(typeof window !== "undefined" ? window : globalThis);
