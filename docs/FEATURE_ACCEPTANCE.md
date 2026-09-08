# WeCover implementation acceptance

Baseline: user-supplied `WeCover_Charlotte_확정기능명세_시장조사.pdf`, dated 2026-09-01. User decisions on 2026-09-05 override older product artifacts.

## Scope and authorization

- One simple customer chat, with text, photos, short video and voice attachments. Actual LLM inference, follow-up questions and evidence requests; never substitute canned diagnosis for a failed model call.
- Optional questions may be skipped only after acknowledging that the final provider quote can differ. Safety questions cannot bypass a hazardous condition.
- Customer confirms the provisional issues and work scope before category-appropriate verified-provider matching, capped at three providers.
- Replace Korean-English translation with English-Spanish translation. Keep original and translated content and caution on financial/legal text.
- Stripe signup and live payment activation are deferred by the user. Consultation must work with payments explicitly disabled, and disabled payment routes must not create money claims.
- Market research, supplier recruitment, subscriptions, expansion cities, pricing experiments and legal commentary in the PDF are context, not authorization to publish, contact people, charge money or make legal guarantees.

## Delivery sequence

1. Repair confirmed backend errors and establish the correct local Supabase project (API port 56321).
2. Implement and verify authenticated multimodal LLM analysis, signed confirmation, safety gates and matching.
3. Implement the approved single-chat customer surface, Spanish support, skip warning and retry.
4. Check the actual rendered app, affected automated tests, type checks and production build.
5. Record evidence and outstanding PDF requirements. Keep Stripe activation explicitly deferred.

## Acceptance matrix

| ID | Requirement | Acceptance evidence required |
| --- | --- | --- |
| C-01 | Account, address, property, privacy | Correct customer identity; Charlotte service-area validation; consent/deletion persistence |
| C-02 | Photo, short video, text, voice | Up to ten photos; size/type checks, retry; image EXIF removal; privacy warning |
| C-03 | Actual LLM safety and follow-up | Structured validated inference; optional skip warning; gas/fire/electrical/structural/severe flooding hard block |
| C-04 | Frozen scope | Customer confirmation; no invented dimensions/time; skipped details recorded; replay cannot duplicate request |
| C-05 | Reference price | Source, sample count and freshness; no fabricated range; hide detailed price with fewer than thirty completed samples |
| C-06 | Three verified quote requests | Automatic category/area/license/insurance eligibility; at most three; zero matches displayed honestly; 24h expansion |
| C-07 | Provider comparison | Trust, language, schedule, distance, response and total cost, without cheapest-only ranking |
| C-08 | Booking and communication | Original messages persist; masking; schedule history and notification behavior verified |
| C-09 | Payments and change approval | Disabled until Stripe activation; no charges for unapproved scope; later test deposit/balance/webhook/refund |
| C-10 | Completion and evidence | Before/after media, receipt and warranty, confirmation/dispute/review |
| P-01 | Provider onboarding | Organization, W-9, category-specific licenses/expiry, insurance and applicable workers compensation, area, language, diagnostic fee and availability |
| P-02 | Provider quotes | Accept/decline; diagnostic/labor/material/tax itemization, availability, validity and need for site visit |
| A-01 | Operations | Approval, disputes/refunds, safety reports, license gate and manual matching |
| C-11 (P1) | Bundled small work | Same-address handyman-safe tasks and one visit |
| C-12 (P1) | Dedicated provider | Offer after completed work; accepted preference, change/release, timeout fallback |
| C-13 (P1, overridden) | English-Spanish translation | Original plus translated content, supported-language validation, financial/legal caution and retry |
| C-14 (P2) | Maintenance records | Asset/parts/warranty expiry from completed work; reminders require separate external-send authorization |
| B-01 (P2) | Multi-location businesses | Locations, approvers, urgency and yearly report; later release scope |

## Evidence rules

Route mocks prove UI behavior, not live model inference or database persistence. Local fake payment adapters do not prove Stripe. Old screenshots are not current acceptance evidence. Each claimed result must name a newly executed check. Record untested or unavailable items explicitly in the delivery receipt.

## Implementation references checked on 2026-09-05

- [Gemini video understanding](https://ai.google.dev/gemini-api/docs/video-understanding?hl=en): use the Files API for larger requests; inline media is bounded and temporary provider files need cleanup.
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output): validate structured model responses again on the server before signing an assessment.
- [Stripe payment acceptance](https://docs.stripe.com/payments/accept-a-payment?platform=web&ui=elements): real payment input and confirmation must be integrated and tested after the deferred Stripe activation.
- [Supabase authenticated user verification](https://supabase.com/docs/reference/javascript/auth-getuser): server authentication verifies the user with the Auth service; browser-supplied role labels are insufficient.
