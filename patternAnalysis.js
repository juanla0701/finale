/* =========================================================================
   PatternAnalysis — 4단계: 성공 패턴(WIN) / 실패 패턴(LOSS) 분리 및 분석

   목적: 3단계에서 저장한 Pattern Snapshot을 읽어서, 시장×점수×방향 8개 그룹별로
   성공/실패 패턴을 분리해 조회·집계한다.

   설계 원칙:
   - 새로운 저장 구조를 만들지 않는다. 3단계의 snapshot(단일 소스)을 그대로 읽는다.
     따라서 "원본 snapshot 보존"이 구조적으로 보장된다 — 이 모듈에는 쓰기 코드가 없다.
   - WIN/LOSS 판정을 하지 않는다. snapshot.result에 이미 확정된 값만 읽는다.
     (result는 기존 evaluatePending()이 채운 값)
   - 이번 단계에서는 신호를 차단하거나 점수를 바꾸지 않는다. 조회/분석 API만 제공한다.
   - 학습 ON/OFF는 3단계 저장 시점에서 이미 제어된다(OFF면 snapshot이 안 쌓임).
     이 모듈은 조회 전용이므로 OFF 상태에서도 기존 데이터를 계속 분석/표시할 수 있다.
   - 중복 방지도 3단계 signalId 체계가 그대로 담당한다(중복 snapshot이 없으므로
     여기서 중복 집계될 일이 없다).

   다음 단계(신규 신호와 과거 패턴의 유사도 비교)는 여기서 구현하지 않는다.
   ========================================================================= */
(function (root) {
  const CONFIG = root.CONFIG;

  // 8개 그룹 정의 (market × score × direction)
  const MARKETS = ["crypto", "stock"];
  const DIRECTIONS = ["long", "short"];

  function groupKey(market, score, direction) {
    return `${market}:${score}:${direction}`;
  }

  // 결과가 확정된 snapshot만 분석 대상으로 삼는다 (result가 null인 대기 항목은 제외).
  function resolvedSnapshots() {
    return root.PatternSnapshot.getAll().filter((s) => s.result === "WIN" || s.result === "LOSS");
  }

  /* ---------------- 기본 조회 ---------------- */

  // 성공 패턴 전체 (필터 옵션으로 그룹을 좁힐 수 있다)
  function getWinningPatterns(filter) {
    const f = Object.assign({}, filter || {}, { result: "WIN" });
    return root.PatternSnapshot.getBy(f);
  }

  // 실패 패턴 전체
  function getLosingPatterns(filter) {
    const f = Object.assign({}, filter || {}, { result: "LOSS" });
    return root.PatternSnapshot.getBy(f);
  }

  // 특정 그룹(market+score+direction)의 결과 확정 패턴을 WIN/LOSS로 나눠서 반환
  function getPatternsByGroup(market, score, direction) {
    const wins = root.PatternSnapshot.getBy({ market, score, direction, result: "WIN" });
    const losses = root.PatternSnapshot.getBy({ market, score, direction, result: "LOSS" });
    return { market, score, direction, group: groupKey(market, score, direction), wins, losses };
  }

  /* ---------------- 집계 ---------------- */

  function avg(list) {
    const nums = list.filter((v) => Number.isFinite(v));
    if (nums.length === 0) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  // 그룹 통계. 표본이 부족하면 enough:false로 알리고 승률을 억지로 판단하지 않게 한다.
  function getPatternStats(market, score, direction) {
    const { wins, losses } = getPatternsByGroup(market, score, direction);
    const total = wins.length + losses.length;
    const enough = total >= CONFIG.SCORE_PERF_MIN_SAMPLES;
    return {
      group: groupKey(market, score, direction),
      market,
      score,
      direction,
      total,
      wins: wins.length,
      losses: losses.length,
      // 표본이 부족하면 승률을 제공하지 않는다(호출부가 "데이터 부족"으로 표시하도록)
      winRate: total > 0 ? (wins.length / total) * 100 : null,
      enough,
      avgPnl: avg([...wins, ...losses].map((s) => s.pnlPercent)),
      avgWinPnl: avg(wins.map((s) => s.pnlPercent)),
      avgLossPnl: avg(losses.map((s) => s.pnlPercent)),
      winPatterns: wins,   // 성공 패턴 원본 데이터 (변형 없이 그대로)
      lossPatterns: losses, // 실패 패턴 원본 데이터
    };
  }

  // 8개 그룹 전체 통계를 한 번에. 데이터가 없어도 8칸 구조를 그대로 반환한다.
  function getAllGroupStats() {
    const out = {};
    MARKETS.forEach((market) => {
      CONFIG.SCORE_PERF_TRACK.forEach((score) => {
        DIRECTIONS.forEach((direction) => {
          out[groupKey(market, score, direction)] = getPatternStats(market, score, direction);
        });
      });
    });
    return out;
  }

  /* ---------------- 지표별 WIN/LOSS 비교 ----------------
     성공 패턴과 실패 패턴이 "어떤 지표에서 달랐는지" 볼 수 있게 평균을 나란히 낸다.
     이번 단계는 비교 수치를 제공만 하고, 신호 판단에는 사용하지 않는다. */

  // snapshot의 타임프레임 상태에서 수치 지표만 뽑아낸다 (3단계가 저장한 필드 그대로).
  const TF_FIELDS = [
    "macdDif",
    "macdDea",
    "macdDiff",
    "macdDifDelta",
    "rsi",
    "rsiDelta",
    "volume",
    "volumeChangePercent",
  ];
  const CANDLE_FIELDS = ["body", "upperWick", "lowerWick", "range", "changePercent"];

  function tfKeyOf(tf) {
    return tf === "15m" ? "tf15" : tf === "5m" ? "tf5" : "tf1";
  }

  // 한 묶음(WIN 또는 LOSS)의 타임프레임별 지표 평균을 계산한다.
  function summarizeGroupIndicators(list) {
    const out = {};
    ["15m", "5m", "1m"].forEach((tf) => {
      const key = tfKeyOf(tf);
      const states = list.map((s) => s[key]).filter(Boolean);
      const tfOut = {};
      TF_FIELDS.forEach((f) => {
        tfOut[f] = avg(states.map((st) => st[f]));
      });
      CANDLE_FIELDS.forEach((f) => {
        tfOut["candle_" + f] = avg(states.map((st) => (st.candle ? st.candle[f] : null)));
      });
      // 불리언 지표는 "그 상태였던 비율(%)"로 요약한다
      const ratio = (pick) => {
        const vals = states.map(pick).filter((v) => typeof v === "boolean");
        return vals.length ? (vals.filter(Boolean).length / vals.length) * 100 : null;
      };
      tfOut.haBullishRatio = ratio((st) => st.haBullish);
      tfOut.haFlippedRatio = ratio((st) => st.haFlipped);
      tfOut.macdGoldenCrossRatio = ratio((st) => st.macdGoldenCross);
      tfOut.macdDeadCrossRatio = ratio((st) => st.macdDeadCross);
      tfOut.macdAboveSignalRatio = ratio((st) => st.macdAboveSignal);
      tfOut.rsiRisingRatio = ratio((st) => st.rsiRising);
      tfOut.sampleCount = states.length;
      out[tf] = tfOut;
    });
    return out;
  }

  // 신호 조건(trend15/trend5/ha1Flip/macdCross)이 충족된 비율도 함께 비교한다.
  function summarizeConditions(list) {
    const keys = ["trend15", "trend5", "ha1Flip", "macdCross"];
    const out = {};
    keys.forEach((k) => {
      const vals = list.map((s) => (s.conditions ? s.conditions[k] : null)).filter((v) => typeof v === "boolean");
      out[k] = vals.length ? (vals.filter(Boolean).length / vals.length) * 100 : null;
    });
    return out;
  }

  // 성공 패턴 vs 실패 패턴의 지표 평균을 나란히 비교한다.
  // 표본이 부족하면 enough:false — 억지 해석을 하지 않도록 호출부에 알린다.
  function comparePatterns(market, score, direction) {
    const { wins, losses } = getPatternsByGroup(market, score, direction);
    const total = wins.length + losses.length;
    return {
      group: groupKey(market, score, direction),
      market,
      score,
      direction,
      total,
      winCount: wins.length,
      lossCount: losses.length,
      enough: wins.length >= CONFIG.SCORE_PERF_MIN_SAMPLES && losses.length >= CONFIG.SCORE_PERF_MIN_SAMPLES,
      win: {
        indicators: summarizeGroupIndicators(wins),
        conditions: summarizeConditions(wins),
        avgPnl: avg(wins.map((s) => s.pnlPercent)),
      },
      loss: {
        indicators: summarizeGroupIndicators(losses),
        conditions: summarizeConditions(losses),
        avgPnl: avg(losses.map((s) => s.pnlPercent)),
      },
    };
  }

  // 전체 요약 (UI 디버깅/확인용). 데이터가 없어도 안전하게 0을 반환한다.
  function getOverallSummary() {
    const list = resolvedSnapshots();
    const wins = list.filter((s) => s.result === "WIN");
    const losses = list.filter((s) => s.result === "LOSS");
    return {
      total: list.length,
      wins: wins.length,
      losses: losses.length,
      winRate: list.length > 0 ? (wins.length / list.length) * 100 : null,
      avgPnl: avg(list.map((s) => s.pnlPercent)),
      enough: list.length >= CONFIG.SCORE_PERF_MIN_SAMPLES,
    };
  }

  root.PatternAnalysis = {
    getWinningPatterns,
    getLosingPatterns,
    getPatternsByGroup,
    getPatternStats,
    getAllGroupStats,
    comparePatterns,
    getOverallSummary,
    groupKey,
    // 내부 헬퍼도 노출해 테스트/확장에서 재사용 가능하게 한다
    summarizeGroupIndicators,
    summarizeConditions,
  };
})(typeof window !== "undefined" ? window : globalThis);
