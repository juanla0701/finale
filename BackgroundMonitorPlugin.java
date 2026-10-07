package com.juanla0701.futuresignal;

import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS(app.js)에서 window.Capacitor.Plugins.BackgroundMonitor.start()/stop() 로 호출한다.
 * 기존 신호/자가학습 로직은 전혀 새로 만들지 않는다 — 이 플러그인은 단지
 * MonitorForegroundService를 켜고 끄는 스위치 역할만 한다.
 *
 * handleOnResume()/handleOnPause()는 Capacitor가 앱(Activity)이 포그라운드/백그라운드로
 * 전환될 때 모든 등록된 플러그인에 자동으로 호출해준다 (MainActivity 추가 수정 불필요).
 * 이걸 이용해 "앱이 화면에 보이는 동안에는 Service의 WebView를 일시정지"시켜서
 * Activity의 WebView와 동시에 폴링하는 중복 실행을 막는다.
 */
@CapacitorPlugin(name = "BackgroundMonitor")
public class BackgroundMonitorPlugin extends Plugin {

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        MonitorForegroundService.notifyAppForeground(); // 화면에 앱이 보이는 동안엔 백그라운드 WebView 일시정지
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        MonitorForegroundService.notifyAppBackground(); // 앱이 백그라운드로 가면 그때부터 백그라운드 WebView 재개
    }

    @PluginMethod
    public void start(PluginCall call) {
        Intent intent = new Intent(getContext(), MonitorForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        MonitorForegroundService.userRequestedStop(getContext());
        getContext().stopService(new Intent(getContext(), MonitorForegroundService.class));
        call.resolve();
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", MonitorForegroundService.isRunning);
        call.resolve(ret);
    }
}
