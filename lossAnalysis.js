/* =========================================================================
   LossAnalysis
   손실로 마감된 거래를 선택했을 때, 진입 시점에 기록해 둔 스냅샷
   (1m/5m/15m 추세, Heikin Ashi, MACD DIF/DEA, RSI, 점수)을 근거로
   "주요 원인으로 추정"되는 항목들을 나열한다.

   중요: 이건 규칙 기반의 서술일 뿐, 실제 원인을 단정하지 않는다.
   문구도 전부 "~로 추정됩니다" 형태를 사용한다. 실제 AI 학습/분석 기능은
   이번 버전에서 구현하지 않는다 — 저장된 스냅샷을 사람이 읽기 좋게
   풀어서 보여주는 역할만 한다.
   ========================================================================= */
(function (root) {
  const CONFIG = root.CONFIG;

  // key: i18n 키, params: 문구에 끼워 넣을 값들
  function reason(key, params) {
    return { key, params: params || {} };
  }

  function analyze(trade) {
    const reasons = [];
    const snap = trade.entrySnapshot;

    if (!trade || trade.status !== "closed" || trade.pnlPercent == null || trade.pnlPercent >= 0) {
      return { applicable: false, reasons: [] };
    }
    if (!snap) {
      return { applicable: true, reasons: [reason("noSnapshotData")] };
    }

    const dir = trade.direction;
    const W = CONFIG.SCORE_WEIGHTS;
    const dirSnap = dir === "long" ? snap.long : snap.short;
    const oppSnap = dir === "long" ? snap.short : snap.long;

    // 1) 진입 당시 점수가 애초에 낮았는지 (관망/신호없음 구간에서 진입했는지)
    if (dirSnap.score < CONFIG.SCORE_BAND_WATCH) {
      reasons.push(reason("lowEntryScore", { score: dirSnap.score }));
    }

    // 2) 상위 타임프레임(15분) 큰 추세와 반대 방향으로 진입했는지
    if (!dirSnap.conditions.trend15) {
      reasons.push(reason("against15mTrend"));
    }

    // 3) 5분봉 방향과도 불일치했는지 (상위 추세는 맞았지만 중기 방향이 어긋난 경우)
    if (dirSnap.conditions.trend15 && !dirSnap.conditions.trend5) {
      reasons.push(reason("against5mDirection"));
    }

    // 4) 1분봉 단기 신호(전환/크로스)에만 의존한 진입이었는지
    const onlyShortTerm = !dirSnap.conditions.trend15 && !dirSnap.conditions.trend5 && (dirSnap.conditions.ha1Flip || dirSnap.conditions.macdCross);
    if (onlyShortTerm) {
      reasons.push(reason("shortTermOnly"));
    }

    // 5) 반대 방향 점수도 함께 높았는지 (추세가 엇갈리는 구간에서 진입했는지)
    if (oppSnap.score >= CONFIG.SCORE_BAND_NEUTRAL) {
      reasons.push(reason("mixedSignals", { oppScore: oppSnap.score }));
    }

    // 6) RSI가 방향과 불일치했는지 (1분봉 기준)
    const rsi1 = snap.timeframes["1m"].rsi;
    if (rsi1 != null) {
      if (dir === "long" && rsi1 < 50) reasons.push(reason("rsiAgainstLong", { rsi: rsi1.toFixed(1) }));
      if (dir === "short" && rsi1 > 50) reasons.push(reason("rsiAgainstShort", { rsi: rsi1.toFixed(1) }));
    }

    // 위 규칙에 하나도 해당하지 않으면(즉 진입 조건 자체는 좋아 보였던 경우) 일반적인 문구로 대체
    if (reasons.length === 0) {
      reasons.push(reason("genericVolatility"));
    }

    return { applicable: true, reasons };
  }

  root.LossAnalysis = { analyze };
})(typeof window !== "undefined" ? window : globalThis);
