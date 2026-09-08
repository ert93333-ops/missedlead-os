# Business and inbox API

All endpoints require the existing bearer session. Responses use persisted snake_case rows; failures use the shared API error response. No endpoint sends external messages or moves money.

- `GET /api/business/organizations` → `{ organizations: [{id, owner_id, name, created_at}] }` (only memberships/ownership).
- `POST /api/business/organizations` `{name}` → `{ organization: {id,owner_id,name,created_at} }`.
- `GET /api/business/organizations/:orgId` → `{ organization, members: [{organization_id,profile_id,role,created_at}], locations: [{id,organization_id,name,address,created_at}], requests: [{request_id,organization_id,location_id,business_interruption,impact_note,created_at}], approvals: [{id,organization_id,request_id,quote_id,requested_by,amount_cents,status,decided_by,decision_note,decided_at,created_at}] }`. Roles are `approver`/`member`; owner is organization.owner_id.
- `POST /api/business/organizations/:orgId/members` `{profileId,role:"member"|"approver"}` → `{member}`. Owner only; existing customer account UUID required; no invitations sent. Repeated submission changes member role. Owner cannot be replaced.
- `POST /api/business/organizations/:orgId/locations` `{name,address}` → `{location}`. Owner or approver only.
- `POST /api/business/organizations/:orgId/requests` `{requestId,locationId,businessInterruption:boolean,impactNote:string}` → `{request}`. Caller must own the real request and belong to this organization; location must belong to the same organization. Immutable association, repeated identical submission returns original. An interruption marks priority context; it does not bypass safety or promise arrival times.
- `POST /api/business/organizations/:orgId/approvals` `{quoteId}` → `{approval}`. Quote must belong to linked organization request. Amount comes from actual quote, never client input. Repeated same quote returns same approval.
- `POST /api/business/approvals/:approvalId/decision` `{decision:"approved"|"rejected",note:string}` → `{approval}`. Owner/approver only, cannot approve own submission; decisions immutable. Internal expense authorization only, no quote acceptance or payment.
- `GET /api/business/organizations/:orgId/report?year=2026` → `{report:{year,organization_id,request_count,completed_count,interruption_count,paid_cents,refunded_cents,net_paid_cents,locations:[{location_id,name,request_count,paid_cents,refunded_cents}]}}`. UTC calendar-year request counts use request creation time; cash totals use payment timestamp in that year, including payments against earlier requests. No forecasts or invented savings.
- `GET /api/notifications` → `{notifications:[{id,recipient_id,request_id,kind,title,body,created_at,read_at}]}` latest 100, newest first. Kind `quote`, `schedule`, `business_approval` (future internal producers may add others).
- `POST /api/notifications/:notificationId/read` `{}` → `{notification}`; own inbox only; first read time preserved.

Customers in a shared organization see business location, linked request identifiers, expense amounts and report totals. This does not grant access to another customer's private intake photos/chat or payment actions. Approvals and member/location/request writes are audited. Notifications are generated from new quotes, changed schedules and business expense decisions, inside the same database transaction.
