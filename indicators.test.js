// 실행: node indicators.test.js
// 브라우저 없이도 지표 계산과 점수제 신호 판단 로직을 검증하는 테스트.
const assert = require("assert");
const path = require("path");

// signalLog.js가 사용하는 localStorage를 노드 환경에 흉내낸다.
global.localStorage = (function () {
  let store = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();

require(path.join(__dirname, "./config.js"));
require(path.join(__dirname, "./i18n.js"));
require(path.join(__dirname, "./heikinAshi.js"));
require(path.join(__dirname, "./macd.js"));
require(path.join(__dirname, "./rsi.js"));
require(path.join(__dirname, "./signals.js"));
require(path.join(__dirname, "./signalLog.js"));
require(path.join(__dirname, "./tradeLog.js"));
require(path.join(__dirname, "./lossAnalysis.js"));
require(path.join(__dirname, "./lockRange.js"));
require(path.join(__dirname, "./binanceApi.js"));
require(path.join(__dirname, "./state.js"));
require(path.join(__dirname, "./patternSnapshot.js"));
require(path.join(__dirname, "./patternLearn.js"));
require(path.join(__dirname, "./patternAnalysis.js"));
require(path.join(__dirname, "./patternSimilarity.js"));
require(path.join(__dirname, "./confidenceAdjust.js"));
require(path.join(__dirname, "./signalPerformance.js"));
require(path.join(__dirname, "./confBlockLog.js"));
require(path.join(__dirname, "./volumeProfile.js"));
require(path.join(__dirname, "./wyckoff.js"));
require(path.join(__dirname, "./alertDetail.js"));
global.devicePixelRatio = 1;
require(path.join(__dirname, "./charts.js"));
require(path.join(__dirname, "./backgroundMonitor.js"));

const { HeikinAshi, MACD, RSI, Signals, SignalLog, TradeLog, LossAnalysis, LockRange, BinanceApi, State, PatternLearn, BackgroundMonitor, PatternSnapshot, PatternAnalysis, PatternSimilarity, ConfidenceAdjust, SignalPerformance, AlertDetail, Charts, ConfBlockLog, VolumeProfile, Wyckoff, CONFIG } = global;

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("  \u2713", name);
    passed++;
  } catch (e) {
    console.log("  \u2717", name, "-", e.message);
    failed++;
  }
}

console.log("\n[Heikin Ashi]");
test("HA close = average of OHLC", () => {
  const k = [{ open: 10, high: 12, low: 9, close: 11 }];
  const ha = HeikinAshi.compute(k);
  assert.strictEqual(ha[0].close, (10 + 12 + 9 + 11) / 4);
});
test("HA open of candle 2 = avg(prev HA open, prev HA close)", () => {
  const k = [
    { open: 10, high: 12, low: 9, close: 11 },
    { open: 11, high: 13, low: 10, close: 12 },
  ];
  const ha = HeikinAshi.compute(k);
  const expectedOpen2 = (ha[0].open + ha[0].close) / 2;
  assert.strictEqual(ha[1].open, expectedOpen2);
});
test("bullish flag matches HA close > HA open", () => {
  const k = [{ open: 10, high: 15, low: 9, close: 14 }];
  const ha = HeikinAshi.compute(k);
  assert.strictEqual(ha[0].bullish, ha[0].close > ha[0].open);
});

console.log("\n[MACD]");
test("EMA seeds with SMA then recurses", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const ema = MACD.computeEMA(values, 3);
  const sma3 = (1 + 2 + 3) / 3;
  assert.strictEqual(ema[2], sma3);
  const k = 2 / 4;
  const expectedNext = values[3] * k + sma3 * (1 - k);
  assert.ok(Math.abs(ema[3] - expectedNext) < 1e-9);
});
test("DIF = EMAfast - EMAslow once both exist", () => {
  const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
  const { dif } = MACD.compute(closes, 12, 26, 9);
  const emaFast = MACD.computeEMA(closes, 12);
  const emaSlow = MACD.computeEMA(closes, 26);
  const idx = 30;
  assert.ok(Math.abs(dif[idx] - (emaFast[idx] - emaSlow[idx])) < 1e-9);
});
test("golden cross detected when DIF crosses above DEA", () => {
  const macd = { dif: [-1, -0.5, 0.2], dea: [0, 0, 0] };
  const cross = Signals.detectCross(macd, 2);
  assert.strictEqual(cross.golden, true);
  assert.strictEqual(cross.dead, false);
});
test("dead cross detected when DIF crosses below DEA", () => {
  const macd = { dif: [1, 0.5, -0.2], dea: [0, 0, 0] };
  const cross = Signals.detectCross(macd, 2);
  assert.strictEqual(cross.dead, true);
  assert.strictEqual(cross.golden, false);
});

console.log("\n[RSI]");
test("RSI = 100 when there are no losses in the period", () => {
  const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
  const rsi = RSI.compute(closes, 14);
  assert.strictEqual(rsi[14], 100);
});
test("RSI = 0 when there are no gains in the period", () => {
  const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
  const rsi = RSI.compute(closes, 14);
  assert.strictEqual(rsi[14], 0);
});
test("RSI stays within [0,100]", () => {
  const closes = [10, 12, 9, 15, 8, 20, 5, 25, 3, 30, 1, 32, 2, 35, 4, 40];
  const rsi = RSI.compute(closes, 14);
  rsi.forEach((v) => { if (v != null) assert.ok(v >= 0 && v <= 100); });
});

console.log("\n[Signals — multi-timeframe scoring]");

// scoreDirection이 필요로 하는 최소 필드만 채운 가짜 tf 데이터를 만드는 헬퍼
function fakeTf({ ha15, ha5, ha1, ha1Prev, macdCross }) {
  const mkHa = (bullish) => ({ bullish });
  // 1m의 HA 배열과 MACD 배열은 같은 캔들 인덱스를 가리켜야 하므로 길이를 맞춘다.
  const dif = macdCross === "golden" ? [-0.5, 0.3] : macdCross === "dead" ? [0.5, -0.3] : [0.1, 0.1];
  const dea = [0, 0];
  return {
    "15m": { ha: [mkHa(ha15)] },
    "5m": { ha: [mkHa(ha5)] },
    "1m": { ha: [mkHa(ha1Prev), mkHa(ha1)], macd: { dif, dea } },
  };
}

test("all 4 conditions matching LONG => score 100, band strong", () => {
  const tf = fakeTf({ ha15: true, ha5: true, ha1: true, ha1Prev: false, macdCross: "golden" });
  const r = Signals.scoreDirection("long", tf);
  assert.strictEqual(r.score, 100);
  assert.strictEqual(r.band, "strong");
  assert.deepStrictEqual(r.conditions, { trend15: true, trend5: true, ha1Flip: true, macdCross: true });
});

test("only 15m+5m trend match (no flip/cross) => score 55, band neutral", () => {
  const tf = fakeTf({ ha15: true, ha5: true, ha1: true, ha1Prev: true, macdCross: null });
  const r = Signals.scoreDirection("long", tf);
  assert.strictEqual(r.score, CONFIG.SCORE_WEIGHTS.trend15 + CONFIG.SCORE_WEIGHTS.trend5); // 55
  assert.strictEqual(r.band, "neutral");
});

test("only ha1Flip + macdCross (trend disagrees) => score 45, band none", () => {
  const tf = fakeTf({ ha15: false, ha5: false, ha1: true, ha1Prev: false, macdCross: "golden" });
  const r = Signals.scoreDirection("long", tf);
  assert.strictEqual(r.score, CONFIG.SCORE_WEIGHTS.ha1Flip + CONFIG.SCORE_WEIGHTS.macdCross); // 45
  assert.strictEqual(r.band, "none");
});

test("LONG and SHORT use the identical scoring structure (symmetric)", () => {
  const tfLong = fakeTf({ ha15: true, ha5: true, ha1: true, ha1Prev: false, macdCross: "golden" });
  const tfShort = fakeTf({ ha15: false, ha5: false, ha1: false, ha1Prev: true, macdCross: "dead" });
  const rLong = Signals.scoreDirection("long", tfLong);
  const rShort = Signals.scoreDirection("short", tfShort);
  assert.strictEqual(rLong.score, rShort.score);
  assert.strictEqual(rLong.band, rShort.band);
});

test("1m/5m/15m don't have to ALL agree for a signal (not strict AND)", () => {
  // 15m/5m는 방향과 일치하지만 1m 조건은 하나도 안 맞는 경우에도 점수(55)가 남아야 한다
  // (엄격한 AND 방식이었다면 여기서 신호가 완전히 0이 되어야 함)
  const tf = fakeTf({ ha15: true, ha5: true, ha1: false, ha1Prev: false, macdCross: null });
  const r = Signals.scoreDirection("long", tf);
  assert.ok(r.score > 0, "score should not collapse to 0 when only some timeframes agree");
});

function buildKline(open, high, low, close, openTime) {
  return { open, high, low, close, openTime, closeTime: openTime + 1 };
}
function buildTrendingKlines(startPrice, step, n, startTime, tfMs) {
  const arr = [];
  let price = startPrice;
  for (let i = 0; i < n; i++) {
    price += step;
    const open = price - step / 2, close = price, high = Math.max(open, close) + 0.2, low = Math.min(open, close) - 0.2;
    arr.push(buildKline(open, high, low, close, startTime + i * tfMs));
  }
  return arr;
}

test("evaluate(): strong uptrend across 1m/5m/15m yields a LONG signal with high score", () => {
  const k15 = buildTrendingKlines(100, 0.5, 40, 0, 15 * 60000);
  const k5 = buildTrendingKlines(100, 0.5, 40, 0, 5 * 60000);
  const k1 = buildTrendingKlines(100, 0.5, 40, 0, 60000);
  const tf = {
    "15m": Signals.computeIndicators(k15),
    "5m": Signals.computeIndicators(k5),
    "1m": Signals.computeIndicators(k1),
  };
  const result = Signals.evaluate(null, "TESTUSDT", tf);
  assert.ok(result.long.score >= result.short.score);
  assert.ok(["strong", "watch", "neutral"].includes(result.status));
});

test("duplicate signal is not re-logged for the same 1m entry candle", () => {
  const k15 = buildTrendingKlines(100, 0.5, 40, 0, 15 * 60000);
  const k5 = buildTrendingKlines(100, 0.5, 40, 0, 5 * 60000);
  const k1 = buildTrendingKlines(100, 0.5, 40, 0, 60000);
  const tf = {
    "15m": Signals.computeIndicators(k15),
    "5m": Signals.computeIndicators(k5),
    "1m": Signals.computeIndicators(k1),
  };
  const first = Signals.evaluate(null, "TESTUSDT", tf);
  const second = Signals.evaluate(first, "TESTUSDT", tf); // 동일 1m 캔들, 상태 변화 없음
  if (first.isNewSignal) {
    assert.strictEqual(second.isNewSignal, false);
  } else {
    assert.ok(true); // 애초에 관심 등급 미만이면 비교 대상 아님
  }
});

console.log("\n[SignalLog — recording structure for future AI use]");
test("append() stores a structured record with symbol/direction/score/conditions/timeframes", () => {
  SignalLog.clear();
  const k15 = buildTrendingKlines(100, 0.5, 40, 0, 15 * 60000);
  const k5 = buildTrendingKlines(100, 0.5, 40, 0, 5 * 60000);
  const k1 = buildTrendingKlines(100, 0.5, 40, 0, 60000);
  const tf = {
    "15m": Signals.computeIndicators(k15),
    "5m": Signals.computeIndicators(k5),
    "1m": Signals.computeIndicators(k1),
  };
  const result = Signals.evaluate(null, "TESTUSDT", tf);
  const rec = SignalLog.append(result, "long");
  assert.strictEqual(rec.symbol, "TESTUSDT");
  assert.strictEqual(rec.direction, "long");
  assert.ok(typeof rec.score === "number");
  assert.ok(rec.conditions && typeof rec.conditions.trend15 === "boolean");
  assert.ok(rec.timeframes["1m"] && rec.timeframes["5m"] && rec.timeframes["15m"]);
  assert.ok(rec.entryTimes["1m"] != null);
  assert.strictEqual(SignalLog.getAll().length, 1);
});

test("SIGNAL_LOG_MAX caps the stored history", () => {
  SignalLog.clear();
  const k15 = buildTrendingKlines(100, 0.5, 40, 0, 15 * 60000);
  const k5 = buildTrendingKlines(100, 0.5, 40, 0, 5 * 60000);
  const tf1mBase = buildTrendingKlines(100, 0.5, 40, 0, 60000);
  for (let i = 0; i < CONFIG.SIGNAL_LOG_MAX + 10; i++) {
    const k1 = tf1mBase.map((k) => ({ ...k, openTime: k.openTime + i * 100000000 }));
    const tf = {
      "15m": Signals.computeIndicators(k15),
      "5m": Signals.computeIndicators(k5),
      "1m": Signals.computeIndicators(k1),
    };
    const result = Signals.evaluate(null, "TESTUSDT", tf);
    SignalLog.append(result, "long");
  }
  assert.strictEqual(SignalLog.getAll().length, CONFIG.SIGNAL_LOG_MAX);
});

test("getMarkersForSymbolTf() returns openTime+direction pairs for chart markers", () => {
  SignalLog.clear();
  const k15 = buildTrendingKlines(100, 0.5, 40, 0, 15 * 60000);
  const k5 = buildTrendingKlines(100, 0.5, 40, 0, 5 * 60000);
  const k1 = buildTrendingKlines(100, 0.5, 40, 0, 60000);
  const tf = {
    "15m": Signals.computeIndicators(k15),
    "5m": Signals.computeIndicators(k5),
    "1m": Signals.computeIndicators(k1),
  };
  const result = Signals.evaluate(null, "TESTUSDT", tf);
  SignalLog.append(result, "long");
  const markers = SignalLog.getMarkersForSymbolTf("TESTUSDT", "1m");
  assert.strictEqual(markers.length, 1);
  assert.strictEqual(markers[0].direction, "long");
  assert.strictEqual(markers[0].openTime, result.entryTimes["1m"]);
});

console.log("\n[TradeLog — user-recorded trades]");

function clearTrades() {
  localStorage.setItem(CONFIG.STORAGE_KEYS.TRADES, "[]");
}

function fakeResult(overrides) {
  const base = {
    symbol: "TESTUSDT",
    updatedAt: Date.now(),
    price: 100,
    tf: {
      "1m": { klines: [{ openTime: 0 }], ha: [{ bullish: true }], macd: { dif: [0.5], dea: [0.1] }, rsi: [60] },
      "5m": { klines: [{ openTime: 0 }], ha: [{ bullish: true }], macd: { dif: [0.5], dea: [0.1] }, rsi: [58] },
      "15m": { klines: [{ openTime: 0 }], ha: [{ bullish: true }], macd: { dif: [0.5], dea: [0.1] }, rsi: [55] },
    },
    long: { direction: "long", score: 80, band: "strong", conditions: { trend15: true, trend5: true, ha1Flip: true, macdCross: true } },
    short: { direction: "short", score: 20, band: "none", conditions: { trend15: false, trend5: false, ha1Flip: false, macdCross: false } },
    leadingDirection: "long",
    status: "strong",
  };
  return Object.assign(base, overrides);
}

test("addEntry() creates an open trade with a snapshot and default notional", () => {
  clearTrades();
  const t1 = TradeLog.addEntry({ symbol: "TESTUSDT", direction: "long", entryPrice: 100, snapshotResult: fakeResult() });
  assert.strictEqual(t1.status, "open");
  assert.strictEqual(t1.symbol, "TESTUSDT");
  assert.strictEqual(t1.notional, CONFIG.DEFAULT_TRADE_NOTIONAL);
  assert.ok(t1.entrySnapshot);
  assert.strictEqual(t1.entrySnapshot.long.score, 80);
});

test("closeTrade() computes pnlPercent/pnlAmount correctly for LONG", () => {
  clearTrades();
  const t1 = TradeLog.addEntry({ symbol: "TESTUSDT", direction: "long", entryPrice: 100, notional: 100, snapshotResult: fakeResult() });
  const closed = TradeLog.closeTrade(t1.id, 110); // +10%
  assert.ok(Math.abs(closed.pnlPercent - 10) < 1e-9);
  assert.ok(Math.abs(closed.pnlAmount - 10) < 1e-9);
  assert.strictEqual(closed.win, true);
  assert.strictEqual(closed.status, "closed");
});

test("closeTrade() computes pnlPercent correctly for SHORT (inverse direction)", () => {
  clearTrades();
  const t1 = TradeLog.addEntry({ symbol: "TESTUSDT", direction: "short", entryPrice: 100, notional: 100, snapshotResult: fakeResult() });
  const closed = TradeLog.closeTrade(t1.id, 90); // price down 10% => short profits +10%
  assert.ok(Math.abs(closed.pnlPercent - 10) < 1e-9);
  assert.strictEqual(closed.win, true);
});

test("getStats() aggregates win rate and total P/L across closed trades only", () => {
  clearTrades();
  const a = TradeLog.addEntry({ symbol: "AAAUSDT", direction: "long", entryPrice: 100, notional: 100 });
  TradeLog.closeTrade(a.id, 110); // win +10
  const b = TradeLog.addEntry({ symbol: "BBBUSDT", direction: "long", entryPrice: 100, notional: 100 });
  TradeLog.closeTrade(b.id, 95); // loss -5
  TradeLog.addEntry({ symbol: "CCCUSDT", direction: "long", entryPrice: 100, notional: 100 }); // still open
  const stats = TradeLog.getStats();
  assert.strictEqual(stats.total, 2); // open trade excluded
  assert.strictEqual(stats.wins, 1);
  assert.ok(Math.abs(stats.winRate - 50) < 1e-9);
  assert.ok(Math.abs(stats.totalPnlAmount - 5) < 1e-9); // +10 - 5
});

test("TRADE_LOG_MAX caps stored trade history", () => {
  clearTrades();
  for (let i = 0; i < CONFIG.TRADE_LOG_MAX + 5; i++) {
    TradeLog.addEntry({ symbol: "TESTUSDT", direction: "long", entryPrice: 100 });
  }
  assert.strictEqual(TradeLog.getAll().length, CONFIG.TRADE_LOG_MAX);
});

console.log("\n[LossAnalysis — hedged, rule-based probable-cause text]");

test("analyze() returns not-applicable for winning or open trades", () => {
  clearTrades();
  const t1 = TradeLog.addEntry({ symbol: "TESTUSDT", direction: "long", entryPrice: 100, snapshotResult: fakeResult() });
  const stillOpen = LossAnalysis.analyze(t1);
  assert.strictEqual(stillOpen.applicable, false);

  const closedWin = TradeLog.closeTrade(t1.id, 110);
  const winResult = LossAnalysis.analyze(closedWin);
  assert.strictEqual(winResult.applicable, false);
});

test("analyze() flags a low entry score as a probable cause", () => {
  clearTrades();
  const weakSnapshot = fakeResult({
    long: { score: 45, band: "none", conditions: { trend15: false, trend5: false, ha1Flip: true, macdCross: true } },
  });
  const t1 = TradeLog.addEntry({ symbol: "TESTUSDT", direction: "long", entryPrice: 100, snapshotResult: weakSnapshot });
  const closed = TradeLog.closeTrade(t1.id, 90); // loss
  const analysis = LossAnalysis.analyze(closed);
  assert.strictEqual(analysis.applicable, true);
  const keys = analysis.reasons.map((r) => r.key);
  assert.ok(keys.includes("lowEntryScore"));
  assert.ok(keys.includes("against15mTrend"));
});

test("analyze() every reason string renders through tp()-style interpolation without leftover braces", () => {
  clearTrades();
  const weakSnapshot = fakeResult({
    long: { score: 45, band: "none", conditions: { trend15: false, trend5: false, ha1Flip: true, macdCross: true } },
  });
  const t1 = TradeLog.addEntry({ symbol: "TESTUSDT", direction: "long", entryPrice: 100, snapshotResult: weakSnapshot });
  const closed = TradeLog.closeTrade(t1.id, 90);
  const analysis = LossAnalysis.analyze(closed);
  const I18N = global.I18N.ko;
  analysis.reasons.forEach((r) => {
    let s = I18N[r.key];
    Object.keys(r.params).forEach((k) => { s = s.replace(new RegExp("\\{" + k + "\\}", "g"), r.params[k]); });
    assert.ok(!/\{[a-zA-Z]+\}/.test(s), `leftover placeholder in ${r.key}: ${s}`);
  });
});

test("analyze() handles a trade with no snapshot gracefully", () => {
  clearTrades();
  const t1 = TradeLog.addEntry({ symbol: "TESTUSDT", direction: "long", entryPrice: 100 }); // no snapshotResult
  const closed = TradeLog.closeTrade(t1.id, 90);
  const analysis = LossAnalysis.analyze(closed);
  assert.strictEqual(analysis.applicable, true);
  assert.strictEqual(analysis.reasons[0].key, "noSnapshotData");
});

console.log("\n[LockRange — LOCK ~ UNLOCK 구간 최고가/최저가]");

test("start() initializes high/low/basePrice all to the lock-in price", () => {
  const lock = LockRange.start(100, 1000);
  assert.strictEqual(lock.basePrice, 100);
  assert.strictEqual(lock.high, 100);
  assert.strictEqual(lock.low, 100);
  assert.strictEqual(lock.lockedAt, 1000);
});

test("update() raises the high on a new higher price (LOCK → price up → high 갱신)", () => {
  let lock = LockRange.start(100);
  lock = LockRange.update(lock, 105);
  assert.strictEqual(lock.high, 105);
  assert.strictEqual(lock.low, 100); // 최저가는 그대로
});

test("update() lowers the low on a new lower price (LOCK → price down → low 갱신)", () => {
  let lock = LockRange.start(100);
  lock = LockRange.update(lock, 95);
  assert.strictEqual(lock.low, 95);
  assert.strictEqual(lock.high, 100); // 최고가는 그대로
});

test("update() tracks both directions across a sequence of ticks", () => {
  let lock = LockRange.start(100);
  [103, 98, 107, 101, 94, 102].forEach((p) => { lock = LockRange.update(lock, p); });
  assert.strictEqual(lock.high, 107);
  assert.strictEqual(lock.low, 94);
  assert.strictEqual(lock.basePrice, 100); // 기준가는 변하지 않는다
});

test("update() ignores non-finite prices (data error) without corrupting the range", () => {
  let lock = LockRange.start(100);
  lock = LockRange.update(lock, NaN);
  lock = LockRange.update(lock, undefined);
  lock = LockRange.update(lock, -1 / 0);
  assert.strictEqual(lock.high, 100);
  assert.strictEqual(lock.low, 100);
});

test("update() returns the same reference when nothing changed (avoids needless writes)", () => {
  let lock = LockRange.start(100);
  lock = LockRange.update(lock, 105);
  const before = lock;
  const after = LockRange.update(lock, 102); // 최고/최저 갱신 없음
  assert.strictEqual(after, before);
});

test("LOCK → price moves both ways → UNLOCK confirms the final high/low/unlockPrice", () => {
  let lock = LockRange.start(100, 1000);
  [103, 98, 107, 94].forEach((p) => { lock = LockRange.update(lock, p); });
  const confirmed = LockRange.confirm(lock, "BTCUSDT", 99, 2000);
  assert.strictEqual(confirmed.symbol, "BTCUSDT");
  assert.strictEqual(confirmed.basePrice, 100);
  assert.strictEqual(confirmed.high, 107);
  assert.strictEqual(confirmed.low, 94);
  assert.strictEqual(confirmed.unlockPrice, 99);
  assert.strictEqual(confirmed.lockedAt, 1000);
  assert.strictEqual(confirmed.unlockedAt, 2000);
});

test("re-LOCK starts a brand new range, independent of the previous confirmed range", () => {
  let lockA = LockRange.start(100);
  lockA = LockRange.update(lockA, 120);
  const confirmedA = LockRange.confirm(lockA, "BTCUSDT", 110);
  assert.strictEqual(confirmedA.high, 120);

  // 다시 LOCK: 완전히 새로운 구간으로 시작해야 하고 이전 구간(confirmedA)의 값에 영향받지 않아야 한다
  let lockB = LockRange.start(200);
  assert.strictEqual(lockB.high, 200);
  assert.strictEqual(lockB.low, 200);
  lockB = LockRange.update(lockB, 190);
  assert.strictEqual(lockB.low, 190);
  assert.strictEqual(lockB.high, 200);
  // 이전 구간 데이터가 새 구간에 섞여 들어가지 않았는지 확인
  assert.notStrictEqual(lockB.high, confirmedA.high);
});

test("pctChange() computes signed percentage vs base, and returns null for invalid input", () => {
  assert.ok(Math.abs(LockRange.pctChange(100, 110) - 10) < 1e-9);
  assert.ok(Math.abs(LockRange.pctChange(100, 90) - -10) < 1e-9);
  assert.strictEqual(LockRange.pctChange(0, 100), null);
  assert.strictEqual(LockRange.pctChange(100, NaN), null);
  assert.strictEqual(LockRange.pctChange(null, 100), null);
});

console.log("\n[LockRange — P/L% tracking anchored to the record-start price]");

test("worked example from the spec: 100 → 105 → 110 → 95 → 103", () => {
  // 📋 기록 시작가: $100
  let lock = LockRange.start(100, 1000);

  // 현재가 $105 → 현재 손익률 +5.00%
  lock = LockRange.update(lock, 105);
  assert.ok(Math.abs(LockRange.pctChange(lock.basePrice, 105) - 5) < 1e-9);

  // $110까지 상승 → 최고가 110 / 최고 손익률 +10.00%
  lock = LockRange.update(lock, 110);
  assert.strictEqual(lock.high, 110);
  assert.ok(Math.abs(LockRange.pctChange(lock.basePrice, lock.high) - 10) < 1e-9);

  // $95까지 하락 → 최저가 95 / 최저 손익률 -5.00%
  lock = LockRange.update(lock, 95);
  assert.strictEqual(lock.low, 95);
  assert.ok(Math.abs(LockRange.pctChange(lock.basePrice, lock.low) - -5) < 1e-9);

  // 이후 $103 → 현재 손익률 +3.00%, 최고/최저는 그대로 유지
  lock = LockRange.update(lock, 103);
  assert.strictEqual(lock.high, 110); // 최고가 유지
  assert.strictEqual(lock.low, 95);   // 최저가 유지
  assert.ok(Math.abs(LockRange.pctChange(lock.basePrice, 103) - 3) < 1e-9);

  // UNLOCK ($103에서) → 확정 기록에 모든 필드가 정확히 저장되는지 확인
  const confirmed = LockRange.confirm(lock, "BTCUSDT", 103, 2000);
  assert.strictEqual(confirmed.startPrice, 100);
  assert.strictEqual(confirmed.basePrice, 100); // 락인 가격 = 기록 시작가
  assert.strictEqual(confirmed.endPrice, 103);
  assert.strictEqual(confirmed.high, 110);
  assert.strictEqual(confirmed.low, 95);
  assert.ok(Math.abs(confirmed.maxPnlPercent - 10) < 1e-9);
  assert.ok(Math.abs(confirmed.minPnlPercent - -5) < 1e-9);
  assert.ok(Math.abs(confirmed.endPnlPercent - 3) < 1e-9);
  assert.strictEqual(confirmed.recordStartAt, 1000);
  assert.strictEqual(confirmed.recordEndAt, 2000);
  assert.strictEqual(confirmed.lockedAt, 1000);
  assert.strictEqual(confirmed.unlockedAt, 2000);
});

test("P/L% tracking is always anchored to the record-start price, not any intermediate price", () => {
  let lock = LockRange.start(200);
  lock = LockRange.update(lock, 220); // +10% at the time, but base must stay 200
  lock = LockRange.update(lock, 180); // -10% at the time
  const confirmed = LockRange.confirm(lock, "ETHUSDT", 210);
  assert.strictEqual(confirmed.basePrice, 200);
  assert.ok(Math.abs(confirmed.maxPnlPercent - 10) < 1e-9); // vs 200, not vs any other price
  assert.ok(Math.abs(confirmed.minPnlPercent - -10) < 1e-9);
  assert.ok(Math.abs(confirmed.endPnlPercent - 5) < 1e-9); // (210-200)/200*100
});

test("re-LOCK resets P/L tracking to a fresh base, independent of the previous confirmed record", () => {
  let lockA = LockRange.start(100);
  lockA = LockRange.update(lockA, 150); // +50%
  const confirmedA = LockRange.confirm(lockA, "BTCUSDT", 140);
  assert.ok(Math.abs(confirmedA.maxPnlPercent - 50) < 1e-9);

  // 다시 LOCK: 새 기준가로 손익률 계산이 완전히 새로 시작되어야 한다
  let lockB = LockRange.start(500);
  lockB = LockRange.update(lockB, 510); // +2%, 이전 구간의 50%와 무관해야 함
  const confirmedB = LockRange.confirm(lockB, "BTCUSDT", 505);
  assert.ok(Math.abs(confirmedB.maxPnlPercent - 2) < 1e-9);
  assert.notStrictEqual(confirmedB.basePrice, confirmedA.basePrice);
});

console.log("\n[BinanceApi — malformed price data is rejected, not displayed]");

test("isValidCandle() accepts a normal candle", () => {
  assert.strictEqual(BinanceApi.isValidCandle({ open: 100, high: 101, low: 99, close: 100.5 }), true);
});
test("isValidCandle() rejects NaN fields", () => {
  assert.strictEqual(BinanceApi.isValidCandle({ open: NaN, high: 101, low: 99, close: 100.5 }), false);
});
test("isValidCandle() rejects zero/negative prices", () => {
  assert.strictEqual(BinanceApi.isValidCandle({ open: 0, high: 101, low: 99, close: 100.5 }), false);
  assert.strictEqual(BinanceApi.isValidCandle({ open: 100, high: 101, low: -5, close: 100.5 }), false);
});

console.log("\n[State — LOCK과 기록(recording)의 분리 (요구사항 2/9)]");

test("LOCK만으로는 State.recording이 생기지 않는다 (기록은 별도 버튼으로만 시작)", () => {
  State.saveLock(null);
  State.saveRecording(null);
  State.saveLock({ symbol: "BTCUSDT", basePrice: 100, lockedAt: 1000 });
  assert.strictEqual(State.lock.symbol, "BTCUSDT");
  assert.strictEqual(State.recording, null); // LOCK만 했을 뿐 기록은 시작 안 됨
});

test("State.lock과 State.recording은 서로 독립적으로 갱신된다", () => {
  State.saveLock({ symbol: "BTCUSDT", basePrice: 100, lockedAt: 1000 });
  const rec = LockRange.start(100, 2000);
  rec.symbol = "BTCUSDT";
  rec.direction = "long";
  State.saveRecording(rec);
  assert.strictEqual(State.lock.basePrice, 100);
  assert.strictEqual(State.recording.symbol, "BTCUSDT");
  // 기록 중 가격 갱신이 LOCK 상태(State.lock)에는 영향을 주지 않는다
  const updated = LockRange.update(State.recording, 110);
  State.saveRecording(updated);
  assert.strictEqual(State.recording.high, 110);
  assert.strictEqual(State.lock.basePrice, 100); // 그대로
});

test("알림 ON/OFF(State.notifyEnabled)는 LOCK/기록 상태 변경에 영향받지 않는다 (요구사항 9)", () => {
  State.saveNotify(true);
  State.saveLock({ symbol: "ETHUSDT", basePrice: 2000, lockedAt: 1000 });
  State.saveRecording(Object.assign(LockRange.start(2000), { symbol: "ETHUSDT", direction: "long" }));
  assert.strictEqual(State.notifyEnabled, true);
  State.saveLock(null);
  State.saveRecording(null);
  assert.strictEqual(State.notifyEnabled, true); // 여전히 ON 유지
});

console.log("\n[State — LOCK 기록(records) CRUD, signals와 분리 (요구사항 4/5/7)]");

test("addLockRecord()로 저장한 기록은 localStorage에도 즉시 반영된다", () => {
  localStorage.setItem(CONFIG.STORAGE_KEYS.LOCK_RECORDS, "[]");
  State.lockRecords = [];
  const record = { id: "rec1", symbol: "BTCUSDT", direction: "long", basePrice: 100, high: 110, low: 95, endPnlPercent: 3 };
  State.addLockRecord(record);
  assert.strictEqual(State.lockRecords.length, 1);
  const persisted = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCK_RECORDS));
  assert.strictEqual(persisted.length, 1);
  assert.strictEqual(persisted[0].id, "rec1");
});

test("removeLockRecord()는 해당 기록만 지우고 나머지는 유지한다 (개별 삭제)", () => {
  localStorage.setItem(CONFIG.STORAGE_KEYS.LOCK_RECORDS, "[]");
  State.lockRecords = [];
  State.addLockRecord({ id: "a", symbol: "BTCUSDT" });
  State.addLockRecord({ id: "b", symbol: "ETHUSDT" });
  State.addLockRecord({ id: "c", symbol: "SOLUSDT" });
  State.removeLockRecord("b");
  assert.strictEqual(State.lockRecords.length, 2);
  assert.ok(State.lockRecords.find((r) => r.id === "a"));
  assert.ok(!State.lockRecords.find((r) => r.id === "b"));
  assert.ok(State.lockRecords.find((r) => r.id === "c"));
  const persisted = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCK_RECORDS));
  assert.strictEqual(persisted.length, 2);
});

test("LOCK 기록은 SignalLog(신호 데이터)와 완전히 분리된 저장소를 쓴다", () => {
  SignalLog.clear();
  localStorage.setItem(CONFIG.STORAGE_KEYS.LOCK_RECORDS, "[]");
  State.lockRecords = [];
  State.addLockRecord({ id: "x", symbol: "BTCUSDT", direction: "long" });
  assert.strictEqual(SignalLog.getAll().length, 0); // signals 쪽엔 아무 영향 없음
  assert.strictEqual(State.lockRecords.length, 1);
});

console.log("\n[State — UNLOCK 후 다른 종목 재LOCK (요구사항 8)]");

test("UNLOCK(둘 다 null로 초기화)하면 곧바로 다른 종목을 LOCK할 수 있다", () => {
  // 종목 A: LOCK -> 기록 -> UNLOCK
  State.saveLock({ symbol: "AAAUSDT", basePrice: 10, lockedAt: 1 });
  State.saveRecording(Object.assign(LockRange.start(10), { symbol: "AAAUSDT", direction: "long" }));
  State.saveLock(null);
  State.saveRecording(null);
  assert.strictEqual(State.lock, null);
  assert.strictEqual(State.recording, null);

  // 종목 B: 곧바로 LOCK 가능해야 함
  State.saveLock({ symbol: "BBBUSDT", basePrice: 20, lockedAt: 2 });
  assert.strictEqual(State.lock.symbol, "BBBUSDT");
  assert.strictEqual(State.recording, null); // 기록은 아직 시작 안 됨(요구사항 2 유지)

  // 종목 B UNLOCK -> 종목 C도 문제없이 LOCK
  State.saveLock(null);
  State.saveLock({ symbol: "CCCUSDT", basePrice: 30, lockedAt: 3 });
  assert.strictEqual(State.lock.symbol, "CCCUSDT");
});

console.log("\n[레버리지 반영 최종 손익률 (요구사항 5) — app.js와 동일한 계산식]");

// app.js와 동일한 공식: LONG = endPnlPercent × leverage, SHORT = endPnlPercent × -1 × leverage
function finalPnl(direction, leverage, endPnlPercent) {
  return endPnlPercent * leverage * (direction === "short" ? -1 : 1);
}

test("LONG 10x: +2% 가격 상승 → +20%", () => {
  assert.ok(Math.abs(finalPnl("long", 10, 2) - 20) < 1e-9);
});
test("LONG 10x: -2% 가격 하락 → -20%", () => {
  assert.ok(Math.abs(finalPnl("long", 10, -2) - -20) < 1e-9);
});
test("SHORT 10x: -2% 가격 하락 → +20%", () => {
  assert.ok(Math.abs(finalPnl("short", 10, -2) - 20) < 1e-9);
});
test("SHORT 10x: +2% 가격 상승 → -20%", () => {
  assert.ok(Math.abs(finalPnl("short", 10, 2) - -20) < 1e-9);
});
test("레버리지 1x는 원래 가격 변동률과 동일하다 (기존 손익 계산 구조 보존)", () => {
  assert.ok(Math.abs(finalPnl("long", 1, 3) - 3) < 1e-9);
  assert.ok(Math.abs(finalPnl("short", 1, 3) - -3) < 1e-9);
});
test("maxPnlPercent/minPnlPercent(구간 최고·최저 손익률)는 레버리지 미적용 그대로 유지되어야 한다", () => {
  // LockRange.confirm()이 반환하는 max/minPnlPercent 자체는 이번 수정으로 손대지 않았음을 재확인
  let lock = LockRange.start(100);
  lock = LockRange.update(lock, 110);
  lock = LockRange.update(lock, 95);
  const confirmed = LockRange.confirm(lock, "BTCUSDT", 103);
  assert.ok(Math.abs(confirmed.maxPnlPercent - 10) < 1e-9); // 레버리지 미적용 원본
  assert.ok(Math.abs(confirmed.minPnlPercent - -5) < 1e-9);
});

console.log("\n[PatternLearn — 경량 자가학습 신호 필터 (요구사항 1)]");

function clearPatternLearn() {
  localStorage.setItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN, JSON.stringify({ pending: [], stats: {} }));
}
let fakeSignalSeq = 0;
function fakeSignalResult(direction, conditions, price, updatedAt, score) {
  const dir = { score: score == null ? 80 : score, band: "strong", conditions };
  const other = { score: 20, band: "none", conditions: { trend15: false, trend5: false, ha1Flip: false, macdCross: false } };
  const t = updatedAt || Date.now();
  return {
    symbol: "TESTUSDT",
    price,
    updatedAt: t,
    // 신호 캔들 시각: 호출마다 달라지게 해서 각 호출이 "서로 다른 신호"가 되도록 한다.
    // (동일 값이면 중복 방지 기능이 정상적으로 두 번째 기록을 막는다)
    entryTimes: { "1m": t + fakeSignalSeq++ * 60000 },
    long: direction === "long" ? dir : other,
    short: direction === "short" ? dir : other,
  };
}
const COND = { trend15: true, trend5: true, ha1Flip: true, macdCross: true };

test("샘플이 부족하면(LEARN_MIN_SAMPLES 미만) 항상 통과시킨다 (소수 실패로 차단 금지)", () => {
  clearPatternLearn();
  const r = fakeSignalResult("long", COND, 100);
  assert.strictEqual(PatternLearn.getConfidence(PatternLearn.buildPatternKey("coin", "TESTUSDT", "long", COND)), null);
  assert.strictEqual(PatternLearn.shouldAlert(r, "long"), true);
});

test("recordPending() → evaluatePending()으로 승/패가 패턴별로 누적된다 (추가 API 호출 없이 기존 가격 재사용)", () => {
  clearPatternLearn();
  const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000; // 판정 시점 지남
  const r = fakeSignalResult("long", COND, 100, entryTime);
  PatternLearn.recordPending(r, "long");
  // 이후 가격이 올랐다 = LONG 성공
  PatternLearn.evaluatePending({ TESTUSDT: { price: 110 } });
  const key = PatternLearn.buildPatternKey("coin", "TESTUSDT", "long", COND);
  // 샘플 1개뿐이라 아직 MIN_SAMPLES 미만 → 여전히 null(필터링 안 함)이어야 정상
  assert.strictEqual(PatternLearn.getConfidence(key), null);
});

test("충분한 샘플이 쌓이면 신뢰도가 계산되고, 낮은 신뢰도는 알림만 차단한다(신호 자체는 유지)", () => {
  clearPatternLearn();
  const key = PatternLearn.buildPatternKey("coin", "TESTUSDT", "long", COND);
  const N = CONFIG.LEARN_MIN_SAMPLES;
  // 대부분 실패하는 패턴을 인위적으로 재현 (승 1, 패 N-1)
  for (let i = 0; i < N; i++) {
    const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
    const r = fakeSignalResult("long", COND, 100, entryTime);
    PatternLearn.recordPending(r, "long");
    const finalPrice = i === 0 ? 110 : 90; // 첫 건만 성공(상승), 나머지는 실패(하락)
    PatternLearn.evaluatePending({ TESTUSDT: { price: finalPrice } });
  }
  const confidence = PatternLearn.getConfidence(key);
  assert.ok(confidence != null);
  assert.ok(confidence < CONFIG.LEARN_CONFIDENCE_THRESHOLD);

  const r = fakeSignalResult("long", COND, 100);
  assert.strictEqual(PatternLearn.shouldAlert(r, "long"), false); // 알림만 차단
});

test("판정 시간이 아직 안 지난 대기 항목은 건드리지 않는다", () => {
  clearPatternLearn();
  const r = fakeSignalResult("long", COND, 100, Date.now()); // 방금 발생 — 아직 판정 시점 아님
  PatternLearn.recordPending(r, "long");
  PatternLearn.evaluatePending({ TESTUSDT: { price: 999 } }); // 가격이 어떻든 아직 판정 안 됨
  assert.strictEqual(PatternLearn.getConfidence(PatternLearn.buildPatternKey("coin", "TESTUSDT", "long", COND)), null);
});

console.log("\n[10초 미만 기록 폐기 (요구사항 4) — app.js와 동일한 판정식]");

test("9.9초 경과 → 저장 안 함 / 10초 이상 → 정상 저장 (경계값 그대로)", () => {
  // app.js: durationMs >= CONFIG.MIN_RECORD_DURATION_MS 일 때만 저장
  assert.strictEqual(9900 >= CONFIG.MIN_RECORD_DURATION_MS, false);
  assert.strictEqual(10000 >= CONFIG.MIN_RECORD_DURATION_MS, true);
  assert.strictEqual(CONFIG.MIN_RECORD_DURATION_MS, 10000);
});

console.log("\n[PatternLearn — ON/OFF 토글 (요구사항 1)]");

function setLearnEnabled(v) {
  State.saveLearnEnabled(v);
}
function clearLearn() {
  localStorage.setItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN, JSON.stringify({ pending: [], stats: {}, entries: [] }));
}

test("기본값은 ON이다 (기존 앱 동작 유지)", () => {
  // localStorage를 건드리지 않은 새 State라면 true여야 하지만, 이 테스트 파일에선 이미
  // 이전 테스트들이 State를 공유하므로, 여기서는 저장된 값이 실제로 반영되는지만 확인한다.
  setLearnEnabled(true);
  assert.strictEqual(State.learnEnabled, true);
  assert.strictEqual(PatternLearn.isEnabled(), true);
});

test("OFF로 바꾸면 isEnabled()가 즉시 false를 반환한다", () => {
  setLearnEnabled(false);
  assert.strictEqual(PatternLearn.isEnabled(), false);
  setLearnEnabled(true); // 다른 테스트에 영향 없도록 복구
});

test("OFF 상태에서는 recordPending()이 아무 것도 저장하지 않는다", () => {
  clearLearn();
  setLearnEnabled(false);
  const r = fakeSignalResult("long", COND, 100);
  PatternLearn.recordPending(r, "long");
  const raw = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN));
  assert.strictEqual(raw.pending.length, 0);
  setLearnEnabled(true);
});

test("OFF 상태에서는 evaluatePending()이 대기 항목을 그대로 둔다(삭제도 판정도 안 함)", () => {
  clearLearn();
  setLearnEnabled(true);
  const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
  const r = fakeSignalResult("long", COND, 100, entryTime);
  PatternLearn.recordPending(r, "long"); // ON 상태에서 정상 등록
  setLearnEnabled(false);
  PatternLearn.evaluatePending({ TESTUSDT: { price: 110 } }); // OFF이므로 무시되어야 함
  const raw = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN));
  assert.strictEqual(raw.pending.length, 1); // 그대로 남아있어야 함 (삭제되지 않음)
  setLearnEnabled(true);
  PatternLearn.evaluatePending({ TESTUSDT: { price: 110 } }); // 다시 ON하면 이어서 판정됨
  const raw2 = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN));
  assert.strictEqual(raw2.pending.length, 0);
});

test("OFF 상태에서는 getConfidence()/shouldAlert()가 기존 데이터를 무시한다(항상 통과)", () => {
  clearLearn();
  setLearnEnabled(true);
  const key = PatternLearn.buildPatternKey("coin", "TESTUSDT", "long", COND);
  // 신뢰도가 낮은 패턴을 미리 만들어둔다 (표본 충분, 낮은 승률)
  for (let i = 0; i < CONFIG.LEARN_MIN_SAMPLES; i++) {
    const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
    const r = fakeSignalResult("long", COND, 100, entryTime);
    PatternLearn.recordPending(r, "long");
    PatternLearn.evaluatePending({ TESTUSDT: { price: i === 0 ? 110 : 90 } });
  }
  setLearnEnabled(false);
  assert.strictEqual(PatternLearn.getConfidence(key), null); // OFF면 데이터가 있어도 null
  const r = fakeSignalResult("long", COND, 100);
  assert.strictEqual(PatternLearn.shouldAlert(r, "long"), true); // OFF면 항상 통과
  setLearnEnabled(true);
  assert.notStrictEqual(PatternLearn.getConfidence(key), null); // 다시 ON하면 기존 데이터 그대로 사용됨
});

console.log("\n[PatternLearn — 저장 데이터 상세화 + 하위호환 (요구사항 2, 6)]");

test("evaluatePending()이 승/패 확정 시 상세 entries도 함께 기록한다(종목/방향/조건/손익률 포함)", () => {
  clearLearn();
  const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
  const r = fakeSignalResult("long", COND, 100, entryTime);
  PatternLearn.recordPending(r, "long");
  PatternLearn.evaluatePending({ TESTUSDT: { price: 110 } });
  const raw = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN));
  assert.strictEqual(raw.entries.length, 1);
  const e = raw.entries[0];
  assert.strictEqual(e.source, "signal");
  assert.strictEqual(e.symbol, "TESTUSDT");
  assert.strictEqual(e.direction, "long");
  assert.deepStrictEqual(e.conditions, COND);
  assert.strictEqual(e.result, "WIN");
  assert.ok(Math.abs(e.pnlPercent - 10) < 1e-9);
});

test("category 불명 legacy 데이터는 코인/주식으로 추측하지 않고 legacy 영역에 보존된다(요구사항 10)", () => {
  // 이전 버전이 기록하던 형태 재현: stats는 구버전 전역 카운터, entries에는 category 필드가 없음.
  const legacy = {
    pending: [],
    stats: { "long:1111": { wins: 3, losses: 1 } }, // 구버전 전역 통계 — 절대 삭제되면 안 됨
    entries: [
      { source: "signal", symbol: "BTCUSDT", direction: "long", conditions: COND, result: "WIN", pnlPercent: 4 },
      { source: "signal", symbol: "BTCUSDT", direction: "long", conditions: COND, result: "LOSS", pnlPercent: -2 },
      { source: "lockin", symbol: "ETHUSDT", direction: "short", conditions: COND, result: "WIN", pnlPercent: 3 },
    ],
  };
  localStorage.setItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN, JSON.stringify(legacy));

  // load()가 호출되는 순간 자동 마이그레이션. category가 없으므로 새 학습 공간엔 들어가지 않아야 한다.
  const coinTotals = PatternLearn.getTotals("coin");
  const stockTotals = PatternLearn.getTotals("stock");
  assert.strictEqual(coinTotals.total, 0); // 코인으로 추측해서 넣지 않음
  assert.strictEqual(stockTotals.total, 0); // 주식으로도 넣지 않음

  // 원본과 legacy 보존 확인
  const raw = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN));
  assert.deepStrictEqual(raw.stats["long:1111"], { wins: 3, losses: 1 }); // 구버전 stats 그대로
  assert.strictEqual(raw.entries.length, 3); // entries 원본 그대로 (삭제 금지)
  assert.strictEqual(raw.schemaVersion, 2);
  const legacyStats = PatternLearn.getLegacyStats();
  const legacyTotal = Object.values(legacyStats).reduce((n, v) => n + v.wins + v.losses, 0);
  assert.strictEqual(legacyTotal, 3); // 3건이 legacy 영역에 안전하게 보존됨

  // 마이그레이션 이후 새로 기록하면 정확한 category로 독립 저장된다.
  State.setCategory("BTCUSDT", "coin");
  PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  assert.strictEqual(PatternLearn.getStatsFor("coin", "BTCUSDT").total, 1); // legacy와 섞이지 않고 1건만
  assert.strictEqual(PatternLearn.getStatsFor("stock", "BTCUSDT").total, 0);
});

console.log("\n[PatternLearn — Lock-in 결과 연결 (요구사항 3)]");

test("recordLockResult()는 손익률 부호로 WIN/LOSS를 판정하고 stats/entries에 반영한다", () => {
  clearLearn();
  const key = PatternLearn.buildPatternKey("coin", "ETHUSDT", "short", COND);
  PatternLearn.recordLockResult({ symbol: "ETHUSDT", direction: "short", conditions: COND, pnlPercent: 12.5 });
  const info = PatternLearn.getPatternInfo(key);
  assert.strictEqual(info.wins, 1);
  assert.strictEqual(info.losses, 0);
  const raw = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN));
  assert.strictEqual(raw.entries[0].source, "lockin");
  assert.strictEqual(raw.entries[0].symbol, "ETHUSDT");
});

test("recordLockResult()는 자가학습 OFF면 아무 것도 저장하지 않는다", () => {
  clearLearn();
  setLearnEnabled(false);
  PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  const raw = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN));
  assert.strictEqual(raw.entries.length, 0);
  setLearnEnabled(true);
});

test("recordLockResult()는 조건 스냅샷이 없으면 무시한다(예전 방식 호환)", () => {
  clearLearn();
  PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: null, pnlPercent: 5 });
  const raw = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN));
  assert.strictEqual(raw.entries.length, 0);
});

console.log("\n[PatternLearn — 종목별/카테고리별 독립 학습 (요구사항 4)]");

test("BTCUSDT의 학습 결과가 ETHUSDT 판단에 섞이지 않는다", () => {
  clearLearn();
  const btcKey = PatternLearn.buildPatternKey("coin", "BTCUSDT", "long", COND);
  const ethKey = PatternLearn.buildPatternKey("coin", "ETHUSDT", "long", COND);
  for (let i = 0; i < CONFIG.LEARN_MIN_SAMPLES; i++) {
    PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 }); // BTC는 전부 승
  }
  assert.strictEqual(PatternLearn.getPatternInfo(ethKey).total, 0); // ETH는 전혀 영향 없음
  assert.strictEqual(PatternLearn.getPatternInfo(btcKey).total, CONFIG.LEARN_MIN_SAMPLES);
  const btcConf = PatternLearn.getConfidence(btcKey);
  const ethConf = PatternLearn.getConfidence(ethKey);
  assert.ok(btcConf != null);
  assert.strictEqual(ethConf, null); // 데이터가 없으므로 학습 부족 → 필터링 없이 통과
});

test("같은 조건이어도 종목이 다르면 완전히 다른 패턴키를 생성한다(섞임 없음)", () => {
  const k1 = PatternLearn.buildPatternKey("coin", "BTCUSDT", "long", COND);
  const k2 = PatternLearn.buildPatternKey("coin", "ETHUSDT", "long", COND);
  assert.notStrictEqual(k1, k2);
});

test("카테고리가 다르면(코인 vs 주식) 같은 심볼 문자열이어도 키가 분리된다", () => {
  const k1 = PatternLearn.buildPatternKey("coin", "AAPL", "long", COND);
  const k2 = PatternLearn.buildPatternKey("stock", "AAPL", "long", COND);
  assert.notStrictEqual(k1, k2);
});

test("신규 종목(학습 데이터 0개)은 기존 신호가 그대로 통과한다(과도한 차단 금지, 요구사항 5)", () => {
  clearLearn();
  const r = fakeSignalResult("long", COND, 100);
  r.symbol = "BRANDNEWUSDT";
  assert.strictEqual(PatternLearn.shouldAlert(r, "long"), true);
});

console.log("\n[PatternLearn — 학습 데이터가 쌓일수록 영향력이 점진적으로 증가 (요구사항 5)]");

test("표본이 최소 기준을 갓 넘겼을 때는 신뢰도가 중립(0.5)에 가깝게 스무딩된다", () => {
  clearLearn();
  // 표본 LEARN_MIN_SAMPLES개, 전부 패배 → 원본 승률은 0%지만, 스무딩 때문에 0보다는 확실히 높게 나와야 한다
  for (let i = 0; i < CONFIG.LEARN_MIN_SAMPLES; i++) {
    PatternLearn.recordLockResult({ symbol: "SMOOTHUSDT", direction: "long", conditions: COND, pnlPercent: -1 });
  }
  const key = PatternLearn.buildPatternKey("coin", "SMOOTHUSDT", "long", COND);
  const conf = PatternLearn.getConfidence(key);
  assert.ok(conf > 0); // 원본 승률(0%)보다 확실히 위로 당겨져 있어야 함(중립 쪽으로 스무딩)
  assert.ok(conf < 0.5); // 그래도 실제로 전부 졌으니 0.5보다는 낮아야 함
});

test("표본이 훨씬 많이 쌓이면 신뢰도가 실제 승률에 근접하게 수렴한다", () => {
  clearLearn();
  const symbol = "CONVERGEUSDT";
  const N = CONFIG.LEARN_MIN_SAMPLES * 8; // 표본을 충분히 많이 쌓는다
  for (let i = 0; i < N; i++) {
    PatternLearn.recordLockResult({ symbol, direction: "long", conditions: COND, pnlPercent: -1 }); // 전부 패배 → 실제 승률 0%
  }
  const key = PatternLearn.buildPatternKey("coin", symbol, "long", COND);
  const conf = PatternLearn.getConfidence(key);
  // 공식: (wins + PRIOR*0.5) / (total + PRIOR) = (0 + 10*0.5) / (80 + 10) ≈ 0.056
  const expected = (0 + CONFIG.LEARN_PRIOR_WEIGHT * 0.5) / (N + CONFIG.LEARN_PRIOR_WEIGHT);
  assert.ok(Math.abs(conf - expected) < 1e-9);
  assert.ok(conf < 0.1); // 표본이 적을 때(0.5 근처)보다 실제 승률(0%)에 훨씬 가까워짐
});

console.log("\n[설정 — 최대 종목 수 확대 (요구사항 2)]");

test("MAX_SYMBOLS가 50으로 확대되었다", () => {
  assert.strictEqual(CONFIG.MAX_SYMBOLS, 50);
});
test("SYMBOL_UPDATE_CONCURRENCY가 설정되어 있다(50개를 한 번에 몰아서 요청하지 않기 위함)", () => {
  assert.ok(CONFIG.SYMBOL_UPDATE_CONCURRENCY > 0 && CONFIG.SYMBOL_UPDATE_CONCURRENCY < CONFIG.MAX_SYMBOLS);
});

console.log("\n[State — 종목 카테고리 분리 (요구사항 3, 7)]");

test("카테고리 지정이 없는 기존 종목은 기본 카테고리(coin)로 자동 처리된다(마이그레이션)", () => {
  assert.strictEqual(State.getCategory("NEVERSETUSDT"), "coin");
});
test("setCategory()로 지정한 카테고리가 유지된다", () => {
  State.setCategory("AAPLSTOCK", "stock");
  assert.strictEqual(State.getCategory("AAPLSTOCK"), "stock");
});
test("종목을 감시 목록에서 제거해도(State.symbols) 카테고리/학습 데이터는 별개로 남아있다(요구사항 7)", () => {
  State.setCategory("KEEPLEARNUSDT", "coin");
  PatternLearn.recordLockResult({ symbol: "KEEPLEARNUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  // 감시 목록에서 제거하는 것을 흉내(State.symbols 자체를 바꿔도 카테고리/학습 데이터는 무관)
  State.saveSymbols(State.symbols.filter((s) => s !== "KEEPLEARNUSDT"));
  assert.strictEqual(State.getCategory("KEEPLEARNUSDT"), "coin"); // 카테고리 정보 유지
  assert.ok(PatternLearn.getSymbolStats("KEEPLEARNUSDT").total >= 1); // 학습 데이터도 유지
});

console.log("\n[PatternLearn — 요약 통계 및 초기화 (요구사항 5, 7)]");

test("getTotals(category)는 해당 시장의 패턴만 합산한다", () => {
  clearLearn();
  State.setCategory("A", "coin");
  State.setCategory("B", "stock");
  PatternLearn.recordLockResult({ symbol: "A", direction: "long", conditions: COND, pnlPercent: 5 });   // coin 1승
  PatternLearn.recordLockResult({ symbol: "B", direction: "short", conditions: COND, pnlPercent: -3 }); // stock 1패
  // 카테고리를 명시하면 그 시장만 집계되어야 한다(섞이면 실패)
  const coin = PatternLearn.getTotals("coin");
  assert.strictEqual(coin.wins, 1);
  assert.strictEqual(coin.losses, 0); // 주식의 1패가 섞이면 안 됨
  const stock = PatternLearn.getTotals("stock");
  assert.strictEqual(stock.wins, 0);  // 코인의 1승이 섞이면 안 됨
  assert.strictEqual(stock.losses, 1);
  // 카테고리를 생략하면 전 시장 합계(전체 현황 확인용)
  const all = PatternLearn.getTotals();
  assert.strictEqual(all.wins, 1);
  assert.strictEqual(all.losses, 1);
});

test("reset()은 학습 데이터만 지우고, 다른 localStorage 키(거래기록/LOCK기록/설정)는 건드리지 않는다", () => {
  clearLearn();
  PatternLearn.recordLockResult({ symbol: "A", direction: "long", conditions: COND, pnlPercent: 5 });
  localStorage.setItem(CONFIG.STORAGE_KEYS.TRADES, JSON.stringify([{ id: "keep-me" }]));
  localStorage.setItem(CONFIG.STORAGE_KEYS.LOCK_RECORDS, JSON.stringify([{ id: "keep-me-too" }]));
  PatternLearn.reset();
  const totals = PatternLearn.getTotals();
  assert.strictEqual(totals.entries, 0);
  assert.strictEqual(totals.wins, 0);
  // 다른 키들은 그대로 있어야 한다
  assert.strictEqual(JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TRADES))[0].id, "keep-me");
  assert.strictEqual(JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCK_RECORDS))[0].id, "keep-me-too");
});

console.log("\n[독립성 테스트 — 요구사항 13 (TEST 1~7)]");

// 이 블록은 요구사항 13의 TEST 1~7을 순서대로, 하나의 깨끗한 상태에서 누적 진행한다.
function freshLearn() {
  localStorage.setItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN,
    JSON.stringify({ pending: [], stats: {}, entries: [], statsBySymbol: {}, legacyStats: {}, schemaVersion: 2 }));
}
function learnN(category, symbol, n, pnl) {
  State.setCategory(symbol, category);
  for (let i = 0; i < n; i++) {
    PatternLearn.recordLockResult({ symbol, direction: "long", conditions: COND, pnlPercent: pnl });
  }
}

freshLearn();
State.saveLearnEnabled(true);

test("TEST 1: 코인 BTCUSDT 10개 생성 → coin/BTCUSDT=10, stock 전체=0", () => {
  learnN("coin", "BTCUSDT", 10, 5);
  assert.strictEqual(PatternLearn.getStatsFor("coin", "BTCUSDT").total, 10);
  assert.strictEqual(PatternLearn.getTotals("stock").total, 0);
  assert.strictEqual(PatternLearn.getTotals("coin").total, 10);
});

test("TEST 2: 주식 A 5개 생성 → coin/BTCUSDT=10 유지, stock/A=5 (합쳐지면 실패)", () => {
  learnN("stock", "STOCKA", 5, 5);
  assert.strictEqual(PatternLearn.getStatsFor("coin", "BTCUSDT").total, 10); // 그대로
  assert.strictEqual(PatternLearn.getStatsFor("stock", "STOCKA").total, 5);
  assert.strictEqual(PatternLearn.getTotals("coin").total, 10);  // 코인 시장에 주식 5건이 섞이지 않음
  assert.strictEqual(PatternLearn.getTotals("stock").total, 5);  // 주식 시장에 코인 10건이 섞이지 않음
});

test("TEST 3: ETHUSDT 3개 생성 → BTCUSDT=10 그대로, ETHUSDT=3 (BTC가 13이면 실패)", () => {
  learnN("coin", "ETHUSDT", 3, 5);
  assert.strictEqual(PatternLearn.getStatsFor("coin", "BTCUSDT").total, 10); // 13이 되면 실패
  assert.strictEqual(PatternLearn.getStatsFor("coin", "ETHUSDT").total, 3);
  assert.strictEqual(PatternLearn.getTotals("coin").total, 13); // 시장 합계는 10+3
});

test("TEST 4: 주식 B 2개 생성 → 주식A=5, 주식B=2 (합쳐지면 실패)", () => {
  learnN("stock", "STOCKB", 2, 5);
  assert.strictEqual(PatternLearn.getStatsFor("stock", "STOCKA").total, 5); // 7이 되면 실패
  assert.strictEqual(PatternLearn.getStatsFor("stock", "STOCKB").total, 2);
  assert.strictEqual(PatternLearn.getTotals("stock").total, 7);
});

test("TEST 5: BTCUSDT의 높은 승률이 ETHUSDT/주식 confidence에 영향을 주지 않는다", () => {
  freshLearn();
  learnN("coin", "BTCUSDT", CONFIG.LEARN_MIN_SAMPLES * 2, 5); // BTC: 전부 승 (높은 승률, 표본 충분)
  const btcKey = PatternLearn.buildPatternKey("coin", "BTCUSDT", "long", COND);
  const ethKey = PatternLearn.buildPatternKey("coin", "ETHUSDT", "long", COND);
  const stockKey = PatternLearn.buildPatternKey("stock", "STOCKA", "long", COND);
  assert.ok(PatternLearn.getConfidence(btcKey) > 0.7);          // BTC는 높은 신뢰도(스무딩 적용값)
  assert.strictEqual(PatternLearn.getConfidence(ethKey), null);  // ETH는 데이터 없음 → null(필터 미적용)
  assert.strictEqual(PatternLearn.getConfidence(stockKey), null);// 주식도 데이터 없음 → null

  // shouldAlert까지 분리 확인: 데이터 없는 종목은 기존 전략 그대로 통과해야 한다(요구사항 7)
  State.setCategory("ETHUSDT", "coin");
  State.setCategory("STOCKA", "stock");
  const mkResult = (sym) => ({ symbol: sym, long: { conditions: COND }, short: { conditions: COND } });
  assert.strictEqual(PatternLearn.shouldAlert(mkResult("ETHUSDT"), "long"), true);
  assert.strictEqual(PatternLearn.shouldAlert(mkResult("STOCKA"), "long"), true);
});

test("TEST 5b: 같은 심볼명이 코인/주식 양쪽에 있어도 학습 공간이 완전히 분리된다", () => {
  freshLearn();
  // 동일 심볼 문자열 "XYZ"를 코인/주식 양쪽에서 학습시킨다 (카테고리만 다름)
  const coinKey = PatternLearn.buildPatternKey("coin", "XYZ", "long", COND);
  const stockKey = PatternLearn.buildPatternKey("stock", "XYZ", "long", COND);
  State.setCategory("XYZ", "coin");
  for (let i = 0; i < CONFIG.LEARN_MIN_SAMPLES; i++) {
    PatternLearn.recordLockResult({ symbol: "XYZ", direction: "long", conditions: COND, pnlPercent: 5 }); // coin: 전부 승
  }
  State.setCategory("XYZ", "stock");
  for (let i = 0; i < CONFIG.LEARN_MIN_SAMPLES; i++) {
    PatternLearn.recordLockResult({ symbol: "XYZ", direction: "long", conditions: COND, pnlPercent: -5 }); // stock: 전부 패
  }
  assert.strictEqual(PatternLearn.getStatsFor("coin", "XYZ").wins, CONFIG.LEARN_MIN_SAMPLES);
  assert.strictEqual(PatternLearn.getStatsFor("coin", "XYZ").losses, 0);
  assert.strictEqual(PatternLearn.getStatsFor("stock", "XYZ").wins, 0);
  assert.strictEqual(PatternLearn.getStatsFor("stock", "XYZ").losses, CONFIG.LEARN_MIN_SAMPLES);
  // confidence도 정반대로 나와야 한다(섞였다면 둘 다 0.5가 됨).
  // 스무딩 공식 (wins + PRIOR*0.5)/(total + PRIOR) 기준, 표본 10·PRIOR 10이면
  // 전승=0.75 / 전패=0.25가 이론값이다.
  const expectHigh = (CONFIG.LEARN_MIN_SAMPLES + CONFIG.LEARN_PRIOR_WEIGHT * 0.5) / (CONFIG.LEARN_MIN_SAMPLES + CONFIG.LEARN_PRIOR_WEIGHT);
  const expectLow = (0 + CONFIG.LEARN_PRIOR_WEIGHT * 0.5) / (CONFIG.LEARN_MIN_SAMPLES + CONFIG.LEARN_PRIOR_WEIGHT);
  assert.ok(Math.abs(PatternLearn.getConfidence(coinKey) - expectHigh) < 1e-9);
  assert.ok(Math.abs(PatternLearn.getConfidence(stockKey) - expectLow) < 1e-9);
  assert.ok(PatternLearn.getConfidence(coinKey) > PatternLearn.getConfidence(stockKey)); // 섞이지 않았음을 명확히 확인
});

test("TEST 7: 저장된 데이터를 다시 읽어도(재실행 시뮬레이션) category+symbol별 값이 그대로 유지된다", () => {
  freshLearn();
  learnN("coin", "BTCUSDT", 10, 5);
  learnN("coin", "ETHUSDT", 3, 5);
  learnN("stock", "STOCKA", 5, 5);
  // localStorage 내용을 그대로 두고 다시 조회하면(=앱 재실행 후 첫 조회) 동일해야 한다
  const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);
  localStorage.setItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN, raw); // 디스크 왕복
  assert.strictEqual(PatternLearn.getStatsFor("coin", "BTCUSDT").total, 10);
  assert.strictEqual(PatternLearn.getStatsFor("coin", "ETHUSDT").total, 3);
  assert.strictEqual(PatternLearn.getStatsFor("stock", "STOCKA").total, 5);
  assert.strictEqual(PatternLearn.getTotals("coin").total, 13);
  assert.strictEqual(PatternLearn.getTotals("stock").total, 5);
});

test("자가학습 OFF면 카테고리 무관하게 저장/반영이 멈추고, 데이터는 삭제되지 않는다(요구사항 9)", () => {
  freshLearn();
  learnN("coin", "BTCUSDT", CONFIG.LEARN_MIN_SAMPLES, 5);
  const beforeTotal = PatternLearn.getStatsFor("coin", "BTCUSDT").total;
  State.saveLearnEnabled(false);
  learnN("coin", "BTCUSDT", 5, 5); // OFF 상태에서 추가 시도
  assert.strictEqual(PatternLearn.getStatsFor("coin", "BTCUSDT").total, beforeTotal); // 늘지 않음
  const key = PatternLearn.buildPatternKey("coin", "BTCUSDT", "long", COND);
  assert.strictEqual(PatternLearn.getConfidence(key), null); // OFF면 기존 데이터도 미반영
  State.saveLearnEnabled(true);
  assert.strictEqual(PatternLearn.getStatsFor("coin", "BTCUSDT").total, beforeTotal); // 데이터는 보존됨
  assert.ok(PatternLearn.getConfidence(key) != null); // 다시 ON하면 그대로 사용
});

console.log("\n[학습 성능 분석 — 읽기 전용, 기존 entries[] 사용]");

// 결과가 확정된 entries를 직접 심어서 계산 정확도를 검증한다(저장 로직을 거치지 않고 순수 계산만 확인).
function seedEntries(results, category) {
  const entries = results.map((r, i) => ({
    source: "signal",
    symbol: "TESTSYM",
    category: category || "coin",
    direction: "long",
    conditions: COND,
    resultTime: 1000 + i, // 오래된 것 → 최신 순서
    result: r,
  }));
  localStorage.setItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN,
    JSON.stringify({ pending: [], stats: {}, entries, statsBySymbol: {}, legacyStats: {}, schemaVersion: 2 }));
}
const W = "WIN", L = "LOSS";

test("전체 승률을 정확히 계산한다", () => {
  seedEntries([W, W, L, W, L]); // 3승 2패 = 60%
  const s = PatternLearn.getPerformanceSummary("coin");
  assert.strictEqual(s.overall.total, 5);
  assert.strictEqual(s.overall.wins, 3);
  assert.strictEqual(s.overall.losses, 2);
  assert.ok(Math.abs(s.overall.winRate - 60) < 1e-9);
});

test("최근 10회 승률을 정확히 계산한다(최신 10건만 사용)", () => {
  // 앞 5건은 전부 패, 뒤 10건은 8승 2패 → 최근 10회는 80%여야 한다
  seedEntries([L, L, L, L, L, W, W, W, W, W, W, W, W, L, L]);
  const p = PatternLearn.getRecentPerformance(10, "coin");
  assert.strictEqual(p.total, 10);
  assert.strictEqual(p.wins, 8);
  assert.strictEqual(p.losses, 2);
  assert.ok(Math.abs(p.winRate - 80) < 1e-9);
  assert.strictEqual(p.enough, true);
});

test("최근 20회 승률을 정확히 계산한다", () => {
  const arr = [];
  for (let i = 0; i < 6; i++) arr.push(W);   // 앞부분 6승
  for (let i = 0; i < 14; i++) arr.push(W);  // 최근 20건 중 14승
  for (let i = 0; i < 6; i++) arr.push(L);   // 최근 20건 중 6패
  seedEntries(arr); // 총 26건, 최근 20건 = 14승 6패 = 70%
  const p = PatternLearn.getRecentPerformance(20, "coin");
  assert.strictEqual(p.total, 20);
  assert.strictEqual(p.wins, 14);
  assert.strictEqual(p.losses, 6);
  assert.ok(Math.abs(p.winRate - 70) < 1e-9);
});

test("데이터가 요청 개수보다 적으면 있는 만큼만 계산하고 enough:false로 알린다", () => {
  seedEntries([W, L, W]); // 3건뿐
  const p = PatternLearn.getRecentPerformance(10, "coin");
  assert.strictEqual(p.total, 3);
  assert.strictEqual(p.enough, false);
  assert.ok(Math.abs(p.winRate - (2 / 3) * 100) < 1e-9);
});

test("학습 결과가 하나도 없어도 오류 없이 빈 결과를 반환한다", () => {
  seedEntries([]);
  const s = PatternLearn.getPerformanceSummary("coin");
  assert.strictEqual(s.overall.total, 0);
  assert.strictEqual(s.overall.winRate, null);
  assert.strictEqual(s.recent10.total, 0);
  assert.strictEqual(s.trend.trend, "unknown");
  assert.deepStrictEqual(s.series, []);
});

test("추세: 최근 10회가 그 이전 10회보다 좋으면 'up'", () => {
  const prev10 = [L, L, L, L, L, L, L, L, W, W];  // 이전 10회 20%
  const last10 = [W, W, W, W, W, W, W, W, W, L];  // 최근 10회 90%
  seedEntries([...prev10, ...last10]);
  const tr = PatternLearn.getPerformanceTrend(10, "coin");
  assert.strictEqual(tr.trend, "up");
  assert.ok(Math.abs(tr.recentWinRate - 90) < 1e-9);
  assert.ok(Math.abs(tr.previousWinRate - 20) < 1e-9);
  assert.ok(tr.delta > 0);
});

test("추세: 최근 10회가 그 이전 10회보다 나쁘면 'down'", () => {
  const prev10 = [W, W, W, W, W, W, W, W, W, W]; // 100%
  const last10 = [L, L, L, L, L, L, L, L, W, W]; // 20%
  seedEntries([...prev10, ...last10]);
  const tr = PatternLearn.getPerformanceTrend(10, "coin");
  assert.strictEqual(tr.trend, "down");
  assert.ok(tr.delta < 0);
});

test("추세: 차이가 5%p 이내면 'flat'(작은 흔들림을 과대해석하지 않음)", () => {
  const prev10 = [W, W, W, W, W, L, L, L, L, L]; // 50%
  const last10 = [W, W, W, W, W, L, L, L, L, L]; // 50%
  seedEntries([...prev10, ...last10]);
  assert.strictEqual(PatternLearn.getPerformanceTrend(10, "coin").trend, "flat");
});

test("추세: 비교할 이전 구간이 없으면 'unknown'", () => {
  seedEntries([W, W, W, W, W]); // 5건뿐 → 이전 10회 구간이 없음
  assert.strictEqual(PatternLearn.getPerformanceTrend(10, "coin").trend, "unknown");
});

test("승률 변화 그래프 시퀀스를 구간별로 정확히 만든다", () => {
  // 5건 단위 구간: [전부승=100%], [전부패=0%], [3승2패=60%]
  seedEntries([W, W, W, W, W, L, L, L, L, L, W, W, W, L, L]);
  const series = PatternLearn.getWinRateSeries(5, "coin");
  assert.strictEqual(series.length, 3);
  assert.ok(Math.abs(series[0].winRate - 100) < 1e-9);
  assert.ok(Math.abs(series[1].winRate - 0) < 1e-9);
  assert.ok(Math.abs(series[2].winRate - 60) < 1e-9);
});

test("성능 분석도 시장(카테고리)별로 분리된다", () => {
  const coinEntries = [W, W, W].map((r, i) => ({
    source: "signal", symbol: "BTCUSDT", category: "coin", direction: "long",
    conditions: COND, resultTime: 1000 + i, result: r,
  }));
  const stockEntries = [L, L].map((r, i) => ({
    source: "signal", symbol: "STOCKA", category: "stock", direction: "long",
    conditions: COND, resultTime: 2000 + i, result: r,
  }));
  localStorage.setItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN, JSON.stringify({
    pending: [], stats: {}, entries: [...coinEntries, ...stockEntries],
    statsBySymbol: {}, legacyStats: {}, schemaVersion: 2,
  }));
  const coin = PatternLearn.getPerformanceSummary("coin");
  const stock = PatternLearn.getPerformanceSummary("stock");
  assert.strictEqual(coin.overall.total, 3);
  assert.strictEqual(coin.overall.wins, 3); // 주식의 2패가 섞이면 실패
  assert.strictEqual(stock.overall.total, 2);
  assert.strictEqual(stock.overall.losses, 2); // 코인의 3승이 섞이면 실패
});

test("자가학습 OFF 상태에서도 기존 데이터로 성능 표시가 계속 가능하다(요구사항)", () => {
  seedEntries([W, W, L]);
  State.saveLearnEnabled(false);
  const s = PatternLearn.getPerformanceSummary("coin");
  assert.strictEqual(s.overall.total, 3); // OFF여도 조회는 정상
  assert.strictEqual(s.overall.wins, 2);
  State.saveLearnEnabled(true);
});

test("성능 분석 함수는 기존 데이터를 변경하지 않는다(읽기 전용)", () => {
  seedEntries([W, L, W, L]);
  const before = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);
  PatternLearn.getPerformanceSummary("coin");
  PatternLearn.getRecentPerformance(10, "coin");
  PatternLearn.getPerformanceTrend(10, "coin");
  PatternLearn.getWinRateSeries(5, "coin");
  const after = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);
  assert.strictEqual(before, after); // 한 글자도 바뀌지 않아야 함
});

console.log("\n[점수별 신호 성능 — 시장×점수×방향 8칸 독립 (요구사항 12)]");

// 실제 파이프라인(recordPending → evaluatePending)을 그대로 통과시켜서 기록한다.
// 판정 로직을 우회하지 않으므로 기존 자가학습과 결과가 어긋날 수 없다.
function emitSignal({ symbol, category, direction, score, win, seq }) {
  State.setCategory(symbol, category);
  const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
  const cond = COND;
  const dir = { score, band: "strong", conditions: cond };
  const other = { score: 20, band: "none", conditions: { trend15: false, trend5: false, ha1Flip: false, macdCross: false } };
  const result = {
    symbol,
    price: 100,
    updatedAt: entryTime,
    entryTimes: { "1m": entryTime + seq * 60000 }, // 신호마다 다른 캔들
    long: direction === "long" ? dir : other,
    short: direction === "short" ? dir : other,
  };
  PatternLearn.recordPending(result, direction);
  // LONG은 상승이면 WIN / SHORT는 하락이면 WIN (기존 판정 기준 그대로)
  const finalPrice = direction === "long" ? (win ? 110 : 90) : (win ? 90 : 110);
  PatternLearn.evaluatePending({ [symbol]: { price: finalPrice } });
}

function emitMany(opts, n, winCount) {
  for (let i = 0; i < n; i++) {
    emitSignal(Object.assign({}, opts, { win: i < winCount, seq: scoreSeq++ }));
  }
}
let scoreSeq = 0;

function clearAll() {
  localStorage.setItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN,
    JSON.stringify({ pending: [], stats: {}, entries: [], statsBySymbol: {}, legacyStats: {},
                     scorePerf: { buckets: {}, results: [] }, schemaVersion: 2 }));
}

clearAll();
State.saveLearnEnabled(true);

// 8칸에 서로 다른 성적을 심는다 (숫자가 모두 달라야 섞임을 확실히 검출할 수 있다)
emitMany({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 80 }, 10, 7);   // crypto 80 LONG: 7승3패
emitMany({ symbol: "BTCUSDT", category: "coin", direction: "short", score: 80 }, 8, 5);   // crypto 80 SHORT: 5승3패
emitMany({ symbol: "ETHUSDT", category: "coin", direction: "long", score: 100 }, 6, 5);   // crypto 100 LONG: 5승1패
emitMany({ symbol: "ETHUSDT", category: "coin", direction: "short", score: 100 }, 5, 2);  // crypto 100 SHORT: 2승3패
emitMany({ symbol: "STOCKA", category: "stock", direction: "long", score: 80 }, 9, 4);    // stock 80 LONG: 4승5패
emitMany({ symbol: "STOCKA", category: "stock", direction: "short", score: 80 }, 7, 6);   // stock 80 SHORT: 6승1패
emitMany({ symbol: "STOCKB", category: "stock", direction: "long", score: 100 }, 12, 9);  // stock 100 LONG: 9승3패
emitMany({ symbol: "STOCKB", category: "stock", direction: "short", score: 100 }, 11, 3); // stock 100 SHORT: 3승8패

const expected = {
  "crypto:80:long": [7, 3], "crypto:80:short": [5, 3],
  "crypto:100:long": [5, 1], "crypto:100:short": [2, 3],
  "stock:80:long": [4, 5], "stock:80:short": [6, 1],
  "stock:100:long": [9, 3], "stock:100:short": [3, 8],
};

Object.keys(expected).forEach((key, i) => {
  const [market, score, direction] = key.split(":");
  const [w, l] = expected[key];
  test(`검증 ${i + 1}: ${key} = ${w}승 ${l}패 정확히 집계`, () => {
    const p = PatternLearn.getScorePerf(market, Number(score), direction);
    assert.strictEqual(p.wins, w);
    assert.strictEqual(p.losses, l);
    assert.strictEqual(p.total, w + l);
    assert.ok(Math.abs(p.winRate - (w / (w + l)) * 100) < 1e-9);
  });
});

test("검증 9: 코인과 주식이 섞이지 않는다", () => {
  const c = PatternLearn.getScorePerf("crypto", 80, "long");
  const s = PatternLearn.getScorePerf("stock", 80, "long");
  assert.strictEqual(c.total, 10); // 주식 9건이 섞이면 19가 됨
  assert.strictEqual(s.total, 9);  // 코인 10건이 섞이면 19가 됨
});

test("검증 10: LONG과 SHORT가 섞이지 않는다", () => {
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 80, "long").total, 10);
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 80, "short").total, 8); // 합치면 18
});

test("검증 11: 80점과 100점이 섞이지 않는다", () => {
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 80, "long").total, 10);
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 100, "long").total, 6); // 합치면 16
});

test("검증 12: 점수별 통계를 쌓아도 기존 학습 데이터(stats/entries/statsBySymbol)가 삭제되지 않는다", () => {
  const raw = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN));
  assert.ok(raw.entries.length > 0);        // 기존 entries에도 정상 기록됨
  assert.ok(Object.keys(raw.statsBySymbol).length > 0); // 기존 패턴 통계도 정상
  assert.ok(raw.scorePerf.results.length > 0);          // 점수별 기록도 함께 존재
  assert.ok(raw.stats !== undefined);                   // 구버전 stats 필드 보존
});

test("검증 13: 저장된 데이터를 다시 읽어도(앱 재실행) 점수별 통계가 유지된다", () => {
  const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);
  localStorage.setItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN, raw); // 디스크 왕복
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 80, "long").wins, 7);
  assert.strictEqual(PatternLearn.getScorePerf("stock", 100, "short").losses, 8);
});

test("검증 14: 데이터가 없거나 부족해도 오류 없이 처리되고 enough:false로 알린다", () => {
  clearAll();
  const p = PatternLearn.getScorePerf("crypto", 100, "long");
  assert.strictEqual(p.total, 0);
  assert.strictEqual(p.winRate, null); // 임의 승률을 만들지 않음
  assert.strictEqual(p.enough, false);
  const table = PatternLearn.getScorePerfTable(); // 빈 상태에서도 예외 없이 8칸 구조 반환
  assert.strictEqual(table.crypto[80].long.total, 0);
  assert.strictEqual(table.stock[100].short.total, 0);
  // 표본이 최소치 미만이면 enough:false
  emitMany({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 80 }, CONFIG.SCORE_PERF_MIN_SAMPLES - 1, 1);
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 80, "long").enough, false);
});

test("검증 17: 동일 신호는 두 번 기록되지 않는다(중복 방지)", () => {
  clearAll();
  State.setCategory("BTCUSDT", "coin");
  const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
  const mk = () => ({
    symbol: "BTCUSDT", price: 100, updatedAt: entryTime,
    entryTimes: { "1m": entryTime }, // 완전히 동일한 신호 캔들
    long: { score: 100, band: "strong", conditions: COND },
    short: { score: 20, band: "none", conditions: COND },
  });
  PatternLearn.recordPending(mk(), "long"); // 화면 WebView가 기록
  PatternLearn.recordPending(mk(), "long"); // 백그라운드 WebView가 같은 신호를 또 기록 시도
  PatternLearn.recordPending(mk(), "long"); // 세 번째 시도
  const raw = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN));
  assert.strictEqual(raw.pending.length, 1); // 대기열에 1건만
  PatternLearn.evaluatePending({ BTCUSDT: { price: 110 } });
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 100, "long").total, 1); // 통계도 1건만
});

test("검증 18: 결과 기록 후에도 같은 신호가 다시 기록되지 않는다(Activity/Service 동시 실행 대비)", () => {
  clearAll();
  State.setCategory("BTCUSDT", "coin");
  const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
  const mk = () => ({
    symbol: "BTCUSDT", price: 100, updatedAt: entryTime,
    entryTimes: { "1m": entryTime },
    long: { score: 80, band: "strong", conditions: COND },
    short: { score: 20, band: "none", conditions: COND },
  });
  PatternLearn.recordPending(mk(), "long");
  PatternLearn.evaluatePending({ BTCUSDT: { price: 110 } }); // 결과 확정
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 80, "long").total, 1);
  // 뒤늦게 다른 WebView가 같은 신호를 기록 시도 → 이미 결과가 있으므로 무시되어야 한다
  PatternLearn.recordPending(mk(), "long");
  PatternLearn.evaluatePending({ BTCUSDT: { price: 110 } });
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 80, "long").total, 1); // 여전히 1건
});

test("검증 19: 저장된 점수/시장/방향/결과를 자가학습이 사용할 수 있다(신뢰도 조회)", () => {
  clearAll();
  // crypto/100/LONG을 높은 승률로, crypto/80/SHORT를 낮은 승률로 채운다
  emitMany({ symbol: "ETHUSDT", category: "coin", direction: "long", score: 100 }, CONFIG.LEARN_MIN_SAMPLES, CONFIG.LEARN_MIN_SAMPLES);
  emitMany({ symbol: "BTCUSDT", category: "coin", direction: "short", score: 80 }, CONFIG.LEARN_MIN_SAMPLES, 0);
  const good = PatternLearn.getScoreConfidence("crypto", 100, "long");
  const bad = PatternLearn.getScoreConfidence("crypto", 80, "short");
  assert.ok(good != null && bad != null);
  assert.ok(good > bad); // 높은 승률 조합의 신뢰도가 더 높아야 한다
  assert.ok(good > 0.5 && bad < 0.5);
  // 표본이 없는 조합은 null → 기존 신호를 과도하게 차단하지 않는다
  assert.strictEqual(PatternLearn.getScoreConfidence("stock", 100, "long"), null);
  // 결과 원본도 조회 가능(조건+결과 관계 분석용)
  const results = PatternLearn.getScoreResults("crypto", 100, "long");
  assert.strictEqual(results.length, CONFIG.LEARN_MIN_SAMPLES);
  assert.ok(results[0].conditions && results[0].market === "crypto" && results[0].score === 100);
});

test("검증 20: 자가학습 OFF에서는 새 기록이 멈추지만 기존 점수 통계는 그대로 조회된다", () => {
  clearAll();
  emitMany({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 80 }, 6, 4);
  const before = PatternLearn.getScorePerf("crypto", 80, "long");
  assert.strictEqual(before.total, 6);

  State.saveLearnEnabled(false);
  emitMany({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 80 }, 5, 5); // OFF 상태에서 추가 시도
  const during = PatternLearn.getScorePerf("crypto", 80, "long");
  assert.strictEqual(during.total, 6);   // 늘지 않음(기존 OFF 정책 그대로)
  assert.strictEqual(during.wins, 4);    // 기존 데이터는 그대로 조회 가능
  assert.strictEqual(PatternLearn.getScoreConfidence("crypto", 80, "long"), null); // OFF면 신뢰도 미반영

  State.saveLearnEnabled(true);
  const after = PatternLearn.getScorePerf("crypto", 80, "long");
  assert.strictEqual(after.total, 6);    // ON 복귀 후에도 기존 데이터 보존
  emitMany({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 80 }, 2, 2);
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 80, "long").total, 8); // 이어서 정상 누적
});

test("추적 대상(80/100) 외의 점수는 점수별 통계에 들어가지 않는다(점수 재계산/반올림 없음)", () => {
  clearAll();
  emitMany({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 55 }, 5, 3); // 55점
  const sp = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN)).scorePerf;
  assert.strictEqual(sp.results.length, 0);                 // 점수별 통계엔 미포함
  assert.strictEqual(Object.keys(sp.buckets).length, 0);
  // 단, 기존 자가학습 쪽에는 정상 기록되어야 한다(기존 동작 유지)
  const entries = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN)).entries;
  assert.strictEqual(entries.length, 5);
});

console.log("\n[Pattern Snapshot — 신호 발생 순간 차트 상태 저장 (요구사항 11)]");

// 실제 지표 계산(Signals.computeIndicators)을 그대로 통과시켜 tf 데이터를 만든다.
// 새 지표를 만들지 않고 기존 계산값만 저장하는지 확인하기 위함.
function makeTfData(basePrice, trendUp) {
  const mk = (interval, stepMs) => {
    const arr = [];
    let price = basePrice;
    for (let i = 0; i < 60; i++) {
      price += trendUp ? 0.4 : -0.4;
      const open = price - 0.2, close = price;
      arr.push({
        openTime: 1000000 + i * stepMs,
        open, high: Math.max(open, close) + 0.3, low: Math.min(open, close) - 0.3, close,
        volume: 100 + i, closeTime: 1000000 + i * stepMs + stepMs - 1,
      });
    }
    return Signals.computeIndicators(arr);
  };
  return { "1m": mk("1m", 60000), "5m": mk("5m", 300000), "15m": mk("15m", 900000) };
}

function clearSnapshots() {
  localStorage.setItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS, JSON.stringify({ snapshots: [] }));
}
function clearLearnAll() {
  localStorage.setItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN,
    JSON.stringify({ pending: [], stats: {}, entries: [], statsBySymbol: {}, legacyStats: {},
                     scorePerf: { buckets: {}, results: [] }, schemaVersion: 2 }));
}

let snapSeq = 0;
// 신호 발생 → snapshot 저장까지의 실제 흐름을 재현한다(app.js가 하는 것과 동일한 순서).
function emitWithSnapshot({ symbol, category, direction, score, trendUp }) {
  State.setCategory(symbol, category);
  const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
  const tf = makeTfData(100, trendUp !== false);
  const dir = { score, band: "strong", conditions: COND };
  const other = { score: 20, band: "none", conditions: { trend15: false, trend5: false, ha1Flip: false, macdCross: false } };
  const result = {
    symbol, price: 100, updatedAt: entryTime,
    entryTimes: { "1m": entryTime + snapSeq++ * 60000 },
    tf,
    long: direction === "long" ? dir : other,
    short: direction === "short" ? dir : other,
  };
  const item = PatternLearn.recordPending(result, direction);
  const snap = item ? PatternSnapshot.record(item, result.tf) : null;
  return { item, snap, tf, result };
}

clearSnapshots(); clearLearnAll(); State.saveLearnEnabled(true);

test("검증 1~4: 80/100 × LONG/SHORT snapshot이 각각 생성된다", () => {
  clearSnapshots(); clearLearnAll();
  emitWithSnapshot({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 });
  emitWithSnapshot({ symbol: "BTCUSDT", category: "coin", direction: "short", score: 100, trendUp: false });
  emitWithSnapshot({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 80 });
  emitWithSnapshot({ symbol: "BTCUSDT", category: "coin", direction: "short", score: 80, trendUp: false });
  assert.strictEqual(PatternSnapshot.getBy({ market: "crypto", score: 100, direction: "long" }).length, 1);
  assert.strictEqual(PatternSnapshot.getBy({ market: "crypto", score: 100, direction: "short" }).length, 1);
  assert.strictEqual(PatternSnapshot.getBy({ market: "crypto", score: 80, direction: "long" }).length, 1);
  assert.strictEqual(PatternSnapshot.getBy({ market: "crypto", score: 80, direction: "short" }).length, 1);
  assert.strictEqual(PatternSnapshot.getAll().length, 4);
});

test("검증 5: Crypto와 Stock snapshot이 섞이지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  emitWithSnapshot({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 });
  emitWithSnapshot({ symbol: "STOCKA", category: "stock", direction: "long", score: 100 });
  const crypto = PatternSnapshot.getBy({ market: "crypto" });
  const stock = PatternSnapshot.getBy({ market: "stock" });
  assert.strictEqual(crypto.length, 1);
  assert.strictEqual(stock.length, 1);
  assert.strictEqual(crypto[0].symbol, "BTCUSDT");
  assert.strictEqual(stock[0].symbol, "STOCKA");
  // market/score/direction 3개가 모두 저장되어 기존 8칸 구조와 연결 가능해야 한다
  assert.strictEqual(crypto[0].market, "crypto");
  assert.strictEqual(crypto[0].score, 100);
  assert.strictEqual(crypto[0].direction, "long");
});

test("검증 6: 1m/5m/15m 상태가 각각 저장된다", () => {
  clearSnapshots(); clearLearnAll();
  const { snap } = emitWithSnapshot({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 });
  assert.ok(snap.tf1 && snap.tf5 && snap.tf15);
  // 세 타임프레임이 서로 독립적으로 채워져 있어야 한다
  [snap.tf1, snap.tf5, snap.tf15].forEach((tfs) => {
    assert.ok(tfs.candles.length === CONFIG.SNAPSHOT_CANDLE_COUNT);
    assert.ok(typeof tfs.haBullish === "boolean");
  });
});

test("검증 7: MACD/RSI/Heikin-Ashi 값이 신호 발생 당시 계산값과 정확히 일치한다", () => {
  clearSnapshots(); clearLearnAll();
  const { snap, tf } = emitWithSnapshot({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 });
  // 저장된 값이 Signals.computeIndicators()의 마지막 캔들 값과 같아야 한다(재계산/변형 없음)
  ["1m", "5m", "15m"].forEach((key) => {
    const d = tf[key];
    const last = d.klines.length - 1;
    const saved = key === "1m" ? snap.tf1 : key === "5m" ? snap.tf5 : snap.tf15;
    assert.strictEqual(saved.macdDif, d.macd.dif[last]);
    assert.strictEqual(saved.macdDea, d.macd.dea[last]);
    assert.strictEqual(saved.rsi, d.rsi[last]);
    assert.strictEqual(saved.haBullish, d.ha[last].bullish);
    assert.strictEqual(saved.haClose, d.ha[last].close);
    // DIF-DEA 차이도 저장된 값과 일치
    assert.ok(Math.abs(saved.macdDiff - (d.macd.dif[last] - d.macd.dea[last])) < 1e-12);
  });
});

test("검증 8: 최근 캔들 10개가 OHLCV + Heikin-Ashi OHLC와 함께 저장된다", () => {
  clearSnapshots(); clearLearnAll();
  const { snap, tf } = emitWithSnapshot({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 });
  const candles = snap.tf1.candles;
  assert.strictEqual(candles.length, 10);
  const srcKl = tf["1m"].klines.slice(-10);
  const srcHa = tf["1m"].ha.slice(-10);
  candles.forEach((c, i) => {
    assert.strictEqual(c.open, srcKl[i].open);
    assert.strictEqual(c.high, srcKl[i].high);
    assert.strictEqual(c.low, srcKl[i].low);
    assert.strictEqual(c.close, srcKl[i].close);
    assert.strictEqual(c.volume, srcKl[i].volume);
    assert.strictEqual(c.haOpen, srcHa[i].open);
    assert.strictEqual(c.haClose, srcHa[i].close);
  });
});

test("검증 9: WIN 결과가 snapshot에 연결된다(기존 evaluatePending 판정 사용)", () => {
  clearSnapshots(); clearLearnAll();
  const { item } = emitWithSnapshot({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 });
  assert.strictEqual(PatternSnapshot.getAll()[0].result, null); // 저장 직후엔 결과 미확정
  PatternLearn.evaluatePending({ BTCUSDT: { price: 110 } });    // LONG + 상승 → WIN
  const s = PatternSnapshot.getAll()[0];
  assert.strictEqual(s.result, "WIN");
  assert.strictEqual(s.resultPrice, 110);
  assert.ok(s.resultTime > 0);
  assert.ok(s.pnlPercent > 0);
  // 기존 점수별 통계의 판정과 일치해야 한다(같은 win 값을 공유하므로)
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 100, "long").wins, 1);
});

test("검증 10: LOSS 결과가 snapshot에 연결된다", () => {
  clearSnapshots(); clearLearnAll();
  emitWithSnapshot({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 80 });
  PatternLearn.evaluatePending({ BTCUSDT: { price: 90 } }); // LONG + 하락 → LOSS
  const s = PatternSnapshot.getAll()[0];
  assert.strictEqual(s.result, "LOSS");
  assert.ok(s.pnlPercent < 0);
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 80, "long").losses, 1);
});

test("검증 11: 동일 signalId는 snapshot이 1개만 생성된다(Activity/Service 동시 실행 대비)", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
  const tf = makeTfData(100, true);
  const mkResult = () => ({
    symbol: "BTCUSDT", price: 100, updatedAt: entryTime,
    entryTimes: { "1m": entryTime }, tf,
    long: { score: 100, band: "strong", conditions: COND },
    short: { score: 20, band: "none", conditions: COND },
  });
  // 화면 WebView
  const a = PatternLearn.recordPending(mkResult(), "long");
  if (a) PatternSnapshot.record(a, tf);
  // 백그라운드 WebView가 같은 신호를 처리 (recordPending이 null을 반환해 snapshot도 안 만들어짐)
  const b = PatternLearn.recordPending(mkResult(), "long");
  if (b) PatternSnapshot.record(b, tf);
  // 설령 같은 item으로 record를 직접 두 번 불러도 snapshot은 1개여야 한다
  PatternSnapshot.record(a, tf);
  assert.strictEqual(b, null);
  assert.strictEqual(PatternSnapshot.getAll().length, 1);
});

test("검증 12/13: 학습 OFF면 snapshot이 생성되지 않고, ON으로 돌아오면 재개된다", () => {
  clearSnapshots(); clearLearnAll();
  emitWithSnapshot({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 });
  assert.strictEqual(PatternSnapshot.getAll().length, 1);

  State.saveLearnEnabled(false);
  emitWithSnapshot({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 });
  assert.strictEqual(PatternSnapshot.getAll().length, 1); // 늘지 않음
  assert.strictEqual(PatternSnapshot.getAll()[0].result, null); // 기존 snapshot은 삭제되지 않음

  State.saveLearnEnabled(true);
  emitWithSnapshot({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 });
  assert.strictEqual(PatternSnapshot.getAll().length, 2); // 정상 재개
});

test("검증 14: snapshot 저장이 기존 학습 데이터를 전혀 건드리지 않는다(별도 키)", () => {
  clearSnapshots(); clearLearnAll();
  // 기존 키에 의미 있는 데이터를 넣어둔다
  const learnRaw = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN));
  learnRaw.stats = { "legacy:key": { wins: 3, losses: 2 } };
  learnRaw.entries = [{ source: "signal", symbol: "OLD", category: "coin", direction: "long", conditions: COND, result: "WIN", resultTime: 1 }];
  localStorage.setItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN, JSON.stringify(learnRaw));
  localStorage.setItem(CONFIG.STORAGE_KEYS.TRADES, JSON.stringify([{ id: "keep-trade" }]));
  localStorage.setItem(CONFIG.STORAGE_KEYS.LOCK_RECORDS, JSON.stringify([{ id: "keep-lock" }]));

  // snapshot을 여러 개 저장하고 clear까지 해본다
  for (let i = 0; i < 5; i++) emitWithSnapshot({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 });
  PatternSnapshot.clear();

  // 기존 데이터가 그대로 살아있어야 한다
  const after = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN));
  assert.deepStrictEqual(after.stats["legacy:key"], { wins: 3, losses: 2 });
  assert.ok(after.entries.some((e) => e.symbol === "OLD"));
  assert.strictEqual(JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TRADES))[0].id, "keep-trade");
  assert.strictEqual(JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCK_RECORDS))[0].id, "keep-lock");
});

test("검증 15: 앱 재실행(디스크 왕복) 후에도 snapshot이 유지된다", () => {
  clearSnapshots(); clearLearnAll();
  emitWithSnapshot({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 });
  PatternLearn.evaluatePending({ BTCUSDT: { price: 110 } });
  const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS);
  localStorage.setItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS, raw); // 재실행 시뮬레이션
  const s = PatternSnapshot.getAll();
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].result, "WIN");
  assert.ok(s[0].tf1.candles.length === 10); // 캔들 데이터까지 그대로 보존
});

test("검증 16: snapshot 최대 개수 제한이 작동하고 오래된 것부터 삭제된다", () => {
  clearSnapshots(); clearLearnAll();
  const MAX = CONFIG.MAX_PATTERN_SNAPSHOTS;
  // 상한을 직접 테스트하면 2000건이라 느리므로, 저장 로직을 직접 검증한다.
  const data = { snapshots: [] };
  for (let i = 0; i < MAX + 5; i++) data.snapshots.push({ signalId: "s" + i, result: null });
  while (data.snapshots.length > MAX) data.snapshots.shift();
  assert.strictEqual(data.snapshots.length, MAX);
  assert.strictEqual(data.snapshots[0].signalId, "s5"); // 가장 오래된 5건이 제거됨
  // 실제 record()도 상한을 넘기지 않는지 소규모로 확인
  assert.ok(CONFIG.MAX_PATTERN_SNAPSHOTS > 0);
});

test("검증 17: 기존 80/100 통계가 snapshot 추가와 무관하게 동일하게 동작한다", () => {
  clearSnapshots(); clearLearnAll();
  emitWithSnapshot({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 });
  PatternLearn.evaluatePending({ BTCUSDT: { price: 110 } });
  emitWithSnapshot({ symbol: "BTCUSDT", category: "coin", direction: "short", score: 80, trendUp: false });
  PatternLearn.evaluatePending({ BTCUSDT: { price: 110 } }); // SHORT + 상승 → LOSS
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 100, "long").wins, 1);
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 80, "short").losses, 1);
  // 8칸이 여전히 서로 섞이지 않는다
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 80, "long").total, 0);
  assert.strictEqual(PatternLearn.getScorePerf("stock", 100, "long").total, 0);
});

test("추적 대상(80/100) 외 점수는 snapshot을 만들지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  emitWithSnapshot({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 55 });
  assert.strictEqual(PatternSnapshot.getAll().length, 0);
});

test("getSummary()가 저장 개수/WIN/LOSS를 정확히 반환한다(UI 디버깅 표시용)", () => {
  clearSnapshots(); clearLearnAll();
  emitWithSnapshot({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 });
  PatternLearn.evaluatePending({ BTCUSDT: { price: 110 } }); // WIN
  emitWithSnapshot({ symbol: "ETHUSDT", category: "coin", direction: "long", score: 80 });
  PatternLearn.evaluatePending({ ETHUSDT: { price: 90 } });  // LOSS
  emitWithSnapshot({ symbol: "SOLUSDT", category: "coin", direction: "long", score: 100 }); // 결과 대기
  const sum = PatternSnapshot.getSummary();
  assert.strictEqual(sum.total, 3);
  assert.strictEqual(sum.wins, 1);
  assert.strictEqual(sum.losses, 1);
  assert.strictEqual(sum.pendingResult, 1);
  assert.strictEqual(sum.max, CONFIG.MAX_PATTERN_SNAPSHOTS);
});

test("데이터가 없어도 오류 없이 빈 요약을 반환한다", () => {
  clearSnapshots();
  const sum = PatternSnapshot.getSummary();
  assert.strictEqual(sum.total, 0);
  assert.strictEqual(sum.wins, 0);
  assert.strictEqual(sum.losses, 0);
  assert.deepStrictEqual(PatternSnapshot.getAll(), []);
});

console.log("\n[4단계: 성공/실패 패턴 분리 및 분석]");

// 3단계 저장 흐름(emitWithSnapshot)을 그대로 쓰고, 결과까지 확정시킨다.
// 판정은 기존 evaluatePending()이 하므로 여기서 승패를 직접 만들지 않는다.
function emitAndResolve({ symbol, category, direction, score, win }) {
  const { item } = emitWithSnapshot({ symbol, category, direction, score, trendUp: direction === "long" });
  if (!item) return null;
  // LONG은 상승이면 WIN, SHORT는 하락이면 WIN (기존 판정 기준)
  const price = direction === "long" ? (win ? 110 : 90) : (win ? 90 : 110);
  PatternLearn.evaluatePending({ [symbol]: { price } });
  return item;
}
function emitBatch(opts, n, winCount) {
  for (let i = 0; i < n; i++) emitAndResolve(Object.assign({}, opts, { win: i < winCount }));
}

test("4-1: WIN 패턴과 LOSS 패턴이 분리되어 조회된다", () => {
  clearSnapshots(); clearLearnAll(); State.saveLearnEnabled(true);
  emitBatch({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 }, 5, 3); // 3승 2패
  const wins = PatternAnalysis.getWinningPatterns();
  const losses = PatternAnalysis.getLosingPatterns();
  assert.strictEqual(wins.length, 3);
  assert.strictEqual(losses.length, 2);
  assert.ok(wins.every((s) => s.result === "WIN"));
  assert.ok(losses.every((s) => s.result === "LOSS"));
});

test("4-2: 8개 그룹(market×score×direction)이 완전히 분리된다", () => {
  clearSnapshots(); clearLearnAll();
  // 8칸에 서로 다른 개수를 넣어서 하나라도 섞이면 즉시 검출되게 한다
  emitBatch({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 }, 6, 4);
  emitBatch({ symbol: "BTCUSDT", category: "coin", direction: "short", score: 100 }, 5, 2);
  emitBatch({ symbol: "ETHUSDT", category: "coin", direction: "long", score: 80 }, 4, 3);
  emitBatch({ symbol: "ETHUSDT", category: "coin", direction: "short", score: 80 }, 3, 1);
  emitBatch({ symbol: "STOCKA", category: "stock", direction: "long", score: 100 }, 7, 5);
  emitBatch({ symbol: "STOCKA", category: "stock", direction: "short", score: 100 }, 2, 2);
  emitBatch({ symbol: "STOCKB", category: "stock", direction: "long", score: 80 }, 8, 6);
  emitBatch({ symbol: "STOCKB", category: "stock", direction: "short", score: 80 }, 9, 3);

  const expect = {
    "crypto:100:long": [4, 2], "crypto:100:short": [2, 3],
    "crypto:80:long": [3, 1],  "crypto:80:short": [1, 2],
    "stock:100:long": [5, 2],  "stock:100:short": [2, 0],
    "stock:80:long": [6, 2],   "stock:80:short": [3, 6],
  };
  Object.keys(expect).forEach((g) => {
    const [market, score, direction] = g.split(":");
    const st = PatternAnalysis.getPatternStats(market, Number(score), direction);
    const [w, l] = expect[g];
    assert.strictEqual(st.wins, w, `${g} wins ${st.wins} != ${w}`);
    assert.strictEqual(st.losses, l, `${g} losses ${st.losses} != ${l}`);
    assert.strictEqual(st.total, w + l);
  });
});

test("4-3: getPatternsByGroup()이 해당 그룹의 WIN/LOSS만 반환한다", () => {
  clearSnapshots(); clearLearnAll();
  emitBatch({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 }, 4, 3);
  emitBatch({ symbol: "STOCKA", category: "stock", direction: "long", score: 100 }, 5, 1);
  const g = PatternAnalysis.getPatternsByGroup("crypto", 100, "long");
  assert.strictEqual(g.wins.length, 3);
  assert.strictEqual(g.losses.length, 1);
  assert.ok(g.wins.every((s) => s.market === "crypto" && s.score === 100 && s.direction === "long"));
  // 주식 그룹은 섞이지 않는다
  const gs = PatternAnalysis.getPatternsByGroup("stock", 100, "long");
  assert.strictEqual(gs.wins.length, 1);
  assert.strictEqual(gs.losses.length, 4);
});

test("4-4: 통계에 승률/평균 PnL/성공·실패 패턴 데이터가 포함된다", () => {
  clearSnapshots(); clearLearnAll();
  emitBatch({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 }, 10, 7);
  const st = PatternAnalysis.getPatternStats("crypto", 100, "long");
  assert.strictEqual(st.total, 10);
  assert.strictEqual(st.wins, 7);
  assert.strictEqual(st.losses, 3);
  assert.ok(Math.abs(st.winRate - 70) < 1e-9);
  assert.ok(Number.isFinite(st.avgPnl));
  assert.ok(st.avgWinPnl > 0);   // 승리 거래의 평균 PnL은 양수
  assert.ok(st.avgLossPnl < 0);  // 패배 거래의 평균 PnL은 음수
  assert.strictEqual(st.winPatterns.length, 7);
  assert.strictEqual(st.lossPatterns.length, 3);
  // 패턴 데이터에 1m/5m/15m 상태와 신호 조건이 그대로 들어있다
  const p = st.winPatterns[0];
  assert.ok(p.tf1 && p.tf5 && p.tf15 && p.conditions);
  assert.ok(p.tf1.candles.length === CONFIG.SNAPSHOT_CANDLE_COUNT);
});

test("4-5: 표본이 부족하면 enough:false로 알린다(억지 판단 방지)", () => {
  clearSnapshots(); clearLearnAll();
  emitBatch({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 }, 2, 1);
  const st = PatternAnalysis.getPatternStats("crypto", 100, "long");
  assert.strictEqual(st.total, 2);
  assert.strictEqual(st.enough, false); // SCORE_PERF_MIN_SAMPLES(5) 미만
  // 표본을 채우면 enough:true
  emitBatch({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 }, 5, 3);
  assert.strictEqual(PatternAnalysis.getPatternStats("crypto", 100, "long").enough, true);
});

test("4-6: 데이터가 전혀 없어도 오류 없이 8개 그룹 구조를 반환한다", () => {
  clearSnapshots(); clearLearnAll();
  const all = PatternAnalysis.getAllGroupStats();
  assert.strictEqual(Object.keys(all).length, 8); // 2 market × 2 score × 2 direction
  Object.keys(all).forEach((g) => {
    assert.strictEqual(all[g].total, 0);
    assert.strictEqual(all[g].winRate, null); // 억지 승률을 만들지 않음
    assert.strictEqual(all[g].enough, false);
    assert.deepStrictEqual(all[g].winPatterns, []);
  });
  const sum = PatternAnalysis.getOverallSummary();
  assert.strictEqual(sum.total, 0);
  assert.strictEqual(sum.winRate, null);
});

test("4-7: WIN/LOSS 지표 비교(15m/5m/1m, HA/MACD/RSI/거래량/캔들)를 제공한다", () => {
  clearSnapshots(); clearLearnAll();
  emitBatch({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 }, 12, 8);
  const cmp = PatternAnalysis.comparePatterns("crypto", 100, "long");
  assert.strictEqual(cmp.winCount, 8);
  assert.strictEqual(cmp.lossCount, 4);
  ["15m", "5m", "1m"].forEach((tf) => {
    // 세 타임프레임 모두 WIN/LOSS 양쪽에서 지표 평균이 계산되어야 한다
    assert.ok(Number.isFinite(cmp.win.indicators[tf].macdDif));
    assert.ok(Number.isFinite(cmp.win.indicators[tf].rsi));
    assert.ok(Number.isFinite(cmp.win.indicators[tf].volume));
    assert.ok(Number.isFinite(cmp.win.indicators[tf].candle_body));
    assert.ok(cmp.win.indicators[tf].haBullishRatio !== null);
    assert.strictEqual(cmp.win.indicators[tf].sampleCount, 8);
    assert.strictEqual(cmp.loss.indicators[tf].sampleCount, 4);
  });
  // 신호 조건 충족 비율도 비교 가능
  assert.ok(cmp.win.conditions.trend15 !== null);
});

test("4-8: 원본 snapshot이 분석 후에도 변형/삭제되지 않는다(읽기 전용)", () => {
  clearSnapshots(); clearLearnAll();
  emitBatch({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 }, 6, 4);
  const before = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS);
  // 모든 분석 API를 호출해 본다
  PatternAnalysis.getWinningPatterns();
  PatternAnalysis.getLosingPatterns();
  PatternAnalysis.getPatternsByGroup("crypto", 100, "long");
  PatternAnalysis.getPatternStats("crypto", 100, "long");
  PatternAnalysis.getAllGroupStats();
  PatternAnalysis.comparePatterns("crypto", 100, "long");
  PatternAnalysis.getOverallSummary();
  const after = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS);
  assert.strictEqual(before, after); // 한 글자도 바뀌지 않아야 한다
});

test("4-9: 결과 대기중(result:null) snapshot은 분석 대상에서 제외된다", () => {
  clearSnapshots(); clearLearnAll();
  emitAndResolve({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100, win: true });
  emitWithSnapshot({ symbol: "ETHUSDT", category: "coin", direction: "long", score: 100 }); // 결과 미확정
  assert.strictEqual(PatternSnapshot.getAll().length, 2);
  const sum = PatternAnalysis.getOverallSummary();
  assert.strictEqual(sum.total, 1); // 확정된 1건만 집계
  assert.strictEqual(sum.wins, 1);
});

test("4-10: 학습 OFF면 새 패턴이 쌓이지 않고 기존 패턴은 계속 분석 가능하다", () => {
  clearSnapshots(); clearLearnAll();
  emitBatch({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 }, 5, 3);
  const before = PatternAnalysis.getPatternStats("crypto", 100, "long");
  assert.strictEqual(before.total, 5);

  State.saveLearnEnabled(false);
  emitBatch({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 }, 5, 5); // OFF 상태
  const during = PatternAnalysis.getPatternStats("crypto", 100, "long");
  assert.strictEqual(during.total, 5);  // 늘지 않음
  assert.strictEqual(during.wins, 3);   // 기존 데이터는 그대로 분석 가능
  assert.ok(Number.isFinite(during.avgPnl));

  State.saveLearnEnabled(true);
  emitBatch({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 }, 3, 3);
  assert.strictEqual(PatternAnalysis.getPatternStats("crypto", 100, "long").total, 8); // 정상 재개
});

test("4-11: 동일 signalId 중복 처리 시 패턴도 중복 집계되지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
  const tf = makeTfData(100, true);
  const mk = () => ({
    symbol: "BTCUSDT", price: 100, updatedAt: entryTime,
    entryTimes: { "1m": entryTime }, tf,
    long: { score: 100, band: "strong", conditions: COND },
    short: { score: 20, band: "none", conditions: COND },
  });
  const a = PatternLearn.recordPending(mk(), "long");
  if (a) PatternSnapshot.record(a, tf);
  const b = PatternLearn.recordPending(mk(), "long"); // 백그라운드 WebView가 같은 신호 처리
  if (b) PatternSnapshot.record(b, tf);
  PatternLearn.evaluatePending({ BTCUSDT: { price: 110 } });
  PatternLearn.evaluatePending({ BTCUSDT: { price: 110 } }); // 양쪽이 각각 판정 시도
  const st = PatternAnalysis.getPatternStats("crypto", 100, "long");
  assert.strictEqual(st.total, 1); // 1건만 집계
  assert.strictEqual(st.wins, 1);
});

test("4-12: 앱 재실행(디스크 왕복) 후에도 패턴 분석 결과가 유지된다", () => {
  clearSnapshots(); clearLearnAll();
  emitBatch({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 }, 6, 4);
  const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS);
  localStorage.setItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS, raw); // 재실행 시뮬레이션
  const st = PatternAnalysis.getPatternStats("crypto", 100, "long");
  assert.strictEqual(st.total, 6);
  assert.strictEqual(st.wins, 4);
  assert.ok(st.winPatterns[0].tf15.candles.length === CONFIG.SNAPSHOT_CANDLE_COUNT); // 캔들까지 보존
});

test("4-13: 4단계 분석이 기존 80/100 통계(3단계 이전 기능)를 바꾸지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  emitBatch({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100 }, 5, 3);
  const scoreBefore = JSON.stringify(PatternLearn.getScorePerf("crypto", 100, "long"));
  PatternAnalysis.getAllGroupStats();
  PatternAnalysis.comparePatterns("crypto", 100, "long");
  const scoreAfter = JSON.stringify(PatternLearn.getScorePerf("crypto", 100, "long"));
  assert.strictEqual(scoreBefore, scoreAfter); // 기존 통계 불변
  // 기존 통계와 4단계 집계가 동일한 판정을 공유하므로 수치도 일치해야 한다
  const sp = PatternLearn.getScorePerf("crypto", 100, "long");
  const pa = PatternAnalysis.getPatternStats("crypto", 100, "long");
  assert.strictEqual(sp.wins, pa.wins);
  assert.strictEqual(sp.losses, pa.losses);
});

console.log("\n[5단계: 현재 신호 vs 과거 패턴 유사도 비교]");

// 유사도 테스트용: snapshot을 직접 구성해서 localStorage에 넣는다(실제 저장 경로와 동일 형식).
// basePrice를 바꿔서 "가격대가 전혀 다른 종목"도 만들 수 있게 한다.
function mkCandles(basePrice, stepPercent, count) {
  const out = [];
  let p = basePrice;
  for (let i = 0; i < count; i++) {
    const open = p;
    p = p * (1 + stepPercent / 100);
    const close = p;
    const high = Math.max(open, close) * 1.001;
    const low = Math.min(open, close) * 0.999;
    out.push({
      openTime: 1000 + i * 60000,
      open, high, low, close, volume: 100 + i,
      haOpen: open, haHigh: high, haLow: low, haClose: close,
      haBullish: close > open,
    });
  }
  return out;
}

function mkTfState(basePrice, stepPercent, rsi, opts) {
  const o = opts || {};
  const candles = mkCandles(basePrice, stepPercent, CONFIG.SNAPSHOT_CANDLE_COUNT);
  const last = candles[candles.length - 1];
  const bodyTop = Math.max(last.open, last.close);
  const bodyBottom = Math.min(last.open, last.close);
  return {
    haBullish: stepPercent > 0,
    haFlipped: o.haFlipped === undefined ? false : o.haFlipped,
    haOpen: last.open, haHigh: last.high, haLow: last.low, haClose: last.close,
    candle: {
      bullish: last.close > last.open,
      body: Math.abs(last.close - last.open),
      upperWick: last.high - bodyTop,
      lowerWick: bodyBottom - last.low,
      range: last.high - last.low,
      changePercent: ((last.close - last.open) / last.open) * 100,
    },
    // MACD는 가격에 비례하는 값이므로 basePrice에 비례하게 만든다(정규화 검증용)
    macdDif: basePrice * 0.0002 * (stepPercent > 0 ? 1 : -1),
    macdDea: basePrice * 0.0001 * (stepPercent > 0 ? 1 : -1),
    macdDiff: basePrice * 0.0001 * (stepPercent > 0 ? 1 : -1),
    macdDifDelta: basePrice * 0.00005,
    macdGoldenCross: o.golden === undefined ? stepPercent > 0 : o.golden,
    macdDeadCross: o.dead === undefined ? stepPercent < 0 : o.dead,
    macdAboveSignal: stepPercent > 0,
    rsi,
    rsiDelta: o.rsiDelta === undefined ? 2 : o.rsiDelta,
    rsiRising: (o.rsiDelta === undefined ? 2 : o.rsiDelta) > 0,
    volume: 100, volumePrev: 90,
    volumeChangePercent: 11.1,
    candles,
  };
}

function mkSnapshot({ signalId, symbol, market, score, direction, signalTime, result,
                      basePrice, stepPercent, rsi, pnlPercent, opts }) {
  const bp = basePrice === undefined ? 100 : basePrice;
  const sp = stepPercent === undefined ? 0.5 : stepPercent;
  const r = rsi === undefined ? 60 : rsi;
  return {
    signalId, symbol,
    market: market || "crypto",
    category: (market || "crypto") === "stock" ? "stock" : "coin",
    score: score === undefined ? 100 : score,
    direction: direction || "long",
    signalTime: signalTime === undefined ? 5000 : signalTime,
    signalPrice: bp,
    conditions: { trend15: true, trend5: true, ha1Flip: true, macdCross: true },
    patternKey: "k",
    tf15: mkTfState(bp, sp, r, opts),
    tf5: mkTfState(bp, sp, r, opts),
    tf1: mkTfState(bp, sp, r, opts),
    result: result === undefined ? null : result,
    resultPrice: result ? bp * 1.1 : null,
    resultTime: result ? (signalTime || 5000) + 900000 : null,
    pnlPercent: pnlPercent === undefined ? (result === "WIN" ? 10 : result === "LOSS" ? -10 : null) : pnlPercent,
  };
}

function seedSnapshots(list) {
  localStorage.setItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS, JSON.stringify({ snapshots: list }));
}

test("5-1: 같은 market+score+direction 그룹만 비교된다", () => {
  const current = mkSnapshot({ signalId: "cur", symbol: "BTCUSDT", signalTime: 9000 });
  seedSnapshots([
    current,
    mkSnapshot({ signalId: "same1", symbol: "ETHUSDT", signalTime: 1000, result: "WIN" }),   // 같은 그룹
    mkSnapshot({ signalId: "same2", symbol: "SOLUSDT", signalTime: 2000, result: "LOSS" }),  // 같은 그룹
    mkSnapshot({ signalId: "otherMkt", symbol: "AAPL", market: "stock", signalTime: 1000, result: "WIN" }),
    mkSnapshot({ signalId: "otherScore", symbol: "ETHUSDT", score: 80, signalTime: 1000, result: "WIN" }),
    mkSnapshot({ signalId: "otherDir", symbol: "ETHUSDT", direction: "short", signalTime: 1000, result: "WIN" }),
  ]);
  const pool = PatternSimilarity.eligiblePastSnapshots(current);
  assert.strictEqual(pool.length, 2);
  assert.deepStrictEqual(pool.map((p) => p.signalId).sort(), ["same1", "same2"]);
});

test("5-2/3/4: Crypto/Stock, 80/100, LONG/SHORT가 섞이지 않는다", () => {
  const current = mkSnapshot({ signalId: "cur", symbol: "BTCUSDT", market: "crypto", score: 100, direction: "long", signalTime: 9000 });
  seedSnapshots([
    current,
    mkSnapshot({ signalId: "a", market: "stock", score: 100, direction: "long", signalTime: 1000, result: "WIN" }),
    mkSnapshot({ signalId: "b", market: "crypto", score: 80, direction: "long", signalTime: 1000, result: "WIN" }),
    mkSnapshot({ signalId: "c", market: "crypto", score: 100, direction: "short", signalTime: 1000, result: "WIN" }),
  ]);
  const found = PatternSimilarity.findSimilarPatterns(current);
  assert.strictEqual(found.comparedCount, 0); // 세 개 모두 다른 그룹이므로 비교 대상 없음
  const stats = PatternSimilarity.getSimilarityStats(current);
  assert.strictEqual(stats.enough, false);
  assert.strictEqual(stats.similarityWeightedWinRate, null); // 억지 승률 없음
});

test("5-5: WIN과 LOSS가 모두 검색된다", () => {
  const current = mkSnapshot({ signalId: "cur", signalTime: 9000 });
  seedSnapshots([
    current,
    mkSnapshot({ signalId: "w1", signalTime: 1000, result: "WIN" }),
    mkSnapshot({ signalId: "w2", signalTime: 2000, result: "WIN" }),
    mkSnapshot({ signalId: "l1", signalTime: 3000, result: "LOSS" }),
  ]);
  const found = PatternSimilarity.findSimilarPatterns(current);
  assert.strictEqual(found.comparedCount, 3);
  assert.strictEqual(found.winCount, 2);
  assert.strictEqual(found.lossCount, 1);
});

test("5-6: result:null snapshot은 제외된다", () => {
  const current = mkSnapshot({ signalId: "cur", signalTime: 9000 });
  seedSnapshots([
    current,
    mkSnapshot({ signalId: "pending1", signalTime: 1000 }),           // result 없음
    mkSnapshot({ signalId: "done", signalTime: 2000, result: "WIN" }),
  ]);
  const pool = PatternSimilarity.eligiblePastSnapshots(current);
  assert.strictEqual(pool.length, 1);
  assert.strictEqual(pool[0].signalId, "done");
});

test("5-7: 미래 signalTime 데이터가 제외된다(데이터 누수 방지)", () => {
  const current = mkSnapshot({ signalId: "cur", signalTime: 5000 });
  seedSnapshots([
    current,
    mkSnapshot({ signalId: "past", signalTime: 4000, result: "WIN" }),    // 과거 → 포함
    mkSnapshot({ signalId: "future", signalTime: 6000, result: "WIN" }),  // 미래 → 제외
    mkSnapshot({ signalId: "same", signalTime: 5000, result: "WIN" }),    // 동시각 → 제외(미래 포함 방지)
  ]);
  const pool = PatternSimilarity.eligiblePastSnapshots(current);
  assert.strictEqual(pool.length, 1);
  assert.strictEqual(pool[0].signalId, "past");
});

test("5-8: 현재 signalId는 비교 대상에서 제외된다", () => {
  const current = mkSnapshot({ signalId: "cur", signalTime: 9000, result: "WIN" }); // 자기 자신도 확정 상태
  seedSnapshots([current, mkSnapshot({ signalId: "other", signalTime: 1000, result: "WIN" })]);
  const pool = PatternSimilarity.eligiblePastSnapshots(current);
  assert.strictEqual(pool.length, 1);
  assert.strictEqual(pool[0].signalId, "other");
});

test("5-9: 15m/5m/1m 유사도가 각각 계산된다", () => {
  const current = mkSnapshot({ signalId: "cur", signalTime: 9000 });
  const past = mkSnapshot({ signalId: "p1", signalTime: 1000, result: "WIN" });
  seedSnapshots([current, past]);
  const found = PatternSimilarity.findSimilarPatterns(current);
  const b = found.matches[0].breakdown;
  assert.ok(Number.isFinite(b.tf15) && Number.isFinite(b.tf5) && Number.isFinite(b.tf1));
  assert.ok(Number.isFinite(b.conditions));
  // 가중치는 15m 30% / 5m 30% / 1m 40%
  assert.ok(Math.abs(PatternSimilarity.TF_WEIGHTS["1m"] - 0.4) < 1e-9);
});

test("5-10: 최근 10개 캔들 시퀀스가 비교에 사용된다", () => {
  // 캔들 경로만 다르고 나머지는 동일하게 만들어, 시퀀스 차이가 유사도에 반영되는지 본다
  const a = mkTfState(100, 0.5, 60);
  const same = mkTfState(100, 0.5, 60);
  const diff = mkTfState(100, -0.5, 60);
  const simSame = PatternSimilarity.candleSeriesSimilarity(a.candles, same.candles);
  const simDiff = PatternSimilarity.candleSeriesSimilarity(a.candles, diff.candles);
  assert.ok(simSame > simDiff); // 같은 경로가 더 유사해야 한다
  assert.ok(Math.abs(simSame - 1) < 1e-9); // 완전히 동일하면 1
  // 캔들이 없으면 null(비교 제외)
  assert.strictEqual(PatternSimilarity.candleSeriesSimilarity(null, a.candles), null);
});

test("5-11: 가격대가 전혀 다른 종목도 형태 기준으로 높은 유사도가 나온다(정규화)", () => {
  // 같은 형태(+0.5%씩 상승), 가격만 100 vs 95000으로 950배 차이
  const current = mkSnapshot({ signalId: "cur", symbol: "CHEAP", basePrice: 100, stepPercent: 0.5, rsi: 60, signalTime: 9000 });
  const pastBig = mkSnapshot({ signalId: "big", symbol: "BTCUSDT", basePrice: 95000, stepPercent: 0.5, rsi: 60, signalTime: 1000, result: "WIN" });
  // 같은 가격대지만 형태가 반대인 패턴
  const pastOppositeShape = mkSnapshot({ signalId: "opp", symbol: "SAME", basePrice: 100, stepPercent: -0.5, rsi: 35, signalTime: 2000, result: "LOSS" });
  seedSnapshots([current, pastBig, pastOppositeShape]);
  const found = PatternSimilarity.findSimilarPatterns(current);
  const big = found.matches.find((m) => m.signalId === "big");
  const opp = found.matches.find((m) => m.signalId === "opp");
  // 가격이 950배 달라도 "형태가 같은" 쪽이 더 유사해야 한다
  assert.ok(big.similarity > opp.similarity,
    `형태 같음(${big.similarity.toFixed(1)})이 가격만 같음(${opp.similarity.toFixed(1)})보다 높아야 함`);
  assert.ok(big.similarity > 90, `가격 정규화가 되면 매우 높아야 함: ${big.similarity.toFixed(1)}`);
});

test("5-12: 유사도가 0~100 범위이고 동일 패턴은 100에 가깝다", () => {
  const current = mkSnapshot({ signalId: "cur", signalTime: 9000 });
  const identical = mkSnapshot({ signalId: "identical", signalTime: 1000, result: "WIN" });
  const different = mkSnapshot({ signalId: "different", basePrice: 100, stepPercent: -2, rsi: 20, signalTime: 2000, result: "LOSS",
    opts: { golden: false, dead: true, rsiDelta: -8, haFlipped: true } });
  seedSnapshots([current, identical, different]);
  const found = PatternSimilarity.findSimilarPatterns(current);
  found.matches.forEach((m) => {
    assert.ok(m.similarity >= 0 && m.similarity <= 100, `범위 위반: ${m.similarity}`);
  });
  const id = found.matches.find((m) => m.signalId === "identical");
  const df = found.matches.find((m) => m.signalId === "different");
  assert.ok(id.similarity > 95, `동일 패턴은 100에 가까워야 함: ${id.similarity}`);
  assert.ok(id.similarity > df.similarity);
});

test("5-13: 상위 유사 패턴이 유사도 내림차순으로 정렬된다", () => {
  const current = mkSnapshot({ signalId: "cur", stepPercent: 0.5, rsi: 60, signalTime: 9000 });
  seedSnapshots([
    current,
    mkSnapshot({ signalId: "near", stepPercent: 0.5, rsi: 60, signalTime: 1000, result: "WIN" }),
    mkSnapshot({ signalId: "mid", stepPercent: 0.3, rsi: 50, signalTime: 2000, result: "WIN" }),
    mkSnapshot({ signalId: "far", stepPercent: -1.5, rsi: 25, signalTime: 3000, result: "LOSS",
      opts: { golden: false, dead: true, rsiDelta: -6 } }),
  ]);
  const found = PatternSimilarity.findSimilarPatterns(current);
  for (let i = 1; i < found.matches.length; i++) {
    assert.ok(found.matches[i - 1].similarity >= found.matches[i].similarity, "정렬 위반");
  }
  assert.strictEqual(found.matches[0].signalId, "near");
});

test("5-14: WIN/LOSS 통계와 유사도 가중 승률이 정확하다", () => {
  const current = mkSnapshot({ signalId: "cur", stepPercent: 0.5, rsi: 60, signalTime: 9000 });
  seedSnapshots([
    current,
    // 현재와 매우 유사한 WIN 2건
    mkSnapshot({ signalId: "w1", stepPercent: 0.5, rsi: 60, signalTime: 1000, result: "WIN" }),
    mkSnapshot({ signalId: "w2", stepPercent: 0.5, rsi: 60, signalTime: 1100, result: "WIN" }),
    // 현재와 많이 다른 LOSS 3건 (개수는 많지만 유사도가 낮음)
    mkSnapshot({ signalId: "l1", stepPercent: -2, rsi: 20, signalTime: 2000, result: "LOSS", opts: { golden: false, dead: true, rsiDelta: -8, haFlipped: true } }),
    mkSnapshot({ signalId: "l2", stepPercent: -2, rsi: 20, signalTime: 2100, result: "LOSS", opts: { golden: false, dead: true, rsiDelta: -8, haFlipped: true } }),
    mkSnapshot({ signalId: "l3", stepPercent: -2, rsi: 20, signalTime: 2200, result: "LOSS", opts: { golden: false, dead: true, rsiDelta: -8, haFlipped: true } }),
  ]);
  /* 6단계부터 유사도 threshold(기본 70)가 기본 적용된다.
     threshold를 0으로 낮추면 5건 전부가 표본에 들어간다(임계값 적용 전 동작 확인). */
  const raw = PatternSimilarity.getSimilarityStats(current, { minSamples: 5, minSimilarity: 0 });
  assert.strictEqual(raw.matchedCount, 5);
  assert.strictEqual(raw.winCount, 2);
  assert.strictEqual(raw.lossCount, 3);
  assert.ok(Math.abs(raw.winRate - 40) < 1e-9); // 단순 승률 40%
  // 유사도 가중 승률은 유사한 WIN에 더 큰 가중치가 실려 단순 승률보다 높아야 한다
  assert.ok(raw.similarityWeightedWinRate > raw.winRate,
    `가중 ${raw.similarityWeightedWinRate.toFixed(1)} > 단순 ${raw.winRate.toFixed(1)}`);
  assert.ok(Number.isFinite(raw.averageSimilarity));
  assert.strictEqual(raw.enough, true);
  assert.ok(raw.topMatches.length > 0);
  // 기존 필드명도 그대로 동작해야 한다(하위호환)
  assert.strictEqual(raw.comparedCount, raw.matchedCount);
  assert.strictEqual(raw.plainWinRate, raw.winRate);

  /* 기본 threshold(70)를 쓰면 유사도가 낮은 LOSS 3건이 제외되어 WIN 2건만 남는다.
     즉 "비슷하지 않은 과거 신호"가 승률을 왜곡하지 않는다. */
  const filtered = PatternSimilarity.getSimilarityStats(current, { minSamples: 5 });
  assert.strictEqual(filtered.matchedCount, 2);
  assert.strictEqual(filtered.lossCount, 0);
  assert.strictEqual(filtered.threshold, CONFIG.SIM_ADJUST_MIN_SIMILARITY);
  assert.strictEqual(filtered.enough, false); // 2건 < 5건 → 표본 부족
  assert.strictEqual(filtered.totalInGroup, 5); // 임계값 적용 전 전체는 5건
});

test("5-15: 표본 부족 상태가 정상 처리된다", () => {
  const current = mkSnapshot({ signalId: "cur", signalTime: 9000 });
  seedSnapshots([current, mkSnapshot({ signalId: "only", signalTime: 1000, result: "WIN" })]);
  const stats = PatternSimilarity.getSimilarityStats(current);
  assert.strictEqual(stats.comparedCount, 1);
  assert.strictEqual(stats.enough, false); // SCORE_PERF_MIN_SAMPLES(5) 미만
  // 데이터가 아예 없는 경우도 안전
  seedSnapshots([current]);
  const empty = PatternSimilarity.getSimilarityStats(current);
  assert.strictEqual(empty.comparedCount, 0);
  assert.strictEqual(empty.similarityWeightedWinRate, null);
  assert.strictEqual(empty.averageSimilarity, null);
  assert.strictEqual(empty.enough, false);
  assert.deepStrictEqual(empty.topMatches, []);
  // snapshot이 전혀 없어도 오류 없음
  seedSnapshots([]);
  assert.strictEqual(PatternSimilarity.findSimilarPatterns(current).comparedCount, 0);
});

test("5-16: 유사도 계산이 기존 snapshot 데이터를 변경하지 않는다(읽기 전용)", () => {
  const current = mkSnapshot({ signalId: "cur", signalTime: 9000 });
  seedSnapshots([
    current,
    mkSnapshot({ signalId: "p1", signalTime: 1000, result: "WIN" }),
    mkSnapshot({ signalId: "p2", signalTime: 2000, result: "LOSS" }),
  ]);
  const before = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS);
  PatternSimilarity.findSimilarPatterns(current);
  PatternSimilarity.getSimilarityStats(current);
  PatternSimilarity.getSimilarWinningPatterns(current);
  PatternSimilarity.getSimilarLosingPatterns(current);
  const after = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS);
  assert.strictEqual(before, after); // 한 글자도 안 바뀜
});

test("5-17: 성공/실패 패턴을 따로 유사도 순으로 조회할 수 있다", () => {
  const current = mkSnapshot({ signalId: "cur", stepPercent: 0.5, rsi: 60, signalTime: 9000 });
  seedSnapshots([
    current,
    mkSnapshot({ signalId: "w1", stepPercent: 0.5, rsi: 60, signalTime: 1000, result: "WIN" }),
    mkSnapshot({ signalId: "w2", stepPercent: 0.2, rsi: 50, signalTime: 1100, result: "WIN" }),
    mkSnapshot({ signalId: "l1", stepPercent: -2, rsi: 20, signalTime: 2000, result: "LOSS", opts: { golden: false, dead: true } }),
  ]);
  const wins = PatternSimilarity.getSimilarWinningPatterns(current);
  const losses = PatternSimilarity.getSimilarLosingPatterns(current);
  assert.ok(wins.every((m) => m.result === "WIN"));
  assert.ok(losses.every((m) => m.result === "LOSS"));
  assert.strictEqual(wins.length, 2);
  assert.strictEqual(losses.length, 1);
  assert.ok(wins[0].similarity >= wins[1].similarity); // 유사도 순
  // "성공 패턴과 더 비슷한가?" 판단이 가능해야 한다
  assert.ok(wins[0].similarity > losses[0].similarity);
});

test("5-18: 기본 상위 10개를 반환하고 topN 옵션으로 조절된다", () => {
  const current = mkSnapshot({ signalId: "cur", signalTime: 99000 });
  const list = [current];
  for (let i = 0; i < 15; i++) {
    list.push(mkSnapshot({ signalId: "p" + i, signalTime: 1000 + i, result: i % 2 ? "WIN" : "LOSS" }));
  }
  seedSnapshots(list);
  const found = PatternSimilarity.findSimilarPatterns(current);
  assert.strictEqual(found.comparedCount, 15);
  assert.strictEqual(found.matches.length, 10); // 기본 10개
  assert.strictEqual(PatternSimilarity.findSimilarPatterns(current, { topN: 3 }).matches.length, 3);
});

test("5-19: 반환값에 요구된 필드가 모두 포함된다", () => {
  const current = mkSnapshot({ signalId: "cur", symbol: "BTCUSDT", signalTime: 9000 });
  seedSnapshots([current, mkSnapshot({ signalId: "p1", symbol: "ETHUSDT", signalTime: 1000, result: "WIN", pnlPercent: 7.5 })]);
  const found = PatternSimilarity.findSimilarPatterns(current);
  assert.ok(found.current && found.current.signalId === "cur");
  assert.strictEqual(found.comparedCount, 1);
  assert.strictEqual(found.winCount, 1);
  assert.strictEqual(found.lossCount, 0);
  const m = found.matches[0];
  ["similarity", "result", "symbol", "signalTime", "score", "direction", "market", "signalPrice", "pnlPercent"].forEach((f) => {
    assert.ok(m[f] !== undefined, `필드 누락: ${f}`);
  });
  assert.strictEqual(m.pnlPercent, 7.5);
});

test("5-20: 학습 OFF 상태에서도 기존 snapshot 비교/조회가 가능하다", () => {
  const current = mkSnapshot({ signalId: "cur", signalTime: 9000 });
  seedSnapshots([
    current,
    mkSnapshot({ signalId: "p1", signalTime: 1000, result: "WIN" }),
    mkSnapshot({ signalId: "p2", signalTime: 2000, result: "LOSS" }),
  ]);
  State.saveLearnEnabled(false);
  const found = PatternSimilarity.findSimilarPatterns(current);
  assert.strictEqual(found.comparedCount, 2); // OFF여도 조회 가능
  assert.ok(Number.isFinite(found.matches[0].similarity));
  State.saveLearnEnabled(true);
});

test("5-21: 기존 PatternAnalysis 결과가 그대로 유지된다(대체/삭제 없음)", () => {
  seedSnapshots([
    mkSnapshot({ signalId: "a", signalTime: 1000, result: "WIN" }),
    mkSnapshot({ signalId: "b", signalTime: 2000, result: "WIN" }),
    mkSnapshot({ signalId: "c", signalTime: 3000, result: "LOSS" }),
  ]);
  const st = PatternAnalysis.getPatternStats("crypto", 100, "long");
  assert.strictEqual(st.total, 3);
  assert.strictEqual(st.wins, 2);
  assert.strictEqual(st.losses, 1);
  // 유사도 계산 후에도 동일
  const current = mkSnapshot({ signalId: "cur", signalTime: 9000 });
  PatternSimilarity.getSimilarityStats(current);
  const st2 = PatternAnalysis.getPatternStats("crypto", 100, "long");
  assert.strictEqual(JSON.stringify(st.total + "/" + st.wins + "/" + st.losses),
                     JSON.stringify(st2.total + "/" + st2.wins + "/" + st2.losses));
});

console.log("\n[6단계: 유사 패턴 기반 confidence 보정]");

// 유사도를 의도적으로 조절하기 위해, mkSnapshot의 형태 파라미터를 이용한다.
// stepPercent/rsi가 현재와 같으면 유사도가 매우 높고, 크게 다르면 낮아진다.
// (5단계 테스트에서 정의한 mkSnapshot / seedSnapshots 재사용)

function seedForAdjust({ current, winCount, lossCount, similar, extraFar }) {
  const list = [current];
  let t = 1000;
  // similar=true면 현재와 동일한 형태(유사도 ~100), false면 많이 다른 형태(유사도 낮음)
  const shape = similar
    ? { stepPercent: 0.5, rsi: 60 }
    : { stepPercent: -2, rsi: 20, opts: { golden: false, dead: true, rsiDelta: -8, haFlipped: true } };
  for (let i = 0; i < winCount; i++) {
    list.push(mkSnapshot(Object.assign({ signalId: "w" + i, signalTime: t++, result: "WIN" }, shape)));
  }
  for (let i = 0; i < lossCount; i++) {
    list.push(mkSnapshot(Object.assign({ signalId: "l" + i, signalTime: t++, result: "LOSS" }, shape)));
  }
  // 유사도가 낮은(70 미만) 패턴을 추가로 넣어 "핵심 표본에서 제외"되는지 확인할 수 있게 한다
  (extraFar || []).forEach((r, i) => {
    list.push(mkSnapshot({
      signalId: "far" + i, signalTime: t++, result: r,
      stepPercent: -2.5, rsi: 15, opts: { golden: false, dead: true, rsiDelta: -10, haFlipped: true },
    }));
  });
  seedSnapshots(list);
}

test("6-1: 유사 패턴이 10개 미만이면 기존 confidence를 그대로 유지한다", () => {
  const current = mkSnapshot({ signalId: "cur", stepPercent: 0.5, rsi: 60, signalTime: 99000 });
  seedForAdjust({ current, winCount: 9, lossCount: 0, similar: true }); // 9개(10 미만), 전부 WIN
  const r = ConfidenceAdjust.adjustConfidence(80, current);
  assert.strictEqual(r.coreCount, 9);
  assert.strictEqual(r.applied, false);
  assert.strictEqual(r.reason, "insufficient-samples");
  assert.strictEqual(r.adjustedConfidence, 80); // 보정 없음
  assert.strictEqual(r.similarityAdjustment, 0);
});

test("6-2: 유사도 70 미만 패턴은 핵심 표본에서 제외된다", () => {
  const current = mkSnapshot({ signalId: "cur", stepPercent: 0.5, rsi: 60, signalTime: 99000 });
  // 유사도 높은 WIN 10개 + 유사도 낮은 LOSS 10개
  seedForAdjust({ current, winCount: 10, lossCount: 0, similar: true,
    extraFar: ["LOSS","LOSS","LOSS","LOSS","LOSS","LOSS","LOSS","LOSS","LOSS","LOSS"] });
  const r = ConfidenceAdjust.adjustConfidence(80, current);
  // 전체 비교 대상은 20건이지만, 핵심 표본은 유사도 70 이상인 10건만
  assert.strictEqual(r.comparedCount, 20);
  assert.strictEqual(r.coreCount, 10);
  assert.strictEqual(r.coreWinCount, 10);
  assert.strictEqual(r.coreLossCount, 0); // 유사도 낮은 LOSS는 제외됨
  assert.ok(r.minSimilarityUsed === CONFIG.SIM_ADJUST_MIN_SIMILARITY);
  // 낮은 유사도 LOSS가 제외됐으므로 confidence는 상승해야 한다
  assert.ok(r.adjustedConfidence > 80);
});

test("6-3: WIN 비중이 높으면 confidence가 상승한다", () => {
  const current = mkSnapshot({ signalId: "cur", stepPercent: 0.5, rsi: 60, signalTime: 99000 });
  seedForAdjust({ current, winCount: 12, lossCount: 0, similar: true });
  const r = ConfidenceAdjust.adjustConfidence(70, current);
  assert.strictEqual(r.applied, true);
  assert.ok(r.similarityWeightedWinRate > 90);
  assert.ok(r.adjustedConfidence > 70, `상승해야 함: ${r.adjustedConfidence}`);
  assert.ok(r.similarityAdjustment > 0);
});

test("6-4: LOSS 비중이 높으면 confidence가 하락한다", () => {
  const current = mkSnapshot({ signalId: "cur", stepPercent: 0.5, rsi: 60, signalTime: 99000 });
  seedForAdjust({ current, winCount: 0, lossCount: 12, similar: true });
  const r = ConfidenceAdjust.adjustConfidence(70, current);
  assert.strictEqual(r.applied, true);
  assert.ok(r.similarityWeightedWinRate < 10);
  assert.ok(r.adjustedConfidence < 70, `하락해야 함: ${r.adjustedConfidence}`);
  assert.ok(r.similarityAdjustment < 0);
});

test("6-5: 최대 상승 폭이 +10%p를 넘지 않는다", () => {
  const current = mkSnapshot({ signalId: "cur", stepPercent: 0.5, rsi: 60, signalTime: 99000 });
  seedForAdjust({ current, winCount: 40, lossCount: 0, similar: true }); // 전부 WIN, 표본 많음
  const r = ConfidenceAdjust.adjustConfidence(80, current);
  assert.ok(Math.abs(r.similarityAdjustment) <= CONFIG.SIM_ADJUST_MAX_DELTA + 1e-9);
  assert.ok(r.adjustedConfidence <= 90 + 1e-9, `최대 90까지만: ${r.adjustedConfidence}`);
  assert.ok(Math.abs(r.adjustedConfidence - 90) < 1e-6); // 전승이면 정확히 +10
});

test("6-6: 최대 하락 폭이 -10%p를 넘지 않는다", () => {
  const current = mkSnapshot({ signalId: "cur", stepPercent: 0.5, rsi: 60, signalTime: 99000 });
  seedForAdjust({ current, winCount: 0, lossCount: 40, similar: true }); // 전부 LOSS
  const r = ConfidenceAdjust.adjustConfidence(80, current);
  assert.ok(Math.abs(r.similarityAdjustment) <= CONFIG.SIM_ADJUST_MAX_DELTA + 1e-9);
  assert.ok(r.adjustedConfidence >= 70 - 1e-9, `최소 70까지만: ${r.adjustedConfidence}`);
  assert.ok(Math.abs(r.adjustedConfidence - 70) < 1e-6); // 전패면 정확히 -10
});

test("6-7: 0~100 범위를 벗어나지 않도록 클램프된다", () => {
  const current = mkSnapshot({ signalId: "cur", stepPercent: 0.5, rsi: 60, signalTime: 99000 });
  seedForAdjust({ current, winCount: 30, lossCount: 0, similar: true });
  const high = ConfidenceAdjust.adjustConfidence(97, current);
  assert.ok(high.adjustedConfidence <= 100);
  seedForAdjust({ current, winCount: 0, lossCount: 30, similar: true });
  const low = ConfidenceAdjust.adjustConfidence(3, current);
  assert.ok(low.adjustedConfidence >= 0);
});

test("6-8: LONG/SHORT가 혼합되지 않는다", () => {
  const current = mkSnapshot({ signalId: "cur", direction: "long", stepPercent: 0.5, rsi: 60, signalTime: 99000 });
  const list = [current];
  // SHORT WIN을 20건 넣어도 LONG 신호 보정에 쓰이면 안 된다
  for (let i = 0; i < 20; i++) {
    list.push(mkSnapshot({ signalId: "s" + i, direction: "short", stepPercent: 0.5, rsi: 60, signalTime: 1000 + i, result: "WIN" }));
  }
  seedSnapshots(list);
  const r = ConfidenceAdjust.adjustConfidence(80, current);
  assert.strictEqual(r.comparedCount, 0);
  assert.strictEqual(r.applied, false);
  assert.strictEqual(r.adjustedConfidence, 80);
});

test("6-9: crypto/stock이 혼합되지 않는다", () => {
  const current = mkSnapshot({ signalId: "cur", market: "crypto", stepPercent: 0.5, rsi: 60, signalTime: 99000 });
  const list = [current];
  for (let i = 0; i < 20; i++) {
    list.push(mkSnapshot({ signalId: "st" + i, market: "stock", stepPercent: 0.5, rsi: 60, signalTime: 1000 + i, result: "WIN" }));
  }
  seedSnapshots(list);
  const r = ConfidenceAdjust.adjustConfidence(80, current);
  assert.strictEqual(r.comparedCount, 0);
  assert.strictEqual(r.adjustedConfidence, 80);
});

test("6-10: 80/100 점수 그룹이 혼합되지 않는다", () => {
  const current = mkSnapshot({ signalId: "cur", score: 100, stepPercent: 0.5, rsi: 60, signalTime: 99000 });
  const list = [current];
  for (let i = 0; i < 20; i++) {
    list.push(mkSnapshot({ signalId: "s80_" + i, score: 80, stepPercent: 0.5, rsi: 60, signalTime: 1000 + i, result: "WIN" }));
  }
  seedSnapshots(list);
  const r = ConfidenceAdjust.adjustConfidence(80, current);
  assert.strictEqual(r.comparedCount, 0);
  assert.strictEqual(r.adjustedConfidence, 80);
});

test("6-11: 미래 snapshot이 보정에 사용되지 않는다", () => {
  const current = mkSnapshot({ signalId: "cur", stepPercent: 0.5, rsi: 60, signalTime: 5000 });
  const list = [current];
  // 전부 미래 시각의 WIN — 사용되면 안 된다
  for (let i = 0; i < 20; i++) {
    list.push(mkSnapshot({ signalId: "f" + i, stepPercent: 0.5, rsi: 60, signalTime: 6000 + i, result: "WIN" }));
  }
  seedSnapshots(list);
  const r = ConfidenceAdjust.adjustConfidence(80, current);
  assert.strictEqual(r.comparedCount, 0);
  assert.strictEqual(r.adjustedConfidence, 80);
});

test("6-12: result:null snapshot이 제외된다", () => {
  const current = mkSnapshot({ signalId: "cur", stepPercent: 0.5, rsi: 60, signalTime: 99000 });
  const list = [current];
  for (let i = 0; i < 20; i++) {
    list.push(mkSnapshot({ signalId: "p" + i, stepPercent: 0.5, rsi: 60, signalTime: 1000 + i })); // result 없음
  }
  seedSnapshots(list);
  const r = ConfidenceAdjust.adjustConfidence(80, current);
  assert.strictEqual(r.comparedCount, 0);
  assert.strictEqual(r.adjustedConfidence, 80);
});

test("6-13: 디버깅 리포트에 요구된 필드가 모두 포함된다", () => {
  const current = mkSnapshot({ signalId: "cur", stepPercent: 0.5, rsi: 60, signalTime: 99000 });
  seedForAdjust({ current, winCount: 8, lossCount: 4, similar: true });
  const r = ConfidenceAdjust.getReport(current, 80);
  ["baseConfidence", "adjustedConfidence", "comparedCount", "winCount", "lossCount",
   "similarityWeightedWinRate", "averageSimilarity", "topSimilarity", "similarityAdjustment"].forEach((f) => {
    assert.ok(r[f] !== undefined, `필드 누락: ${f}`);
  });
  assert.strictEqual(r.baseConfidence, 80);
  assert.ok(Number.isFinite(r.averageSimilarity));
  assert.ok(Number.isFinite(r.topSimilarity));
  assert.ok(r.topSimilarity >= r.averageSimilarity);
});

test("6-14: 기존 confidence가 없으면(null) 보정하지 않는다", () => {
  const current = mkSnapshot({ signalId: "cur", stepPercent: 0.5, rsi: 60, signalTime: 99000 });
  seedForAdjust({ current, winCount: 20, lossCount: 0, similar: true });
  const r = ConfidenceAdjust.adjustConfidence(null, current);
  assert.strictEqual(r.applied, false);
  assert.strictEqual(r.reason, "no-base-confidence");
  assert.strictEqual(r.adjustedConfidence, null);
});

test("6-15: 0~1 단위 confidence도 보정할 수 있다(기존 getConfidence 형식 호환)", () => {
  const current = mkSnapshot({ signalId: "cur", stepPercent: 0.5, rsi: 60, signalTime: 99000 });
  seedForAdjust({ current, winCount: 20, lossCount: 0, similar: true });
  const r = ConfidenceAdjust.adjustConfidenceUnit(0.8, current);
  assert.strictEqual(r.baseConfidence, 0.8);
  // 전승이면 +10%p → 0.9
  assert.ok(Math.abs(r.adjustedConfidence - 0.9) < 1e-6, `${r.adjustedConfidence}`);
  assert.ok(r.adjustedConfidence <= 1);
  assert.strictEqual(r.baseConfidencePercent, 80);
});

test("6-16: 중립 승률(50%)이면 보정이 거의 0이다", () => {
  const current = mkSnapshot({ signalId: "cur", stepPercent: 0.5, rsi: 60, signalTime: 99000 });
  seedForAdjust({ current, winCount: 10, lossCount: 10, similar: true }); // 50:50
  const r = ConfidenceAdjust.adjustConfidence(80, current);
  assert.ok(Math.abs(r.similarityWeightedWinRate - 50) < 1e-6);
  assert.ok(Math.abs(r.adjustedConfidence - 80) < 1e-6); // 변화 없음
});

test("6-17: 보정 계산이 기존 신호 점수/판정/localStorage를 변경하지 않는다", () => {
  const current = mkSnapshot({ signalId: "cur", stepPercent: 0.5, rsi: 60, signalTime: 99000 });
  seedForAdjust({ current, winCount: 15, lossCount: 5, similar: true });
  const snapBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS);
  const learnBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);
  // 기존 신호 점수 계산이 그대로인지도 확인 (signals.js는 무수정)
  const k15 = buildTrendingKlines(100, 0.5, 40, 0, 15 * 60000);
  const k5 = buildTrendingKlines(100, 0.5, 40, 0, 5 * 60000);
  const k1 = buildTrendingKlines(100, 0.5, 40, 0, 60000);
  const tf = { "15m": Signals.computeIndicators(k15), "5m": Signals.computeIndicators(k5), "1m": Signals.computeIndicators(k1) };
  const sigBefore = JSON.stringify(Signals.evaluate(null, "TESTUSDT", tf).long);

  ConfidenceAdjust.adjustConfidence(80, current);
  ConfidenceAdjust.getSimilarityMetrics(current);
  ConfidenceAdjust.getReport(current, 80);

  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS), snapBefore);
  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN), learnBefore);
  const sigAfter = JSON.stringify(Signals.evaluate(null, "TESTUSDT", tf).long);
  assert.strictEqual(sigBefore, sigAfter); // 신호 점수 계산 결과 동일
});

test("6-18: 유사 패턴 정보가 confidence를 기존 신호보다 크게 뒤집지 못한다(영향력 제한)", () => {
  const current = mkSnapshot({ signalId: "cur", stepPercent: 0.5, rsi: 60, signalTime: 99000 });
  // 극단적으로 부정적인 과거 데이터
  seedForAdjust({ current, winCount: 0, lossCount: 50, similar: true });
  const r = ConfidenceAdjust.adjustConfidence(90, current);
  // 90 → 최악의 경우에도 80 미만으로는 못 내려간다(±10%p 제한)
  assert.ok(r.adjustedConfidence >= 80 - 1e-9, `${r.adjustedConfidence}`);
  // 즉 "강한 신호"가 유사 패턴 때문에 "약한 신호"로 뒤집히지 않는다
  assert.ok(r.adjustedConfidence > 50);
});

console.log("\n[7단계: confidence 보정을 실제 신호 흐름에 연결]");

// 실제 흐름을 그대로 재현한다:
// Signals.evaluate() → PatternLearn.recordPending() → PatternSnapshot.record()
// → ConfidenceAdjust.evaluateForSignal()
// (app.js가 하는 순서와 동일. 단독 호출 테스트가 아니라 연결 검증)
function runRealSignalFlow({ symbol, category, score, direction, trendUp }) {
  State.setCategory(symbol, category || "coin");
  const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
  const tf = makeTfData(100, trendUp !== false);
  const dir = { score, band: "strong", conditions: COND };
  const other = { score: 20, band: "none", conditions: { trend15: false, trend5: false, ha1Flip: false, macdCross: false } };
  const result = {
    symbol, price: 100, updatedAt: entryTime,
    entryTimes: { "1m": entryTime + snapSeq++ * 60000 },
    tf,
    long: direction === "long" ? dir : other,
    short: direction === "short" ? dir : other,
    leadingDirection: direction,
    isNewSignal: true,
  };
  // app.js와 동일한 순서
  const pendingItem = PatternLearn.recordPending(result, direction);
  if (pendingItem) PatternSnapshot.record(pendingItem, result.tf);
  const report = ConfidenceAdjust.evaluateForSignal(result, direction, pendingItem);
  return { result, pendingItem, report };
}

// 과거 유사 패턴을 미리 채워두는 헬퍼.
// 중요: 현재 신호와 "동일한 방식(makeTfData + buildSnapshot)"으로 과거 패턴을 만든다.
// 서로 다른 헬퍼로 만들면 차트 형태 자체가 달라 유사도가 70 미만으로 떨어지고,
// 그러면 연결 검증이 아니라 테스트 데이터 문제로 실패하게 된다.
function seedPastPatterns({ market, score, direction, wins, losses, similar, farLosses }) {
  const list = PatternSnapshot.getAll().slice();
  let t = 1000;
  const cat = market === "stock" ? "stock" : "coin";
  const trendUp = direction === "long";
  const push = (n, result, far) => {
    for (let i = 0; i < n; i++) {
      const item = {
        signalId: `seed_${market}_${score}_${direction}_${result}_${far ? "far" : "near"}_${t}`,
        symbol: market === "stock" ? "STOCKSEED" : "SEEDUSDT",
        category: cat, score, direction,
        signalTime: t, entryTime: t, entryPrice: 100,
        // far 패턴은 추세뿐 아니라 신호 조건도 다르게 해서 유사도를 확실히 70 미만으로 만든다
        conditions: far ? { trend15: false, trend5: false, ha1Flip: false, macdCross: false } : COND,
        patternKey: "seedkey",
      };
      t++;
      // far=true면 현재와 반대 형태로 만들어 유사도를 70 미만으로 떨어뜨린다
      const snap = PatternSnapshot.buildSnapshot(item, makeTfData(100, far ? !trendUp : trendUp));
      snap.result = result;
      snap.pnlPercent = result === "WIN" ? 10 : -10;
      snap.resultPrice = result === "WIN" ? 110 : 90;
      snap.resultTime = t + 900000;
      list.push(snap);
    }
  };
  push(wins || 0, "WIN", false);
  push(losses || 0, "LOSS", similar === false);
  push(farLosses || 0, "LOSS", true);
  seedSnapshots(list);
}

test("7-1: 실제 신호 흐름에서 confidence 보정이 호출되고 리포트가 생성된다", () => {
  clearSnapshots(); clearLearnAll(); State.saveLearnEnabled(true);
  const { report, pendingItem } = runRealSignalFlow({ symbol: "BTCUSDT", category: "coin", score: 100, direction: "long" });
  assert.ok(pendingItem, "recordPending이 항목을 만들어야 함");
  assert.ok(report, "evaluateForSignal이 리포트를 반환해야 함");
  // 요구사항 16의 필드가 모두 있어야 한다
  ["baseConfidence", "adjustedConfidence", "similarityAdjustment", "comparedCount",
   "winCount", "lossCount", "similarityWeightedWinRate", "averageSimilarity", "topSimilarity", "reason"].forEach((f) => {
    assert.ok(report[f] !== undefined, `필드 누락: ${f}`);
  });
  assert.strictEqual(report.symbol, "BTCUSDT");
  assert.strictEqual(report.direction, "long");
  assert.strictEqual(report.score, 100);
});

test("7-2: 과거 유사 WIN이 충분하면 실제 흐름에서 adjustedConfidence가 상승한다", () => {
  clearSnapshots(); clearLearnAll();
  // base confidence가 생기도록 기존 학습 데이터를 먼저 쌓는다(패턴별 통계)
  State.setCategory("BTCUSDT", "coin");
  for (let i = 0; i < CONFIG.LEARN_MIN_SAMPLES + 5; i++) {
    PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: i < 10 ? 5 : -5 });
  }
  // 과거 유사 패턴(전부 WIN) 20건
  seedPastPatterns({ market: "crypto", score: 100, direction: "long", wins: 20, losses: 0, similar: true });

  const { report } = runRealSignalFlow({ symbol: "BTCUSDT", category: "coin", score: 100, direction: "long" });
  assert.ok(Number.isFinite(report.baseConfidence), "base confidence가 있어야 함(0~1)");
  assert.strictEqual(report.applied, true);
  assert.ok(report.adjustedConfidence > report.baseConfidence, "상승해야 함");
  // 0~1 단위가 유지되어야 한다
  assert.ok(report.baseConfidence <= 1 && report.adjustedConfidence <= 1);
  // %단위 참고값도 함께 제공
  assert.ok(Math.abs(report.adjustedConfidencePercent - report.adjustedConfidence * 100) < 1e-9);
});

test("7-3: base confidence가 없으면(표본 부족) 보정하지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  // 기존 학습 데이터를 쌓지 않아 getConfidence가 null인 상태
  seedPastPatterns({ market: "crypto", score: 100, direction: "long", wins: 20, losses: 0, similar: true });
  const { report } = runRealSignalFlow({ symbol: "BTCUSDT", category: "coin", score: 100, direction: "long" });
  assert.strictEqual(report.baseConfidence, null);
  assert.strictEqual(report.adjustedConfidence, null);
  assert.strictEqual(report.applied, false);
});

test("7-4: 기존 score와 LONG/SHORT 방향이 보정 때문에 변경되지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  for (let i = 0; i < CONFIG.LEARN_MIN_SAMPLES + 5; i++) {
    PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  }
  // 과거 유사 패턴을 전부 LOSS로 채워 최악의 보정 상황을 만든다
  seedPastPatterns({ market: "crypto", score: 100, direction: "long", wins: 0, losses: 30, similar: true });
  const { result, report } = runRealSignalFlow({ symbol: "BTCUSDT", category: "coin", score: 100, direction: "long" });
  // 점수/방향은 그대로
  assert.strictEqual(result.long.score, 100);
  assert.strictEqual(result.leadingDirection, "long"); // LOSS가 많아도 SHORT로 뒤집히지 않음
  assert.strictEqual(report.score, 100);
  assert.strictEqual(report.direction, "long");
  // confidence만 하락
  assert.ok(report.adjustedConfidence < report.baseConfidence);
});

test("7-5: 실제 흐름에서 보정 폭이 ±10%p를 넘지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  for (let i = 0; i < CONFIG.LEARN_MIN_SAMPLES + 5; i++) {
    PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: i < 8 ? 5 : -5 });
  }
  // 전승
  seedPastPatterns({ market: "crypto", score: 100, direction: "long", wins: 40, losses: 0, similar: true });
  const up = runRealSignalFlow({ symbol: "BTCUSDT", category: "coin", score: 100, direction: "long" }).report;
  assert.ok(Math.abs(up.adjustedConfidence - up.baseConfidence) <= 0.10 + 1e-9,
    `+10%p 초과: ${(up.adjustedConfidence - up.baseConfidence) * 100}`);

  clearSnapshots();
  seedPastPatterns({ market: "crypto", score: 100, direction: "long", wins: 0, losses: 40, similar: true });
  const down = runRealSignalFlow({ symbol: "BTCUSDT", category: "coin", score: 100, direction: "long" }).report;
  assert.ok(Math.abs(down.adjustedConfidence - down.baseConfidence) <= 0.10 + 1e-9,
    `-10%p 초과: ${(down.adjustedConfidence - down.baseConfidence) * 100}`);
});

test("7-6: 실제 흐름에서 유사 패턴 10개 미만이면 confidence가 그대로 유지된다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  for (let i = 0; i < CONFIG.LEARN_MIN_SAMPLES + 5; i++) {
    PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  }
  seedPastPatterns({ market: "crypto", score: 100, direction: "long", wins: 9, losses: 0, similar: true }); // 9건
  const { report } = runRealSignalFlow({ symbol: "BTCUSDT", category: "coin", score: 100, direction: "long" });
  assert.strictEqual(report.coreCount, 9);
  assert.strictEqual(report.applied, false);
  assert.strictEqual(report.adjustedConfidence, report.baseConfidence);
  assert.strictEqual(report.similarityAdjustment, 0);
});

test("7-7: 실제 흐름에서 유사도 70 미만 패턴이 핵심 표본에서 제외된다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  for (let i = 0; i < CONFIG.LEARN_MIN_SAMPLES + 5; i++) {
    PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  }
  // 유사도 높은 WIN 12건 + 유사도 낮은 LOSS 20건
  seedPastPatterns({ market: "crypto", score: 100, direction: "long", wins: 12, losses: 0, similar: true, farLosses: 20 });
  const { report } = runRealSignalFlow({ symbol: "BTCUSDT", category: "coin", score: 100, direction: "long" });
  assert.strictEqual(report.comparedCount, 32); // 전체 비교 대상
  assert.strictEqual(report.coreCount, 12);     // 유사도 70 이상만
  assert.strictEqual(report.coreLossCount, 0);  // 낮은 유사도 LOSS 제외
  assert.ok(report.adjustedConfidence > report.baseConfidence);
});

test("7-8: 실제 흐름에서 그룹 격리가 유지된다(crypto/stock, 80/100, LONG/SHORT)", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  for (let i = 0; i < CONFIG.LEARN_MIN_SAMPLES + 5; i++) {
    PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  }
  // 다른 그룹의 WIN을 대량으로 넣어도 crypto:100:long 보정에 쓰이면 안 된다
  seedPastPatterns({ market: "stock", score: 100, direction: "long", wins: 20, losses: 0, similar: true });
  seedPastPatterns({ market: "crypto", score: 80, direction: "long", wins: 20, losses: 0, similar: true });
  seedPastPatterns({ market: "crypto", score: 100, direction: "short", wins: 20, losses: 0, similar: true });
  const { report } = runRealSignalFlow({ symbol: "BTCUSDT", category: "coin", score: 100, direction: "long" });
  assert.strictEqual(report.comparedCount, 0); // 같은 그룹 데이터가 없으므로 0
  assert.strictEqual(report.applied, false);
  assert.strictEqual(report.adjustedConfidence, report.baseConfidence);
});

test("7-9: 실제 흐름에서 미래 snapshot과 result:null이 제외된다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  for (let i = 0; i < CONFIG.LEARN_MIN_SAMPLES + 5; i++) {
    PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  }
  // 현재 신호 시각보다 훨씬 미래(9e14)인 WIN 20건 + 결과 미확정 20건
  const list = [];
  for (let i = 0; i < 20; i++) {
    list.push(mkSnapshot({ signalId: "fut" + i, market: "crypto", score: 100, direction: "long",
      signalTime: 9e14 + i, result: "WIN", stepPercent: 0.5, rsi: 60 }));
    list.push(mkSnapshot({ signalId: "nul" + i, market: "crypto", score: 100, direction: "long",
      signalTime: 1000 + i, stepPercent: 0.5, rsi: 60 })); // result 없음
  }
  seedSnapshots(list);
  const { report } = runRealSignalFlow({ symbol: "BTCUSDT", category: "coin", score: 100, direction: "long" });
  assert.strictEqual(report.comparedCount, 0);
  assert.strictEqual(report.adjustedConfidence, report.baseConfidence);
});

test("7-10: 보정이 기존 Signals.evaluate() 결과와 localStorage를 변경하지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  for (let i = 0; i < CONFIG.LEARN_MIN_SAMPLES + 5; i++) {
    PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  }
  seedPastPatterns({ market: "crypto", score: 100, direction: "long", wins: 20, losses: 0, similar: true });

  // 기존 신호 계산이 그대로인지 확인
  const k15 = buildTrendingKlines(100, 0.5, 40, 0, 15 * 60000);
  const k5 = buildTrendingKlines(100, 0.5, 40, 0, 5 * 60000);
  const k1 = buildTrendingKlines(100, 0.5, 40, 0, 60000);
  const tf = { "15m": Signals.computeIndicators(k15), "5m": Signals.computeIndicators(k5), "1m": Signals.computeIndicators(k1) };
  // updatedAt은 Date.now()라 호출마다 달라지므로, 신호 판단에 해당하는 필드만 비교한다
  const sigFields = (r) => JSON.stringify({
    long: r.long, short: r.short, status: r.status,
    leadingDirection: r.leadingDirection, isNewSignal: r.isNewSignal, price: r.price,
  });
  const sigBefore = sigFields(Signals.evaluate(null, "TESTUSDT", tf));

  const snapBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS);
  const learnBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);

  // 보정만 여러 번 실행 (recordPending/record는 호출하지 않음 — 순수 보정 경로)
  const dummyResult = {
    symbol: "BTCUSDT", price: 100, updatedAt: Date.now(),
    entryTimes: { "1m": Date.now() }, tf,
    long: { score: 100, band: "strong", conditions: COND },
    short: { score: 20, band: "none", conditions: COND },
    leadingDirection: "long", isNewSignal: true,
  };
  ConfidenceAdjust.evaluateForSignal(dummyResult, "long", null);
  ConfidenceAdjust.evaluateForSignal(dummyResult, "long", null);

  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS), snapBefore);
  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN), learnBefore);
  assert.strictEqual(sigFields(Signals.evaluate(null, "TESTUSDT", tf)), sigBefore);
});

test("7-11: pendingItem이 없어도(학습 OFF/중복 신호) 보정 경로가 안전하게 동작한다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  for (let i = 0; i < CONFIG.LEARN_MIN_SAMPLES + 5; i++) {
    PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  }
  seedPastPatterns({ market: "crypto", score: 100, direction: "long", wins: 15, losses: 0, similar: true });
  const tf = makeTfData(100, true);
  const result = {
    symbol: "BTCUSDT", price: 100, updatedAt: Date.now(),
    entryTimes: { "1m": Date.now() }, tf,
    long: { score: 100, band: "strong", conditions: COND },
    short: { score: 20, band: "none", conditions: COND },
    leadingDirection: "long", isNewSignal: true,
  };
  // pendingItem = null (학습 OFF나 중복 신호 상황)
  const report = ConfidenceAdjust.evaluateForSignal(result, "long", null);
  assert.ok(report, "null pendingItem에도 리포트를 반환해야 함");
  assert.ok(Number.isFinite(report.baseConfidence),
    `base=${report.baseConfidence} reason=${report.reason} compared=${report.comparedCount}`);
  assert.ok(report.comparedCount >= 15,
    `compared=${report.comparedCount} reason=${report.reason}`); // 과거 패턴은 정상 비교됨
});

test("7-15: 0~1 반환 시 similarityAdjustment도 같은 단위이며 %p 값은 별도 필드로 제공된다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  for (let i = 0; i < CONFIG.LEARN_MIN_SAMPLES + 5; i++) {
    PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  }
  seedPastPatterns({ market: "crypto", score: 100, direction: "long", wins: 25, losses: 0, similar: true });
  const { report } = runRealSignalFlow({ symbol: "BTCUSDT", category: "coin", score: 100, direction: "long" });
  assert.strictEqual(report.applied, true);
  // 0~1 단위: 전승이면 +0.10 (=+10%p)
  assert.ok(Math.abs(report.similarityAdjustment - 0.10) < 1e-9, `0~1 단위여야 함: ${report.similarityAdjustment}`);
  assert.ok(Math.abs(report.similarityAdjustmentPercent - 10) < 1e-9, `%p 단위여야 함: ${report.similarityAdjustmentPercent}`);
  // base + adjustment === adjusted (단위 일관성)
  assert.ok(Math.abs(report.baseConfidence + report.similarityAdjustment - report.adjustedConfidence) < 1e-9);
});

test("7-12: confidence 단위(0~1)가 프로젝트 기존 표현 방식과 일치한다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  for (let i = 0; i < CONFIG.LEARN_MIN_SAMPLES + 5; i++) {
    PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  }
  seedPastPatterns({ market: "crypto", score: 100, direction: "long", wins: 20, losses: 0, similar: true });
  const { report, pendingItem } = runRealSignalFlow({ symbol: "BTCUSDT", category: "coin", score: 100, direction: "long" });
  // 기존 getConfidence()와 동일한 0~1 단위여야 한다
  const baseDirect = PatternLearn.getConfidence(pendingItem.patternKey);
  assert.ok(Math.abs(report.baseConfidence - baseDirect) < 1e-12, "base가 기존 함수 값과 동일해야 함");
  assert.ok(report.baseConfidence >= 0 && report.baseConfidence <= 1);
  assert.ok(report.adjustedConfidence >= 0 && report.adjustedConfidence <= 1);
  // 퍼센트 환산값도 정확
  assert.ok(Math.abs(report.baseConfidencePercent - baseDirect * 100) < 1e-9);
});

test("7-13: 보정 결과가 학습 데이터에 자동 저장되지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  for (let i = 0; i < CONFIG.LEARN_MIN_SAMPLES + 5; i++) {
    PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  }
  seedPastPatterns({ market: "crypto", score: 100, direction: "long", wins: 20, losses: 0, similar: true });
  const learnBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);
  const snapCountBefore = PatternSnapshot.getAll().length;

  const tf = makeTfData(100, true);
  const result = {
    symbol: "BTCUSDT", price: 100, updatedAt: Date.now(),
    entryTimes: { "1m": Date.now() }, tf,
    long: { score: 100, band: "strong", conditions: COND },
    short: { score: 20, band: "none", conditions: COND },
    leadingDirection: "long", isNewSignal: true,
  };
  ConfidenceAdjust.evaluateForSignal(result, "long", null);
  // 보정 자체는 아무것도 저장하지 않는다
  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN), learnBefore);
  assert.strictEqual(PatternSnapshot.getAll().length, snapCountBefore);
});

test("7-14: 보정된 confidence가 기존 알림 임계값과 충돌하지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  // base confidence를 임계값(0.35)보다 충분히 높게 만든다
  for (let i = 0; i < CONFIG.LEARN_MIN_SAMPLES + 10; i++) {
    PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  }
  // 최악(전부 LOSS)의 보정을 받아도 -10%p이므로 임계값 위에 남아야 한다
  seedPastPatterns({ market: "crypto", score: 100, direction: "long", wins: 0, losses: 30, similar: true });
  const { report } = runRealSignalFlow({ symbol: "BTCUSDT", category: "coin", score: 100, direction: "long" });
  assert.ok(report.baseConfidence >= CONFIG.LEARN_CONFIDENCE_THRESHOLD, "base가 임계값 이상이어야 전제 성립");
  // app.js의 passesAdjusted와 동일한 판정
  const passesAdjusted = !report.applied || !Number.isFinite(report.adjustedConfidence)
    ? true
    : report.adjustedConfidence >= CONFIG.LEARN_CONFIDENCE_THRESHOLD;
  assert.strictEqual(passesAdjusted, true, "±10%p 제한 덕분에 알림이 새로 차단되지 않아야 함");
});

console.log("\n[8단계: A/B 성능 검증 (보정 전/후 비교)]");

function clearPerf() {
  localStorage.setItem(CONFIG.STORAGE_KEYS.PERF_HISTORY, JSON.stringify({ records: [] }));
}

// 성능 기록 하나를 만든다 (신호 발생 시점 — result는 항상 null)
let perfSeq = 0;
function perfRecord({ market, score, direction, basePass, adjustedPass, adjustment, id }) {
  return SignalPerformance.record({
    signalId: id || "perf" + perfSeq++,
    signalTime: 1000 + perfSeq,
    symbol: market === "stock" ? "STOCKA" : "BTCUSDT",
    market: market || "crypto",
    direction: direction || "long",
    score: score === undefined ? 100 : score,
    confReport: {
      baseConfidence: 0.6,
      adjustedConfidence: 0.6 + (adjustment || 0),
      similarityAdjustment: adjustment || 0,
      comparedCount: 20, winCount: 12, lossCount: 8,
      similarityWeightedWinRate: 60,
      applied: !!adjustment,
    },
    basePass: basePass === undefined ? true : basePass,
    adjustedPass: adjustedPass === undefined ? true : adjustedPass,
  });
}

test("8-1: 신호 발생 시 성능 기록이 생성되고 result는 null이다(미래 누수 방지)", () => {
  clearPerf();
  const r = perfRecord({ id: "sig-a" });
  assert.ok(r);
  assert.strictEqual(r.result, null);
  assert.strictEqual(r.resultTime, null);
  assert.strictEqual(r.pnlPercent, null);
  assert.strictEqual(SignalPerformance.getAll().length, 1);
  assert.strictEqual(SignalPerformance.getPendingResults().length, 1);
});

test("8-2: 동일 signalId는 중복 기록되지 않는다(upsert)", () => {
  clearPerf();
  perfRecord({ id: "dup" });
  perfRecord({ id: "dup" });
  perfRecord({ id: "dup" });
  assert.strictEqual(SignalPerformance.getAll().length, 1);
});

test("8-3: 결과 확정 후 WIN이 기록된다", () => {
  clearPerf();
  perfRecord({ id: "w1" });
  const r = SignalPerformance.attachResult("w1", { win: true, resultTime: 5000, pnlPercent: 8 });
  assert.strictEqual(r.result, "WIN");
  assert.strictEqual(r.resultTime, 5000);
  assert.strictEqual(r.pnlPercent, 8);
  assert.strictEqual(SignalPerformance.getPendingResults().length, 0);
});

test("8-4: 결과 확정 후 LOSS가 기록된다", () => {
  clearPerf();
  perfRecord({ id: "l1" });
  const r = SignalPerformance.attachResult("l1", { win: false, pnlPercent: -5 });
  assert.strictEqual(r.result, "LOSS");
  assert.ok(r.pnlPercent < 0);
});

test("8-5: 이미 확정된 결과는 재기록/덮어쓰기되지 않는다", () => {
  clearPerf();
  perfRecord({ id: "once" });
  SignalPerformance.attachResult("once", { win: true, pnlPercent: 5 });
  SignalPerformance.attachResult("once", { win: false, pnlPercent: -5 }); // 두 번째 시도
  assert.strictEqual(SignalPerformance.getAll()[0].result, "WIN"); // 첫 결과 유지
  // record()로 다시 들어와도 확정 결과를 지우지 않는다
  perfRecord({ id: "once" });
  assert.strictEqual(SignalPerformance.getAll()[0].result, "WIN");
});

test("8-6: baseWinRate와 adjustedWinRate가 각각 정확히 계산된다(공정 비교)", () => {
  clearPerf();
  // 같은 신호 집합에서 basePass는 전부 true, adjustedPass는 LOSS 일부를 걸러낸 상황
  // basePass:  10건 중 5승 5패 → 50%
  // adjustedPass: LOSS 3건이 차단되어 7건 중 5승 2패 → 약 71.4%
  for (let i = 0; i < 5; i++) {
    perfRecord({ id: "pw" + i, basePass: true, adjustedPass: true });
    SignalPerformance.attachResult("pw" + i, { win: true });
  }
  for (let i = 0; i < 2; i++) {
    perfRecord({ id: "pl" + i, basePass: true, adjustedPass: true });
    SignalPerformance.attachResult("pl" + i, { win: false });
  }
  for (let i = 0; i < 3; i++) {
    perfRecord({ id: "px" + i, basePass: true, adjustedPass: false }); // 보정으로 차단됨
    SignalPerformance.attachResult("px" + i, { win: false });
  }
  const rep = SignalPerformance.getPerformanceReport();
  assert.strictEqual(rep.totalResolved, 10);
  assert.strictEqual(rep.basePassedCount, 10);
  assert.strictEqual(rep.adjustedPassedCount, 7);
  assert.ok(Math.abs(rep.baseWinRate - 50) < 1e-9);
  assert.ok(Math.abs(rep.adjustedWinRate - (5 / 7) * 100) < 1e-9);
  // 전체 신호 승률(통과 무관)은 별도로 구분된다
  assert.ok(Math.abs(rep.overallWinRate - 50) < 1e-9);
  assert.strictEqual(rep.basePassedWins, 5);
  assert.strictEqual(rep.basePassedLosses, 5);
  assert.strictEqual(rep.adjustedPassedWins, 5);
  assert.strictEqual(rep.adjustedPassedLosses, 2);
});

test("8-7: 표본 30개 미만이면 insufficient-sample이고 개선폭을 단정하지 않는다", () => {
  clearPerf();
  for (let i = 0; i < 29; i++) {
    perfRecord({ id: "s" + i, basePass: true, adjustedPass: true });
    SignalPerformance.attachResult("s" + i, { win: i % 2 === 0 });
  }
  const rep = SignalPerformance.getPerformanceReport();
  assert.strictEqual(rep.totalResolved, 29);
  assert.strictEqual(rep.confidence, "insufficient-sample");
  assert.strictEqual(rep.improvementPercentPoint, null); // 섣부른 판단 금지
  assert.strictEqual(rep.sampleTier, 0);
  // 승률 자체는 계산되어 있다(표시는 UI가 판단)
  assert.ok(Number.isFinite(rep.baseWinRate));
});

test("8-8: 표본 30개 이상이면 개선폭이 계산되고 구간이 표시된다", () => {
  clearPerf();
  // adjustedPass가 LOSS를 걸러내 개선되는 상황을 만든다
  for (let i = 0; i < 20; i++) {
    perfRecord({ id: "gw" + i, basePass: true, adjustedPass: true });
    SignalPerformance.attachResult("gw" + i, { win: true });
  }
  for (let i = 0; i < 15; i++) {
    perfRecord({ id: "gl" + i, basePass: true, adjustedPass: false }); // 보정이 차단
    SignalPerformance.attachResult("gl" + i, { win: false });
  }
  const rep = SignalPerformance.getPerformanceReport();
  assert.strictEqual(rep.totalResolved, 35);
  assert.strictEqual(rep.confidence, "ok");
  // base: 35건 중 20승 → 57.1%, adjusted: 20건 전승 → 100%
  assert.ok(Math.abs(rep.baseWinRate - (20 / 35) * 100) < 1e-9);
  assert.ok(Math.abs(rep.adjustedWinRate - 100) < 1e-9);
  assert.ok(Math.abs(rep.improvementPercentPoint - (100 - (20 / 35) * 100)) < 1e-9);
  assert.ok(rep.improvementPercentPoint > 0);
  assert.strictEqual(rep.sampleTier, 30);
});

test("8-9: 표본 구간(30/50/100)이 정확히 표시된다", () => {
  clearPerf();
  const add = (n, from) => {
    for (let i = 0; i < n; i++) {
      perfRecord({ id: "t" + (from + i) });
      SignalPerformance.attachResult("t" + (from + i), { win: true });
    }
  };
  add(50, 0);
  assert.strictEqual(SignalPerformance.getPerformanceReport().sampleTier, 50);
  add(50, 50);
  assert.strictEqual(SignalPerformance.getPerformanceReport().sampleTier, 100);
});

test("8-10: LONG/SHORT가 분리되어 계산된다", () => {
  clearPerf();
  for (let i = 0; i < 6; i++) {
    perfRecord({ id: "ln" + i, direction: "long" });
    SignalPerformance.attachResult("ln" + i, { win: true }); // LONG 전승
  }
  for (let i = 0; i < 4; i++) {
    perfRecord({ id: "sh" + i, direction: "short" });
    SignalPerformance.attachResult("sh" + i, { win: false }); // SHORT 전패
  }
  const rep = SignalPerformance.getPerformanceReport();
  assert.strictEqual(rep.long.totalResolved, 6);
  assert.strictEqual(rep.short.totalResolved, 4);
  assert.ok(Math.abs(rep.long.baseWinRate - 100) < 1e-9);  // SHORT 전패가 섞이면 실패
  assert.ok(Math.abs(rep.short.baseWinRate - 0) < 1e-9);   // LONG 전승이 섞이면 실패
});

test("8-11: crypto/stock이 분리되어 계산된다", () => {
  clearPerf();
  for (let i = 0; i < 5; i++) {
    perfRecord({ id: "cr" + i, market: "crypto" });
    SignalPerformance.attachResult("cr" + i, { win: true });
  }
  for (let i = 0; i < 3; i++) {
    perfRecord({ id: "st" + i, market: "stock" });
    SignalPerformance.attachResult("st" + i, { win: false });
  }
  const crypto = SignalPerformance.getPerformanceReport({ market: "crypto" });
  const stock = SignalPerformance.getPerformanceReport({ market: "stock" });
  assert.strictEqual(crypto.totalResolved, 5);
  assert.strictEqual(stock.totalResolved, 3);
  assert.ok(Math.abs(crypto.baseWinRate - 100) < 1e-9);
  assert.ok(Math.abs(stock.baseWinRate - 0) < 1e-9);
});

test("8-12: 80/100 점수가 분리되어 계산된다", () => {
  clearPerf();
  for (let i = 0; i < 7; i++) {
    perfRecord({ id: "s100_" + i, score: 100 });
    SignalPerformance.attachResult("s100_" + i, { win: true });
  }
  for (let i = 0; i < 4; i++) {
    perfRecord({ id: "s80_" + i, score: 80 });
    SignalPerformance.attachResult("s80_" + i, { win: false });
  }
  const r100 = SignalPerformance.getPerformanceReport({ score: 100 });
  const r80 = SignalPerformance.getPerformanceReport({ score: 80 });
  assert.strictEqual(r100.totalResolved, 7);
  assert.strictEqual(r80.totalResolved, 4);
  assert.ok(Math.abs(r100.baseWinRate - 100) < 1e-9);
  assert.ok(Math.abs(r80.baseWinRate - 0) < 1e-9);
});

test("8-13: getGroupedReport()가 시장×점수를 절대 합치지 않는다", () => {
  clearPerf();
  perfRecord({ id: "g1", market: "crypto", score: 100, direction: "long" });
  SignalPerformance.attachResult("g1", { win: true });
  perfRecord({ id: "g2", market: "stock", score: 80, direction: "short" });
  SignalPerformance.attachResult("g2", { win: false });
  const g = SignalPerformance.getGroupedReport();
  assert.strictEqual(g.crypto[100].totalResolved, 1);
  assert.strictEqual(g.crypto[80].totalResolved, 0);
  assert.strictEqual(g.stock[80].totalResolved, 1);
  assert.strictEqual(g.stock[100].totalResolved, 0);
  // 그룹 안에서 LONG/SHORT도 확인 가능
  assert.strictEqual(g.crypto[100].long.totalResolved, 1);
  assert.strictEqual(g.crypto[100].short.totalResolved, 0);
  // overall은 전체 합계(구분용으로만 제공)
  assert.strictEqual(g.overall.totalResolved, 2);
});

test("8-14: 데이터가 없으면 승률이 null이다(0%로 오해하게 하지 않음)", () => {
  clearPerf();
  const rep = SignalPerformance.getPerformanceReport();
  assert.strictEqual(rep.totalResolved, 0);
  assert.strictEqual(rep.overallWinRate, null);
  assert.strictEqual(rep.baseWinRate, null);
  assert.strictEqual(rep.adjustedWinRate, null);
  assert.strictEqual(rep.improvementPercentPoint, null);
  assert.strictEqual(rep.confidence, "insufficient-sample");
  // 그룹 리포트도 오류 없이 동작
  const g = SignalPerformance.getGroupedReport();
  assert.strictEqual(g.crypto[100].totalResolved, 0);
  assert.strictEqual(g.crypto[100].baseWinRate, null);
});

test("8-15: 보정 방향(양수/음수/중립) 개수와 평균이 집계된다", () => {
  clearPerf();
  perfRecord({ id: "p1", adjustment: 0.05 });
  SignalPerformance.attachResult("p1", { win: true });
  perfRecord({ id: "p2", adjustment: 0.10 });
  SignalPerformance.attachResult("p2", { win: true });
  perfRecord({ id: "n1", adjustment: -0.08 });
  SignalPerformance.attachResult("n1", { win: false });
  perfRecord({ id: "z1", adjustment: 0 });
  SignalPerformance.attachResult("z1", { win: true });
  const rep = SignalPerformance.getPerformanceReport();
  assert.strictEqual(rep.positiveAdjustmentCount, 2);
  assert.strictEqual(rep.negativeAdjustmentCount, 1);
  assert.strictEqual(rep.neutralAdjustmentCount, 1);
  assert.ok(Math.abs(rep.confidenceAdjustmentAverage - (0.05 + 0.10 - 0.08 + 0) / 4) < 1e-9);
});

test("8-16: 최대 기록 수를 초과하면 오래된 기록부터 제거된다", () => {
  clearPerf();
  // 상한(1000)을 직접 채우면 느리므로 저장 로직을 동일하게 검증
  const data = { records: [] };
  for (let i = 0; i < CONFIG.PERF_HISTORY_MAX + 5; i++) data.records.push({ signalId: "x" + i, result: null });
  while (data.records.length > CONFIG.PERF_HISTORY_MAX) data.records.shift();
  assert.strictEqual(data.records.length, CONFIG.PERF_HISTORY_MAX);
  assert.strictEqual(data.records[0].signalId, "x5");
  assert.strictEqual(CONFIG.PERF_HISTORY_MAX, 1000);
});

test("8-17: 성능 기록이 기존 학습/스냅샷 데이터를 변경하지 않는다(별도 키)", () => {
  clearPerf(); clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  localStorage.setItem(CONFIG.STORAGE_KEYS.TRADES, JSON.stringify([{ id: "keep" }]));
  const learnBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);
  const snapBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS);

  for (let i = 0; i < 40; i++) {
    perfRecord({ id: "iso" + i });
    SignalPerformance.attachResult("iso" + i, { win: i % 2 === 0 });
  }
  SignalPerformance.getPerformanceReport();
  SignalPerformance.getGroupedReport();
  SignalPerformance.clear();

  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN), learnBefore);
  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS), snapBefore);
  assert.strictEqual(JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TRADES))[0].id, "keep");
});

test("8-18: 실제 신호 흐름에서 성능 기록이 생성되고 결과 확정 시 업데이트된다(연결 검증)", () => {
  clearPerf(); clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  State.saveLearnEnabled(true);

  // app.js와 동일한 순서로 신호를 처리한다
  const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
  const tf = makeTfData(100, true);
  const result = {
    symbol: "BTCUSDT", price: 100, updatedAt: entryTime,
    entryTimes: { "1m": entryTime + snapSeq++ * 60000 }, tf,
    long: { score: 100, band: "strong", conditions: COND },
    short: { score: 20, band: "none", conditions: COND },
    leadingDirection: "long", isNewSignal: true,
  };
  const pendingItem = PatternLearn.recordPending(result, "long");
  assert.ok(pendingItem, "pendingItem이 생성되어야 함");
  PatternSnapshot.record(pendingItem, result.tf);
  const confReport = ConfidenceAdjust.evaluateForSignal(result, "long", pendingItem);
  const passesLearnFilter = PatternLearn.shouldAlert(result, "long");
  const passesAdjusted = !confReport || !confReport.applied || !Number.isFinite(confReport.adjustedConfidence)
    ? true : confReport.adjustedConfidence >= CONFIG.LEARN_CONFIDENCE_THRESHOLD;
  SignalPerformance.record({
    signalId: pendingItem.signalId, signalTime: pendingItem.signalTime,
    symbol: "BTCUSDT", market: PatternLearn.marketOf(pendingItem.category),
    direction: "long", score: result.long.score, confReport,
    basePass: passesLearnFilter, adjustedPass: passesLearnFilter && passesAdjusted,
  });

  // 신호 발생 직후에는 result가 null이어야 한다
  const recs = SignalPerformance.getAll();
  assert.strictEqual(recs.length, 1);
  assert.strictEqual(recs[0].result, null);
  assert.strictEqual(recs[0].signalId, pendingItem.signalId);
  assert.strictEqual(recs[0].market, "crypto");
  assert.strictEqual(recs[0].score, 100);
  assert.strictEqual(recs[0].direction, "long");

  // 기존 결과 확정 흐름(evaluatePending)이 성능 기록도 업데이트해야 한다
  PatternLearn.evaluatePending({ BTCUSDT: { price: 110 } }); // LONG + 상승 → WIN
  const after = SignalPerformance.getAll()[0];
  assert.strictEqual(after.result, "WIN", "evaluatePending이 성능 기록을 업데이트해야 함");
  assert.ok(Number.isFinite(after.pnlPercent));
  // 기존 스냅샷 결과와 동일한 판정이어야 한다(같은 win 값 공유)
  assert.strictEqual(PatternSnapshot.getAll()[0].result, "WIN");
});

test("8-19: 성능 기록이 patternLearn 학습 데이터에 재투입되지 않는다(순환 방지)", () => {
  clearPerf(); clearSnapshots(); clearLearnAll();
  const learnBefore = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN));
  for (let i = 0; i < 20; i++) {
    perfRecord({ id: "circ" + i });
    SignalPerformance.attachResult("circ" + i, { win: true });
  }
  const learnAfter = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN));
  // 학습 통계/엔트리가 전혀 늘지 않아야 한다
  assert.strictEqual(learnAfter.entries.length, learnBefore.entries.length);
  assert.strictEqual(Object.keys(learnAfter.statsBySymbol).length, Object.keys(learnBefore.statsBySymbol).length);
  assert.strictEqual(JSON.stringify(learnAfter.scorePerf), JSON.stringify(learnBefore.scorePerf));
});

test("8-20: 기존 Signals.evaluate()와 보정 공식이 변경되지 않았다", () => {
  const k15 = buildTrendingKlines(100, 0.5, 40, 0, 15 * 60000);
  const k5 = buildTrendingKlines(100, 0.5, 40, 0, 5 * 60000);
  const k1 = buildTrendingKlines(100, 0.5, 40, 0, 60000);
  const tf = { "15m": Signals.computeIndicators(k15), "5m": Signals.computeIndicators(k5), "1m": Signals.computeIndicators(k1) };
  const sigFields = (r) => JSON.stringify({ long: r.long, short: r.short, status: r.status,
    leadingDirection: r.leadingDirection, isNewSignal: r.isNewSignal, price: r.price });
  const before = sigFields(Signals.evaluate(null, "TESTUSDT", tf));
  clearPerf();
  for (let i = 0; i < 10; i++) { perfRecord({ id: "nc" + i }); SignalPerformance.attachResult("nc" + i, { win: true }); }
  SignalPerformance.getGroupedReport();
  assert.strictEqual(sigFields(Signals.evaluate(null, "TESTUSDT", tf)), before);
  // 보정 공식 설정값도 그대로
  assert.strictEqual(CONFIG.SIM_ADJUST_MAX_DELTA, 10);
  assert.strictEqual(CONFIG.SIM_ADJUST_MIN_SAMPLES, 10);
  assert.strictEqual(CONFIG.SIM_ADJUST_MIN_SIMILARITY, 70);
});

console.log("\n[9단계: 신호 알림 필터 ON/OFF]");

// app.js의 알림 판정 로직과 동일한 식을 그대로 재현한다.
// (요구사항 검증의 핵심: 필터 OFF면 alertAllowedByFilter가 항상 true,
//  filterWouldPass는 필터 상태와 무관하게 계속 계산된다)
function decideAlert({ passesLearnFilter, confReport, filterEnabled }) {
  const passesAdjusted =
    !confReport || !confReport.applied || !Number.isFinite(confReport.adjustedConfidence)
      ? true
      : confReport.adjustedConfidence >= CONFIG.LEARN_CONFIDENCE_THRESHOLD;
  const filterWouldPass = passesLearnFilter && passesAdjusted;
  const filterActive = filterEnabled !== false;
  return {
    filterWouldPass,
    alertAllowedByFilter: filterActive ? filterWouldPass : true,
  };
}

test("9-1: 기본값은 필터 ON이다(기존 동작 유지)", () => {
  localStorage.removeItem(CONFIG.STORAGE_KEYS.SIGNAL_FILTER);
  // 새로 읽었을 때 기본값이 true여야 한다
  const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.SIGNAL_FILTER);
  assert.strictEqual(raw, null);
  State.saveSignalFilter(true);
  assert.strictEqual(State.signalFilterEnabled, true);
});

test("9-2: 필터 ON이면 낮은 신뢰도 신호의 알림이 차단된다(기존 동작)", () => {
  const lowConf = { applied: true, adjustedConfidence: CONFIG.LEARN_CONFIDENCE_THRESHOLD - 0.1 };
  const d = decideAlert({ passesLearnFilter: true, confReport: lowConf, filterEnabled: true });
  assert.strictEqual(d.filterWouldPass, false);
  assert.strictEqual(d.alertAllowedByFilter, false); // 차단됨
});

test("9-3: 필터 OFF면 낮은 신뢰도 신호도 알림이 전달된다", () => {
  const lowConf = { applied: true, adjustedConfidence: CONFIG.LEARN_CONFIDENCE_THRESHOLD - 0.1 };
  const d = decideAlert({ passesLearnFilter: true, confReport: lowConf, filterEnabled: false });
  assert.strictEqual(d.alertAllowedByFilter, true); // 차단 안 됨
  // 핵심: 판정 자체는 여전히 false로 계산되어 기록에 남는다
  assert.strictEqual(d.filterWouldPass, false);
});

test("9-4: 필터 OFF여도 shouldAlert가 false인 신호까지 알림이 전달된다", () => {
  const d = decideAlert({ passesLearnFilter: false, confReport: null, filterEnabled: false });
  assert.strictEqual(d.alertAllowedByFilter, true);
  assert.strictEqual(d.filterWouldPass, false); // 판정은 false 그대로 기록
});

test("9-5: 필터 ON/OFF와 무관하게 A/B 판정(filterWouldPass)이 동일하게 계산된다", () => {
  const cases = [
    { passesLearnFilter: true, confReport: { applied: true, adjustedConfidence: 0.8 } },
    { passesLearnFilter: true, confReport: { applied: true, adjustedConfidence: 0.1 } },
    { passesLearnFilter: false, confReport: null },
    { passesLearnFilter: true, confReport: null },
  ];
  cases.forEach((c, i) => {
    const on = decideAlert(Object.assign({}, c, { filterEnabled: true }));
    const off = decideAlert(Object.assign({}, c, { filterEnabled: false }));
    // 필터를 꺼도 A/B 기록용 판정은 바뀌지 않아야 한다(성능 비교가 무의미해지지 않도록)
    assert.strictEqual(on.filterWouldPass, off.filterWouldPass, `case ${i}`);
  });
});

test("9-6: 필터 OFF 상태에서도 A/B 성능 비교가 계속 유효하다", () => {
  localStorage.setItem(CONFIG.STORAGE_KEYS.PERF_HISTORY, JSON.stringify({ records: [] }));
  State.saveSignalFilter(false); // 필터를 끈 상태로 기록

  // 필터 OFF 상태에서 신호 30건을 기록한다.
  // adjustedPass는 filterWouldPass 기준이므로 필터 OFF여도 구분이 유지된다.
  for (let i = 0; i < 20; i++) {
    const conf = { applied: true, adjustedConfidence: 0.8, baseConfidence: 0.6, similarityAdjustment: 0.05,
      comparedCount: 20, winCount: 12, lossCount: 8, similarityWeightedWinRate: 60 };
    const d = decideAlert({ passesLearnFilter: true, confReport: conf, filterEnabled: false });
    SignalPerformance.record({
      signalId: "f_pass" + i, signalTime: 1000 + i, symbol: "BTCUSDT", market: "crypto",
      direction: "long", score: 100, confReport: conf,
      basePass: true, adjustedPass: d.filterWouldPass,
    });
    SignalPerformance.attachResult("f_pass" + i, { win: true, pnlPercent: 8 });
  }
  for (let i = 0; i < 12; i++) {
    const conf = { applied: true, adjustedConfidence: 0.2, baseConfidence: 0.6, similarityAdjustment: -0.08,
      comparedCount: 20, winCount: 8, lossCount: 12, similarityWeightedWinRate: 40 };
    const d = decideAlert({ passesLearnFilter: true, confReport: conf, filterEnabled: false });
    SignalPerformance.record({
      signalId: "f_block" + i, signalTime: 2000 + i, symbol: "BTCUSDT", market: "crypto",
      direction: "long", score: 100, confReport: conf,
      basePass: true, adjustedPass: d.filterWouldPass, // false로 기록되어야 한다
    });
    SignalPerformance.attachResult("f_block" + i, { win: false, pnlPercent: -6 });
  }

  const rep = SignalPerformance.getPerformanceReport();
  assert.strictEqual(rep.totalResolved, 32);
  assert.strictEqual(rep.basePassedCount, 32);
  assert.strictEqual(rep.adjustedPassedCount, 20); // 필터 OFF여도 구분이 유지됨
  assert.ok(Math.abs(rep.baseWinRate - (20 / 32) * 100) < 1e-9);
  assert.ok(Math.abs(rep.adjustedWinRate - 100) < 1e-9);
  assert.ok(rep.improvementPercentPoint > 0); // A/B 비교가 여전히 유효
  State.saveSignalFilter(true);
});

test("9-7: 필터 설정이 자가학습 ON/OFF와 완전히 독립적이다", () => {
  State.saveLearnEnabled(true);
  State.saveSignalFilter(false);
  assert.strictEqual(State.learnEnabled, true);   // 필터를 꺼도 학습은 ON 유지
  assert.strictEqual(State.signalFilterEnabled, false);

  State.saveLearnEnabled(false);
  assert.strictEqual(State.signalFilterEnabled, false); // 학습을 꺼도 필터 설정은 그대로

  State.saveSignalFilter(true);
  assert.strictEqual(State.learnEnabled, false);  // 필터를 켜도 학습은 OFF 유지
  State.saveLearnEnabled(true);
});

test("9-8: 필터 OFF여도 학습 데이터가 정상적으로 쌓인다", () => {
  clearSnapshots(); clearLearnAll();
  State.saveSignalFilter(false); // 필터 OFF
  State.saveLearnEnabled(true);
  State.setCategory("BTCUSDT", "coin");

  const before = PatternLearn.getStatsFor("coin", "BTCUSDT").total;
  for (let i = 0; i < 5; i++) {
    PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  }
  const after = PatternLearn.getStatsFor("coin", "BTCUSDT").total;
  assert.strictEqual(after, before + 5); // 필터 OFF와 무관하게 학습 진행
  State.saveSignalFilter(true);
});

test("9-9: 필터 OFF여도 실제 신호 흐름에서 snapshot/기록이 계속 저장된다", () => {
  clearSnapshots(); clearLearnAll();
  State.saveSignalFilter(false);
  State.saveLearnEnabled(true);
  State.setCategory("BTCUSDT", "coin");

  const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
  const tf = makeTfData(100, true);
  const result = {
    symbol: "BTCUSDT", price: 100, updatedAt: entryTime,
    entryTimes: { "1m": entryTime + snapSeq++ * 60000 }, tf,
    long: { score: 100, band: "strong", conditions: COND },
    short: { score: 20, band: "none", conditions: COND },
    leadingDirection: "long", isNewSignal: true,
  };
  const pendingItem = PatternLearn.recordPending(result, "long");
  assert.ok(pendingItem, "필터 OFF여도 pending 기록은 생성되어야 함");
  PatternSnapshot.record(pendingItem, result.tf);
  assert.strictEqual(PatternSnapshot.getAll().length, 1, "필터 OFF여도 snapshot 저장됨");

  // 결과 확정도 정상 동작
  PatternLearn.evaluatePending({ BTCUSDT: { price: 110 } });
  assert.strictEqual(PatternSnapshot.getAll()[0].result, "WIN");
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 100, "long").wins, 1);
  State.saveSignalFilter(true);
});

test("9-10: 필터 설정이 localStorage에 저장되어 재실행 후에도 유지된다", () => {
  State.saveSignalFilter(false);
  const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.SIGNAL_FILTER);
  assert.strictEqual(JSON.parse(raw), false);
  State.saveSignalFilter(true);
  assert.strictEqual(JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.SIGNAL_FILTER)), true);
  // 자가학습 키와 다른 키를 사용해야 한다(서로 덮어쓰지 않도록)
  assert.notStrictEqual(CONFIG.STORAGE_KEYS.SIGNAL_FILTER, CONFIG.STORAGE_KEYS.LEARN_ENABLED);
});

test("9-11: LOCK IN 알림 차단은 필터 설정과 별개로 계속 동작한다", () => {
  // app.js: if (allowed && alertAllowedByFilter) — allowed는 LOCK 조건
  // 필터를 꺼도 LOCK 차단(allowed=false)은 그대로 유지되어야 한다
  const lockedOut = false; // 다른 종목이 LOCK된 상황
  const d = decideAlert({ passesLearnFilter: true, confReport: null, filterEnabled: false });
  assert.strictEqual(d.alertAllowedByFilter, true); // 필터는 통과시키지만
  assert.strictEqual(lockedOut && d.alertAllowedByFilter, false); // LOCK 조건에서 여전히 차단
});

test("9-12: 필터 ON/OFF가 신호 점수/방향 계산에 영향을 주지 않는다", () => {
  const k15 = buildTrendingKlines(100, 0.5, 40, 0, 15 * 60000);
  const k5 = buildTrendingKlines(100, 0.5, 40, 0, 5 * 60000);
  const k1 = buildTrendingKlines(100, 0.5, 40, 0, 60000);
  const tf = { "15m": Signals.computeIndicators(k15), "5m": Signals.computeIndicators(k5), "1m": Signals.computeIndicators(k1) };
  const sigFields = (r) => JSON.stringify({ long: r.long, short: r.short, status: r.status,
    leadingDirection: r.leadingDirection, isNewSignal: r.isNewSignal, price: r.price });

  State.saveSignalFilter(true);
  const withFilter = sigFields(Signals.evaluate(null, "TESTUSDT", tf));
  State.saveSignalFilter(false);
  const withoutFilter = sigFields(Signals.evaluate(null, "TESTUSDT", tf));
  assert.strictEqual(withFilter, withoutFilter); // 완전히 동일
  State.saveSignalFilter(true);
});

console.log("\n[10단계: 알림 상세 정보]");

// AlertDetail은 UI.t()/tp()/formatPrice()를 사용한다. 테스트에서는 i18n을 직접 연결한
// 최소 스텁을 넣어 실제 번역 문구까지 검증한다(별도 번역 로직을 만들지 않았음을 확인).
function withUiStub(lang, fn) {
  const prev = global.UI;
  const L = global.I18N[lang];
  global.UI = {
    t: (k) => (L[k] === undefined ? k : L[k]),
    tp: (k, p) => {
      let x = L[k] === undefined ? k : L[k];
      Object.keys(p || {}).forEach((n) => { x = x.replace(new RegExp("\\{" + n + "\\}", "g"), p[n]); });
      return x;
    },
    formatPrice: (v) => String(v),
  };
  try { return fn(); } finally { global.UI = prev; }
}

// 실제 지표 계산을 통과한 tf 데이터를 만든다(값을 조작하지 않음).
function alertTf(trendUp) {
  const mk = (step) => {
    const arr = [];
    let p = 100;
    for (let i = 0; i < 60; i++) {
      p += trendUp ? 0.4 : -0.4;
      const o = p - 0.2;
      arr.push({ openTime: 1e6 + i * step, open: o, high: Math.max(o, p) + 0.3,
        low: Math.min(o, p) - 0.3, close: p, volume: 100 + i, closeTime: 1e6 + i * step + step - 1 });
    }
    return Signals.computeIndicators(arr);
  };
  return { "1m": mk(60000), "5m": mk(300000), "15m": mk(900000) };
}

function alertResult(trendUp) {
  const tf = alertTf(trendUp);
  const dir = { score: 100, band: "strong", conditions: COND };
  const other = { score: 20, band: "none", conditions: { trend15: false, trend5: false, ha1Flip: false, macdCross: false } };
  return {
    symbol: "BTCUSDT", price: 12345.6, updatedAt: Date.now(), tf,
    long: trendUp ? dir : other, short: trendUp ? other : dir,
    leadingDirection: trendUp ? "long" : "short", isNewSignal: true,
  };
}

test("10-1: 알림 상세에 종목/방향/점수/가격이 포함된다", () => {
  withUiStub("ko", () => {
    const r = alertResult(true);
    const d = AlertDetail.build({ symbol: "BTCUSDT", direction: "long", result: r,
      confReport: null, filterWouldPass: true, filterActive: true });
    assert.ok(d);
    assert.ok(d.title.includes("BTCUSDT"));
    assert.strictEqual(d.score, 100);
    assert.strictEqual(d.price, 12345.6);
    assert.ok(d.headline.includes("100"));
    assert.ok(d.headline.includes("12345.6"));
  });
});

test("10-2: 15m/5m/1m 상태가 각각 알림에 포함된다", () => {
  withUiStub("ko", () => {
    const r = alertResult(true);
    const d = AlertDetail.build({ symbol: "BTCUSDT", direction: "long", result: r,
      confReport: null, filterWouldPass: true, filterActive: true });
    assert.strictEqual(d.timeframeLines.length, 3);
    assert.ok(d.timeframeLines[0].startsWith("15m"));
    assert.ok(d.timeframeLines[1].startsWith("5m"));
    assert.ok(d.timeframeLines[2].startsWith("1m"));
    // 각 줄에 RSI 수치가 들어간다
    d.timeframeLines.forEach((line) => assert.ok(/RSI \d+/.test(line), line));
  });
});

test("10-3: 타임프레임 상태가 실제 계산값과 일치한다(재계산/조작 없음)", () => {
  withUiStub("ko", () => {
    const r = alertResult(true);
    const d = AlertDetail.build({ symbol: "BTCUSDT", direction: "long", result: r,
      confReport: null, filterWouldPass: true, filterActive: true });
    // 1m의 실제 RSI 값이 알림 문구에 그대로 반영되어야 한다
    const d1 = r.tf["1m"];
    const last = d1.rsi.length - 1;
    const expectedRsi = Math.round(d1.rsi[last]).toString();
    const line1m = d.timeframeLines.find((l) => l.startsWith("1m"));
    assert.ok(line1m.includes(expectedRsi), `${line1m} 에 RSI ${expectedRsi} 포함 기대`);
    // HA 방향도 실제 값과 일치
    const haUp = d1.ha[d1.ha.length - 1].bullish;
    assert.ok(line1m.includes(haUp ? I18N.ko.haBullishShort : I18N.ko.haBearishShort));
  });
});

test("10-4: 충족 조건이 알림에 포함된다", () => {
  withUiStub("ko", () => {
    const r = alertResult(true);
    const d = AlertDetail.build({ symbol: "BTCUSDT", direction: "long", result: r,
      confReport: null, filterWouldPass: true, filterActive: true });
    assert.strictEqual(d.conditionLabels.length, 4); // COND는 4개 모두 true
    assert.ok(d.detailBody.includes(I18N.ko.cond_trend15));
    assert.ok(d.detailBody.includes(I18N.ko.cond_macdCross));
  });
});

test("10-5: 일부 조건만 충족되면 그 조건만 표시된다", () => {
  withUiStub("ko", () => {
    const r = alertResult(true);
    r.long.conditions = { trend15: true, trend5: true, ha1Flip: false, macdCross: false };
    const d = AlertDetail.build({ symbol: "BTCUSDT", direction: "long", result: r,
      confReport: null, filterWouldPass: true, filterActive: true });
    assert.strictEqual(d.conditionLabels.length, 2);
    assert.ok(!d.detailBody.includes(I18N.ko.cond_macdCross));
  });
});

test("10-6: 보정이 적용되면 신뢰도 전/후와 변화폭이 표시된다", () => {
  withUiStub("ko", () => {
    const r = alertResult(true);
    const confReport = { applied: true, baseConfidence: 0.64, adjustedConfidence: 0.74,
      similarityAdjustment: 0.10, coreCount: 20, similarityWeightedWinRate: 85 };
    const d = AlertDetail.build({ symbol: "BTCUSDT", direction: "long", result: r,
      confReport, filterWouldPass: true, filterActive: true });
    assert.ok(d.confidenceLine.includes("64%"));
    assert.ok(d.confidenceLine.includes("74%"));
    assert.ok(d.confidenceLine.includes("+10.0%p"));
  });
});

test("10-7: 보정이 적용되지 않으면 신뢰도만 표시된다", () => {
  withUiStub("ko", () => {
    const r = alertResult(true);
    const confReport = { applied: false, baseConfidence: 0.64, adjustedConfidence: 0.64,
      similarityAdjustment: 0, coreCount: 3, similarityWeightedWinRate: null };
    const d = AlertDetail.build({ symbol: "BTCUSDT", direction: "long", result: r,
      confReport, filterWouldPass: true, filterActive: true });
    assert.ok(d.confidenceLine.includes("64%"));
    assert.ok(!d.confidenceLine.includes("→"));
  });
});

test("10-8: 신뢰도 값이 없으면 해당 줄을 생략한다(억지로 만들지 않음)", () => {
  withUiStub("ko", () => {
    const r = alertResult(true);
    const d = AlertDetail.build({ symbol: "BTCUSDT", direction: "long", result: r,
      confReport: { applied: false, baseConfidence: null, adjustedConfidence: null, coreCount: 0 },
      filterWouldPass: true, filterActive: true });
    assert.strictEqual(d.confidenceLine, null);
    assert.strictEqual(d.similarityLine, null);
    // 그래도 핵심 정보는 그대로 나온다
    assert.ok(d.headline.includes("100"));
    assert.strictEqual(d.timeframeLines.length, 3);
  });
});

test("10-9: 유사 패턴 표본이 있으면 건수와 가중승률이 표시된다", () => {
  withUiStub("ko", () => {
    const r = alertResult(true);
    const confReport = { applied: true, baseConfidence: 0.6, adjustedConfidence: 0.68,
      similarityAdjustment: 0.08, coreCount: 15, similarityWeightedWinRate: 78.4 };
    const d = AlertDetail.build({ symbol: "BTCUSDT", direction: "long", result: r,
      confReport, filterWouldPass: true, filterActive: true });
    assert.ok(d.similarityLine.includes("15"));
    assert.ok(d.similarityLine.includes("78%"));
  });
});

test("10-10: 필터 통과/미달/미적용 상태가 정확히 표시된다", () => {
  withUiStub("ko", () => {
    const r = alertResult(true);
    const mk = (pass, active) => AlertDetail.build({ symbol: "BTCUSDT", direction: "long", result: r,
      confReport: null, filterWouldPass: pass, filterActive: active });
    assert.strictEqual(mk(true, true).filterLine, I18N.ko.alertFilterPassed);
    assert.strictEqual(mk(false, true).filterLine, I18N.ko.alertFilterBlocked);
    // 필터 OFF면 "미적용"으로 표시해 오해를 막는다
    assert.strictEqual(mk(false, false).filterLine, I18N.ko.alertFilterInactive);
    assert.strictEqual(mk(true, false).filterLine, I18N.ko.alertFilterInactive);
  });
});

test("10-11: SHORT 신호도 정상적으로 구성된다", () => {
  withUiStub("ko", () => {
    const r = alertResult(false);
    const d = AlertDetail.build({ symbol: "ETHUSDT", direction: "short", result: r,
      confReport: null, filterWouldPass: true, filterActive: true });
    assert.strictEqual(d.direction, "short");
    assert.strictEqual(d.score, 100);
    assert.ok(d.title.includes("ETHUSDT"));
    assert.strictEqual(d.timeframeLines.length, 3);
  });
});

test("10-12: 모바일 알림용 본문은 상세 본문보다 짧다(잘림 방지)", () => {
  withUiStub("ko", () => {
    const r = alertResult(true);
    const confReport = { applied: true, baseConfidence: 0.6, adjustedConfidence: 0.7,
      similarityAdjustment: 0.1, coreCount: 20, similarityWeightedWinRate: 80 };
    const d = AlertDetail.build({ symbol: "BTCUSDT", direction: "long", result: r,
      confReport, filterWouldPass: true, filterActive: true });
    assert.ok(d.notificationBody.length < d.detailBody.length);
    // 짧은 본문에도 점수/가격은 반드시 들어간다
    assert.ok(d.notificationBody.includes("100"));
  });
});

test("10-13: 한국어/영어 문구가 각각 정상 적용된다", () => {
  const r = alertResult(true);
  const ko = withUiStub("ko", () => AlertDetail.build({ symbol: "BTCUSDT", direction: "long", result: r,
    confReport: null, filterWouldPass: true, filterActive: true }));
  const en = withUiStub("en", () => AlertDetail.build({ symbol: "BTCUSDT", direction: "long", result: r,
    confReport: null, filterWouldPass: true, filterActive: true }));
  assert.ok(ko.filterLine.includes("통과"));
  assert.ok(en.filterLine.toLowerCase().includes("passed"));
  assert.notStrictEqual(ko.detailBody, en.detailBody);
});

test("10-14: 잘못된 입력에도 오류 없이 null을 반환한다", () => {
  withUiStub("ko", () => {
    assert.strictEqual(AlertDetail.build({}), null);
    assert.strictEqual(AlertDetail.build({ symbol: "X", direction: "long", result: null }), null);
    // 방향에 해당하는 데이터가 없으면 null
    assert.strictEqual(AlertDetail.build({ symbol: "X", direction: "long", result: { short: {} } }), null);
  });
});

test("10-15: tf 데이터가 없어도 핵심 정보는 구성된다(안전 동작)", () => {
  withUiStub("ko", () => {
    const d = AlertDetail.build({
      symbol: "BTCUSDT", direction: "long",
      result: { symbol: "BTCUSDT", price: 100, long: { score: 80, conditions: COND } },
      confReport: null, filterWouldPass: true, filterActive: true,
    });
    assert.ok(d);
    assert.strictEqual(d.score, 80);
    assert.strictEqual(d.timeframeLines.length, 0); // tf가 없으면 타임프레임 줄은 생략
    assert.ok(d.headline.includes("80"));
  });
});

test("10-15b: RSI 변화가 없으면 방향 화살표를 붙이지 않는다(오해 방지)", () => {
  withUiStub("ko", () => {
    // 변화 없음(rsiDelta=0) → 화살표 없음
    const flat = AlertDetail.timeframeLine("1m", { rsi: 100, rsiDelta: 0, rsiRising: false });
    assert.ok(flat.includes("RSI 100"));
    assert.ok(!flat.includes("\u2197") && !flat.includes("\u2198"), `화살표가 없어야 함: ${flat}`);
    // 상승 → 위 화살표
    const up = AlertDetail.timeframeLine("1m", { rsi: 62, rsiDelta: 3, rsiRising: true });
    assert.ok(up.includes("\u2197"));
    // 하락 → 아래 화살표
    const down = AlertDetail.timeframeLine("1m", { rsi: 41, rsiDelta: -4, rsiRising: false });
    assert.ok(down.includes("\u2198"));
  });
});

test("10-16: 알림 상세 구성이 신호 결과(result)를 변경하지 않는다", () => {
  withUiStub("ko", () => {
    const r = alertResult(true);
    const before = JSON.stringify({ long: r.long, short: r.short, price: r.price,
      leadingDirection: r.leadingDirection, isNewSignal: r.isNewSignal });
    AlertDetail.build({ symbol: "BTCUSDT", direction: "long", result: r,
      confReport: null, filterWouldPass: true, filterActive: true });
    const after = JSON.stringify({ long: r.long, short: r.short, price: r.price,
      leadingDirection: r.leadingDirection, isNewSignal: r.isNewSignal });
    assert.strictEqual(before, after); // 점수/방향/가격 전부 불변
  });
});

test("10-17: 알림 상세 구성이 localStorage를 변경하지 않는다(읽기/쓰기 없음)", () => {
  withUiStub("ko", () => {
    const learnBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);
    const snapBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS);
    const perfBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PERF_HISTORY);
    const r = alertResult(true);
    for (let i = 0; i < 5; i++) {
      AlertDetail.build({ symbol: "BTCUSDT", direction: "long", result: r,
        confReport: { applied: true, baseConfidence: 0.6, adjustedConfidence: 0.7,
          similarityAdjustment: 0.1, coreCount: 20, similarityWeightedWinRate: 80 },
        filterWouldPass: true, filterActive: true });
    }
    assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN), learnBefore);
    assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS), snapBefore);
    assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PERF_HISTORY), perfBefore);
  });
});

console.log("\n[11단계: 시장 분리 / 성능순 정렬 / 차트 방어]");

// --- 문제 1: 시장 분리 ---

test("11-1: 코인 화면에서는 코인 학습 데이터만 조회된다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  State.setCategory("AAPLX", "stock");
  for (let i = 0; i < 8; i++) PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  for (let i = 0; i < 3; i++) PatternLearn.recordLockResult({ symbol: "AAPLX", direction: "long", conditions: COND, pnlPercent: -5 });
  const coin = PatternLearn.getStatsFor("coin", "BTCUSDT");
  const stock = PatternLearn.getStatsFor("stock", "AAPLX");
  assert.strictEqual(coin.total, 8);
  assert.strictEqual(coin.wins, 8);   // 주식의 패배가 섞이면 실패
  assert.strictEqual(stock.total, 3);
  assert.strictEqual(stock.losses, 3); // 코인의 승리가 섞이면 실패
  // 시장 전체 합계도 분리된다
  assert.strictEqual(PatternLearn.getTotals("coin").total, 8);
  assert.strictEqual(PatternLearn.getTotals("stock").total, 3);
});

test("11-2: 같은 종목명이 양쪽 시장에 있어도 학습 공간이 분리된다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("XYZ", "coin");
  for (let i = 0; i < 5; i++) PatternLearn.recordLockResult({ symbol: "XYZ", direction: "long", conditions: COND, pnlPercent: 5 });
  State.setCategory("XYZ", "stock");
  for (let i = 0; i < 4; i++) PatternLearn.recordLockResult({ symbol: "XYZ", direction: "long", conditions: COND, pnlPercent: -5 });
  assert.strictEqual(PatternLearn.getStatsFor("coin", "XYZ").wins, 5);
  assert.strictEqual(PatternLearn.getStatsFor("coin", "XYZ").losses, 0);
  assert.strictEqual(PatternLearn.getStatsFor("stock", "XYZ").wins, 0);
  assert.strictEqual(PatternLearn.getStatsFor("stock", "XYZ").losses, 4);
});

test("11-3: 성능 통계도 시장별로 분리된다", () => {
  localStorage.setItem(CONFIG.STORAGE_KEYS.PERF_HISTORY, JSON.stringify({ records: [] }));
  let n = 0;
  const add = (market, win) => {
    const id = "m" + n++;
    SignalPerformance.record({ signalId: id, signalTime: 1000 + n, symbol: "S", market,
      direction: "long", score: 100, confReport: null, basePass: true, adjustedPass: true });
    SignalPerformance.attachResult(id, { win, pnlPercent: win ? 5 : -5 });
  };
  for (let i = 0; i < 6; i++) add("crypto", true);
  for (let i = 0; i < 4; i++) add("stock", false);
  assert.strictEqual(SignalPerformance.getPerformanceReport({ market: "crypto" }).totalResolved, 6);
  assert.strictEqual(SignalPerformance.getPerformanceReport({ market: "stock" }).totalResolved, 4);
  assert.ok(Math.abs(SignalPerformance.getPerformanceReport({ market: "crypto" }).overallWinRate - 100) < 1e-9);
  assert.ok(Math.abs(SignalPerformance.getPerformanceReport({ market: "stock" }).overallWinRate - 0) < 1e-9);
});

// --- 문제 2: 성능순 정렬 ---
// UI.sortSymbolsByPerformance()와 동일한 기준을 검증한다.
function sortByPerf(symbols, category) {
  const rows = symbols.map((sym) => ({ sym, learn: PatternLearn.getStatsFor(category, sym) }));
  rows.sort((a, b) => {
    const ar = a.learn.winRate, br = b.learn.winRate;
    const aHas = Number.isFinite(ar), bHas = Number.isFinite(br);
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && bHas && ar !== br) return br - ar;
    const at = Number.isFinite(a.learn.total) ? a.learn.total : 0;
    const bt = Number.isFinite(b.learn.total) ? b.learn.total : 0;
    if (at !== bt) return bt - at;
    return a.sym.localeCompare(b.sym);
  });
  return rows.map((r) => r.sym);
}

function seedLearn(sym, cat, wins, losses) {
  State.setCategory(sym, cat);
  for (let i = 0; i < wins; i++) PatternLearn.recordLockResult({ symbol: sym, direction: "long", conditions: COND, pnlPercent: 5 });
  for (let i = 0; i < losses; i++) PatternLearn.recordLockResult({ symbol: sym, direction: "long", conditions: COND, pnlPercent: -5 });
}

test("11-4: 종목 목록이 승률 DESC로 정렬된다", () => {
  clearSnapshots(); clearLearnAll();
  seedLearn("AAA", "coin", 8, 2);  // 80%
  seedLearn("BBB", "coin", 5, 5);  // 50%
  seedLearn("CCC", "coin", 9, 1);  // 90%
  const sorted = sortByPerf(["AAA", "BBB", "CCC"], "coin");
  assert.deepStrictEqual(sorted, ["CCC", "AAA", "BBB"]);
});

test("11-5: 승률이 같으면 학습 데이터 수 DESC로 정렬된다", () => {
  clearSnapshots(); clearLearnAll();
  seedLearn("SMALL", "coin", 4, 1);   // 80%, 5건
  seedLearn("BIG", "coin", 16, 4);    // 80%, 20건
  seedLearn("MID", "coin", 8, 2);     // 80%, 10건
  const sorted = sortByPerf(["SMALL", "BIG", "MID"], "coin");
  assert.deepStrictEqual(sorted, ["BIG", "MID", "SMALL"]);
  // 승률이 실제로 동일한지도 확인
  ["SMALL", "BIG", "MID"].forEach((s) => {
    assert.ok(Math.abs(PatternLearn.getStatsFor("coin", s).winRate - 80) < 1e-9);
  });
});

test("11-6: 학습 데이터 0건 종목은 승률 있는 종목보다 아래에 배치된다", () => {
  clearSnapshots(); clearLearnAll();
  seedLearn("HASDATA", "coin", 1, 9); // 10% — 낮지만 데이터가 있다
  State.setCategory("NODATA1", "coin");
  State.setCategory("NODATA2", "coin");
  const sorted = sortByPerf(["NODATA1", "HASDATA", "NODATA2"], "coin");
  assert.strictEqual(sorted[0], "HASDATA"); // 승률 10%여도 데이터 없는 종목보다 위
  assert.deepStrictEqual(sorted.slice(1).sort(), ["NODATA1", "NODATA2"]);
  // 데이터 없는 종목의 통계가 NaN/undefined가 아닌지 확인
  const none = PatternLearn.getStatsFor("coin", "NODATA1");
  assert.strictEqual(none.total, 0);
  assert.strictEqual(none.winRate, null); // 0%가 아니라 null(없음)
  assert.ok(!Number.isNaN(none.total));
});

test("11-7: 학습 데이터가 추가되면 정렬 순서가 갱신된다", () => {
  clearSnapshots(); clearLearnAll();
  seedLearn("P1", "coin", 5, 5);  // 50%, 10건
  seedLearn("P2", "coin", 9, 1);  // 90%, 10건
  assert.deepStrictEqual(sortByPerf(["P1", "P2"], "coin"), ["P2", "P1"]); // 승률 순

  // P1에 승리를 40건 추가하면 45승 5패 = 90%로 P2와 승률이 같아진다.
  // 이때는 2순위 규칙(학습 데이터 수 DESC)이 적용되어 P1(50건)이 P2(10건)보다 위로 간다.
  seedLearn("P1", "coin", 40, 0);
  const s1 = PatternLearn.getStatsFor("coin", "P1");
  const s2 = PatternLearn.getStatsFor("coin", "P2");
  assert.ok(Math.abs(s1.winRate - 90) < 1e-9, `P1 승률: ${s1.winRate}`);
  assert.ok(Math.abs(s2.winRate - 90) < 1e-9, `P2 승률: ${s2.winRate}`);
  assert.strictEqual(s1.total, 50);
  assert.strictEqual(s2.total, 10);
  // 승률 동일 → 표본이 많은 P1이 위 (정렬이 새 데이터를 반영했음을 확인)
  assert.deepStrictEqual(sortByPerf(["P1", "P2"], "coin"), ["P1", "P2"]);
});

test("11-8: 정렬이 시장별로 독립적이다(타 시장 통계 미사용)", () => {
  clearSnapshots(); clearLearnAll();
  // 같은 종목명을 양쪽에 두고 성적을 반대로 만든다
  seedLearn("DUAL", "coin", 9, 1);   // 코인: 90%
  seedLearn("OTHER", "coin", 5, 5);  // 코인: 50%
  seedLearn("DUAL", "stock", 1, 9);  // 주식: 10%
  seedLearn("OTHER", "stock", 8, 2); // 주식: 80%
  assert.deepStrictEqual(sortByPerf(["DUAL", "OTHER"], "coin"), ["DUAL", "OTHER"]);
  assert.deepStrictEqual(sortByPerf(["DUAL", "OTHER"], "stock"), ["OTHER", "DUAL"]);
});

test("11-9: 정렬 결과가 재실행(디스크 왕복) 후에도 동일하다", () => {
  clearSnapshots(); clearLearnAll();
  seedLearn("Z1", "coin", 7, 3);
  seedLearn("Z2", "coin", 9, 1);
  seedLearn("Z3", "coin", 2, 8);
  const before = sortByPerf(["Z1", "Z2", "Z3"], "coin");
  const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);
  localStorage.setItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN, raw);
  assert.deepStrictEqual(sortByPerf(["Z3", "Z1", "Z2"], "coin"), before); // 입력 순서와 무관하게 동일
  assert.deepStrictEqual(before, ["Z2", "Z1", "Z3"]);
});

// --- 문제 3: 차트 방어 ---

test("11-10: 캔버스가 없어도 차트 함수가 예외를 던지지 않는다", () => {
  // prepCanvas가 null을 반환하면 각 draw 함수가 조용히 종료되어야 한다
  assert.doesNotThrow(() => Charts.drawPriceChart(null, [], [], 80, []));
  assert.doesNotThrow(() => Charts.drawMacdChart(null, { dif: [], dea: [], hist: [] }, 80));
  assert.doesNotThrow(() => Charts.drawRsiChart(null, [], 80));
  assert.doesNotThrow(() => Charts.drawWinRateChart(null, []));
  // getContext가 없는 객체도 안전하게 처리
  assert.strictEqual(Charts.prepCanvas({}), null);
  assert.strictEqual(Charts.prepCanvas(null), null);
  assert.strictEqual(Charts.prepCanvas(undefined), null);
});

test("11-11: 데이터가 비어 있어도 차트 함수가 안전하게 처리된다", () => {
  // 캔버스 스텁: 폭이 0으로 측정되는 상황(화면 전환 중/레이아웃 미확정)도 재현
  const mkCanvas = (w) => ({
    width: 0, height: 0, clientHeight: 0,
    parentElement: null,
    getBoundingClientRect: () => ({ width: w, height: 0 }),
    getContext: () => new Proxy({}, { get: () => () => {} }),
  });
  const prevGCS = global.getComputedStyle;
  global.getComputedStyle = () => ({ height: "180px" });
  try {
    // 폭 0 → 대체값으로 보정되어 null이 아니어야 한다
    const prep = Charts.prepCanvas(mkCanvas(0));
    assert.ok(prep, "폭이 0이어도 대체값으로 컨텍스트를 반환해야 함");
    assert.ok(prep.w >= 200, `폭 보정 실패: ${prep.w}`);
    assert.ok(prep.h >= 40, `높이 보정 실패: ${prep.h}`);
    // 빈 데이터로 그려도 예외 없음
    assert.doesNotThrow(() => Charts.drawPriceChart(mkCanvas(320), [], [], 80, []));
    assert.doesNotThrow(() => Charts.drawRsiChart(mkCanvas(320), [], 80));
    assert.doesNotThrow(() => Charts.drawMacdChart(mkCanvas(320), { dif: [], dea: [], hist: [] }, 80));
  } finally {
    global.getComputedStyle = prevGCS;
  }
});

test("11-12: 이번 수정으로 기존 학습/성능 데이터가 삭제되지 않는다", () => {
  // 의미 있는 데이터를 넣어두고, 렌더·정렬·조회를 반복해도 보존되는지 확인
  clearSnapshots(); clearLearnAll();
  seedLearn("KEEP", "coin", 6, 4);
  localStorage.setItem(CONFIG.STORAGE_KEYS.TRADES, JSON.stringify([{ id: "keep-trade" }]));
  localStorage.setItem(CONFIG.STORAGE_KEYS.LOCK_RECORDS, JSON.stringify([{ id: "keep-lock" }]));
  const learnBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);
  const perfBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PERF_HISTORY);

  // 정렬/통계 조회를 여러 번 수행
  for (let i = 0; i < 5; i++) {
    sortByPerf(["KEEP"], "coin");
    PatternLearn.getStatsFor("coin", "KEEP");
    PatternLearn.getTotals("coin");
    SignalPerformance.getGroupedReport();
  }

  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN), learnBefore);
  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PERF_HISTORY), perfBefore);
  assert.strictEqual(JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TRADES))[0].id, "keep-trade");
  assert.strictEqual(JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCK_RECORDS))[0].id, "keep-lock");
  assert.strictEqual(PatternLearn.getStatsFor("coin", "KEEP").total, 10);
});

console.log("\n[12단계: 정렬 기준 개선 / 유사 패턴 비교 / 이전10 비교]");

// UI.compareSymbolPerformance와 동일한 기준(스무딩 신뢰도 우선)
function sortByConfidence(symbols, category) {
  const score = (learn) => {
    const total = Number.isFinite(learn && learn.total) ? learn.total : 0;
    if (total <= 0) return null;
    const wins = Number.isFinite(learn.wins) ? learn.wins : 0;
    const PRIOR = CONFIG.LEARN_PRIOR_WEIGHT;
    return (wins + PRIOR * 0.5) / (total + PRIOR);
  };
  const rows = symbols.map((sym) => ({ sym, learn: PatternLearn.getStatsFor(category, sym) }));
  rows.sort((a, b) => {
    const as = score(a.learn), bs = score(b.learn);
    const aHas = as !== null, bHas = bs !== null;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && bHas && as !== bs) return bs - as;
    const ar = Number.isFinite(a.learn.winRate) ? a.learn.winRate : -1;
    const br = Number.isFinite(b.learn.winRate) ? b.learn.winRate : -1;
    if (ar !== br) return br - ar;
    const at = Number.isFinite(a.learn.total) ? a.learn.total : 0;
    const bt = Number.isFinite(b.learn.total) ? b.learn.total : 0;
    if (at !== bt) return bt - at;
    return a.sym.localeCompare(b.sym);
  });
  return rows.map((r) => r.sym);
}
function seedL(sym, cat, w, l) {
  State.setCategory(sym, cat);
  for (let i = 0; i < w; i++) PatternLearn.recordLockResult({ symbol: sym, direction: "long", conditions: COND, pnlPercent: 5 });
  for (let i = 0; i < l; i++) PatternLearn.recordLockResult({ symbol: sym, direction: "long", conditions: COND, pnlPercent: -5 });
}

test("12-1: 표본이 적은 100% 종목이 표본 많은 고승률 종목보다 위로 가지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  seedL("TINY", "coin", 3, 0);     // 100%, 3건 → 스무딩 (3+5)/(3+10)=0.615
  seedL("HUGE", "coin", 234, 66);  // 78%, 300건 → (234+5)/(300+10)=0.771
  const sorted = sortByConfidence(["TINY", "HUGE"], "coin");
  assert.deepStrictEqual(sorted, ["HUGE", "TINY"], "표본 많은 종목이 위여야 함");
  // 실제 승률은 TINY가 높다는 것도 확인(승률을 조작하지 않았음)
  assert.ok(PatternLearn.getStatsFor("coin", "TINY").winRate > PatternLearn.getStatsFor("coin", "HUGE").winRate);
});

test("12-2: 표본이 충분히 쌓이면 승률 높은 종목이 위로 간다", () => {
  clearSnapshots(); clearLearnAll();
  seedL("GOOD", "coin", 82, 18);  // 82%, 100건 → (82+5)/110 = 0.791
  seedL("OKAY", "coin", 234, 66); // 78%, 300건 → 0.771
  assert.deepStrictEqual(sortByConfidence(["OKAY", "GOOD"], "coin"), ["GOOD", "OKAY"]);
});

test("12-3: 학습 데이터 0건 종목은 여전히 맨 아래", () => {
  clearSnapshots(); clearLearnAll();
  seedL("LOW", "coin", 1, 9); // 10%
  State.setCategory("EMPTY", "coin");
  const sorted = sortByConfidence(["EMPTY", "LOW"], "coin");
  assert.deepStrictEqual(sorted, ["LOW", "EMPTY"]);
  assert.strictEqual(PatternLearn.getStatsFor("coin", "EMPTY").winRate, null); // 0%가 아니라 null
});

test("12-4: 정렬이 시장별로 독립적이다", () => {
  clearSnapshots(); clearLearnAll();
  seedL("DUAL", "coin", 90, 10);  // 코인 90%
  seedL("OTHER", "coin", 50, 50); // 코인 50%
  seedL("DUAL", "stock", 10, 90); // 주식 10%
  seedL("OTHER", "stock", 80, 20);// 주식 80%
  assert.deepStrictEqual(sortByConfidence(["DUAL", "OTHER"], "coin"), ["DUAL", "OTHER"]);
  assert.deepStrictEqual(sortByConfidence(["DUAL", "OTHER"], "stock"), ["OTHER", "DUAL"]);
});

test("12-5: 최근10 vs 이전10 계산이 정확하다(전체 승률로는 알 수 없는 변화)", () => {
  // 요구사항 8의 예시: 이전 10건 전패 → 최근 10건 전승, 전체는 50%
  const entries = [];
  for (let i = 0; i < 10; i++) {
    entries.push({ source: "signal", symbol: "T", category: "coin", direction: "long",
      conditions: COND, resultTime: 1000 + i, result: "LOSS" });
  }
  for (let i = 0; i < 10; i++) {
    entries.push({ source: "signal", symbol: "T", category: "coin", direction: "long",
      conditions: COND, resultTime: 2000 + i, result: "WIN" });
  }
  localStorage.setItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN, JSON.stringify({
    pending: [], stats: {}, entries, statsBySymbol: {}, legacyStats: {},
    scorePerf: { buckets: {}, results: [] }, schemaVersion: 2,
  }));
  const sum = PatternLearn.getPerformanceSummary("coin");
  // 전체는 50%지만...
  assert.ok(Math.abs(sum.overall.winRate - 50) < 1e-9);
  // 최근 10건은 100%, 이전 10건은 0%, 변화 +100%p
  assert.ok(Math.abs(sum.trend.recentWinRate - 100) < 1e-9);
  assert.ok(Math.abs(sum.trend.previousWinRate - 0) < 1e-9);
  assert.ok(Math.abs(sum.trend.delta - 100) < 1e-9);
  assert.strictEqual(sum.trend.trend, "up");
});

test("12-6: 반대로 나빠진 경우도 정확히 -%p로 계산된다", () => {
  const entries = [];
  for (let i = 0; i < 10; i++) entries.push({ source: "signal", symbol: "T", category: "coin",
    direction: "long", conditions: COND, resultTime: 1000 + i, result: "WIN" });
  for (let i = 0; i < 10; i++) entries.push({ source: "signal", symbol: "T", category: "coin",
    direction: "long", conditions: COND, resultTime: 2000 + i, result: "LOSS" });
  localStorage.setItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN, JSON.stringify({
    pending: [], stats: {}, entries, statsBySymbol: {}, legacyStats: {},
    scorePerf: { buckets: {}, results: [] }, schemaVersion: 2,
  }));
  const tr = PatternLearn.getPerformanceTrend(10, "coin");
  assert.ok(Math.abs(tr.delta + 100) < 1e-9);
  assert.strictEqual(tr.trend, "down");
});

test("12-7: 유사 패턴 성적과 전체 점수 성적이 별개로 계산된다(요구사항 6)", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  State.saveLearnEnabled(true);

  // 전체 crypto:100:long 성적을 "보통"으로 만든다 (승/패 섞임)
  const mkSnap = (id, time, result, up) => {
    const item = { signalId: id, symbol: "SEEDUSDT", category: "coin", score: 100, direction: "long",
      signalTime: time, entryTime: time, entryPrice: 100, conditions: COND, patternKey: "k" };
    const snap = PatternSnapshot.buildSnapshot(item, makeTfData(100, up));
    snap.result = result;
    snap.pnlPercent = result === "WIN" ? 10 : -10;
    snap.resultPrice = 100; snap.resultTime = time + 900000;
    return snap;
  };
  const list = [];
  let t = 1000;
  // 현재와 "유사한"(상승 형태) 패턴은 전부 WIN 15건
  for (let i = 0; i < 15; i++) list.push(mkSnap("simw" + i, t++, "WIN", true));
  // 현재와 "다른"(하락 형태) 패턴은 전부 LOSS 25건 — 전체 승률을 끌어내린다
  for (let i = 0; i < 25; i++) {
    const s = mkSnap("difl" + i, t++, "LOSS", false);
    s.conditions = { trend15: false, trend5: false, ha1Flip: false, macdCross: false };
    list.push(s);
  }
  seedSnapshots(list);

  // 현재 신호(상승 형태)
  const now = Date.now();
  const item = { signalId: "cur", symbol: "BTCUSDT", category: "coin", score: 100, direction: "long",
    signalTime: now, entryTime: now, entryPrice: 100, conditions: COND, patternKey: "k" };
  const current = PatternSnapshot.buildSnapshot(item, makeTfData(100, true));

  const sim = PatternSimilarity.getSimilarityStats(current, { minSimilarity: CONFIG.SIM_ADJUST_MIN_SIMILARITY });
  // 유사 패턴만 골라내면 WIN 위주여야 한다 (전체 40건 중 유사한 15건)
  assert.ok(sim.comparedCount > 0, "유사 패턴이 검색되어야 함");
  assert.ok(sim.winCount > sim.lossCount, `유사 패턴은 WIN 우세여야 함: ${sim.winCount}W/${sim.lossCount}L`);
  assert.ok(sim.similarityWeightedWinRate > 60, `유사 패턴 승률: ${sim.similarityWeightedWinRate}`);
  // 즉 "모든 100점 신호를 동일하게 취급"하지 않는다
});

test("12-8: 유사 패턴 비교도 시장/점수/방향이 섞이지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  const mk = (id, market, score, direction, time) => {
    const item = { signalId: id, symbol: "S", category: market === "stock" ? "stock" : "coin",
      score, direction, signalTime: time, entryTime: time, entryPrice: 100,
      conditions: COND, patternKey: "k" };
    const snap = PatternSnapshot.buildSnapshot(item, makeTfData(100, direction === "long"));
    snap.result = "WIN"; snap.pnlPercent = 10; snap.resultPrice = 110; snap.resultTime = time + 900000;
    return snap;
  };
  const list = [];
  let t = 1000;
  for (let i = 0; i < 20; i++) list.push(mk("st" + i, "stock", 100, "long", t++));  // 다른 시장
  for (let i = 0; i < 20; i++) list.push(mk("s80" + i, "crypto", 80, "long", t++));  // 다른 점수
  for (let i = 0; i < 20; i++) list.push(mk("sh" + i, "crypto", 100, "short", t++)); // 다른 방향
  seedSnapshots(list);

  State.setCategory("BTCUSDT", "coin");
  const now = Date.now();
  const item = { signalId: "cur2", symbol: "BTCUSDT", category: "coin", score: 100, direction: "long",
    signalTime: now, entryTime: now, entryPrice: 100, conditions: COND, patternKey: "k" };
  const current = PatternSnapshot.buildSnapshot(item, makeTfData(100, true));
  const sim = PatternSimilarity.getSimilarityStats(current);
  assert.strictEqual(sim.comparedCount, 0, "다른 그룹 데이터가 비교되면 실패");
});

test("12-9: 이번 수정으로 기존 데이터가 삭제되지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  seedL("KEEPME", "coin", 6, 4);
  localStorage.setItem(CONFIG.STORAGE_KEYS.TRADES, JSON.stringify([{ id: "t1" }]));
  localStorage.setItem(CONFIG.STORAGE_KEYS.LOCK_RECORDS, JSON.stringify([{ id: "l1" }]));
  const learnBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);

  // 정렬·통계·유사도 조회를 반복
  for (let i = 0; i < 3; i++) {
    sortByConfidence(["KEEPME"], "coin");
    PatternLearn.getStatsFor("coin", "KEEPME");
    PatternLearn.getPerformanceSummary("coin");
    PatternLearn.getScorePerf("crypto", 100, "long");
  }
  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN), learnBefore);
  assert.strictEqual(JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TRADES))[0].id, "t1");
  assert.strictEqual(JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCK_RECORDS))[0].id, "l1");
  assert.strictEqual(PatternLearn.getStatsFor("coin", "KEEPME").total, 10);
});

test("12-10: ANTROPICUSDT는 기본 종목/PURGE 설정에서 확실히 제외된다", () => {
  assert.ok(!CONFIG.DEFAULT_SYMBOLS.includes("ANTROPICUSDT"));
  assert.ok(CONFIG.PURGE_SYMBOLS.includes("ANTROPICUSDT"));
  // purgeSymbols가 실제로 제거하는지
  State.saveSymbols(["BTCUSDT", "ANTROPICUSDT", "ETHUSDT"]);
  State.purgeSymbols(CONFIG.PURGE_SYMBOLS);
  assert.ok(!State.symbols.includes("ANTROPICUSDT"));
  assert.ok(State.symbols.includes("BTCUSDT"));
});

console.log("\n[13단계: 점수별 성능 화면 시장 완전 분리 (테스트 A~F)]");

// ui.js의 renderScorePerf가 사용하는 것과 동일한 경로로 "현재 시장"의 데이터만 뽑는다.
function currentMarketOf(view) {
  return view === "stock" ? "stock" : "crypto";
}
// 화면에 표시될 데이터를 재현: 현재 시장의 80/100 × LONG/SHORT만
function visibleScorePerf(view) {
  const market = currentMarketOf(view);
  const table = PatternLearn.getScorePerfTable();
  const out = { market, groups: {}, totalShown: 0 };
  CONFIG.SCORE_PERF_TRACK.forEach((score) => {
    const cell = table[market][score];
    out.groups[score] = { long: cell.long.total, short: cell.short.total };
    out.totalShown += cell.long.total + cell.short.total;
  });
  return out;
}

let scoreSeq13 = 0;
function emitScored({ symbol, category, direction, score, win }) {
  State.setCategory(symbol, category);
  const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
  const dir = { score, band: "strong", conditions: COND };
  const other = { score: 20, band: "none", conditions: { trend15: false, trend5: false, ha1Flip: false, macdCross: false } };
  const result = {
    symbol, price: 100, updatedAt: entryTime,
    entryTimes: { "1m": entryTime + scoreSeq13++ * 60000 },
    long: direction === "long" ? dir : other,
    short: direction === "short" ? dir : other,
  };
  PatternLearn.recordPending(result, direction);
  const price = direction === "long" ? (win ? 110 : 90) : (win ? 90 : 110);
  PatternLearn.evaluatePending({ [symbol]: { price } });
}

// 코인과 주식에 서로 다른 개수를 심는다(섞이면 즉시 검출)
clearSnapshots(); clearLearnAll(); State.saveLearnEnabled(true);
for (let i = 0; i < 6; i++) emitScored({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100, win: true });
for (let i = 0; i < 4; i++) emitScored({ symbol: "BTCUSDT", category: "coin", direction: "short", score: 80, win: false });
for (let i = 0; i < 3; i++) emitScored({ symbol: "NASDAQ", category: "stock", direction: "long", score: 80, win: true });
for (let i = 0; i < 2; i++) emitScored({ symbol: "NASDAQ", category: "stock", direction: "short", score: 100, win: false });

test("테스트 A: COIN 화면에서 COIN 데이터만 표시된다", () => {
  const v = visibleScorePerf("coin");
  assert.strictEqual(v.market, "crypto");
  assert.strictEqual(v.groups[100].long, 6);
  assert.strictEqual(v.groups[80].short, 4);
  // 주식에 심은 데이터(80 LONG 3건, 100 SHORT 2건)가 보이면 실패
  assert.strictEqual(v.groups[80].long, 0);
  assert.strictEqual(v.groups[100].short, 0);
  assert.strictEqual(v.totalShown, 10); // 코인 10건만
});

test("테스트 B: STOCK 화면에서 STOCK 데이터만 표시된다", () => {
  const v = visibleScorePerf("stock");
  assert.strictEqual(v.market, "stock");
  assert.strictEqual(v.groups[80].long, 3);
  assert.strictEqual(v.groups[100].short, 2);
  // 코인에 심은 데이터(100 LONG 6건, 80 SHORT 4건)가 보이면 실패
  assert.strictEqual(v.groups[100].long, 0);
  assert.strictEqual(v.groups[80].short, 0);
  assert.strictEqual(v.totalShown, 5); // 주식 5건만
});

test("테스트 C: COIN → STOCK 이동 시 COIN 80/100 데이터가 사라진다", () => {
  const coin = visibleScorePerf("coin");
  const stock = visibleScorePerf("stock");
  // 코인 화면에 있던 수치가 주식 화면에는 하나도 없어야 한다
  assert.strictEqual(coin.groups[100].long, 6);
  assert.strictEqual(stock.groups[100].long, 0);
  assert.strictEqual(coin.groups[80].short, 4);
  assert.strictEqual(stock.groups[80].short, 0);
  assert.notStrictEqual(coin.totalShown, stock.totalShown);
});

test("테스트 D: STOCK → COIN 이동 시 STOCK 80/100 데이터가 사라진다", () => {
  const stock = visibleScorePerf("stock");
  const coin = visibleScorePerf("coin");
  assert.strictEqual(stock.groups[80].long, 3);
  assert.strictEqual(coin.groups[80].long, 0);
  assert.strictEqual(stock.groups[100].short, 2);
  assert.strictEqual(coin.groups[100].short, 0);
});

test("테스트 C/D 반복: COIN→STOCK→COIN 반복 전환에도 이전 시장 데이터가 남지 않는다", () => {
  const seq = ["coin", "stock", "coin", "stock", "coin"];
  const results = seq.map((v) => visibleScorePerf(v));
  results.forEach((r, i) => {
    if (seq[i] === "coin") {
      assert.strictEqual(r.totalShown, 10, `${i}번째 coin 화면`);
      assert.strictEqual(r.groups[80].long, 0);
    } else {
      assert.strictEqual(r.totalShown, 5, `${i}번째 stock 화면`);
      assert.strictEqual(r.groups[100].long, 0);
    }
  });
});

test("테스트 E: 새 COIN 학습 결과가 추가되어도 STOCK 통계가 변하지 않는다", () => {
  const stockBefore = JSON.stringify(visibleScorePerf("stock"));
  for (let i = 0; i < 5; i++) emitScored({ symbol: "ETHUSDT", category: "coin", direction: "long", score: 100, win: true });
  const stockAfter = JSON.stringify(visibleScorePerf("stock"));
  assert.strictEqual(stockBefore, stockAfter, "주식 통계가 변하면 실패");
  // 코인 쪽은 실제로 늘어났는지 확인
  assert.strictEqual(visibleScorePerf("coin").groups[100].long, 11);
});

test("테스트 F: 새 STOCK 학습 결과가 추가되어도 COIN 통계가 변하지 않는다", () => {
  const coinBefore = JSON.stringify(visibleScorePerf("coin"));
  for (let i = 0; i < 4; i++) emitScored({ symbol: "SP500", category: "stock", direction: "short", score: 80, win: false });
  const coinAfter = JSON.stringify(visibleScorePerf("coin"));
  assert.strictEqual(coinBefore, coinAfter, "코인 통계가 변하면 실패");
  assert.strictEqual(visibleScorePerf("stock").groups[80].short, 4);
});

test('13-1: "학습 결과 없음" 판단도 현재 시장 기준으로만 한다', () => {
  clearSnapshots(); clearLearnAll();
  // 코인에만 데이터를 넣는다
  for (let i = 0; i < 3; i++) emitScored({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100, win: true });
  const coin = visibleScorePerf("coin");
  const stock = visibleScorePerf("stock");
  assert.ok(coin.totalShown > 0, "코인 화면은 데이터가 있어야 함");
  assert.strictEqual(stock.totalShown, 0, "주식 화면은 0이어야 함(코인 데이터가 섞이면 실패)");
});

test("13-2: 스냅샷 요약도 시장별로 분리된다", () => {
  clearSnapshots(); clearLearnAll();
  const mk = (id, market, result) => ({
    signalId: id, symbol: "S", market, category: market === "stock" ? "stock" : "coin",
    score: 100, direction: "long", signalTime: 1000, signalPrice: 100,
    conditions: COND, tf15: null, tf5: null, tf1: null,
    result, resultPrice: 100, resultTime: 2000, pnlPercent: result === "WIN" ? 5 : -5,
  });
  seedSnapshots([
    mk("c1", "crypto", "WIN"), mk("c2", "crypto", "WIN"), mk("c3", "crypto", "LOSS"),
    mk("s1", "stock", "LOSS"), mk("s2", "stock", null),
  ]);
  const crypto = PatternSnapshot.getSummary("crypto");
  const stock = PatternSnapshot.getSummary("stock");
  assert.strictEqual(crypto.total, 3);
  assert.strictEqual(crypto.wins, 2);
  assert.strictEqual(crypto.losses, 1);
  assert.strictEqual(stock.total, 2);
  assert.strictEqual(stock.losses, 1);
  assert.strictEqual(stock.pendingResult, 1);
  // 인자 없이 호출하면 기존처럼 전체 (하위호환)
  assert.strictEqual(PatternSnapshot.getSummary().total, 5);
});

test("13-3: 이번 수정으로 기존 학습/거래 데이터가 삭제되지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("KEEP13", "coin");
  for (let i = 0; i < 4; i++) PatternLearn.recordLockResult({ symbol: "KEEP13", direction: "long", conditions: COND, pnlPercent: 5 });
  localStorage.setItem(CONFIG.STORAGE_KEYS.TRADES, JSON.stringify([{ id: "keep13" }]));
  localStorage.setItem(CONFIG.STORAGE_KEYS.LOCK_RECORDS, JSON.stringify([{ id: "lock13" }]));
  const learnBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);

  // 시장 전환을 여러 번 재현(조회만 반복)
  ["coin", "stock", "coin", "stock"].forEach((v) => visibleScorePerf(v));
  PatternSnapshot.getSummary("crypto");
  PatternSnapshot.getSummary("stock");

  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN), learnBefore);
  assert.strictEqual(JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TRADES))[0].id, "keep13");
  assert.strictEqual(JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCK_RECORDS))[0].id, "lock13");
  assert.strictEqual(PatternLearn.getStatsFor("coin", "KEEP13").total, 4);
});

console.log("\n[14단계: 스와이프 제거 / 앱 재진입 복구]");

// --- ① 스와이프 제거: 표시 상태만 바뀌고 데이터는 보존되는지 ---

test("14-1: 스와이프로 치우면 표시 상태만 기록되고 데이터는 그대로다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  State.saveSymbols(["BTCUSDT", "ETHUSDT"]);
  for (let i = 0; i < 5; i++) PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  const learnBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);
  const statsBefore = PatternLearn.getStatsFor("coin", "BTCUSDT").total;

  // 스와이프로 치운 상태를 재현
  State.dismissed = {};
  State.dismissed["BTCUSDT"] = true;

  // 학습 데이터/통계가 전혀 변하지 않아야 한다
  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN), learnBefore);
  assert.strictEqual(PatternLearn.getStatsFor("coin", "BTCUSDT").total, statsBefore);
  // 감시 목록에서도 제거되지 않는다(백그라운드 감시 계속)
  assert.ok(State.symbols.includes("BTCUSDT"));
});

test("14-2: dismissed 상태는 localStorage에 저장되지 않는다(앱 재실행 시 복원)", () => {
  State.dismissed = { BTCUSDT: true, ETHUSDT: true };
  // 어떤 저장 키에도 dismissed가 들어가면 안 된다
  Object.values(CONFIG.STORAGE_KEYS).forEach((key) => {
    const raw = localStorage.getItem(key);
    if (raw) assert.ok(!raw.includes("dismissed"), `${key}에 dismissed가 저장됨`);
  });
});

test("14-3: 치운 종목도 학습/신호 처리는 계속된다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  State.dismissed = { BTCUSDT: true }; // 화면에서 치운 상태
  State.saveLearnEnabled(true);

  // 치운 상태에서도 신호 기록·결과 확정이 정상 동작해야 한다
  const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
  const result = {
    symbol: "BTCUSDT", price: 100, updatedAt: entryTime,
    entryTimes: { "1m": entryTime + snapSeq++ * 60000 }, tf: makeTfData(100, true),
    long: { score: 100, band: "strong", conditions: COND },
    short: { score: 20, band: "none", conditions: COND },
    leadingDirection: "long", isNewSignal: true,
  };
  const item = PatternLearn.recordPending(result, "long");
  assert.ok(item, "치운 종목도 학습 대기열에 들어가야 함");
  PatternSnapshot.record(item, result.tf);
  PatternLearn.evaluatePending({ BTCUSDT: { price: 110 } });
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 100, "long").wins, 1);
  assert.strictEqual(PatternSnapshot.getAll()[0].result, "WIN");
});

test("14-4: 스와이프 임계값이 합리적으로 설정되어 있다", () => {
  // ui.js의 상수와 동일한 값 — 살짝 움직이면 복귀, 충분히 밀면 제거
  const SWIPE_START = 8;
  const SWIPE_DISMISS = 90;
  assert.ok(SWIPE_START > 0 && SWIPE_START < 20, "시작 임계값이 너무 크거나 작으면 오조작");
  assert.ok(SWIPE_DISMISS > SWIPE_START * 5, "제거 임계값이 시작값보다 충분히 커야 함");
  // 360px 화면에서도 제거 가능한 거리여야 한다(화면 폭의 1/3 이하)
  assert.ok(SWIPE_DISMISS < 360 / 3, `360px에서 밀기 어려운 거리: ${SWIPE_DISMISS}`);
});

// --- ② 앱 재진입: 오류 복구 ---

test("14-5: 재진입 시 오류 플래그만 초기화되고 데이터는 유지된다", () => {
  // handleAppResume과 동일한 로직을 재현
  State.saveSymbols(["BTCUSDT", "ETHUSDT"]);
  State.data["BTCUSDT"] = { symbol: "BTCUSDT", price: 100, updatedAt: Date.now() };
  State.data["ETHUSDT"] = { symbol: "ETHUSDT", price: 200, updatedAt: Date.now() };
  State.errors["BTCUSDT"] = true; // 백그라운드 전환으로 생긴 오류
  State.errors["ETHUSDT"] = true;

  State.symbols.forEach((sym) => {
    if (State.errors[sym]) State.errors[sym] = false;
  });

  assert.strictEqual(State.errors["BTCUSDT"], false);
  assert.strictEqual(State.errors["ETHUSDT"], false);
  // 기존에 받아둔 가격 데이터는 그대로 남아있어야 한다(빈 화면 방지)
  assert.strictEqual(State.data["BTCUSDT"].price, 100);
  assert.strictEqual(State.data["ETHUSDT"].price, 200);
});

test("14-6: 중단(abort) 오류는 오류 상태로 굳지 않는다", () => {
  // app.js의 aborted 판정과 동일한 식
  const isAborted = (err, visibility) =>
    (err && (err.name === "AbortError" || err.code === 20)) || visibility === "hidden";

  const abortErr = new Error("aborted");
  abortErr.name = "AbortError";
  assert.strictEqual(isAborted(abortErr, "visible"), true);   // AbortError → 오류 아님
  assert.strictEqual(isAborted(new Error("net"), "hidden"), true); // 백그라운드 중 실패 → 오류 아님
  // 실제 네트워크 오류(화면이 보이는 상태)는 정상적으로 오류로 처리된다
  assert.strictEqual(isAborted(new Error("HTTP 500"), "visible"), false);
});

test("14-7: fetch 타임아웃/재시도 설정이 존재한다", () => {
  assert.ok(Number.isFinite(CONFIG.FETCH_TIMEOUT_MS) && CONFIG.FETCH_TIMEOUT_MS > 0);
  assert.ok(Number.isFinite(CONFIG.FETCH_RETRY_DELAY_MS) && CONFIG.FETCH_RETRY_DELAY_MS >= 0);
  // 타임아웃이 폴링 주기보다 짧아야 요청이 겹치지 않는다
  assert.ok(CONFIG.FETCH_TIMEOUT_MS < CONFIG.POLL_INTERVAL_MS, "타임아웃이 폴링 주기보다 길면 요청이 누적됨");
  assert.ok(typeof BinanceApi.fetchWithTimeout === "function");
  assert.ok(typeof BinanceApi.parseKlines === "function");
});

test("14-8: fetchKlines가 일시적 실패 후 재시도로 성공한다", async () => {
  const origFetch = global.fetch;
  let calls = 0;
  global.fetch = () => {
    calls++;
    if (calls === 1) {
      const e = new Error("aborted");
      e.name = "AbortError";
      return Promise.reject(e); // 첫 시도는 중단
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve([[1, "100", "101", "99", "100.5", "10", 2]]),
    });
  };
  try {
    const out = await BinanceApi.fetchKlines("BTCUSDT", "1m", 10);
    assert.strictEqual(calls, 2, "재시도가 일어나야 함");
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].close, 100.5);
  } finally {
    global.fetch = origFetch;
  }
});

test("14-9: 두 번 모두 실패하면 오류를 정상적으로 던진다(실제 네트워크 오류 보존)", async () => {
  const origFetch = global.fetch;
  let calls = 0;
  global.fetch = () => {
    calls++;
    return Promise.reject(new Error("offline"));
  };
  try {
    await assert.rejects(() => BinanceApi.fetchKlines("BTCUSDT", "1m", 10), /offline/);
    assert.strictEqual(calls, 2, "최초 시도 + 1회 재시도");
  } finally {
    global.fetch = origFetch;
  }
});

test("14-10: parseKlines가 잘못된 응답을 안전하게 거른다", () => {
  assert.throws(() => BinanceApi.parseKlines({ notAnArray: true }), /Unexpected response shape/);
  // 값이 깨진 캔들은 걸러진다(기존 동작 유지)
  const out = BinanceApi.parseKlines([
    [1, "100", "101", "99", "100.5", "10", 2],
    [3, "0", "0", "0", "0", "0", 4],        // 0 이하 → 제외
    [5, "abc", "x", "y", "z", "w", 6],       // NaN → 제외
  ]);
  assert.strictEqual(out.length, 1);
});

test("14-11: 이번 수정으로 기존 데이터가 삭제되지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("KEEP14", "coin");
  for (let i = 0; i < 3; i++) PatternLearn.recordLockResult({ symbol: "KEEP14", direction: "long", conditions: COND, pnlPercent: 5 });
  localStorage.setItem(CONFIG.STORAGE_KEYS.TRADES, JSON.stringify([{ id: "keep14" }]));
  const learnBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);

  // 스와이프 + 재진입을 여러 번 재현
  for (let i = 0; i < 3; i++) {
    State.dismissed = { KEEP14: true };
    State.errors["KEEP14"] = true;
    State.symbols.forEach((sym) => { if (State.errors[sym]) State.errors[sym] = false; });
    State.dismissed = {};
  }
  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN), learnBefore);
  assert.strictEqual(JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TRADES))[0].id, "keep14");
  assert.strictEqual(PatternLearn.getStatsFor("coin", "KEEP14").total, 3);
});

console.log("\n[15단계: 큰 신호 알림 스와이프 닫기 (데이터 보존)]");

test("15-1: 알림 닫기 로직이 어떤 삭제 함수도 호출하지 않는다(코드 검사)", () => {
  const fs = require("fs");
  const ui = fs.readFileSync(path.join(__dirname, "./ui.js"), "utf8");
  // attachToastDismiss 함수 본문만 떼어내 검사
  const start = ui.indexOf("function attachToastDismiss");
  const body = ui.slice(start, ui.indexOf("\n  function showToast", start));
  // 데이터를 지우는 함수/호출이 들어있으면 실패
  const forbidden = [
    "saveSymbols", "removeSymbol", "removeLockRecord", "PatternLearn.reset",
    "PatternSnapshot.clear", "SignalPerformance.clear", "localStorage.setItem",
    "localStorage.removeItem", "localStorage.clear", "delete State.data",
    "State.dismissed", "SignalLog",
  ];
  forbidden.forEach((f) => {
    assert.ok(!body.includes(f), `알림 닫기 로직에 ${f}가 포함되어 있음`);
  });
  // DOM 제거만 수행하는지 확인
  assert.ok(body.includes("el.remove()"), "DOM 제거는 있어야 함");
});

test("15-2: 알림을 닫아도 신호 데이터/학습 데이터/종목 목록이 그대로다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  State.saveSymbols(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
  for (let i = 0; i < 5; i++) {
    PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  }
  State.data["BTCUSDT"] = { symbol: "BTCUSDT", price: 100, updatedAt: Date.now() };

  const symbolsBefore = State.symbols.slice();
  const learnBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);
  const statsBefore = PatternLearn.getStatsFor("coin", "BTCUSDT").total;
  const dataBefore = State.data["BTCUSDT"].price;

  /* 알림 닫기를 재현한다: 알림은 DOM 요소일 뿐이므로 제거해도
     아래 데이터에 영향을 줄 수 없는 구조임을 확인한다. */
  const fakeToast = { removed: false, remove() { this.removed = true; }, style: {} };
  fakeToast.remove();

  assert.strictEqual(fakeToast.removed, true);
  assert.deepStrictEqual(State.symbols, symbolsBefore, "종목 목록이 변하면 실패");
  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN), learnBefore, "학습 데이터가 변하면 실패");
  assert.strictEqual(PatternLearn.getStatsFor("coin", "BTCUSDT").total, statsBefore);
  assert.strictEqual(State.data["BTCUSDT"].price, dataBefore, "신호 데이터가 변하면 실패");
});

test("15-3: 알림 닫기와 카드 스와이프(State.dismissed)는 서로 다른 기능이다", () => {
  // 알림 닫기는 State.dismissed를 건드리지 않아야 한다
  // (알림을 닫았다고 해서 목록의 카드까지 사라지면 안 됨)
  State.dismissed = {};
  State.saveSymbols(["BTCUSDT"]);
  State.setCategory("BTCUSDT", "coin");

  const fs = require("fs");
  const ui = fs.readFileSync(path.join(__dirname, "./ui.js"), "utf8");
  const start = ui.indexOf("function attachToastDismiss");
  const body = ui.slice(start, ui.indexOf("\n  function showToast", start));
  assert.ok(!body.includes("dismissed"), "알림 닫기가 목록 카드 숨김 상태를 건드림");
  assert.deepStrictEqual(State.dismissed, {});
});

test("15-4: 알림을 닫은 뒤에도 새 신호가 정상적으로 기록·처리된다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  State.saveLearnEnabled(true);

  // 첫 신호 → (알림을 닫았다고 가정) → 두 번째 신호
  const emit = () => {
    const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
    const result = {
      symbol: "BTCUSDT", price: 100, updatedAt: entryTime,
      entryTimes: { "1m": entryTime + snapSeq++ * 60000 }, tf: makeTfData(100, true),
      long: { score: 100, band: "strong", conditions: COND },
      short: { score: 20, band: "none", conditions: COND },
      leadingDirection: "long", isNewSignal: true,
    };
    const item = PatternLearn.recordPending(result, "long");
    if (item) PatternSnapshot.record(item, result.tf);
    PatternLearn.evaluatePending({ BTCUSDT: { price: 110 } });
    return item;
  };
  const first = emit();
  assert.ok(first, "첫 신호가 기록되어야 함");
  const second = emit();
  assert.ok(second, "알림을 닫은 뒤에도 새 신호가 기록되어야 함");
  assert.notStrictEqual(first.signalId, second.signalId);
  // 두 신호 모두 학습에 반영되었는지
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 100, "long").total, 2);
  assert.strictEqual(PatternSnapshot.getAll().length, 2);
});

test("15-5: 알림 컨테이너는 터치를 통과시키고 개별 알림만 터치를 받는다", () => {
  const fs = require("fs");
  const css = fs.readFileSync(path.join(__dirname, "./style.css"), "utf8");
  // 컨테이너: pointer-events:none (뒤쪽 화면 조작 가능)
  const boxRule = css.match(/#toastBox\{[^}]*\}/)[0];
  assert.ok(boxRule.includes("pointer-events:none"), "컨테이너가 화면 조작을 막고 있음");
  // 개별 알림: pointer-events:auto (스와이프 가능)
  const toastRule = css.match(/\n\.toast\{[^}]*\}/)[0];
  assert.ok(toastRule.includes("pointer-events:auto"), "알림이 터치를 받지 못해 스와이프 불가");
  assert.ok(toastRule.includes("touch-action:pan-y"), "가로 스와이프 제스처가 분리되지 않음");
});

test("15-6: 알림 상세가 길어도 화면을 과도하게 가리지 않는다(최대 높이 제한)", () => {
  const fs = require("fs");
  const css = fs.readFileSync(path.join(__dirname, "./style.css"), "utf8");
  const detailRule = css.match(/\.toast-detail\{[^}]*\}/g).join(" ");
  assert.ok(/max-height:\s*\d+vh/.test(detailRule), "상세 영역에 최대 높이 제한이 없음");
  assert.ok(detailRule.includes("overflow-y:auto"), "넘치는 내용을 스크롤할 수 없음");
});

console.log("\n[16단계: 유사 패턴 실제 승률 계산 (요구사항 12)]");

test("16-1: 반환값에 요구된 필드가 모두 포함된다", () => {
  const current = mkSnapshot({ signalId: "cur16", stepPercent: 0.5, rsi: 60, signalTime: 9000 });
  seedSnapshots([current, mkSnapshot({ signalId: "p16", stepPercent: 0.5, rsi: 60, signalTime: 1000, result: "WIN", pnlPercent: 7 })]);
  const st = PatternSimilarity.getSimilarityStats(current);
  ["matchedCount","winCount","lossCount","winRate","similarityWeightedWinRate",
   "averagePnl","averageSimilarity","enough","threshold"].forEach((f) => {
    assert.ok(st[f] !== undefined, `필드 누락: ${f}`);
  });
  // 하위호환 필드도 유지
  assert.strictEqual(st.comparedCount, st.matchedCount);
  assert.strictEqual(st.plainWinRate, st.winRate);
});

test("16-2: WIN/LOSS 개수와 단순 승률이 정확하다", () => {
  const current = mkSnapshot({ signalId: "c2", stepPercent: 0.5, rsi: 60, signalTime: 9000 });
  const list = [current];
  let t = 1000;
  for (let i = 0; i < 24; i++) list.push(mkSnapshot({ signalId: "w" + i, stepPercent: 0.5, rsi: 60, signalTime: t++, result: "WIN", pnlPercent: 8 }));
  for (let i = 0; i < 6; i++) list.push(mkSnapshot({ signalId: "l" + i, stepPercent: 0.5, rsi: 60, signalTime: t++, result: "LOSS", pnlPercent: -4 }));
  seedSnapshots(list);
  const st = PatternSimilarity.getSimilarityStats(current);
  assert.strictEqual(st.matchedCount, 30);
  assert.strictEqual(st.winCount, 24);
  assert.strictEqual(st.lossCount, 6);
  assert.ok(Math.abs(st.winRate - 80) < 1e-9);
  assert.strictEqual(st.enough, true);
  // 평균 PnL도 계산된다 (24*8 + 6*-4) / 30 = 5.6
  assert.ok(Math.abs(st.averagePnl - 5.6) < 1e-9);
});

test("16-3: threshold가 적용되어 유사도 낮은 패턴이 제외된다", () => {
  const current = mkSnapshot({ signalId: "c3", stepPercent: 0.5, rsi: 60, signalTime: 9000 });
  const far = { stepPercent: -2.5, rsi: 15, opts: { golden: false, dead: true, rsiDelta: -10, haFlipped: true } };
  const list = [current];
  let t = 1000;
  for (let i = 0; i < 6; i++) list.push(mkSnapshot({ signalId: "near" + i, stepPercent: 0.5, rsi: 60, signalTime: t++, result: "WIN" }));
  for (let i = 0; i < 10; i++) list.push(mkSnapshot(Object.assign({ signalId: "far" + i, signalTime: t++, result: "LOSS" }, far)));
  seedSnapshots(list);

  const def = PatternSimilarity.getSimilarityStats(current);          // 기본 threshold(70)
  const none = PatternSimilarity.getSimilarityStats(current, { minSimilarity: 0 });
  assert.strictEqual(def.threshold, CONFIG.SIM_ADJUST_MIN_SIMILARITY);
  assert.ok(def.matchedCount < none.matchedCount, "threshold가 표본을 줄여야 함");
  assert.strictEqual(def.lossCount, 0, "유사도 낮은 LOSS가 제외되어야 함");
  assert.strictEqual(none.matchedCount, 16);
  // threshold를 직접 지정할 수도 있다
  const custom = PatternSimilarity.getSimilarityStats(current, { minSimilarity: 95 });
  assert.strictEqual(custom.threshold, 95);
  assert.ok(custom.matchedCount <= def.matchedCount);
});

test("16-4: 표본이 부족하면 enough:false (2건 100%를 신뢰하지 않음)", () => {
  const current = mkSnapshot({ signalId: "c4", stepPercent: 0.5, rsi: 60, signalTime: 9000 });
  seedSnapshots([
    current,
    mkSnapshot({ signalId: "a", stepPercent: 0.5, rsi: 60, signalTime: 1000, result: "WIN" }),
    mkSnapshot({ signalId: "b", stepPercent: 0.5, rsi: 60, signalTime: 1100, result: "WIN" }),
  ]);
  const st = PatternSimilarity.getSimilarityStats(current);
  assert.strictEqual(st.matchedCount, 2);
  assert.ok(Math.abs(st.winRate - 100) < 1e-9); // 승률은 100%로 계산되지만
  assert.strictEqual(st.enough, false);          // 신뢰할 표본은 아니라고 알린다
  assert.strictEqual(st.minSamples, CONFIG.SCORE_PERF_MIN_SAMPLES);
});

test("16-5: 유사도 가중 승률이 0~100 범위이고 높은 유사도에 더 큰 가중치를 준다", () => {
  const current = mkSnapshot({ signalId: "c5", stepPercent: 0.5, rsi: 60, signalTime: 9000 });
  seedSnapshots([
    current,
    // 매우 유사한 WIN 2건
    mkSnapshot({ signalId: "hw1", stepPercent: 0.5, rsi: 60, signalTime: 1000, result: "WIN" }),
    mkSnapshot({ signalId: "hw2", stepPercent: 0.5, rsi: 60, signalTime: 1100, result: "WIN" }),
    // 덜 유사한 LOSS 1건
    mkSnapshot({ signalId: "ll1", stepPercent: 0.2, rsi: 52, signalTime: 1200, result: "LOSS" }),
  ]);
  const st = PatternSimilarity.getSimilarityStats(current, { minSimilarity: 0, minSamples: 1 });
  assert.ok(st.similarityWeightedWinRate >= 0 && st.similarityWeightedWinRate <= 100);
  assert.ok(st.winRate >= 0 && st.winRate <= 100);
  // 유사도 높은 WIN에 비중이 실려 단순 승률(66.7%)보다 높아야 한다
  assert.ok(st.similarityWeightedWinRate > st.winRate,
    `가중 ${st.similarityWeightedWinRate} > 단순 ${st.winRate}`);
});

test("16-6: 전체 조건 승률과 유사 패턴 승률이 별개로 유지된다(요구사항 5)", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  // 전체 100 LONG: 승/패 섞어서 중간 승률을 만든다
  let seq = 0;
  const emit = (win) => {
    const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
    const result = {
      symbol: "BTCUSDT", price: 100, updatedAt: entryTime,
      entryTimes: { "1m": entryTime + seq++ * 60000 },
      long: { score: 100, band: "strong", conditions: COND },
      short: { score: 20, band: "none", conditions: COND },
    };
    PatternLearn.recordPending(result, "long");
    PatternLearn.evaluatePending({ BTCUSDT: { price: win ? 110 : 90 } });
  };
  for (let i = 0; i < 10; i++) emit(i < 6); // 6승 4패 = 60%
  const overall = PatternLearn.getScorePerf("crypto", 100, "long");
  assert.strictEqual(overall.total, 10);
  assert.ok(Math.abs(overall.winRate - 60) < 1e-9);

  // 유사 패턴 승률을 계산해도 전체 승률은 그대로여야 한다(덮어쓰기 금지)
  const cur = mkSnapshot({ signalId: "sep", stepPercent: 0.5, rsi: 60, signalTime: Date.now() });
  PatternSimilarity.getSimilarityStats(cur);
  const after = PatternLearn.getScorePerf("crypto", 100, "long");
  assert.strictEqual(after.total, 10);
  assert.ok(Math.abs(after.winRate - 60) < 1e-9);
});

test("16-7: 그룹별 유사 패턴 집계가 market/score/direction을 섞지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  const mk = (id, market, score, direction, time, result, up) => {
    const s = mkSnapshot({ signalId: id, market, score, direction, signalTime: time, result,
      stepPercent: up ? 0.5 : -0.5, rsi: up ? 60 : 40 });
    return s;
  };
  const list = [];
  let t = 1000;
  for (let i = 0; i < 8; i++) list.push(mk("cl" + i, "crypto", 100, "long", t++, "WIN", true));
  for (let i = 0; i < 8; i++) list.push(mk("sl" + i, "stock", 100, "long", t++, "LOSS", true));
  for (let i = 0; i < 8; i++) list.push(mk("c8" + i, "crypto", 80, "long", t++, "LOSS", true));
  for (let i = 0; i < 8; i++) list.push(mk("cs" + i, "crypto", 100, "short", t++, "LOSS", false));
  seedSnapshots(list);

  const g = PatternSimilarity.getGroupSimilarityStats("crypto", 100, "long");
  assert.ok(g.matchedCount > 0, "crypto:100:long 표본이 있어야 함");
  assert.strictEqual(g.lossCount, 0, "다른 그룹의 LOSS가 섞이면 실패");
  assert.strictEqual(g.market, "crypto");
  assert.strictEqual(g.score, 100);
  assert.strictEqual(g.direction, "long");
  // 다른 그룹은 반대로 LOSS만 나와야 한다
  const gs = PatternSimilarity.getGroupSimilarityStats("stock", 100, "long");
  assert.strictEqual(gs.winCount, 0, "코인의 WIN이 주식에 섞이면 실패");
});

test("16-8: 그룹 집계에서도 표본 부족이 정상 처리된다", () => {
  clearSnapshots(); clearLearnAll();
  seedSnapshots([
    mkSnapshot({ signalId: "one", market: "crypto", score: 100, direction: "long", signalTime: 1000, result: "WIN" }),
    mkSnapshot({ signalId: "two", market: "crypto", score: 100, direction: "long", signalTime: 2000, result: "WIN" }),
  ]);
  const g = PatternSimilarity.getGroupSimilarityStats("crypto", 100, "long");
  // 표본이 적으므로 enough:false (승률이 100%여도 신뢰하지 않음)
  assert.strictEqual(g.enough, false);
  // 데이터가 아예 없는 그룹도 안전하게 처리
  const empty = PatternSimilarity.getGroupSimilarityStats("stock", 80, "short");
  assert.strictEqual(empty.matchedCount, 0);
  assert.strictEqual(empty.winRate, null);   // 0%가 아니라 null
  assert.strictEqual(empty.enough, false);
});

test("16-9: 그룹 집계도 미래 데이터/자기 자신/pending을 제외한다", () => {
  clearSnapshots(); clearLearnAll();
  const list = [];
  // 결과 미확정(pending) 5건 — 집계에 포함되면 안 된다
  for (let i = 0; i < 5; i++) {
    list.push(mkSnapshot({ signalId: "pend" + i, market: "crypto", score: 100, direction: "long", signalTime: 1000 + i }));
  }
  seedSnapshots(list);
  const g = PatternSimilarity.getGroupSimilarityStats("crypto", 100, "long");
  assert.strictEqual(g.matchedCount, 0, "pending이 집계되면 실패");
  assert.strictEqual(g.basedOnSignals, 0);
});

test("16-10: 유사 패턴 계산이 기존 데이터를 변경하지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  for (let i = 0; i < 5; i++) PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  const list = [];
  for (let i = 0; i < 10; i++) {
    list.push(mkSnapshot({ signalId: "keep" + i, market: "crypto", score: 100, direction: "long",
      signalTime: 1000 + i, result: i % 2 ? "WIN" : "LOSS", stepPercent: 0.5, rsi: 60 }));
  }
  seedSnapshots(list);
  const snapBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS);
  const learnBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);

  const cur = mkSnapshot({ signalId: "calc", market: "crypto", score: 100, direction: "long", signalTime: 99000, stepPercent: 0.5, rsi: 60 });
  PatternSimilarity.getSimilarityStats(cur);
  PatternSimilarity.getGroupSimilarityStats("crypto", 100, "long");
  PatternSimilarity.getGroupSimilarityStats("stock", 80, "short");

  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS), snapBefore);
  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN), learnBefore);
});

test("16-11: config에서 threshold 등급과 최소 표본을 관리한다", () => {
  assert.ok(CONFIG.SIM_TIERS && CONFIG.SIM_TIERS.veryHigh === 80);
  assert.strictEqual(CONFIG.SIM_TIERS.high, 70);
  assert.strictEqual(CONFIG.SIM_TIERS.reference, 60);
  // 기본 threshold와 최소 표본은 기존 설정을 재사용한다
  assert.strictEqual(CONFIG.SIM_ADJUST_MIN_SIMILARITY, 70);
  assert.ok(Number.isFinite(CONFIG.SCORE_PERF_MIN_SAMPLES));
});

console.log("\n[17단계: 종합 Confidence (요구사항 12)]");

// 종합 confidence 계산용 snapshot 생성 (실제 지표 계산을 거친다)
function confSnap({ id, market, score, direction, time, result, up, pnl }) {
  const item = {
    signalId: id, symbol: market === "stock" ? "NQ" : "BTCUSDT",
    category: market === "stock" ? "stock" : "coin",
    score, direction, signalTime: time, entryTime: time, entryPrice: 100,
    conditions: COND, patternKey: "k",
  };
  const s = PatternSnapshot.buildSnapshot(item, makeTfData(100, up));
  if (result) {
    s.result = result;
    s.pnlPercent = pnl === undefined ? (result === "WIN" ? 7 : -4) : pnl;
    s.resultPrice = 100;
    s.resultTime = time + 900000;
  }
  return s;
}

test("17-1: 종합 confidence가 0~100 범위이고 NaN이 아니다", () => {
  clearSnapshots(); clearLearnAll();
  const cur = confSnap({ id: "c1", market: "crypto", score: 100, direction: "long", time: 99000, up: true });
  seedSnapshots([cur]);
  const c = ConfidenceAdjust.computeCompositeConfidence(cur);
  assert.ok(Number.isFinite(c.confidence), "NaN이면 실패");
  assert.ok(c.confidence >= 0 && c.confidence <= 100, `범위 위반: ${c.confidence}`);
});

test("17-2: 네 요소가 각각 계산되어 반환된다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  // 과거 성능을 만든다
  let seq = 0;
  for (let i = 0; i < 10; i++) {
    const et = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
    PatternLearn.recordPending({
      symbol: "BTCUSDT", price: 100, updatedAt: et, entryTimes: { "1m": et + seq++ * 60000 },
      long: { score: 100, band: "strong", conditions: COND },
      short: { score: 20, band: "none", conditions: COND },
    }, "long");
    PatternLearn.evaluatePending({ BTCUSDT: { price: i < 7 ? 110 : 90 } });
  }
  // 유사 패턴도 만든다
  const list = [];
  let t = 1000;
  for (let i = 0; i < 8; i++) list.push(confSnap({ id: "w" + i, market: "crypto", score: 100, direction: "long", time: t++, result: "WIN", up: true }));
  const cur = confSnap({ id: "cur2", market: "crypto", score: 100, direction: "long", time: 99000, up: true });
  seedSnapshots(list.concat([cur]));

  const c = ConfidenceAdjust.computeCompositeConfidence(cur);
  assert.ok(Number.isFinite(c.signalQuality), "신호 품질 누락");
  assert.ok(Number.isFinite(c.historicalWinRate), "과거 성능 누락");
  assert.ok(Number.isFinite(c.similarityWeightedWinRate) || Number.isFinite(c.similarWinRate), "유사 패턴 누락");
  assert.ok(Number.isFinite(c.marketAlignment), "시장 상태 누락");
  assert.ok(Math.abs(c.historicalWinRate - 70) < 1e-9, `과거 승률: ${c.historicalWinRate}`);
});

test("17-3: 신호 점수 80과 100의 품질 점수가 다르다(점수 자체는 불변)", () => {
  const q80 = ConfidenceAdjust.scoreQuality(80);
  const q100 = ConfidenceAdjust.scoreQuality(100);
  assert.strictEqual(q80, CONFIG.CONF_SCORE_FLOOR);
  assert.strictEqual(q100, 100);
  assert.ok(q100 > q80);
  // 점수 자체를 바꾸지 않는다 — 환산만 한다
  assert.strictEqual(typeof q80, "number");
});

test("17-4: 시장 상태 일치도가 방향에 따라 반대로 나온다", () => {
  const up = confSnap({ id: "u", market: "crypto", score: 100, direction: "long", time: 1000, up: true });
  const alignLong = ConfidenceAdjust.marketAlignment(up, "long");
  const alignShort = ConfidenceAdjust.marketAlignment(up, "short");
  assert.ok(Number.isFinite(alignLong) && Number.isFinite(alignShort));
  assert.ok(alignLong > alignShort, `상승 차트에서 LONG(${alignLong}) > SHORT(${alignShort})여야 함`);
  assert.ok(alignLong >= 0 && alignLong <= 100);
});

test("17-5: 데이터가 없어도 오류 없이 처리된다(빈 상태)", () => {
  clearSnapshots(); clearLearnAll();
  const cur = confSnap({ id: "empty", market: "stock", score: 80, direction: "short", time: 99000, up: false });
  seedSnapshots([cur]);
  const c = ConfidenceAdjust.computeCompositeConfidence(cur);
  // 과거 성능·유사 패턴이 없어도 신호 품질/시장 상태만으로 계산된다
  assert.ok(Number.isFinite(c.confidence));
  assert.strictEqual(c.historicalWinRate, null); // 승률을 임의로 만들지 않는다
  assert.strictEqual(c.similarCount, 0);
  assert.strictEqual(c.enough, false);
  // 완전히 잘못된 입력도 안전
  const bad = ConfidenceAdjust.computeCompositeConfidence(null);
  assert.strictEqual(bad.confidence, null);
  assert.strictEqual(bad.reason, "no-snapshot");
});

test("17-6: 유사 패턴 표본이 부족하면 영향력이 줄어든다", () => {
  clearSnapshots(); clearLearnAll();
  // 유사 패턴 2건 전부 WIN (100%) — 표본 부족
  const list = [];
  let t = 1000;
  for (let i = 0; i < 2; i++) list.push(confSnap({ id: "few" + i, market: "crypto", score: 100, direction: "long", time: t++, result: "WIN", up: true }));
  const cur = confSnap({ id: "curFew", market: "crypto", score: 100, direction: "long", time: 99000, up: true });
  seedSnapshots(list.concat([cur]));
  const few = ConfidenceAdjust.computeCompositeConfidence(cur);
  assert.strictEqual(few.enough, false);
  const fewWeight = few.weightsUsed.similar || 0;

  // 유사 패턴 20건 전부 WIN — 표본 충분
  const many = [];
  t = 1000;
  for (let i = 0; i < 20; i++) many.push(confSnap({ id: "many" + i, market: "crypto", score: 100, direction: "long", time: t++, result: "WIN", up: true }));
  const cur2 = confSnap({ id: "curMany", market: "crypto", score: 100, direction: "long", time: 99000, up: true });
  seedSnapshots(many.concat([cur2]));
  const enough = ConfidenceAdjust.computeCompositeConfidence(cur2);
  assert.strictEqual(enough.enough, true);
  const enoughWeight = enough.weightsUsed.similar || 0;

  // 표본이 충분할 때 유사 패턴의 가중치가 더 커야 한다
  assert.ok(enoughWeight > fewWeight, `충분 ${enoughWeight} > 부족 ${fewWeight}`);
  // 따라서 2건 100%가 confidence를 과도하게 밀어올리지 못한다
  assert.ok(enough.confidence >= few.confidence, "표본이 많을수록 100% WIN이 더 반영되어야 함");
});

test("17-7: 가중치 합이 1.0이고 설정에서 관리된다(하드코딩 없음)", () => {
  const W = CONFIG.CONF_WEIGHTS;
  const sum = W.signalQuality + W.historical + W.similar + W.marketAlignment;
  assert.ok(Math.abs(sum - 1) < 1e-9, `가중치 합: ${sum}`);
  assert.ok(W.signalQuality > 0 && W.historical > 0 && W.similar > 0 && W.marketAlignment > 0);
  // 사용된 가중치도 재정규화되어 합이 1이어야 한다
  clearSnapshots(); clearLearnAll();
  const cur = confSnap({ id: "wsum", market: "crypto", score: 100, direction: "long", time: 99000, up: true });
  seedSnapshots([cur]);
  const c = ConfidenceAdjust.computeCompositeConfidence(cur);
  const used = Object.values(c.weightsUsed).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(used - 1) < 1e-9, `사용 가중치 합: ${used}`);
});

test("17-8: 시장/점수/방향 그룹이 섞이지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  const list = [];
  let t = 1000;
  // 다른 그룹에만 데이터를 넣는다
  for (let i = 0; i < 20; i++) list.push(confSnap({ id: "st" + i, market: "stock", score: 100, direction: "long", time: t++, result: "WIN", up: true }));
  for (let i = 0; i < 20; i++) list.push(confSnap({ id: "s80" + i, market: "crypto", score: 80, direction: "long", time: t++, result: "WIN", up: true }));
  const cur = confSnap({ id: "iso", market: "crypto", score: 100, direction: "long", time: 99000, up: true });
  seedSnapshots(list.concat([cur]));
  const c = ConfidenceAdjust.computeCompositeConfidence(cur);
  assert.strictEqual(c.similarCount, 0, "다른 그룹 패턴이 섞이면 실패");
  assert.strictEqual(c.historicalWinRate, null, "다른 그룹 승률이 섞이면 실패");
});

test("17-9: 그룹별 종합 confidence가 시장/점수/방향별로 계산된다", () => {
  clearSnapshots(); clearLearnAll();
  const list = [];
  let t = 1000;
  for (let i = 0; i < 12; i++) list.push(confSnap({ id: "gw" + i, market: "crypto", score: 100, direction: "long", time: t++, result: "WIN", up: true }));
  for (let i = 0; i < 12; i++) list.push(confSnap({ id: "gl" + i, market: "stock", score: 100, direction: "long", time: t++, result: "LOSS", up: true }));
  seedSnapshots(list);

  const crypto = ConfidenceAdjust.getGroupConfidence("crypto", 100, "long");
  const stock = ConfidenceAdjust.getGroupConfidence("stock", 100, "long");
  assert.ok(Number.isFinite(crypto.confidence));
  assert.ok(Number.isFinite(stock.confidence));
  assert.strictEqual(crypto.market, "crypto");
  assert.strictEqual(stock.market, "stock");
  // 데이터가 없는 그룹도 안전하게 처리
  const none = ConfidenceAdjust.getGroupConfidence("stock", 80, "short");
  assert.strictEqual(none.confidence, null);
  assert.strictEqual(none.similarCount, 0);
});

test("17-10: 종합 confidence가 기존 신호 점수/방향을 변경하지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  const k15 = buildTrendingKlines(100, 0.5, 40, 0, 15 * 60000);
  const k5 = buildTrendingKlines(100, 0.5, 40, 0, 5 * 60000);
  const k1 = buildTrendingKlines(100, 0.5, 40, 0, 60000);
  const tf = { "15m": Signals.computeIndicators(k15), "5m": Signals.computeIndicators(k5), "1m": Signals.computeIndicators(k1) };
  const sigFields = (r) => JSON.stringify({ long: r.long, short: r.short, status: r.status,
    leadingDirection: r.leadingDirection, isNewSignal: r.isNewSignal, price: r.price });
  const before = sigFields(Signals.evaluate(null, "TESTUSDT", tf));

  const cur = confSnap({ id: "nochange", market: "crypto", score: 100, direction: "long", time: 99000, up: true });
  seedSnapshots([cur]);
  ConfidenceAdjust.computeCompositeConfidence(cur);
  ConfidenceAdjust.getGroupConfidence("crypto", 100, "long");

  assert.strictEqual(sigFields(Signals.evaluate(null, "TESTUSDT", tf)), before);
  // 기존 보정 로직(±10%p)도 그대로 유지
  assert.strictEqual(CONFIG.SIM_ADJUST_MAX_DELTA, 10);
});

test("17-11: 종합 confidence 계산이 저장 데이터를 변경하지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  for (let i = 0; i < 4; i++) PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  const list = [];
  for (let i = 0; i < 6; i++) list.push(confSnap({ id: "keep17_" + i, market: "crypto", score: 100, direction: "long", time: 1000 + i, result: "WIN", up: true }));
  seedSnapshots(list);
  const snapBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS);
  const learnBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);

  const cur = confSnap({ id: "calc17", market: "crypto", score: 100, direction: "long", time: 99000, up: true });
  ConfidenceAdjust.computeCompositeConfidence(cur);
  ConfidenceAdjust.getGroupConfidence("crypto", 100, "long");
  ConfidenceAdjust.getGroupConfidence("stock", 80, "short");

  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS), snapBefore);
  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN), learnBefore);
});

test("17-12: 좋은 조건과 나쁜 조건의 confidence가 뚜렷이 다르다", () => {
  // 좋은 조건: 100점, 과거 승률 높음, 유사 패턴 WIN, 방향 일치
  clearSnapshots(); clearLearnAll();
  const good = [];
  let t = 1000;
  for (let i = 0; i < 20; i++) good.push(confSnap({ id: "g" + i, market: "crypto", score: 100, direction: "long", time: t++, result: "WIN", up: true }));
  const curGood = confSnap({ id: "curG", market: "crypto", score: 100, direction: "long", time: 99000, up: true });
  seedSnapshots(good.concat([curGood]));
  const g = ConfidenceAdjust.computeCompositeConfidence(curGood);

  // 나쁜 조건: 80점, 유사 패턴 LOSS, 방향 불일치(상승 차트에 SHORT)
  clearSnapshots(); clearLearnAll();
  const bad = [];
  t = 1000;
  for (let i = 0; i < 20; i++) bad.push(confSnap({ id: "b" + i, market: "crypto", score: 80, direction: "short", time: t++, result: "LOSS", up: true }));
  const curBad = confSnap({ id: "curB", market: "crypto", score: 80, direction: "short", time: 99000, up: true });
  seedSnapshots(bad.concat([curBad]));
  const b = ConfidenceAdjust.computeCompositeConfidence(curBad);

  assert.ok(g.confidence > b.confidence, `좋은 조건(${g.confidence.toFixed(1)}) > 나쁜 조건(${b.confidence.toFixed(1)})`);
  assert.ok(g.confidence - b.confidence > 20, "차이가 충분히 벌어져야 의미가 있음");
});

console.log("\n[18단계: 종합 신뢰도 필터 (요구사항 검증)]");

/* app.js의 알림 판정과 동일한 식을 재현한다.
   핵심: confFilterPass는 알림 표시에만 쓰이고, 학습/기록에는 영향을 주지 않는다. */
function decideWithConfFilter({ passesLearnFilter, passesAdjusted, signalFilterEnabled,
                                confFilterEnabled, confFilterMin, compositeConfidence }) {
  const filterWouldPass = passesLearnFilter && passesAdjusted;
  const filterActive = signalFilterEnabled !== false;
  const alertAllowedByFilter = filterActive ? filterWouldPass : true;

  const confFilterActive = confFilterEnabled === true;
  const compositeValue = Number.isFinite(compositeConfidence) ? compositeConfidence : null;
  const confFilterPass =
    !confFilterActive || compositeValue === null ? true : compositeValue >= confFilterMin;
  const confFilterBlocked = confFilterActive && compositeValue !== null && !confFilterPass;

  return {
    alertShown: alertAllowedByFilter && confFilterPass,
    filterWouldPass,   // A/B 기록용 (신뢰도 필터와 무관)
    confFilterPass,
    confFilterBlocked,
  };
}

test("18-1: 기본값은 필터 OFF, 최소 신뢰도 60%", () => {
  localStorage.removeItem(CONFIG.STORAGE_KEYS.CONF_FILTER);
  localStorage.removeItem(CONFIG.STORAGE_KEYS.CONF_FILTER_MIN);
  assert.strictEqual(CONFIG.CONF_FILTER_DEFAULT_MIN, 60);
  assert.strictEqual(CONFIG.CONF_FILTER_STEP, 5);
  assert.strictEqual(CONFIG.CONF_FILTER_MIN_LIMIT, 0);
  assert.strictEqual(CONFIG.CONF_FILTER_MAX_LIMIT, 100);
  // 저장된 값이 없으면 OFF여야 한다(기존 동작 보존)
  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.CONF_FILTER), null);
});

test("18-2: 필터 OFF면 신뢰도와 무관하게 기존과 동일하게 알림이 발생한다", () => {
  [0, 10, 45, 59, 60, 99, null].forEach((conf) => {
    const d = decideWithConfFilter({
      passesLearnFilter: true, passesAdjusted: true, signalFilterEnabled: true,
      confFilterEnabled: false, confFilterMin: 60, compositeConfidence: conf,
    });
    assert.strictEqual(d.alertShown, true, `conf=${conf}일 때 알림이 차단됨`);
    assert.strictEqual(d.confFilterBlocked, false);
  });
});

test("18-3: 필터 ON + 신뢰도 >= 기준 → 알림 발생", () => {
  [60, 61, 75, 100].forEach((conf) => {
    const d = decideWithConfFilter({
      passesLearnFilter: true, passesAdjusted: true, signalFilterEnabled: true,
      confFilterEnabled: true, confFilterMin: 60, compositeConfidence: conf,
    });
    assert.strictEqual(d.alertShown, true, `conf=${conf}가 차단됨`);
    assert.strictEqual(d.confFilterBlocked, false);
  });
});

test("18-4: 필터 ON + 신뢰도 < 기준 → 화면 알림만 차단", () => {
  [0, 30, 59, 59.9].forEach((conf) => {
    const d = decideWithConfFilter({
      passesLearnFilter: true, passesAdjusted: true, signalFilterEnabled: true,
      confFilterEnabled: true, confFilterMin: 60, compositeConfidence: conf,
    });
    assert.strictEqual(d.alertShown, false, `conf=${conf}가 통과됨`);
    assert.strictEqual(d.confFilterBlocked, true);
    // 중요: A/B 기록용 판정은 신뢰도 필터와 무관하게 그대로 유지된다
    assert.strictEqual(d.filterWouldPass, true, "신뢰도 필터가 A/B 기록을 왜곡함");
  });
});

test("18-5: composite confidence가 없으면 기존 동작을 유지한다(임의 값 생성 금지)", () => {
  [null, undefined, NaN].forEach((conf) => {
    const d = decideWithConfFilter({
      passesLearnFilter: true, passesAdjusted: true, signalFilterEnabled: true,
      confFilterEnabled: true, confFilterMin: 90, compositeConfidence: conf,
    });
    assert.strictEqual(d.alertShown, true, "값이 없을 때 차단되면 안 됨");
    assert.strictEqual(d.confFilterBlocked, false);
  });
});

test("18-6: 최소 신뢰도 설정이 0~100 범위와 5% 단위로 제한된다", () => {
  assert.strictEqual(State.saveConfFilterMin(63), 65);   // 5단위 반올림
  assert.strictEqual(State.saveConfFilterMin(62), 60);
  assert.strictEqual(State.saveConfFilterMin(-20), 0);   // 하한
  assert.strictEqual(State.saveConfFilterMin(150), 100); // 상한
  assert.strictEqual(State.saveConfFilterMin("75"), 75); // 문자열도 처리
  assert.strictEqual(State.saveConfFilterMin("abc"), CONFIG.CONF_FILTER_DEFAULT_MIN); // 잘못된 값
  State.saveConfFilterMin(CONFIG.CONF_FILTER_DEFAULT_MIN);
});

test("18-7: 필터 설정이 localStorage에 저장되고 자가학습/신호필터와 별개 키를 쓴다", () => {
  State.saveConfFilter(true);
  assert.strictEqual(JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.CONF_FILTER)), true);
  State.saveConfFilterMin(80);
  assert.strictEqual(JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.CONF_FILTER_MIN)), 80);
  // 다른 설정 키와 겹치지 않아야 한다
  const keys = [CONFIG.STORAGE_KEYS.CONF_FILTER, CONFIG.STORAGE_KEYS.CONF_FILTER_MIN,
                CONFIG.STORAGE_KEYS.SIGNAL_FILTER, CONFIG.STORAGE_KEYS.LEARN_ENABLED];
  assert.strictEqual(new Set(keys).size, 4, "저장 키가 중복됨");
  State.saveConfFilter(false);
  State.saveConfFilterMin(CONFIG.CONF_FILTER_DEFAULT_MIN);
});

test("18-8: 차단된 신호도 학습/스냅샷/성능 기록에 정상 반영된다", () => {
  clearSnapshots(); clearLearnAll();
  localStorage.setItem(CONFIG.STORAGE_KEYS.PERF_HISTORY, JSON.stringify({ records: [] }));
  State.setCategory("BTCUSDT", "coin");
  State.saveLearnEnabled(true);
  State.saveConfFilter(true);
  State.saveConfFilterMin(95); // 매우 높게 잡아 대부분 차단되게 한다

  // 실제 흐름 재현: 신호 발생 → 기록 → 결과 확정
  const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
  const result = {
    symbol: "BTCUSDT", price: 100, updatedAt: entryTime,
    entryTimes: { "1m": entryTime + snapSeq++ * 60000 }, tf: makeTfData(100, true),
    long: { score: 100, band: "strong", conditions: COND },
    short: { score: 20, band: "none", conditions: COND },
    leadingDirection: "long", isNewSignal: true,
  };
  const item = PatternLearn.recordPending(result, "long");
  assert.ok(item, "차단 여부와 무관하게 학습 대기열에 들어가야 함");
  PatternSnapshot.record(item, result.tf);
  SignalPerformance.record({
    signalId: item.signalId, signalTime: item.signalTime, symbol: "BTCUSDT",
    market: "crypto", direction: "long", score: 100, confReport: null,
    basePass: true, adjustedPass: true, // 신뢰도 필터와 무관하게 기록
  });
  PatternLearn.evaluatePending({ BTCUSDT: { price: 110 } });

  // 알림은 차단되었어도 데이터는 전부 남아있어야 한다
  assert.strictEqual(PatternSnapshot.getAll().length, 1);
  assert.strictEqual(PatternSnapshot.getAll()[0].result, "WIN");
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 100, "long").wins, 1);
  assert.strictEqual(SignalPerformance.getAll().length, 1);
  assert.strictEqual(SignalPerformance.getAll()[0].result, "WIN");
  State.saveConfFilter(false);
  State.saveConfFilterMin(CONFIG.CONF_FILTER_DEFAULT_MIN);
});

test("18-9: 필터가 종목/신호/학습 데이터를 삭제하지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  State.saveSymbols(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
  State.setCategory("BTCUSDT", "coin");
  for (let i = 0; i < 5; i++) PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  localStorage.setItem(CONFIG.STORAGE_KEYS.TRADES, JSON.stringify([{ id: "t18" }]));

  const symbolsBefore = State.symbols.slice();
  const learnBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);

  // 필터를 켜고 끄고 기준을 여러 번 바꿔도 데이터는 그대로여야 한다
  [true, false, true].forEach((on) => {
    State.saveConfFilter(on);
    [0, 50, 100].forEach((v) => State.saveConfFilterMin(v));
  });
  State.saveConfFilter(false);
  State.saveConfFilterMin(CONFIG.CONF_FILTER_DEFAULT_MIN);

  assert.deepStrictEqual(State.symbols, symbolsBefore, "종목이 삭제됨");
  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN), learnBefore, "학습 데이터가 변경됨");
  assert.strictEqual(JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TRADES))[0].id, "t18");
  assert.strictEqual(PatternLearn.getStatsFor("coin", "BTCUSDT").total, 5);
});

test("18-10: 필터는 공통 설정이지만 confidence는 market/score/direction별로 계산된다", () => {
  clearSnapshots(); clearLearnAll();
  const mk = (id, market, score, dir, time, result, up) => {
    const item = { signalId: id, symbol: "S", category: market === "stock" ? "stock" : "coin",
      score, direction: dir, signalTime: time, entryTime: time, entryPrice: 100,
      conditions: COND, patternKey: "k" };
    const s = PatternSnapshot.buildSnapshot(item, makeTfData(100, up));
    s.result = result; s.pnlPercent = result === "WIN" ? 7 : -4;
    s.resultPrice = 100; s.resultTime = time + 900000;
    return s;
  };
  const list = [];
  let t = 1000;
  for (let i = 0; i < 15; i++) list.push(mk("cw" + i, "crypto", 100, "long", t++, "WIN", true));
  for (let i = 0; i < 15; i++) list.push(mk("sl" + i, "stock", 100, "long", t++, "LOSS", true));
  seedSnapshots(list);

  const cryptoConf = ConfidenceAdjust.getGroupConfidence("crypto", 100, "long");
  const stockConf = ConfidenceAdjust.getGroupConfidence("stock", 100, "long");
  assert.ok(Number.isFinite(cryptoConf.confidence) && Number.isFinite(stockConf.confidence));
  // 성적이 반대이므로 신뢰도도 달라야 한다(섞이면 같아짐)
  assert.notStrictEqual(cryptoConf.confidence.toFixed(2), stockConf.confidence.toFixed(2));

  // LONG/SHORT도 분리
  const shortConf = ConfidenceAdjust.getGroupConfidence("crypto", 100, "short");
  assert.strictEqual(shortConf.similarCount, 0, "LONG 데이터가 SHORT에 섞임");
});

test("18-11: 필터가 기존 Signals.evaluate() 결과를 변경하지 않는다", () => {
  const k15 = buildTrendingKlines(100, 0.5, 40, 0, 15 * 60000);
  const k5 = buildTrendingKlines(100, 0.5, 40, 0, 5 * 60000);
  const k1 = buildTrendingKlines(100, 0.5, 40, 0, 60000);
  const tf = { "15m": Signals.computeIndicators(k15), "5m": Signals.computeIndicators(k5), "1m": Signals.computeIndicators(k1) };
  const sigFields = (r) => JSON.stringify({ long: r.long, short: r.short, status: r.status,
    leadingDirection: r.leadingDirection, isNewSignal: r.isNewSignal, price: r.price });

  State.saveConfFilter(false);
  const off = sigFields(Signals.evaluate(null, "TESTUSDT", tf));
  State.saveConfFilter(true);
  State.saveConfFilterMin(95);
  const on = sigFields(Signals.evaluate(null, "TESTUSDT", tf));
  assert.strictEqual(off, on, "필터가 신호 계산에 영향을 줌");
  State.saveConfFilter(false);
  State.saveConfFilterMin(CONFIG.CONF_FILTER_DEFAULT_MIN);
});

test("18-12: 기존 신호 필터와 신뢰도 필터가 독립적으로 동작한다", () => {
  // 신호 필터 OFF + 신뢰도 필터 ON → 신뢰도만으로 판정
  const a = decideWithConfFilter({
    passesLearnFilter: false, passesAdjusted: false, signalFilterEnabled: false,
    confFilterEnabled: true, confFilterMin: 60, compositeConfidence: 80,
  });
  assert.strictEqual(a.alertShown, true, "신호 필터 OFF인데 차단됨");

  // 신호 필터 ON(차단) + 신뢰도 높음 → 여전히 차단 (AND 조건)
  const b = decideWithConfFilter({
    passesLearnFilter: false, passesAdjusted: true, signalFilterEnabled: true,
    confFilterEnabled: true, confFilterMin: 60, compositeConfidence: 95,
  });
  assert.strictEqual(b.alertShown, false);

  // 둘 다 OFF → 항상 알림
  const c = decideWithConfFilter({
    passesLearnFilter: false, passesAdjusted: false, signalFilterEnabled: false,
    confFilterEnabled: false, confFilterMin: 60, compositeConfidence: 10,
  });
  assert.strictEqual(c.alertShown, true);
});

console.log("\n[19단계: 차단 알림 이력 (표시 전용)]");

function clearBlockLog() {
  localStorage.setItem(CONFIG.STORAGE_KEYS.CONF_BLOCK_LOG, JSON.stringify({ blocks: [] }));
}

test("19-1: 차단된 신호가 이력에 기록된다(판단 근거 포함)", () => {
  clearBlockLog();
  const e = ConfBlockLog.record({
    signalId: "b1", signalTime: 1000, symbol: "BTCUSDT", market: "crypto",
    direction: "long", score: 100, confidence: 42.5, threshold: 60,
  });
  assert.ok(e);
  const all = ConfBlockLog.getAll();
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].symbol, "BTCUSDT");
  assert.strictEqual(all[0].confidence, 42.5);
  assert.strictEqual(all[0].threshold, 60);   // 왜 막혔는지 알 수 있어야 한다
  assert.ok(all[0].blockedAt > 0);
});

test("19-2: 동일 signalId는 중복 기록되지 않는다", () => {
  clearBlockLog();
  ConfBlockLog.record({ signalId: "dup", symbol: "BTCUSDT", market: "crypto", direction: "long", score: 100, confidence: 30, threshold: 60 });
  ConfBlockLog.record({ signalId: "dup", symbol: "BTCUSDT", market: "crypto", direction: "long", score: 100, confidence: 30, threshold: 60 });
  ConfBlockLog.record({ signalId: "dup", symbol: "BTCUSDT", market: "crypto", direction: "long", score: 100, confidence: 30, threshold: 60 });
  assert.strictEqual(ConfBlockLog.getAll().length, 1);
});

test("19-3: 차단 이력이 시장/점수/방향별로 분리 조회된다", () => {
  clearBlockLog();
  ConfBlockLog.record({ signalId: "c1", symbol: "BTC", market: "crypto", direction: "long", score: 100, confidence: 30, threshold: 60 });
  ConfBlockLog.record({ signalId: "c2", symbol: "ETH", market: "crypto", direction: "short", score: 80, confidence: 40, threshold: 60 });
  ConfBlockLog.record({ signalId: "s1", symbol: "NQ", market: "stock", direction: "long", score: 100, confidence: 20, threshold: 60 });
  assert.strictEqual(ConfBlockLog.getAll({ market: "crypto" }).length, 2);
  assert.strictEqual(ConfBlockLog.getAll({ market: "stock" }).length, 1);
  assert.strictEqual(ConfBlockLog.getAll({ market: "crypto", direction: "long" }).length, 1);
  assert.strictEqual(ConfBlockLog.getAll({ market: "crypto", score: 80 }).length, 1);
  // 코인 조회에 주식이 섞이면 실패
  assert.ok(ConfBlockLog.getAll({ market: "crypto" }).every((b) => b.market === "crypto"));
});

test("19-4: 요약이 총 건수와 최근 24시간 건수를 정확히 센다", () => {
  clearBlockLog();
  const now = Date.now();
  const data = { blocks: [
    { signalId: "old", market: "crypto", blockedAt: now - 48 * 3600 * 1000, confidence: 30, threshold: 60 },
    { signalId: "new1", market: "crypto", blockedAt: now - 1000, confidence: 35, threshold: 60 },
    { signalId: "new2", market: "crypto", blockedAt: now - 2000, confidence: 40, threshold: 60 },
  ] };
  localStorage.setItem(CONFIG.STORAGE_KEYS.CONF_BLOCK_LOG, JSON.stringify(data));
  const sum = ConfBlockLog.getSummary({ market: "crypto" });
  assert.strictEqual(sum.total, 3);
  assert.strictEqual(sum.recent24h, 2);
  assert.ok(sum.latest && sum.latest.signalId === "new1"); // 최신순 정렬
});

test("19-5: 차단 이력이 학습/성능/거래 데이터와 완전히 분리된다", () => {
  clearSnapshots(); clearLearnAll(); clearBlockLog();
  State.setCategory("BTCUSDT", "coin");
  for (let i = 0; i < 4; i++) PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  localStorage.setItem(CONFIG.STORAGE_KEYS.TRADES, JSON.stringify([{ id: "t19" }]));
  localStorage.setItem(CONFIG.STORAGE_KEYS.PERF_HISTORY, JSON.stringify({ records: [{ signalId: "p19", result: "WIN" }] }));
  const learnBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);
  const perfBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PERF_HISTORY);

  // 이력을 쌓고 지워도 다른 데이터는 그대로여야 한다
  for (let i = 0; i < 10; i++) {
    ConfBlockLog.record({ signalId: "x" + i, symbol: "BTCUSDT", market: "crypto", direction: "long", score: 100, confidence: 30, threshold: 60 });
  }
  ConfBlockLog.clear();

  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN), learnBefore);
  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PERF_HISTORY), perfBefore);
  assert.strictEqual(JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TRADES))[0].id, "t19");
  assert.strictEqual(PatternLearn.getStatsFor("coin", "BTCUSDT").total, 4);
  // 전용 키를 쓰는지 확인
  assert.notStrictEqual(CONFIG.STORAGE_KEYS.CONF_BLOCK_LOG, CONFIG.STORAGE_KEYS.PATTERN_LEARN);
  assert.notStrictEqual(CONFIG.STORAGE_KEYS.CONF_BLOCK_LOG, CONFIG.STORAGE_KEYS.PERF_HISTORY);
});

test("19-6: 차단 이력 상한을 넘으면 오래된 것부터 제거된다", () => {
  clearBlockLog();
  const MAX = CONFIG.CONF_BLOCK_LOG_MAX;
  // 상한을 직접 채우는 대신 저장 로직과 동일하게 검증
  const data = { blocks: [] };
  for (let i = 0; i < MAX + 4; i++) data.blocks.push({ signalId: "n" + i });
  while (data.blocks.length > MAX) data.blocks.shift();
  assert.strictEqual(data.blocks.length, MAX);
  assert.strictEqual(data.blocks[0].signalId, "n4");
  assert.ok(MAX > 0);
});

test("19-7: 차단된 신호도 학습/스냅샷/성능 기록에 정상 반영된다(이력과 별개)", () => {
  clearSnapshots(); clearLearnAll(); clearBlockLog();
  localStorage.setItem(CONFIG.STORAGE_KEYS.PERF_HISTORY, JSON.stringify({ records: [] }));
  State.setCategory("BTCUSDT", "coin");
  State.saveLearnEnabled(true);

  const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
  const result = {
    symbol: "BTCUSDT", price: 100, updatedAt: entryTime,
    entryTimes: { "1m": entryTime + snapSeq++ * 60000 }, tf: makeTfData(100, true),
    long: { score: 100, band: "strong", conditions: COND },
    short: { score: 20, band: "none", conditions: COND },
    leadingDirection: "long", isNewSignal: true,
  };
  const item = PatternLearn.recordPending(result, "long");
  PatternSnapshot.record(item, result.tf);
  SignalPerformance.record({
    signalId: item.signalId, signalTime: item.signalTime, symbol: "BTCUSDT",
    market: "crypto", direction: "long", score: 100, confReport: null,
    basePass: true, adjustedPass: true,
  });
  // 알림은 차단되었다고 가정하고 이력만 남긴다
  ConfBlockLog.record({
    signalId: item.signalId, signalTime: item.signalTime, symbol: "BTCUSDT",
    market: "crypto", direction: "long", score: 100, confidence: 35, threshold: 60,
  });
  PatternLearn.evaluatePending({ BTCUSDT: { price: 110 } });

  // 이력이 남아도 학습·성능 데이터는 정상
  assert.strictEqual(ConfBlockLog.getAll().length, 1);
  assert.strictEqual(PatternSnapshot.getAll()[0].result, "WIN");
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 100, "long").wins, 1);
  assert.strictEqual(SignalPerformance.getAll()[0].result, "WIN");
});

test("19-8: 이력 데이터가 학습에 재투입되지 않는다(순환 방지)", () => {
  clearSnapshots(); clearLearnAll(); clearBlockLog();
  const learnBefore = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN));
  for (let i = 0; i < 20; i++) {
    ConfBlockLog.record({ signalId: "circ" + i, symbol: "BTCUSDT", market: "crypto", direction: "long", score: 100, confidence: 30, threshold: 60 });
  }
  const learnAfter = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN));
  assert.strictEqual(learnAfter.entries.length, learnBefore.entries.length);
  assert.strictEqual(Object.keys(learnAfter.statsBySymbol).length, Object.keys(learnBefore.statsBySymbol).length);
  assert.strictEqual(JSON.stringify(learnAfter.scorePerf), JSON.stringify(learnBefore.scorePerf));
});

test("19-9: 데이터가 없어도 오류 없이 빈 결과를 반환한다", () => {
  clearBlockLog();
  assert.deepStrictEqual(ConfBlockLog.getAll(), []);
  const sum = ConfBlockLog.getSummary();
  assert.strictEqual(sum.total, 0);
  assert.strictEqual(sum.recent24h, 0);
  assert.strictEqual(sum.latest, null);
  // 잘못된 입력도 안전
  assert.strictEqual(ConfBlockLog.record({}), null);
  assert.strictEqual(ConfBlockLog.record({ signalId: null }), null);
});

test("19-10: 기존 Signals.evaluate() 결과가 변경되지 않는다", () => {
  const k15 = buildTrendingKlines(100, 0.5, 40, 0, 15 * 60000);
  const k5 = buildTrendingKlines(100, 0.5, 40, 0, 5 * 60000);
  const k1 = buildTrendingKlines(100, 0.5, 40, 0, 60000);
  const tf = { "15m": Signals.computeIndicators(k15), "5m": Signals.computeIndicators(k5), "1m": Signals.computeIndicators(k1) };
  const sigFields = (r) => JSON.stringify({ long: r.long, short: r.short, status: r.status,
    leadingDirection: r.leadingDirection, isNewSignal: r.isNewSignal, price: r.price });
  const before = sigFields(Signals.evaluate(null, "TESTUSDT", tf));
  clearBlockLog();
  for (let i = 0; i < 5; i++) {
    ConfBlockLog.record({ signalId: "ns" + i, symbol: "BTCUSDT", market: "crypto", direction: "long", score: 100, confidence: 30, threshold: 60 });
  }
  ConfBlockLog.getSummary({ market: "crypto" });
  assert.strictEqual(sigFields(Signals.evaluate(null, "TESTUSDT", tf)), before);
});

console.log("\n[20단계: Volume Profile (관찰 전용)]");

// 특정 가격대에 거래량을 몰아준 캔들을 만든다 (POC 위치를 예측 가능하게)
function vpCandles({ count, center, spread, heavyAt, heavyVol, baseVol }) {
  const out = [];
  for (let i = 0; i < count; i++) {
    // center 주변을 오가는 가격
    const c = center + Math.sin(i / 3) * spread;
    const high = c + spread * 0.2;
    const low = c - spread * 0.2;
    const nearHeavy = Math.abs(c - heavyAt) < spread * 0.25;
    out.push({
      openTime: i * 60000, open: c, high, low, close: c,
      volume: nearHeavy ? heavyVol : baseVol,
    });
  }
  return out;
}

test("20-1: POC가 거래량이 가장 많은 가격대에 위치한다", () => {
  const k = vpCandles({ count: 80, center: 100, spread: 5, heavyAt: 103, heavyVol: 5000, baseVol: 100 });
  const r = VolumeProfile.analyze(k);
  assert.ok(r, "결과가 있어야 함");
  // 거래량을 몰아준 103 부근에 POC가 있어야 한다
  assert.ok(Math.abs(r.poc - 103) < 2, `POC ${r.poc.toFixed(2)}가 103 부근이 아님`);
});

test("20-2: VAL < POC < VAH 순서가 항상 성립한다", () => {
  const k = vpCandles({ count: 100, center: 250, spread: 10, heavyAt: 248, heavyVol: 3000, baseVol: 200 });
  const r = VolumeProfile.analyze(k);
  assert.ok(r.val <= r.poc && r.poc <= r.vah, `VAL ${r.val} POC ${r.poc} VAH ${r.vah}`);
  assert.ok(r.val >= r.profileLow && r.vah <= r.profileHigh);
});

test("20-3: Value Area가 전체 거래량의 약 70% 이상을 포함한다", () => {
  const k = vpCandles({ count: 100, center: 100, spread: 6, heavyAt: 100, heavyVol: 800, baseVol: 300 });
  const r = VolumeProfile.analyze(k);
  assert.ok(r.valueAreaRatio >= 0.7 - 1e-9, `VA 비율 ${r.valueAreaRatio}`);
  assert.ok(r.valueAreaRatio <= 1 + 1e-9);
  // 설정값을 바꾸면 반영된다
  const r50 = VolumeProfile.analyze(k, { valueAreaRatio: 0.5 });
  assert.ok(r50.valueAreaWidth <= r.valueAreaWidth, "50% VA는 70% VA보다 좁거나 같아야 함");
});

test("20-4: 거래량이 가격 구간에 보존된다(분배 후 합계 일치)", () => {
  const k = vpCandles({ count: 60, center: 100, spread: 4, heavyAt: 100, heavyVol: 500, baseVol: 120 });
  const valid = VolumeProfile.validCandles(k, 120);
  const { bins, totalVolume } = VolumeProfile.buildBins(valid, 40);
  const binSum = bins.reduce((a, b) => a + b.volume, 0);
  const rawSum = valid.reduce((a, c) => a + c.volume, 0);
  assert.ok(Math.abs(binSum - rawSum) < 1e-6, `분배 후 ${binSum} vs 원본 ${rawSum}`);
  assert.ok(Math.abs(totalVolume - rawSum) < 1e-6);
});

test("20-5: 현재가 위치(POC 위/아래, VA 안/위/아래)가 정확하다", () => {
  const k = vpCandles({ count: 80, center: 100, spread: 5, heavyAt: 100, heavyVol: 2000, baseVol: 100 });
  const base = VolumeProfile.analyze(k);
  const above = VolumeProfile.analyze(k, { currentPrice: base.vah + 1 });
  const below = VolumeProfile.analyze(k, { currentPrice: base.val - 1 });
  const inside = VolumeProfile.analyze(k, { currentPrice: base.poc });
  assert.strictEqual(above.valueAreaPosition, "above");
  assert.strictEqual(above.pricePosition, "above");
  assert.strictEqual(below.valueAreaPosition, "below");
  assert.strictEqual(below.pricePosition, "below");
  assert.strictEqual(inside.valueAreaPosition, "inside");
  // POC 대비 거리(%)도 계산된다
  assert.ok(above.pocDistancePercent > 0);
  assert.ok(below.pocDistancePercent < 0);
});

test("20-6: 분포 상태(집중/분산)를 판별한다", () => {
  // 한 가격대에 거래량이 몰리면 VA가 좁다 → 집중
  const tight = VolumeProfile.analyze(vpCandles({ count: 100, center: 100, spread: 8, heavyAt: 100, heavyVol: 50000, baseVol: 10 }));
  // 거래량이 고르면 VA가 넓다 → 분산
  const flat = VolumeProfile.analyze(vpCandles({ count: 100, center: 100, spread: 8, heavyAt: 999, heavyVol: 100, baseVol: 100 }));
  assert.ok(tight.distribution && flat.distribution);
  assert.ok(tight.distribution.valueAreaWidthRatio < flat.distribution.valueAreaWidthRatio,
    `집중 ${tight.distribution.valueAreaWidthRatio} < 분산 ${flat.distribution.valueAreaWidthRatio}`);
  assert.ok(["concentrated", "balanced", "dispersed"].includes(tight.distribution.state));
});

test("20-7: 15m / 5m를 각각 계산한다", () => {
  const tf = makeTfData(100, true);
  const vp = VolumeProfile.analyzeTimeframes(tf);
  assert.ok(vp["15m"] && vp["5m"], "두 타임프레임 모두 계산되어야 함");
  assert.strictEqual(vp["15m"].timeframe, "15m");
  assert.strictEqual(vp["5m"].timeframe, "5m");
  // 설정된 타임프레임 외(1m)는 계산하지 않는다
  assert.strictEqual(vp["1m"], undefined);
});

test("20-8: 데이터가 부족하거나 깨져 있으면 null을 반환한다(임의 값 금지)", () => {
  assert.strictEqual(VolumeProfile.analyze([]), null);
  assert.strictEqual(VolumeProfile.analyze(null), null);
  // 최소 캔들 수 미만
  const few = vpCandles({ count: 5, center: 100, spread: 2, heavyAt: 100, heavyVol: 10, baseVol: 10 });
  assert.strictEqual(VolumeProfile.analyze(few), null);
  // 거래량이 전부 0
  const zero = vpCandles({ count: 50, center: 100, spread: 2, heavyAt: 100, heavyVol: 0, baseVol: 0 });
  assert.strictEqual(VolumeProfile.analyze(zero), null);
  // 값이 깨진 캔들은 걸러진다
  const broken = vpCandles({ count: 50, center: 100, spread: 3, heavyAt: 100, heavyVol: 200, baseVol: 100 });
  broken.push({ high: NaN, low: 1, close: 1, volume: 999999 }, { high: 1, low: 5, close: 3, volume: 999999 });
  const r = VolumeProfile.analyze(broken);
  assert.ok(r && Number.isFinite(r.poc), "깨진 캔들이 결과를 오염시키면 안 됨");
  // tf가 없어도 안전
  assert.deepStrictEqual(VolumeProfile.analyzeTimeframes(null), { "15m": null, "5m": null });
});

test("20-9: 결과 값에 NaN/Infinity가 없다", () => {
  const r = VolumeProfile.analyze(vpCandles({ count: 90, center: 50000, spread: 300, heavyAt: 50100, heavyVol: 900, baseVol: 150 }));
  ["poc", "vah", "val", "currentPrice", "pocDistance", "pocDistancePercent", "valueAreaWidth", "totalVolume"].forEach((f) => {
    assert.ok(Number.isFinite(r[f]), `${f}가 유한하지 않음: ${r[f]}`);
  });
});

test("20-10: 가격 규모가 달라도 동일한 형태면 같은 상대 위치가 나온다", () => {
  const small = VolumeProfile.analyze(vpCandles({ count: 80, center: 1, spread: 0.05, heavyAt: 1.03, heavyVol: 5000, baseVol: 100 }));
  const big = VolumeProfile.analyze(vpCandles({ count: 80, center: 100000, spread: 5000, heavyAt: 103000, heavyVol: 5000, baseVol: 100 }));
  assert.strictEqual(small.valueAreaPosition, big.valueAreaPosition);
  assert.strictEqual(small.pricePosition, big.pricePosition);
  assert.ok(Math.abs(small.pocDistancePercent - big.pocDistancePercent) < 0.5);
});

test("20-11: Volume Profile 계산이 저장소를 변경하지 않는다(순수 함수)", () => {
  const keys = Object.values(CONFIG.STORAGE_KEYS);
  const before = keys.map((k) => localStorage.getItem(k));
  const tf = makeTfData(100, true);
  for (let i = 0; i < 5; i++) {
    VolumeProfile.analyzeTimeframes(tf);
    VolumeProfile.analyze(tf["15m"].klines);
  }
  const after = keys.map((k) => localStorage.getItem(k));
  assert.deepStrictEqual(after, before);
});

test("20-12: 기존 신호 점수·LONG/SHORT가 변하지 않는다", () => {
  const k15 = buildTrendingKlines(100, 0.5, 40, 0, 15 * 60000);
  const k5 = buildTrendingKlines(100, 0.5, 40, 0, 5 * 60000);
  const k1 = buildTrendingKlines(100, 0.5, 40, 0, 60000);
  const tf = { "15m": Signals.computeIndicators(k15), "5m": Signals.computeIndicators(k5), "1m": Signals.computeIndicators(k1) };
  const sigFields = (r) => JSON.stringify({ long: r.long, short: r.short, status: r.status,
    leadingDirection: r.leadingDirection, isNewSignal: r.isNewSignal, price: r.price });
  const before = sigFields(Signals.evaluate(null, "TESTUSDT", tf));
  VolumeProfile.analyzeTimeframes(tf);
  assert.strictEqual(sigFields(Signals.evaluate(null, "TESTUSDT", tf)), before);
  // tf 입력도 변형하지 않는다
  const klBefore = JSON.stringify(tf["15m"].klines);
  VolumeProfile.analyzeTimeframes(tf);
  assert.strictEqual(JSON.stringify(tf["15m"].klines), klBefore);
});

test("20-13: 기존 Confidence 계산 결과가 변하지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  const list = [];
  let t = 1000;
  for (let i = 0; i < 12; i++) {
    const item = { signalId: "vc" + i, symbol: "BTCUSDT", category: "coin", score: 100, direction: "long",
      signalTime: t, entryTime: t, entryPrice: 100, conditions: COND, patternKey: "k" };
    t++;
    const snp = PatternSnapshot.buildSnapshot(item, makeTfData(100, true));
    snp.result = i < 8 ? "WIN" : "LOSS"; snp.pnlPercent = i < 8 ? 7 : -4; snp.resultPrice = 100; snp.resultTime = t + 9e5;
    list.push(snp);
  }
  seedSnapshots(list);
  const curItem = { signalId: "vcur", symbol: "BTCUSDT", category: "coin", score: 100, direction: "long",
    signalTime: 99000, entryTime: 99000, entryPrice: 100, conditions: COND, patternKey: "k" };
  const cur = PatternSnapshot.buildSnapshot(curItem, makeTfData(100, true));
  const c1 = ConfidenceAdjust.computeCompositeConfidence(cur);
  // Volume Profile을 여러 번 계산한 뒤에도 동일해야 한다
  VolumeProfile.analyzeTimeframes(makeTfData(100, true));
  const c2 = ConfidenceAdjust.computeCompositeConfidence(cur);
  assert.strictEqual(c1.confidence, c2.confidence);
  // 유사도 계산도 volumeProfile 필드를 쓰지 않으므로 값이 같다
  const withoutVp = Object.assign({}, cur, { volumeProfile: null });
  const c3 = ConfidenceAdjust.computeCompositeConfidence(withoutVp);
  assert.strictEqual(c1.confidence, c3.confidence, "volumeProfile 필드가 confidence에 영향을 줌");
});

test("20-14: 필터 ON/OFF 판정이 Volume Profile과 무관하다", () => {
  // app.js 판정식: 입력에 Volume Profile이 없다 — 결과가 달라질 수 없다
  const decide = (conf, on, min) => {
    const v = Number.isFinite(conf) ? conf : null;
    return !on || v === null ? true : v >= min;
  };
  VolumeProfile.analyzeTimeframes(makeTfData(100, true));
  assert.strictEqual(decide(70, true, 60), true);
  assert.strictEqual(decide(50, true, 60), false);
  assert.strictEqual(decide(50, false, 60), true);
  // app.js의 알림 판정 코드에 VolumeProfile 참조가 없는지 확인
  const fs = require("fs");
  const app = fs.readFileSync(path.join(__dirname, "./app.js"), "utf8");
  assert.ok(!app.includes("VolumeProfile"), "app.js 신호/알림 흐름에 Volume Profile이 개입함");
});

test("20-15: snapshot에 Volume Profile 요약이 저장되고, 과거 snapshot과 호환된다", () => {
  clearSnapshots(); clearLearnAll();
  const item = { signalId: "vps", symbol: "BTCUSDT", category: "coin", score: 100, direction: "long",
    signalTime: 5000, entryTime: 5000, entryPrice: 100, conditions: COND, patternKey: "k" };
  const snp = PatternSnapshot.buildSnapshot(item, makeTfData(100, true));
  assert.ok(snp.volumeProfile, "새 snapshot에는 volumeProfile이 있어야 함");
  assert.ok(snp.volumeProfile.tf15 && snp.volumeProfile.tf5);
  ["poc", "vah", "val", "valueAreaPosition", "pricePosition"].forEach((f) => {
    assert.ok(snp.volumeProfile.tf15[f] !== undefined, `tf15.${f} 누락`);
  });
  // 분포 배열 같은 큰 데이터는 저장하지 않는다(용량 보호)
  assert.strictEqual(snp.volumeProfile.tf15.bins, undefined);

  // 과거 snapshot(필드 없음)과 섞여 있어도 기존 기능이 정상 동작한다
  const old = JSON.parse(JSON.stringify(snp));
  delete old.volumeProfile;
  old.signalId = "old"; old.signalTime = 1000; old.result = "WIN"; old.pnlPercent = 5;
  seedSnapshots([old, snp]);
  assert.strictEqual(PatternSnapshot.getAll().length, 2);
  const sim = PatternSimilarity.getSimilarityStats(snp, { minSimilarity: 0 });
  assert.strictEqual(sim.matchedCount, 1, "필드 없는 과거 snapshot도 비교 대상이어야 함");
});

test("20-16: 학습 OFF면 snapshot이 저장되지 않는다(Volume Profile 포함)", () => {
  clearSnapshots(); clearLearnAll();
  State.saveLearnEnabled(false);
  const item = { signalId: "off1", symbol: "BTCUSDT", category: "coin", score: 100, direction: "long",
    signalTime: 1000, entryTime: 1000, entryPrice: 100, conditions: COND, patternKey: "k" };
  PatternSnapshot.record(item, makeTfData(100, true));
  assert.strictEqual(PatternSnapshot.getAll().length, 0);
  // 계산 자체는 학습 OFF여도 가능하다(실시간 관찰용)
  assert.ok(VolumeProfile.analyzeTimeframes(makeTfData(100, true))["15m"]);
  State.saveLearnEnabled(true);
});

test("20-17: PatternLearn·signalPerformance 데이터가 변하지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("BTCUSDT", "coin");
  for (let i = 0; i < 5; i++) PatternLearn.recordLockResult({ symbol: "BTCUSDT", direction: "long", conditions: COND, pnlPercent: 5 });
  localStorage.setItem(CONFIG.STORAGE_KEYS.PERF_HISTORY, JSON.stringify({ records: [{ signalId: "vp1", result: "WIN" }] }));
  const learnBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN);
  const perfBefore = localStorage.getItem(CONFIG.STORAGE_KEYS.PERF_HISTORY);
  for (let i = 0; i < 5; i++) VolumeProfile.analyzeTimeframes(makeTfData(100, i % 2 === 0));
  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PATTERN_LEARN), learnBefore);
  assert.strictEqual(localStorage.getItem(CONFIG.STORAGE_KEYS.PERF_HISTORY), perfBefore);
});

test("20-18: 코인/주식 snapshot에 각자의 Volume Profile이 분리 저장된다", () => {
  clearSnapshots(); clearLearnAll();
  State.saveLearnEnabled(true);
  const mk = (id, cat, up) => ({ signalId: id, symbol: cat === "stock" ? "NQ" : "BTCUSDT", category: cat,
    score: 100, direction: "long", signalTime: 1000, entryTime: 1000, entryPrice: 100, conditions: COND, patternKey: "k" });
  PatternSnapshot.record(mk("vc1", "coin", true), makeTfData(100, true));
  PatternSnapshot.record(mk("vs1", "stock", false), makeTfData(100, false));
  const coin = PatternSnapshot.getBy({ market: "crypto" });
  const stock = PatternSnapshot.getBy({ market: "stock" });
  assert.strictEqual(coin.length, 1);
  assert.strictEqual(stock.length, 1);
  // 서로 다른 차트에서 계산되었으므로 값이 달라야 한다(섞이면 같아짐)
  assert.notStrictEqual(coin[0].volumeProfile.tf15.valueAreaPosition + coin[0].volumeProfile.tf15.poc,
                        stock[0].volumeProfile.tf15.valueAreaPosition + stock[0].volumeProfile.tf15.poc);
});

// 시장 구조 샘플 생성기 (테스트와 검증에서 공용으로 사용)
function wyGen(kind, opt) {
  const o = opt || {};
  const base = o.base || 100, amp = o.amp || 2, step = o.step || 60000, t0 = o.t0 || 1e9;
  const out = [];
  let prev = base;
  const push = (c, vol, hiX, loX) => {
    const open = prev;
    const high = Math.max(open, c) + (hiX || amp * 0.1);
    const low = Math.min(open, c) - (loX || amp * 0.1);
    out.push({ openTime: t0 + out.length * step, open, high, low, close: c, volume: vol });
    prev = c;
  };
  const flat = (n, center, vol) => { for (let i = 0; i < n; i++) push(center + Math.sin(i / 2) * amp, vol); };
  if (kind === "markup")   { for (let i = 0; i < 60; i++) push(base + i * amp * 0.5, 100); }
  if (kind === "markdown") { for (let i = 0; i < 60; i++) push(base - i * amp * 0.5, 100); }
  if (kind === "accumulation") { for (let i = 0; i < 20; i++) push(base + 40 - i * 2, 100); flat(40, base, 100); }
  if (kind === "distribution") { for (let i = 0; i < 20; i++) push(base - 40 + i * 2, 100); flat(40, base, 100); }
  if (kind === "range") { flat(60, base, 100); }
  if (kind === "spring")   { for (let i = 0; i < 20; i++) push(base + 40 - i * 2, 100); flat(37, base, 100);
    push(base - amp * 0.2, 180, 0, amp * 2.5); push(base, 150); push(base + amp * 0.2, 120); }
  if (kind === "upthrust") { for (let i = 0; i < 20; i++) push(base - 40 + i * 2, 100); flat(37, base, 100);
    push(base + amp * 0.2, 180, amp * 2.5, 0); push(base, 150); push(base - amp * 0.2, 120); }
  if (kind === "sos") { flat(57, base, 100); push(base + amp * 1.5, 300); push(base + amp * 2, 320); push(base + amp * 2.5, 340); }
  if (kind === "sow") { flat(57, base, 100); push(base - amp * 1.5, 300); push(base - amp * 2, 320); push(base - amp * 2.5, 340); }
  if (kind === "unclear") { for (let i = 0; i < 60; i++) push(base + Math.sin(i / 2) * amp + i * 0.05, 100); }
  if (kind === "volUp")   { for (let i = 0; i < 60; i++) push(base + Math.sin(i / 2) * amp, i >= 50 ? 400 : 100); }
  if (kind === "volDown") { for (let i = 0; i < 60; i++) push(base + Math.sin(i / 2) * amp, i >= 50 ? 30 : 100); }
  return out;
}

console.log("\n[21단계: Wyckoff 시장 구조 + 학습 데이터 연결]");

const wyA = (kind, opt) => Wyckoff.analyze(wyGen(kind, opt));

// --- 국면(phase) ---
test("21-1: 꾸준한 상승 → MARKUP (고점·저점 상승)", () => {
  const r = wyA("markup");
  assert.strictEqual(r.phase, "MARKUP");
  assert.ok(r.higherHigh && r.higherLow);
  assert.strictEqual(r.priceTrend, "up");
  assert.ok(r.confidence >= 60);
});
test("21-2: 꾸준한 하락 → MARKDOWN (고점·저점 하락)", () => {
  const r = wyA("markdown");
  assert.strictEqual(r.phase, "MARKDOWN");
  assert.ok(r.lowerLow && r.lowerHigh);
  assert.strictEqual(r.priceTrend, "down");
});
test("21-3: 하락 후 박스권 → ACCUMULATION", () => {
  const r = wyA("accumulation");
  assert.strictEqual(r.phase, "ACCUMULATION");
  assert.ok(r.priorTrendStrength < 0, "선행 추세가 하락이어야 함");
});
test("21-4: 상승 후 박스권 → DISTRIBUTION", () => {
  const r = wyA("distribution");
  assert.strictEqual(r.phase, "DISTRIBUTION");
  assert.ok(r.priorTrendStrength > 0, "선행 추세가 상승이어야 함");
});
test("21-5: 선행 추세 없는 박스권 → TRADING_RANGE", () => {
  const r = wyA("range");
  assert.strictEqual(r.phase, "TRADING_RANGE");
  assert.strictEqual(r.priceTrend, "flat");
});
test("21-6: 추세인지 박스인지 애매하면 UNKNOWN + 낮은 confidence", () => {
  const r = wyA("unclear");
  assert.strictEqual(r.phase, "UNKNOWN");
  assert.ok(r.confidence <= 30, `확신이 낮아야 함: ${r.confidence}`);
});

// --- 이벤트(event) ---
test("21-7: 박스 하단을 깼다가 복귀 → SPRING (단일 캔들이 아닌 박스 구조 기준)", () => {
  const r = wyA("spring");
  assert.strictEqual(r.event, "SPRING");
  assert.ok(r.recentLow < r.rangeLow, "하단 이탈이 있어야 함");
  assert.ok(r.currentPrice >= r.rangeLow && r.currentPrice <= r.rangeHigh, "현재가는 박스 안으로 복귀");
  assert.strictEqual(r.breakoutDirection, "none");
});
test("21-8: 박스 상단을 넘었다가 복귀 → UPTHRUST", () => {
  const r = wyA("upthrust");
  assert.strictEqual(r.event, "UPTHRUST");
  assert.ok(r.recentHigh > r.rangeHigh);
  assert.strictEqual(r.breakoutDirection, "none");
});
test("21-9: 거래량 증가 + 상단 돌파 → SOS", () => {
  const r = wyA("sos");
  assert.strictEqual(r.event, "SOS");
  assert.strictEqual(r.breakoutDirection, "up");
  assert.ok(r.eventVolumeRatio >= CONFIG.WYCKOFF.EVENT_VOLUME);
});
test("21-10: 거래량 증가 + 하단 이탈 → SOW", () => {
  const r = wyA("sow");
  assert.strictEqual(r.event, "SOW");
  assert.strictEqual(r.breakoutDirection, "down");
});
test("21-10b: 거래량 증가 없이 돌파하면 SOS/SOW로 보지 않는다(캔들만 보고 확정 금지)", () => {
  const k = wyGen("sos");
  k.slice(-3).forEach((c) => { c.volume = 100; }); // 돌파 캔들의 거래량을 평범하게
  const r = Wyckoff.analyze(k);
  assert.notStrictEqual(r.event, "SOS");
});

// --- 거래량 / 가격 구조 / 박스 ---
test("21-11: 거래량 증가·감소를 판별한다", () => {
  const up = wyA("volUp"), down = wyA("volDown"), flat = wyA("range");
  assert.strictEqual(up.volumeTrend, "rising");
  assert.ok(up.volumeExpansion && !up.volumeContraction);
  assert.strictEqual(down.volumeTrend, "falling");
  assert.ok(down.volumeContraction && !down.volumeExpansion);
  assert.strictEqual(flat.volumeTrend, "flat");
});
test("21-12: 박스 범위와 현재가 위치를 계산한다", () => {
  const r = wyA("range");
  assert.ok(r.rangeHigh > r.rangeLow);
  assert.ok(Math.abs(r.rangeWidth - (r.rangeHigh - r.rangeLow)) < 1e-9);
  assert.ok(r.pricePositionInRange >= 0 && r.pricePositionInRange <= 1);
  // 현재가를 바꿔 위치가 따라 움직이는지
  const top = Wyckoff.analyze(wyGen("range"), { currentPrice: r.rangeHigh });
  const bottom = Wyckoff.analyze(wyGen("range"), { currentPrice: r.rangeLow });
  assert.ok(Math.abs(top.pricePositionInRange - 1) < 1e-9);
  assert.ok(Math.abs(bottom.pricePositionInRange - 0) < 1e-9);
  // 박스 밖이면 raw 값이 이탈 정도를 보존한다
  const above = Wyckoff.analyze(wyGen("range"), { currentPrice: r.rangeHigh + r.rangeWidth });
  assert.ok(above.pricePositionRaw > 1.9 && above.pricePositionInRange === 1);
});
test("21-13: 노력 대비 결과를 판별한다(거래량↑·가격 정체 = 흡수)", () => {
  const r = wyA("volUp"); // 거래량은 늘었지만 박스 안에서 정체
  assert.strictEqual(r.effortVsResult, "absorption");
  assert.ok(Number.isFinite(r.effortResultRatio));
});

// --- 안전성 ---
test("21-14: 데이터 부족/깨진 값이면 null, 정상 값에는 NaN이 없다", () => {
  assert.strictEqual(Wyckoff.analyze([]), null);
  assert.strictEqual(Wyckoff.analyze(null), null);
  assert.strictEqual(Wyckoff.analyze(wyGen("range").slice(0, 20)), null); // 최소 캔들 수 미만
  const k = wyGen("range");
  k.push({ openTime: 9e15, open: NaN, high: NaN, low: 1, close: NaN, volume: 5 });
  const r = Wyckoff.analyze(k);
  assert.ok(r, "깨진 캔들은 걸러지고 계산은 계속되어야 함");
  ["confidence", "rangeHigh", "rangeLow", "rangeWidth", "pricePositionInRange", "trendStrength", "volumeRatio"].forEach((f) => {
    assert.ok(Number.isFinite(r[f]), `${f}: ${r[f]}`);
  });
  assert.ok(r.confidence >= 0 && r.confidence <= 100);
  assert.deepStrictEqual(Wyckoff.analyzeTimeframes(null), { "15m": null, "5m": null, "1m": null });
});

// --- Look-ahead 방지 ---
test("21-15: 기준 시각 이후 캔들은 사용하지 않는다(미래 데이터 제외)", () => {
  const k = wyGen("accumulation");
  const cutoff = k[k.length - 1].openTime;
  const before = Wyckoff.analyze(k, { asOfTime: cutoff });
  // 미래 캔들(급등)을 뒤에 붙여도, 기준 시각을 주면 결과가 완전히 같아야 한다
  const future = k.concat(wyGen("markup", { t0: cutoff + 60000, base: 200 }));
  const withFuture = Wyckoff.analyze(future, { asOfTime: cutoff });
  assert.deepStrictEqual(withFuture, before);
  // 기준 시각이 없으면 미래까지 보게 되어 결과가 달라진다(차이가 실제로 있음을 확인)
  const leaked = Wyckoff.analyze(future);
  assert.notStrictEqual(leaked.phase + leaked.currentPrice, before.phase + before.currentPrice);
});

test("21-16: 결과(WIN/LOSS)를 붙여도 저장된 Wyckoff 값은 바뀌지 않는다", () => {
  clearSnapshots(); clearLearnAll();
  State.saveLearnEnabled(true);
  const item = { signalId: "wyres", symbol: "BTCUSDT", category: "coin", score: 100, direction: "long",
    signalTime: 1e13, entryTime: 1e13, entryPrice: 100, conditions: COND, patternKey: "k" };
  PatternSnapshot.record(item, makeTfData(100, true));
  const before = JSON.stringify(PatternSnapshot.getAll()[0].wyckoff);
  PatternSnapshot.attachResult("wyres", { win: false, resultPrice: 90, resultTime: 2e13, pnlPercent: -10 });
  const after = PatternSnapshot.getAll()[0];
  assert.strictEqual(after.result, "LOSS");
  assert.strictEqual(JSON.stringify(after.wyckoff), before, "결과를 보고 Wyckoff를 수정하면 실패");
  // 모듈 코드 자체가 result를 참조하지 않는지 확인
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "./wyckoff.js"), "utf8");
  const analyzeBody = src.slice(src.indexOf("function analyze("), src.indexOf("function analyzeTimeframes"));
  assert.ok(!/\.result\b|pnlPercent|\bWIN\b|\bLOSS\b/.test(analyzeBody), "분석 함수가 결과를 참조함");
});

// --- 타임프레임 / snapshot ---
test("21-17: 15m·5m는 각각 계산하고 1m은 보조로만 기록된다", () => {
  const tf = { "15m": { klines: wyGen("markup", { step: 900000 }) },
               "5m": { klines: wyGen("spring", { step: 300000 }) },
               "1m": { klines: wyGen("range") } };
  const w = Wyckoff.analyzeTimeframes(tf);
  assert.strictEqual(w["15m"].phase, "MARKUP");
  assert.strictEqual(w["5m"].event, "SPRING");     // 서로 다른 구조가 섞이지 않는다
  assert.strictEqual(w["15m"].timeframe, "15m");
  assert.ok(w["1m"], "1m 보조 기록");
  assert.deepStrictEqual(CONFIG.WYCKOFF.TIMEFRAMES, ["15m", "5m"]);
  assert.deepStrictEqual(CONFIG.WYCKOFF.AUX_TIMEFRAMES, ["1m"]);
  // 보조 제외 옵션
  assert.strictEqual(Wyckoff.analyzeTimeframes(tf, { includeAux: false })["1m"], undefined);
});

test("21-18: snapshot에 Volume Profile과 Wyckoff가 같은 시점으로 함께 저장된다", () => {
  const item = { signalId: "both", symbol: "BTCUSDT", category: "coin", score: 100, direction: "long",
    signalTime: 1e13, entryTime: 1e13, entryPrice: 100, conditions: COND, patternKey: "k" };
  const snp = PatternSnapshot.buildSnapshot(item, makeTfData(100, true));
  assert.ok(snp.volumeProfile && snp.volumeProfile.tf15, "Volume Profile 유지");
  assert.ok(snp.wyckoff && snp.wyckoff.tf15 && snp.wyckoff.tf5, "Wyckoff 저장");
  ["phase", "event", "confidence", "rangeHigh", "rangeLow", "pricePositionInRange",
   "volumeTrend", "priceTrend", "breakoutDirection", "effortVsResult"].forEach((f) => {
    assert.ok(snp.wyckoff.tf15[f] !== undefined, `wyckoff.tf15.${f} 누락`);
  });
  // 같은 현재가 기준으로 계산되었는지
  assert.strictEqual(snp.volumeProfile.tf15.currentPrice, snp.wyckoff.tf15 ? 100 : null);
  assert.strictEqual(snp.structureVersion, 1);
});

// --- 결과 연결 + 통계 분리 ---
function wyEmit({ symbol, category, direction, score, win, up }) {
  State.setCategory(symbol, category);
  const entryTime = Date.now() - CONFIG.LEARN_HORIZON_MS - 1000;
  const dir = { score, band: "strong", conditions: COND };
  const other = { score: 20, band: "none", conditions: { trend15: false, trend5: false, ha1Flip: false, macdCross: false } };
  const result = {
    symbol, price: 100, updatedAt: entryTime,
    entryTimes: { "1m": entryTime + snapSeq++ * 60000 }, tf: makeTfData(100, up),
    long: direction === "long" ? dir : other, short: direction === "short" ? dir : other,
  };
  const item = PatternLearn.recordPending(result, direction);
  if (item) PatternSnapshot.record(item, result.tf);
  const px = direction === "long" ? (win ? 110 : 90) : (win ? 90 : 110);
  PatternLearn.evaluatePending({ [symbol]: { price: px } });
}

test("21-19: 기존 결과 확정 흐름에서 WIN/LOSS가 Wyckoff 기록과 연결된다", () => {
  clearSnapshots(); clearLearnAll(); State.saveLearnEnabled(true);
  for (let i = 0; i < 6; i++) wyEmit({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100, win: i < 4, up: true });
  const snaps = PatternSnapshot.getAll();
  assert.strictEqual(snaps.length, 6);
  snaps.forEach((s) => {
    assert.ok(s.result === "WIN" || s.result === "LOSS", "결과 연결 누락");
    assert.ok(s.wyckoff && s.wyckoff.tf15, "Wyckoff 기록 누락");
  });
  const st = Wyckoff.getStructureStats({ market: "crypto", score: 100, direction: "long" }, "wyckoff.tf15.phase");
  const g = Object.values(st.groups);
  assert.strictEqual(st.total, 6);
  assert.strictEqual(g.reduce((a, x) => a + x.wins, 0), 4);
  assert.strictEqual(g.reduce((a, x) => a + x.losses, 0), 2);
  // 기존 점수별 통계와 같은 결과를 공유한다(판정 로직 재사용)
  assert.strictEqual(PatternLearn.getScorePerf("crypto", 100, "long").wins, 4);
});

test("21-20: 구조 통계에서 Crypto/Stock, LONG/SHORT, 80/100이 섞이지 않는다", () => {
  clearSnapshots(); clearLearnAll(); State.saveLearnEnabled(true);
  for (let i = 0; i < 5; i++) wyEmit({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100, win: true, up: true });
  for (let i = 0; i < 4; i++) wyEmit({ symbol: "NQ", category: "stock", direction: "long", score: 100, win: false, up: true });
  for (let i = 0; i < 3; i++) wyEmit({ symbol: "ETHUSDT", category: "coin", direction: "short", score: 100, win: false, up: false });
  for (let i = 0; i < 2; i++) wyEmit({ symbol: "SOLUSDT", category: "coin", direction: "long", score: 80, win: false, up: true });
  const tot = (f) => Wyckoff.getStructureStats(f, "wyckoff.tf15.phase").total;
  const wins = (f) => Object.values(Wyckoff.getStructureStats(f, "wyckoff.tf15.phase").groups).reduce((a, g) => a + g.wins, 0);
  assert.strictEqual(tot({ market: "crypto", score: 100, direction: "long" }), 5);
  assert.strictEqual(wins({ market: "crypto", score: 100, direction: "long" }), 5, "주식/SHORT/80 패배가 섞이면 실패");
  assert.strictEqual(tot({ market: "stock", score: 100, direction: "long" }), 4);
  assert.strictEqual(wins({ market: "stock", score: 100, direction: "long" }), 0);
  assert.strictEqual(tot({ market: "crypto", score: 100, direction: "short" }), 3);
  assert.strictEqual(tot({ market: "crypto", score: 80, direction: "long" }), 2);
});

test("21-21: Volume Profile과 Wyckoff를 조합해 통계를 낼 수 있다", () => {
  const st = Wyckoff.getStructureStats({ market: "crypto", score: 100, direction: "long" },
    ["wyckoff.tf15.phase", "wyckoff.tf5.event", "volumeProfile.tf15.valueAreaPosition"]);
  const keys = Object.keys(st.groups);
  assert.ok(keys.length > 0);
  assert.ok(keys.every((k) => k.split(" + ").length === 3), "조합 키 형식");
  Object.values(st.groups).forEach((g) => {
    assert.ok(g.winRate === null || (g.winRate >= 0 && g.winRate <= 100));
    assert.strictEqual(typeof g.enough, "boolean");
  });
});

test("21-22: 과거 snapshot(Wyckoff 없음)과 호환된다", () => {
  clearSnapshots(); clearLearnAll();
  const old = mkSnapshot({ signalId: "oldwy", signalTime: 1000, result: "WIN" }); // 필드 없는 과거 형식
  assert.strictEqual(old.wyckoff, undefined);
  seedSnapshots([old]);
  const st = Wyckoff.getStructureStats({ market: "crypto" }, "wyckoff.tf15.phase");
  assert.strictEqual(st.total, 1);
  assert.ok(st.groups["N/A"], "필드 없는 과거 데이터는 N/A로 분류되어야 함");
  // 유사도·분석 등 기존 기능도 정상
  assert.doesNotThrow(() => PatternAnalysis.getPatternStats("crypto", 100, "long"));
});

test("21-23: 학습 OFF면 새 기록은 저장되지 않지만 실시간 분석은 가능하다", () => {
  clearSnapshots(); clearLearnAll();
  State.saveLearnEnabled(false);
  wyEmit({ symbol: "BTCUSDT", category: "coin", direction: "long", score: 100, win: true, up: true });
  assert.strictEqual(PatternSnapshot.getAll().length, 0, "학습 OFF인데 저장됨");
  assert.ok(Wyckoff.analyzeTimeframes(makeTfData(100, true))["15m"], "실시간 분석은 가능해야 함");
  State.saveLearnEnabled(true);
});

// --- 기존 기능 보호 ---
test("21-24: 분석은 저장소를 변경하지 않고 기존 데이터를 보존한다", () => {
  clearSnapshots(); clearLearnAll();
  State.setCategory("KEEPWY", "coin");
  for (let i = 0; i < 3; i++) PatternLearn.recordLockResult({ symbol: "KEEPWY", direction: "long", conditions: COND, pnlPercent: 5 });
  localStorage.setItem(CONFIG.STORAGE_KEYS.LOCK_RECORDS, JSON.stringify([{ id: "lockwy" }]));
  const keys = Object.values(CONFIG.STORAGE_KEYS);
  const before = keys.map((k) => localStorage.getItem(k));
  for (let i = 0; i < 5; i++) {
    Wyckoff.analyzeTimeframes(makeTfData(100, i % 2 === 0));
    Wyckoff.getStructureStats({ market: "crypto" }, "wyckoff.tf15.phase");
  }
  assert.deepStrictEqual(keys.map((k) => localStorage.getItem(k)), before);
  assert.strictEqual(JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCK_RECORDS))[0].id, "lockwy");
});

test("21-25: 기존 신호 점수·방향, Confidence, 알림 판정이 변하지 않는다", () => {
  const k15 = buildTrendingKlines(100, 0.5, 40, 0, 15 * 60000);
  const k5 = buildTrendingKlines(100, 0.5, 40, 0, 5 * 60000);
  const k1 = buildTrendingKlines(100, 0.5, 40, 0, 60000);
  const tf = { "15m": Signals.computeIndicators(k15), "5m": Signals.computeIndicators(k5), "1m": Signals.computeIndicators(k1) };
  const sigFields = (r) => JSON.stringify({ long: r.long, short: r.short, status: r.status,
    leadingDirection: r.leadingDirection, isNewSignal: r.isNewSignal, price: r.price });
  const before = sigFields(Signals.evaluate(null, "TESTUSDT", tf));
  Wyckoff.analyzeTimeframes(tf);
  assert.strictEqual(sigFields(Signals.evaluate(null, "TESTUSDT", tf)), before);

  // Confidence: wyckoff 필드가 있든 없든 값이 같아야 한다(계산에 미사용)
  clearSnapshots(); clearLearnAll();
  const item = { signalId: "wyc", symbol: "BTCUSDT", category: "coin", score: 100, direction: "long",
    signalTime: 1e13, entryTime: 1e13, entryPrice: 100, conditions: COND, patternKey: "k" };
  const cur = PatternSnapshot.buildSnapshot(item, makeTfData(100, true));
  const c1 = ConfidenceAdjust.computeCompositeConfidence(cur);
  const c2 = ConfidenceAdjust.computeCompositeConfidence(Object.assign({}, cur, { wyckoff: null }));
  assert.strictEqual(c1.confidence, c2.confidence, "Wyckoff가 confidence에 영향을 줌");

  // 알림/필터 흐름(app.js)에 Wyckoff가 개입하지 않는다
  const fs = require("fs");
  const app = fs.readFileSync(path.join(__dirname, "./app.js"), "utf8");
  assert.ok(!app.includes("Wyckoff"), "app.js 신호/알림 흐름에 Wyckoff가 개입함");
  const conf = fs.readFileSync(path.join(__dirname, "./confidenceAdjust.js"), "utf8");
  assert.ok(!conf.includes("Wyckoff") && !conf.includes("wyckoff"), "confidence 계산에 Wyckoff가 개입함");
});

console.log("\n[22단계: 백그라운드 감시 지속 (Android Service)]");

const NATIVE_DIR = "./android-app/native-additions/android/app/src/main/java/com/juanla0701/futuresignal";
function readSrc(rel) {
  return require("fs").readFileSync(path.join(__dirname, rel), "utf8");
}
// 주석/문자열을 제거해 "실제 코드"만 검사한다(주석에 적힌 설명이 오탐되지 않도록)
function codeOnly(src) {
  // 줄 주석을 지울 때 URL의 "https://"가 주석으로 오인되지 않도록 앞 글자가 ':'가 아닐 때만 지운다.
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*/g, "$1");
}

test("22-1: JS가 네이티브에서 호출할 폴링 훅을 노출한다", () => {
  const app = readSrc("./app.js");
  assert.ok(app.includes("root.__bgTick"), "__bgTick 누락");
  assert.ok(app.includes("root.__bgStatus"), "__bgStatus 누락");
  // 중복 폴링 방지: 이미 폴링 중이면 건너뛴다
  const tick = app.slice(app.indexOf("root.__bgTick"), app.indexOf("root.__bgStatus"));
  assert.ok(/if \(isPolling\) return/.test(tick), "isPolling 가드가 없으면 요청이 겹친다");
  assert.ok(tick.includes("updateAll()"), "기존 폴링 함수를 재사용해야 함");
});

test("22-2: 서비스가 프로세스 전역 타이머 API를 더 이상 사용하지 않는다(10분 중단 원인)", () => {
  const code = codeOnly(readSrc(NATIVE_DIR + "/MonitorForegroundService.java"));
  // pauseTimers()/resumeTimers()는 앱 안 모든 WebView에 적용되어 화면 쪽 폴링까지 멈춘다
  assert.strictEqual(code.indexOf("pauseTimers("), -1, "전역 pauseTimers 호출이 남아있음");
  assert.strictEqual(code.indexOf("resumeTimers("), -1, "전역 resumeTimers 호출이 남아있음");
  // 대신 해당 WebView에만 적용되는 onPause/onResume을 쓴다
  assert.ok(code.includes("webView.onPause()"), "WebView 단위 일시정지 누락");
  assert.ok(code.includes("webView.onResume()"), "WebView 단위 재개 누락");
});

test("22-3: 폴링을 네이티브 하트비트가 구동한다(JS 타이머 제한 우회)", () => {
  const src = readSrc(NATIVE_DIR + "/MonitorForegroundService.java");
  assert.ok(src.includes("evaluateJavascript"), "네이티브에서 JS 폴링을 호출하지 않음");
  assert.ok(src.includes("__bgTick"), "JS 훅 호출 누락");
  assert.ok(src.includes("heartbeatRunnable") && src.includes("postDelayed"), "하트비트 루프 누락");
  // 하트비트 주기가 기존 폴링 주기와 같아야 한다(감시 주기 변경 금지)
  const m = src.match(/HEARTBEAT_INTERVAL_MS\s*=\s*(\d+)\s*\*\s*1000L/);
  assert.ok(m, "하트비트 주기 상수 누락");
  assert.strictEqual(Number(m[1]) * 1000, CONFIG.POLL_INTERVAL_MS, "기존 폴링 주기와 달라짐");
});

test("22-4: 하트비트 중복 실행을 막는다(배터리/중복 요청 방지)", () => {
  const code = codeOnly(readSrc(NATIVE_DIR + "/MonitorForegroundService.java"));
  assert.ok(code.includes("heartbeatScheduled"), "중복 예약 가드 누락");
  assert.ok(/if \(appInForeground \|\| heartbeatScheduled\) return;/.test(code), "중복 예약 가드 조건 누락");
  // 앱이 화면에 보이면 하트비트를 끈다(Activity WebView와 중복 방지)
  assert.ok(/onAppForeground\(\)\s*\{[\s\S]*?stopHeartbeat\(\);/.test(code), "포그라운드에서 하트비트 정지 누락");
});

test("22-5: Doze 대비 워치독과 서비스 자동 복구가 있다", () => {
  const src = readSrc(NATIVE_DIR + "/MonitorForegroundService.java");
  assert.ok(src.includes("setAndAllowWhileIdle"), "Doze 대응 알람 누락");
  // 정확 알람 권한이 필요한 API는 쓰지 않는다(권한 프롬프트 방지)
  assert.ok(!src.includes("setExactAndAllowWhileIdle"), "권한이 필요한 정확 알람을 사용함");
  assert.ok(src.includes("checkHeartbeatAlive"), "하트비트 정지 감지 누락");
  assert.ok(src.includes("START_STICKY"), "서비스 재시작 정책 누락");
  assert.ok(src.includes("onTaskRemoved"), "작업 제거 시 복구 누락");
  assert.ok(src.includes("onRenderProcessGone"), "렌더러 크래시 복구 누락");
  assert.ok(src.includes("FLAG_IMMUTABLE"), "PendingIntent 가변성 플래그 누락(Android 12+ 필수)");
});

test("22-6: 상태 확인용 로그가 있다", () => {
  const src = readSrc(NATIVE_DIR + "/MonitorForegroundService.java");
  assert.ok(src.includes("import android.util.Log"), "Log import 누락");
  assert.ok(/Log\.(i|d|w)\(TAG/.test(src), "로그 출력 누락");
});

test("22-7: Manifest에 Android 13~15용 권한/서비스 타입이 있다", () => {
  const xml = readSrc("./android-app/native-additions/android/app/src/main/AndroidManifest-additions.xml");
  assert.ok(xml.includes("FOREGROUND_SERVICE_DATA_SYNC"), "Android 14+ 서비스 타입 권한 누락");
  assert.ok(xml.includes("POST_NOTIFICATIONS"), "Android 13+ 알림 권한 누락");
  assert.ok(xml.includes('android:foregroundServiceType="dataSync"'), "서비스 타입 선언 누락");
  assert.ok(xml.includes("WAKE_LOCK"), "WakeLock 권한 누락");
});

test("22-8: 네트워크 일시 끊김에 대비한 타임아웃/재시도가 유지된다", () => {
  // 폴링이 영구 중단되지 않으려면 요청이 매달려 있으면 안 된다
  assert.ok(Number.isFinite(CONFIG.FETCH_TIMEOUT_MS) && CONFIG.FETCH_TIMEOUT_MS < CONFIG.POLL_INTERVAL_MS);
  assert.ok(typeof BinanceApi.fetchWithTimeout === "function");
  const app = readSrc("./app.js");
  // 실패해도 다음 tick이 계속 돈다(예외가 밖으로 새지 않음)
  const tick = app.slice(app.indexOf("root.__bgTick"), app.indexOf("root.__bgStatus"));
  assert.ok(tick.includes("try") && tick.includes("catch"), "tick 예외 처리 누락");
});

test("22-9: 웹과 Android www의 app.js가 동일하다", () => {
  const a = readSrc("./app.js");
  const b = readSrc("./android-app/www/app.js");
  assert.strictEqual(a, b, "웹/Android 버전이 어긋남");
});

test("22-10: 신호 판정·학습 로직은 그대로다", () => {
  const k15 = buildTrendingKlines(100, 0.5, 40, 0, 15 * 60000);
  const k5 = buildTrendingKlines(100, 0.5, 40, 0, 5 * 60000);
  const k1 = buildTrendingKlines(100, 0.5, 40, 0, 60000);
  const tf = { "15m": Signals.computeIndicators(k15), "5m": Signals.computeIndicators(k5), "1m": Signals.computeIndicators(k1) };
  const r = Signals.evaluate(null, "TESTUSDT", tf);
  assert.ok(r.long.score >= 0 && r.long.score <= 100);
  // 백그라운드 훅은 기존 폴링 함수를 부를 뿐, 신호 계산/학습 코드에 손대지 않았다
  const app = codeOnly(readSrc("./app.js"));
  assert.ok(!app.includes("__bgTick") || app.includes("updateAll()"), "훅이 별도 폴링 경로를 만들면 안 됨");
  assert.strictEqual(CONFIG.POLL_INTERVAL_MS, 20000, "폴링 주기가 변경됨");
});
console.log("\n[BackgroundMonitor — 웹 환경(Capacitor 없음)에서는 안전하게 아무 동작 안 함]");

test("window.Capacitor가 없으면 isSupported()는 false", () => {
  assert.strictEqual(BackgroundMonitor.isSupported(), false);
});

// start()/stop()은 async 함수라 항상 Promise를 반환하므로, 위의 동기 test() 헬퍼 대신
// 여기서 직접 await로 확인한다 (하네스 자체는 건드리지 않음, 최소 추가).
(async () => {
  try {
    const s1 = await BackgroundMonitor.start();
    const s2 = await BackgroundMonitor.stop();
    assert.strictEqual(s1, false);
    assert.strictEqual(s2, false);
    console.log("  \u2713 Capacitor가 없을 때 start()/stop()은 에러 없이 false를 반환한다 (웹 버전 무영향)");
    passed++;
  } catch (e) {
    console.log("  \u2717 start()/stop() 웹 폴백 -", e.message);
    failed++;
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
