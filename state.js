(function (root) {
  const CONFIG = root.CONFIG;
  const KEYS = CONFIG.STORAGE_KEYS;

  function get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }
  function set(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {}
  }

  const State = {
    lang: get(KEYS.LANG, "ko"),
    symbols: get(KEYS.SYMBOLS, CONFIG.DEFAULT_SYMBOLS),
    notifyEnabled: get(KEYS.NOTIFY, false),
    bgMonitorEnabled: get(KEYS.BG_MONITOR, false), // Android 앱에서만 의미 있음 (웹에서는 항상 미사용)
    learnEnabled: get(KEYS.LEARN_ENABLED, true), // 자가학습 ON/OFF (기본값 ON — 기존 동작 유지)
    // 신호 알림 필터 ON/OFF (기본값 ON — 기존 동작 유지).
    // 자가학습(learnEnabled)과는 완전히 별개다: 이걸 꺼도 학습/기록/성능 측정은 계속되고,
    // 알림을 걸러내는 단계만 건너뛴다.
    signalFilterEnabled: get(KEYS.SIGNAL_FILTER, true),
    /* 종합 신뢰도 필터 (기본 OFF — 켜기 전에는 기존 동작과 완전히 동일).
       signalFilterEnabled와는 별개의 독립 설정이다. */
    confFilterEnabled: get(KEYS.CONF_FILTER, false),
    confFilterMin: get(KEYS.CONF_FILTER_MIN, CONFIG.CONF_FILTER_DEFAULT_MIN),
    lock: get(KEYS.LOCK, null),           // { symbol, basePrice, lockedAt } | null — "잠금(기준 상태)"만 나타냄. 기록 여부와 무관.
    recording: get(KEYS.RECORDING, null), // { symbol, direction, basePrice, high, low, lockedAt } | null — "기록" 버튼을 눌러야만 생긴다.
    lockRecords: get(KEYS.LOCK_RECORDS, []), // UNLOCK으로 확정된 기록들의 배열 (신호 데이터와 완전히 분리, 기록창 전용)
    symbolCategory: get(KEYS.SYMBOL_CATEGORY, {}), // { [symbol]: "coin"|"stock" } — 없는 종목은 getCategory()에서 기본값(coin) 처리
    data: {},         // symbol -> latest Signals.evaluate() result (1m/5m/15m 전부 포함)
    errors: {},       // symbol -> true(최근 갱신 실패) — 화면엔 값 대신 "-" 표시용. 새로고침 시 초기화되는 휘발성 상태.
    /* 스와이프로 화면에서 치운 종목 (표시 전용, 휘발성).
       localStorage에 저장하지 않으므로 앱을 다시 열면 모두 복원된다.
       신호 기록·학습 데이터·거래 기록과는 완전히 무관하며, 백그라운드 감시와
       자가학습은 이 목록과 상관없이 모든 종목에 대해 계속 동작한다. */
    dismissed: {},    // symbol -> true
    detailTab: "1m",  // 상세화면에서 현재 보고 있는 타임프레임 탭 (1m/5m/15m)
    view: "coin",     // 'coin' | 'stock' | 'records' — ☰ 메뉴로 전환하는 현재 페이지.
                      // 'coin'/'stock'은 각 시장의 독립 신호 감시 페이지이며, 그 페이지에서 추가한 종목은
                      // 자동으로 해당 카테고리에 속한다(별도 선택 버튼 불필요).

    saveLang(v) {
      this.lang = v;
      set(KEYS.LANG, v);
    },
    saveSymbols(v) {
      this.symbols = v;
      set(KEYS.SYMBOLS, v);
    },
    saveNotify(v) {
      this.notifyEnabled = v;
      set(KEYS.NOTIFY, v);
    },
    saveBgMonitor(v) {
      this.bgMonitorEnabled = v;
      set(KEYS.BG_MONITOR, v);
    },
    saveLearnEnabled(v) {
      this.learnEnabled = v;
      set(KEYS.LEARN_ENABLED, v);
    },
    saveSignalFilter(v) {
      this.signalFilterEnabled = v;
      set(KEYS.SIGNAL_FILTER, v);
    },
    saveConfFilter(v) {
      this.confFilterEnabled = v;
      set(KEYS.CONF_FILTER, v);
    },
    // 최소 신뢰도: 0~100 범위로 제한하고 설정된 단위(5%)로 맞춘다.
    saveConfFilterMin(v) {
      const step = CONFIG.CONF_FILTER_STEP;
      let n = Number(v);
      if (!Number.isFinite(n)) n = CONFIG.CONF_FILTER_DEFAULT_MIN;
      n = Math.round(n / step) * step;
      n = Math.max(CONFIG.CONF_FILTER_MIN_LIMIT, Math.min(CONFIG.CONF_FILTER_MAX_LIMIT, n));
      this.confFilterMin = n;
      set(KEYS.CONF_FILTER_MIN, n);
      return n;
    },
    saveLock(v) {
      this.lock = v;
      set(KEYS.LOCK, v);
    },
    saveRecording(v) {
      this.recording = v;
      set(KEYS.RECORDING, v);
    },
    addLockRecord(record) {
      this.lockRecords = [record, ...this.lockRecords];
      set(KEYS.LOCK_RECORDS, this.lockRecords);
    },
    removeLockRecord(id) {
      this.lockRecords = this.lockRecords.filter((r) => r.id !== id);
      set(KEYS.LOCK_RECORDS, this.lockRecords);
    },
    // 종목의 카테고리(코인/주식 선물)를 반환한다. 기존에 카테고리 지정 없이 등록된 종목(마이그레이션 대상)은
    // 여기서 기본값(coin)으로 취급된다 — 별도의 일괄 변환 작업 없이 읽기 시점에 자연스럽게 처리된다.
    getCategory(symbol) {
      return this.symbolCategory[symbol] || CONFIG.DEFAULT_CATEGORY;
    },
    setCategory(symbol, category) {
      this.symbolCategory = Object.assign({}, this.symbolCategory, { [symbol]: category });
      set(KEYS.SYMBOL_CATEGORY, this.symbolCategory);
    },
    // 특정 카테고리(코인/주식)에 속한 감시 종목만 반환한다 — 두 페이지의 목록이 섞이지 않게 하는 기준.
    symbolsInCategory(category) {
      return this.symbols.filter((s) => this.getCategory(s) === category);
    },
    // 감시 목록에서만 제거할 종목들(잘못 등록된 심볼 등). 학습 데이터는 별도 저장소라 전혀 건드리지 않는다.
    purgeSymbols(list) {
      const before = this.symbols.length;
      const next = this.symbols.filter((s) => !list.includes(s));
      if (next.length !== before) set(KEYS.SYMBOLS, (this.symbols = next));
      return before - next.length;
    },
  };

  root.State = State;
})(typeof window !== "undefined" ? window : globalThis);
