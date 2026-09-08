# Full feature completion work — 2026-09-05

User scope: complete the supplied PDF features with research; native iOS/Android primary, web secondary, EN/ES instead of KO/EN, Stripe signup deferred. The previously approved single-chat visual direction remains the entry point.

| Lane | Ownership | Current acceptance target |
| --- | --- | --- |
| Official research | completion_research | Updated licensing/permit, provider verification and mobile payment constraints |
| Providers and quotes | provider_completion | Private application documents, operator decisions, itemized valid quotes, response acceptance/decline |
| Care | care_completion | Safe bundles, dedicated provider priority/fallback, maintenance records and reminders |
| Business | business_completion | Locations, approvals, urgency, annual reports, internal notifications |
| Customer mobile | mobile_transactions | Request list, quote selection, messages, schedules, changes, completion/disputes/reviews |
| Management mobile | mobile_management | Working provider/care/business/operations screens |
| Integration | root | Shared authenticated API, app navigation/roles, privacy/address/price/safety and evidence gaps, migrations and end-to-end checks |

Migrations are local only and preserve existing data. Read-only research and reversible local implementation are authorized. External signup, publication, notifications to other people, live payments and store submission remain separate owner boundaries. Never mark a lane complete based solely on a placeholder, route mock or an old result.

Final verification requires current server/mobile type checks, meaningful authorization/transaction tests, local Supabase persistence checks and actual app rendering. Prior Android host-memory failures are known; recheck resources before trying a changed runtime approach. If native rendering is blocked, record it explicitly instead of using a web screenshot as device evidence.
