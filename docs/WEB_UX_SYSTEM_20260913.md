# Web UX System Refinement — 2026-09-13

## Purpose

A systematic UI/UX pass over the web surface (`src/styles.css`, `src/App.tsx`,
`src/app/router.tsx`) for the U.S. home-services market. The existing "field
ticket" design language (blueprint grid, spec strips, condensed display type)
was kept as the product's identity; this pass tightens hierarchy, feedback
states, and role differentiation rather than replacing it.

## Design decisions

### Hierarchy and feedback

- **Semantic notice tones** — `notice--error` / `notice--success` /
  `notice--warning` are wired in `Notice()` by content keywords, so destructive
  feedback reads red, confirmations read green, and informational text stays
  neutral. Previously every notice shared the same neutral surface.
- **Quote comparison cards** — each card now leads with a dedicated price row
  (large tabular total + compact "estimate" label), then ranking/trust factors,
  then a full-width primary CTA. "Choose this quote" is promoted to the
  primary button because it is the customer decision the screen exists for.
- **Provider quote form** — flat label+input sequence regrouped into three
  fieldsets: `Cost breakdown` (diagnostic / labor / materials / tax / total),
  `Schedule` (valid until / earliest start / warranty), and `Job conditions`
  (site visit / permit required). Field crews scanning a long form get
  scannable sections instead of a wall of inputs.
- **Workflow stepper** — the current step is marked `aria-current="step"` and
  styled as a filled accent bar instead of a faint outlined bar, so the active
  stage is legible at a glance.
- **Navigation** — sticky role topbars now use a blurred translucent surface
  (`backdrop-filter`) with an accent underline so context stays visible over
  scrolled content.

### Role skins (unchanged palette, better contrast)

- Customer — warm primer paper, utility blue.
- Provider — dark field UI; text raised to `#EEF1F4`, muted to `#98A3AF`,
  panel/row surfaces lightened for WCAG-friendly contrast, 50px touch targets,
  darker accent-deep for readable amber-on-dark text.
- Operator — steel/compact; rows capped tighter, subtle focus rings.

### Motion and accessibility

- Single restrained entrance pattern: `riseIn` translate+fade (360–450ms) on
  app shells, panels, quotes, and hero elements. No scroll-jacking or glow.
- `@media (prefers-reduced-motion: reduce)` still collapses all transitions
  and animations to ~0.
- Focus-visible outlines now draw a 2px `accent` ring with 2px offset on
  buttons, inputs, and select elements.
- `aria-current="step"` added to the stepper for assistive tech.

### Trust cues (sign-in)

The auth gate gained a U.S.-market trust block above the card —
"Built for Charlotte, NC homeowners" with "Vetted technicians · Clear pricing ·
Dispute protection" — plus a short reassurance line under the form. Demo actor
controls remain dev-only (`import.meta.env.DEV` or `VITE_ENABLE_DEMO_AUTH`).

## Invariants preserved

- All `data-testid` hooks unchanged (`auth-gate`, `demo-actor-selector`,
  `ranked-quote-*`, `provider-request-*`, `permit-panel`, `permit-queue`,
  `op-metric-*`, …).
- All user-visible labels and sentences relied on by the e2e suite are
  unchanged (`Choose this quote`, `Send quote to customer`, `Requests`,
  `Send`, `Attach media`, stepper labels, etc.).
- No API surface changes; markup changes are wrappers and class additions only.

## Verification

- `pnpm build` — pass
- `pnpm lint` — pass (0 errors; warnings are pre-existing `set-state-in-effect`
  items plus one unused test import)
- `pnpm exec playwright test` — 13 passed, 1 skipped (Supabase credential
  dependent)
- Visual review — sign-in, customer intake, provider queue, operator console
  screenshotted via preview server (see `artifacts/redesign-*.png`); error
  notice tone verified against a real fetch failure on the API-less preview.

## Not verified

- Real staging/Supabase session rendering (no credentials).
- Physical device rendering of the web app.
- Mobile app visual output on device (unchanged in this pass; role skins were
  shipped in `MOBILE_ROLE_SKINS_20260913.md`).
