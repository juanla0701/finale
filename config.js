/* =========================================================================
   CONFIG
   앱의 모든 조정 가능한 값은 여기 한 곳에 모아둔다.
   나중에 점수 배점, 기준선, 종목 개수 등을 바꿀 때 이 파일만 수정하면 된다.
   ========================================================================= */
(function (root) {
  const CONFIG = {
    MAX_SYMBOLS: 50,
    DEFAULT_SYMBOLS: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
    DEFAULT_CATEGORY: "coin", // 카테고리 미지정 종목(기존 데이터 포함)의 기본 분류 — 마이그레이션 기본값
    CATEGORIES: ["coin", "stock"], // 코인 선물 / 주식 선물
    // 감시 목록에서 자동으로 제거할 심볼 (실재하지 않는 심볼 등).
    // 학습 데이터(PatternLearn)는 별도 저장소이므로 전혀 삭제되지 않는다.
    PURGE_SYMBOLS: ["ANTROPICUSDT"],

    // 심볼 수가 늘어나도(최대 50개) 한 번에 전부 동시 요청하지 않고 소규모로 나눠 처리해서
    // 순간 요청 폭주를 줄인다. 총 요청 수·감시 주기는 그대로 유지된다(폴링 횟수를 늘리지 않음).
    SYMBOL_UPDATE_CONCURRENCY: 6,

    /* ---------------------------------------------------------------------
       멀티 타임프레임 전략
       15m = 큰 추세, 5m = 방향 확인, 1m = 실제 진입 타이밍
       세 시간봉이 "전부 다 일치"해야만 신호를 내는 방식(AND) 대신,
       조건별로 점수를 더하는 방식을 사용한다 (아래 SCORE 참고).
       --------------------------------------------------------------------- */
    TF_TREND: "15m",   // 큰 추세 확인
    TF_DIRECTION: "5m", // 방향 확인
    TF_ENTRY: "1m",     // 실제 진입 타이밍 (Heikin Ashi 전환 / MACD 크로스 기준)

    KLINE_LIMIT: 150,          // 지표 계산용 캔들 개수 (타임프레임별로 동일하게 적용)
    // 심볼당 3개 타임프레임(1m/5m/15m)을 매번 조회하므로, 기존(단일 타임프레임)보다
    // 요청 수가 3배가 된다. 그만큼 주기를 살짝 늘려 API 사용량을 아낀다.
    POLL_INTERVAL_MS: 20000,
    FETCH_TIMEOUT_MS: 12000,      // 요청 타임아웃 — 백그라운드 전환으로 멈춘 요청이 영구 대기하지 않게 한다
    FETCH_RETRY_DELAY_MS: 600,    // 재시도 전 대기 시간 (일시적 중단 복구용)

    MACD_FAST: 12,
    MACD_SLOW: 26,
    MACD_SIGNAL: 9,

    RSI_PERIOD: 14,

    /* ---------------------------------------------------------------------
       조건별 점수제 (총 100점 기준)
       - trend15: 15분봉 Heikin Ashi 추세가 방향과 일치
       - trend5 : 5분봉 Heikin Ashi 추세가 방향과 일치
       - ha1Flip: 1분봉 Heikin Ashi가 이번 캔들에서 해당 방향으로 "전환"됨
       - macdCross: 1분봉 MACD가 해당 방향으로 골든/데드 크로스
       --------------------------------------------------------------------- */
    SCORE_WEIGHTS: {
      trend15: 30,
      trend5: 25,
      ha1Flip: 25,
      macdCross: 20,
    },

    // 총점 기준 신호 등급
    SCORE_BAND_STRONG: 80,  // 80 이상 = 강한 신호
    SCORE_BAND_WATCH: 65,   // 65~79   = 신호 관심
    SCORE_BAND_NEUTRAL: 50, // 50~64   = 관망 (50 미만 = 신호 없음)

    // 알림/토스트를 새로 띄우는 최소 등급 ("관심" 이상일 때만 기록/알림)
    NOTIFY_MIN_BAND: "watch",

    BINANCE_FAPI_KLINES: "https://fapi.binance.com/fapi/v1/klines",

    // ---- 점수별 신호 성능 통계 ----
    // 실제 점수 조합상 80점 이상은 80과 100만 발생한다(30/25/25/20 가중치 조합 결과).
    // 점수를 임의로 반올림하지 않고 signals.js가 계산한 실제 값을 그대로 기록한다.
    SCORE_PERF_TRACK: [80, 100], // 이 점수의 신호만 성능 통계 대상으로 기록
    SCORE_PERF_MIN_SAMPLES: 5,   // 이 표본 미만이면 승률 대신 "데이터 부족"으로 표시
    SCORE_PERF_LOG_MAX: 1000,    // 점수별 결과 기록 최대 보관 개수

    // ---- Pattern Snapshot (3단계) ----
    // 신호 발생 순간의 차트 상태를 저장한다. 모바일 localStorage 용량을 고려해 상한을 둔다.
    MAX_PATTERN_SNAPSHOTS: 2000, // 초과하면 가장 오래된 snapshot부터 삭제 (다른 데이터는 영향 없음)

    // ---- 유사 패턴 기반 confidence 보정 (6단계) ----
    // 기존 신호 점수/판정은 전혀 바꾸지 않고, 계산된 confidence에만 제한적으로 보정을 더한다.
    SIM_ADJUST_MIN_SAMPLES: 10,     // 유사도 기준을 통과한 과거 패턴이 이 개수 미만이면 보정하지 않음
    SIM_ADJUST_MIN_SIMILARITY: 70,  // 이 유사도 미만인 패턴은 핵심 표본에서 제외

    /* ---- 유사 패턴 승률 계산 (6단계) ----
       기본 임계값은 위 SIM_ADJUST_MIN_SIMILARITY(70)를 그대로 재사용한다.
       최소 표본도 기존 SCORE_PERF_MIN_SAMPLES(5)를 그대로 쓴다.
       아래 등급은 "얼마나 유사한지"를 표시할 때만 사용한다(계산 기준이 아님). */
    SIM_TIERS: { veryHigh: 80, high: 70, reference: 60 },

    /* ---- 종합 Confidence (7단계) ----
       기존 신호 점수(80/100)는 그대로 두고, 별도의 보조 신뢰도 값을 계산한다.
       네 요소의 가중치 합은 1.0이어야 한다(코드에서 정규화하지만 설정도 맞춰 둔다). */
    CONF_WEIGHTS: {
      signalQuality: 0.4,   // 기존 신호 점수(80/100)를 품질 점수로 환산
      historical: 0.2,      // 같은 market+score+direction 그룹의 과거 승률
      similar: 0.3,         // 현재 패턴과 유사한 과거 패턴의 승률
      marketAlignment: 0.1, // 15m/5m/1m 방향 일치도
    },
    // 신호 점수를 품질 점수(0~100)로 환산할 때 쓰는 기준.
    // 80점 → 70, 100점 → 100 으로 보고 그 사이를 선형 보간한다.
    CONF_SCORE_FLOOR: 70,
    // 유사 패턴 표본이 부족할 때(enough=false) 유사 패턴 가중치를 이 비율로 낮춘다.
    // 남은 가중치는 나머지 요소로 재분배된다(2건 100%가 confidence를 밀어올리지 못하게).
    CONF_SIM_INSUFFICIENT_FACTOR: 0.25,
    // 과거 성능이 아예 없을 때 쓰는 중립값(승률을 임의로 만들지 않기 위한 기준점)
    CONF_NEUTRAL_RATE: 50,

    /* ---- 종합 신뢰도 필터 (8단계) ----
       기존 signalFilter와는 별개의 독립 필터다. 기본 OFF이므로 켜기 전에는
       기존 동작에 전혀 영향이 없다. 켜면 composite confidence가 기준 미만인
       신호의 "화면 알림"만 차단하고, 학습·기록·성능 데이터는 그대로 유지한다. */
    CONF_FILTER_DEFAULT_MIN: 60,  // 기본 최소 신뢰도 (%)
    CONF_FILTER_STEP: 5,          // 조절 단위 (%)
    CONF_FILTER_MIN_LIMIT: 0,     // 하한
    CONF_FILTER_MAX_LIMIT: 100,   // 상한
    CONF_BLOCK_LOG_MAX: 300,      // 차단 이력 최대 보관 개수 (초과 시 오래된 것부터 제거)

    /* ---- Volume Profile (10단계, 관찰 전용) ----
       이미 받아둔 klines만 사용하므로 추가 API 요청이 발생하지 않는다.
       이번 단계에서는 신호 판정·점수·필터에 전혀 관여하지 않는다. */
    VOLUME_PROFILE: {
      TIMEFRAMES: ["15m", "5m"], // 분석 대상 타임프레임
      LOOKBACK: 120,             // 사용할 최근 캔들 수
      BINS: 40,                  // 가격 구간 분할 수
      VALUE_AREA_RATIO: 0.7,     // Value Area 기준 (전체 거래량의 70%)
      MIN_CANDLES: 20,           // 이보다 적으면 계산하지 않음(임의 값 생성 방지)
      CONCENTRATED_RATIO: 0.35,  // VA 폭이 전체 범위의 35% 이하면 "집중"
      DISPERSED_RATIO: 0.65,     // 65% 이상이면 "분산"
    },
    /* ---- Wyckoff 시장 구조 (관찰·학습 기반 전용) ----
       이미 받아둔 klines만 사용한다(추가 API 요청 없음).
       신호 점수·방향·confidence·필터·알림에는 관여하지 않는다. */
    WYCKOFF: {
      TIMEFRAMES: ["15m", "5m"],   // 기본 분석 대상 (15m=큰 구조/국면, 5m=단기 구조/이벤트)
      AUX_TIMEFRAMES: ["1m"],      // 보조 기록 전용 (진입 타이밍 참고, 판정에 사용 안 함)
      WINDOW: 40,                  // 분석 창 캔들 수
      EVENT_LOOKBACK: 3,           // 이벤트(이탈/복귀) 판단에 쓰는 최근 캔들 수
      MIN_CANDLES: 40,             // 이보다 적으면 판단하지 않음
      VOLUME_RECENT: 10,           // 최근 거래량 비교 구간
      VOLUME_EXPANSION: 1.3,       // 최근/이전 거래량 비율이 이 이상이면 증가
      VOLUME_CONTRACTION: 0.75,    // 이 이하면 감소
      EVENT_VOLUME: 1.2,           // SOS/SOW로 인정할 최소 거래량 비율
    },
    SIM_ADJUST_MAX_DELTA: 10,       // confidence 보정 최대 폭(%p) — 상승/하락 모두 ±10%p로 제한
    SIM_ADJUST_NEUTRAL_WIN_RATE: 50, // 이 승률을 중립으로 보고, 여기서 벗어난 만큼 보정한다

    // ---- A/B 성능 검증 (보정 전/후 비교) ----
    // 성능 측정 전용이며, 이 데이터는 학습에 다시 투입하지 않는다(순환 구조 방지).
    PERF_HISTORY_MAX: 1000,        // 성능 기록 최대 개수 (초과 시 오래된 것부터 제거)
    PERF_MIN_SAMPLE: 30,           // 이 개수 미만이면 성능 향상을 단정하지 않고 "데이터 수집 중"으로 판정
    PERF_SAMPLE_TIERS: [30, 50, 100], // 표본 구간 표시용 기준
    SNAPSHOT_CANDLE_COUNT: 10,   // 각 타임프레임별로 저장할 최근 캔들 개수

    SIGNAL_LOG_MAX: 300, // 향후 분석/학습용 기록 최대 보관 개수 (localStorage 용량 보호)
    TRADE_LOG_MAX: 500,  // 내 매매 기록 최대 보관 개수
    DEFAULT_TRADE_NOTIONAL: 100, // 거래 기록 시 기본 포지션 크기(USDT) — 손익금액 계산용

    // ---- 자가학습(패턴 신뢰도) 필터 ----
    // 감시 중인 모든 종목의 자동 신호를 대상으로 함 (Lock-in 기록과는 별개, PatternLearn 참고)
    LEARN_HORIZON_MS: 15 * 60 * 1000, // 신호 발생 후 이 시간이 지나면 성공/실패 판정
    LEARN_MIN_SAMPLES: 10,            // 이 개수 미만이면 필터링하지 않고 그대로 통과 (소수 실패로 차단 금지)
    LEARN_CONFIDENCE_THRESHOLD: 0.35, // 신뢰도가 이 값 미만이면 알림만 차단(로그는 계속 남김)
    LEARN_PRIOR_WEIGHT: 10,           // 신뢰도 계산 시 0.5(중립) 쪽으로 당기는 가중치 — 표본이 적을수록 영향력을 줄이고, 쌓일수록 실제 승률에 수렴시킨다
    LEARN_TIER_SUFFICIENT: 30,        // 이 개수 이상이면 "충분한 데이터"로 표시
    PATTERN_LOG_MAX: 500,             // 패턴별 대기(pending) 목록 최대 보관 개수

    MIN_RECORD_DURATION_MS: 10 * 1000, // 기록 시작 후 이 시간 미만에 UNLOCK하면 기록을 저장하지 않음

    STORAGE_KEYS: {
      SYMBOLS: "sig_symbols_v1",
      LANG: "sig_lang_v1",
      NOTIFY: "sig_notify_v1",
      SIGNAL_LOG: "sig_signal_log_v1",
      LOCK: "sig_lock_v1",
      RECORDING: "sig_recording_v1",
      LOCK_RECORDS: "sig_lock_records_v1",
      TRADES: "sig_trades_v1",
      PATTERN_LEARN: "sig_pattern_learn_v1",
      // Pattern Snapshot은 용량이 크므로 기존 학습 키와 물리적으로 분리된 별도 키에 저장한다.
      // 이렇게 하면 snapshot 쓰기/삭제가 기존 stats/entries/pending/scorePerf에 절대 영향을 주지 않는다.
      PATTERN_SNAPSHOTS: "sig_pattern_snapshots_v1",
      // A/B 성능 검증 전용 키. 기존 학습/스냅샷 데이터와 물리적으로 분리한다.
      PERF_HISTORY: "sig_signal_performance_v1",
      LEARN_ENABLED: "sig_learn_enabled_v1",
      SIGNAL_FILTER: "sig_signal_filter_v1",
      CONF_FILTER: "sig_conf_filter_v1",
      CONF_FILTER_MIN: "sig_conf_filter_min_v1",
      // 신뢰도 필터가 알림을 차단한 이력 (표시 전용, 학습에 재투입하지 않음)
      CONF_BLOCK_LOG: "sig_conf_block_log_v1",
      BG_MONITOR: "sig_bg_monitor_v1",
      SYMBOL_CATEGORY: "sig_symbol_category_v1",
    },
  };

  root.CONFIG = CONFIG;
})(typeof window !== "undefined" ? window : globalThis);
