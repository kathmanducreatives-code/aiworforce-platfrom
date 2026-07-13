# Q1 frozen replay — before vs after the safety fix

Provider-free replay of the Q1 failure conditions (jobs actor returned 22 raw
rows, 0 accepted; LLM emitted 10 fabricated founders). Proven deterministically
in `supabase/functions/_shared/findLeadsSafety.test.ts` (test 17) and the
`memoryWriter.test.ts` gate tests — **no Apify, no Anthropic**.

| Signal | BEFORE (live Q1, deployed backend) | AFTER (this branch) |
|---|---|---|
| accepted provider candidates | 0 | 0 |
| fabricated candidates surviving | 10 (Scout LLM) → ranked by Aria → drafted by Penn | **0** (rejected by provenance filter) |
| persisted leads | 0 | 0 |
| **outreach drafts created** | **5** (`outreach_drafts`, to fabricated recipients) | **0** (draft gate: no persisted contact-ready lead) |
| status | plan `failed` (kept going) | `no_results` (honest zero-result) |
| Penn / draft_outreach executed | **yes** | **no** — stripped by `source_and_qualify_only`; also chain-guarded in run-agent; also mode-blocked in memoryWriter |

## How each root cause is now closed
- **Fabrication (F1):** `leadProvenance.assertProviderBacked` rejects any company/
  person/URL absent from the normalized provider index → invented identities
  never reach Aria/Penn/persistence.
- **Routing (F2):** `separateIntent` routes founder/why-now queries `account_first`
  (tests 9–10); "Founder" is a persona, not a jobs keyword.
- **Auto-Penn (F3 / blocker):** `filterPlanForMode` strips Penn/draft/publish
  steps from every plan in `source_and_qualify_only`; run-agent refuses to chain
  to a forbidden step; `writePennDrafts` returns early in that mode.
- **Draft with zero leads:** `draftGate.evaluateDraftGate` requires
  `canonical_final_decision=contact` + `contact_ready=true` + a persisted
  lead_candidate_id + provider-backed identity + evidence URL — enforced in
  `writePennDrafts` in **all** modes.
