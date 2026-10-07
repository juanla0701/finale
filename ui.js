(function (root) {
  const CONFIG = root.CONFIG;
  const State = root.State;

  function t(key) {
    return (root.I18N[State.lang] && root.I18N[State.lang][key]) || key;
  }
  // {placeholder} 치환이 필요한 문구용 (손실 분석 문구 등)
  function tp(key, params) {
    let s = t(key);
    Object.keys(params || {}).forEach((k) => {
      s = s.replace(new RegExp("\\{" + k + "\\}", "g"), params[k]);
    });
    return s;
  }

  function formatPrice(p) {
    if (p == null || !Number.isFinite(p) || p <= 0) return "-";
    if (p >= 100) return p.toFixed(2);
    if (p >= 1) return p.toFixed(4);
    return p.toFixed(6);
  }
  function formatNum(n) {
    return n == null ? "-" : n.toFixed(2);
  }

  // status('strong'|'watch'|'neutral'|'none') + direction('long'|'short'|null) -> 배지 텍스트/클래스
  function badgeInfo(status, direction) {
    if (status === "strong") return { text: direction === "long" ? t("strongLong") : t("strongShort"), cls: "strong-" + direction };
    if (status === "watch") return { text: direction === "long" ? t("watchLong") : t("watchShort"), cls: "watch-" + direction };
    if (status === "neutral") return { text: t("neutralSignal"), cls: "neutral" };
    return { text: t("noSignal"), cls: "none" };
  }

  /* ---------------- Dashboard list ---------------- */
  // 현재 열려 있는 카테고리 페이지에 이 종목이 속하는지 (속하지 않으면 목록에 표시하지 않는다)
  function isInCurrentCategoryPage(symbol) {
    if (State.view !== "coin" && State.view !== "stock") return false;
    return State.getCategory(symbol) === State.view;
  }

  /* ---------------- 신호 카드 좌우 스와이프로 화면에서 치우기 ----------------
     알림을 밀어서 없애는 것과 같은 동작. "화면 표시만" 제거하며
     신호 기록·학습 데이터·거래 기록·성능 데이터는 전혀 건드리지 않는다.
     (State.dismissed는 휘발성이라 앱을 다시 열면 모두 복원된다)

     클릭/버튼과의 충돌 방지:
     - 가로 이동이 세로 이동보다 크고 일정 거리(SWIPE_START)를 넘긴 순간부터만
       스와이프로 간주하고, 그때 preventDefault로 스크롤을 막는다.
     - 스와이프로 판정되면 그 제스처의 click은 무시한다(상세보기가 열리지 않게).
     - 삭제 버튼을 누른 경우는 스와이프를 시작하지 않는다. */
  const SWIPE_START = 8;        // 이 거리를 넘으면 스와이프 시작으로 본다(px)
  const SWIPE_DISMISS = 90;     // 이 거리 이상 밀면 화면에서 치운다(px)

  function attachSwipeToDismiss(row, symbol) {
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let swiping = false;
    let decided = false; // 이 제스처가 스와이프인지 판정했는지

    const reset = (animate) => {
      row.style.transition = animate ? "transform 0.18s ease, opacity 0.18s ease" : "";
      row.style.transform = "";
      row.style.opacity = "";
      if (animate) {
        setTimeout(() => {
          row.style.transition = "";
        }, 200);
      }
    };

    const dismiss = (direction) => {
      // 화면 밖으로 밀어내는 짧은 애니메이션 후 DOM에서 제거한다.
      row.style.transition = "transform 0.18s ease, opacity 0.18s ease";
      row.style.transform = `translateX(${direction > 0 ? "110%" : "-110%"})`;
      row.style.opacity = "0";
      // 표시 전용 상태만 기록 — 데이터는 그대로 유지된다.
      if (!State.dismissed) State.dismissed = {};
      State.dismissed[symbol] = true;
      setTimeout(() => {
        removeRow(symbol);
        maybeShowEmpty();
      }, 190);
    };

    row.addEventListener(
      "touchstart",
      (e) => {
        // 삭제 버튼에서 시작한 터치는 스와이프로 처리하지 않는다(기존 기능 보호).
        if (e.target && typeof e.target.closest === "function" && e.target.closest("button.row-del")) return;
        if (!e.touches || e.touches.length !== 1) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        dx = 0;
        swiping = false;
        decided = false;
        row.style.transition = "";
      },
      { passive: true }
    );

    row.addEventListener(
      "touchmove",
      (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        const cx = e.touches[0].clientX;
        const cy = e.touches[0].clientY;
        const mx = cx - startX;
        const my = cy - startY;

        if (!decided) {
          // 세로 스크롤 의도면 스와이프로 보지 않는다(목록 스크롤 보호).
          if (Math.abs(my) > Math.abs(mx) && Math.abs(my) > SWIPE_START) {
            decided = true;
            swiping = false;
            return;
          }
          if (Math.abs(mx) > SWIPE_START) {
            decided = true;
            swiping = true;
          } else {
            return;
          }
        }
        if (!swiping) return;

        dx = mx;
        // 손가락을 따라 움직이고, 멀어질수록 살짝 흐려진다.
        const fade = Math.min(Math.abs(dx) / (SWIPE_DISMISS * 1.6), 0.55);
        row.style.transform = `translateX(${dx}px)`;
        row.style.opacity = String(1 - fade);
        if (e.cancelable) e.preventDefault(); // 스와이프 중에는 목록 스크롤을 막는다
      },
      { passive: false }
    );

    const finish = () => {
      if (!swiping) {
        decided = false;
        return;
      }
      if (Math.abs(dx) >= SWIPE_DISMISS) {
        dismiss(dx > 0 ? 1 : -1);
      } else {
        // 충분히 밀지 않았으면 원래 위치로 되돌린다.
        reset(true);
      }
      // 이 제스처에서 발생하는 click은 무시한다(상세보기 오픈 방지).
      row.dataset.swiped = "1";
      setTimeout(() => {
        delete row.dataset.swiped;
      }, 320);
      swiping = false;
      decided = false;
      dx = 0;
    };

    row.addEventListener("touchend", finish, { passive: true });
    row.addEventListener("touchcancel", () => {
      if (swiping) reset(true);
      swiping = false;
      decided = false;
      dx = 0;
    }, { passive: true });

    // 스와이프 직후의 click을 흡수한다(캡처 단계에서 차단).
    row.addEventListener(
      "click",
      (e) => {
        if (row.dataset.swiped) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true
    );
  }

  function ensureRow(symbol) {
    // 카테고리 검사를 "기존 행 반환"보다 먼저 한다.
    // 순서가 뒤바뀌면, 코인 화면에서 만들어진 행이 DOM에 남아있을 때 주식 화면으로
    // 전환한 뒤에도 그 행이 그대로 반환되어 계속 갱신되고, 결국 두 시장의 신호가
    // 같은 목록에 섞여 보이게 된다.
    if (!isInCurrentCategoryPage(symbol)) {
      // 다른 시장 종목의 행이 남아있다면 이 페이지에서 제거한다.
      removeRow(symbol);
      return null;
    }
    // 스와이프로 치운 종목은 이 화면에 다시 만들지 않는다(표시 전용 상태).
    // 데이터·학습·백그라운드 감시에는 전혀 영향이 없다.
    if (State.dismissed && State.dismissed[symbol]) {
      removeRow(symbol);
      return null;
    }
    let row = document.getElementById("row-" + symbol);
    if (row) return row;
    const list = document.getElementById("list");
    const empty = list.querySelector(".empty");
    if (empty) empty.remove();
    // row 자체를 button으로 두면 안에 삭제 button을 넣을 수 없으므로(중첩 불가),
    // div 래퍼 안에 "상세보기 영역(button)"과 "삭제 버튼"을 나란히 둔다.
    row = document.createElement("div");
    row.className = "row";
    row.id = "row-" + symbol;
    row.innerHTML = `
      <button type="button" class="row-open" data-open="${symbol}">
        <div class="row-main">
          <div class="row-top">
            <span class="row-sym">${symbol}</span>
            <span class="row-badge none" id="badge-${symbol}">${t("noSignal")}</span>
          </div>
          <div class="row-bottom">
            <span class="row-price" id="price-${symbol}">-</span>
            <span class="row-score" id="score-${symbol}">-</span>
          </div>
        </div>
        <span class="row-chevron">\u203A</span>
      </button>
      <button type="button" class="row-del" data-sym="${symbol}">${t("delete")}</button>
    `;
    row.querySelector(`button[data-open="${symbol}"]`).addEventListener("click", () => openDetail(symbol));
    attachSwipeToDismiss(row, symbol);
    list.appendChild(row);
    return row;
  }

  function renderRow(symbol, result, isError) {
    const row = ensureRow(symbol);
    if (!row) return; // 현재 카테고리 페이지에 속하지 않는 종목 — 이 페이지에는 표시하지 않음
    if (isError || !result) {
      // 가격/신호 데이터가 없거나 오류가 났을 때는 잘못된 값을 남기지 않고 "-"로 표시한다.
      row.querySelector(`#price-${symbol}`).textContent = "-";
      row.querySelector(`#score-${symbol}`).textContent = "-";
      const badge = row.querySelector(`#badge-${symbol}`);
      badge.className = "row-badge error";
      badge.textContent = t("loadError");
      return;
    }
    const info = badgeInfo(result.status, result.leadingDirection);
    const badge = row.querySelector(`#badge-${symbol}`);
    badge.className = "row-badge " + info.cls;
    badge.textContent = info.text;
    row.classList.remove("strong-long", "strong-short", "watch-long", "watch-short", "locked-symbol");
    if (info.cls.startsWith("strong-") || info.cls.startsWith("watch-")) row.classList.add(info.cls);
    if (State.lock && State.lock.symbol === symbol) row.classList.add("locked-symbol");

    const symEl = row.querySelector(`.row-sym`);
    symEl.textContent = (State.lock && State.lock.symbol === symbol ? "\uD83D\uDD12 " : "") + symbol;

    // 가격 데이터가 비정상(NaN/0 이하 등)이면 formatPrice()가 "-"를 반환한다 —
    // 신호 계산에 쓰인 것과 동일한 result.price를 그대로 표시하므로 값이 서로 어긋나지 않는다.
    row.querySelector(`#price-${symbol}`).textContent = formatPrice(result.price);
    const leadScore = result.leadingDirection === "short" ? result.short.score : result.long.score;
    row.querySelector(`#score-${symbol}`).textContent = t("score") + " " + leadScore;
  }

  function removeRow(symbol) {
    const row = document.getElementById("row-" + symbol);
    if (row) row.remove();
  }

  function maybeShowEmpty() {
    const list = document.getElementById("list");
    const cat = State.view === "stock" ? "stock" : "coin";
    const syms = State.symbolsInCategory(cat);
    // 전체 종목이 아니라 "현재 카테고리 페이지"의 종목 수로 판단한다
    if (syms.length === 0) {
      if (!list.querySelector(".empty")) list.innerHTML = `<div class="empty">${t("empty")}</div>`;
      return;
    }
    // 종목은 있지만 전부 스와이프로 치운 경우: 되돌릴 수 있다는 것을 알려준다.
    const allDismissed = syms.every((s) => State.dismissed && State.dismissed[s]);
    if (allDismissed && !list.querySelector(".empty")) {
      list.innerHTML = `<div class="empty">${t("allDismissed")}<br><button type="button" class="restore-btn" id="restoreDismissedBtn">${t("restoreDismissed")}</button></div>`;
      const btn = document.getElementById("restoreDismissedBtn");
      if (btn) btn.addEventListener("click", () => restoreDismissed());
    }
  }

  /* 스와이프로 치운 카드를 다시 보이게 한다(표시 상태만 되돌림).
     화면 전환 시에도 자동으로 호출되어, 다른 화면에 갔다 오면 카드가 복원된다. */
  function restoreDismissed(category) {
    if (!State.dismissed) return;
    if (category) {
      State.symbols.forEach((sym) => {
        if (State.getCategory(sym) === category) delete State.dismissed[sym];
      });
    } else {
      State.dismissed = {};
    }
    renderCategoryList();
  }

  /* ---------------- Detail view ---------------- */
  let detailSymbol = null;

  function openDetail(symbol) {
    detailSymbol = symbol;
    document.getElementById("detailSym").textContent = symbol;
    document.getElementById("detailView").classList.add("open");
    renderDetail(symbol);
  }
  function closeDetail() {
    detailSymbol = null;
    document.getElementById("detailView").classList.remove("open");
  }

  function conditionRow(label, met, points) {
    return `<div class="cond-item ${met ? "met" : ""}">
      <span class="cond-mark">${met ? "\u2713" : "\u2014"}</span>
      <span class="cond-label">${label}</span>
      <span class="cond-pts">${met ? "+" + points : "0"}</span>
    </div>`;
  }

  function renderScorePanel(result) {
    const dir = result.leadingDirection;
    const dirData = dir === "short" ? result.short : result.long;
    const info = badgeInfo(result.status, dir);

    const badge = document.getElementById("detailBadge");
    badge.className = "badge-lg " + info.cls;
    badge.textContent = info.text + (dir ? " \u00b7 " + t("score") + " " + dirData.score : "");

    const W = CONFIG.SCORE_WEIGHTS;
    const c = dirData.conditions;
    document.getElementById("detailConditions").innerHTML = [
      conditionRow(t("cond_trend15"), c.trend15, W.trend15),
      conditionRow(t("cond_trend5"), c.trend5, W.trend5),
      conditionRow(t("cond_ha1Flip"), c.ha1Flip, W.ha1Flip),
      conditionRow(t("cond_macdCross"), c.macdCross, W.macdCross),
    ].join("");

    // 참고용: 반대 방향 점수도 작게 표시 (LONG/SHORT 동일 구조로 계산되었음을 보여줌)
    document.getElementById("detailBothScores").textContent =
      `${t("longScore")} ${result.long.score} \u00b7 ${t("shortScore")} ${result.short.score}`;

    // 자가학습 신뢰도 — 기존 신호(LONG/SHORT·점수·배지)는 전혀 바꾸지 않고, 추가 정보로만 표시한다.
    const learnEl = document.getElementById("detailLearnInfo");
    if (learnEl && dir) {
      if (!root.PatternLearn.isEnabled()) {
        learnEl.textContent = t("learnOffNotice");
      } else {
        const category = State.getCategory(result.symbol);
        const key = root.PatternLearn.buildPatternKey(category, result.symbol, dir, dirData.conditions);
        const info = root.PatternLearn.getPatternInfo(key);
        if (info.total === 0) {
          learnEl.textContent = t("learnNoData");
        } else if (info.confidence == null) {
          learnEl.textContent = tp("learnInsufficient", { total: info.total });
        } else {
          const label = info.confidence >= CONFIG.LEARN_CONFIDENCE_THRESHOLD ? t("learnHigh") : t("learnLow");
          learnEl.textContent = tp("learnConfidenceText", {
            label,
            pct: (info.confidence * 100).toFixed(0),
            total: info.total,
          });
        }
      }
    }
  }

  /* ---------------- Volume Profile 카드 (10단계, 관찰 전용) ----------------
     이미 받아둔 result.tf의 klines만 읽어서 계산한다(추가 요청 없음).
     신호 점수·방향·신뢰도·필터·알림에는 전혀 영향을 주지 않는다. */
  function vpPositionLabel(r) {
    if (r.valueAreaPosition === "above") return t("vpAboveVA");
    if (r.valueAreaPosition === "below") return t("vpBelowVA");
    return t("vpInsideVA");
  }

  function vpScaleBar(r) {
    // 프로파일 전체 범위(저가~고가) 위에 VAL·POC·VAH·현재가를 비율로 배치한다.
    const lo = r.profileLow, hi = r.profileHigh;
    const span = hi - lo;
    if (!(span > 0)) return "";
    const pct = (v) => Math.max(0, Math.min(100, ((v - lo) / span) * 100));
    const vaLeft = pct(r.val);
    const vaWidth = Math.max(1, pct(r.vah) - vaLeft);
    return `<div class="vp-bar">
      <div class="vp-bar-va" style="left:${vaLeft}%;width:${vaWidth}%"></div>
      <div class="vp-bar-poc" style="left:${pct(r.poc)}%"></div>
      <div class="vp-bar-price" style="left:${pct(r.currentPrice)}%"></div>
    </div>`;
  }

  /* Wyckoff 한 줄 요약 (같은 타임프레임의 Volume Profile과 함께 표시) */
  function wyBlock(w) {
    if (!w) return `<div class="wy-row"><span class="wy-k">Wyckoff</span><span class="vp-empty">${t("vpNoData")}</span></div>`;
    const phaseKey = "wyPhase_" + w.phase;
    const eventKey = "wyEvent_" + w.event;
    const pos = Number.isFinite(w.pricePositionRaw)
      ? (w.pricePositionRaw > 1 ? t("wyAboveRange") : w.pricePositionRaw < 0 ? t("wyBelowRange") : `${Math.round(w.pricePositionInRange * 100)}%`)
      : "-";
    const confClass = w.confidence >= 65 ? "high" : w.confidence >= 45 ? "mid" : "low";
    return `<div class="wy-row">
      <span class="wy-phase ${w.phase.toLowerCase()}">${t(phaseKey)}</span>
      ${w.event !== "NONE" ? `<span class="wy-event">${t(eventKey)}</span>` : ""}
      <span class="wy-conf ${confClass}">${w.confidence}</span>
      <span class="wy-pos">${t("wyRangePos")} ${pos}</span>
    </div>
    <div class="wy-meta">${t("wyVolume")} ${t("wyVol_" + w.volumeTrend)} \u00b7 ${t("wyEffort")} ${t("wyEff_" + w.effortVsResult)}</div>`;
  }

  function vpBlock(label, r, w) {
    if (!r) {
      return `<div class="vp-tf"><div class="vp-tf-head">${label}</div>
        ${wyBlock(w)}
        <div class="vp-empty">Volume Profile ${t("vpNoData")}</div></div>`;
    }
    const posClass = r.valueAreaPosition === "above" ? "up" : r.valueAreaPosition === "below" ? "down" : "";
    const pocDir = r.pricePosition === "above" ? t("vpAbovePOC") : r.pricePosition === "below" ? t("vpBelowPOC") : t("vpAtPOC");
    const dist = Number.isFinite(r.pocDistancePercent)
      ? `${r.pocDistancePercent >= 0 ? "+" : ""}${r.pocDistancePercent.toFixed(2)}%`
      : "-";
    const distr = r.distribution
      ? t(r.distribution.state === "concentrated" ? "vpConcentrated" : r.distribution.state === "dispersed" ? "vpDispersed" : "vpBalanced")
      : "-";
    return `<div class="vp-tf">
      <div class="vp-tf-head">${label}<span class="vp-pos ${posClass}">${vpPositionLabel(r)}</span></div>
      ${vpScaleBar(r)}
      <div class="vp-grid">
        <div class="vp-item"><span class="vp-k">${t("vpCurrent")}</span><span class="vp-v">${formatPrice(r.currentPrice)}</span></div>
        <div class="vp-item"><span class="vp-k">POC</span><span class="vp-v poc">${formatPrice(r.poc)}</span></div>
        <div class="vp-item"><span class="vp-k">VAH</span><span class="vp-v">${formatPrice(r.vah)}</span></div>
        <div class="vp-item"><span class="vp-k">VAL</span><span class="vp-v">${formatPrice(r.val)}</span></div>
      </div>
      <div class="vp-meta">${pocDir} ${dist} \u00b7 ${t("vpDistribution")} ${distr}</div>
      ${wyBlock(w)}
    </div>`;
  }

  function renderVolumeProfile(symbol, result) {
    const card = document.getElementById("vpCard");
    if (!card || !root.VolumeProfile) return;
    let vp = null;
    try {
      vp = result && result.tf
        ? root.VolumeProfile.analyzeTimeframes(result.tf, { currentPrice: result.price })
        : null;
    } catch (e) {
      console.error("volume profile failed", e);
      vp = null;
    }
    // Wyckoff도 같은 캔들로 계산한다(표시 전용 — 신호/점수/알림에는 사용하지 않음).
    let wy = null;
    try {
      wy = root.Wyckoff && result && result.tf
        ? root.Wyckoff.analyzeTimeframes(result.tf, { currentPrice: result.price, includeAux: false })
        : null;
    } catch (e) {
      console.error("wyckoff failed", e);
      wy = null;
    }
    const hasVp = vp && (vp["15m"] || vp["5m"]);
    const hasWy = wy && (wy["15m"] || wy["5m"]);
    if (!hasVp && !hasWy) {
      card.style.display = "none";
      return;
    }
    vp = vp || {};
    wy = wy || {};
    card.style.display = "";
    document.getElementById("vpBody").innerHTML =
      vpBlock("15m", vp["15m"], wy["15m"]) + vpBlock("5m", vp["5m"], wy["5m"]) +
      `<div class="vp-legend"><span class="lg-va"></span>Value Area <span class="lg-poc"></span>POC <span class="lg-price"></span>${t("vpCurrent")}</div>`;
  }

  /* ---------------- 종합 신뢰도 카드 (7단계) ----------------
     신호 품질 + 과거 성능 + 유사 패턴 + 시장 상태를 결합한 보조 지표.
     기존 신호 점수(80/100)와는 별개이며, 점수를 대체하거나 덮어쓰지 않는다. */
  function confTierClass(v) {
    if (!Number.isFinite(v)) return "none";
    if (v >= 75) return "high";
    if (v >= 55) return "mid";
    return "low";
  }

  function confRow(labelKey, value, extra) {
    const txt = Number.isFinite(value) ? value.toFixed(0) + "%" : t("noLearnDataYet");
    return `<div class="conf-item"><span class="conf-k">${t(labelKey)}</span>` +
           `<span class="conf-v">${txt}${extra ? ` <em>${extra}</em>` : ""}</span></div>`;
  }

  function renderConfidenceCard(symbol, result) {
    const card = document.getElementById("confCard");
    if (!card) return;
    const report = result && result.confidenceReport;
    const c = report && report.composite;
    // 종합 신뢰도를 계산할 자료가 없으면 카드를 숨긴다(빈 값 표시 대신).
    if (!c || !Number.isFinite(c.confidence)) {
      card.style.display = "none";
      return;
    }
    card.style.display = "";

    const valueEl = document.getElementById("confValue");
    valueEl.textContent = c.confidence.toFixed(0) + "%";
    valueEl.className = "conf-value " + confTierClass(c.confidence);

    const fill = document.getElementById("confBarFill");
    if (fill) {
      fill.style.width = Math.max(0, Math.min(100, c.confidence)) + "%";
      fill.className = "conf-bar-fill " + confTierClass(c.confidence);
    }

    // 각 요소를 분리해서 보여준다(어떤 근거로 나온 값인지 알 수 있게)
    document.getElementById("confBreakdown").innerHTML =
      confRow("confSignalQuality", c.signalQuality) +
      confRow("confHistorical", c.historicalWinRate) +
      confRow("confSimilar", Number.isFinite(c.similarityWeightedWinRate) ? c.similarityWeightedWinRate : c.similarWinRate,
        c.similarCount > 0 ? `${c.similarCount}${t("countSuffix")}` : "") +
      confRow("confMarketAlign", c.marketAlignment);

    // 표본이 부족하면 참고용임을 명확히 알린다(과신 방지).
    const note = document.getElementById("confNote");
    if (note) {
      note.textContent = c.enough ? t("confNoteEnough") : t("confNoteInsufficient");
    }
  }

  /* ---------------- 유사 패턴 비교 (요구사항 6·7) ----------------
     "전체 점수 승률"과 "현재 패턴과 유사한 과거 신호 승률"을 나란히 보여준다.
     이미 구현된 PatternLearn.getScorePerf()와 PatternSimilarity를 그대로 사용하며,
     새로운 통계를 만들지 않는다. 알림/점수/필터에는 전혀 영향을 주지 않는 표시 전용이다. */
  function renderSimilarityCompare(symbol, result) {
    const card = document.getElementById("simCompareCard");
    if (!card) return;

    const dir = result && result.leadingDirection;
    const dirData = dir === "long" ? result.long : dir === "short" ? result.short : null;
    // 추적 대상 점수(80/100)의 신호가 아니면 카드를 숨긴다.
    if (!dir || !dirData || !CONFIG.SCORE_PERF_TRACK.includes(dirData.score)) {
      card.style.display = "none";
      return;
    }

    const category = State.getCategory(symbol);
    const market = root.PatternLearn.marketOf(category);
    const score = dirData.score;

    // ① 같은 시장·점수·방향의 전체 성적 (이미 있는 함수 재사용)
    let all;
    try {
      all = root.PatternLearn.getScorePerf(market, score, dir);
    } catch (e) {
      card.style.display = "none";
      return;
    }

    // ② 현재 패턴과 유사한 과거 신호의 성적
    // 현재 신호를 snapshot 형식으로 만들어 유사도 비교에 넘긴다(저장하지 않음).
    let sim = null;
    try {
      const signalTime = (result.entryTimes && result.entryTimes["1m"]) || result.updatedAt;
      const item = {
        signalId: `live:${symbol}:${dir}:${score}:${signalTime}`,
        symbol, category, direction: dir, score,
        signalTime, entryTime: result.updatedAt, entryPrice: result.price,
        conditions: dirData.conditions, patternKey: null,
      };
      const current = root.PatternSnapshot.buildSnapshot(item, result.tf);
      if (current) sim = root.PatternSimilarity.getSimilarityStats(current, { minSimilarity: CONFIG.SIM_ADJUST_MIN_SIMILARITY });
    } catch (e) {
      console.error("similarity compare failed", e);
      sim = null;
    }

    card.style.display = "";
    const dirLabel = dir === "long" ? t("long") : t("short");
    document.getElementById("simAllLabel").textContent =
      tp("simAllLabel", { score: score + t("pointSuffix"), direction: dirLabel });

    // 전체 성적: 표본이 부족하면 승률 대신 "데이터 부족"
    const allValue = document.getElementById("simAllValue");
    if (all.total === 0) {
      allValue.textContent = t("noLearnDataYet");
    } else if (!all.enough) {
      allValue.textContent = `${t("dataShortLabel")} \u00b7 ${all.total}${t("countSuffix")}`;
    } else {
      allValue.textContent = `${all.winRate.toFixed(0)}% \u00b7 ${all.wins}W/${all.losses}L \u00b7 ${all.total}${t("countSuffix")}`;
    }

    // 유사 패턴 성적
    const simValue = document.getElementById("simSimilarValue");
    const badge = document.getElementById("simCompareBadge");
    const note = document.getElementById("simCompareNote");
    if (!sim || sim.comparedCount === 0) {
      simValue.textContent = t("noSimilarPatterns");
      badge.textContent = t("simNoSample");
      badge.className = "sim-compare-badge neutral";
      note.textContent = t("simCompareNoteEmpty");
      return;
    }

    const simRate = sim.similarityWeightedWinRate;
    const wins = sim.winCount;
    const losses = sim.lossCount;
    if (!sim.enough || !Number.isFinite(simRate)) {
      simValue.textContent = `${t("dataShortLabel")} \u00b7 ${sim.comparedCount}${t("countSuffix")}`;
      badge.textContent = t("simNoSample");
      badge.className = "sim-compare-badge neutral";
    } else {
      simValue.textContent = `${simRate.toFixed(0)}% \u00b7 ${wins}W/${losses}L \u00b7 ${sim.comparedCount}${t("countSuffix")}`;
      // 전체 대비 유사 패턴이 더 좋은지/나쁜지 배지로 표시 (둘 다 표본이 충분할 때만)
      if (all.enough && Number.isFinite(all.winRate)) {
        const delta = simRate - all.winRate;
        const sign = delta >= 0 ? "+" : "";
        badge.textContent = `${sign}${delta.toFixed(0)}%p`;
        badge.className = "sim-compare-badge " + (delta > 5 ? "up" : delta < -5 ? "down" : "neutral");
      } else {
        badge.textContent = t("simNoSample");
        badge.className = "sim-compare-badge neutral";
      }
    }
    note.textContent = tp("simCompareNote", {
      similarity: Number.isFinite(sim.averageSimilarity) ? sim.averageSimilarity.toFixed(0) : "-",
      min: CONFIG.SIM_ADJUST_MIN_SIMILARITY,
    });
  }

  /* ---------------- 차트 안전 렌더 헬퍼 ----------------
     캔버스가 DOM에 없거나(화면 미생성), 데이터가 비었거나, 그리는 중 예외가 나도
     앱 전체가 멈추지 않도록 감싼다. 실패는 콘솔에만 남기고 다음 폴링에서 다시 시도된다. */
  function safeDraw(fn) {
    try {
      fn();
    } catch (e) {
      console.error("chart draw failed", e);
    }
  }

  function clearDetailCharts() {
    ["detailChartPrice", "detailChartMacd", "detailChartRsi"].forEach((id) => {
      const canvas = document.getElementById(id);
      if (!canvas || typeof canvas.getContext !== "function") return;
      safeDraw(() => {
        const ctx = canvas.getContext("2d");
        if (ctx && canvas.width > 0 && canvas.height > 0) ctx.clearRect(0, 0, canvas.width, canvas.height);
      });
    });
  }

  function renderChartsForTab(symbol, result, tf) {
    // 방어: result.tf 또는 해당 타임프레임 데이터가 아직 없을 수 있다.
    // (부분 로딩, 늦게 도착하는 응답, 빈 응답 등) 이때 예외가 나면 상세 화면 전체가
    // 멈추므로, 안전하게 "-"만 표시하고 다음 폴링에서 다시 그려지도록 한다.
    const d = result && result.tf ? result.tf[tf] : null;
    const hasCandles = d && Array.isArray(d.klines) && d.klines.length > 0 && Array.isArray(d.ha) && d.ha.length > 0;

    if (!hasCandles) {
      clearDetailCharts();
      ["tfTrend", "tfDif", "tfDea", "tfRsi"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
          el.textContent = "-";
          el.className = "v";
        }
      });
      return;
    }

    // 차트는 각각 독립적으로 그린다 — 하나가 실패해도 나머지와 아래 지표 표시는 유지된다.
    const markers = root.SignalLog.getMarkersForSymbolTf(symbol, tf);
    safeDraw(() => root.Charts.drawPriceChart(document.getElementById("detailChartPrice"), d.klines, d.ha, 80, markers));
    safeDraw(() => root.Charts.drawMacdChart(document.getElementById("detailChartMacd"), d.macd, 80));
    safeDraw(() => root.Charts.drawRsiChart(document.getElementById("detailChartRsi"), d.rsi, 80));

    const last = d.ha.length - 1;
    document.getElementById("tfTrend").textContent = d.ha[last].bullish ? t("bullish") : t("bearish");
    document.getElementById("tfTrend").className = "v " + (d.ha[last].bullish ? "bull" : "bear");
    document.getElementById("tfDif").textContent = formatNum(d.macd.dif[last]);
    document.getElementById("tfDea").textContent = formatNum(d.macd.dea[last]);
    document.getElementById("tfRsi").textContent = formatNum(d.rsi[last]);
  }

  function renderTfTabs() {
    document.querySelectorAll(".tf-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tf === State.detailTab);
    });
  }

  function pctChange(base, val) {
    return root.LockRange.pctChange(base, val);
  }
  function pctText(base, val) {
    const p = pctChange(base, val);
    if (p == null) return "-";
    return (p >= 0 ? "+" : "") + p.toFixed(2) + "%";
  }
  function pctCls(base, val) {
    const p = pctChange(base, val);
    if (p == null) return "";
    return p >= 0 ? "up" : "down";
  }
  // 이미 계산된 퍼센트 값(예: LockRange.confirm()이 저장해둔 maxPnlPercent)을 표시용으로 포맷
  function pctFromValue(p) {
    if (p == null || !Number.isFinite(p)) return "-";
    return (p >= 0 ? "+" : "") + p.toFixed(2) + "%";
  }
  function pctClsFromValue(p) {
    if (p == null || !Number.isFinite(p)) return "";
    return p >= 0 ? "up" : "down";
  }

  function renderLockPanel(symbol, result) {
    const btn = document.getElementById("lockBtn");
    const recordBtn = document.getElementById("recordStartBtn");
    const display = document.getElementById("lockDisplay");
    const isLocked = State.lock && State.lock.symbol === symbol;
    const isRecording = State.recording && State.recording.symbol === symbol;

    btn.classList.toggle("on", isLocked);
    btn.classList.toggle("off", !isLocked);
    btn.textContent = isLocked ? t("unlock") : t("lockIn");

    // "기록" 버튼: LOCK된 상태에서만 활성화되고, 이미 기록 중이면 다시 누를 수 없다 (요구사항 2).
    recordBtn.style.display = isLocked ? "" : "none";
    recordBtn.disabled = !isLocked || isRecording;
    recordBtn.textContent = isRecording ? t("recording") : t("startRecording");
    recordBtn.classList.toggle("active", isRecording);

    if (isRecording) {
      // 기록 시작 ~ 현재까지: 가격과 손익률을 함께 실시간으로 갱신한다.
      // 손익률은 항상 기록 시작가(recording.basePrice) 기준으로 계산한다.
      const rec = State.recording;
      const curPrice = result ? result.price : null;
      // 요구사항 3: "LONG ×10 | +15.2%" 형식. 레버리지는 여기서만 적용(중복 적용 방지) —
      // 구간 최고/최저 손익률(아래 두 줄)은 기존 그대로 레버리지 미적용 원본 값이다.
      const rawPct = root.LockRange.pctChange(rec.basePrice, curPrice);
      const levPct = rawPct == null ? null : rawPct * (rec.leverage || 1) * (rec.direction === "short" ? -1 : 1);
      const dirLabel = rec.direction === "short" ? t("short") : t("long");
      const levText = `${dirLabel} \u00d7${rec.leverage || 1} | ${pctFromValue(levPct)}`;
      display.innerHTML = `
        <div class="lock-live">
          <div class="lock-row"><span>\uD83D\uDCCB ${t("recordStartPrice")}</span><b>${formatPrice(rec.basePrice)}</b></div>
          <div class="lock-row"><span>${t("currentPrice")}</span><b>${formatPrice(curPrice)}</b></div>
          <div class="lock-row"><span>${t("currentPnl")}</span><b class="pct ${pctClsFromValue(levPct)}">${levText}</b></div>
          <div class="lock-row"><span>\uD83D\uDCC8 ${t("rangeHigh")}</span><b>${formatPrice(rec.high)}</b></div>
          <div class="lock-row"><span>${t("rangeHighPnl")}</span><b class="pct ${pctCls(rec.basePrice, rec.high)}">${pctText(rec.basePrice, rec.high)}</b></div>
          <div class="lock-row"><span>\uD83D\uDCC9 ${t("rangeLow")}</span><b>${formatPrice(rec.low)}</b></div>
          <div class="lock-row"><span>${t("rangeLowPnl")}</span><b class="pct ${pctCls(rec.basePrice, rec.low)}">${pctText(rec.basePrice, rec.low)}</b></div>
        </div>
        <div class="lock-notice">${t("lockNotice")}</div>
      `;
    } else if (isLocked) {
      // LOCK만 된 상태 (기록 전) — 락인 가격만 보여주고 최고/최저/손익률은 아직 추적하지 않는다.
      display.innerHTML = `
        <div class="lock-live">
          <div class="lock-row"><span>\uD83D\uDD12 ${t("lockPriceLabel")}</span><b>${formatPrice(State.lock.basePrice)}</b></div>
        </div>
        <div class="lock-notice">${t("waitingToRecord")}</div>
      `;
    } else {
      display.innerHTML = "";
    }
  }

  function renderDetail(symbol) {
    if (detailSymbol !== symbol) return;
    const result = State.data[symbol];
    const hasError = !!State.errors[symbol];

    if (!result || hasError) {
      // 가격/신호 데이터가 없거나 오류 상태면 잘못된(오래된) 값 대신 전부 "-"로 표시한다.
      document.getElementById("detailPrice").textContent = "-";
      document.getElementById("detailUpdated").textContent = hasError ? t("loadError") : "-";
      const badge = document.getElementById("detailBadge");
      badge.className = "badge-lg error";
      badge.textContent = t("loadError");
      document.getElementById("detailBothScores").textContent = "-";
      document.getElementById("detailConditions").innerHTML = "";
      ["tfTrend", "tfDif", "tfDea", "tfRsi"].forEach((id) => {
        const el = document.getElementById(id);
        el.textContent = "-";
        el.className = "v";
      });
      renderLockPanel(symbol, result || null);
      return;
    }

    document.getElementById("detailPrice").textContent = formatPrice(result.price);
    document.getElementById("detailUpdated").textContent = t("updated") + ": " + new Date(result.updatedAt).toLocaleTimeString();

    renderScorePanel(result);
    renderVolumeProfile(symbol, result);
    renderConfidenceCard(symbol, result);
    renderSimilarityCompare(symbol, result);
    renderLockPanel(symbol, result);
    renderTfTabs();
    renderChartsForTab(symbol, result, State.detailTab);
  }

  /* ---------------- Toast (즉시 화면 알림) ---------------- */
  /* 신호 알림(화면 위에 크게 뜨는 카드)을 스와이프로 치울 수 있게 한다.
     중요: 이건 "화면 표시만" 닫는 것이다. 알림 카드는 DOM 요소일 뿐이므로
     제거해도 신호 데이터·학습 데이터·신호 기록·종목 목록에 전혀 영향이 없다.
     (이 함수는 어떤 삭제 함수도 호출하지 않는다) */
  function attachToastDismiss(el, autoTimer) {
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let swiping = false;
    let decided = false;
    let closed = false;

    const close = (direction) => {
      if (closed) return;
      closed = true;
      if (autoTimer) clearTimeout(autoTimer); // 자동 닫기 타이머 정리
      el.style.transition = "transform 0.18s ease, opacity 0.18s ease";
      if (direction) {
        el.style.transform = `translateX(${direction > 0 ? "110%" : "-110%"})`;
      } else {
        // 위로 치우기(탭/기본 닫기)
        el.style.transform = "translateY(-120%)";
      }
      el.style.opacity = "0";
      // DOM에서만 제거한다 — 데이터는 건드리지 않는다.
      setTimeout(() => el.remove(), 190);
    };

    el.addEventListener("touchstart", (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dx = 0;
      swiping = false;
      decided = false;
      el.style.transition = "";
    }, { passive: true });

    el.addEventListener("touchmove", (e) => {
      if (closed || !e.touches || e.touches.length !== 1) return;
      const mx = e.touches[0].clientX - startX;
      const my = e.touches[0].clientY - startY;
      if (!decided) {
        // 위로 미는 동작도 닫기로 인정한다(알림을 위로 밀어 없애는 흔한 동작)
        if (Math.abs(mx) > 8 || my < -8) {
          decided = true;
          swiping = true;
        } else if (Math.abs(my) > 8) {
          decided = true;
          swiping = false;
          return;
        } else {
          return;
        }
      }
      if (!swiping) return;
      dx = mx;
      const drift = Math.abs(mx) > Math.abs(my) ? `translateX(${mx}px)` : `translateY(${Math.min(my, 0)}px)`;
      const dist = Math.max(Math.abs(mx), Math.abs(Math.min(my, 0)));
      el.style.transform = drift;
      el.style.opacity = String(1 - Math.min(dist / 140, 0.6));
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    const finish = (e) => {
      if (closed || !swiping) { decided = false; return; }
      const my = e && e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY - startY : 0;
      if (Math.abs(dx) >= 70) {
        close(dx > 0 ? 1 : -1);      // 좌우로 충분히 밀면 닫기
      } else if (my <= -60) {
        close(0);                     // 위로 충분히 밀면 닫기
      } else {
        // 조금만 움직였으면 원위치
        el.style.transition = "transform 0.18s ease, opacity 0.18s ease";
        el.style.transform = "";
        el.style.opacity = "";
        setTimeout(() => { el.style.transition = ""; }, 200);
      }
      swiping = false;
      decided = false;
      dx = 0;
    };
    el.addEventListener("touchend", finish, { passive: true });
    el.addEventListener("touchcancel", () => {
      if (!closed && swiping) { el.style.transform = ""; el.style.opacity = ""; }
      swiping = false; decided = false; dx = 0;
    }, { passive: true });

    // 마우스/데스크톱과 접근성을 위해 탭(클릭)으로도 닫을 수 있게 한다.
    el.addEventListener("click", () => close(0));

    return close;
  }

  function showToast(symbol, direction, score, detail) {
    const box = document.getElementById("toastBox");
    const el = document.createElement("div");
    el.className = "toast " + direction;
    const label = direction === "long" ? t("watchLong") : t("watchShort");
    if (detail && Array.isArray(detail.detailLines) && detail.detailLines.length) {
      // 상세 정보가 있으면 점수·가격·타임프레임 상태·신뢰도까지 함께 보여준다.
      const lines = detail.detailLines.map((line) => `<span class="toast-line">${line}</span>`).join("");
      el.innerHTML = `<strong>${symbol}</strong> ${label}<div class="toast-detail">${lines}</div>` +
        `<span class="toast-hint">${t("toastDismissHint")}</span>`;
    } else {
      // 기존 동작 (상세 정보가 없을 때)
      el.innerHTML = `<strong>${symbol}</strong> ${label}<br><span>${t("score")}: ${score}</span>`;
    }
    box.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    // 읽을 내용이 많아졌으므로 상세 표시일 때는 조금 더 오래 보여준다.
    const duration = detail && detail.detailLines && detail.detailLines.length > 3 ? 8000 : 5000;
    const autoTimer = setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 300);
    }, duration);
    // 스와이프/탭으로 즉시 치울 수 있게 한다(표시 상태만 닫힘 — 데이터 영향 없음)
    attachToastDismiss(el, autoTimer);
    return el;
  }

  /* ---------------- Menu (☰) / view switch ---------------- */
  function toggleMenu(forceOpen) {
    const dd = document.getElementById("menuDropdown");
    if (typeof forceOpen === "boolean") dd.classList.toggle("open", forceOpen);
    else dd.classList.toggle("open");
  }

  function switchView(view) {
    State.view = view;
    const isCategoryPage = view === "coin" || view === "stock";
    document.getElementById("list").style.display = isCategoryPage ? "" : "none";
    document.getElementById("recordsView").classList.toggle("open", view === "records");
    document.getElementById("performanceView").classList.toggle("open", view === "performance");
    document.getElementById("menuCoinBtn").classList.toggle("active", view === "coin");
    document.getElementById("menuStockBtn").classList.toggle("active", view === "stock");
    document.getElementById("menuRecordsBtn").classList.toggle("active", view === "records");
    document.getElementById("menuPerfBtn").classList.toggle("active", view === "performance");
    // 상단 브랜드 제목을 현재 페이지 이름으로 바꿔서 지금 어느 시장을 보고 있는지 명확히 한다.
    const brandTitle = document.querySelector(".brand h1");
    if (brandTitle) {
      brandTitle.textContent =
        view === "stock" ? t("stockFutures")
        : view === "records" ? t("menuRecords")
        : view === "performance" ? t("menuPerformance")
        : t("coinFutures");
    }
    const pageLabel = document.getElementById("currentPageLabel");
    if (pageLabel) pageLabel.textContent = view === "stock" ? t("stockFutures") : t("coinFutures");
    if (isCategoryPage) {
      // 화면을 다시 열면 스와이프로 치웠던 카드를 복원한다(표시 상태만 되돌림).
      if (State.dismissed) {
        State.symbols.forEach((sym) => {
          if (State.getCategory(sym) === view) delete State.dismissed[sym];
        });
      }
      renderCategoryList(); // 이 카테고리의 종목만 다시 그린다(목록 섞임 방지)
    }
    if (view === "records") renderRecordsView();
    if (view === "performance") renderPerformanceView();
    renderChips();
    renderLearnPanel(); // 학습 통계도 현재 시장 기준으로 다시 계산(페이지 전환 시 이전 시장 숫자가 남지 않도록)
    toggleMenu(false);
  }

  // 현재 카테고리 페이지에 속한 종목만 신호 목록에 표시한다 (다른 카테고리 행은 DOM에서 제거).
  function renderCategoryList() {
    const cat = State.view === "stock" ? "stock" : "coin";
    const list = document.getElementById("list");
    // 이 카테고리에 속하지 않은 기존 행을 제거
    State.symbols.forEach((sym) => {
      if (State.getCategory(sym) !== cat) removeRow(sym);
    });
    const syms = State.symbolsInCategory(cat);
    if (syms.length === 0) {
      list.innerHTML = `<div class="empty">${t("empty")}</div>`;
      return;
    }
    const emptyEl = list.querySelector(".empty");
    if (emptyEl) emptyEl.remove();
    syms.forEach((sym) => {
      if (State.data[sym]) renderRow(sym, State.data[sym], !!State.errors[sym]);
      else ensureRow(sym);
    });
  }

  /* ---------------- Records view ("내 기록") ---------------- */
  function fmtTime(ts) {
    return ts ? new Date(ts).toLocaleString() : "-";
  }

  function tradeCard(trade) {
    const dirCls = trade.direction;
    const dirLabel = trade.direction === "long" ? t("long") : t("short");
    const isOpen = trade.status === "open";
    const pnlCls = trade.win === true ? "up" : trade.win === false ? "down" : "";
    const pnlText = isOpen ? "-" : (trade.pnlPercent >= 0 ? "+" : "") + trade.pnlPercent.toFixed(2) + "%";
    const amtText = isOpen ? "-" : (trade.pnlAmount >= 0 ? "+" : "") + trade.pnlAmount.toFixed(2) + " USDT";

    return `
      <div class="trade-card" data-id="${trade.id}">
        <div class="trade-top">
          <div><span class="trade-sym">${trade.symbol}</span> <span class="trade-dir ${dirCls}">${dirLabel}</span></div>
          ${isOpen ? `<span class="trade-status-open">${t("open")}</span>` : `<span class="trade-pnl ${pnlCls}">${pnlText}</span>`}
        </div>
        <div class="trade-grid">
          <div>${t("entryPrice")}: <b>${formatPrice(trade.entryPrice)}</b></div>
          <div>${t("exitPrice")}: <b>${isOpen ? "-" : formatPrice(trade.exitPrice)}</b></div>
          <div>${t("entryTime")}: <b>${fmtTime(trade.entryTime)}</b></div>
          <div>${t("exitTime")}: <b>${isOpen ? "-" : fmtTime(trade.exitTime)}</b></div>
          ${!isOpen ? `<div>${t("pnlAmount")}: <b class="${pnlCls}">${amtText}</b></div>` : ""}
        </div>
        <div class="trade-actions">
          ${isOpen ? `<button class="ghost-btn" data-action="close-trade" data-id="${trade.id}">${t("recordExit")}</button>` : ""}
          ${!isOpen && trade.win === false ? `<button class="ghost-btn" data-action="analyze-trade" data-id="${trade.id}">${t("analyze")}</button>` : ""}
        </div>
      </div>`;
  }

  function lockRecordCard(r) {
    const dirLabel = r.direction === "short" ? t("short") : t("long");
    // finalPnlPercent(레버리지 반영)가 없는 예전 기록은 endPnlPercent(비레버리지)로 대체 표시
    const finalPnl = r.finalPnlPercent != null ? r.finalPnlPercent : r.endPnlPercent;
    const leverage = r.leverage || 1;
    return `
      <div class="trade-card" data-id="${r.id}">
        <div class="trade-top">
          <div><span class="trade-sym">${r.symbol}</span> <span class="trade-dir ${r.direction}">${dirLabel}</span> <span class="trade-dir lev">${leverage}x</span></div>
          <span class="trade-pnl ${pctClsFromValue(finalPnl)}">${pctFromValue(finalPnl)}</span>
        </div>
        <div class="trade-grid">
          <div>${t("recordStartTime")}: <b>${fmtTime(r.recordStartAt || r.lockedAt)}</b></div>
          <div>${t("recordEndTime")}: <b>${fmtTime(r.recordEndAt || r.unlockedAt)}</b></div>
          <div>${t("lockPriceLabel")}: <b>${formatPrice(r.basePrice)}</b></div>
          <div>${t("recordStartPrice")}: <b>${formatPrice(r.startPrice)}</b></div>
          <div>${t("recordEndPrice")}: <b>${formatPrice(r.endPrice)}</b></div>
          <div>${t("rangeHighLabel")}: <b>${formatPrice(r.high)}</b></div>
          <div>${t("rangeLowLabel")}: <b>${formatPrice(r.low)}</b></div>
          <div>${t("maxPnlLabel")}: <b class="${pctClsFromValue(r.maxPnlPercent)}">${pctFromValue(r.maxPnlPercent)}</b></div>
          <div>${t("minPnlLabel")}: <b class="${pctClsFromValue(r.minPnlPercent)}">${pctFromValue(r.minPnlPercent)}</b></div>
          <div>${t("leverageLabel")}: <b>${leverage}x</b></div>
          <div>${t("finalPnlLabel")}: <b class="${pctClsFromValue(finalPnl)}">${pctFromValue(finalPnl)}</b></div>
        </div>
        <div class="trade-actions">
          <button class="ghost-btn" data-action="delete-lock-record" data-id="${r.id}">${t("delete")}</button>
        </div>
      </div>`;
  }

  function renderRecordsView() {
    // 요구사항 2: 상단 통계는 정상 동작하는 LOCK 기록(State.lockRecords) 기준으로 계산한다.
    const lockRecords = State.lockRecords;
    const finalPnlOf = (r) => (r.finalPnlPercent != null ? r.finalPnlPercent : r.endPnlPercent);
    const total = lockRecords.length;
    const wins = lockRecords.filter((r) => finalPnlOf(r) > 0).length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    const totalPnl = lockRecords.reduce((sum, r) => sum + (finalPnlOf(r) || 0), 0);

    document.getElementById("statTotal").textContent = total;
    document.getElementById("statWinRate").textContent = total > 0 ? winRate.toFixed(1) + "%" : "-";
    const pnlEl = document.getElementById("statPnl");
    pnlEl.textContent = total > 0 ? (totalPnl >= 0 ? "+" : "") + totalPnl.toFixed(2) + "%" : "-";
    pnlEl.className = "stat-v " + (totalPnl > 0 ? "up" : totalPnl < 0 ? "down" : "");

    // LOCK 기록(records) — 신호 데이터(signals)와 분리된 별도 목록. 여기서만 표시된다 (요구사항 5).
    const lockListEl = document.getElementById("lockRecordList");
    lockListEl.innerHTML = lockRecords.length
      ? lockRecords.map(lockRecordCard).join("")
      : `<div class="empty">${t("noLockRecords")}</div>`;
  }

  /* ---------------- 신호 성능 화면 (보정 전/후 A/B 비교) ----------------
     SignalPerformance의 리포트를 읽어서 표시만 한다. 값을 재계산하지 않으므로
     화면에 보이는 숫자가 실제 기록과 어긋날 수 없다. */

  // 현재 선택된 필터 (기본: 전체)
  let perfFilter = { market: "all", score: "all" };

  function getPerfFilter() {
    return perfFilter;
  }
  function setPerfFilter(key, value) {
    perfFilter[key] = value;
    // 버튼 활성 표시 갱신
    const rowId = key === "market" ? "perfMarketFilter" : "perfScoreFilter";
    const attr = key === "market" ? "market" : "score";
    document.querySelectorAll(`#${rowId} button[data-${attr}]`).forEach((b) => {
      b.classList.toggle("active", b.dataset[attr] === value);
    });
    renderPerformanceView();
  }

  // 승률 표기: 데이터가 없으면 "-"로 표시해 0%로 오해하게 하지 않는다.
  function fmtRate(v) {
    return Number.isFinite(v) ? v.toFixed(1) + "%" : "-";
  }
  // 개선폭(%p): 표본 부족이면 null이므로 "-"로 표시한다.
  function fmtDelta(v) {
    if (!Number.isFinite(v)) return "-";
    return (v >= 0 ? "+" : "") + v.toFixed(1) + "%p";
  }
  function deltaClass(v) {
    if (!Number.isFinite(v)) return "";
    if (v > 0) return "up";
    if (v < 0) return "down";
    return "";
  }

  // 표본 상태 배지: 충분/수집중을 명확히 구분해서 오해를 막는다.
  function sampleBadge(r) {
    if (r.confidence === "ok") {
      return `<span class="perf-badge ok">${tp("perfSampleOk", { n: r.totalResolved })}</span>`;
    }
    return `<span class="perf-badge collecting">${tp("perfSampleCollecting", {
      n: r.totalResolved,
      min: r.minSample,
    })}</span>`;
  }

  // 요약 카드: 전체 승률 / 보정 전 / 보정 후 / 개선폭
  function perfSummaryCard(r) {
    return `
      <div class="perf-card">
        <div class="perf-card-head">
          <span class="perf-card-title">${t("perfSummaryTitle")}</span>
          ${sampleBadge(r)}
        </div>
        <div class="perf-grid">
          <div class="perf-cell">
            <div class="perf-k">${t("perfOverallRate")}</div>
            <div class="perf-v">${fmtRate(r.overallWinRate)}</div>
            <div class="perf-sub">${tp("perfResolvedCount", { n: r.totalResolved })}</div>
          </div>
          <div class="perf-cell">
            <div class="perf-k">${t("perfBaseRate")}</div>
            <div class="perf-v">${fmtRate(r.baseWinRate)}</div>
            <div class="perf-sub">${tp("perfPassedCount", { n: r.basePassedCount })}</div>
          </div>
          <div class="perf-cell">
            <div class="perf-k">${t("perfAdjustedRate")}</div>
            <div class="perf-v">${fmtRate(r.adjustedWinRate)}</div>
            <div class="perf-sub">${tp("perfPassedCount", { n: r.adjustedPassedCount })}</div>
          </div>
          <div class="perf-cell">
            <div class="perf-k">${t("perfImprovement")}</div>
            <div class="perf-v ${deltaClass(r.improvementPercentPoint)}">${fmtDelta(r.improvementPercentPoint)}</div>
            <div class="perf-sub">${r.confidence === "ok" ? t("perfImprovementBasis") : t("perfNeedMore")}</div>
          </div>
        </div>
        ${
          r.pending > 0
            ? `<div class="perf-pending">${tp("perfPendingCount", { n: r.pending })}</div>`
            : ""
        }
      </div>`;
  }

  // 한 줄 비교 행 (방향별·그룹별 공통)
  function perfRow(label, r) {
    return `
      <div class="perf-row">
        <div class="perf-row-head">
          <span class="perf-row-label">${label}</span>
          ${sampleBadge(r)}
        </div>
        <div class="perf-row-body">
          <span class="perf-row-item">${t("perfBaseShort")} <b>${fmtRate(r.baseWinRate)}</b></span>
          <span class="perf-arrow">\u2192</span>
          <span class="perf-row-item">${t("perfAdjustedShort")} <b>${fmtRate(r.adjustedWinRate)}</b></span>
          <span class="perf-row-delta ${deltaClass(r.improvementPercentPoint)}">${fmtDelta(r.improvementPercentPoint)}</span>
        </div>
      </div>`;
  }

  function renderPerformanceView() {
    const summaryEl = document.getElementById("perfSummary");
    const dirEl = document.getElementById("perfDirection");
    const groupsEl = document.getElementById("perfGroups");
    if (!summaryEl || !root.SignalPerformance) return;

    const f = perfFilter;
    const query = {};
    if (f.market !== "all") query.market = f.market;
    if (f.score !== "all") query.score = Number(f.score);

    let rep;
    try {
      rep = root.SignalPerformance.getPerformanceReport(query);
    } catch (e) {
      console.error("performance report failed", e);
      return;
    }

    // 기록이 하나도 없으면 안내만 표시한다(가짜 0% 대신).
    if (rep.totalResolved === 0 && rep.pending === 0) {
      summaryEl.innerHTML = `<div class="empty">${t("perfNoData")}</div>`;
      dirEl.innerHTML = "";
      groupsEl.innerHTML = "";
      return;
    }

    summaryEl.innerHTML = perfSummaryCard(rep);
    dirEl.innerHTML = perfRow(t("long"), rep.long) + perfRow(t("short"), rep.short);

    // 그룹별: 현재 필터 범위 안에서 market × score 조합을 보여준다.
    const markets = f.market === "all" ? CONFIG.CATEGORIES.map((c) => (c === "stock" ? "stock" : "crypto")) : [f.market];
    const scores = f.score === "all" ? CONFIG.SCORE_PERF_TRACK : [Number(f.score)];
    let html = "";
    markets.forEach((market) => {
      scores.forEach((score) => {
        let gr;
        try {
          gr = root.SignalPerformance.getPerformanceReport({ market, score });
        } catch (e) {
          return;
        }
        const marketLabel = t(market === "stock" ? "stockFutures" : "coinFutures");
        html += perfRow(`${marketLabel} ${score}${t("pointSuffix")}`, gr);
      });
    });
    groupsEl.innerHTML = html || `<div class="empty">${t("perfNoData")}</div>`;
  }

  /* ---------------- Trade modals ---------------- */
  function openAddTradeModal() {
    const sel = document.getElementById("tradeSymbolSelect");
    sel.innerHTML = State.symbols.map((s) => `<option value="${s}">${s}</option>`).join("");
    const defaultSym = (detailSymbol && State.symbols.includes(detailSymbol)) ? detailSymbol : State.symbols[0];
    if (defaultSym) sel.value = defaultSym;
    const priceEl = document.getElementById("tradeEntryPrice");
    const cur = State.data[sel.value];
    priceEl.value = cur ? cur.price : "";
    document.getElementById("addTradeModal").classList.add("open");
  }
  function closeAddTradeModal() {
    document.getElementById("addTradeModal").classList.remove("open");
  }

  let closeTradeTargetId = null;
  function openCloseTradeModal(tradeId) {
    closeTradeTargetId = tradeId;
    const trade = root.TradeLog.getAll().find((t2) => t2.id === tradeId);
    const cur = trade ? State.data[trade.symbol] : null;
    document.getElementById("tradeExitPrice").value = cur ? cur.price : "";
    document.getElementById("closeTradeModal").classList.add("open");
  }
  function closeCloseTradeModal() {
    closeTradeTargetId = null;
    document.getElementById("closeTradeModal").classList.remove("open");
  }
  function getCloseTradeTargetId() {
    return closeTradeTargetId;
  }

  function openAnalysisModal(tradeId) {
    const trade = root.TradeLog.getAll().find((t2) => t2.id === tradeId);
    const body = document.getElementById("analysisBody");
    if (!trade) {
      body.innerHTML = "";
      document.getElementById("analysisModal").classList.add("open");
      return;
    }
    const result = root.LossAnalysis.analyze(trade);
    if (!result.reasons.length) {
      body.innerHTML = `<div class="analysis-reason"><span>${t("noSnapshotData")}</span></div>`;
    } else {
      body.innerHTML = result.reasons
        .map((r) => `<div class="analysis-reason"><span class="bullet">\u2022</span><span>${tp(r.key, r.params)}</span></div>`)
        .join("");
    }
    document.getElementById("analysisModal").classList.add("open");
  }
  function closeAnalysisModal() {
    document.getElementById("analysisModal").classList.remove("open");
  }

  /* ---------------- 종목 추가 대상 카테고리 ----------------
     별도 선택 버튼 없이 "현재 열려 있는 카테고리 페이지"가 곧 추가 대상이다.
     (기록 페이지에서 추가하는 경우는 코인으로 취급) */
  function getSelectedCategory() {
    return State.view === "stock" ? "stock" : "coin";
  }

  function tierLabel(tier) {
    if (tier === "sufficient") return t("tierSufficient");
    if (tier === "learning") return t("tierLearning");
    return t("tierInsufficient");
  }

  /* ---------------- Symbol chips (settings panel) — 카테고리별 그룹 + 종목별 학습 상태 ---------------- */
  function renderChips() {
    const box = document.getElementById("chipList");
    const cat = State.view === "stock" ? "stock" : "coin"; // 기록 페이지에서는 코인 목록을 기본 표시
    const syms = State.symbolsInCategory(cat);
    box.innerHTML = "";
    if (syms.length === 0) {
      const none = document.createElement("div");
      none.className = "chip-none";
      none.textContent = t("noSymbolsInCategory");
      box.appendChild(none);
    }

    /* 성능순 정렬
       1순위: 신뢰도 점수 = "학습 데이터 수가 많고 승률이 높은" 종목
       2순위: 승률
       3순위: 학습 데이터 수

       1순위에는 기존 자가학습과 동일한 베이지안 스무딩(LEARN_PRIOR_WEIGHT)을 재사용한다.
         score = (wins + PRIOR*0.5) / (total + PRIOR)
       이렇게 하면 표본 3건 100%(score 0.65)가 표본 300건 78%(score 0.777)보다 아래로 가서,
       "표본이 적은 100%가 무조건 위로 올라가는" 비정상 정렬을 막는다.
       승률을 새로 만들어내지 않고, 정렬 가중치로만 쓴다(표시 값은 실제 승률 그대로).
       통계는 현재 시장(cat)으로만 조회하므로 다른 시장 통계가 정렬에 섞이지 않는다. */
    const rows = syms.map((sym) => ({
      sym,
      learn: root.PatternLearn.getStatsFor(cat, sym), // 현재 페이지 카테고리만 집계(타 시장 데이터 미포함)
    }));
    rows.sort(compareSymbolPerformance);

    rows.forEach(({ sym, learn }) => {
      const chip = document.createElement("div");
      chip.className = "chip";
      // 데이터가 없을 때 NaN/undefined가 화면에 나오지 않도록 방어한다.
      const total = Number.isFinite(learn.total) ? learn.total : 0;
      const winRateText = Number.isFinite(learn.winRate) ? learn.winRate.toFixed(1) + "%" : "-";
      chip.innerHTML = `
        <div class="chip-main">
          <span class="chip-sym">${sym}</span>
          <span class="chip-learn">${t("totalEntries")} ${total} \u00b7 ${t("winRate")} ${winRateText} \u00b7 ${tierLabel(learn.tier)}</span>
        </div>
        <button class="chip-del" data-sym="${sym}">${t("delete")}</button>`;
      box.appendChild(chip);
    });
    // 현재 카테고리 종목 수와 전체 기준 상한을 함께 보여준다 (상한 MAX_SYMBOLS는 전체 공통)
    document.getElementById("symbolCount").textContent = `${syms.length} (${t("allCategories")} ${State.symbols.length} / ${CONFIG.MAX_SYMBOLS})`;
  }

  /* 종목 정렬 점수: 표본 수와 승률을 함께 반영한다(스무딩된 신뢰도).
     기존 PatternLearn.getConfidence()와 같은 공식을 쓰므로 앱 전체에서 기준이 일치한다.
     학습 데이터가 0건이면 null을 반환해 "데이터 있는 종목보다 아래"로 보내는 데 쓴다. */
  function symbolSortScore(learn) {
    const total = Number.isFinite(learn && learn.total) ? learn.total : 0;
    if (total <= 0) return null;
    const wins = Number.isFinite(learn.wins) ? learn.wins : 0;
    const PRIOR = CONFIG.LEARN_PRIOR_WEIGHT;
    return (wins + PRIOR * 0.5) / (total + PRIOR);
  }

  // renderChips와 공유하는 비교 함수 (1순위 신뢰도 → 2순위 승률 → 3순위 표본 수)
  function compareSymbolPerformance(a, b) {
    const as = symbolSortScore(a.learn);
    const bs = symbolSortScore(b.learn);
    const aHas = as !== null;
    const bHas = bs !== null;
    if (aHas !== bHas) return aHas ? -1 : 1; // 학습 데이터 없는 종목은 아래로
    if (aHas && bHas && as !== bs) return bs - as; // 1순위: 신뢰도 DESC
    const ar = Number.isFinite(a.learn.winRate) ? a.learn.winRate : -1;
    const br = Number.isFinite(b.learn.winRate) ? b.learn.winRate : -1;
    if (ar !== br) return br - ar; // 2순위: 승률 DESC
    const at = Number.isFinite(a.learn.total) ? a.learn.total : 0;
    const bt = Number.isFinite(b.learn.total) ? b.learn.total : 0;
    if (at !== bt) return bt - at; // 3순위: 학습 데이터 수 DESC
    return a.sym.localeCompare(b.sym); // 완전히 같으면 이름순(표시 순서 안정화)
  }

  // 정렬 로직을 테스트/재사용 가능하게 분리한 버전 (renderChips와 동일한 기준)
  function sortSymbolsByPerformance(symbols, category) {
    const rows = symbols.map((sym) => ({ sym, learn: root.PatternLearn.getStatsFor(category, sym) }));
    rows.sort(compareSymbolPerformance);
    return rows.map((r) => r.sym);
  }

  /* ---------------- Notify button (실제 ON/OFF 토글) ---------------- */
  function renderNotifyBtn() {
    const btn = document.getElementById("notifyBtn");
    btn.textContent = State.notifyEnabled ? t("notifyOn") : t("notifyOff");
    btn.classList.toggle("on", State.notifyEnabled);
    btn.classList.toggle("off", !State.notifyEnabled);
    btn.setAttribute("aria-pressed", String(State.notifyEnabled));
  }

  /* ---------------- 백그라운드 감시 버튼 (Android 전용, 알림 토글과 동일 패턴) ---------------- */
  function renderBgMonitorBtn() {
    const btn = document.getElementById("bgMonitorBtn");
    btn.textContent = State.bgMonitorEnabled ? t("bgMonitorOn") : t("bgMonitorOff");
    btn.classList.toggle("on", State.bgMonitorEnabled);
    btn.classList.toggle("off", !State.bgMonitorEnabled);
    btn.setAttribute("aria-pressed", String(State.bgMonitorEnabled));
  }

  /* ---------------- 자가학습 상태 패널 (요구사항 5) ---------------- */
  /* ---------------- 신호 알림 필터 토글 ----------------
     ON  : 낮은 신뢰도 신호의 알림을 걸러낸다(기존 동작).
     OFF : 알림을 걸러내지 않고 모든 신호를 그대로 알린다.
     어느 쪽이든 자가학습·기록·성능 측정은 계속된다는 점을 문구로 명확히 알린다. */
  function renderSignalFilterBtn() {
    const btn = document.getElementById("signalFilterBtn");
    if (!btn) return;
    const on = State.signalFilterEnabled !== false;
    btn.textContent = on ? t("signalFilterOn") : t("signalFilterOff");
    btn.classList.toggle("on", on);
    btn.classList.toggle("off", !on);
    btn.setAttribute("aria-pressed", String(on));
    const notice = document.getElementById("signalFilterNotice");
    if (notice) notice.textContent = on ? t("signalFilterOnNotice") : t("signalFilterOffNotice");
  }

  /* ---------------- 종합 신뢰도 필터 UI ----------------
     기존 신호 필터와 독립된 설정이다. OFF면 슬라이더를 숨기고, ON이면 최소 기준을 보여준다. */
  function renderConfFilter() {
    const btn = document.getElementById("confFilterBtn");
    if (!btn) return;
    const on = State.confFilterEnabled === true;
    btn.textContent = on ? t("confFilterOn") : t("confFilterOff");
    btn.classList.toggle("on", on);
    btn.classList.toggle("off", !on);
    btn.setAttribute("aria-pressed", String(on));

    const row = document.getElementById("confFilterRow");
    if (row) row.style.display = on ? "" : "none";

    const range = document.getElementById("confFilterMinRange");
    if (range) {
      range.min = String(CONFIG.CONF_FILTER_MIN_LIMIT);
      range.max = String(CONFIG.CONF_FILTER_MAX_LIMIT);
      range.step = String(CONFIG.CONF_FILTER_STEP);
      range.value = String(State.confFilterMin);
    }
    const val = document.getElementById("confFilterMinValue");
    if (val) val.textContent = tp("confFilterMinValue", { value: State.confFilterMin });

    const notice = document.getElementById("confFilterNotice");
    if (notice) {
      notice.textContent = on
        ? tp("confFilterOnNotice", { value: State.confFilterMin })
        : t("confFilterOffNotice");
    }
  }

  /* ---------------- 차단된 알림 이력 (표시 전용) ----------------
     "왜 알림이 안 왔는지"를 확인할 수 있게 최근 차단 내역을 보여준다.
     학습·성능 데이터와는 별도 저장소이며, 여기서 지워도 그쪽에 영향이 없다. */
  function renderConfBlockLog() {
    const box = document.getElementById("confBlockBox");
    if (!box || !root.ConfBlockLog) return;
    // 필터가 꺼져 있고 이력도 없으면 영역 자체를 숨긴다.
    let summary, list;
    try {
      // 현재 보고 있는 시장의 이력만 표시한다(코인/주식 혼합 방지).
      const market = State.view === "stock" ? "stock" : "crypto";
      summary = root.ConfBlockLog.getSummary({ market });
      list = root.ConfBlockLog.getAll({ market }).slice(0, 5);
    } catch (e) {
      console.error("conf block log read failed", e);
      box.style.display = "none";
      return;
    }
    if (summary.total === 0) {
      box.style.display = "none";
      return;
    }
    box.style.display = "";
    document.getElementById("confBlockSummary").textContent = tp("confBlockSummary", {
      total: summary.total,
      recent: summary.recent24h,
    });
    document.getElementById("confBlockList").innerHTML = list
      .map((b) => {
        const time = new Date(b.blockedAt).toLocaleTimeString();
        const dir = b.direction === "short" ? t("short") : t("long");
        const conf = Number.isFinite(b.confidence) ? b.confidence.toFixed(0) + "%" : "-";
        const th = Number.isFinite(b.threshold) ? b.threshold + "%" : "-";
        return `<div class="conf-block-item">
          <span class="cb-sym">${b.symbol || "-"}</span>
          <span class="cb-meta">${b.score || "-"}${t("pointSuffix")} ${dir}</span>
          <span class="cb-conf">${conf} / ${th}</span>
          <span class="cb-time">${time}</span>
        </div>`;
      })
      .join("");
  }

  function renderLearnPanel() {
    const btn = document.getElementById("learnBtn");
    btn.textContent = State.learnEnabled ? t("learnOn") : t("learnOff");
    btn.classList.toggle("on", State.learnEnabled);
    btn.classList.toggle("off", !State.learnEnabled);
    btn.setAttribute("aria-pressed", String(State.learnEnabled));

    renderSignalFilterBtn();
    renderConfFilter();
    renderConfBlockLog();

    // 요구사항 8: 현재 열려 있는 시장(코인/주식)의 학습 통계만 표시한다.
    const learnCat = State.view === "stock" ? "stock" : "coin";
    const totals = root.PatternLearn.getTotals(learnCat);
    const marketName = t(learnCat === "stock" ? "stockFutures" : "coinFutures");
    // 학습 데이터 수는 실제로 WIN/LOSS 판정이 끝난 건수(total)를 보여준다.
    document.getElementById("learnEntries").textContent = totals.total;
    document.getElementById("learnWins").textContent = totals.wins;
    document.getElementById("learnLosses").textContent = totals.losses;
    document.getElementById("learnWinRate").textContent = totals.winRate == null ? "-" : totals.winRate.toFixed(1) + "%";
    document.getElementById("learnAppliedNotice").textContent =
      `[${marketName}] ` + (State.learnEnabled ? t("learnAppliedYes") : t("learnAppliedNo"));

    renderLearnPerformance(learnCat);
  }

  /* ---------------- 학습 성능 분석 (읽기 전용) ----------------
     기존 entries[]를 읽어 계산만 한다. 자가학습 OFF여도 기존 데이터로 계속 표시된다. */
  function fmtPerf(p) {
    if (!p || p.total === 0) return t("noLearnDataYet");
    const rate = p.winRate == null ? "-" : p.winRate.toFixed(1) + "%";
    const shortMark = p.enough === false ? " " + t("dataShort") : "";
    return `${p.wins}W / ${p.losses}L \u00b7 ${rate}${shortMark}`;
  }

  function renderLearnPerformance(category) {
    let summary;
    try {
      summary = root.PatternLearn.getPerformanceSummary(category);
    } catch (e) {
      // 데이터가 없거나 형식이 예상과 달라도 앱이 죽지 않도록 방어
      console.error("performance summary failed", e);
      return;
    }

    document.getElementById("perfRecent10").textContent = fmtPerf(summary.recent10);
    document.getElementById("perfRecent20").textContent = fmtPerf(summary.recent20);
    document.getElementById("perfInitial10").textContent = fmtPerf(summary.initial10);

    /* 요구사항 8: "이전 10회"와 "변화 %p"를 명시적으로 보여준다.
       전체 승률만 보면 (이전 0승10패 → 최근 10승0패 = 전체 50%) 같은 경우
       학습이 좋아진 사실을 알 수 없으므로, 두 구간을 나란히 표시한다.
       계산은 기존 getPerformanceTrend()의 결과를 그대로 사용한다(재계산 없음). */
    const tr0 = summary.trend;
    const prevEl = document.getElementById("perfPrevious10");
    const deltaEl = document.getElementById("perfDelta");
    if (prevEl) {
      prevEl.textContent = Number.isFinite(tr0.previousWinRate)
        ? tr0.previousWinRate.toFixed(1) + "%"
        : t("noLearnDataYet");
    }
    if (deltaEl) {
      if (Number.isFinite(tr0.delta)) {
        const sign = tr0.delta >= 0 ? "+" : "";
        deltaEl.textContent = `${sign}${tr0.delta.toFixed(1)}%p`;
        deltaEl.className = "learn-perf-v " + (tr0.delta > 0 ? "up" : tr0.delta < 0 ? "down" : "");
      } else {
        deltaEl.textContent = "-";
        deltaEl.className = "learn-perf-v";
      }
    }

    // 추세 표시 (최근 10회 vs 그 이전 10회 비교)
    const trendEl = document.getElementById("learnTrend");
    const tr = summary.trend;
    if (tr.trend === "up") {
      trendEl.textContent = "\u25B2 " + t("trendUp");
      trendEl.className = "learn-trend up";
    } else if (tr.trend === "down") {
      trendEl.textContent = "\u25BC " + t("trendDown");
      trendEl.className = "learn-trend down";
    } else if (tr.trend === "flat") {
      trendEl.textContent = t("trendFlat");
      trendEl.className = "learn-trend flat";
    } else {
      trendEl.textContent = t("trendUnknown");
      trendEl.className = "learn-trend flat";
    }

    // 보조 설명: 전체 승률과 비교 구간을 알려준다
    const noteEl = document.getElementById("perfNote");
    if (summary.overall.total === 0) {
      noteEl.textContent = t("noLearnDataYet");
    } else {
      const overallRate = summary.overall.winRate == null ? "-" : summary.overall.winRate.toFixed(1) + "%";
      let note = tp("perfOverallNote", { total: summary.overall.total, rate: overallRate });
      if (tr.delta != null) {
        note += " \u00b7 " + tp("perfDeltaNote", { delta: (tr.delta >= 0 ? "+" : "") + tr.delta.toFixed(1) });
      }
      noteEl.textContent = note;
    }

    root.Charts.drawWinRateChart(document.getElementById("learnPerfChart"), summary.series);
    renderScorePerf();
  }

  /* ---------------- 점수별 신호 성능 (시장 × 점수 × 방향) ---------------- */
  function fmtScorePerf(p) {
    if (!p || p.total === 0) return t("noLearnDataYet");
    // 표본이 부족하면 임의의 승률을 표시하지 않는다 (표본 수는 항상 함께 보여준다)
    // 단위는 i18n 라벨을 사용한다(한국어 "회", 영어는 단위 없음).
    if (!p.enough) return `${t("dataShortLabel")} \u00b7 ${p.wins}W/${p.losses}L \u00b7 ${p.total}${t("countSuffix")}`;
    return `${p.winRate.toFixed(0)}% \u00b7 ${p.wins}W/${p.losses}L \u00b7 ${p.total}${t("countSuffix")}`;
  }

  /* 점수별 신호 성능: 현재 열려 있는 시장(코인/주식)의 데이터만 집계·표시한다.
     이전에는 ["crypto","stock"]을 항상 모두 렌더링해서, 주식 화면에서도 코인
     80/100점이 함께 보였다. 현재 view를 기준으로 시장을 먼저 정하고 그 시장의
     데이터만 가져와 80/100 × LONG/SHORT를 집계한다. */
  function currentMarket() {
    // 기존 값을 그대로 사용한다: State.view는 'coin'|'stock'|..., 시장 키는 'crypto'|'stock'
    return State.view === "stock" ? "stock" : "crypto";
  }

  /* 유사 패턴 승률 한 줄 (전체 승률과 "별도"로 표시된다 — 덮어쓰지 않음).
     표본이 부족하면 승률 대신 "데이터 부족"으로 표시한다. */
  function fmtGroupSim(market, score, direction) {
    let g;
    try {
      g = root.PatternSimilarity.getGroupSimilarityStats(market, score, direction);
    } catch (e) {
      console.error("group similarity failed", e);
      return t("noLearnDataYet");
    }
    if (!g || g.matchedCount === 0) return t("simNoSample");
    if (!g.enough) return `${t("dataShortLabel")} \u00b7 ${g.matchedCount}${t("countSuffix")}`;
    const rate = Number.isFinite(g.similarityWeightedWinRate) ? g.similarityWeightedWinRate : g.winRate;
    if (!Number.isFinite(rate)) return t("simNoSample");
    return `${rate.toFixed(0)}% \u00b7 ${g.matchedCount}${t("countSuffix")}`;
  }

  /* 그룹별 종합 신뢰도 한 줄 (전체 승률/유사 패턴 승률과 별개 값). */
  function fmtGroupConf(market, score, direction) {
    let g;
    try {
      g = root.ConfidenceAdjust.getGroupConfidence(market, score, direction);
    } catch (e) {
      console.error("group confidence failed", e);
      return "-";
    }
    if (!g || !Number.isFinite(g.confidence)) return "-";
    // 표본이 부족하면 값 뒤에 별표를 붙여 참고용임을 알린다.
    return `${g.confidence.toFixed(0)}%${g.enough ? "" : "*"}`;
  }

  function renderScorePerf() {
    const body = document.getElementById("scorePerfBody");
    if (!body) return;
    const market = currentMarket();
    let table;
    try {
      table = root.PatternLearn.getScorePerfTable();
    } catch (e) {
      console.error("score perf table failed", e);
      return;
    }
    const marketData = table[market];
    if (!marketData) {
      body.innerHTML = `<div class="chip-none">${t("noLearnDataYet")}</div>`;
      renderSnapshotNote();
      return;
    }

    // 현재 시장에 결과가 하나도 없으면 "학습 결과 없음"으로 표시한다.
    // (다른 시장 데이터는 이 판단에 포함되지 않는다)
    const hasAny = CONFIG.SCORE_PERF_TRACK.some((score) => {
      const cell = marketData[score];
      return cell && (cell.long.total > 0 || cell.short.total > 0);
    });

    let html = `<div class="score-perf-market">${t(market === "stock" ? "stockFutures" : "coinFutures")}</div>`;
    if (!hasAny) {
      html += `<div class="chip-none">${t("noLearnDataYet")}</div>`;
    } else {
      CONFIG.SCORE_PERF_TRACK.forEach((score) => {
        const cell = marketData[score];
        if (!cell) return;
        html += `
          <div class="score-perf-group">
            <div class="score-perf-score">${score}${t("pointSuffix")}</div>
            <div class="score-perf-line"><span class="sp-dir long">LONG</span><span class="sp-val">${fmtScorePerf(cell.long)}</span></div>
            <div class="sp-sim">${t("simWinRateLabel")} ${fmtGroupSim(market, score, "long")} \u00b7 ${t("confShort")} ${fmtGroupConf(market, score, "long")}</div>
            <div class="score-perf-line"><span class="sp-dir short">SHORT</span><span class="sp-val">${fmtScorePerf(cell.short)}</span></div>
            <div class="sp-sim">${t("simWinRateLabel")} ${fmtGroupSim(market, score, "short")} \u00b7 ${t("confShort")} ${fmtGroupConf(market, score, "short")}</div>
          </div>`;
      });
    }
    body.innerHTML = html;
    renderSnapshotNote();
  }

  // Pattern Snapshot 저장 현황 (디버깅용 한 줄 표시)
  function renderSnapshotNote() {
    const el = document.getElementById("snapshotNote");
    if (!el || !root.PatternSnapshot) return;
    try {
      // 스냅샷 요약도 현재 시장 기준으로만 집계한다(시장 간 혼합 방지)
      const s = root.PatternSnapshot.getSummary(currentMarket());
      el.textContent = tp("snapshotNote", {
        total: s.total,
        max: s.max,
        wins: s.wins,
        losses: s.losses,
        waiting: s.pendingResult,
      });
    } catch (e) {
      console.error("snapshot summary failed", e);
    }
  }

  /* ---------------- i18n apply ---------------- */
  function applyI18n() {
    document.documentElement.lang = State.lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    document.getElementById("symbolInput").placeholder = t("addPlaceholder");
    renderNotifyBtn();
    renderBgMonitorBtn();
    renderLearnPanel();
    renderChips();
    maybeShowEmpty();
    Object.keys(State.data).forEach((sym) => renderRow(sym, State.data[sym], false));
    if (detailSymbol) renderDetail(detailSymbol);
    if (State.view === "records") renderRecordsView();
  }

  root.UI = {
    t,
    tp,
    formatPrice,
    formatNum,
    badgeInfo,
    renderRow,
    removeRow,
    maybeShowEmpty,
    restoreDismissed,
    openDetail,
    closeDetail,
    renderDetail,
    renderTfTabs,
    renderLockPanel,
    showToast,
    attachToastDismiss,
    renderChips,
    renderSimilarityCompare,
    renderConfidenceCard,
    renderVolumeProfile,
    sortSymbolsByPerformance,
    symbolSortScore,
    getSelectedCategory,
    renderCategoryList,
    renderNotifyBtn,
    renderBgMonitorBtn,
    renderLearnPanel,
    renderSignalFilterBtn,
    renderConfFilter,
    renderConfBlockLog,
    applyI18n,
    toggleMenu,
    switchView,
    renderRecordsView,
    renderPerformanceView,
    getPerfFilter,
    setPerfFilter,
    openAddTradeModal,
    closeAddTradeModal,
    openCloseTradeModal,
    closeCloseTradeModal,
    getCloseTradeTargetId,
    openAnalysisModal,
    closeAnalysisModal,
  };
})(typeof window !== "undefined" ? window : globalThis);
