# WeCover Web UI Redesign / 웹 UI 리디자인 — 2026-09-13 (doc id 20260912)

## 한눈에 보기 / At a glance

역할별 웹 셸을 "민트 그린 단일 템플릿"에서 세 개의 구분되는 스킨으로 재설계했습니다. 라우팅·역할 권한·API 배선은 그대로 유지하고, 시각 시스템(토큰 + 컴포넌트 CSS + 최소 마크업)만 교체했습니다.

The web shells were redesigned from a single mint-green template into three instantly distinguishable role skins. Routing, role authority, and API wiring are unchanged — this is a token + component-CSS + minimal-markup change.

## 디자인 시스템 / Design system

- **팔레트(명명된 hex):** `primer #F4F2EB`(기포지/drywall paper), `graphite #22262B`(잉크), `utility #1D53D6`(고객 — 매설물 표시 블루), `hivis #F5A524`(공급자 — 하이비즈 앰버), `steel #33526B`(운영자 — 관제 스틸), `signal #BE3A32`(위험).
- **타입:** `Barlow Condensed`(공공 사이니지 계열 디스플레이), `IBM Plex Sans KR`(본문, KO/EN/ES 커버), `IBM Plex Mono`(데이터·라벨·감사 로그). Google Fonts를 `index.html`에서 로드.
- **시그니처:** 탑바 아래 mono 대문자 "spec strip" 데이터플레이트(역할·파일럿·결제 상태 표시) + 로그인/히어로 표면의 은은한 블루프린트 그리드. `prefers-reduced-motion` 유지, `:focus-visible` 아웃라인 추가.

## 역할 스킨 / Role skins (`data-role` on `.app-shell`)

| Role | Surface | Accent | Density / shape |
|---|---|---|---|
| Customer | warm primer paper, white cards | utility blue | generous radius (16px), intake-first chat hero |
| Provider | dark charcoal `#171A1E` (outdoor legibility) | hi-vis amber | 46px thumb targets, chunky stepper, mono job data |
| Operator | cold light grey `#E9ECEF` | steel | 6px radius, compact paddings, mono audit list |

모든 상태 클래스(`.warning`, `.danger-note`, `.success-note`, `.payment-unavailable`, `.pill.*`, `.empty`, `.chat-error`)가 역할 토큰을 소비하도록 재작성되어 다크 테마(provider)에서도 대비가 유지됩니다.

All state classes were re-tokenized so they keep contrast inside the provider dark theme; EN/ES customer copy paths, `data-testid`s, and `PAYMENTS_MODE=disabled` behavior (`payment-unavailable` notice, inert deposit/balance actions) are untouched.

## 변경 파일 / Files changed

- `src/styles.css` — full rewrite: token system, three `data-role` skins, spec-strip, hero/stepper/quote/metrics/audit restyle, chat-intake retokenized, focus-visible + reduced-motion.
- `src/App.tsx` — `.app-shell`에 `data-role={role}` 추가, 탑바 아래 `.spec-strip`(역할 태그 EN/ES + payments 상태) 추가. 로직·테스트ID 변경 없음.
- `index.html` — Google Fonts(Barlow Condensed, IBM Plex Sans KR, IBM Plex Mono) + theme-color 업데이트.
- `docs/WEB_UI_REDESIGN_20260912.md` — 이 파일.

## 검증 / Verification

- `pnpm build` — passed (`tsc -b && vite build`, dist emitted).
- `vite preview` on `127.0.0.1:5195` — serving new bundle (`index-BWnTgcpo.css`), `/api` proxy → 8787 intact.
- Visual check (Playwright, built CSS + real shell markup): `artifacts/redesign-auth.png`, `redesign-intake.png`, `redesign-customer.png`, `redesign-provider.png`, `redesign-operator.png` — roles distinguishable at a glance.
- Not pushed to git. Mobile surfaces unchanged by design (deferred).
