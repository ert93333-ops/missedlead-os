# Retention decisions

## Decision boundary

This document records product-policy decision state, not legal advice. No legal or owner approval is claimed. Counsel-dependent choices stay `policy_pending`; engineers must not replace them with assumed durations or jurisdictions.

**Owner-only approval gate:** release approval may be recorded only by the owner after all pending choices below are resolved. A valid twelve-row matrix proves structural completeness only. While any row is `policy_pending`, `release_approved` must remain `false`.

## Recorded decisions

| Data classes | Current decision | Expiry | Approval state |
|---|---|---|---|
| Auth identity/session; profile/address/property; requests/details/messages/translations; intake media; provider evidence/documents; notifications; caches; exports | Erase | Upon verified deletion completion | Contract decision recorded; subject to the legal-hold gate |
| audit/logs | `policy_pending` | Not selected | Owner decision informed by counsel required for retention and de-identification |
| financial/legal records | `policy_pending` | Not selected | Owner decision informed by counsel required for categories and retention periods |
| backups | `policy_pending` | Not selected | Owner decision informed by counsel and recovery requirements required for expiry/destruction schedule |
| deletion tombstones/progress | `policy_pending` | Not selected | Owner must select a period that continues to protect every recoverable backup generation |

## Invariants

1. Completed erasure is irreversible. An erased record cannot be restored or made accessible.
2. Restore workflows block access until deletion tombstones are replayed successfully.
3. Tombstone replay re-applies completed deletions to restored data before any user, operator, worker, export, or cache can access it.
4. A legal-hold condition blocks completion and is escalated to the owner; this contract does not decide whether a hold applies.
5. Retained material is restricted to the approved retained purpose and is not ordinary post-deletion account data.
6. A pending choice cannot be represented as `erase`, `retain`, or `anonymize` merely to pass validation.

## Owner approval record

The approval record is intentionally unset. Before changing `release_approved` to `true`, the owner must record the approved action, reason, expiry, legal-hold behavior, post-deletion access, restore handling, and responsible data owner for each pending class. The validator rejects release approval while unresolved policy choices remain.
