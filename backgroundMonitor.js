/* =========================================================================
   BackgroundMonitor (JS 래퍼)
   Android 앱(Capacitor)에서만 실제로 동작한다. 웹(GitHub Pages 등)에서는
   window.Capacitor가 없으므로 isSupported()가 false를 반환하고 start/stop은
   아무 일도 하지 않는다 — 기존 웹 버전 동작에는 전혀 영향이 없다.
   ========================================================================= */
(function (root) {
  function isSupported() {
    return !!(
      root.Capacitor &&
      typeof root.Capacitor.isNativePlatform === "function" &&
      root.Capacitor.isNativePlatform() &&
      root.Capacitor.Plugins &&
      root.Capacitor.Plugins.BackgroundMonitor
    );
  }

  async function start() {
    if (!isSupported()) return false;
    try {
      await root.Capacitor.Plugins.BackgroundMonitor.start();
      return true;
    } catch (e) {
      console.error("BackgroundMonitor.start failed", e);
      return false;
    }
  }

  async function stop() {
    if (!isSupported()) return false;
    try {
      await root.Capacitor.Plugins.BackgroundMonitor.stop();
      return true;
    } catch (e) {
      console.error("BackgroundMonitor.stop failed", e);
      return false;
    }
  }

  root.BackgroundMonitor = { isSupported, start, stop };
})(typeof window !== "undefined" ? window : globalThis);
