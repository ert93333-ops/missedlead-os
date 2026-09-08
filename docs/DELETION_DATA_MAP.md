# Deletion data map

## Scope and status

This is the slice 2B policy-decision contract. It is not legal advice, a claim of legal approval, or evidence that deletion is implemented in product code. The executable copy is `scripts/fixtures/deletion-matrix.complete.json`; `scripts/validate-deletion-matrix.mjs` enforces its structure.

**Release gate:** only the owner may approve release, after resolving every `policy_pending` row with counsel where appropriate. Structural validation does not satisfy that gate. The current matrix is structurally complete and not release-approved.

A completed erasure is irreversible. A restored backup remains inaccessible until deletion tombstones have been replayed successfully, so restoration cannot recreate access to erased data.

## Required classes

These are the only twelve class identifiers accepted by the validator. Storage-system and table-level inventory remains an implementation activity; this contract does not invent product locations.

| Class | Included data | Action | Reason | Expiry / owner decision | Legal hold behavior | Post-deletion access | Restore handling | Data owner |
|---|---|---|---|---|---|---|---|---|
| Auth identity/session | Account identity, credentials, sessions, recovery state | `erase` | Remove credentials and active access | `upon_verified_deletion_completion` | Block execution and escalate to owner | `none` | Replay tombstone before access | Identity owner |
| profile/address/property | Profile and service-location/property data | `erase` | Remove account-linked customer data | `upon_verified_deletion_completion` | Block execution and escalate to owner | `none` | Replay tombstone before access | Customer data owner |
| requests/details/messages/translations | Requests, detail records, messages, and derived translations | `erase` | Remove account-linked service and communication content | `upon_verified_deletion_completion` | Block execution and escalate to owner | `none` | Replay tombstone before access | Service operations owner |
| intake media | Uploaded intake media and derived media | `erase` | Remove account-linked media | `upon_verified_deletion_completion` | Block execution and escalate to owner | `none` | Replay tombstone before access | Intake data owner |
| provider evidence/documents | Provider submissions and supporting documents | `erase` | Remove account-linked submissions without a separately approved retention basis | `upon_verified_deletion_completion` | Block execution and escalate to owner | `none` | Replay tombstone before access | Provider operations owner |
| notifications | Queued notifications, payloads, and account-linked history | `erase` | Remove communication payloads and history | `upon_verified_deletion_completion` | Block execution and escalate to owner | `none` | Replay tombstone before access | Communications owner |
| audit/logs | Audit events and operational/security logs | `policy_pending` | Retention and acceptable de-identification require owner decision informed by counsel | Owner decision pending | Preserve restricted and escalate to owner | `restricted_retained_only` | Restore restricted retained data only | Security and compliance owner |
| financial/legal records | Financial records and records identified by the owner as legal records | `policy_pending` | Categories and retention periods require owner decision informed by counsel | Owner decision pending | Preserve restricted and escalate to owner | `restricted_retained_only` | Restore restricted retained data only | Finance and legal owner |
| caches | Account-linked cached values | `erase` | Prevent stale access after deletion | `upon_verified_deletion_completion` | Block execution and escalate to owner | `none` | Not restorable | Platform operations owner |
| exports | Server-controlled generated exports | `erase` | Remove account-linked exported copies under platform control | `upon_verified_deletion_completion` | Block execution and escalate to owner | `none` | Replay tombstone before access | Customer data owner |
| backups | Recovery copies | `policy_pending` | Expiry/destruction schedule requires owner decision informed by counsel and recovery requirements | Owner decision pending | Preserve restricted and escalate to owner | `restricted_retained_only` | Replay tombstone before access | Platform operations owner |
| deletion tombstones/progress | Deletion markers, replay state, and completion state | `policy_pending` | Minimum lifetime must protect all recoverable backups; final period requires owner approval | Owner decision pending | Preserve restricted and escalate to owner | `restricted_retained_only` | Restore restricted retained data only | Privacy operations owner |

“Block execution” means do not mark deletion complete while the hold is unresolved. It does not define when a hold is legally required. “Preserve restricted” is a contract state, not an authorization for ordinary product access.
