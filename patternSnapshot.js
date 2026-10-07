/* =========================================================================
   PatternSnapshot — 3단계: 신호 발생 순간의 차트 상태 저장

   목적: 앞으로 발생하는 자동 신호가 "어떤 차트 상태에서 나왔는지"를 그대로 보존해서,
   다음 단계(성공/실패 패턴 분석, 유사 패턴 비교)의 재료를 만들어 둔다.
   이번 단계에서는 저장만 한다 — 패턴을 비교하거나 승률을 바꾸거나 신호를 차단하지 않는다.

   설계 원칙:
   - 새로운 지표를 만들지 않는다. signals.js의 computeIndicators()가 이미 계산해 둔
     ha / macd(dif, dea) / rsi / klines(OHLCV)만 그대로 읽어서 저장한다.
     (몸통·꼬리 크기, 변화율 같은 값은 이미 있는 OHLC로부터 산술적으로 뽑아내는 것이며
      새 지표가 아니다 — 원본 캔들도 함께 저장하므로 나중에 재계산도 가능하다)
   - 기존 localStorage 키를 건드리지 않는다. snapshot은 전용 키
     (CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS)에만 저장한다. 따라서 snapshot 저장/삭제가
     기존 stats / entries / pending / scorePerf / statsBySymbol / legacyStats / LOCK 기록에
     영향을 줄 수 없다.
   - WIN/LOSS는 스스로 판정하지 않는다. 기존 evaluatePending()이 확정한 결과를
     attachResult()로 전달받아 연결만 한다.
   - 중복 방지는 기존 signalId 체계를 그대로 재사용한다.
   ========================================================================= */
(function (root) {
  const CONFIG = root.CONFIG;
  const KEY = CONFIG.STORAGE_KEYS.PATTERN_SNAPSHOTS;

  // 학습 ON/OFF 판단은 기존 PatternLearn과 동일한 기준(State.learnEnabled)을 사용한다.
  function isEnabled() {
    return !root.State || root.State.learnEnabled !== false;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const data = raw ? JSON.parse(raw) : {};
      if (!Array.isArray(data.snapshots)) data.snapshots = [];
      return data;
    } catch (e) {
      return { snapshots: [] };
    }
  }

  function save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      // 용량 초과 등으로 저장이 실패해도 기존 기능에는 영향을 주지 않는다(부가 기능).
      console.error("snapshot save failed", e);
    }
  }

  const num = (v) => (Number.isFinite(v) ? v : null);

  // 캔들 하나의 파생값. 전부 기존 OHLC에서 산술로 뽑은 값이며 새 지표가 아니다.
  function candleShape(k) {
    if (!k) return null;
    const bodyTop = Math.max(k.open, k.close);
    const bodyBottom = Math.min(k.open, k.close);
    return {
      bullish: k.close > k.open,
      body: num(Math.abs(k.close - k.open)),          // 몸통 크기
      upperWick: num(k.high - bodyTop),               // 윗꼬리
      lowerWick: num(bodyBottom - k.low),             // 아랫꼬리
      range: num(k.high - k.low),                     // 고저 범위(변동성 참고용)
      changePercent: k.open > 0 ? num(((k.close - k.open) / k.open) * 100) : null, // 캔들 변화율
    };
  }

  // 최근 N개 캔들 원본(OHLCV) + Heikin-Ashi OHLC를 함께 저장한다.
  // 원본을 보관하므로 나중에 어떤 분석이든 다시 계산할 수 있다.
  function recentCandles(tfData, count) {
    const n = count || CONFIG.SNAPSHOT_CANDLE_COUNT;
    const kl = tfData.klines.slice(-n);
    const ha = tfData.ha.slice(-n);
    return kl.map((k, i) => ({
      openTime: k.openTime,
      open: num(k.open),
      high: num(k.high),
      low: num(k.low),
      close: num(k.close),
      volume: num(k.volume),
      haOpen: ha[i] ? num(ha[i].open) : null,
      haHigh: ha[i] ? num(ha[i].high) : null,
      haLow: ha[i] ? num(ha[i].low) : null,
      haClose: ha[i] ? num(ha[i].close) : null,
      haBullish: ha[i] ? ha[i].bullish : null,
    }));
  }

  // 한 타임프레임의 신호 발생 시점 상태. 전부 이미 계산된 값만 사용한다.
  function timeframeState(tfData) {
    const last = tfData.klines.length - 1;
    if (last < 1) return null;

    const k = tfData.klines[last];
    const kPrev = tfData.klines[last - 1];
    const ha = tfData.ha[last];
    const haPrev = tfData.ha[last - 1];
    const dif = num(tfData.macd.dif[last]);
    const dea = num(tfData.macd.dea[last]);
    const difPrev = num(tfData.macd.dif[last - 1]);
    const rsi = num(tfData.rsi[last]);
    const rsiPrev = num(tfData.rsi[last - 1]);

    // MACD 크로스 상태는 기존 Signals.detectCross()를 그대로 재사용한다(자체 판정 금지).
    const cross = root.Signals.detectCross(tfData.macd, last);

    // 거래량 비교: 최근 캔들 거래량과 직전 캔들 거래량 (기존 volume 필드만 사용)
    const volume = num(k.volume);
    const volumePrev = num(kPrev.volume);

    return {
      // Heikin-Ashi 상태
      haBullish: ha ? ha.bullish : null,
      haFlipped: ha && haPrev ? ha.bullish !== haPrev.bullish : null, // 최근 캔들에서 방향 전환 여부
      haOpen: ha ? num(ha.open) : null,
      haHigh: ha ? num(ha.high) : null,
      haLow: ha ? num(ha.low) : null,
      haClose: ha ? num(ha.close) : null,
      // 최근 캔들 모양 (몸통/꼬리/변화율)
      candle: candleShape(k),
      // MACD
      macdDif: dif,
      macdDea: dea,
      macdDiff: dif != null && dea != null ? num(dif - dea) : null, // DIF - DEA
      macdDifDelta: dif != null && difPrev != null ? num(dif - difPrev) : null, // DIF 변화량
      macdGoldenCross: cross.golden,
      macdDeadCross: cross.dead,
      macdAboveSignal: dif != null && dea != null ? dif > dea : null,
      // RSI
      rsi,
      rsiDelta: rsi != null && rsiPrev != null ? num(rsi - rsiPrev) : null, // RSI 변화량
      rsiRising: rsi != null && rsiPrev != null ? rsi > rsiPrev : null,
      // 거래량
      volume,
      volumePrev,
      volumeChangePercent:
        volume != null && volumePrev != null && volumePrev > 0 ? num(((volume - volumePrev) / volumePrev) * 100) : null,
      // 최근 캔들 원본 (다음 단계의 차트 패턴 비교용)
      candles: recentCandles(tfData),
    };
  }

  /* -----------------------------------------------------------------------
     신호 발생 시점에 호출: snapshot을 result:null 상태로 먼저 저장한다.
     pending 항목(p)은 PatternLearn.recordPending()이 만든 것과 동일한 객체를 받아
     signalId / market / score / direction을 그대로 사용한다(값 재계산 없음).
     ----------------------------------------------------------------------- */
  /* -----------------------------------------------------------------------
     신호 발생 시점의 snapshot 객체를 만든다 (저장하지 않음, 순수 생성).
     record()가 저장할 때도 이 함수를 쓰고, 5/6단계의 유사도 비교에서
     "현재 신호"를 표현할 때도 같은 함수를 쓴다 — 따라서 저장된 과거 패턴과
     현재 패턴이 항상 동일한 구조/계산으로 만들어진다.
     ----------------------------------------------------------------------- */
  function buildSnapshot(p, tf) {
    if (!p || !p.signalId || !tf) return null;
    return {
      // 기본 정보
      signalId: p.signalId,
      symbol: p.symbol,
      market: root.PatternLearn.marketOf(p.category), // crypto / stock (기존 매핑 재사용)
      category: p.category,                            // 앱 내부 표기(coin/stock)도 함께 보존
      score: p.score,
      direction: p.direction,
      signalTime: p.signalTime || p.entryTime,
      signalPrice: num(p.entryPrice),
      // 신호 발생 당시 사용된 기존 조건값 (점수 산출 근거)
      conditions: p.conditions || null,
      patternKey: p.patternKey || null,
      // 타임프레임별 상태
      tf15: tf["15m"] ? timeframeState(tf["15m"]) : null,
      tf5: tf["5m"] ? timeframeState(tf["5m"]) : null,
      tf1: tf["1m"] ? timeframeState(tf["1m"]) : null,
      // 결과는 나중에 attachResult()로 연결된다
      result: null,
      resultPrice: null,
      resultTime: null,
      pnlPercent: null,
      /* Volume Profile (10단계, 관찰 전용 — 향후 학습 분석을 위한 기록).
         기존 필드는 그대로 두고 새 필드만 추가한다. 과거 snapshot에는 이 필드가 없으며
         읽는 쪽에서 null로 안전하게 처리한다. 유사도 계산(patternSimilarity)은
         이 필드를 사용하지 않으므로 기존 비교 결과에 영향이 없다. */
      volumeProfile: buildVolumeProfileSummary(tf, p.entryPrice),
      /* Wyckoff 시장 구조 (관찰·학습 기반 전용).
         Volume Profile과 "같은 신호 시점의 같은 캔들"로 계산해 함께 저장한다.
         입력 tf는 신호 발생 시점까지의 데이터뿐이므로 미래 캔들이 섞이지 않는다.
         결과(WIN/LOSS)는 나중에 attachResult()가 같은 snapshot에 붙인다 —
         Wyckoff 값은 그 뒤에도 절대 수정되지 않는다. */
      wyckoff: buildWyckoffSummary(tf, p.entryPrice, p.signalTime || p.entryTime),
      // 구조 데이터 버전(향후 필드가 늘어나도 과거 snapshot과 구분할 수 있게)
      structureVersion: 1,
    };
  }

  // snapshot에 저장할 Wyckoff 요약 (15m/5m 기본 + 1m 보조)
  function buildWyckoffSummary(tf, price, signalTime) {
    if (!root.Wyckoff || !tf) return null;
    try {
      const w = root.Wyckoff.analyzeTimeframes(tf, {
        currentPrice: num(price),
        // Look-ahead 방지: 신호 시각 이후 캔들은 계산에서 제외한다
        asOfTime: Number.isFinite(signalTime) ? signalTime : undefined,
      });
      return {
        tf15: root.Wyckoff.summarize(w["15m"]),
        tf5: root.Wyckoff.summarize(w["5m"]),
        tf1: root.Wyckoff.summarize(w["1m"]), // 보조 기록 — 판정에는 사용하지 않음
      };
    } catch (e) {
      // 계산 실패가 snapshot 저장 자체를 막지 않도록 한다
      return null;
    }
  }

  // snapshot에 저장할 Volume Profile 요약 (분포 배열 등 큰 데이터는 저장하지 않는다)
  function buildVolumeProfileSummary(tf, price) {
    if (!root.VolumeProfile || !tf) return null;
    try {
      const vp = root.VolumeProfile.analyzeTimeframes(tf, { currentPrice: num(price) });
      const pick = (r) =>
        r
          ? {
              timeframe: r.timeframe,
              poc: num(r.poc),
              vah: num(r.vah),
              val: num(r.val),
              currentPrice: num(r.currentPrice),
              pricePosition: r.pricePosition,
              pocDistancePercent: num(r.pocDistancePercent),
              valueAreaPosition: r.valueAreaPosition,
              valueAreaDepth: num(r.valueAreaDepth),
              distribution: r.distribution ? r.distribution.state : null,
            }
          : null;
      return { tf15: pick(vp["15m"]), tf5: pick(vp["5m"]) };
    } catch (e) {
      // 계산 실패가 snapshot 저장 자체를 막지 않도록 한다
      return null;
    }
  }

  function record(p, tf) {
    if (!isEnabled()) return null; // 학습 OFF면 새 snapshot을 저장하지 않는다(기존 snapshot은 그대로)
    if (!p || !p.signalId || !tf) return null;
    // 추적 대상 점수(80/100)만 저장한다 — 기존 scorePerf와 같은 기준을 사용한다.
    if (!CONFIG.SCORE_PERF_TRACK.includes(p.score)) return null;

    const data = load();
    // 중복 방지: 동일 signalId의 snapshot이 이미 있으면 저장하지 않는다.
    // (Activity WebView와 Background Service WebView가 같은 신호를 처리해도 1개만 남는다)
    if (data.snapshots.some((s) => s.signalId === p.signalId)) return null;

    const snapshot = buildSnapshot(p, tf);
    if (!snapshot) return null;

    data.snapshots.push(snapshot);
    // 용량 상한: 오래된 것부터 제거 (다른 데이터는 별도 키라 전혀 영향 없음)
    while (data.snapshots.length > CONFIG.MAX_PATTERN_SNAPSHOTS) data.snapshots.shift();
    save(data);
    return snapshot;
  }

  /* -----------------------------------------------------------------------
     기존 evaluatePending()이 WIN/LOSS를 확정한 뒤 호출: 그 결과를 snapshot에 연결한다.
     승패를 스스로 판정하지 않고 전달받은 값만 기록한다.
     학습 OFF 여부와 무관하게 "이미 저장된 snapshot에 결과를 채우는 것"은 허용한다
     (데이터 정합성 유지 — OFF 때문에 result가 영원히 null로 남지 않도록).
     ----------------------------------------------------------------------- */
  function attachResult(signalId, { win, resultPrice, resultTime, pnlPercent }) {
    if (!signalId) return null;
    const data = load();
    const s = data.snapshots.find((x) => x.signalId === signalId);
    if (!s) return null;
    if (s.result !== null) return s; // 이미 결과가 연결됨 — 중복 처리 방지
    s.result = win ? "WIN" : "LOSS";
    s.resultPrice = num(resultPrice);
    s.resultTime = resultTime || Date.now();
    s.pnlPercent = num(pnlPercent);
    save(data);
    return s;
  }

  /* ---------------- 조회 (이번 단계에서는 저장 확인/디버깅 용도) ---------------- */
  function getAll() {
    return load().snapshots;
  }

  function getBy({ market, score, direction, result } = {}) {
    return load().snapshots.filter(
      (s) =>
        (!market || s.market === market) &&
        (score == null || s.score === score) &&
        (!direction || s.direction === direction) &&
        (result === undefined || s.result === result)
    );
  }

  // UI 디버깅 표시용 요약: 저장 개수 / WIN / LOSS / 결과 대기중
  // UI 디버깅 표시용 요약: 저장 개수 / WIN / LOSS / 결과 대기중
  // market을 주면 해당 시장(crypto/stock)만 집계한다. 생략하면 전체(기존 동작).
  function getSummary(market) {
    const all = load().snapshots;
    const list = market ? all.filter((s) => s.market === market) : all;
    const wins = list.filter((s) => s.result === "WIN").length;
    const losses = list.filter((s) => s.result === "LOSS").length;
    return {
      market: market || "all",
      total: list.length,
      wins,
      losses,
      pendingResult: list.filter((s) => s.result === null).length,
      max: CONFIG.MAX_PATTERN_SNAPSHOTS,
    };
  }

  // 사용자가 직접 요청할 때만 사용 (자동 호출 금지). 기존 학습 데이터에는 영향 없음.
  function clear() {
    save({ snapshots: [] });
  }

  root.PatternSnapshot = {
    buildSnapshot,
    record,
    attachResult,
    getAll,
    getBy,
    getSummary,
    clear,
    timeframeState,
    candleShape,
    recentCandles,
  };
})(typeof window !== "undefined" ? window : globalThis);
