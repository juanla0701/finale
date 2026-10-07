(function (root) {
  const CONFIG = root.CONFIG;
  const State = root.State;
  const UI = root.UI;
  const TFS = ["1m", "5m", "15m"];

  /* ---------------- Fetch + evaluate one symbol (1m/5m/15m 동시 조회) ---------------- */
  async function updateSymbol(symbol) {
    try {
      const klinesByTf = {};
      await Promise.all(
        TFS.map(async (tf) => {
          klinesByTf[tf] = await root.BinanceApi.fetchKlines(symbol, tf, CONFIG.KLINE_LIMIT);
        })
      );
      for (const tf of TFS) {
        if (klinesByTf[tf].length < CONFIG.MACD_SLOW + CONFIG.MACD_SIGNAL) {
          // 유효한 캔들이 부족함 (신규 상장 종목 등) — 잘못된 값을 보여주지 않도록 오류 상태로 표시
          State.errors[symbol] = true;
          UI.renderRow(symbol, State.data[symbol] || null, true);
          return;
        }
      }

      const tfData = {};
      TFS.forEach((tf) => {
        tfData[tf] = root.Signals.computeIndicators(klinesByTf[tf]);
      });

      const prevState = State.data[symbol];
      const result = root.Signals.evaluate(prevState, symbol, tfData);
      State.data[symbol] = result;
      State.errors[symbol] = false; // 이번 갱신은 성공했으므로 오류 플래그 해제

      // "기록" 버튼으로 기록 중인 종목이면, 이번에 새로 받은 가격으로 최고가/최저가(+손익률)를 실시간 갱신한다.
      // LOCK(State.lock)만 되어 있고 기록이 시작되지 않았다면 여기서 아무것도 갱신하지 않는다 (요구사항 2/3).
      if (State.recording && State.recording.symbol === symbol) {
        const next = root.LockRange.update(State.recording, result.price);
        if (next !== State.recording) State.saveRecording(next);
      }

      UI.renderRow(symbol, result, false);
      if (document.getElementById("detailView").classList.contains("open") && document.getElementById("detailSym").textContent === symbol) {
        UI.renderDetail(symbol);
      }

      if (result.isNewSignal && result.leadingDirection) {
        // 신호 기록(SignalLog)은 LOCK IN 여부와 무관하게 항상 남긴다 (데이터 축적 목적).
        root.SignalLog.append(result, result.leadingDirection);
        // 자가학습(패턴 신뢰도) 대기열에 등록 — 감시 중인 모든 종목 대상, Lock-in 기록과는 별개.
        const pendingItem = root.PatternLearn.recordPending(result, result.leadingDirection);
        // Pattern Snapshot(3단계): 신호 발생 순간의 차트 상태를 저장한다.
        // recordPending이 만든 항목(동일 signalId/score/category)과 이미 계산된 지표(result.tf)를
        // 그대로 넘기므로 값이 재계산되거나 어긋나지 않는다.
        // pendingItem이 null이면(학습 OFF 또는 중복 신호) snapshot도 저장하지 않는다.
        if (pendingItem) root.PatternSnapshot.record(pendingItem, result.tf);
        const dirData = result.leadingDirection === "long" ? result.long : result.short;

        /* ---- confidence 보정 (기존 신호 계산이 모두 끝난 뒤에만 실행) ----
           기존 result(점수/방향/isNewSignal)는 전혀 수정하지 않는다.
           base confidence(0~1)는 기존 PatternLearn.getConfidence()를 그대로 읽고,
           과거 유사 패턴 결과로 ±10%p 이내 보정한 값만 별도로 만든다. */
        let confReport = null;
        try {
          confReport = root.ConfidenceAdjust.evaluateForSignal(result, result.leadingDirection, pendingItem);
        } catch (e) {
          // 보정 단계에서 문제가 생겨도 기존 신호/알림 흐름은 그대로 진행한다(안전 우선)
          console.error("confidence adjust failed", e);
          confReport = null;
        }
        // 디버깅/검증용으로 현재 신호 상태에 붙여둔다(별도 저장소를 만들지 않음).
        // 학습 데이터에는 저장하지 않는다.
        result.confidenceReport = confReport;

        // LOCK IN 중이면 잠긴 종목 외의 알림(토스트+브라우저 알림)은 전부 차단한다.
        const locked = State.lock && State.lock.symbol;
        const allowed = !locked || locked === symbol;
        // 학습된 패턴 신뢰도가 낮고(임계값 미만) 샘플이 충분하면 "알림"만 걸러낸다.
        // (신호 자체, 점수, 차트, SignalLog 기록은 전혀 영향받지 않음)
        const passesLearnFilter = root.PatternLearn.shouldAlert(result, result.leadingDirection);
        // 보정된 confidence를 기존과 "동일한 임계값"으로 한 번 더 확인한다.
        // 보정이 적용되지 않았거나(applied=false) 값이 없으면 기존 판정을 그대로 따른다 —
        // 즉 이 조건 때문에 기존에 통과하던 신호가 새로 차단되는 일은 보정이 실제
        // 적용된 경우로만 제한된다.
        const passesAdjusted =
          !confReport || !confReport.applied || !Number.isFinite(confReport.adjustedConfidence)
            ? true
            : confReport.adjustedConfidence >= CONFIG.LEARN_CONFIDENCE_THRESHOLD;

        /* ---- 신호 알림 필터 ON/OFF ----
           filterWouldPass: 필터 기준으로 "통과였는지"를 나타내는 판정.
             필터를 꺼도 이 값은 계속 계산한다 — A/B 성능 비교(adjustedPass)가
             필터 상태에 따라 무의미해지지 않게 하기 위함이다.
           filterActive: 실제로 알림을 걸러낼지 여부(사용자 설정).
             OFF면 걸러내지 않고 모든 신호의 알림을 그대로 보낸다.
           학습/기록/성능 측정은 이 설정과 무관하게 항상 계속된다. */
        const filterWouldPass = passesLearnFilter && passesAdjusted;
        const filterActive = State.signalFilterEnabled !== false;
        const alertAllowedByFilter = filterActive ? filterWouldPass : true;

        /* ---- 종합 신뢰도 필터 (기존 필터와 독립) ----
           composite confidence가 사용자 설정 기준 미만이면 "화면 알림만" 차단한다.
           - 기본 OFF이므로 켜기 전에는 기존 동작과 완전히 동일하다.
           - confidence를 계산할 수 없는 경우(과거 데이터·예외)는 임의 값을 만들지 않고
             기존 동작을 그대로 유지한다(통과시킨다).
           - 이 판정은 알림 표시 여부에만 쓰이며, 아래의 학습·성능 기록에는 영향을 주지 않는다. */
        const confFilterActive = State.confFilterEnabled === true;
        const compositeValue =
          confReport && confReport.composite && Number.isFinite(confReport.composite.confidence)
            ? confReport.composite.confidence
            : null;
        const confFilterPass =
          !confFilterActive || compositeValue === null
            ? true // 필터 OFF 이거나 값이 없으면 기존 동작 유지
            : compositeValue >= State.confFilterMin;
        // 필터가 실제로 차단했는지(디버깅/표시용) — 값이 있고 기준 미만일 때만 true
        const confFilterBlocked = confFilterActive && compositeValue !== null && !confFilterPass;

        if (allowed && alertAllowedByFilter && confFilterPass) {
          // 알림에 담을 상세 정보를 구성한다(지표를 재계산하지 않고 이미 계산된 값만 모음).
          // 구성에 실패하더라도 기존 알림은 그대로 발송되도록 방어한다.
          let detail = null;
          try {
            detail = root.AlertDetail.build({
              symbol,
              direction: result.leadingDirection,
              result,
              confReport,
              filterWouldPass,
              filterActive,
            });
          } catch (e) {
            console.error("alert detail build failed", e);
            detail = null;
          }
          UI.showToast(symbol, result.leadingDirection, dirData.score, detail);
          fireNotification(symbol, result.leadingDirection, dirData.score, result.price, detail);
        }

        /* ---- A/B 성능 검증 기록 (측정 전용, 학습에 재투입하지 않음) ----
           같은 신호 하나에 대해 "보정 전 판정(basePass)"과 "보정 후 판정(adjustedPass)"을
           함께 남겨서 나중에 공정하게 비교할 수 있게 한다.
           - basePass     : 보정을 적용하지 않았을 때의 기존 판정 (shouldAlert 결과 그대로)
           - adjustedPass : 보정을 반영한 판정 (기존 판정 AND 보정 판정)
           중요: 두 값 모두 알림 필터 ON/OFF와 무관하게 항상 같은 기준으로 기록한다.
           필터를 껐다고 adjustedPass를 true로 바꾸면 A/B 비교가 무의미해지기 때문이다.
           결과(result)는 여기서 절대 기록하지 않는다 — 확정 시점에만 채운다(미래 누수 방지). */
        try {
          if (pendingItem && pendingItem.signalId) {
            root.SignalPerformance.record({
              signalId: pendingItem.signalId,
              signalTime: pendingItem.signalTime,
              symbol,
              market: root.PatternLearn.marketOf(pendingItem.category),
              direction: result.leadingDirection,
              score: dirData.score,
              confReport,
              basePass: passesLearnFilter,
              adjustedPass: filterWouldPass,
            });
          }
          /* 신뢰도 필터가 알림을 막았더라도 위 SignalPerformance.record()는 그대로 실행된다.
             즉 차단된 신호도 A/B 성능 기록·학습 대기열·스냅샷에 정상 반영되며,
             필터는 "화면 알림"에만 작용한다. */
          if (confReport) confReport.confFilterBlocked = confFilterBlocked;

          /* 차단된 경우 "왜 알림이 안 왔는지" 확인할 수 있게 이력을 남긴다.
             전용 저장소(ConfBlockLog)에만 기록하며 학습에 재투입하지 않는다. */
          if (confFilterBlocked && pendingItem && pendingItem.signalId) {
            root.ConfBlockLog.record({
              signalId: pendingItem.signalId,
              signalTime: pendingItem.signalTime,
              symbol,
              market: root.PatternLearn.marketOf(pendingItem.category),
              direction: result.leadingDirection,
              score: dirData.score,
              confidence: compositeValue,
              threshold: State.confFilterMin,
            });
          }
        } catch (e) {
          // 성능 기록 실패가 기존 신호/알림 흐름을 막지 않도록 한다
          console.error("performance record failed", e);
        }
      }
    } catch (err) {
      console.error(symbol, err);
      /* 앱이 백그라운드로 가면서 요청이 중단된 경우(abort)는 "실제 오류"가 아니라
         일시적 상황이다. 이때 오류 상태로 굳히면 재진입 후에도 "데이터 로드 실패"가
         남으므로, 중단은 오류로 처리하지 않고 기존 화면을 그대로 유지한다.
         (화면이 다시 보이면 handleAppResume이 즉시 갱신한다) */
      const aborted =
        (err && (err.name === "AbortError" || err.code === 20)) ||
        (typeof document !== "undefined" && document.visibilityState === "hidden");
      if (aborted) return;

      State.errors[symbol] = true;
      // 기존에 받아둔 데이터가 있으면 그것을 유지한 채 오류만 표시한다(화면이 비는 것 방지).
      UI.renderRow(symbol, State.data[symbol] || null, true);
      if (document.getElementById("detailView").classList.contains("open") && document.getElementById("detailSym").textContent === symbol) {
        UI.renderDetail(symbol);
      }
    }
  }

  // 심볼 목록을 작은 묶음으로 나눠 순차 처리한다 (요청 수/주기는 그대로, 순간 동시 요청 개수만 제한).
  // 50개까지 등록 가능해져도 한 번에 150개 요청이 동시에 나가지 않도록 하기 위함.
  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  let isPolling = false; // 이전 폴링 사이클이 아직 진행 중이면 새 사이클을 겹쳐서 시작하지 않는다 (중복 API 요청/중복 감시 방지)
  async function updateAll() {
    if (isPolling) return; // 이미 실행 중 — 겹쳐서 새로 시작하지 않음(요구사항 2/8: 중복 감시 방지)
    isPolling = true;
    try {
      const batches = chunk(State.symbols, CONFIG.SYMBOL_UPDATE_CONCURRENCY);
      for (const batch of batches) {
        await Promise.all(batch.map(updateSymbol));
      }
      root.PatternLearn.evaluatePending(State.data); // 추가 API 호출 없이 이미 받은 가격으로 판정
      // 결과가 확정되면 종목별 승률/학습 데이터 수가 바뀌므로 목록을 성능순으로 다시 정렬한다.
      // (렌더 실패가 폴링을 멈추지 않도록 방어)
      try {
        UI.renderChips();
      } catch (e) {
        console.error("renderChips after evaluate failed", e);
      }
    } finally {
      isPolling = false;
    }
  }

  /* ---------------- 네이티브 백그라운드 서비스용 훅 ----------------
     화면이 꺼지면 WebView의 JS 타이머(setInterval)는 Chromium이 강하게 제한한다
     (비가시 페이지는 수 분 뒤 분당 1회로 줄고 결국 사실상 멈춘다).
     그래서 백그라운드에서는 JS 타이머에 의존하지 않고, Android Service의 네이티브
     Handler가 주기적으로 이 함수를 호출해 폴링 1회를 돌린다.

     중복 방지: updateAll() 내부의 isPolling 가드가 이미 겹친 실행을 막고,
     신호 중복 기록은 기존 signalId 체계가 막는다. 따라서 네이티브 tick과
     남아있는 JS 타이머가 동시에 들어와도 요청이 2배가 되지 않는다. */
  root.__bgTick = function () {
    try {
      if (isPolling) return "busy"; // 이미 폴링 중이면 건너뛴다(중복 요청 방지)
      updateAll();
      return "ok";
    } catch (e) {
      console.error("bgTick failed", e);
      return "error";
    }
  };

  // 네이티브에서 상태를 로그로 확인하기 위한 조회 함수(읽기 전용)
  root.__bgStatus = function () {
    try {
      const syms = State.symbols || [];
      let latest = 0;
      syms.forEach((s) => {
        const d = State.data[s];
        if (d && d.updatedAt > latest) latest = d.updatedAt;
      });
      return JSON.stringify({
        polling: isPolling,
        symbols: syms.length,
        lastUpdateMsAgo: latest ? Date.now() - latest : null,
        errors: syms.filter((s) => State.errors[s]).length,
      });
    } catch (e) {
      return JSON.stringify({ error: String(e) });
    }
  };

  let pollTimer = null;
  function restartPolling() {
    if (pollTimer) clearInterval(pollTimer);
    updateAll();
    pollTimer = setInterval(updateAll, CONFIG.POLL_INTERVAL_MS);
  }

  /* ---------------- 앱 재진입(lifecycle) 처리 ----------------
     문제: 앱을 백그라운드로 보내면 브라우저/WebView가 진행 중인 fetch를 중단시킨다.
     그 실패가 State.errors[symbol]=true 로 남고, setInterval만 있으면 다음 폴링
     (최대 20초) 까지 화면에 "데이터 로드 실패"가 그대로 표시된다.
     또한 백그라운드에서는 타이머가 지연·정지되므로 복귀 직후 데이터가 낡아 있다.

     해결: 화면이 다시 보이는 순간
       ① 중단으로 생긴 오류 플래그를 해제하고(데이터는 그대로 유지)
       ② 즉시 한 번 갱신하고
       ③ 폴링 타이머를 새로 건다(지연된 타이머 정리 + 중복 방지).
     오류 메시지를 숨기는 것이 아니라, 실제로 데이터를 다시 받아오는 방식이다.
     실제 네트워크 오류라면 이 갱신도 실패하므로 오류 표시는 정상적으로 다시 나타난다. */
  function handleAppResume() {
    // 중단(abort)으로 생긴 오류 플래그만 초기화한다. State.data(가격/신호)와
    // localStorage(학습·기록 데이터)는 전혀 건드리지 않는다.
    State.symbols.forEach((sym) => {
      if (State.errors[sym]) {
        State.errors[sym] = false;
        // 화면은 기존에 받아둔 데이터로 즉시 되돌려 놓는다(빈 화면 방지).
        if (State.data[sym]) UI.renderRow(sym, State.data[sym], false);
      }
    });
    // 즉시 갱신 + 타이머 재설정. updateAll 내부의 isPolling 가드가 중복 실행을 막는다.
    restartPolling();
  }

  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") handleAppResume();
    });
  }
  // 일부 Android WebView / iOS Safari는 visibilitychange를 놓치는 경우가 있어
  // window focus / pageshow 도 함께 듣는다(중복 호출은 isPolling 가드가 흡수).
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("focus", () => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") handleAppResume();
    });
    window.addEventListener("pageshow", () => handleAppResume());
  }

  /* ---------------- Notifications ---------------- */
  function fireNotification(symbol, direction, score, price, detail) {
    if (!State.notifyEnabled || !("Notification" in window) || Notification.permission !== "granted") return;
    const label = direction === "long" ? UI.t("watchLong") : UI.t("watchShort");
    // detail이 있으면 상세 본문(점수·가격·타임프레임 상태·신뢰도)을 사용하고,
    // 없으면 기존과 동일한 본문을 그대로 쓴다(하위호환).
    const title = detail && detail.title ? detail.title : `${symbol} \u2014 ${label}`;
    const body =
      detail && detail.notificationBody
        ? detail.notificationBody
        : `${UI.t("score")}: ${score} \u00b7 ${UI.t("price")}: ${UI.formatPrice(price)}`;
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, { body, tag: symbol + "-" + direction }));
    } else {
      new Notification(title, { body });
    }
  }

  // 알림 ON/OFF 실제 토글: 표시 상태와 실제 알림 발송 여부가 항상 일치하도록
  // State.notifyEnabled 하나로만 판단한다 (fireNotification도 이 값을 확인함).
  document.getElementById("notifyBtn").addEventListener("click", async () => {
    if (State.notifyEnabled) {
      // ON -> OFF: 브라우저 권한은 그대로 두고, 우리 쪽 발송 스위치만 끈다.
      State.saveNotify(false);
      UI.renderNotifyBtn();
      return;
    }
    // OFF -> ON
    if (!("Notification" in window)) {
      alert(UI.t("notifyUnsupported"));
      return;
    }
    if (Notification.permission === "granted") {
      State.saveNotify(true);
    } else if (Notification.permission === "denied") {
      alert(UI.t("notifyPermissionDenied"));
      State.saveNotify(false);
    } else {
      const perm = await Notification.requestPermission();
      State.saveNotify(perm === "granted");
    }
    UI.renderNotifyBtn();
  });

  /* ---------------- 백그라운드 감시 (Android 전용) ----------------
     화면이 꺼지거나 앱이 백그라운드로 가도 기존 신호 감시/자가학습이 계속 돌도록
     Foreground Service를 켜고 끈다. 신호 계산/자가학습 로직 자체는 전혀 건드리지 않는다.
     웹(GitHub Pages)에서는 BackgroundMonitor.isSupported()가 false라서 버튼 자체가 숨겨진다. */
  document.getElementById("bgMonitorBtn").addEventListener("click", async () => {
    if (State.bgMonitorEnabled) {
      await root.BackgroundMonitor.stop();
      State.saveBgMonitor(false);
    } else {
      const ok = await root.BackgroundMonitor.start();
      State.saveBgMonitor(ok);
    }
    UI.renderBgMonitorBtn();
  });

  /* ---------------- 자가학습 ON/OFF ----------------
     ON: 새 신호/Lock-in 결과를 학습 데이터에 저장 + 기존 학습 데이터를 신호 신뢰도에 반영.
     OFF: 새 데이터 저장 중단 + 기존 데이터도 신호 판단에 반영 안 함(단, 데이터 자체는 삭제 안 함).
     실제 게이트는 patternLearn.js의 isEnabled() 한 곳에서만 처리하므로, 여기서는 상태만 바꾸고
     화면만 다시 그린다. */
  document.getElementById("learnBtn").addEventListener("click", () => {
    State.saveLearnEnabled(!State.learnEnabled);
    UI.renderLearnPanel();
  });

  /* ---------------- 신호 알림 필터 ON/OFF ----------------
     OFF로 바꾸면 다음 신호부터 즉시 알림이 걸러지지 않는다(앱 재시작 불필요).
     자가학습(learnEnabled)은 전혀 건드리지 않으며, 학습·기록·성능 측정은 계속된다. */
  document.getElementById("signalFilterBtn").addEventListener("click", () => {
    State.saveSignalFilter(State.signalFilterEnabled === false);
    UI.renderSignalFilterBtn();
  });

  /* ---------------- 종합 신뢰도 필터 ON/OFF + 최소 기준 ----------------
     기존 신호 필터와 독립된 설정이다. 다음 신호부터 즉시 반영되며,
     학습·기록·성능 측정은 이 설정과 무관하게 계속된다. */
  document.getElementById("confFilterBtn").addEventListener("click", () => {
    State.saveConfFilter(State.confFilterEnabled !== true);
    UI.renderConfFilter();
  });

  document.getElementById("confFilterMinRange").addEventListener("input", (e) => {
    State.saveConfFilterMin(e.target.value);
    UI.renderConfFilter();
  });

  // 차단 이력 지우기 — 전용 저장소만 비우므로 학습/성능/거래 데이터에는 영향이 없다.
  document.getElementById("confBlockClearBtn").addEventListener("click", () => {
    if (confirm(UI.t("confBlockClearConfirm"))) {
      root.ConfBlockLog.clear();
      UI.renderConfBlockLog();
    }
  });

  document.getElementById("learnResetBtn").addEventListener("click", () => {
    if (confirm(UI.t("resetLearnConfirm"))) {
      root.PatternLearn.reset(); // 자가학습 데이터/통계만 초기화. 거래 기록/Lock-in 기록/설정/종목은 별도 키라 그대로 유지됨.
      UI.renderLearnPanel();
    }
  });

  /* ---------------- Symbol management ---------------- */
  function addSymbol(raw) {
    const sym = raw.trim().toUpperCase();
    if (!sym) return;
    if (State.symbols.includes(sym)) {
      alert(UI.t("already"));
      return;
    }
    if (State.symbols.length >= CONFIG.MAX_SYMBOLS) {
      alert(UI.t("limitReached"));
      return;
    }
    const category = UI.getSelectedCategory(); // 추가 폼에서 선택한 카테고리(코인/주식 선물)
    State.setCategory(sym, category);
    State.saveSymbols([...State.symbols, sym]);
    UI.renderChips();
    UI.maybeShowEmpty();
    updateSymbol(sym);
    // 참고: 이 종목의 과거 자가학습 데이터(있다면)는 종목명 기준으로 그대로 이어서 사용된다 —
    // 감시 목록 추가/삭제와 학습 데이터는 완전히 별개로 관리되기 때문(요구사항 7).
  }

  function removeSymbol(sym) {
    // 감시 목록에서만 제거한다. 이 종목의 자가학습 데이터(PatternLearn)는 절대 건드리지 않는다 —
    // "감시 목록 삭제"와 "학습 데이터 삭제"는 완전히 별개 기능이다(요구사항 7).
    State.saveSymbols(State.symbols.filter((s) => s !== sym));
    delete State.data[sym];
    UI.removeRow(sym);
    UI.renderChips();
    UI.maybeShowEmpty();
  }

  document.getElementById("addForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("symbolInput");
    addSymbol(input.value);
    input.value = "";
  });

  document.getElementById("chipList").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-sym]");
    if (btn) {
      // 실수로 지우는 것을 막기 위한 확인창 (요구사항 6)
      if (confirm(UI.tp("removeSymbolConfirm", { symbol: btn.dataset.sym }))) removeSymbol(btn.dataset.sym);
    }
  });

  // 메인 화면 종목 카드의 삭제 버튼 (설정 패널을 열지 않고 바로 삭제할 수 있게)
  document.getElementById("list").addEventListener("click", (e) => {
    const btn = e.target.closest("button.row-del[data-sym]");
    if (btn) {
      e.stopPropagation(); // 상세화면이 함께 열리지 않도록
      if (confirm(UI.tp("removeSymbolConfirm", { symbol: btn.dataset.sym }))) removeSymbol(btn.dataset.sym);
    }
  });

  /* ---------------- Language ---------------- */
  document.getElementById("langToggle").addEventListener("click", () => {
    State.saveLang(State.lang === "ko" ? "en" : "ko");
    UI.applyI18n();
  });

  /* ---------------- Detail view: back + timeframe tabs ---------------- */
  document.getElementById("detailBack").addEventListener("click", UI.closeDetail);

  document.querySelectorAll(".tf-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      State.detailTab = btn.dataset.tf;
      UI.renderTfTabs();
      const sym = document.getElementById("detailSym").textContent;
      if (State.data[sym]) UI.renderDetail(sym);
    });
  });

  document.getElementById("settingsBtn").addEventListener("click", () => {
    document.getElementById("settingsPanel").classList.toggle("open");
  });

  /* ---------------- Hamburger menu (☰): 신호 창 / 내 기록 전환 ---------------- */
  document.getElementById("menuBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    UI.toggleMenu();
  });
  document.getElementById("menuCoinBtn").addEventListener("click", () => UI.switchView("coin"));
  document.getElementById("menuStockBtn").addEventListener("click", () => UI.switchView("stock"));
  document.getElementById("menuRecordsBtn").addEventListener("click", () => UI.switchView("records"));
  document.getElementById("menuPerfBtn").addEventListener("click", () => UI.switchView("performance"));

  // 신호 성능 화면의 시장/점수 필터
  document.getElementById("perfMarketFilter").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-market]");
    if (btn) UI.setPerfFilter("market", btn.dataset.market);
  });
  document.getElementById("perfScoreFilter").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-score]");
    if (btn) UI.setPerfFilter("score", btn.dataset.score);
  });
  document.addEventListener("click", (e) => {
    const dd = document.getElementById("menuDropdown");
    if (dd.classList.contains("open") && !dd.contains(e.target) && e.target.id !== "menuBtn") {
      UI.toggleMenu(false);
    }
  });

  /* ---------------- LOCK IN / 기록 / UNLOCK ----------------
     LOCK   : 종목을 "잠금"하고 그 순간 가격을 락인 가격으로 저장할 뿐, 추적은 시작하지 않는다.
              (다른 종목 알림 차단은 State.lock만으로 이미 동작 — updateSymbol() 참고)
     기록   : "기록" 버튼을 눌러야 그 순간부터 State.recording으로 최고가/최저가/손익률 추적 시작.
     UNLOCK : 기록 중이었다면 구간을 확정해 State.lockRecords에 저장. State.lock/State.recording을 모두
              초기화해서 다른 종목을 다시 LOCK할 수 있게 한다 (요구사항 8).
     State.lock(잠금)과 State.recording(기록 중)은 서로 다른 상태이며(요구사항 9),
     State.notifyEnabled(알림 ON/OFF)와도 완전히 분리되어 있어 서로 영향을 주지 않는다. */
  function genRecordId() {
    return "rec" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  document.getElementById("lockBtn").addEventListener("click", () => {
    try {
      const symbol = document.getElementById("detailSym").textContent;
      const cur = State.data[symbol];

      if (State.lock && State.lock.symbol === symbol) {
        // UNLOCK: 기록 중이었고, 10초 이상 지속됐을 때만 구간을 확정해서 저장한다 (요구사항 4).
        if (State.recording && State.recording.symbol === symbol) {
          const durationMs = Date.now() - State.recording.lockedAt;
          if (durationMs >= CONFIG.MIN_RECORD_DURATION_MS) {
            const unlockPrice = cur ? cur.price : null;
            const confirmed = root.LockRange.confirm(State.recording, symbol, unlockPrice); // 기존 손익 계산 구조 그대로 재사용
            confirmed.id = genRecordId();
            confirmed.direction = State.recording.direction || "long";
            confirmed.leverage = State.recording.leverage || 1;
            // 레버리지 반영 최종 손익률: LONG = 가격변동% × 레버리지, SHORT = 가격변동% × -1 × 레버리지
            confirmed.finalPnlPercent =
              confirmed.endPnlPercent == null
                ? null
                : confirmed.endPnlPercent * confirmed.leverage * (confirmed.direction === "short" ? -1 : 1);
            State.addLockRecord(confirmed); // signals와 완전히 분리된 저장소(records 전용, 요구사항 5)
            // 자가학습 연결: 기존 거래 기록은 그대로 두고, 자가학습 데이터에도 결과를 복사해서 반영한다.
            // (OFF 상태면 PatternLearn.recordLockResult() 내부에서 아무 것도 하지 않음)
            root.PatternLearn.recordLockResult({
              symbol,
              direction: confirmed.direction,
              conditions: State.recording.conditions,
              pnlPercent: confirmed.finalPnlPercent != null ? confirmed.finalPnlPercent : confirmed.endPnlPercent,
            });
          }
          // 10초 미만이면 아무 것도 저장하지 않고 그냥 폐기 (거래 기록/통계/학습 데이터 전부 미포함)
        }
        State.saveRecording(null);
        State.saveLock(null); // 전체 종목 알림 재개 + 다른 종목을 다시 LOCK할 수 있도록 완전 초기화
      } else {
        // LOCK IN: 현재가가 아직 없으면(데이터 로딩 전) 잠글 수 없다
        if (!cur || !Number.isFinite(cur.price)) {
          alert(UI.t("loadError"));
          return;
        }
        State.saveLock({ symbol, basePrice: cur.price, lockedAt: Date.now() }); // 추적은 아직 시작 안 함
      }
      UI.renderRow(symbol, State.data[symbol], false);
      UI.renderDetail(symbol);
    } catch (err) {
      console.error("lockBtn click failed", err);
    }
  });

  // "기록 시작" 클릭 → 바로 기록을 시작하지 않고 LONG/SHORT + 레버리지 선택 모달을 먼저 연다 (요구사항 3/4).
  let leverageModalSymbol = null;
  document.getElementById("recordStartBtn").addEventListener("click", () => {
    try {
      const symbol = document.getElementById("detailSym").textContent;
      if (!State.lock || State.lock.symbol !== symbol) return; // LOCK 안 된 상태면 무시
      if (State.recording && State.recording.symbol === symbol) return; // 이미 기록 중
      leverageModalSymbol = symbol;
      document.getElementById("leverageModal").classList.add("open");
    } catch (err) {
      console.error("recordStartBtn click failed", err);
    }
  });

  document.querySelectorAll("#leverageModal .lev-dir-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#leverageModal .lev-dir-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  document.getElementById("leverageCancel").addEventListener("click", () => {
    leverageModalSymbol = null;
    document.getElementById("leverageModal").classList.remove("open");
  });

  document.getElementById("leverageConfirm").addEventListener("click", () => {
    try {
      const symbol = leverageModalSymbol;
      document.getElementById("leverageModal").classList.remove("open");
      if (!symbol || !State.lock || State.lock.symbol !== symbol) return; // 그 사이 UNLOCK 등으로 상태가 바뀌었으면 무시
      const cur = State.data[symbol];
      if (!cur || !Number.isFinite(cur.price)) {
        alert(UI.t("loadError"));
        return;
      }
      const direction = document.querySelector("#leverageModal .lev-dir-btn.active").dataset.dir;
      const leverage = parseInt(document.getElementById("leverageSelect").value, 10) || 1;

      const rec = root.LockRange.start(cur.price); // { basePrice, high, low, lockedAt } — lockRange.js 그대로 재사용
      rec.symbol = symbol;
      rec.direction = direction;
      rec.leverage = leverage;
      // 자가학습 연결용: 기록 시작 시점의 지표 조건 스냅샷(선택한 방향 기준)을 함께 저장해둔다.
      // 기존 신호 계산(signals.js)에는 전혀 손대지 않고, 이미 계산되어 있는 조건을 그대로 참조만 한다.
      rec.conditions = (direction === "short" ? cur.short : cur.long).conditions;
      State.saveRecording(rec);
      UI.renderDetail(symbol);
    } catch (err) {
      console.error("leverageConfirm click failed", err);
    }
  });

  /* ---------------- 내 기록: 거래 추가/청산/분석 ---------------- */
  document.getElementById("recordEntryBtn").addEventListener("click", () => {
    UI.openAddTradeModal();
  });
  document.getElementById("addTradeBtn").addEventListener("click", () => {
    UI.openAddTradeModal();
  });
  document.getElementById("addTradeCancel").addEventListener("click", UI.closeAddTradeModal);

  document.querySelectorAll(".dir-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".dir-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  document.getElementById("tradeSymbolSelect").addEventListener("change", (e) => {
    const cur = State.data[e.target.value];
    document.getElementById("tradeEntryPrice").value = cur ? cur.price : "";
  });

  document.getElementById("addTradeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const symbol = document.getElementById("tradeSymbolSelect").value;
    const direction = document.querySelector(".dir-btn.active").dataset.dir;
    const entryPrice = parseFloat(document.getElementById("tradeEntryPrice").value);
    const notional = parseFloat(document.getElementById("tradeNotional").value) || CONFIG.DEFAULT_TRADE_NOTIONAL;
    if (!symbol || !entryPrice) return;
    root.TradeLog.addEntry({ symbol, direction, entryPrice, notional, snapshotResult: State.data[symbol] });
    UI.closeAddTradeModal();
    UI.renderRecordsView();
  });

  document.getElementById("tradeList").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "close-trade") UI.openCloseTradeModal(btn.dataset.id);
    if (btn.dataset.action === "analyze-trade") UI.openAnalysisModal(btn.dataset.id);
  });

  // 기록창의 LOCK 기록(records) 삭제 — 신호 데이터(signals)와는 완전히 분리된 저장소이므로
  // 여기서 지워도 SignalLog/State.data에는 아무 영향이 없다 (요구사항 5/7).
  document.getElementById("lockRecordList").addEventListener("click", (e) => {
    const btn = e.target.closest('button[data-action="delete-lock-record"]');
    if (!btn) return;
    if (confirm(UI.t("deleteRecordConfirm"))) {
      State.removeLockRecord(btn.dataset.id);
      UI.renderRecordsView();
    }
  });

  document.getElementById("closeTradeCancel").addEventListener("click", UI.closeCloseTradeModal);
  document.getElementById("closeTradeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const id = UI.getCloseTradeTargetId();
    const exitPrice = parseFloat(document.getElementById("tradeExitPrice").value);
    if (!id || !exitPrice) return;
    root.TradeLog.closeTrade(id, exitPrice);
    UI.closeCloseTradeModal();
    UI.renderRecordsView();
  });

  document.getElementById("analysisClose").addEventListener("click", UI.closeAnalysisModal);

  /* ---------------- Install prompt (PWA) ---------------- */
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById("installBanner").classList.add("show");
  });
  document.getElementById("installBtn").addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    document.getElementById("installBanner").classList.remove("show");
  });
  document.getElementById("installDismiss").addEventListener("click", () => {
    document.getElementById("installBanner").classList.remove("show");
  });

  /* ---------------- Service worker ---------------- */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((err) => console.error("SW register failed", err));
    });
  }

  /* ---------------- MACD legend colors (charts.js를 단일 기준으로 사용) ---------------- */
  function applyLegendColors() {
    const difDot = document.getElementById("legendDifDot");
    const deaDot = document.getElementById("legendDeaDot");
    if (difDot) difDot.style.background = root.Charts.MACD_COLORS.dif;
    if (deaDot) deaDot.style.background = root.Charts.MACD_COLORS.dea;
    const longDot = document.getElementById("legendLongDot");
    const shortDot = document.getElementById("legendShortDot");
    if (longDot) longDot.style.background = root.Charts.SIGNAL_COLORS.long;
    if (shortDot) shortDot.style.background = root.Charts.SIGNAL_COLORS.short;
  }

  /* ---------------- Init ---------------- */
  function init() {
    // 새로고침 후에도 "표시 상태 = 실제 알림 가능 상태"가 어긋나지 않도록 동기화한다.
    // (예: 브라우저 설정에서 알림 권한을 나중에 껐다면, 켜짐으로 남아있던 상태를 자동으로 끈다)
    if (State.notifyEnabled && (!("Notification" in window) || Notification.permission !== "granted")) {
      State.saveNotify(false);
    }
    // 요구사항 9: 감시 목록에서 실재하지 않는 심볼(ANTROPICUSDT 등)을 자동 제거한다.
    // 이 심볼은 코드에 하드코딩된 적이 없고 사용자가 직접 추가해 localStorage에 남아있던 것이므로,
    // 여기서 목록에서만 제거한다. 학습 데이터(PatternLearn)는 별도 저장소이므로 전혀 삭제되지 않는다.
    State.purgeSymbols(CONFIG.PURGE_SYMBOLS);

    UI.applyI18n();
    // 저장된 페이지가 구버전 값('signals')이면 코인 선물 페이지로 넘긴다(마이그레이션).
    UI.switchView(
      ["stock", "records", "performance"].includes(State.view) ? State.view : "coin"
    );
    UI.renderTfTabs();
    applyLegendColors();

    // 백그라운드 감시 버튼: Android 앱(Capacitor)에서만 보이게 하고, 이전에 켜둔 상태였다면
    // 앱을 다시 열었을 때 서비스가 계속 살아있도록(또는 재시작되도록) 맞춰준다.
    const bgSupported = root.BackgroundMonitor.isSupported();
    document.getElementById("bgMonitorRow").style.display = bgSupported ? "" : "none";
    if (bgSupported && State.bgMonitorEnabled) {
      root.BackgroundMonitor.start(); // 이미 실행 중이면 네이티브 쪽에서 별다른 부작용 없이 무시됨
    }
    UI.renderBgMonitorBtn();

    UI.renderLearnPanel(); // 자가학습 ON/OFF 상태 + 통계 표시 초기화

    restartPolling();
    window.addEventListener("resize", () => {
      Object.keys(State.data).forEach((sym) => UI.renderRow(sym, State.data[sym], false));
      if (document.getElementById("detailView").classList.contains("open")) {
        UI.renderDetail(document.getElementById("detailSym").textContent);
      }
    });
  }

  init();
})(typeof window !== "undefined" ? window : globalThis);
