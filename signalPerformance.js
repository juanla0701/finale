/* =========================================================================
   SignalPerformance — A/B 성능 검증: confidence 보정이 실제로 도움이 되는지 측정

   핵심 원칙(공정한 비교):
   - "같은 신호 하나"에 대해 보정 전(basePass)과 보정 후(adjustedPass)를 함께 기록한다.
     서로 다른 신호 집합을 비교하면 공정하지 않으므로, 한 신호에 두 판정을 같이 남긴다.
   - 신호 발생 시점에는 result = null 로만 기록한다(미래 결과 누수 방지).
     실제 WIN/LOSS가 확정된 뒤에만 attachResult()로 업데이트한다.
   - 이 데이터는 측정 전용이다. patternLearn에 다시 투입해 학습시키지 않는다(순환 방지).
   - 전용 localStorage 키(CONFIG.STORAGE_KEYS.PERF_HISTORY)만 사용하므로
     기존 학습/스냅샷/LOCK 데이터에 영향을 줄 수 없다.
   - 표본이 PERF_MIN_SAMPLE 미만이면 성능 향상을 단정하지 않고 "insufficient-sample"로 보고한다.

   승률 정의를 명확히 구분한다(요구사항 9):
   - overallWinRate : 확정된 모든 신호의 승률 (통과 여부 무관)
   - baseWinRate    : basePass = true 인 신호만의 승률
   - adjustedWinRate: adjustedPass = true 인 신호만의 승률
   improvementPercentPoint = adjustedWinRate - baseWinRate
   ========================================================================= */
(function (root) {
  const CONFIG = root.CONFIG;
  const KEY = CONFIG.STORAGE_KEYS.PERF_HISTORY;
  const isNum = (v) => Number.isFinite(v);

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const data = raw ? JSON.parse(raw) : {};
      if (!Array.isArray(data.records)) data.records = [];
      return data;
    } catch (e) {
      return { records: [] };
    }
  }

  function save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      // 저장 실패해도 기존 신호/알림 흐름에는 영향을 주지 않는다(측정은 부가 기능).
      console.error("performance save failed", e);
    }
  }

  /* -----------------------------------------------------------------------
     신호 발생 시점에 기록한다 (result는 항상 null로 시작).
     동일 signalId가 다시 들어오면 새로 만들지 않고 업데이트한다(중복 방지).
     confReport는 ConfidenceAdjust.evaluateForSignal()의 반환값을 그대로 받는다
     (값을 재계산하지 않으므로 보정 공식에 영향을 주지 않는다).
     ----------------------------------------------------------------------- */
  function record({ signalId, signalTime, symbol, market, direction, score, confReport, basePass, adjustedPass }) {
    if (!signalId) return null;
    const data = load();
    const existing = data.records.find((r) => r.signalId === signalId);

    const entry = {
      signalId,
      signalTime: isNum(signalTime) ? signalTime : Date.now(),
      symbol: symbol || null,
      market: market || null,
      direction: direction || null,
      score: isNum(score) ? score : null,
      // confidence 값은 0~1 단위(프로젝트 기존 표현)를 그대로 보존한다
      baseConfidence: confReport && isNum(confReport.baseConfidence) ? confReport.baseConfidence : null,
      adjustedConfidence: confReport && isNum(confReport.adjustedConfidence) ? confReport.adjustedConfidence : null,
      similarityAdjustment: confReport && isNum(confReport.similarityAdjustment) ? confReport.similarityAdjustment : 0,
      comparedCount: confReport ? confReport.comparedCount || 0 : 0,
      winCount: confReport ? confReport.winCount || 0 : 0,
      lossCount: confReport ? confReport.lossCount || 0 : 0,
      similarityWeightedWinRate:
        confReport && isNum(confReport.similarityWeightedWinRate) ? confReport.similarityWeightedWinRate : null,
      adjustmentApplied: confReport ? !!confReport.applied : false,
      // 같은 신호에 대한 두 판정 — 이게 공정 비교의 핵심
      basePass: !!basePass,
      adjustedPass: !!adjustedPass,
      // 결과는 확정된 뒤에만 채운다 (요구사항 19)
      result: null,
      resultTime: null,
      pnlPercent: null,
    };

    if (existing) {
      // 이미 결과가 확정된 기록은 덮어쓰지 않는다(확정 데이터 보호).
      if (existing.result !== null) return existing;
      Object.assign(existing, entry, { result: null, resultTime: null, pnlPercent: null });
      save(data);
      return existing;
    }

    data.records.push(entry);
    while (data.records.length > CONFIG.PERF_HISTORY_MAX) data.records.shift();
    save(data);
    return entry;
  }

  /* -----------------------------------------------------------------------
     결과 확정 시 호출. 기존 evaluatePending()이 판정한 win 값을 그대로 받아 기록만 한다
     (승패를 스스로 판정하지 않으므로 기존 판정과 어긋날 수 없다).
     ----------------------------------------------------------------------- */
  function attachResult(signalId, { win, resultTime, pnlPercent }) {
    if (!signalId) return null;
    const data = load();
    const r = data.records.find((x) => x.signalId === signalId);
    if (!r) return null;
    if (r.result !== null) return r; // 이미 확정됨 — 중복 처리 방지
    r.result = win ? "WIN" : "LOSS";
    r.resultTime = isNum(resultTime) ? resultTime : Date.now();
    r.pnlPercent = isNum(pnlPercent) ? pnlPercent : null;
    save(data);
    return r;
  }

  /* ---------------- 집계 ---------------- */

  function resolved(records) {
    return records.filter((r) => r.result === "WIN" || r.result === "LOSS");
  }

  function winRateOf(list) {
    if (list.length === 0) return null; // 0%로 표시해 오해를 만들지 않는다(요구사항 15)
    const wins = list.filter((r) => r.result === "WIN").length;
    return (wins / list.length) * 100;
  }

  function sampleTier(n) {
    const tiers = CONFIG.PERF_SAMPLE_TIERS || [30, 50, 100];
    let tier = 0;
    tiers.forEach((t) => {
      if (n >= t) tier = t;
    });
    return tier; // 0이면 최소 기준 미달
  }

  // 한 묶음(필터된 기록)에 대한 성능 리포트
  function summarize(records) {
    const res = resolved(records);
    const total = res.length;

    const basePassed = res.filter((r) => r.basePass);
    const adjustedPassed = res.filter((r) => r.adjustedPass);

    const baseWinRate = winRateOf(basePassed);
    const adjustedWinRate = winRateOf(adjustedPassed);
    const enough = total >= CONFIG.PERF_MIN_SAMPLE;

    const adjustments = res.map((r) => r.similarityAdjustment).filter(isNum);
    const avgAdjustment = adjustments.length
      ? adjustments.reduce((a, b) => a + b, 0) / adjustments.length
      : null;

    return {
      totalResolved: total,
      pending: records.length - total, // 아직 결과가 확정되지 않은 기록 수
      wins: res.filter((r) => r.result === "WIN").length,
      losses: res.filter((r) => r.result === "LOSS").length,

      // A. 전체 신호 기준 (통과 여부 무관)
      overallWinRate: winRateOf(res),

      // B. 통과 신호 기준 (보정 전 / 보정 후) — 이 둘의 차이가 개선폭
      baseWinRate,
      adjustedWinRate,
      basePassedCount: basePassed.length,
      adjustedPassedCount: adjustedPassed.length,
      basePassedWins: basePassed.filter((r) => r.result === "WIN").length,
      basePassedLosses: basePassed.filter((r) => r.result === "LOSS").length,
      adjustedPassedWins: adjustedPassed.filter((r) => r.result === "WIN").length,
      adjustedPassedLosses: adjustedPassed.filter((r) => r.result === "LOSS").length,

      // 표본이 부족하면 개선폭을 계산하지 않는다(섣부른 판단 방지)
      improvementPercentPoint:
        enough && isNum(baseWinRate) && isNum(adjustedWinRate) ? adjustedWinRate - baseWinRate : null,

      confidenceAdjustmentAverage: avgAdjustment,
      positiveAdjustmentCount: res.filter((r) => isNum(r.similarityAdjustment) && r.similarityAdjustment > 0).length,
      negativeAdjustmentCount: res.filter((r) => isNum(r.similarityAdjustment) && r.similarityAdjustment < 0).length,
      neutralAdjustmentCount: res.filter((r) => !isNum(r.similarityAdjustment) || r.similarityAdjustment === 0).length,

      // 판정 신뢰도: 표본이 충분한지 명확히 알린다
      confidence: enough ? "ok" : "insufficient-sample",
      minSample: CONFIG.PERF_MIN_SAMPLE,
      sampleTier: sampleTier(total),
    };
  }

  function filterRecords({ market, score, direction } = {}) {
    return load().records.filter(
      (r) =>
        (!market || r.market === market) &&
        (score == null || r.score === score) &&
        (!direction || r.direction === direction)
    );
  }

  // 전체 + LONG/SHORT 분리 리포트 (요구사항 12)
  function getPerformanceReport(filter) {
    const f = filter || {};
    const all = filterRecords(f);
    return Object.assign(summarize(all), {
      filter: { market: f.market || "all", score: f.score == null ? "all" : f.score, direction: f.direction || "all" },
      long: summarize(all.filter((r) => r.direction === "long")),
      short: summarize(all.filter((r) => r.direction === "short")),
    });
  }

  // 시장 × 점수 × 방향으로 완전히 분리한 리포트 (요구사항 13, 14)
  // crypto와 stock, 80과 100을 절대 합쳐서 보여주지 않는다.
  function getGroupedReport() {
    const out = { overall: getPerformanceReport() };
    ["crypto", "stock"].forEach((market) => {
      out[market] = { overall: getPerformanceReport({ market }) };
      (CONFIG.SCORE_PERF_TRACK || [80, 100]).forEach((score) => {
        out[market][score] = getPerformanceReport({ market, score });
      });
    });
    return out;
  }

  function getAll() {
    return load().records;
  }

  function getPendingResults() {
    return load().records.filter((r) => r.result === null);
  }

  // 사용자가 직접 요청할 때만 사용. 기존 학습 데이터에는 영향 없음(별도 키).
  function clear() {
    save({ records: [] });
  }

  root.SignalPerformance = {
    record,
    attachResult,
    getPerformanceReport,
    getGroupedReport,
    getAll,
    getPendingResults,
    filterRecords,
    summarize,
    clear,
  };
})(typeof window !== "undefined" ? window : globalThis);
