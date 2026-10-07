/* =========================================================================
   TradeLog
   "내 기록" 화면에 표시되는 사용자의 실제 매매 기록을 관리한다.
   신호 자체를 기록하는 SignalLog와는 별개로, 사용자가 직접 "진입/청산"을
   기록한 거래를 다룬다. 앱을 다시 열어도 유지되도록 localStorage에 저장한다.
   ========================================================================= */
(function (root) {
  const CONFIG = root.CONFIG;
  const KEY = CONFIG.STORAGE_KEYS.TRADES;

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
      /* 저장 실패는 조용히 무시 (부가 기능) */
    }
  }

  function uid() {
    return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // State.data[symbol] (Signals.evaluate 결과)로부터 진입 시점 스냅샷을 만든다.
  // 나중에 손실 분석에 사용된다.
  function buildSnapshot(result) {
    if (!result) return null;
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
      long: { score: result.long.score, band: result.long.band, conditions: result.long.conditions },
      short: { score: result.short.score, band: result.short.band, conditions: result.short.conditions },
      leadingDirection: result.leadingDirection,
      status: result.status,
      timeframes: { "1m": snapshotTf("1m"), "5m": snapshotTf("5m"), "15m": snapshotTf("15m") },
    };
  }

  // direction: 'long' | 'short', notional: 포지션 크기(USDT), snapshotResult: Signals.evaluate() 결과(optional)
  function addEntry({ symbol, direction, entryPrice, entryTime, notional, snapshotResult }) {
    const list = load();
    const trade = {
      id: uid(),
      symbol,
      direction,
      entryPrice,
      entryTime: entryTime || Date.now(),
      exitPrice: null,
      exitTime: null,
      notional: notional && notional > 0 ? notional : CONFIG.DEFAULT_TRADE_NOTIONAL,
      status: "open", // 'open' | 'closed'
      pnlPercent: null,
      pnlAmount: null,
      win: null,
      entrySnapshot: buildSnapshot(snapshotResult),
    };
    list.push(trade);
    while (list.length > CONFIG.TRADE_LOG_MAX) list.shift();
    save(list);
    return trade;
  }

  function closeTrade(id, exitPrice, exitTime) {
    const list = load();
    const trade = list.find((t) => t.id === id);
    if (!trade) return null;
    trade.exitPrice = exitPrice;
    trade.exitTime = exitTime || Date.now();
    trade.pnlPercent =
      trade.direction === "long"
        ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100
        : ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;
    trade.pnlAmount = (trade.notional * trade.pnlPercent) / 100;
    trade.win = trade.pnlPercent > 0;
    trade.status = "closed";
    save(list);
    return trade;
  }

  function deleteTrade(id) {
    const list = load().filter((t) => t.id !== id);
    save(list);
  }

  function getAll() {
    return load().slice().sort((a, b) => b.entryTime - a.entryTime);
  }
  function getOpen() {
    return load().filter((t) => t.status === "open");
  }
  function getClosed() {
    return load()
      .filter((t) => t.status === "closed")
      .sort((a, b) => b.exitTime - a.exitTime);
  }

  function getStats() {
    const closed = load().filter((t) => t.status === "closed");
    const total = closed.length;
    const wins = closed.filter((t) => t.win).length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    const totalPnlAmount = closed.reduce((sum, t) => sum + (t.pnlAmount || 0), 0);
    return { total, wins, losses: total - wins, winRate, totalPnlAmount };
  }

  root.TradeLog = { addEntry, closeTrade, deleteTrade, getAll, getOpen, getClosed, getStats, buildSnapshot };
})(typeof window !== "undefined" ? window : globalThis);
