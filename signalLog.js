/* =========================================================================
   SignalLog
   신호가 발생할 때마다 나중에 AI 분석/학습에 활용할 수 있도록 구조화된
   데이터를 기록한다. 이번 수정에서는 "기록"까지만 구현하고, 실제 분석/학습
   로직은 만들지 않는다.

   기록 항목: 시간, 종목, LONG/SHORT, 가격, 각 시간봉의 Heikin Ashi 추세 /
   MACD(DIF·DEA) / RSI, 충족된 조건, 점수.
   ========================================================================= */
(function (root) {
  const CONFIG = root.CONFIG;
  const KEY = CONFIG.STORAGE_KEYS.SIGNAL_LOG;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function save(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch (e) {
      /* localStorage 용량 초과 등은 조용히 무시 (기록 기능은 부가 기능) */
    }
  }

  // result: signals.js의 evaluate() 리턴값, direction: 'long' | 'short'
  function buildRecord(result, direction) {
    const dirData = direction === "long" ? result.long : result.short;
    const snapshotTf = (tf) => {
      const d = result.tf[tf];
      const last = d.ha.length - 1;
      return {
        trend: d.ha[last].bullish ? "bullish" : "bearish",
        dif: d.macd.dif[last],
        dea: d.macd.dea[last],
        rsi: d.rsi[last],
      };
    };
    return {
      id: `${result.symbol}-${direction}-${result.entryTimes["1m"]}`,
      time: result.updatedAt,
      symbol: result.symbol,
      direction, // 'long' | 'short'
      price: result.price,
      score: dirData.score,
      band: dirData.band,
      conditions: dirData.conditions,
      entryTimes: result.entryTimes, // 각 타임프레임의 신호 시점 캔들 openTime (차트 마커 위치 참조용)
      timeframes: {
        "1m": snapshotTf("1m"),
        "5m": snapshotTf("5m"),
        "15m": snapshotTf("15m"),
      },
    };
  }

  function append(result, direction) {
    const list = load();
    list.push(buildRecord(result, direction));
    while (list.length > CONFIG.SIGNAL_LOG_MAX) list.shift();
    save(list);
    return list[list.length - 1];
  }

  function getAll() {
    return load();
  }

  function getForSymbol(symbol) {
    return load().filter((r) => r.symbol === symbol);
  }

  // 특정 종목의 특정 타임프레임 차트에 마커를 찍기 위해, 그 타임프레임의
  // openTime 목록만 뽑아준다. { openTime, direction }[]
  function getMarkersForSymbolTf(symbol, tf) {
    return load()
      .filter((r) => r.symbol === symbol && r.entryTimes && r.entryTimes[tf] != null)
      .map((r) => ({ openTime: r.entryTimes[tf], direction: r.direction }));
  }

  function clear() {
    save([]);
  }

  root.SignalLog = { append, getAll, getForSymbol, getMarkersForSymbolTf, clear, buildRecord };
})(typeof window !== "undefined" ? window : globalThis);
