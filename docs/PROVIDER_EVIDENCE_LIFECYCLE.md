# Provider evidence lifecycle

Provider work evidence and customer intake media are separate products and storage lifecycles.

## Customer intake media

Customers upload only through `POST /api/requests/:requestId/intake-media`. The API accepts assessment-bound multipart bytes, sanitizes them before storage, writes only the sanitized derivative to the private `request-media-private` bucket, commits its `request_media` record, and verifies that a private signed read can be created before returning success. A retry with the same sanitized checksum returns the existing record. Failed sanitization, storage, database commit, or signed-read verification is compensated so no source object, orphan object, or inaccessible claimed record remains.

The former customer upload negotiation and operator sanitization endpoints are retired:

- `POST /api/requests/:requestId/media`
- `POST /api/media/:id/upload-url`
- `POST /api/media/:id/complete`
- `PATCH /api/media/:id/sanitization`

They are not fallback paths and return not found.

## Provider work evidence

Assigned, eligible providers submit work evidence through `POST /api/requests/:id/evidence-files`. Evidence is sanitized before it is uploaded to the private bucket and committed with `commit_evidence_file`; a failed commit deletes the uploaded object. Evidence metadata is stored in `evidence` and `evidence_media`, and authorized request activity reads receive short-lived signed URLs. Provider evidence supports the `before`, `during`, `after`, `receipt`, and `warranty` stages and remains governed by job assignment and evidence requirements.

Provider evidence must not be written through customer intake endpoints, associated with an intake assessment token, or treated as a customer-upload retry. Customer intake records likewise must not satisfy provider before/after evidence requirements.

## Inventory gate

Use only a sanitized inventory export; never print object paths:

```sh
node scripts/inventory-storage-objects.mjs --before scripts/fixtures/object-inventory-empty.json --after scripts/fixtures/object-inventory-empty.json
```

The gate compares the snapshots and checks objects and sanitized records newly present in `after`. It fails when the delta contains a raw object, an object without a matching sanitized record, a public object, or a sanitized record whose object is absent or unreadable:

```sh
node scripts/inventory-storage-objects.mjs --before scripts/fixtures/object-inventory-empty.json --after scripts/fixtures/object-inventory-orphan.json
```

Metrics report aggregate counts only. The command never prints object paths.
