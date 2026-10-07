/* =========================================================================
   MACD (DIF / DEA)
   입력: closes = [number, ...]
   출력: { dif: [number|null,...], dea: [number|null,...] }
   ========================================================================= */
(function (root) {
  function computeEMA(values, period) {
    const out = new Array(values.length).fill(null);
    if (values.length < period) return out;
    const k = 2 / (period + 1);
    let sma = 0;
    for (let i = 0; i < period; i++) sma += values[i];
    sma /= period;
    out[period - 1] = sma;
    let prev = sma;
    for (let i = period; i < values.length; i++) {
      const v = values[i] * k + prev * (1 - k);
      out[i] = v;
      prev = v;
    }
    return out;
  }

  function compute(closes, fast, slow, signal) {
    const emaFast = computeEMA(closes, fast);
    const emaSlow = computeEMA(closes, slow);
    const dif = closes.map((_, i) =>
      emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
    );

    const firstValid = dif.findIndex((v) => v != null);
    const dea = new Array(dif.length).fill(null);
    if (firstValid !== -1) {
      const validDif = dif.slice(firstValid);
      const deaValid = computeEMA(validDif, signal);
      for (let i = 0; i < deaValid.length; i++) dea[firstValid + i] = deaValid[i];
    }
    return { dif, dea };
  }

  root.MACD = { compute, computeEMA };
})(typeof window !== "undefined" ? window : globalThis);
