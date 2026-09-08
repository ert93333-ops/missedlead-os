# WeCover Charlotte

고객용 주 제품은 [iOS·Android 앱](mobile/README.md)입니다. 이 루트의 웹 화면은 보조 서비스로 유지합니다.

Charlotte–Mecklenburg의 Plumbing, HVAC, handyman-safe 작업을 위한 고객·공급자·운영자용 홈서비스 거래 플랫폼입니다.

## 로컬 실행

`pnpm dev`는 API와 모바일 개발 서버(8082)를 실행합니다. 웹 보조 화면은 `pnpm dev:website` 또는 아래 `pnpm dev:stable`로 실행합니다.

```bash
pnpm install
copy .env.example .env
pnpm exec supabase start
pnpm dev
```

현재 Windows 환경에서 Vite의 개발용 의존성 최적화가 멈추는 현상이 재현되었습니다. 제품 빌드와 미리보기는 동작합니다. 같은 환경에서는 아래 명령으로 개발할 수 있습니다. 코드 변경을 자동으로 다시 빌드하며, 브라우저를 새로고침하면 반영됩니다.

```bash
pnpm dev:stable
```

안정 실행 주소는 `http://127.0.0.1:5194`입니다. 종료는 실행한 터미널의 `Ctrl+C`이며 API와 화면 감시 프로세스가 함께 종료됩니다. 이미 이 작업의 API·미리보기가 실행 중이면 중복 실행하지 않습니다.

웹은 Vite 개발 서버, API는 기본 `http://127.0.0.1:8787`에서 실행됩니다. Supabase 환경 변수가 없으면 메모리 저장소로 우회하지 않고 즉시 실패합니다. Stripe 가입 전에는 `PAYMENTS_MODE=disabled`로 상담과 접수만 실행합니다. 이 상태에서는 결제·정산·환불 요청이 차단되며 결제 내역도 생성되지 않습니다. `drain`은 이미 저장된 의무의 조정만 허용하고 새 결제를 만들지 않습니다. `enabled`는 Stripe 키와 웹훅 설정뿐 아니라 환경·프로젝트 hash, git SHA, migration head, capability hash에 묶인 검증 가능한 owner 승인 receipt(`PAYMENTS_APPROVAL_RECEIPT`, `PAYMENTS_APPROVAL_PUBLIC_KEY`, `PAYMENTS_CAPABILITY_HASHES`)가 모두 있어야 하며, 하나라도 없거나 유효하지 않으면 시작에 실패합니다. receipt와 비밀값은 배포 secret/configuration 경계에만 저장하고 저장소·로그·artifact에 기록하지 않습니다.

개발 서버는 `.env.local`을 먼저 읽습니다. 개발 환경에서는 이 프로젝트의 로컬 설정을 우선하고, `NODE_ENV=production`에서는 운영 환경변수를 우선합니다. 현재 로컬 Supabase 포트는 `supabase/config.toml`을 확인하세요. 다른 프로젝트의 기본 포트에 연결하지 않도록 주의합니다.

## 상담 흐름

고객이 하나의 채팅창에서 증상과 사진·짧은 영상·음성을 보내면 설정된 LLM이 가능한 원인과 추가 질문을 반환합니다. 선택 질문은 견적 변동 안내를 확인한 뒤 건너뛸 수 있지만 위험 확인은 우회할 수 없습니다. 고객이 잠정 작업 범위를 확인하면 자격이 유효한 해당 업종의 업체를 최대 3개 찾습니다. 실제 업체가 없으면 매칭 대기로 표시하며 업체나 가격을 만들어내지 않습니다.

영어·스페인어 상담 및 번역을 지원합니다. 원문은 보존하고 번역에는 금액·작업 범위·법적 표현 확인 안내를 표시합니다. 요구사항은 [기능별 검수 기준](docs/FEATURE_ACCEPTANCE.md), 이번 실행 증거와 미구현·미검증 항목은 [개발 기록](docs/DELIVERY_20260905.md)에서 확인할 수 있습니다.

## 환경 설정

`.env.example`을 기준으로 Supabase Auth/Postgres/Storage 키, Stripe secret/webhook 키, 운영자 allowlist와 reconciliation job secret을 설정합니다. 브라우저에는 `VITE_SUPABASE_URL`과 anon key만 노출하며 service-role과 Stripe secret은 API 서버에만 둡니다.

## 데이터베이스

```bash
pnpm exec supabase db reset
pnpm exec supabase test db supabase/tests/rls.sql
pnpm exec supabase test db supabase/tests/invariants.sql
pnpm exec supabase test db supabase/tests/settlement_protocol.sql
pnpm exec supabase test db supabase/tests/ledger_recovery.sql
```

`supabase/migrations/0001_mvp.sql`은 RLS 기본 거부, 역할별 RPC, 20% 보증금, 별도 잔액 결제, 72시간 이의제기, 불변 수수료 스냅샷, 멱등 정산·환불·reversal과 복구 원장을 정의합니다.

## 검증

```bash
pnpm test
pnpm lint
pnpm build
pnpm exec playwright test
pnpm test:integration
```

`test:integration`은 `SUPABASE_TEST_*`, 역할별 JWT, `INTEGRATION_API_URL`이 모두 필요하며 누락 시 실패합니다. 이는 production DB/RLS/RPC 검증이 조용히 생략되는 것을 방지합니다.

## 운영 작업

`POST /api/internal/jobs/reconcile-payments`를 `x-job-secret`과 함께 주기적으로 호출해 중단된 Stripe transfer·refund·reversal을 복구합니다. 작업 결과는 실행 ID, 처리 수와 개별 결과를 반환하므로 스케줄러와 경보 시스템에서 기록해야 합니다.

긴급 위험 요청은 일반 견적 흐름으로 진행하지 않으며 911·유틸리티 안내만 제공합니다. AI 가격은 확정가가 아닙니다.
