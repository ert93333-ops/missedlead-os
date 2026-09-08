# Deletion runbook

## Status and authority

This slice 2B runbook defines the deletion contract; it does not assert that product automation exists and does not provide legal advice. No legal approval is claimed.

**Owner-only approval gate:** do not release deletion handling until the owner has resolved every `policy_pending` matrix row, using counsel where appropriate, and explicitly approved the resulting matrix. A passing structural validation is not release approval.

## Preconditions

1. Authenticate and authorize the deletion request through the approved operational process.
2. Bind the request to one deletion identifier and the affected subject identifiers without copying personal data into logs or fixtures.
3. Check the approved matrix version. Stop if it is absent, structurally invalid, not owner-approved for release, or contains an unresolved policy.
4. Check for a legal-hold condition through the owner-approved process. If one is reported or its status is uncertain, block completion and escalate to the owner. Do not infer legal requirements from this runbook.

## Execution contract

1. Write durable deletion progress before mutating a covered class.
2. Process all twelve required classes from `DELETION_DATA_MAP.md`. Apply only the owner-approved action and expiry for each row.
3. For `erase`, remove active data, derived copies, server-controlled exports, and account-linked caches. Verify that the deleted subject cannot access the class.
4. For `anonymize`, verify that the approved transformation prevents subject access and relinking under the approved standard.
5. For `retain`, restrict access to the approved retained purpose and expiry.
6. Never execute a `policy_pending` row. Block the request and escalate it to the owner instead.
7. Persist the deletion tombstone and per-class result durably. A transient log entry is not sufficient replay state.
8. Mark deletion complete only after every applicable class is verified and replay protection is durable.

Completion is a one-way boundary: **completed erasure is irreversible**. There is no undelete, restore exception, compatibility path, or operator bypass for erased data.

## Backup restoration contract

1. Restore into an access-blocked environment.
2. Restore deletion tombstones/progress together with the backup or obtain the authoritative tombstone set that covers the backup snapshot time.
3. Replay all applicable tombstones against restored active data, derived data, exports, and caches.
4. Fail closed if tombstones are missing, corrupt, outside their coverage period, or cannot be replayed completely.
5. Verify replay counts and confirm that erased subjects have no post-deletion access.
6. Open access only after successful replay verification. A backup restoration never reverses a completed erasure.

## Verification and evidence

Use synthetic, non-PII fixtures only:

```sh
node scripts/validate-deletion-matrix.mjs scripts/fixtures/deletion-matrix.complete.json
node scripts/validate-deletion-matrix.mjs scripts/fixtures/deletion-matrix-incomplete.json
```

The first command must exit zero and include `METRIC deletion.classes=12 deletion.missing=0`. It also reports unresolved policy separately and therefore does not approve release. The second command must exit nonzero with `deletion.missing=1`.

For an operational execution, retain only the approved minimum evidence: deletion identifier, matrix version, per-class outcome, tombstone replay result, completion state, and timestamps. Do not place deleted content, credentials, or personal data in evidence.

## Failure handling

- Leave the request incomplete on any class failure; retry idempotently from durable progress.
- Keep access blocked during any restore/replay failure.
- Escalate legal-hold ambiguity or a pending retention decision to the owner.
- Never report completion based solely on queue acceptance, an attempted delete, backup expiry, or partial class coverage.
