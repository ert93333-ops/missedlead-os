# WeCover 상용화 Owner Handoff — 2026-09-06

현재 자율 로컬 구현은 결제 비활성 Charlotte 파일럿 준비 단계까지 완료됐다. 아래 항목은 실제 상용 파일럿 ingress를 열기 전에 owner가 제공하거나 승인해야 하며, 저장소·로그·스크린샷·receipt에 비밀값을 기록하면 안 된다.

## 1. 삭제·보존 정책 승인 — 2C 선행 조건

`docs/DELETION_DATA_MAP.md`와 `docs/RETENTION_DECISIONS.md`의 다음 `policy_pending` 결정을 owner/counsel이 승인한다.

- audit/logs: 보존 목적, 기간, legal hold, 삭제 후 접근자
- financial/legal records: 법적 보존 근거, 최소 보존 필드, 익명화 경계
- backups: 보존기간, 암호화/key owner, tombstone replay 및 만료 방식
- deletion tombstones/progress: 재생 방지에 필요한 최소 필드와 보존기간

Receipt에는 정책 버전, 승인자 역할, 승인 시각(UTC), 각 데이터 클래스의 action/reason/expiry/legal hold/restore handling, 문서 SHA-256만 남긴다. 비밀·PII는 금지한다. 네 결정이 모두 확정되고 `release_approved=true`인 매트릭스가 검증되기 전에는 2C 삭제 executor를 시작하지 않는다.

## 2. 격리 Staging 실행 — 1B 외부 증거

Owner가 별도 staging 환경을 제공한다.

- staging Supabase project identity와 API origin의 SHA-256
- Gemini staging key/model/quota/timeout owner
- HTTPS/TLS, redirect allowlist, rate limit, credential rotation/revocation owner
- payment mode `disabled`
- synthetic customer/provider/operator 계정과 승인된 Charlotte ZIP fixture

`docs/STAGING_PILOT_VERTICAL.md` 명령으로 EN/ES emergency, model outage/quota/timeout/malformed output, actor-bound confirmation, zero-money 상태를 검증한다. 실패하면 staging ingress를 닫고 test credential을 폐기한다.

## 3. 삭제 실행·관측성·복구 — 2C, 3A, 3B

정책 승인 후 로컬 2C 구현과 검증을 재개한다. 이후 owner가 다음을 제공한다.

- encrypted backup과 backup timestamp
- disposable restore project credentials
- encryption key owner와 restore operator
- 목표 RPO/RTO
- ingress가 닫힌 disposable project identity hash

복구는 tombstone을 먼저 replay한 뒤에만 계정·미디어 접근을 허용한다. schema head, tenant RLS, private object denial, immutable audit, pending/completed deletion을 확인하고 실제 RPO/RTO를 기록한다. 실패한 restore project는 접근 불가 상태로 유지하고 owner 절차에 따라 폐기한다. 고객 데이터가 기록된 schema는 down-migration하지 않는다.

### 3A. 운영 모니터링 승인 입력

Ingress를 열기 전에 owner가 다음 항목을 하나의 서명된 monitoring receipt로 확정한다. receipt에는 값 자체가 아니라 정책 버전, 대상/그룹 식별자의 SHA-256, 승인자 역할, 승인 시각(UTC), git SHA와 deployment manifest SHA-256만 기록한다.

- **Destination:** metrics/logs/traces/audit별 승인된 수집 시스템과 project/tenant, region, 장애 시 secondary destination. 로컬 파일이나 공개 dashboard는 destination으로 허용하지 않는다.
- **Access/retention:** 최소권한 reader/admin 역할, break-glass 승인자와 검토 주기, 데이터 종류별 보존·삭제 기간, legal hold 및 export 권한. production 원문 로그를 개발 환경으로 복사하지 않는다.
- **Recipients/on-call:** 결제·보안·privacy/deletion·AI safety·availability alert별 개인이 아닌 승인된 paging group, primary/secondary on-call과 incident commander, 지원 시간 밖 escalation 경로와 acknowledgement SLA.
- **Thresholds:** 5xx/error rate, latency, AI timeout/quota/malformed response, auth/RLS denial anomaly, media upload/read denial, deletion backlog/SLA, payment-mode mismatch 및 forbidden money-call count의 window, 임계값, severity, recovery 조건. `disabled`에서 money-call count가 1 이상이면 즉시 critical이다.
- **Redaction:** Authorization/cookie/JWT, API key, signed URL query, request body의 PII·주소·미디어, raw model prompt/response를 수집 전에 제거한다. allowlisted 구조화 필드와 opaque correlation ID만 허용하며 redaction 회귀 fixture를 release gate로 실행한다.
- **Fault/stop actions:** redaction 실패, telemetry destination/ACL 불일치, audit 전달 중단, payment-mode 불일치, emergency safety 회귀 시 신규 ingress를 닫고 해당 worker/send/money capability를 중지한다. credential 노출 의심 시 즉시 revoke/rotate하고 보존된 원문 export를 금지한다. 복구는 incident commander와 해당 domain owner가 원인·회복 metric·새 receipt를 확인한 뒤에만 허용한다.

Destination 접근 검증, synthetic alert의 수신·acknowledgement, 임계값별 fault injection, redaction negative fixture, stop action과 복구 결과를 비밀·PII 없는 receipt로 남긴다. 이 증거가 없으면 3A는 완료가 아니며 pilot ingress를 열지 않는다.

## 4. Signed Android/iOS RC — 4B

Owner가 Apple/Google/EAS 계정 및 실제 기기를 제공한다.

- Android 및 iOS 내부배포 서명 artifact
- artifact SHA-256, 앱 버전/build, manifest SHA
- 실제 device/OS/tester identity
- camera/library/audio 권한 거부→Settings 재허용→재시도
- background/foreground, offline/retry, token revocation/re-auth
- EN/ES, emergency, AI outage, private media, zero/≤3 match
- deletion request/status와 payment-disabled UI

내부 RC는 스토어 제출이나 공개 배포가 아니다. 실패하면 배포 channel과 API audience를 비활성화한다.

## 5. Capped Charlotte Pilot — Slice 5

Owner가 다음을 명시적으로 승인한다.

- 파일럿 customer cap
- 허용 Charlotte ZIP 목록
- 검증된 provider 명단과 자격 만료 모니터링 담당자
- 운영, 고객지원, incident commander, privacy/deletion owner
- 지원 시간과 emergency escalation 문구
- signed go/no-go receipt

Pilot admission은 향후 단일 Supabase capacity row와 잠금 RPC로 구현한다. 입장 수는 원자적으로 `admitted_count = unique admission rows <= cap`이어야 한다. 중단 시 capacity ingress를 먼저 닫고 API admission을 닫는다. 기존 사용자의 안전 안내와 삭제 권리는 유지한다.

## 명시적 제외

별도 P1 승인 전에는 다음을 실행하지 않는다.

- 실제 Stripe 결제, 환불, transfer, bank linking
- 실제 이메일/SMS/push 발송
- TestFlight/Play Store 제출 또는 공개 배포
- production credential 사용·복사·출력
- 파일럿 고객 ingress 개방
