/* =========================================================================
   ConfBlockLog — 신뢰도 필터가 알림을 차단한 이력 (표시 전용)

   목적: "왜 알림이 안 왔는지"를 사용자가 확인할 수 있게 한다.

   설계 원칙:
   - 전용 localStorage 키(CONF_BLOCK_LOG)만 사용한다. 학습 데이터·스냅샷·성능
     기록과 물리적으로 분리되어 있어 이 모듈의 쓰기/삭제가 그쪽에 영향을 줄 수 없다.
   - 이 기록은 학습에 재투입하지 않는다(순환 방지). 오직 화면 표시용이다.
   - 신호 자체는 이미 정상 경로로 기록되어 있다. 여기에는 "차단됐다"는 사실과
     판단 근거(신뢰도·기준값)만 남긴다.
   - 중복 방지는 기존 signalId 체계를 그대로 재사용한다.
   ========================================================================= */
(function (root) {
  const CONFIG = root.CONFIG;
  const KEY = CONFIG.STORAGE_KEYS.CONF_BLOCK_LOG;
  const isNum = (v) => Number.isFinite(v);

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const data = raw ? JSON.parse(raw) : {};
      if (!Array.isArray(data.blocks)) data.blocks = [];
      return data;
    } catch (e) {
      return { blocks: [] };
    }
  }

  function save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      // 기록 실패가 신호/알림 흐름을 막지 않도록 한다(부가 기능).
      console.error("conf block log save failed", e);
    }
  }

  /* 알림이 차단된 신호를 기록한다.
     같은 signalId가 이미 있으면 다시 쓰지 않는다(중복 방지). */
  function record({ signalId, signalTime, symbol, market, direction, score, confidence, threshold }) {
    if (!signalId) return null;
    const data = load();
    if (data.blocks.some((b) => b.signalId === signalId)) return null;

    const entry = {
      signalId,
      signalTime: isNum(signalTime) ? signalTime : Date.now(),
      blockedAt: Date.now(),
      symbol: symbol || null,
      market: market || null,
      direction: direction || null,
      score: isNum(score) ? score : null,
      // 판단 근거를 함께 남긴다 — 나중에 "왜 막혔는지" 확인할 수 있게
      confidence: isNum(confidence) ? confidence : null,
      threshold: isNum(threshold) ? threshold : null,
    };
    data.blocks.push(entry);
    while (data.blocks.length > CONFIG.CONF_BLOCK_LOG_MAX) data.blocks.shift();
    save(data);
    return entry;
  }

  // 최신순으로 반환한다. market을 주면 그 시장만(코인/주식이 섞이지 않게).
  function getAll(filter) {
    const f = filter || {};
    return load()
      .blocks.filter(
        (b) =>
          (!f.market || b.market === f.market) &&
          (f.score == null || b.score === f.score) &&
          (!f.direction || b.direction === f.direction)
      )
      .slice()
      // 최신순. 같은 밀리초에 기록된 경우 신호 발생 시각으로 안정적으로 정렬한다.
      .sort((a, b) => (b.blockedAt || 0) - (a.blockedAt || 0) || (b.signalTime || 0) - (a.signalTime || 0));
  }

  // 요약: 총 차단 건수 + 최근 24시간 건수 (화면 안내용)
  function getSummary(filter) {
    const list = getAll(filter);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return {
      total: list.length,
      recent24h: list.filter((b) => (b.blockedAt || 0) >= dayAgo).length,
      latest: list.length > 0 ? list[0] : null,
      max: CONFIG.CONF_BLOCK_LOG_MAX,
    };
  }

  // 사용자가 직접 요청할 때만 호출한다(자동 호출 금지).
  // 전용 키만 비우므로 학습·성능·거래 데이터에는 영향이 없다.
  function clear() {
    save({ blocks: [] });
  }

  root.ConfBlockLog = { record, getAll, getSummary, clear };
})(typeof window !== "undefined" ? window : globalThis);
