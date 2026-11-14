# Release R1.1: ORION intelligence and chat routing fix

- **Approved to start:** 2026-11-14 ("Start Agentory R1.1"). Decisions: go ahead; ORION writes text-only drafts directly.
- **Base:** R1 (`3bef8fd03998c4133b9bebaf87acdd03a3dad5f9`, live on production `ohsdatpvfdjdemstoiuj`).
- **Release candidate:** the R1.1 commit quoted in the approval request. It becomes `--sha` and is stamped into the live `x-agentory-build` header.

## Scope

| Item | Change | Production effect |
|---|---|---|
| `pilot-chat` (edge function) | **The only backend deploy.** Routing, totals, account lookup, evidence quality, drafting, copy fixes. | Replaces R1's `pilot-chat` (`3bef8fd0`). |
| Frontend: `OrionDraftChip`, `src/lib/chat/orionDraft.ts`, `ChatView` | A "Draft only · nothing sent or published · campaign execution is off" chip on ORION drafts | Ships with the next frontend build. It is inert until a draft carries `metadata.orion_draft`. |
| Secrets | **None changed.** `AGENTORY_DELEGATION_ENABLED=false` and `AGENTORY_ORION_EVIDENCE_CONTEXT=true` stay as R1 set them. The script checks their names only. | none |
| Database | **None.** No migration, no data write. | none |
| Other functions | **None.** `daily-brief`, the three Company Brain functions, `run-agent`, `orchestrate`, the lead functions and cron are verified unmoved before and after. | none |

Confirmed with `deno info`: of all edge functions, only `pilot-chat` imports the changed shared modules.

## What changed, against the 20 live tests

| Fix | Files | Live tests |
|---|---|---|
| **Routing.** A read needing reasoning (comparison, explanation, filter, named fields, several parts or sources) goes to ORION's evidence answer. A simple list keeps the $0 template. A paid objective under "do not execute" is answered, never started. | `_shared/orionIntelligence.ts`, `pilot-chat` | 4, 7, 9, 11, 12, 17, 19 |
| **Every sub-question kept.** Compound asks are split, and the answer shape lists each part. | `orionIntelligence.subQuestions`, `orionEvidenceContext.orionAnswerShapeFor` | 4, 20 |
| **Authoritative totals, read per authenticated workspace:** accounts, leads by status, scored, qualified, contacts, signals by type, hiring signals and those older than 30 days, monitoring subjects (enabled). **Zero, missing and failed are kept apart:** a failed table reads "COULD NOT BE READ", never 0. | `_shared/orionWorkspaceFacts.ts` | 4, 6, 10, 20 |
| **Named-account lookup** in `accounts`, not only leads. | `orionWorkspaceFacts.matchNamedAccounts` | 8, 9 |
| **Evidence quality:** observed versus event dates; observed fact, agent inference or unverified; HISTORICAL hiring signals; "a sample, not a census"; Company Brain kept separate from other companies' records; selection follows the question's source (signals, leads or both). | `_shared/orionEvidenceContext.ts` | 6, 11, 12, 13, 20 |
| **Company Brain data checks:** "2–2 employees", a label that disagrees with the range, empty positioning. Flagged only; the Brain is never written. | `orionWorkspaceFacts.brainDataWarnings` | 1 |
| **ORION text-only drafts** (posts, messages, cold emails, follow-ups, video scripts, campaigns) while delegation is off. One model call, one message, no row, no mission, no send. A server-side "Draft only" notice is appended. | `_shared/orionDraft.ts`, `pilot-chat` | 14, 15, 16 |
| **No empty draft rows:** with delegation off, the compose route refuses before creating a `content_item` or a confirmation card. | `pilot-chat` | 14, 15 (left 2 empty rows on production) |
| **Copy:** "no leads saved in this conversation" now says it means this chat, not the workspace. The delegation-off message offers drafts. | `_shared/composeSurface.ts`, `pilot-chat` | 16 |
| **List template:** observed date when no event date exists ("date not stated" is gone); newest-observed ordering; a failed query reads as a retrieval error, not "you don't have any". | `_shared/readSurface.ts` | 11 |
| **Prompt:** with delegation off, ORION offers drafts and says execution is not enabled; the length rule follows the answer shape. | `_shared/converseSurface.ts` | 14–19 |

## Spend

- **Model:** unchanged. OpenAI only: GPT-5.6 Luna, with Terra 5.6 for repair only. Every call goes through `generateText` with the model-spend ceiling.
- **Output budgets:** a business answer gets up to 1,100 tokens (was 420); a draft gets 750–1,400 depending on the formats asked.
- **Reads:** the totals and named-account lookup add 5 reads per business turn, at $0 provider cost (74 ms on the local real database).

## Not in R1.1

- **The two empty `content_item` draft rows** left by tests 14 and 15 on production (2026-11-13 15:03:28 and 15:08:07 UTC). They are not deleted; deleting them needs a separate approval.
- **Company Brain corrections.** These are proposals only: see `COMPANY_BRAIN_CORRECTIONS.md`.
- **Agent execution.** Delegation stays off: no ATLAS sourcing, enrichment, LISA runs, LYRA agent runs, sending or posting.
