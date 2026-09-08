# WeCover browser testing

The browser build uses the mobile application in mobile/, not the secondary marketing website.

## Run locally

Install the root and mobile dependencies with pnpm install and pnpm --dir mobile install. Start the API in one terminal with pnpm dev:api. Run pnpm preview:app in another terminal; this exports the mobile app for web and serves it at http://127.0.0.1:5195/. Stop each terminal with Ctrl+C. The existing secondary website is on port 5194.

The preview binds to this computer only. /api is proxied to port 8787 and /supabase to the existing local Supabase endpoint at port 56321. The local database/auth/storage services must be running for authenticated scenarios. Configure EXPO_PUBLIC_SUPABASE_ANON_KEY in the ignored mobile environment file before exporting; never place service-role keys in public variables.

## Browser differences

- Browser files use File/Blob uploads; mobile file storage remains native.
- Session refresh credentials and chat drafts use tab-scoped sessionStorage. After a reload, missing local files require explicit reattachment before submission.
- Browser date fields use native date/date-time inputs.
- Payments are unavailable in the browser preview. Stripe account setup and native payment verification remain pending.

## Verification status — 2026-09-05

The final web export and mobile TypeScript check succeeded. Twelve attachment, browser draft, quote filter and form boundary tests passed using tsx. Repeat with pnpm test:mobile. Port 5195 returned HTTP 200 with a WeCover HTML entry point. BrowserOS reconnected but rendered verification timed out at CDP Runtime.enable; no visual or end-to-end pass is claimed. A subsequent same-origin auth health request returned HTTP 200. Actual login, persistent uploads and matching remain unverified.

When the services and BrowserOS connection are restored, verify EN/ES login, photo/video attachment, missing-information skip warning, confirmation and matching, request history, provider documents and scheduling. Native device execution is a separate check.

The API was restarted on port 8787; its protected route returned HTTP 401 without credentials. The care refresh reports unavailable: pending schema changes are not treated as applied. Database changes remain on hold pending clarification of the earlier Docker reset record.

## Current tested demo

Login with username test / password test at https://word-represented-lay-verse.trycloudflare.com. Auth/storage recovered, migrations0007–0012 applied, and the real chatbot/three-demo-provider/private-image flow passed. The public account is isolated from real-provider matching and payments. See CHATBOT_DELIVERY_20260905.md for exact evidence and remaining limits.
