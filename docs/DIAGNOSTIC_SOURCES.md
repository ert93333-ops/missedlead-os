# Diagnostic knowledge sources

Collected and checked: 2026-09-05. Scope: 22 distinct home-service triage cases, including one emergency path. This is a small reviewed reference collection, not a historical repair dataset, trained diagnostic model, or exhaustive fault catalogue. No failure frequencies or numerical diagnostic probabilities are inferred from these sources.

`server/intake/knowledge/index.ts` exports `retrieveDiagnosticKnowledge(text, locale)` and the typed `diagnosticKnowledge` collection. Search uses bilingual symptom groups, requires a match in every group, caps results at five, and returns only gas guidance when a gas phrase matches. Accent folding supports Spanish. Returned `locale` identifies the desired response language; titles, questions and safe observations contain both languages. Candidate causes and limits are internal English context for the LLM, not untranslated UI strings.

Call retrieval with the user's symptoms and separately identified observations. It does not inspect image/video/audio bytes. The multimodal provider must actually process those inputs and distinguish what was observed from what the customer reported. Retrieved records are evidence for considering possibilities, never proof of a diagnosis. Short follow-up questions distinguish causes; skipped questions retain uncertainty. Local keyword matching has limited recall and does not replace the independent safety gate. No match means ask for clarification or refer to an appropriate professional, never invent a matching database entry.

## Source register

Each record stores source title, original URL and access date. The content is concise paraphrase; complete articles, videos and product manuals are not copied or downloaded into the training corpus. Manufacturer-specific component details require confirmation of the actual model. Questions and conservative observation instructions are editorial triage design informed by the linked material; they are not manufacturer-validated diagnostic algorithms.

| Cases | Official source | Scope and qualification |
| --- | --- | --- |
| Continuous toilet running | [Kohler](https://assist.kohler.com/en/toilets-and-seats/Toilet-Constantly-Leaking-or-Running) | Tank fill/flush mechanisms |
| Intermittent refilling | [Kohler hose position](https://assist.kohler.com/en/toilets-and-seats/Tank-Leak-Fill-Valve-Hose-Position) | Siphoning is one model-dependent alternative |
| External toilet leak | [Kohler pressure-assist guide](https://resources.kohler.com/webassets/kpna/catalog/pdf/en/1196261_17.pdf) | Location distinctions only; pressure-assist procedures must not generalize to other models |
| Faucet base leak | [Moen](https://solutions.moen.com/FAQ%27s/FAQ%27s-Troubleshooting/Kitchen/Kitchen_faucet_leaks_at_the_bottom_of_the_spout) | Pullout and fixed-spout designs differ |
| Low faucet flow | [Moen low flow](https://solutions.moen.com/Article_Library/Kitchen_Faucet%3A_Low_Flow) | Flow location and temperature distinguish restrictions |
| Shower drip | [Moen INS2151C](https://www.moen.com/shared/docs/instruction-sheets/ins2151c.pdf) | Applies to the documented valve family |
| Drain backup; building water leak | [Charlotte Water](https://www.charlottenc.gov/water/Customer-Care/Fixes-Troubleshooting) | Private plumbing versus public sewer responsibility |
| Insufficient hot water; heater leak; discolored hot water | [Rheem warning signs](https://www.rheem.com/water-heating/articles/5-signs-your-water-heater-is-going-bad-and-what-to-do-about-it/) | Candidate causes need physical verification |
| Heater noise | [Rheem heat-pump maintenance](https://www.rheem.com/water-heating/articles/heat-pump-water-heater-maintenance-complete-rheem-care-guide-troubleshooting/) | Identify heater technology before applying |
| AC not cooling; ice | [Carrier troubleshooting](https://www.carrier.com/us/en/residential/hvac-resources/air-conditioners/troubleshoot-an-ac-not-working/) | Refrigerant/electrical work requires a professional |
| AC water leak | [Carrier leaks](https://www.carrier.com/us/en/residential/hvac-resources/air-conditioners/why-is-my-ac-leaking-water/) | Water appearance alone does not identify the failed component |
| Window condensation | [Andersen interior condensation](https://helpcenter.andersenwindows.com/aw/articles/Knowledge/Condensation-on-the-Interior-of-Window-or-Patio-Door-Glass) | Surface condensation is distinct from between-pane moisture |
| Window sill water | [Andersen care guide](https://www.andersenwindows.com/-/media/Project/AndersenCorporation/AndersenWindows/AndersenWindows/files/technical-docs/care-and-maintenance/9184628.pdf) | Drainage depends on design |
| Wall cracks | [FEMA foundation assessment](https://emilms.fema.gov/IS1104/groups/261.html) | Observation and escalation only; no structural clearance remotely |
| Suspected gas | [Piedmont / Duke Energy](https://news.duke-energy.com/releases/piedmont-natural-gas-reminds-customers-how-to-identify-a-natural-gas-leak) | Leave and call from safety; do not prolong evidence collection |

## Validation and remaining limits

Initial test stub produced eight expected failures; implementation then passed the nine initial tests. Expanded tests cover each of the 22 record cases, irrelevant input, emergency precedence and source/limit integrity. Run `pnpm exec vitest run server/intake/knowledge/retrieval.test.ts` for current results. These prove retrieval behavior, not real-world diagnostic accuracy, multimodal perception accuracy, end-to-end provider integration or Spanish clinical/trade expert review.

Before claiming diagnostic accuracy, collect consented cases with technician-confirmed findings, evaluate a held-out set by symptom and modality, inspect emergency misses and unsupported certainty, and version the collection. No paid/private customer cases or personal details were collected here. No arbitrary internet repair prices were added to estimates.

## Bounded additions

Three additional cases verified on 2026-09-05: under-sink water ([Moen kitchen-specific source](https://solutions.moen.com/Article_Library/Kitchen_Faucet%3A_Leaking_Under_The_Sink_Base)); unusual AC noise ([Carrier repair guide](https://www.carrier.com/us/en/residential/hvac-resources/air-conditioners/ac-repair/)); dishwasher leak ([Whirlpool guide](https://producthelp.whirlpool.com/Dishwashers/Product_Info/Dishwasher_Product_Assistance/Dishwasher_Leaking_Troubleshooting_Guide)). All have English and Spanish retrieval examples. Under-sink drainage origin remains unknown until inspected; sound does not identify one failed component. Dishwasher is grouped under plumbing for intake only: an internal appliance fault requires an appliance-qualified technician and must not automatically be assigned to a general plumber.
