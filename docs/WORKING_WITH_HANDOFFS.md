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
- 저장소: `ert93333-ops/missedlead-os`, `master`
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

## 최근 기준점

- `e173ff5 Remove sink example imagery from intake`
- 고객 intake의 싱크대 예시 이미지와 관련 SVG를 제거했습니다.
- 외부 Render URL에서 이미지 없는 intake 화면을 확인했습니다.
- 역할별 테스트 버튼과 데모 intake fallback이 배포되어 있습니다.
- 현재 작업을 시작할 때 먼저 `git pull --rebase origin master`를 실행하고, 작업 종료 후 위 종료 규칙을 따릅니다.
