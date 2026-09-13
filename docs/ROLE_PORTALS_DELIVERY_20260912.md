# WeCover Role Portals Delivery / 역할별 포털 인수인계

Session: `role-portals-20260912` (ultragoal G001–G004). Verified again at hand-off on 2026-09-12 — all checks below were re-executed, not carried over from prior claims.

세션 `role-portals-20260912`(ultragoal G001–G004). 인수인계 시점인 2026-09-12에 아래 검증을 모두 재실행했으며, 이전 주장을 그대로 신뢰하지 않았습니다.

## 완료된 범위 / Completed scope

- **Customer / 고객:** chat intake, requests, account navigation. Mobile home is the chat intake; web `/customer` shows `ChatIntake` first with a request list toggle.
- **Provider / 가맹점 기사:** jobs/quotes, onboarding application, work evidence, job communication (`ProviderJobs` + `ProviderCommunication`). Customer chat is not the provider home on either surface.
- **Operator / 관리자:** approvals (`ProviderReview`), safety, disputes, matching, coverage ZIP gates, recovery and audit surfaces; mobile routes via `ManagementScreen` operator actions, web via `/operator` `OperatorView`.
- Role authority is authenticated `/api/me` (mobile) and the Supabase session actor (web) only. Web `RoleRouter` force-redirects `/customer`, `/provider`, `/operator` to the actor's role path — deep links cannot elevate or switch roles. Mobile gates tab rendering per role and re-resolves the role on foreground refresh.
- Server enforcement is independent of the shell: `requireRole` middleware plus per-request `owns()` checks; operator routes additionally require the server-side allowlist (`authorizeOperator`).
- Payments remain disabled: `PAYMENTS_MODE=disabled`, `payment-unavailable` notice renders, deposit/balance actions stay inert. No live Stripe, external sends, store submission, production credentials, or legal-policy changes were made.

## UI/UX

Shared Charlotte home-services tokens with role-specific presentation: calm customer trust/intake, field-oriented provider work queue, dense operator control surfaces. Empty/loading/error states and EN/ES labels are in place on the touched screens; motion respects reduced-motion and controls keep keyboard/focus semantics.

## Files changed / 변경된 파일

Working tree vs `HEAD` (7cfc0fa), this delivery:

- Mobile role shell: `mobile/src/Workspace.tsx` (role-gated tabs), `mobile/src/manage/ManagementScreen.tsx` family — `ProviderJobs.tsx`, `ProviderCommunication.tsx`, `ProviderApplication.tsx`, `CareScreen.tsx`, `BusinessScreen.tsx`, `shared.tsx`, `providerJob.ts`.
- Mobile intake/chat polish: `mobile/src/chat/NativeChat.tsx`, `AssessmentPanel.tsx`, `copy.ts`, `ui.tsx`, `useIntake.ts`, `draft.ts`, `draft.web.ts`.
- Web role router: `src/app/router.tsx` (role-path redirect), `src/App.tsx`, `src/app/auth.tsx`, `src/app/chat/*`.
- Server hardening: `server/app.ts`, `server/index.ts`, `server/repository.ts`, `server/intake/media.ts`, `server/jobs/expandQuotes.ts`.
- Tests added/adjusted: `server/dashboard-readonly.test.ts`, `server/intake/media.test.ts`, `server/jobs/expandQuotes.test.ts`, `server/intake.test.ts`, `server/repository-expansion.test.ts`, `mobile/src/manage/providerJob.test.mjs`, `mobile/src/manage/formValues.test.mjs`, `mobile/src/platform/security.test.mjs`, `mobile/src/requests/contracts.test.mjs`, `mobile/src/chat/protocol.test.mjs`, `mobile/src/chat/web-draft.test.mjs`.
- DB: `supabase/migrations/0013_zip_matching.sql`, `0014_delayed_matching.sql`, `supabase/tests/{zip_matching,delayed_matching,intake_matching,demo_isolation}.sql`.
- Docs/config: `README.md`, `package.json`, `mobile/package.json`, `mobile/pnpm-lock.yaml`, `docs/DELIVERY_20260909.md`, this file.

## Verification / 검증 — re-run 2026-09-12

- `pnpm test`: passed, 283 tests (20 files).
- `pnpm test:mobile`: passed, 41 tests.
- `pnpm --dir mobile typecheck`: passed (`tsc --noEmit`).
- `pnpm build`: passed (`tsc -b && vite build`, dist emitted).
- Role-separation review: `src/app/router.tsx` redirects mismatched role paths; `mobile/src/Workspace.tsx` renders customer tabs only for `role === 'customer'` and `ManagementScreen` only for provider/operator; server `requireRole`/`owns()` checks reject cross-role API access regardless of the shell.
- Captured evidence: `artifacts/g004-pnpm-test.log`, `artifacts/g004-pnpm-test-mobile.log`, `artifacts/g004-mobile-typecheck.log`, `artifacts/g004-web-build.log`, plus run transcripts `artifacts/g004-transcript-*.json`.
- Ultragoal: G001–G004 all checkpointed complete (`gjc ultragoal status` → `complete`, 4/4 goals).

## Owner follow-ups / 소유자 후속 작업

Staging credentials, signed physical-device validation, legal/retention approvals, live payments (Stripe activation receipt), external notifications, pilot ingress/capacity approval, and public/store release remain owner-controlled and intentionally outside this autonomous local delivery. Demo-auth (`selectDemoActor`) exists for local development only (`import.meta.env.DEV` or `VITE_ENABLE_DEMO_AUTH=true`) and is not wired to any visible control in the shipped UI.
