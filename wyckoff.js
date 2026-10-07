/* =========================================================================
   Wyckoff — 시장 구조 분석 (관찰·학습 기반 전용)

   목적: 신호가 발생한 시점의 시장 구조(국면/이벤트)를 수치와 함께 기록해,
   나중에 "어떤 구조에서 신호가 잘 맞았는지" 학습할 수 있게 한다.

   설계 원칙:
   - 순수 계산이다. Binance API를 호출하지 않고, 이미 받아둔 klines만 입력으로 받는다.
   - 신호 점수·LONG/SHORT·confidence·필터·알림에 관여하지 않는다(이번 단계).
   - Look-ahead 금지: 입력으로 받은 캔들(=신호 시점까지의 캔들)만 사용한다.
     asOfTime을 주면 그 이후 캔들은 무조건 잘라낸다. WIN/LOSS 결과는 전혀 참조하지 않는다.
   - 캔들 하나로 확정하지 않는다. 가격 변화 + 거래량 + 최근 구조를 함께 보고,
     애매하면 UNKNOWN 또는 낮은 confidence를 반환한다.

   계산 개요:
   - 박스(range): 최근 WINDOW개 캔들 중 "마지막 EVENT_LOOKBACK개를 뺀" 구간의 고가/저가.
     마지막 몇 개를 빼는 이유는, 최근 캔들이 박스를 이탈했는지(이벤트)를 보기 위해서다.
   - 추세 강도: 박스 구간 시작→끝 종가 변화를 박스 폭으로 나눈 값(-1~+1 근처).
   - 선행 추세: 박스 이전 구간의 종가 변화(누적/분산 판별 근거).
   - 거래량 추세: 최근 구간 평균 거래량 / 이전 구간 평균 거래량.
   - 이벤트(최근 캔들 기준):
       SPRING   : 박스 하단을 잠깐 깼다가 다시 박스 안으로 복귀
       UPTHRUST : 박스 상단을 잠깐 넘었다가 다시 박스 안으로 복귀
       SOS      : 거래량 증가를 동반한 상단 돌파(종가가 박스 위)
       SOW      : 거래량 증가를 동반한 하단 이탈(종가가 박스 아래)
   ========================================================================= */
(function (root) {
  const CONFIG = root.CONFIG;
  const isNum = (v) => Number.isFinite(v);

  function cfg(key, fallback) {
    const w = CONFIG && CONFIG.WYCKOFF;
    const v = w ? w[key] : undefined;
    return v === undefined || v === null ? fallback : v;
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  function validCandles(klines, asOfTime) {
    if (!Array.isArray(klines)) return [];
    return klines.filter(
      (k) =>
        k &&
        isNum(k.high) && isNum(k.low) && isNum(k.close) && isNum(k.open) &&
        isNum(k.volume) && k.volume >= 0 &&
        k.high >= k.low && k.low > 0 &&
        // Look-ahead 방지: 기준 시각 이후의 캔들은 사용하지 않는다
        (!isNum(asOfTime) || !isNum(k.openTime) || k.openTime <= asOfTime)
    );
  }

  /* 한 타임프레임의 Wyckoff 구조 분석 */
  function analyze(klines, options) {
    const opts = options || {};
    const window = cfg("WINDOW", 40);
    const eventLookback = cfg("EVENT_LOOKBACK", 3);
    const minCandles = cfg("MIN_CANDLES", 40);

    const all = validCandles(klines, opts.asOfTime);
    if (all.length < minCandles) return null; // 자료 부족 → 판단하지 않는다

    const recent = all.slice(-window);                    // 분석 창
    const prior = all.slice(0, all.length - window);      // 분석 창 이전(선행 추세 판단용)
    const rangeCandles = recent.slice(0, recent.length - eventLookback); // 박스 구간
    const eventCandles = recent.slice(-eventLookback);    // 이벤트 판단 구간
    if (rangeCandles.length < 10) return null;

    const last = recent[recent.length - 1];
    const price = isNum(opts.currentPrice) ? opts.currentPrice : last.close;

    // ---- 박스(range) ----
    let rangeHigh = -Infinity, rangeLow = Infinity;
    rangeCandles.forEach((k) => {
      if (k.high > rangeHigh) rangeHigh = k.high;
      if (k.low < rangeLow) rangeLow = k.low;
    });
    const rangeWidth = rangeHigh - rangeLow;
    if (!(rangeWidth > 0)) return null;
    const rangeMid = (rangeHigh + rangeLow) / 2;
    const rangeWidthPercent = (rangeWidth / rangeMid) * 100;
    const pricePositionRaw = (price - rangeLow) / rangeWidth;           // 박스 밖이면 0 미만/1 초과
    const pricePositionInRange = clamp(pricePositionRaw, 0, 1);

    // ---- 가격 구조 (박스 구간을 절반으로 나눠 고점/저점 비교) ----
    const half = Math.floor(rangeCandles.length / 2);
    const firstHalf = rangeCandles.slice(0, half);
    const secondHalf = rangeCandles.slice(half);
    const hi = (arr) => Math.max.apply(null, arr.map((k) => k.high));
    const lo = (arr) => Math.min.apply(null, arr.map((k) => k.low));
    const h1 = hi(firstHalf), h2 = hi(secondHalf), l1 = lo(firstHalf), l2 = lo(secondHalf);
    const tol = rangeWidth * 0.05; // 5% 이내 차이는 같은 것으로 본다
    const higherHigh = h2 > h1 + tol;
    const lowerHigh = h2 < h1 - tol;
    const higherLow = l2 > l1 + tol;
    const lowerLow = l2 < l1 - tol;

    // ---- 추세 ----
    // 첫 캔들→마지막 캔들 차이만 보면 박스 안의 출렁임 위치에 따라 값이 흔들린다.
    // 모든 캔들의 종가에 선형회귀를 적용해 "구간 전체의 기울기"로 추세를 잰다.
    const regressionMove = (arr) => {
      const n = arr.length;
      if (n < 2) return 0;
      let sx = 0, sy = 0, sxy = 0, sxx = 0;
      arr.forEach((k, i) => { sx += i; sy += k.close; sxy += i * k.close; sxx += i * i; });
      const denom = n * sxx - sx * sx;
      const slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
      return slope * (n - 1); // 구간 전체에서의 추정 이동폭
    };
    const trendStrength = regressionMove(rangeCandles) / rangeWidth;
    const priceTrend = trendStrength > 0.35 ? "up" : trendStrength < -0.35 ? "down" : "flat";
    let priorTrendStrength = null;
    if (prior.length >= 5) {
      priorTrendStrength = regressionMove(prior) / rangeWidth;
    }

    // ---- 거래량 ----
    const volRecentN = cfg("VOLUME_RECENT", 10);
    const volRecent = avg(recent.slice(-volRecentN).map((k) => k.volume));
    const volBase = avg(recent.slice(0, recent.length - volRecentN).map((k) => k.volume));
    const volumeRatio = isNum(volRecent) && isNum(volBase) && volBase > 0 ? volRecent / volBase : null;
    const expandAt = cfg("VOLUME_EXPANSION", 1.3);
    const contractAt = cfg("VOLUME_CONTRACTION", 0.75);
    const volumeExpansion = isNum(volumeRatio) && volumeRatio >= expandAt;
    const volumeContraction = isNum(volumeRatio) && volumeRatio <= contractAt;
    const volumeTrend = volumeExpansion ? "rising" : volumeContraction ? "falling" : "flat";

    // ---- 이벤트 (최근 캔들이 박스를 어떻게 다뤘는가) ----
    const rangeAvgVol = avg(rangeCandles.map((k) => k.volume)) || 0;
    const eventVolRatio = rangeAvgVol > 0 ? avg(eventCandles.map((k) => k.volume)) / rangeAvgVol : null;
    const eventVolHigh = isNum(eventVolRatio) && eventVolRatio >= cfg("EVENT_VOLUME", 1.2);
    const minLow = Math.min.apply(null, eventCandles.map((k) => k.low));
    const maxHigh = Math.max.apply(null, eventCandles.map((k) => k.high));
    const insideNow = price >= rangeLow && price <= rangeHigh;

    let event = "NONE";
    let eventScore = 0;
    if (price > rangeHigh && eventVolHigh) {
      event = "SOS"; eventScore = 60 + clamp((eventVolRatio - 1.2) * 40, 0, 30);
    } else if (price < rangeLow && eventVolHigh) {
      event = "SOW"; eventScore = 60 + clamp((eventVolRatio - 1.2) * 40, 0, 30);
    } else if (minLow < rangeLow && insideNow) {
      // 하단을 깼다가 복귀 — 복귀 폭이 클수록 확실
      const depth = (rangeLow - minLow) / rangeWidth;
      event = "SPRING"; eventScore = 50 + clamp(depth * 200, 0, 25) + (eventVolHigh ? 10 : 0);
    } else if (maxHigh > rangeHigh && insideNow) {
      const depth = (maxHigh - rangeHigh) / rangeWidth;
      event = "UPTHRUST"; eventScore = 50 + clamp(depth * 200, 0, 25) + (eventVolHigh ? 10 : 0);
    }
    const breakoutDirection = price > rangeHigh ? "up" : price < rangeLow ? "down" : "none";

    // ---- Effort vs Result (노력=거래량, 결과=가격 이동) ----
    // 거래량은 늘었는데 가격이 안 움직이면(흡수) 비율이 낮다.
    const moveNorm = Math.abs(last.close - recent[recent.length - volRecentN].close) / rangeWidth;
    const effortNorm = isNum(volumeRatio) ? volumeRatio : 1;
    const effortResultRatio = effortNorm > 0 ? moveNorm / effortNorm : null;
    // 거래량이 늘었다면(큰 노력) 결과가 큰지(일치) 작은지(흡수)로 반드시 나눈다 —
    // 중간 구간을 남겨두면 거래량 급증 상황이 분류되지 않는 공백이 생긴다.
    let effortVsResult = "neutral";
    if (isNum(volumeRatio) && volumeRatio >= expandAt) {
      effortVsResult = moveNorm >= 0.5 ? "harmony" : "absorption"; // 큰 노력 → 큰 결과 / 작은 결과
    } else if (isNum(volumeRatio) && volumeRatio <= contractAt && moveNorm >= 0.5) {
      effortVsResult = "ease"; // 작은 노력, 큰 결과
    }

    // ---- 국면(phase) 판정 ----
    let phase = "UNKNOWN";
    let phaseScore = 25;
    const abs = Math.abs(trendStrength);
    if (trendStrength >= 0.6 && (higherHigh || higherLow) && !lowerLow) {
      phase = "MARKUP";
      phaseScore = 55 + clamp((trendStrength - 0.6) * 60, 0, 25) + (higherHigh && higherLow ? 15 : 0);
    } else if (trendStrength <= -0.6 && (lowerLow || lowerHigh) && !higherHigh) {
      phase = "MARKDOWN";
      phaseScore = 55 + clamp((abs - 0.6) * 60, 0, 25) + (lowerLow && lowerHigh ? 15 : 0);
    } else if (abs < 0.35) {
      // 박스권 — 선행 추세와 이벤트로 누적/분산을 가린다
      const priorDown = isNum(priorTrendStrength) && priorTrendStrength <= -0.4;
      const priorUp = isNum(priorTrendStrength) && priorTrendStrength >= 0.4;
      const accVotes = (priorDown ? 1 : 0) + (event === "SPRING" ? 1 : 0) + (event === "SOS" ? 1 : 0);
      const disVotes = (priorUp ? 1 : 0) + (event === "UPTHRUST" ? 1 : 0) + (event === "SOW" ? 1 : 0);
      if (accVotes > disVotes) {
        phase = "ACCUMULATION";
        phaseScore = 45 + accVotes * 15 + (volumeContraction ? 5 : 0);
      } else if (disVotes > accVotes) {
        phase = "DISTRIBUTION";
        phaseScore = 45 + disVotes * 15 + (volumeContraction ? 5 : 0);
      } else {
        phase = "TRADING_RANGE";
        phaseScore = 50 + clamp((0.35 - abs) * 60, 0, 15);
      }
    }
    // 0.35~0.6 구간(추세인지 박스인지 애매) 또는 구조 충돌은 UNKNOWN으로 남긴다.

    const confidence = Math.round(clamp(phaseScore, 0, 100));

    return {
      phase,
      event,
      confidence,
      eventConfidence: event === "NONE" ? null : Math.round(clamp(eventScore, 0, 100)),
      // 박스
      rangeHigh,
      rangeLow,
      rangeWidth,
      rangeWidthPercent,
      currentPrice: price,
      pricePositionInRange,        // 0~1 (박스 밖이면 0 또는 1로 고정)
      pricePositionRaw,            // 박스 밖 이탈 정도까지 보존
      breakoutDirection,           // up | down | none
      // 추세
      priceTrend,                  // up | down | flat
      trendStrength,
      priorTrendStrength,
      // 거래량
      volumeTrend,                 // rising | falling | flat
      volumeRatio,
      volumeExpansion,
      volumeContraction,
      eventVolumeRatio: eventVolRatio,
      // 노력 대비 결과
      effortVsResult,              // absorption | ease | harmony | neutral
      effortResultRatio,
      // 구조
      recentHigh: maxHigh,
      recentLow: minLow,
      higherHigh,
      lowerHigh,
      higherLow,
      lowerLow,
      candleCount: all.length,
    };
  }

  /* 여러 타임프레임을 한 번에 분석한다(이미 받아둔 tf 데이터만 사용).
     15m/5m은 기본, 1m은 보조(AUX)로만 계산한다. */
  function analyzeTimeframes(tf, options) {
    const opts = options || {};
    const frames = opts.timeframes || cfg("TIMEFRAMES", ["15m", "5m"]).concat(opts.includeAux === false ? [] : cfg("AUX_TIMEFRAMES", ["1m"]));
    const out = {};
    frames.forEach((name) => {
      const d = tf && tf[name];
      const r = d && Array.isArray(d.klines) ? analyze(d.klines, opts) : null;
      out[name] = r ? Object.assign({ timeframe: name }, r) : null;
    });
    return out;
  }

  /* snapshot 저장용 요약(순수 데이터). 큰 배열은 넣지 않는다. */
  function summarize(r) {
    if (!r) return null;
    const n = (v) => (isNum(v) ? v : null);
    return {
      timeframe: r.timeframe || null,
      phase: r.phase,
      event: r.event,
      confidence: n(r.confidence),
      eventConfidence: n(r.eventConfidence),
      rangeHigh: n(r.rangeHigh),
      rangeLow: n(r.rangeLow),
      rangeWidthPercent: n(r.rangeWidthPercent),
      pricePositionInRange: n(r.pricePositionInRange),
      pricePositionRaw: n(r.pricePositionRaw),
      breakoutDirection: r.breakoutDirection,
      priceTrend: r.priceTrend,
      trendStrength: n(r.trendStrength),
      volumeTrend: r.volumeTrend,
      volumeRatio: n(r.volumeRatio),
      volumeExpansion: !!r.volumeExpansion,
      volumeContraction: !!r.volumeContraction,
      effortVsResult: r.effortVsResult,
      effortResultRatio: n(r.effortResultRatio),
      higherHigh: !!r.higherHigh,
      lowerHigh: !!r.lowerHigh,
      higherLow: !!r.higherLow,
      lowerLow: !!r.lowerLow,
    };
  }

  /* =======================================================================
     학습용 통계 (읽기 전용)
     결과가 확정된 snapshot을 market+score+direction으로 먼저 나눈 뒤,
     원하는 구조 항목(예: 15m Wyckoff phase)별로 WIN/LOSS를 센다.
     Confidence나 신호에 반영하지 않는다 — 관찰·검증용이다.

     groupBy 예시:
       "wyckoff.tf15.phase"
       "wyckoff.tf5.event"
       "volumeProfile.tf15.valueAreaPosition"
     여러 개를 배열로 주면 조합 키로 묶는다.
     ======================================================================= */
  function getPath(obj, path) {
    return path.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
  }

  function getStructureStats(filter, groupBy) {
    const f = filter || {};
    const keys = Array.isArray(groupBy) ? groupBy : [groupBy || "wyckoff.tf15.phase"];
    if (!root.PatternSnapshot) return { groups: {}, total: 0 };
    const minSamples = CONFIG.SCORE_PERF_MIN_SAMPLES;

    const list = root.PatternSnapshot.getAll().filter(
      (s) =>
        (s.result === "WIN" || s.result === "LOSS") &&
        // 시장·점수·방향을 반드시 먼저 나눈다(섞지 않는다)
        (!f.market || s.market === f.market) &&
        (f.score == null || s.score === f.score) &&
        (!f.direction || s.direction === f.direction)
    );

    const groups = {};
    list.forEach((s) => {
      const parts = keys.map((k) => {
        const v = getPath(s, k);
        return v === undefined || v === null ? "N/A" : String(v); // 과거 snapshot(필드 없음)은 N/A
      });
      const key = parts.join(" + ");
      const g = groups[key] || (groups[key] = { key, total: 0, wins: 0, losses: 0, pnlSum: 0, pnlCount: 0 });
      g.total++;
      if (s.result === "WIN") g.wins++;
      else g.losses++;
      if (isNum(s.pnlPercent)) { g.pnlSum += s.pnlPercent; g.pnlCount++; }
    });
    Object.values(groups).forEach((g) => {
      g.winRate = g.total > 0 ? (g.wins / g.total) * 100 : null;
      g.averagePnl = g.pnlCount > 0 ? g.pnlSum / g.pnlCount : null;
      g.enough = g.total >= minSamples;
      delete g.pnlSum; delete g.pnlCount;
    });
    return {
      filter: { market: f.market || "all", score: f.score == null ? "all" : f.score, direction: f.direction || "all" },
      groupBy: keys,
      total: list.length,
      groups,
    };
  }

  root.Wyckoff = { analyze, analyzeTimeframes, summarize, getStructureStats, validCandles };
})(typeof window !== "undefined" ? window : globalThis);
