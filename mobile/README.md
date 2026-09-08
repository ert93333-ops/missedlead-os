# WeCover mobile

WeCover의 기본 고객 제품은 iOS·Android 앱이다. 루트 웹사이트는 보조 화면이다. 이 폴더는 React Native/Expo 앱이며 웹 페이지를 감싼 WebView가 아니다.

## 실행

```powershell
cd D:\missedlead-os\mobile
pnpm.cmd install
pnpm.cmd exec expo start --port 8082 --max-workers 1
```

별도 터미널에서 루트 API와 Supabase가 실행 중이어야 한다. 현재 로컬 DB API는56321, WeCover API는8787이다. 종료는 해당 Metro 터미널에서 Ctrl+C. 안드로이드 기기 연결 후 `pnpm.cmd android`, Mac에서는 `pnpm.cmd ios`로 네이티브 개발 빌드를 실행할 수 있다.

`.env.local`은 Git에서 제외된다. `.env.example`의 공개 URL·Supabase anon key만 넣는다. LLM/Stripe/service-role 비밀키는 앱에 넣지 않는다. 현재 안드로이드 에뮬레이터 설정은 서버 주소가 `10.0.2.2`이다. 실제 휴대폰은 같은 Wi-Fi의 PC 주소 또는 접근 가능한 HTTPS 서버 주소로 두 URL을 바꿔야 한다. 제품 빌드는 HTTPS 주소가 아니면 접속을 허용하지 않는다.

## 기능과 확인 범위

- 이메일·비밀번호 로그인/가입, 새 계정의 메일 확인 안내. 실제 운영 계정 정책은 Supabase에서 설정한다.
- 로그인 갱신 토큰만 네이티브 SecureStore 또는 탭 범위의 제한된 웹 sessionStorage에 보관한다. 로그아웃이나 인증 폐기 시 접근·갱신 토큰과 해당 계정의 상담 초안·첨부 메타데이터를 제거하며 다른 계정의 초안은 건드리지 않는다. EN/ES 선택은 해당 계정 초안에만 지속된다.
- 카메라·사진첩·파일 선택, 실제 AI 상담, 추가 질문·선택 질문 건너뛰기 경고, 영↔스페인어, 요청 확정·첨부 저장.
- 카메라·사진첩·마이크 권한이 거부되면 앱 설정에서 해당 권한을 허용한 뒤 같은 작업을 다시 시도하도록 안내한다. 사진첩 시스템 선택기와 오디오 파일 선택은 선택 시점에만 사용하며 상시·백그라운드 권한을 추가하지 않는다.
- Stripe 공개키 유무만으로 결제를 켜지 않으며, 인증된 서버의 결제 capability가 활성화된 경우에만 결제 UI를 표시한다.
- iOS/Android 공통 소스와 플랫폼별 번들 검사는 실제 기기 설치·카메라 테스트 증거와 구분한다.

## 검사와 배포 준비

```powershell
pnpm.cmd typecheck
pnpm.cmd exec expo install --check
pnpm.cmd exec expo export --platform ios --max-workers 1
pnpm.cmd exec expo export --platform android --max-workers 1
```

`eas.json`에 Android 내부 APK와 제품 배포용 구성을 준비했다. 실제 EAS 빌드·Apple 서명·스토어 제출은 수행하지 않았다. 앱 식별자는 임시 프로젝트 식별자이며 실제 계정 소유권 확인이 필요하다. 아이콘·스토어 소개·정책·운영 서버와 실결제는 출시 전에 별도 확인한다.

## 참고한 공식 자료

- [Expo 카메라/사진·영상 선택](https://docs.expo.dev/versions/latest/sdk/imagepicker/)
- [기기 내 안전한 토큰 보관](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [iOS 기기용 서명과 빌드 요건](https://docs.expo.dev/tutorial/eas/ios-development-build-for-devices/)
