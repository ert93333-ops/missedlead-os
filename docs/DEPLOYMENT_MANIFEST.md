# Deployment manifest

The deployment manifest is a release-gate input, not an application configuration file. It contains only opaque identities and SHA-256 results. It must never contain credentials, raw origins, customer data, storage paths, transcripts, or signed URLs.

## Required JSON shape

```json
{
  "schemaVersion": 1,
  "environmentHash": "<64 lowercase hex characters>",
  "projectHash": "<64 lowercase hex characters>",
  "apiOriginHash": "<64 lowercase hex characters>",
  "gitSha": "<40 or 64 lowercase hex characters>",
  "migrationHead": "<opaque migration identity>",
  "capabilityResultHashes": {
    "<capability-name>": "<64 lowercase hex characters>"
  },
  "evidenceHashes": {
    "<evidence-name>": "<64 lowercase hex characters>"
  },
  "approvalReceiptId": "<opaque approval receipt identity>",
  "rotationOwner": "<team or role identity>",
  "revocationOwner": "<team or role identity>",
  "paymentsMode": "disabled | drain | enabled"
}
```

All fields are required. Unknown fields are rejected. Both hash maps must be non-empty, their names must use lowercase letters, digits, dots, underscores, or hyphens, and their entries are sorted by name when exposed by readiness.

`migrationHead`, `approvalReceiptId`, `rotationOwner`, and `revocationOwner` are opaque identifiers limited to letters, digits, dots, underscores, and hyphens. They are not places to put email addresses, URLs, keys, or operational instructions.

## Validation

Validate a local manifest without credentials or network access:

```sh
node scripts/validate-deployment-manifest.mjs scripts/fixtures/deployment-manifest.valid.json
```

Success prints exactly:

```text
METRIC manifest.errors=0
PASS manifest
```

A validation failure prints the error count and `FAIL manifest`, then exits nonzero. Errors are collected in deterministic field order. The validator rejects secret-like field names and values that resemble tokens, API keys, raw URLs, network addresses, transcripts, object paths, or signed URLs.

## Protected readiness

`GET /api/ops/readiness` requires an authenticated, allowlisted operator. It returns only readiness state and hashes. It never returns the approval receipt ID, owner identities, raw environment/project/origin values, credentials, or configuration.

At startup the server accepts the validated document as `DEPLOYMENT_MANIFEST_JSON`. For enabled payments, `approvalReceiptId` identifies the payment approval receipt's `keyId`.

Readiness fails closed with HTTP 503 when the manifest is absent or invalid, the effective payment mode differs from the manifest, the enabled-payment approval receipt does not match the manifest receipt identity, or the receipt's environment, project, git, migration, or capability bindings differ from the manifest. Database changes remain an operator-controlled migration step; readiness only compares the declared migration identity and never applies migrations.
