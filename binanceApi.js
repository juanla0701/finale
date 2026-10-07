/* =========================================================================
   Binance Futures market data (public endpoint only — no API key, no order
   permission, read-only kline data).
   ========================================================================= */
(function (root) {
  const CONFIG = root.CONFIG;

  function isValidCandle(k) {
    return (
      Number.isFinite(k.open) &&
      Number.isFinite(k.high) &&
      Number.isFinite(k.low) &&
      Number.isFinite(k.close) &&
      k.open > 0 &&
      k.high > 0 &&
      k.low > 0 &&
      k.close > 0
    );
  }

  /* 요청 타임아웃/중단 처리
     앱이 백그라운드로 가면 브라우저/WebView가 진행 중인 fetch를 중단시킨다.
     이때 오류가 그대로 오류 상태로 굳어 "데이터 로드 실패"가 남는 문제가 있어서,
     ① 타임아웃을 두고 ② 일시적 중단은 1회 재시도로 복구한다.
     실제 네트워크 오류(오프라인 등)는 재시도 후에도 그대로 던져진다. */
  function fetchWithTimeout(url, timeoutMs) {
    // AbortController가 없는 구형 WebView도 있으므로 방어적으로 사용한다.
    if (typeof AbortController === "undefined") return fetch(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  function parseKlines(raw) {
    if (!Array.isArray(raw)) throw new Error("Unexpected response shape");
    const klines = raw.map((r) => ({
      openTime: r[0],
      open: parseFloat(r[1]),
      high: parseFloat(r[2]),
      low: parseFloat(r[3]),
      close: parseFloat(r[4]),
      volume: parseFloat(r[5]),
      closeTime: r[6],
    }));
    // 값이 깨진(NaN, 0 이하) 캔들은 걸러낸다 — 화면에 잘못된 가격이 표시되는 것을 막기 위함.
    // (신호 계산에 필요한 최소 캔들 수 체크는 app.js에서 필터링 이후 길이로 판단한다)
    return klines.filter(isValidCandle);
  }

  async function fetchKlines(symbol, interval, limit) {
    const url = `${CONFIG.BINANCE_FAPI_KLINES}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const timeout = CONFIG.FETCH_TIMEOUT_MS;
    let lastError = null;
    // 최초 시도 + 1회 재시도 (백그라운드 전환으로 중단된 요청 복구용)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchWithTimeout(url, timeout);
        if (!res.ok) throw new Error("HTTP " + res.status);
        return parseKlines(await res.json());
      } catch (e) {
        lastError = e;
        // 마지막 시도였으면 그대로 실패시킨다
        if (attempt === 1) break;
        // 짧게 쉬고 한 번 더 시도한다
        await new Promise((r) => setTimeout(r, CONFIG.FETCH_RETRY_DELAY_MS));
      }
    }
    throw lastError || new Error("fetch failed");
  }

  root.BinanceApi = { fetchKlines, isValidCandle, fetchWithTimeout, parseKlines };
})(typeof window !== "undefined" ? window : globalThis);
