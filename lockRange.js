/* =========================================================================
   LockRange
   LOCK IN ~ UNLOCK 구간의 기준가/최고가/최저가를 계산하는 순수 로직만 모아둔다.
   DOM이나 상태 저장(localStorage)에는 관여하지 않는다 — app.js가 이 함수들로
   계산한 결과를 State.lock / State.lastLockRange에 저장하고,
   ui.js는 여기 있는 pctChange()로 화면에 보여줄 변동률을 계산한다.
   이렇게 분리해두면 브라우저 없이도(Node 테스트) 계산 로직을 검증할 수 있다.
   ========================================================================= */
(function (root) {
  // LOCK 시작: 기준가 = 최고가 = 최저가 = 그 순간 가격
  function start(price, lockedAt) {
    return { basePrice: price, high: price, low: price, lockedAt: lockedAt || Date.now() };
  }

  // 매 갱신마다 새 가격을 반영해 최고가/최저가를 갱신한다.
  // 변경이 없으면 원본 객체를 그대로 반환해서 불필요한 저장을 피할 수 있게 한다.
  function update(lock, price) {
    if (!lock || !Number.isFinite(price)) return lock;
    let next = lock;
    if (price > next.high) next = Object.assign({}, next, { high: price });
    if (price < next.low) next = Object.assign({}, next, { low: price });
    return next;
  }

  // UNLOCK 시점에 구간을 확정한다.
  // 가격 구간(최고/최저)뿐 아니라 손익률(최고/최저/종료 시점)도 함께 계산해서 저장한다.
  // 손익률은 항상 "기록 시작가"(= LOCK 시점 가격, basePrice) 기준으로 계산한다.
  function confirm(lock, symbol, unlockPrice, unlockedAt) {
    const endPrice = Number.isFinite(unlockPrice) ? unlockPrice : null;
    const endAt = unlockedAt || Date.now();
    return {
      symbol,
      // 가격
      basePrice: lock.basePrice,      // 락인 가격 = 기록 시작가 (동일 값)
      startPrice: lock.basePrice,     // 기록 시작가 (별칭)
      endPrice,                       // 기록 종료가 (= 언락가)
      unlockPrice: endPrice,          // 언락가 (별칭, 기존 필드명 유지)
      high: lock.high,                // 구간 최고가
      low: lock.low,                  // 구간 최저가
      // 손익률 — 전부 startPrice(기록 시작가) 기준
      maxPnlPercent: pctChange(lock.basePrice, lock.high),
      minPnlPercent: pctChange(lock.basePrice, lock.low),
      endPnlPercent: pctChange(lock.basePrice, endPrice),
      // 시간
      lockedAt: lock.lockedAt,        // 기록 시작 시간
      recordStartAt: lock.lockedAt,   // 별칭
      unlockedAt: endAt,              // 기록 종료 시간
      recordEndAt: endAt,
    };
  }

  // 기준가 대비 변동률(%). 값이 없거나 계산할 수 없으면 null.
  function pctChange(base, val) {
    if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(val)) return null;
    return ((val - base) / base) * 100;
  }

  root.LockRange = { start, update, confirm, pctChange };
})(typeof window !== "undefined" ? window : globalThis);
