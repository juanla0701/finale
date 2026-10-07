(function (root) {
  const MACD_COLORS = { dif: "#E8A33D", dea: "#6FA8DC" };
  const SIGNAL_COLORS = { long: "#2ECC71", short: "#F0554B" };

  function prepCanvas(canvas) {
    // 캔버스가 없으면(DOM 미생성 등) 그리지 않는다 — 호출부가 안전하게 종료되도록 null 반환.
    if (!canvas || typeof canvas.getContext !== "function") return null;
    const rect = canvas.getBoundingClientRect();
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    // 폭이 0으로 측정되는 경우가 있다(화면 전환 애니메이션 중, 레이아웃 확정 전,
    // 안드로이드 WebView의 첫 프레임 등). 이때 그대로 그리면 빈 차트가 되므로
    // 부모 폭 → 화면 폭 순으로 대체값을 찾는다.
    let w = rect.width;
    if (!w || w < 2) {
      const parent = canvas.parentElement;
      w = (parent && parent.getBoundingClientRect ? parent.getBoundingClientRect().width : 0) || 0;
    }
    if (!w || w < 2) {
      // window가 없는 환경(워커 등)도 있으므로 방어적으로 참조한다.
      const vw = typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 360;
      w = vw - 24; // 좌우 패딩 감안한 대략값
    }
    w = Math.max(w, 200);
    // 높이도 같은 이유로 대체값을 둔다(CSS 높이가 아직 적용되지 않은 경우 대비).
    let h = canvas.clientHeight;
    if (!h) {
      const styleH =
        typeof getComputedStyle === "function" ? parseInt(getComputedStyle(canvas).height, 10) : 0;
      h = styleH || rect.height || 60;
    }
    h = Math.max(h, 40);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function drawLine(ctx, arr, cw, yOf, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let started = false;
    arr.forEach((v, i) => {
      if (v == null) return;
      const x = i * cw + cw / 2;
      if (!started) {
        ctx.moveTo(x, yOf(v));
        started = true;
      } else {
        ctx.lineTo(x, yOf(v));
      }
    });
    ctx.stroke();
  }

  // markers: [{ openTime, direction: 'long'|'short' }, ...] — 과거 신호가 발생한 캔들 표시
  function drawPriceChart(canvas, klines, ha, count, markers) {
    const prep = prepCanvas(canvas);
    if (!prep) return; // 캔버스가 없거나 컨텍스트를 못 얻으면 조용히 종료(앱은 계속 동작)
    const { ctx, w, h } = prep;
    const N = count || 60;
    const data = klines.slice(-N);
    const haData = ha.slice(-N);
    if (data.length < 2) return;
    let min = Infinity,
      max = -Infinity;
    data.forEach((k) => {
      min = Math.min(min, k.low);
      max = Math.max(max, k.high);
    });
    const pad = (max - min) * 0.08 || max * 0.01;
    min -= pad;
    max += pad;
    const cw = w / data.length;
    const yOf = (v) => h - ((v - min) / (max - min)) * h;

    data.forEach((k, i) => {
      const x = i * cw + cw / 2;
      const bullish = haData[i].bullish;
      ctx.strokeStyle = ctx.fillStyle = bullish ? "#2ECC71" : "#F0554B";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yOf(k.high));
      ctx.lineTo(x, yOf(k.low));
      ctx.stroke();
      const bodyTop = yOf(Math.max(k.open, k.close));
      const bodyBot = yOf(Math.min(k.open, k.close));
      const bw = Math.max(cw * 0.6, 1);
      ctx.fillRect(x - bw / 2, bodyTop, bw, Math.max(bodyBot - bodyTop, 1));
    });

    // 과거 LONG/SHORT 신호 마커: LONG은 캔들 아래 초록 삼각형(▲), SHORT는 캔들 위 빨간 삼각형(▼)
    if (markers && markers.length) {
      const byTime = new Map(data.map((k, i) => [k.openTime, i]));
      markers.forEach((m) => {
        const i = byTime.get(m.openTime);
        if (i == null) return;
        const x = i * cw + cw / 2;
        const color = SIGNAL_COLORS[m.direction] || "#8B96A5";
        const size = Math.max(Math.min(cw * 0.5, 7), 3);
        ctx.fillStyle = color;
        ctx.beginPath();
        if (m.direction === "long") {
          const y = yOf(data[i].low) + 4;
          ctx.moveTo(x, y + size);
          ctx.lineTo(x - size, y);
          ctx.lineTo(x + size, y);
        } else {
          const y = yOf(data[i].high) - 4;
          ctx.moveTo(x, y - size);
          ctx.lineTo(x - size, y);
          ctx.lineTo(x + size, y);
        }
        ctx.closePath();
        ctx.fill();
      });
    }
  }

  function drawMacdChart(canvas, macd, count) {
    const prep = prepCanvas(canvas);
    if (!prep) return; // 캔버스가 없거나 컨텍스트를 못 얻으면 조용히 종료(앱은 계속 동작)
    const { ctx, w, h } = prep;
    const N = count || 60;
    const dif = macd.dif.slice(-N);
    const dea = macd.dea.slice(-N);
    const hist = dif.map((v, i) => (v != null && dea[i] != null ? v - dea[i] : null));
    const vals = [...dif, ...dea, ...hist].filter((v) => v != null);
    if (vals.length < 2) return;
    let min = Math.min(...vals),
      max = Math.max(...vals);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.15;
    min -= pad;
    max += pad;
    const cw = w / dif.length;
    const yOf = (v) => h - ((v - min) / (max - min)) * h;
    const zeroY = yOf(0);
    ctx.strokeStyle = "#2B3440";
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(w, zeroY);
    ctx.stroke();

    hist.forEach((v, i) => {
      if (v == null) return;
      const x = i * cw + cw / 2;
      ctx.fillStyle = v >= 0 ? "rgba(46,204,113,0.55)" : "rgba(240,85,75,0.55)";
      const top = Math.min(zeroY, yOf(v));
      const bot = Math.max(zeroY, yOf(v));
      const bw = Math.max(cw * 0.35, 1);
      ctx.fillRect(x - bw / 2, top, bw, Math.max(bot - top, 1));
    });
    drawLine(ctx, dif, cw, yOf, MACD_COLORS.dif);
    drawLine(ctx, dea, cw, yOf, MACD_COLORS.dea);
  }

  function drawRsiChart(canvas, rsi, count) {
    const prep = prepCanvas(canvas);
    if (!prep) return; // 캔버스가 없거나 컨텍스트를 못 얻으면 조용히 종료(앱은 계속 동작)
    const { ctx, w, h } = prep;
    const N = count || 60;
    const data = rsi.slice(-N);
    const min = 0,
      max = 100;
    const cw = w / data.length;
    const yOf = (v) => h - ((v - min) / (max - min)) * h;
    ctx.strokeStyle = "#2B3440";
    ctx.setLineDash([3, 3]);
    [30, 50, 70].forEach((lvl) => {
      ctx.beginPath();
      ctx.moveTo(0, yOf(lvl));
      ctx.lineTo(w, yOf(lvl));
      ctx.stroke();
    });
    ctx.setLineDash([]);
    drawLine(ctx, data, cw, yOf, "#E8A33D");
  }

  // 자가학습 성능(구간별 승률) 전용 소형 그래프.
  // 기존 신호/매매 차트와 완전히 분리된 별도 함수이며, 신호 데이터를 건드리지 않는다.
  // series: [{ index, winRate }, ...] (winRate 0~100)
  function drawWinRateChart(canvas, series) {
    const prep = prepCanvas(canvas);
    if (!prep) return; // 캔버스가 없거나 컨텍스트를 못 얻으면 조용히 종료(앱은 계속 동작)
    const { ctx, w, h } = prep;
    if (!series || series.length === 0) return;
    const min = 0,
      max = 100;
    const yOf = (v) => h - ((v - min) / (max - min)) * h;

    // 50% 기준선 (이 위면 승률 과반)
    ctx.strokeStyle = "#2B3440";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, yOf(50));
    ctx.lineTo(w, yOf(50));
    ctx.stroke();
    ctx.setLineDash([]);

    if (series.length === 1) {
      // 구간이 하나뿐이면 선을 그릴 수 없으므로 점으로 표시
      ctx.fillStyle = "#E8A33D";
      ctx.beginPath();
      ctx.arc(w / 2, yOf(series[0].winRate), 3, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const stepX = w / (series.length - 1);
    ctx.strokeStyle = "#E8A33D";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    series.forEach((pt, i) => {
      const x = i * stepX;
      const y = yOf(pt.winRate);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 마지막 지점 강조 (현재 성능 위치)
    const last = series[series.length - 1];
    ctx.fillStyle = last.winRate >= 50 ? "#2ECC71" : "#F0554B";
    ctx.beginPath();
    ctx.arc(w - 1, yOf(last.winRate), 3, 0, Math.PI * 2);
    ctx.fill();
  }

  root.Charts = { drawPriceChart, drawMacdChart, drawRsiChart, drawWinRateChart, prepCanvas, MACD_COLORS, SIGNAL_COLORS };
})(typeof window !== "undefined" ? window : globalThis);
