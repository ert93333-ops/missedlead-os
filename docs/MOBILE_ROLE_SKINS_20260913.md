# WeCover Mobile Role Skins — 2026-09-13

Ports the three-skin role design system from `src/styles.css` (WEB_UI_REDESIGN_20260912) to the Expo app. Routing, role authority, and API wiring unchanged — token + style-layer change only.

## Design system

- `mobile/src/theme.ts` — shared named palette (`primer #F4F2EB`, `graphite #22262B`, `utility #1D53D6`, `hivis #F5A524`, `steel #33526B`, `signal #BE3A32`) with per-role token sets matching the web `data-role` blocks, plus density metrics (control/input/icon minimums, radii, padding) and the active-role holder (`setSkinRole`, `activeTokens`).
- Fonts loaded in `mobile/App.tsx` via `expo-font` + `@expo-google-fonts`: Barlow Condensed (display), IBM Plex Sans (body), IBM Plex Mono (spec strip / meta labels). App gates on font load; failure falls back to system fonts.
- Signature: `SpecStrip` — mono uppercase dataplate bar (role tag with shaped marker: customer rounded square, provider circle, operator square; pilot + payments state) rendered at the top of the workspace shell. Blueprint grid on the sign-in surface.

## Role skins

| Role | Surface | Accent | Density / shape |
|---|---|---|---|
| Customer | primer paper, white cards | utility blue | radius 16/10, 48px controls |
| Provider | dark charcoal `#171A1E` | hi-vis amber, dark on-accent text | radius 12/8, 50px controls, 46px icon targets, weight-700 actions, light StatusBar |
| Operator | cold light grey `#E9ECEF` | steel | radius 6/4, compact 40px controls |

## Implementation

- `mobile/src/chat/ui.tsx` — `styles` rebuilt as a per-role `buildStyles(tokens)` map; the exported `styles`/`palette` are live proxies resolved against the active role at render time, so all ~370 existing `styles.*`/`palette.*` call sites are unchanged. `Action`/`IconAction` on-accent icon color now uses tokens instead of hardcoded white.
- `mobile/src/Workspace.tsx` — resolves role via `/api/me` (unchanged), calls `setSkinRole`, mounts `<StatusBar>` per skin (`dark` → light icons), renders `SpecStrip`, themed bottom `tabBar`, and fetches `/api/capabilities` alongside `/api/me` to show real payments state.
- `mobile/App.tsx` — retokenized auth screen (primer/graphite/utility), blueprint grid, mono spec line, Barlow brand.
- Root background coverage: `manage/shared.tsx` `Screen`, `RequestsScreen`, `AccountScreen` now paint `styles.safe` so the provider dark theme covers scroll areas.

## Verification

- `pnpm --dir mobile typecheck` — passed.
- `pnpm test:mobile` — 41/41 passed.
- `pnpm lint` — 0 errors (warnings unchanged from baseline).
- `pnpm --dir mobile run build:web` — expo web export succeeded (575 modules; font assets emitted).
- Not verified: native device render (prior Android host-memory constraint still applies), visual screenshots.
