# WeCover 협업 작업 가이드

## 필수 작업 시작 명령

모든 협업자는 작업을 시작할 때 아래 명령을 순서대로 실행합니다.

   ```sh
git fetch origin
   git status --short --branch
git pull --rebase origin master
git log -3 --oneline
   ```

`git status`에 다른 작업자의 변경이 있으면 덮어쓰지 말고 먼저 범위를 확인합니다. `git reset --hard`, `git clean -fd`, `git checkout -- .`, 무분별한 `git stash`는 사용하지 않습니다.

## 순차 작업 모드

이 저장소는 한 번에 한 명만 작업하는 순차 모드를 기본으로 합니다. 별도 브랜치와 PR은 필수가 아니며, 작업자는 `master`에서 다음 순서를 지킵니다.

```text
작업자 A: pull → 작업 → 검증 → commit/push → 인수인계
작업자 B: pull → 작업 → 검증 → commit/push → 인수인계
```

작업 중인 사람은 인수인계 전까지 다른 작업자가 같은 작업 트리를 수정하지 않도록 알립니다. 인수인계에는 마지막 커밋, 수정 파일, 실행한 검증, 남은 문제를 적습니다. `master`가 원격과 동기화되지 않으면 다음 작업자는 시작하지 않습니다.

## 필수 작업 종료 명령

모든 협업자는 작업을 끝내기 전에 아래 명령을 실행합니다.

1. 변경 범위를 확인합니다.
   ```sh
   git status --short
   git diff --stat
   git diff --check
   ```
2. 관련 검증을 실행합니다.
   ```sh
   # 웹/API 변경
   pnpm test && pnpm build

   # 모바일 변경
   pnpm --dir mobile typecheck && pnpm test:mobile

   # UI 흐름 변경
   node scripts/persona-matrix-ui.mjs
   ```
   변경 범위에 맞지 않는 명령은 생략 사유를 커밋 또는 인수인계 기록에 남깁니다.
3. 작업 목적이 드러나는 작은 커밋을 만듭니다.
   ```sh
   git add <변경 파일>
   git commit -m "Short imperative change description"
   git push origin master
   ```
4. 협업자가 이어서 볼 수 있도록 현재 상태, 검증 결과, 남은 주의점을 인수인계 문서 또는 관련 문서에 기록합니다.
5. 푸시 후 원격 최신화와 작업 트리 깨끗함을 확인합니다.
   ```sh
   git fetch origin
   git status --short --branch
   git log -1 --oneline
   git diff origin/master --exit-code
   ```

`git diff origin/master --exit-code`가 실패하면 push가 완료되지 않은 것이므로 작업을 끝내지 않습니다. 커밋하지 않은 다른 사람의 변경은 포함하거나 되돌리지 않습니다. 비밀값, `.env` 파일, 토큰, 서비스 키는 커밋하지 않습니다.

## 현재 서비스

- Render 무료 서비스: `https://wecover.onrender.com`
- Blueprint: Render dashboard의 `wecover` blueprint
- 저장소: `missedlead-os/missedlead-os`, `master`
- 결제: `PAYMENTS_ENABLED=false`
- 배포 설정: `render.yaml`
- 무료 Render 인스턴스는 유휴 시 sleep할 수 있습니다. 첫 요청은 cold start로 느릴 수 있습니다.

## 테스트 접근

외부 테스트 빌드에서는 로그인 화면 하단의 **Customer**, **Provider**, **Admin** 버튼으로 역할 셸에 바로 들어갈 수 있습니다. 이 접근은 시각/흐름 테스트용이며 실제 인증 세션이나 운영 데이터 권한을 대체하지 않습니다. 테스트 버튼에서 백엔드 작업을 검증하려면 Supabase 계정과 Render 환경변수가 유효해야 합니다.

## 환경변수 주의

Render에는 최소한 다음 값이 필요합니다.

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `GEMINI_API_KEY`
- `VITE_ENABLE_DEMO_AUTH=true` (외부 테스트 버튼을 보일 때만)

값은 Render Dashboard에서 설정하고 저장합니다. 저장 후 **Save, rebuild, and deploy**를 실행합니다. 로컬 환경변수나 서비스 키를 문서/커밋에 복사하지 않습니다.

## 역할별 작업 위치

- 웹: `src/`, 특히 `src/app/router.tsx`, `src/app/auth.tsx`, `src/app/chat/`, `src/styles.css`
- 모바일: `mobile/src/`, 특히 `Workspace.tsx`, `theme.ts`, `chat/`, `manage/`
- API: `server/`
- DB: `supabase/migrations/`
- 브라우저 persona 검증: `scripts/persona-matrix-ui.mjs`
- 무료 배포 절차: `docs/DEPLOY_FREE.md`
- AI 도구에 붙여 넣을 전체 지침: `docs/AI_COLLABORATOR_RULES.md`

## 서비스 범위 페르소나 점검

실제 인테이크 모델과 대화를 진행해 범위 이탈을 검사하는 도구가 있습니다.

```sh
pnpm exec tsx scripts/persona-scope-probe.ts                 # 15개 페르소나 전체
pnpm exec tsx scripts/persona-scope-probe.ts offscope_moving  # 특정 페르소나만
pnpm exec tsx scripts/gemini-quota-check.ts [model]           # 429/모델 폐기 구분
```

- `GEMINI_API_KEY`가 필요하고, 결과는 `artifacts/persona-scope-probe*.json`에 페르소나마다 저장됩니다.
- 무료 등급은 분당/일일 호출 제한이 있어 중간에 429로 멈출 수 있습니다. 스크립트는 대기 후 재시도하고, 그때까지의 대화는 저장합니다.
- `gemini-2.0-flash`는 폐기되어 404입니다. `GEMINI_FALLBACK_MODELS`에 남아 있으면 정리해야 합니다.

발견한 문제와 조치:

- 이사·카펫 청소 요청에 모델이 "I can help with carpet cleaning"이라고 답하고 방 개수를 물었으며, 잔디 깎기·거터 청소 정기 서비스까지 접수하려 했습니다. WeCover가 제공하지 않는 작업입니다.
- 프롬프트에 미취급 작업 목록과 거절 규칙을 넣고, 모델 응답과 무관하게 서버에서 막도록 `server/intake/scope.ts`의 `enforceServiceScope()`를 `/api/intake/analyze` 경로에 추가했습니다. 범위 밖이면 후보·질문·자재 힌트를 비우고 확정 불가로 만들며, 확정 요청은 409로 거절됩니다.
- 응급 안내는 범위 밖이어도 그대로 유지하고, "이사 업체가 벽을 파손했다" 같은 실제 수리 요청은 차단하지 않습니다.

## 최근 기준점

- 데모(역할 테스트 버튼) 세션은 **API를 먼저 호출하고**, API에 닿지 못하거나 데모 토큰이 거부될 때만 로컬 데모 화면으로 물러납니다. 판정은 `src/app/demo.ts`의 `demoFallbackApplies()` 한 곳에 있습니다.
- 서버가 실제로 응답한 오류(검증 실패, `AI_PROVIDER_UNAVAILABLE` 같은 503)는 데모에서도 기존 오류·재시도 UI를 그대로 보여 줍니다. 무조건 데모 화면으로 덮지 않습니다.
- `/api/intake/confirm`은 `access`/`pets`가 모두 비어 있으면 `scopeDetails`를 보내지 않습니다.
- E2E mock 레인이 앱 변경을 따라가지 못해 깨져 있던 부분을 맞췄습니다: provider/operator 화면의 `/api/providers/application(s)` 조회 추가, 감사 로그의 표시 라벨 + `title`의 원본 action 코드 검증, 수동 eligibility 폼은 `pending`/`suspended`만 전송(승인은 신청서 심사 경로).
- 검증: `pnpm test` 301개 통과, `pnpm build` 통과, `pnpm exec playwright test` 19개 통과·1개 skip(Supabase 통합 레인), `pnpm lint` 경고 31개로 이전과 동일.
- CI를 수리했습니다. `pnpm/action-setup`의 `version: 9`가 `packageManager: pnpm@9.15.9`와 충돌해 2026-09-20 이후 모든 실행이 설정 단계에서 죽어 있었고, `server/intake/media.ts`가 쓰는 ffmpeg/ffprobe가 runner에 없어 미디어 정제 테스트가 ENOENT로 실패했습니다. 현재 ci 실행 48번(`9ee0311`)이 성공입니다.
- **배포 주의**: Render 자동 배포가 `9dc3677`(2026-09-20 16:15 UTC) 이후 멈췄습니다. 그 뒤의 push에는 GitHub deployment 기록이 아예 생성되지 않았고(`GET /repos/missedlead-os/missedlead-os/deployments`), 라이브는 여전히 이전 번들을 서빙합니다. Render 대시보드에서 Auto-Deploy 상태와 저장소 연결을 확인하고 Manual Deploy를 실행해야 최신 코드가 반영됩니다.
- 라이브 반영 확인은 번들 문자열로 합니다: `curl -s https://wecover.onrender.com/`에서 `assets/index-*.js` 이름을 얻은 뒤 그 파일에 `demo-request-`가 있으면 이번 변경이 배포된 것입니다.
- 운영 호스트에도 ffmpeg/ffprobe가 있어야 고객의 음성·영상 첸부 정제가 동작합니다. Render 호스트에서는 아직 확인하지 못했습니다.
- 미실행: `node scripts/persona-matrix-ui.mjs`(preview :5199 + API :8787 + Supabase 계정 필요, 로컬 자격증명 없음), `pnpm test:mobile`(mobile 미변경).
- 현재 작업을 시작할 때 먼저 `git pull --rebase origin master`를 실행하고, 작업 종료 후 위 종료 규칙을 따릅니다.
