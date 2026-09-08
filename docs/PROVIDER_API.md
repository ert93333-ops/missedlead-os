# Provider API

All calls use the signed-in user's Bearer token. Monetary values are integer USD cents. Responses use database snake_case fields.

- `GET /api/providers/application` → `{application: object|null, documents: object[]}` for current user. Application fields below plus `provider_id,status,review_reason,verification_reference,verified_at`.
- `PUT /api/providers/application` → `{application}`. Body `{organizationName,contactName,contactEmail,contactPhone,categories:string[],zipCodes:string[],languages:('en'|'es')[],availability:string,diagnosticFeeCents,licenseNumber,licenseExpiresAt,insuranceExpiresAt,workersCompRequired:boolean}`. Creates/resubmits pending application. No tax ID field.
- `POST /api/providers/documents` multipart `kind`=`license|coi|workers_comp|w9`, `file` PDF/JPEG/PNG <=10MB → `{document:{id,kind,file_name,created_at}}`. Private documents; no public URL.
- `GET /api/providers/documents/:id` → `{url,expiresIn:60}` owner/operator only.
- `GET /api/providers/applications` operator only → `{applications:object[]}`.
- `GET /api/providers/applications/:id` operator only → `{application,documents}` where id is provider UUID.
- `POST /api/providers/applications/:id/review` operator only `{decision:'approved'|'rejected',reason,verificationReference}` → `{application}`. Approval requires uploaded license/COI/W9 and workers comp if applicable plus current expirations. Operator must enter actual external verification reference; verification time recorded by server. Approval changes DB role to provider.
- `POST /api/providers/requests/:id/respond` provider `{decision:'accept'|'decline'}` → `{match}`. Accepted invitation stored as existing `viewed` status.
- `POST /api/providers/requests/:id/quote` provider body `{scope,diagnosticCents,laborCents,materialsCents,taxCents,totalCents,validUntil,earliestStartAt,warrantyDays,siteVisitRequired,permitRequired,permitNumber?,inspectionStatus:'not_required'|'pending'|'passed'}` → `{quote}`. Atomic base quote and detail insertion. Exact sums required. No customer booking after expiry. Quotes >= $40,000 excluded. Permit pending is disclosed and blocks starting work at the parent job guard.
- `GET /api/requests/:id/quote-details` request participants → `{details:object[]}` with `quote_id,diagnostic_cents,labor_cents,materials_cents,tax_cents,valid_until,site_visit_required,permit_required,permit_number,inspection_status`.

Scheduling reuses existing request schedule API. Quote earliest start is required. Private-document URLs must never be shown as public links or stored in analytics/logs.
