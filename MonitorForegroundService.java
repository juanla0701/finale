package com.juanla0701.futuresignal;

import android.annotation.TargetApi;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.core.app.NotificationCompat;
import java.lang.ref.WeakReference;

/**
 * 왜 이렇게 만들었나:
 * Android WebView는 화면(Activity)이 안 보이면 JS 타이머(setInterval)가 멈추거나 심하게
 * 제한되는 게 기본 동작이라, Foreground Service만 띄운다고 기존 app.js의 폴링이 계속
 * 도는 게 아니다. 그래서 이 서비스 안에 "화면에 그리지 않는" WebView를 하나 더 띄워서
 * 기존 index.html을 그대로 로드하고, 그 WebView 안에서 기존 신호 감시/자가학습 JS가
 * 계속 실행되게 한다.
 *
 * 같은 앱 프로세스 안의 WebView들은 기본적으로 localStorage를 공유하므로
 * (별도 data directory를 지정하지 않는 한), 여기서 쌓인 State/기록/학습 데이터는
 * 사용자가 앱(Activity)을 다시 열면 그대로 이어서 보인다.
 *
 * ── 백그라운드 10분 후 감시가 멈추던 문제와 수정 내용 ──────────────────────────
 *
 * (1) pauseTimers()/resumeTimers()는 "프로세스 전역"이다.
 *     WebView 문서에 명시된 대로 이 두 메서드는 특정 WebView가 아니라 앱 안의 모든
 *     WebView의 JS 타이머를 멈추고/재개한다. 기존 코드는 앱이 포그라운드로 올 때
 *     서비스 WebView를 "일시정지"하려고 pauseTimers()를 불렀는데, 그 순간 화면에 떠 있는
 *     Activity WebView의 타이머까지 같이 멈췄다. 포그라운드/백그라운드 전환이 몇 번
 *     엇갈리면 전역 타이머가 정지된 채로 남아 감시가 완전히 중단됐다.
 *     → 이제 전역 메서드를 쓰지 않고, 해당 WebView에만 적용되는 onPause()/onResume()과
 *       "네이티브 하트비트 on/off"로 중복 폴링을 제어한다.
 *
 * (2) JS 타이머에 의존한 폴링.
 *     Chromium은 화면에 보이지 않는 페이지의 타이머를 수 분 뒤부터 강하게 제한한다
 *     (분당 1회 수준으로 줄었다가 사실상 멈춤). 서비스 WebView는 윈도우에 붙어 있지 않아
 *     항상 "비가시" 상태이므로, 처음 몇 분은 돌다가 이후 폴링이 끊겼다.
 *     → 이제 폴링 주기는 네이티브 Handler가 만든다. 하트비트마다
 *       evaluateJavascript("__bgTick()")로 JS 폴링 1회를 직접 호출하므로
 *       JS 타이머가 제한되어도 감시가 계속된다.
 *
 * (3) Doze 모드.
 *     화면이 꺼진 채 시간이 지나면 Doze에 들어가 Handler가 지연될 수 있다.
 *     → AlarmManager 워치독(setAndAllowWhileIdle)이 주기적으로 깨워 하트비트가
 *       멈춰 있으면 되살린다. 정확 알람 권한이 필요 없는 API만 사용한다.
 */
public class MonitorForegroundService extends Service {

    private static final String TAG = "SignalMonitor";

    static final String CHANNEL_ID = "signal_monitor_channel";
    static final int NOTIF_ID = 1001;
    private static final String PREFS = "bg_monitor_prefs";
    private static final String KEY_SHOULD_RUN = "should_run";

    static final String ACTION_WATCHDOG = "com.juanla0701.futuresignal.WATCHDOG";

    // 하트비트 주기: 기존 JS 폴링 주기(CONFIG.POLL_INTERVAL_MS = 20초)와 동일하게 맞춘다.
    private static final long HEARTBEAT_INTERVAL_MS = 20 * 1000L;
    // 워치독 주기: 배터리를 아끼려고 하트비트보다 훨씬 길게 잡는다.
    private static final long WATCHDOG_INTERVAL_MS = 5 * 60 * 1000L;
    // 이 시간 동안 하트비트가 한 번도 안 돌았으면 멈춘 것으로 보고 되살린다.
    private static final long HEARTBEAT_STALL_MS = 90 * 1000L;

    // WakeLock 타임아웃/갱신 주기: 타임아웃보다 여유 있게 미리 갱신해서 장시간(수시간) 감시 중
    // WakeLock이 만료되어 CPU가 슬립 모드로 빠지는 일이 없게 한다.
    private static final long WAKE_LOCK_TIMEOUT_MS = 40 * 60 * 1000L; // 40분
    private static final long WAKE_LOCK_RENEW_INTERVAL_MS = 30 * 60 * 1000L; // 30분마다 갱신

    public static volatile boolean isRunning = false;
    private static volatile WeakReference<MonitorForegroundService> activeInstance;

    private WebView webView;
    private PowerManager.WakeLock wakeLock;
    private final Handler handler = new Handler(Looper.getMainLooper());

    // 앱(Activity)이 화면에 보이는 동안에는 네이티브 하트비트를 돌리지 않는다.
    // Activity WebView가 이미 폴링 중이므로 중복 요청이 되기 때문이다.
    private volatile boolean appInForeground = true;
    private volatile boolean heartbeatScheduled = false;
    private volatile long lastHeartbeatAt = 0L;
    private volatile boolean pageReady = false;

    private final Runnable wakeLockRenewRunnable = new Runnable() {
        @Override
        public void run() {
            acquireWakeLock(); // setReferenceCounted(false) 상태라 재호출 시 타임아웃이 다시 연장됨
            handler.postDelayed(this, WAKE_LOCK_RENEW_INTERVAL_MS);
        }
    };

    // 네이티브 하트비트: JS 타이머가 제한돼도 이 루프가 폴링을 돌린다.
    private final Runnable heartbeatRunnable = new Runnable() {
        @Override
        public void run() {
            heartbeatScheduled = false;
            if (!appInForeground) {
                tickJs();
                scheduleHeartbeat();
            }
        }
    };

    static void userRequestedStop(Context ctx) {
        prefs(ctx).edit().putBoolean(KEY_SHOULD_RUN, false).apply();
    }

    private static boolean shouldRun(Context ctx) {
        return prefs(ctx).getBoolean(KEY_SHOULD_RUN, false);
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // BackgroundMonitorPlugin의 handleOnResume()/handleOnPause()에서 호출된다.
    static void notifyAppForeground() {
        MonitorForegroundService svc = activeInstance != null ? activeInstance.get() : null;
        if (svc != null) svc.onAppForeground();
    }

    static void notifyAppBackground() {
        MonitorForegroundService svc = activeInstance != null ? activeInstance.get() : null;
        if (svc != null) svc.onAppBackground();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        activeInstance = new WeakReference<>(this);
        createChannelIfNeeded();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // 워치독 알람으로 깨어난 경우: 서비스는 이미 살아있으니 상태만 점검한다.
        boolean fromWatchdog = intent != null && ACTION_WATCHDOG.equals(intent.getAction());

        prefs(this).edit().putBoolean(KEY_SHOULD_RUN, true).apply();
        startForeground(NOTIF_ID, buildNotification());
        acquireWakeLock();
        handler.removeCallbacks(wakeLockRenewRunnable);
        handler.postDelayed(wakeLockRenewRunnable, WAKE_LOCK_RENEW_INTERVAL_MS);
        ensureWebView();
        scheduleWatchdog();

        if (fromWatchdog) {
            checkHeartbeatAlive();
        } else {
            // 사용자는 항상 앱 화면을 보면서 이 서비스를 켜므로(토글 버튼), 시작 직후에는 앱이
            // 포그라운드 상태라고 가정한다. 실제로 앱이 백그라운드로 가는 순간
            // (BackgroundMonitorPlugin.handleOnPause) onAppBackground()가 하트비트를 시작한다.
            onAppForeground();
        }
        isRunning = true;
        Log.i(TAG, "service started (watchdog=" + fromWatchdog + ", foreground=" + appInForeground + ")");
        return START_STICKY; // 시스템이 프로세스를 죽였다가도 리소스 여유가 생기면 재시작 시도
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        handler.removeCallbacks(wakeLockRenewRunnable);
        stopHeartbeat();
        cancelWatchdog();
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        releaseWakeLock();
        activeInstance = null;
        Log.i(TAG, "service destroyed");
        super.onDestroy();
    }

    // 사용자가 "최근 앱" 목록에서 카드를 스와이프로 지웠을 때 호출된다.
    // (이것은 "정상 종료"가 아니다 — 사용자가 앱 안에서 직접 감시를 끈 경우에만 KEY_SHOULD_RUN이 false가 된다.)
    // 참고: 설정 > 앱 > 강제 종료를 누르면 이 콜백조차 호출되지 않고 OS가 프로세스를 강제로 죽인다.
    // 이건 Android 정책상 앱이 막을 수 없는 부분이라 여기서 해결할 수 없다.
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        if (shouldRun(this)) {
            Log.i(TAG, "task removed - restarting service");
            restartSelf();
        } else {
            stopSelf();
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /* ---------------- WebView ---------------- */

    private void ensureWebView() {
        if (webView != null) return;
        WebView wv = new WebView(getApplicationContext());
        wv.getSettings().setJavaScriptEnabled(true);
        wv.getSettings().setDomStorageEnabled(true);
        wv.getSettings().setDatabaseEnabled(true);
        wv.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                Log.i(TAG, "background page loaded");
            }

            // 렌더러가 메모리 부족 등으로 죽은 경우. true를 돌려주지 않으면 앱 전체가 죽는다.
            // 이 콜백은 API 26+에서만 호출된다.
            @TargetApi(Build.VERSION_CODES.O)
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Log.w(TAG, "render process gone - recreating WebView");
                pageReady = false;
                if (webView != null) {
                    webView.destroy();
                    webView = null;
                }
                ensureWebView();
                if (!appInForeground) startHeartbeat();
                return true; // 앱 프로세스는 살려둔다
            }
        });
        // 기존 웹앱을 그대로 로드 (Capacitor 기본 로컬 서버와 동일한 오리진이어야 localStorage 공유됨)
        wv.loadUrl("https://localhost/index.html");
        wv.onResume(); // 이 WebView에만 적용 (전역 resumeTimers()는 쓰지 않는다)
        webView = wv;
    }

    /* ---------------- 포그라운드/백그라운드 전환 ---------------- */

    // 앱이 화면에 보이는 동안: Activity WebView가 이미 폴링 중이므로 여기 하트비트는 끈다.
    private void onAppForeground() {
        appInForeground = true;
        stopHeartbeat();
        if (webView != null) webView.onPause(); // 이 WebView에만 적용되는 일시정지
        Log.i(TAG, "app foreground - background polling paused");
    }

    // 앱이 백그라운드로 감: 여기서부터 네이티브 하트비트가 감시를 이어받는다.
    private void onAppBackground() {
        appInForeground = false;
        if (webView != null) webView.onResume();
        startHeartbeat();
        Log.i(TAG, "app background - native heartbeat polling started");
    }

    /* ---------------- 하트비트 ---------------- */

    private void startHeartbeat() {
        if (appInForeground) return;
        lastHeartbeatAt = SystemClock.elapsedRealtime();
        tickJs(); // 백그라운드로 내려가자마자 한 번 돌려서 공백을 줄인다
        scheduleHeartbeat();
    }

    private void scheduleHeartbeat() {
        if (appInForeground || heartbeatScheduled) return; // 중복 예약 방지
        heartbeatScheduled = true;
        handler.postDelayed(heartbeatRunnable, HEARTBEAT_INTERVAL_MS);
    }

    private void stopHeartbeat() {
        handler.removeCallbacks(heartbeatRunnable);
        heartbeatScheduled = false;
    }

    // 기존 JS 폴링 1회를 직접 호출한다. JS 쪽 __bgTick()은 내부 isPolling 가드로
    // 이미 진행 중이면 "busy"를 돌려주므로 요청이 겹치지 않는다.
    private void tickJs() {
        final WebView wv = webView;
        if (wv == null || !pageReady) return;
        lastHeartbeatAt = SystemClock.elapsedRealtime();
        try {
            wv.evaluateJavascript(
                    "(function(){try{return (window.__bgTick&&window.__bgTick())+'|'+(window.__bgStatus&&window.__bgStatus());}catch(e){return 'error:'+e;}})()",
                    value -> Log.d(TAG, "tick " + value));
        } catch (Exception e) {
            Log.w(TAG, "tick failed", e);
        }
    }

    /* ---------------- 워치독 ---------------- */

    // Doze 등으로 Handler가 지연/정지되면 하트비트가 멈출 수 있다.
    // 알람으로 주기적으로 깨워서 살아있는지 확인한다.
    // setAndAllowWhileIdle은 정확 알람 권한(SCHEDULE_EXACT_ALARM)이 필요 없고,
    // 최소 간격 제한이 있어 배터리 소모도 과하지 않다.
    private void scheduleWatchdog() {
        AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        try {
            am.setAndAllowWhileIdle(
                    AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    SystemClock.elapsedRealtime() + WATCHDOG_INTERVAL_MS,
                    watchdogIntent());
        } catch (Exception e) {
            Log.w(TAG, "watchdog schedule failed", e);
        }
    }

    private void cancelWatchdog() {
        AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(watchdogIntent());
    }

    private PendingIntent watchdogIntent() {
        Intent i = new Intent(getApplicationContext(), MonitorForegroundService.class);
        i.setAction(ACTION_WATCHDOG);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return PendingIntent.getForegroundService(getApplicationContext(), 2001, i, flags);
        }
        return PendingIntent.getService(getApplicationContext(), 2001, i, flags);
    }

    // 하트비트가 오래 멈춰 있었으면 되살린다(중복 실행은 heartbeatScheduled 가드가 막는다).
    private void checkHeartbeatAlive() {
        if (appInForeground) return;
        long idle = SystemClock.elapsedRealtime() - lastHeartbeatAt;
        if (idle > HEARTBEAT_STALL_MS || !heartbeatScheduled) {
            Log.w(TAG, "heartbeat stalled (" + idle + "ms) - restarting");
            stopHeartbeat();
            ensureWebView();
            startHeartbeat();
        } else {
            Log.d(TAG, "watchdog ok (idle " + idle + "ms)");
        }
    }

    private void restartSelf() {
        Intent restart = new Intent(getApplicationContext(), MonitorForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getApplicationContext().startForegroundService(restart);
        } else {
            getApplicationContext().startService(restart);
        }
    }

    /* ---------------- WakeLock / 알림 ---------------- */

    private void acquireWakeLock() {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FutureSignal:MonitorWakeLock");
            wakeLock.setReferenceCounted(false); // acquire()를 여러 번 호출해도 release() 한 번이면 완전히 풀림 + 매번 타임아웃 재연장
        }
        wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS);
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    private void createChannelIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager mgr = getSystemService(NotificationManager.class);
            if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID, "신호 감시", NotificationManager.IMPORTANCE_LOW);
                channel.setDescription("화면이 꺼져 있어도 신호 감시를 계속합니다");
                mgr.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("선물 신호 감시 실행 중")
                .setContentText("백그라운드에서 신호를 계속 감시하고 있습니다")
                .setSmallIcon(android.R.drawable.ic_menu_view)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }
}
