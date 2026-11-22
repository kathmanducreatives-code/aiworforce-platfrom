# Company Brain V2: B2.2 (provenance) and B2.3 (memory activation)

Branch `claude/company-brain-v2`. These changes follow B2.0 and B2.1 (see `V2_B20_B21_IMPLEMENTATION.md`).

**Commits:**
- `df98befc` B2.2: knowledge provenance.
- `b41361d8`: fix for the page jump on load.
- `f3b451c6` B2.3: activate memory.
- `43845938`: keeps the existing contract lane green, and the offer card shows the remembered value.
- Docs.

**Scope limits:**
- Nothing is deployed. Every migration is held.
- No paid research, provider or model call is made.
- ATLAS discovery, actor selection and execution are untouched, and so are the ATLAS TEST fixtures.
- Delegation stays off, scheduled monitoring stays off, and manual LISA scans are unchanged.
- The ATLAS Brain read contract (`BrainMergeInput`) is pinned by the golden test, which is unchanged after both milestones.

**Correction (2026-11-22):** an earlier version of this note said V1 memory had never been applied to a hosted project. That was wrong. **Production has V1 memory, applied 2026-11-13** (verified read-only; see `ENVIRONMENT_INVENTORY.md`). TEST does not. B2.2 and B2.3 are additive held migrations on top of it.

## B2.2: where every piece of knowledge came from

### What the person sees
Every section of the Brain page has a **"Where this came from"** block. It shows:
- the latest recorded change to the knowledge that section holds: who made it ("you" or "a teammate"), how, when and why;
- for accepted website research, the research run (its date and how many pages it read), with a link to the page it read;
- how many recorded changes the section has;
- the confirmed memory that also shapes the section, for example an approved exclusion on "Qualification rules" or an approved competitor on "Competitors".

The history tab names the source of each profile revision.

Trust labels say only what was recorded:

| Source | Label |
|---|---|
| `founder` | "Entered by you", your team's own statement |
| `research` | "Accepted from website research", read from your website, then confirmed by a person |
| `ai_inference` | "Drafted by AI", not yet reviewed by a person |
| `memory` | Promoted from approved memory |
| `system` | Changed by Agentory, no person made this change |
| `backfill` / `unrecorded` | "Saved before sources were recorded" |

Nothing is promoted to "verified". No confidence is shown that was not stored.

### How it works
- **Revisions:** `company_brain_revisions` gains `source_kind`, `source_ref` (a research run or memory item id) and `reason`. They are written by the existing revision trigger from transaction-local settings, which vanish at commit.
- **Wrapper:** `company_brain_provenanced_write` (service role only) validates the claim against the database, then calls the unchanged `company_brain_authorized_write` in the same transaction. Its checks:
  - a research run must be a **completed run of the same workspace**;
  - a memory item must be **active, confirmed and in the same workspace**.
- **The server decides the source.** The page may claim what the person did: accepted suggestion X, or chose resolution Y.
  - The update action re-derives the suggestion from the research runs it reads itself. It records `research` (with the run id) or `ai_inference` only when the patch is exactly what accepting that suggestion produces.
  - A suggestion edited first is the person's own words (`founder`), with the suggestion named in the reason.
  - A claim it cannot prove is recorded as `founder` and flagged as downgraded.
  - A run id sent by the page is ignored.
- **Other write paths:**
  - setup steps are `founder`;
  - onboarding's analyze step is `ai_inference`;
  - onboarding saves map their validated change origin;
  - anything else stays `unrecorded`, never guessed.
- **Where the migration is absent,** handlers fall back to the authorized writer and revisions read as unrecorded.

### Fixed along the way (from B2.0)
- **Inline editor draft:** an inline editor kept its first draft, so a value accepted later looked like a pending edit, and saving would have cleared it. Untouched fields now follow the saved profile.
- **Page jump on load:** the tab strip's `scrollIntoView` scrolled the whole page to the tabs on load, which sit below the readiness panel. Users landed mid-page, and the cache-session browser test could not click the scope switcher. It now scrolls only the strip.

## B2.3: persistent memory as an everyday business capability

### What the person sees
- **"What Agentory knows"** (the memory panel) has a **Teach Agentory** dialog with four intents:
  - **Add a preference:** exclusions (industry, company, region, keyword), target size, tone, content restriction, sales priority. Optionally temporary, with an end date.
  - **Record a decision:** strategy, who we target, or brand and messaging, with an optional reason.
  - **Record a fact.**
  - **Correct something:** "what Agentory has wrong" and "what is true". This supersedes the earlier belief for every agent.
- **Conflicts with the profile are resolved on purpose.** Excluding an industry the profile targets, or setting a size or tone that differs from it, is refused by the server (`needs_resolution`) until the person reads the difference and chooses **Remember anyway**.
- **Each memory card shows:**
  - its source and verification;
  - its freshness: "Confirmed 20 Nov 2026", "Due for review", "Temporary · until 1 Dec 2026", or "Disputed · agents do not use it";
  - **which agents use it**, following the shared loader's rules. Unservable knowledge is used by nobody.
- **Review queue:** agent suggestions can be **approved, edited or rejected**. An edit keeps the proposal's own shape: a decision's outcome, an exclusion's value, a competitor's name, a size range. V1 always wrote `name`, which broke exclusions and decisions.
- **Dashboard:** when anything is pending, "Your agents offered to remember N things" appears, with the oldest items. Nothing is approved from the dashboard; it links to the review queue.
- **Chat:** when you tell ORION something lasting, ORION's reply is followed by an offer card with these actions:
  - **Remember** saves it.
  - **Edit** changes the wording before saving.
  - **Not now** leaves it in the review queue.
  - **Don't remember** rejects it, and ORION will not offer it again.

  The card reads the proposal's live state, so a reload, another tab or a teammate's review shows what happened.

### How ORION decides
`_shared/orionMemoryOffer.ts` is deterministic, with no model call and no spend:
- **Lasting statements** ("from now on…", "never target…", "we've decided…", "our tone should always be…") that it can turn into an exact memory item become a **pending proposal** from `orion`, through the V1 `company_brain_proposal_submit`.
  - The user's own words are kept as evidence, together with the conversation and message id.
  - The proposal is built with the same shared builders as the Teach dialog, so the same statement always lands on the same key.
- **Temporary requests** ("for this search…", "just this week…", "for now…") store nothing. ORION adds: "Noted for this request only… Say 'from now on…' if it should always apply."
- **A strong lasting cue** ("from now on") wins over a time word.
- **Questions, hypotheticals and anything vague** get no offer.
- In pilot-chat, the offer is computed after the user's turn is recorded and posted by the serve wrapper after a successful answer. None of the 23 reply paths changed, and card actions are never read as statements. It is best-effort: a failure never touches the answer.

### Guarantees and where each is enforced

| Guarantee | Enforced by |
|---|---|
| Nothing inferred becomes memory without approval | Agents can only create pending proposals. Approval is `company_brain_proposal_review` (editor role, re-checked in-transaction) |
| Approved preferences reach ORION | The canonical loader (`loadCompanyBrainContext` → `loadChatBrain` → ORION memory block), already used by pilot-chat |
| Memory persists across conversations and reloads | Stored items, read on every turn. Contract and browser tests cover a new conversation |
| Corrections supersede | `correct` versions the item and keeps the prior value in history. ORION reads "Correction … NOT 'old'" |
| Stale, disputed and redacted knowledge is never served | V1 `isServable`. Contract-tested through ORION's block |
| Conflicts need resolution | Memory vs memory: approval must name the version it replaces (`stale` otherwise). Memory vs profile: `needs_resolution` until confirmed |
| No duplicates from repeats | Proposal dedupe (one pending per statement, evidence merged), `already_known`, 180-day `previously_rejected`, per-decision idempotency keys, `not_pending` |
| Workspace isolation and roles | RLS reads, service-role writers, in-transaction role checks, the loader's membership check. A non-member gets nothing, not a fallback read |
| ATLAS is unchanged | ATLAS reads the stored profile (golden test). The memory-folded effective profile goes to ORION and the other agent views only |

Held migration `20261122130000_company_brain_memory_activation.sql`:
- proposals may be `decision` (with `value.outcome`; workspace-wide only for standing business categories);
- `company_brain_proposal_submit` validates decisions and is otherwise the V1 body.

Its rollback withdraws any pending decision proposals and restores the V1 function.

## Tests (fictional data only)

| Lane | Result |
|---|---|
| Edge-function suite | 10,253 passed, 1 failed (date-triggered ATLAS test, see note) |
| Infra | 335 / 0 |
| Frontend | 805 / 0 |
| `deno check`, 32 functions | pass |
| tsc / eslint ratchets | at baseline (23 / 1,265) |
| `npm run build` | pass |
| Contract fixes along the way | `schemaCompat`, autosave and memory end-to-end now pass. See commit `43845938`: the autosave test treats the provenanced wrapper as the same AUTH-06 writer; memory E1 now proves the conflict refusal |
| Database contract lane (real Postgres and PostgREST) | **474 / 0** |
| Browser, real stack: completion | 4 / 4 |
| Browser, real stack: memory | 4 / 4 |
| Browser, real stack: cache session | 5 / 5 (with `--no-sandbox`, see the gates register). It was 1/5 on this branch before the page-jump fix and 4/5 on `launch/hardening` |

**Edge-suite note:** two failures came up during the work and were triaged as follows.
- **`modelFailurePropagation` #16 (fixed).** A source-scanning test paired quote characters across the span that held my new helper. The helper was moved; the assertion is unchanged.
- **`fundingWindowRequirement` "RECENCY" (not fixed, not B2.3's).** Its fixture is dated 2024-11-21 and checked against a two-year window from today. It started failing on 2026-11-22 and fails with every B2.3 change removed. It is an ATLAS test, so it was not touched and is reported to the ATLAS owner.

**New tests:**
- **B2.2:**
  - 10 unit tests (claims, forgery, downgrade, origins);
  - 4 view-model tests;
  - 8 contract tests (founder, research and memory sources; cross-workspace and failed runs refused; role and session still decide; the browser cannot forge; no setting leaks; append-only);
  - browser steps (the run id lands on the revision; provenance shows after reload; a forged claim from the page is recorded as founder).
- **B2.3:**
  - 28 detection and runtime tests;
  - 3 view-model tests;
  - 8 contract tests: conversation → offer → approval → **new conversation** through the loader; temporary requests store nothing; dedupe, replay and `not_pending`; rejection is respected; viewer, outsider and other-workspace attempts refused; decision rules; conflicts and versions; corrections, disputed, stale and redacted items; isolation.
  - 2 browser tests: Teach (decision, fact, correction, conflict resolved on purpose); the chat offer edited and remembered, still remembered after a reload, the dashboard strip, and a new conversation that knows it.

## Manual acceptance guide (local stack or TEST, fictional workspace)

### B2.2 provenance
1. **Accept a suggestion.** On Company Brain, open **Positioning & offer**, accept a website-research suggestion, then reopen the section. "Where this came from" says "Accepted from website research by you", with the research date and a link to the page it read.
2. **Edit a suggestion first.** Use **Edit first** on another suggestion. The section says "Entered by you", with the reason "Edited from your website research…".
3. **Resolve an ICP conflict.** The history tab names the choice made.
4. **Try forging a source.** From the browser console, send an `update` that claims a suggestion with a different value. The response says `downgraded: true`, and the revision says founder.

### B2.3 memory
1. **Record a decision.** Choose **Teach Agentory → Record a decision**, enter "Sell annual plans only" and save. The Decisions tab shows it with "Used by ORION" and "Confirmed today".
2. **Add a conflicting preference.** Choose **Teach Agentory → Add a preference → Exclude an industry** and enter one of your target industries. A conflict notice appears and nothing is saved. Choose **Remember anyway** to save it.
3. **Correct something.** Choose **Teach Agentory → Correct something**. Then ask ORION about it in a new chat: it uses the corrected statement.
4. **Teach ORION something lasting.** In chat, type "From now on, never target gambling companies."
   - After ORION's answer, an offer card appears.
   - Choose **Edit**, change the wording, then choose **Remember this version**.
   - Reload the page. The card still says Remembered.
5. **Check a temporary request.** Type "For this search, skip crypto". ORION notes it is for this request only, and no proposal appears.
6. **Leave an offer for later.** Type another lasting statement and choose **Not now**.
   - The dashboard shows "Your agents offered to remember 1 thing".
   - **Review in Company Brain** opens the queue.
7. **Check a new conversation.** Start a new conversation and ask what to avoid. ORION names the remembered exclusion. Pending or rejected offers are not used.
8. **Check the viewer role.** Sign in as a viewer. The Teach and Approve buttons are hidden, and the chat card says an editor can approve it.

## Next
- **B2.4: every agent reads the same Brain** (ATLAS, LYRA and LISA through the shared loader). This deploys functions and must be coordinated with the ATLAS session: ATLAS's request authority stays its own decision.
- **ORION offers beyond rules:** a model-assisted classifier could be added later. It must stay propose-only, run behind the existing spend ceiling, and be measured against the table of cases in `orionMemoryOffer.test.ts`.
