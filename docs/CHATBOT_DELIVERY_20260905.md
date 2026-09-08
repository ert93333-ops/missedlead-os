# Source-backed chatbot test delivery

## Scope

WeCover mobile app remains primary. The browser version uses the same mobile application. Public test URL: https://word-represented-lay-verse.trycloudflare.com. Test username/password: test/test. The server exchanges this demo alias for a strongly passworded, marked Supabase customer; global password requirements were not weakened. Three clearly fictional technicians are marked demo and cannot match real customers. Payments are disabled.

## Knowledge collection

22 reviewed reference cases across plumbing, HVAC, home maintenance and urgent gas guidance. Each contains candidate causes, discriminating questions, safe observations, limitations and primary-source URLs. Source register: DIAGNOSTIC_SOURCES.md. Generate the SQLite/JSON snapshot with pnpm exec tsx scripts/export-diagnostic-db.ts. Files: data/diagnostic-knowledge.sqlite and data/diagnostic-knowledge.json. These contain reference knowledge, not measured diagnostic accuracy or technician-labelled repair outcomes.

The multimodal model receives matching reference records. For media without identifiable text symptoms, it receives the bounded reference catalogue. Unknown/blank evidence must not create a cause; remote high-likelihood outputs are lowered until on-site evidence exists. First media-only readiness requires a distinguishing follow-up. Text, photo, video and audio use the actual Gemini provider.

## Conversation behavior

Additional media preserves earlier signed evidence. Earlier files cannot silently be removed or replaced. Conversations allow up to80 messages and24000characters. Optional skips require uncertainty acknowledgement; safety questions remain visible even when an earlier optional question used the same ID. An unready answer without questions has a visible next action. References shown are drawn from the same supplied context, not invented answer citations.

Explicit emergency text has an unauthenticated, bounded safety preflight independent of database and model availability. It returns no diagnosis or confirmable request. Normal authenticated intake retains the safety floor. Negation tests include EN/ES comma lists and contrasting positive hazards; this remains a bounded safety aid, not perfect language understanding.

## Verification observed this session

- Final server suite:200/200 at22:12KST, including the final safety and preflight changes.
- Latest focused safety/emergency/intake suite:100/100 after those refinements.
- Mobile suite:23/23 and typecheck.
- SQL feature/isolation/service-access checks:89/89; fixtures rolled back.
- Real Gemini evaluation: initial6calls exposed failures; subsequent3calls returned valid replies; final2-call spoken-symptom/optional-skip flow retained uncertainty and produced provisional scope. Artifacts: diagnosis-evaluation-live*.json. This is not an accuracy benchmark.
- BrowserOS: real test login, Spanish controls and urgent-gas blocking content verified.

## Runtime and limits

Migrations0007–0012 applied after a verified599395-byte database backup in data/backups/. Docker recovery preserved existing data; no reset/recreation was used. Runtime socket backups are documented in the execution history.

The tunnel requires this PC and the recorded processes in artifacts/public-processes.json. Native phone execution, real technician dispatch, actual payments and exhaustive fault accuracy remain separate unverified work. In particular, the pre-existing payment claim/webhook quote-expiry issue must be resolved before enabling payments.

## Public end-to-end receipt

2026-09-05T13:10Z: scripts/smoke-demo-chat.mjs passed against the actual HTTPS tunnel. Test login issued a real customer session. Two actual Gemini calls handled the original unchanged leak/negative-hazard statements, optional skip plus uncertainty acknowledgement, and provisional confirmation. The request persisted three distinct demo provider matches. Original synthetic PNG storage, public signed read HTTP200, and repeat-upload deduplication passed. Evidence: artifacts/demo-chat-smoke.json. The synthetic image proves attachment handling only, not fault-image diagnostic accuracy.

Latest browser build: index-8765fb1e90c4e86a59f1acbe0963a1b2.js. BrowserOS verified fresh login, English offline-safety guidance, and New request clearing only the synthetic conversation. The clean chat has no horizontal document overflow at the observed desktop viewport; no physical-device claim is made.
