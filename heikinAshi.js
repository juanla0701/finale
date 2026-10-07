/* =========================================================================
   Heikin Ashi
   입력: klines = [{ open, high, low, close }, ...] (시간순 정렬)
   출력: 동일 길이의 [{ open, high, low, close, bullish }, ...]
   - 색깔만으로 판단하지 않고 실제 HA 값을 계산해서 추세(bullish)를 정한다.
   ========================================================================= */
(function (root) {
  function compute(klines) {
    const ha = [];
    for (let i = 0; i < klines.length; i++) {
      const k = klines[i];
      const haClose = (k.open + k.high + k.low + k.close) / 4;
      const haOpen =
        i === 0 ? (k.open + k.close) / 2 : (ha[i - 1].open + ha[i - 1].close) / 2;
      const haHigh = Math.max(k.high, haOpen, haClose);
      const haLow = Math.min(k.low, haOpen, haClose);
      ha.push({
        open: haOpen,
        high: haHigh,
        low: haLow,
        close: haClose,
        bullish: haClose > haOpen,
      });
    }
    return ha;
  }

  root.HeikinAshi = { compute };
})(typeof window !== "undefined" ? window : globalThis);
