# Care API

All `/api/care/*` routes require the existing authenticated session. Customer mutations use the caller's database token. Tables deny direct writes; SQL functions check ownership and lock records.

- GET `/api/care`: `{bundles, dedicated, maintenance, reminders, priority}` for the current customer; providers see their proposals/offers and completed-work records.
- POST `/api/care/bundles`: `{requestIds: UUID[2..5]}`. Only distinct owned, confirmed, cleared, same-address handyman requests without booking or quotes. Each signed scope remains unchanged.
- POST `/api/care/dedicated/:id`: `{action: "accept"|"release"}`. Accept replaces another active provider for the same address/category; releases are immediate.
- POST `/api/care/priority/:requestId`: `{action:"accept"|"decline"}` by the offered provider. Acceptance means intent to quote, not booking/payment.
- POST `/api/care/maintenance/:requestId`: `{assetName, parts:[{name,quantity}], nextServiceAt?}` by the completed job's provider. Warranty is derived from the accepted quote, never arbitrary client input.
- POST `/api/care/reminders/:id`: `{action:"dismiss"}` by the owning customer.

Completion trigger creates an immutable-link maintenance record and optional dedicated-provider proposal only after a job completes. A customer must explicitly accept a proposal. Unknown parts are an empty list until the completing provider records them; no invented warranty or schedule.

Integration: import `registerCareRoutes(app)` and `applyCarePriority(requestId)` from `server/features/care/index.ts`. Call the latter immediately after confirmed intake, before returning the response; it preserves safe signed scopes and takes priority only if no provider has acted. Call `refreshCarePriority()` from the existing server job loop (once per minute). The priority window is 30 minutes; decline/expiry/ineligible credentials replace it with up to 3 eligible exact-category providers. GET `/api/care` also refreshes caller-owned due offers. No external notification is sent; reminders persist in app.

Response rows:
- bundles: id,customer_id,service_address,created_at,care_bundle_items:[{request_id}]
- dedicated: id,customer_id,provider_id,source_request_id,service_address,category,status(proposed|active|released),created_at,updated_at
- priority: request_id,customer_id,provider_id,status(offered|accepted|fallback),expires_at,created_at
- maintenance: request_id,customer_id,provider_id,service_address,asset_name,parts:[{name,quantity}],warranty_until(nullable),completed_at,updated_at
- reminders: id,request_id,customer_id,kind(warranty|maintenance),due_at,dismissed_at(nullable). Only due_at <= now and dismissed_at null are current alerts; future rows are planned reminders.

Single visit bundles: the first submitted requestId is primary_request_id. The bundle carries immutable scope_snapshot [{requestId,description,workScope}] and status active|released. Only primary can receive one quote, booking or schedule; secondary booking/quote is rejected in database. Quote submission must include bundleId acknowledgment and both quote and accepted quote snapshot capture all member scopes. POST /api/care/bundles/:id/release is allowed before any quote/job, restores individual eligibility while retaining bundle history/snapshot. Provider matched to primary can read bundle details.
