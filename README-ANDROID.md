# Android 앱 전환 준비 (Capacitor)

## 1. 현재 프로젝트 분석 결과
- 순수 정적 HTML/CSS/JS(빌드 도구 없음), 상대경로(`./`)만 사용 → Capacitor의 `webDir`에
  그대로 넣기 적합한 구조입니다.
- `localStorage` 기반 상태 저장(State, LOCK 기록, 자가학습 데이터 등) → Android WebView에서도
  동일하게 동작합니다.
- Binance 공개 API를 `fetch()`로 직접 호출 → CORS 문제 없이 WebView에서도 동작합니다
  (`AndroidManifest`의 인터넷 권한은 `npx cap add android` 실행 시 기본 템플릿에 포함됩니다).

**패키징 가능 상태 결론: 가능함.** 별도 수정 없이 웹앱 파일을 그대로 감싸면 됩니다.

## 2. 알려진 제약 (이번 단계에서는 손대지 않음)
- **브라우저 알림(`Notification` API)은 Android WebView에서 웹과 동일하게 동작하지 않습니다.**
  실제 네이티브 알림을 쓰려면 추후 `@capacitor/local-notifications` 플러그인이 필요합니다
  (이번 요청은 "백그라운드 서비스는 다음 단계"라고 하셨으므로 지금은 추가하지 않았습니다).
- Service Worker(`sw.js`)는 네이티브 앱 안에서는 사실상 불필요(파일이 이미 앱 안에 번들됨)하지만,
  있어도 동작에 지장은 없어 그대로 두었습니다(수정 금지 원칙 준수).

## 3. 이번에 만든 것 (`android-app/` 폴더, 기존 웹앱과 완전히 분리)
```
android-app/
├── package.json           # Capacitor 의존성만 정의
├── capacitor.config.json  # appId/appName/webDir 설정
├── copy-web.js            # 상위 폴더의 웹앱 파일을 www/로 복사(로직 무수정, 원본 그대로)
├── .gitignore
└── www/                   # 복사된 웹앱 스냅샷 (지금 22개 파일 전부 복사 완료, 원본과 바이트 단위 동일)
```
`android/` 네이티브 프로젝트 폴더는 `npx cap add android` 실행 시 생성됩니다(아래 참고).
이 샌드박스는 외부 네트워크가 막혀 있어 npm 패키지 다운로드가 필요한 이 단계까지는
실행하지 못했습니다 — 아래 명령을 실제 개발 환경(인터넷 연결 + Android Studio 설치)에서
실행해 주세요.

## 4. 실행 방법 (실제 개발 환경에서)
```bash
cd android-app
npm install                 # Capacitor 패키지 설치
npx cap add android         # android/ 네이티브 프로젝트 생성 (최초 1회)
npm run sync                 # 웹앱 최신 파일을 www/에 복사 + android 프로젝트에 반영
npx cap open android         # Android Studio에서 열기 → 빌드/실행
```
앱 이름/패키지 ID를 바꾸고 싶으면 `capacitor.config.json`의 `appId`/`appName`만 수정하면 됩니다.

## 5. 이후 웹앱 파일을 수정했을 때
루트의 웹앱 파일(`index.html`, `app.js` 등)을 고친 뒤에는 `android-app`에서
`npm run sync` 한 번만 다시 실행하면 Android 프로젝트에 최신 내용이 반영됩니다.
루트 파일 자체는 GitHub Pages 배포에 계속 그대로 사용되며 이번 작업으로 전혀 바뀌지 않았습니다.

## 6. 백그라운드 감시 (화면 꺼져도 신호 감시 계속)

### 왜 Foreground Service만으로는 안 되는가
Android WebView는 화면(Activity)이 안 보이면 기본적으로 JS 타이머(`setInterval`)를 멈춥니다.
Foreground Service를 띄우는 것만으로는 기존 `app.js`의 폴링이 계속 도는 게 아닙니다.
그래서 **Service 안에 화면에 안 보이는 WebView를 하나 더 띄워서 기존 `index.html`을 그대로
로드**하는 방식으로 구현했습니다. 신호 계산/자가학습 로직은 전혀 새로 만들지 않았고,
그 WebView 안에서 기존 JS가 그대로 돌아갑니다. 같은 앱 프로세스의 WebView는 기본적으로
localStorage를 공유하므로, 백그라운드에서 쌓인 데이터는 앱을 다시 열면 그대로 보입니다.

### 적용 방법 (`npx cap add android` 실행 후)
1. `native-additions/android/app/src/main/java/.../*.java` 두 파일을
   생성된 `android/app/src/main/java/com/juanla0701/futuresignal/`에 복사
2. `native-additions/android/app/src/main/AndroidManifest-additions.xml`의 내용을
   실제 `android/app/src/main/AndroidManifest.xml`에 병합(권한 4줄 + `<service>` 태그)
3. `native-additions/MainActivity-registration-snippet.txt`대로 `MainActivity.java`에
   플러그인 등록 2줄 추가
4. `npm run sync` → Android Studio에서 빌드

### 사용자 흐름
설정 패널에 "백그라운드 감시" 버튼이 새로 생깁니다(Android 앱에서만 보이고, 웹에서는 숨김).
켜면 알림 상시 표시 + Foreground Service 시작, 끄면 서비스 중지 — 요청 4/5번 그대로입니다.

### ⚠️ 명확한 한계 (억지로 가능하다고 말하지 않음)
- **설정 > 앱 > 강제 종료**를 누르면 Android OS가 프로세스를 통째로 죽입니다. 이건 어떤 앱도
  막을 수 없는 OS 정책이라 이 기능으로 해결할 수 없습니다. (그래서 "정상 종료"는 앱 안에서
  사용자가 버튼으로 끈 경우로, "비정상 종료"는 그 외 모든 경우로 구분해 `onTaskRemoved()`에서
  가능한 만큼만 자동 재시작을 시도합니다.)
- 최근 앱 목록에서 카드를 스와이프로 지우는 것은 강제 종료가 아니므로, 사용자가 명시적으로
  끄지 않았다면 서비스가 자동으로 재시작됩니다.
- 배터리 최적화가 매우 공격적인 일부 제조사(삼성/샤오미 등)는 자체 배터리 관리 앱에서
  "제한 없음" 예외 설정을 추가로 해줘야 안정적으로 유지되는 경우가 있습니다. 이건 Foreground
  Service+WakeLock으로 표준 Android Doze는 대응되지만, 제조사별 커스텀 배터리 관리자는
  코드로 완전히 우회할 수 없는 영역입니다.
- **실제 기기에서 화면 OFF 상태로 장시간 검증은 이 샌드박스에서 할 수 없습니다** (에뮬레이터/기기,
  네트워크 없음). 실제 Android 기기에 설치해서 화면을 꺼둔 채 몇 분 확인해 보시는 걸 권장합니다.

## 7. 점검 결과 (코드 레벨 재검토, 실기기 검증 아님)

### ① 정상 작동하는 부분
- 신호 재연결: fetch 실패 시 다음 폴링(20초 후)에 자동 재시도 — 원래 구조로 이미 정상 처리됨
- 서비스 중복 시작 방지: `startForegroundService()`를 여러 번 호출해도 같은 인스턴스의
  `onStartCommand()`만 다시 불림(Android 자체 특성), `ensureWebView()`/`acquireWakeLock()`
  모두 이미 존재하면 재생성하지 않도록 가드되어 있음
- 정상 종료 시 서비스 종료: `stop()` → `userRequestedStop()`(SharedPreferences 기록) →
  `stopService()` → `onDestroy()`에서 WebView·WakeLock 확실히 해제

### ② 발견된 문제
- **중복 폴링(가장 중요)**: 백그라운드 감시를 켠 채로 화면을 보고 있으면, Activity의 WebView와
  Service의 WebView가 **동시에** Binance API를 호출하고 있었음 → API 호출 2배, 같은 신호가
  두 번 기록/알림될 위험
- **WakeLock 만료 후 미갱신**: 40분~12시간 이상 연속 감시 시 WakeLock이 타임아웃으로 풀리면
  이후 CPU가 슬립에 들어가 폴링이 멈출 수 있었음(재갱신 로직 없었음)

### ③ 수정한 부분 (native-additions 폴더만, 신호/Lock-in/기록/자가학습 JS는 무수정)
- `BackgroundMonitorPlugin.java`: `handleOnResume()`/`handleOnPause()` 추가 →
  앱이 화면에 보이는 동안은 Service의 WebView를 일시정지, 백그라운드로 갈 때만 재개
- `MonitorForegroundService.java`: 위 일시정지/재개 메서드 추가, WakeLock을
  `setReferenceCounted(false)`로 바꾸고 30분마다 자동 재연장하도록 Handler 추가

### ④ Android에서 사용자가 직접 설정해야 하는 항목
- **배터리 최적화 예외**: 설정 > 배터리 > 앱 배터리 사용량 > 이 앱 > "제한 없음"으로 변경
  (삼성/샤오미 등은 자체 배터리 관리 앱에서 한 번 더 예외 설정 필요할 수 있음)
- **알림 권한**: Android 13+에서 최초 실행 시 알림 권한을 허용해야 상시 알림이 표시됨
  (권한을 거부해도 서비스 자체는 계속 동작하지만 알림 아이콘은 안 보일 수 있음)
- 위 두 가지는 앱 코드로 자동 처리할 수 없는 영역이라 사용자가 직접 설정해야 합니다.

## 백그라운드 감시가 유지되는 방식 (중요)

화면이 꺼진 뒤에도 감시가 끊기지 않도록 다음 구조로 동작합니다.

1. **폴링 주기는 네이티브가 만든다.**
   Chromium은 화면에 보이지 않는 페이지의 JS 타이머를 수 분 뒤부터 강하게 제한합니다
   (분당 1회로 줄었다가 사실상 멈춤). 그래서 백그라운드에서는 `setInterval`에 의존하지 않고,
   `MonitorForegroundService`의 네이티브 Handler가 20초마다
   `evaluateJavascript("__bgTick()")`로 기존 폴링 함수를 직접 호출합니다.

2. **전역 타이머 API는 쓰지 않는다.**
   `WebView.pauseTimers()/resumeTimers()`는 앱 안의 **모든** WebView에 적용됩니다.
   이걸로 서비스 WebView만 멈추려 하면 화면 쪽 WebView의 폴링까지 같이 멈춥니다.
   지금은 해당 WebView에만 적용되는 `onPause()/onResume()`과 하트비트 on/off로 제어합니다.

3. **중복 폴링 방지.**
   앱이 화면에 보이는 동안에는 하트비트를 끄고(Activity WebView가 폴링 담당),
   백그라운드로 가면 하트비트가 이어받습니다. JS 쪽 `__bgTick()`도 `isPolling` 가드로
   이미 진행 중이면 건너뜁니다.

4. **Doze/종료 대비.**
   `AlarmManager.setAndAllowWhileIdle`(정확 알람 권한 불필요)로 5분마다 깨워
   하트비트가 90초 이상 멈춰 있으면 되살립니다. 서비스는 `START_STICKY`,
   작업 목록에서 지워지면 `onTaskRemoved`에서 재시작, 렌더러가 죽으면
   `onRenderProcessGone`에서 WebView를 다시 만듭니다.

### 로그 확인

```
adb logcat -s SignalMonitor
```

- `app background - native heartbeat polling started` : 백그라운드 감시 시작
- `tick "ok"|{"polling":false,"symbols":5,"lastUpdateMsAgo":1234,...}` : 폴링 1회 성공
- `tick "busy"|...` : 이전 폴링이 아직 진행 중이라 건너뜀(정상)
- `heartbeat stalled (...) - restarting` : 워치독이 하트비트를 되살림
- `render process gone - recreating WebView` : 렌더러 크래시 복구

### 기기 설정 (사용자가 직접 해야 하는 부분)

제조사 배터리 최적화는 앱이 코드로 우회할 수 없습니다. 감시가 계속 필요하면
**설정 → 앱 → 이 앱 → 배터리 → 제한 없음**으로 바꿔 주세요.
(삼성은 "절전 앱에 추가" 해제, 샤오미/화웨이는 자동 실행 허용이 추가로 필요합니다.)
