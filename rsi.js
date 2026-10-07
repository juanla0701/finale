/* =========================================================================
   RSI (Wilder's smoothing)
   입력: closes = [number, ...], period (기본 14)
   출력: [number|null, ...] 동일 길이
   ========================================================================= */
(function (root) {
  function compute(closes, period) {
    const out = new Array(closes.length).fill(null);
    if (closes.length <= period) return out;

    let gainSum = 0,
      lossSum = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gainSum += diff;
      else lossSum -= diff;
    }
    let avgGain = gainSum / period;
    let avgLoss = lossSum / period;
    out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return out;
  }

  root.RSI = { compute };
})(typeof window !== "undefined" ? window : globalThis);
