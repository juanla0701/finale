/* =========================================================================
   VolumeProfile — 거래량 분포 분석 (10단계, 관찰 전용)

   목적: 가격대별 거래량 분포에서 POC / Value Area(VAH·VAL)를 구하고,
   현재가가 그 안에서 어디에 있는지 보여준다.

   설계 원칙:
   - 순수 계산 함수다. 저장소를 읽거나 쓰지 않으며 Binance API도 호출하지 않는다.
     이미 받아둔 klines(OHLCV)만 입력으로 받는다 — 중복 폴링이 생기지 않는다.
   - 이번 단계에서는 신호 판정에 관여하지 않는다. Signals.evaluate(), 점수,
     LONG/SHORT, confidence, 필터, 학습에 아무 영향도 주지 않는다.
   - 데이터가 부족하거나 값이 깨져 있으면 임의 값을 만들지 않고 null을 반환한다.

   계산 방식:
   1) 최근 N개 캔들의 고가~저가 범위를 BIN 개수로 균등 분할한다.
   2) 각 캔들의 거래량을 그 캔들이 걸친 가격 구간에 나눠 담는다.
      (캔들 내부 분포는 알 수 없으므로 고저 범위에 균등 배분한다 — 일반적인 근사법)
   3) 거래량이 가장 많은 구간의 중앙값을 POC로 삼는다.
   4) POC에서 시작해 위아래 중 거래량이 많은 쪽을 차례로 흡수하면서
      전체 거래량의 VALUE_AREA_RATIO(기본 70%)에 도달할 때까지 확장한다.
      그 구간의 상단이 VAH, 하단이 VAL이다.
   ========================================================================= */
(function (root) {
  const CONFIG = root.CONFIG;
  const isNum = (v) => Number.isFinite(v);

  function cfg(key, fallback) {
    const v = CONFIG && CONFIG.VOLUME_PROFILE ? CONFIG.VOLUME_PROFILE[key] : undefined;
    return isNum(v) ? v : fallback;
  }

  // 유효한 캔들만 남긴다 (값이 깨진 캔들이 분포를 왜곡하지 않도록)
  function validCandles(klines, lookback) {
    if (!Array.isArray(klines)) return [];
    const list = klines.filter(
      (k) =>
        k &&
        isNum(k.high) && isNum(k.low) && isNum(k.close) &&
        isNum(k.volume) && k.volume >= 0 &&
        k.high >= k.low && k.low > 0
    );
    const n = isNum(lookback) && lookback > 0 ? lookback : cfg("LOOKBACK", 120);
    return list.slice(-n);
  }

  /* 가격대별 거래량 분포(bins)를 만든다. */
  function buildBins(candles, binCount) {
    const bins = [];
    if (candles.length === 0) return { bins, low: null, high: null, binSize: null, totalVolume: 0 };

    let low = Infinity;
    let high = -Infinity;
    candles.forEach((k) => {
      if (k.low < low) low = k.low;
      if (k.high > high) high = k.high;
    });
    if (!isNum(low) || !isNum(high) || high <= low) {
      return { bins, low: null, high: null, binSize: null, totalVolume: 0 };
    }

    const count = Math.max(2, Math.floor(binCount));
    const binSize = (high - low) / count;
    for (let i = 0; i < count; i++) {
      bins.push({
        index: i,
        low: low + i * binSize,
        high: low + (i + 1) * binSize,
        mid: low + (i + 0.5) * binSize,
        volume: 0,
      });
    }

    let totalVolume = 0;
    candles.forEach((k) => {
      totalVolume += k.volume;
      // 이 캔들이 걸친 구간 범위를 구한다.
      let startIdx = Math.floor((k.low - low) / binSize);
      let endIdx = Math.floor((k.high - low) / binSize);
      startIdx = Math.max(0, Math.min(count - 1, startIdx));
      endIdx = Math.max(0, Math.min(count - 1, endIdx));
      const span = endIdx - startIdx + 1;
      // 캔들 내부 분포는 알 수 없으므로 걸친 구간에 균등 배분한다.
      const share = k.volume / span;
      for (let i = startIdx; i <= endIdx; i++) bins[i].volume += share;
    });

    return { bins, low, high, binSize, totalVolume };
  }

  /* POC에서 확장하며 Value Area를 구한다. */
  function findValueArea(bins, totalVolume, ratio) {
    if (bins.length === 0 || totalVolume <= 0) return null;

    // POC: 거래량이 가장 많은 구간
    let pocIdx = 0;
    bins.forEach((b, i) => {
      if (b.volume > bins[pocIdx].volume) pocIdx = i;
    });

    const target = totalVolume * ratio;
    let acc = bins[pocIdx].volume;
    let lowIdx = pocIdx;
    let highIdx = pocIdx;

    // 위아래 중 거래량이 많은 쪽을 차례로 흡수한다.
    while (acc < target && (lowIdx > 0 || highIdx < bins.length - 1)) {
      const below = lowIdx > 0 ? bins[lowIdx - 1].volume : -1;
      const above = highIdx < bins.length - 1 ? bins[highIdx + 1].volume : -1;
      if (above >= below && above >= 0) {
        highIdx++;
        acc += bins[highIdx].volume;
      } else if (below >= 0) {
        lowIdx--;
        acc += bins[lowIdx].volume;
      } else {
        break;
      }
    }

    return {
      pocIdx,
      poc: bins[pocIdx].mid,
      val: bins[lowIdx].low,
      vah: bins[highIdx].high,
      valueAreaVolume: acc,
      valueAreaRatio: totalVolume > 0 ? acc / totalVolume : null,
      lowIdx,
      highIdx,
    };
  }

  /* 분포가 한 곳에 몰려 있는지(집중) 흩어져 있는지(분산) 판단한다.
     Value Area가 전체 가격 범위에서 차지하는 비율로 본다 — 좁을수록 집중. */
  function classifyDistribution(vaWidth, fullRange) {
    if (!isNum(vaWidth) || !isNum(fullRange) || fullRange <= 0) return null;
    const ratio = vaWidth / fullRange;
    const concentrated = cfg("CONCENTRATED_RATIO", 0.35);
    const dispersed = cfg("DISPERSED_RATIO", 0.65);
    let state = "balanced";
    if (ratio <= concentrated) state = "concentrated";
    else if (ratio >= dispersed) state = "dispersed";
    return { state, valueAreaWidthRatio: ratio };
  }

  /* 한 타임프레임의 Volume Profile을 계산한다.
     klines: [{high, low, close, volume}, ...] (기존 구조 그대로)
     currentPrice: 없으면 마지막 캔들 종가를 사용한다. */
  function analyze(klines, options) {
    const opts = options || {};
    const candles = validCandles(klines, opts.lookback);
    const minCandles = cfg("MIN_CANDLES", 20);
    if (candles.length < minCandles) return null; // 자료가 부족하면 억지로 만들지 않는다

    const { bins, low, high, binSize, totalVolume } = buildBins(candles, opts.bins || cfg("BINS", 40));
    if (bins.length === 0 || totalVolume <= 0) return null;

    const ratio = isNum(opts.valueAreaRatio) ? opts.valueAreaRatio : cfg("VALUE_AREA_RATIO", 0.7);
    const va = findValueArea(bins, totalVolume, ratio);
    if (!va) return null;

    const price = isNum(opts.currentPrice) ? opts.currentPrice : candles[candles.length - 1].close;
    if (!isNum(price) || price <= 0) return null;

    // 현재가가 Value Area 안/위/아래 어디인지
    let valueAreaPosition = "inside";
    if (price > va.vah) valueAreaPosition = "above";
    else if (price < va.val) valueAreaPosition = "below";

    // POC 대비 위치와 거리
    const pocDistance = price - va.poc;
    const pocDistancePercent = va.poc > 0 ? (pocDistance / va.poc) * 100 : null;
    const pricePosition = pocDistance > 0 ? "above" : pocDistance < 0 ? "below" : "at";

    // Value Area 안에서의 상대 위치(0=VAL, 1=VAH) — 안에 있을 때만 의미가 있다
    const vaWidth = va.vah - va.val;
    const valueAreaDepth = vaWidth > 0 ? (price - va.val) / vaWidth : null;

    return {
      poc: va.poc,
      vah: va.vah,
      val: va.val,
      currentPrice: price,
      // 현재가 ↔ POC
      pricePosition,                 // above | below | at
      pocDistance,
      pocDistancePercent,
      // 현재가 ↔ Value Area
      valueAreaPosition,             // inside | above | below
      valueAreaDepth,                // 0~1 (inside일 때 참고)
      valueAreaWidth: vaWidth,
      valueAreaRatio: va.valueAreaRatio,
      // 분포 상태
      distribution: classifyDistribution(vaWidth, high - low),
      // 계산 근거
      profileHigh: high,
      profileLow: low,
      binSize,
      binCount: bins.length,
      totalVolume,
      candleCount: candles.length,
    };
  }

  /* 여러 타임프레임을 한 번에 계산한다.
     tf: Signals.computeIndicators() 결과 묶음 { "15m": {klines,...}, "5m": {...} }
     이미 받아둔 데이터만 사용하므로 추가 요청이 발생하지 않는다. */
  function analyzeTimeframes(tf, options) {
    const opts = options || {};
    const frames = opts.timeframes || cfg("TIMEFRAMES", null) ||
      (CONFIG.VOLUME_PROFILE && CONFIG.VOLUME_PROFILE.TIMEFRAMES) || ["15m", "5m"];
    const out = {};
    frames.forEach((name) => {
      const d = tf && tf[name];
      const klines = d && Array.isArray(d.klines) ? d.klines : null;
      const res = klines ? analyze(klines, opts) : null;
      out[name] = res ? Object.assign({ timeframe: name }, res) : null;
    });
    return out;
  }

  root.VolumeProfile = {
    analyze,
    analyzeTimeframes,
    buildBins,
    findValueArea,
    classifyDistribution,
    validCandles,
  };
})(typeof window !== "undefined" ? window : globalThis);
