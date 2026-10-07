/* =========================================================================
   AlertDetail — 알림에 담을 상세 정보 구성

   역할: 신호 발생 시점에 "이미 계산되어 있는 값"만 모아서 알림 본문을 만든다.
   지표를 다시 계산하지 않고, 신호 판단이나 점수에도 관여하지 않는다.

   설계 원칙:
   - 순수 함수다. 저장소를 읽거나 쓰지 않으며(유사 패턴 정보도 confReport에서 받는다),
     추가 API 요청도 하지 않는다.
   - 값의 출처를 기존 계산 결과로 한정한다:
       · 1m/5m/15m 상태 → result.tf[*] (Signals.computeIndicators 결과)
       · 점수/방향/조건 → result.long / result.short (signals.js 계산값)
       · confidence/유사 패턴 → ConfidenceAdjust.evaluateForSignal() 결과
       · 필터 통과 여부 → app.js가 판정한 값을 그대로 전달받음
   - 값이 없으면(표본 부족 등) 억지로 만들지 않고 해당 줄을 생략한다.
   - 모바일 알림은 길면 잘리므로, 짧은 본문(notification)과 상세 본문(toast/expanded)을
     구분해서 제공한다.
   ========================================================================= */
(function (root) {
  const isNum = (v) => Number.isFinite(v);

  // ui.js의 t()/tp()를 그대로 사용해 언어 설정을 따른다(별도 번역 로직을 만들지 않음).
  function t(key) {
    return root.UI && typeof root.UI.t === "function" ? root.UI.t(key) : key;
  }
  function tp(key, params) {
    return root.UI && typeof root.UI.tp === "function" ? root.UI.tp(key, params) : key;
  }
  function fmtPrice(p) {
    return root.UI && typeof root.UI.formatPrice === "function" ? root.UI.formatPrice(p) : String(p);
  }

  function num(v, digits) {
    return isNum(v) ? v.toFixed(digits === undefined ? 2 : digits) : null;
  }
  function pct(v, digits) {
    const s = num(v, digits === undefined ? 0 : digits);
    return s === null ? null : s + "%";
  }

  // 한 타임프레임의 상태를 한 줄로 요약한다. 저장된 값만 읽는다.
  function timeframeLine(label, st) {
    if (!st) return null;
    const parts = [];
    // Heikin-Ashi 방향
    if (st.haBullish !== null && st.haBullish !== undefined) {
      parts.push(st.haBullish ? t("haBullishShort") : t("haBearishShort"));
    }
    // MACD 상태 (크로스가 있으면 그것을, 없으면 시그널선 위/아래를)
    if (st.macdGoldenCross) parts.push(t("macdGoldenShort"));
    else if (st.macdDeadCross) parts.push(t("macdDeadShort"));
    else if (st.macdAboveSignal !== null && st.macdAboveSignal !== undefined) {
      parts.push(st.macdAboveSignal ? t("macdAboveShort") : t("macdBelowShort"));
    }
    // RSI 값 (방향 표시 포함)
    if (isNum(st.rsi)) {
      // rsiDelta가 0이거나(변화 없음) 값이 없으면 화살표를 붙이지 않는다.
      // rsiRising만 보면 "같을 때"도 하락(false)으로 표시되어 오해를 주기 때문이다.
      let arrow = "";
      if (isNum(st.rsiDelta)) {
        if (st.rsiDelta > 0) arrow = "\u2197";
        else if (st.rsiDelta < 0) arrow = "\u2198";
      } else if (st.rsiRising === true) {
        arrow = "\u2197";
      }
      parts.push(`RSI ${num(st.rsi, 0)}${arrow}`);
    }
    if (parts.length === 0) return null;
    return `${label} ${parts.join(" \u00b7 ")}`;
  }

  /* -----------------------------------------------------------------------
     알림에 담을 정보를 구성한다.
     입력값은 전부 app.js가 이미 가지고 있는 것들이며, 여기서 재계산하지 않는다.
     ----------------------------------------------------------------------- */
  function build({ symbol, direction, result, confReport, filterWouldPass, filterActive }) {
    if (!symbol || !direction || !result) return null;
    const dirData = direction === "long" ? result.long : result.short;
    if (!dirData) return null;

    const dirLabel = direction === "long" ? t("long") : t("short");
    const signalLabel = direction === "long" ? t("watchLong") : t("watchShort");

    // --- 제목: 종목 + 신호 종류 ---
    const title = `${symbol} \u2014 ${signalLabel}`;

    // --- 핵심 요약 줄: 점수 / 가격 ---
    const headline = `${t("score")} ${dirData.score} \u00b7 ${t("price")} ${fmtPrice(result.price)}`;

    // --- 타임프레임 상태 (이미 계산된 tf 데이터에서 읽기) ---
    const tfLines = [];
    if (result.tf) {
      // snapshot 형식(tf15/tf5/tf1)이 아니라 원본 tf 형식이므로 마지막 캔들 상태를 읽는다.
      const stateOf = (key) => {
        const d = result.tf[key];
        if (!d || !d.ha || d.ha.length === 0) return null;
        const last = d.ha.length - 1;
        const cross =
          root.Signals && typeof root.Signals.detectCross === "function"
            ? root.Signals.detectCross(d.macd, last)
            : { golden: false, dead: false };
        const dif = d.macd.dif[last];
        const dea = d.macd.dea[last];
        const rsiNow = d.rsi[last];
        const rsiPrev = last > 0 ? d.rsi[last - 1] : null;
        return {
          haBullish: d.ha[last].bullish,
          macdGoldenCross: cross.golden,
          macdDeadCross: cross.dead,
          macdAboveSignal: isNum(dif) && isNum(dea) ? dif > dea : null,
          rsi: rsiNow,
          rsiDelta: isNum(rsiNow) && isNum(rsiPrev) ? rsiNow - rsiPrev : null,
          rsiRising: isNum(rsiNow) && isNum(rsiPrev) ? rsiNow > rsiPrev : null,
        };
      };
      [
        ["15m", t("tf15Short")],
        ["5m", t("tf5Short")],
        ["1m", t("tf1Short")],
      ].forEach(([key, label]) => {
        const line = timeframeLine(label, stateOf(key));
        if (line) tfLines.push(line);
      });
    }

    // --- 충족 조건 (점수 근거) ---
    const conditionLabels = [];
    if (dirData.conditions) {
      const c = dirData.conditions;
      if (c.trend15) conditionLabels.push(t("cond_trend15"));
      if (c.trend5) conditionLabels.push(t("cond_trend5"));
      if (c.ha1Flip) conditionLabels.push(t("cond_ha1Flip"));
      if (c.macdCross) conditionLabels.push(t("cond_macdCross"));
    }

    // --- confidence (값이 있을 때만) ---
    let confidenceLine = null;
    if (confReport && isNum(confReport.adjustedConfidence)) {
      const adj = pct(confReport.adjustedConfidence * 100, 0);
      if (confReport.applied && isNum(confReport.baseConfidence)) {
        const base = pct(confReport.baseConfidence * 100, 0);
        const delta = confReport.similarityAdjustment;
        const sign = delta >= 0 ? "+" : "";
        confidenceLine = tp("alertConfidenceAdjusted", {
          base,
          adjusted: adj,
          delta: sign + num(delta * 100, 1) + "%p",
        });
      } else {
        confidenceLine = tp("alertConfidenceBase", { value: adj });
      }
    }

    // --- 유사 패턴 정보 (표본이 충분할 때만) ---
    let similarityLine = null;
    if (confReport && confReport.coreCount > 0 && isNum(confReport.similarityWeightedWinRate)) {
      similarityLine = tp("alertSimilarPatterns", {
        count: confReport.coreCount,
        winRate: pct(confReport.similarityWeightedWinRate, 0),
      });
    }

    // --- 필터 통과 여부 ---
    // 필터가 꺼져 있으면 "필터 미적용"임을 알려서 오해를 막는다.
    const filterLine = filterActive
      ? filterWouldPass
        ? t("alertFilterPassed")
        : t("alertFilterBlocked")
      : t("alertFilterInactive");

    /* --- 모바일 알림용 짧은 본문 ---
       브라우저/안드로이드 알림은 길면 잘리므로 핵심만 2~3줄로 담는다. */
    const notificationLines = [headline];
    if (confidenceLine) notificationLines.push(confidenceLine);
    if (tfLines.length) notificationLines.push(tfLines.join("\n"));

    /* --- 상세 본문 (앱 내 토스트/확장 보기용) --- */
    const detailLines = [headline];
    if (confidenceLine) detailLines.push(confidenceLine);
    if (similarityLine) detailLines.push(similarityLine);
    if (tfLines.length) detailLines.push(...tfLines);
    if (conditionLabels.length) {
      detailLines.push(`${t("conditionsMet")}: ${conditionLabels.join(", ")}`);
    }
    detailLines.push(filterLine);

    return {
      title,
      // 구조화된 값(테스트/확장에서 사용)
      symbol,
      direction,
      directionLabel: dirLabel,
      score: dirData.score,
      price: result.price,
      headline,
      timeframeLines: tfLines,
      conditionLabels,
      confidenceLine,
      similarityLine,
      filterLine,
      filterWouldPass: !!filterWouldPass,
      filterActive: !!filterActive,
      // 표시용 문자열
      notificationBody: notificationLines.join("\n"),
      detailBody: detailLines.join("\n"),
      detailLines,
    };
  }

  root.AlertDetail = { build, timeframeLine };
})(typeof window !== "undefined" ? window : globalThis);
