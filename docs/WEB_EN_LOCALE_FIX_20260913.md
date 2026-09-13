# Web locale fix — English/Spanish only (2026-09-13)

## Context

This is a North America product (Charlotte pilot). Customer-facing copy is English + Spanish; provider and operator screens are English only. Korean UI copy left over from an earlier build was showing on provider/operator screens and in mixed-locale fallbacks.

## Changes

- `src/App.tsx`
  - Provider view (`provider-inbox`, `provider-evidence`, changes/completion): all labels, buttons, toasts, and empty states are English only.
  - Operator console (`operator-console`, disputes/refunds, `provider-eligibility`, `recovery-console`, settlement/audit): English only; audit timestamps use `en-US`.
  - Customer view: EN/ES switching preserved. Every `es ? … : en ? … : KO` fallback collapsed to `es ? … : EN` — non-Spanish always renders American English.
  - `PaymentDialog`: KO fallback branch removed; English is the default when `locale` is not `es`.
  - Quote comparison: ranking metadata, license/insurance/rating/distance/response/languages, deposit, and empty state now English by default; dates use `en-US`.
- `src/app/router.tsx` — sign-in success and error messages in English.
- `src/app/auth.tsx` — Supabase configuration error in English.
- `src/app/chat/AttachmentGallery.tsx` — removed KO fallback branch; non-`es` locales default to English.
- `server/app.ts` — hazard-block guidance returned by `POST /api/requests` translated to English so it cannot surface Korean through API error notices.
- `index.html` + `src/styles.css` — font stack switched from `IBM Plex Sans KR` / Pretendard to `IBM Plex Sans` for North American typography.
- `tests/e2e/*.spec.ts` — selectors and assertions updated from Korean labels to the new English copy.

## Not changed

- Payments remain disabled (`paymentsEnabled` untouched).
- No mobile changes.
- Korean test fixture data (names/descriptions sent to API in `server/app.test.ts`) left as-is — it exercises payload handling, not UI copy.

## Verification

- `pnpm build` — clean (tsc + vite).
- Hangul scan over `src/**/*.{ts,tsx,html}` — zero matches.
- Vite preview restarted on `127.0.0.1:5195` with `/api → 127.0.0.1:8787` proxy intact (see `vite.config.ts`).
