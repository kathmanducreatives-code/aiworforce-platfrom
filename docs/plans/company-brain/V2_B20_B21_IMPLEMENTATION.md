# Company Brain V2: B2.0 and B2.1 implementation

Branch `claude/company-brain-v2`, based on `launch/hardening` `a2c0b55f`. It follows the specification in
`V2_AUDIT_AND_ROADMAP.md` (on branch `claude/agentory-audit-roadmap-64uq8n`). There are three commits, which
should be reviewed in this order:

| Commit | What it does |
|---|---|
| `c49f751d` golden | Pins the ATLAS Brain read contract before anything changes |
| `2bafed89` B2.0 | Truthful readiness and guided completion |
| `4ae631e4` B2.1 | One ICP: detect conflicts, resolve them, and refuse new contradictions |

Nothing is deployed and no migration is added. No paid research, provider or model call is made. ATLAS
discovery, actor selection and execution are untouched, and so are the ATLAS TEST fixtures. LISA manual
scans, monitoring containment and the ORION delegation switch are unchanged.

## 1. The ATLAS read contract is pinned first (golden)

`tests/edge-functions/_shared/companyBrainAtlasContract.test.ts` snapshots every path ATLAS and pilot-chat read
the Brain through:
- `compilerBrainContext`;
- `contractBrainInput` (the `BrainMergeInput`);
- `brainPlanningContext`, both onboarded and not;
- `compileCompanyBrainContext`.

It covers 7 fictional profiles (`tests/fixtures/company-brain/atlas-contract-profiles.json`). It also covers
4 edits through the update path.

The golden file was generated from unchanged code and is regenerated only with `UPDATE_GOLDEN=1`. It still
passes unchanged after B2.0 and B2.1. The output and authority semantics ATLAS consumes are unchanged.

## 2. B2.0: truthful readiness and guided completion

### Before
Activation called a Brain "complete" when a handful of fields were non-empty. The Brain page showed no list
of what was missing and no way to fill goals, go-to-market or evidence. Research findings stayed in
`company_brain_research_runs` unused.

### After
The **"Finish the essentials your AI team relies on"** panel sits on the existing Brain page.

**Readiness overview:**
- a score ring;
- Essentials and Enrichment counts;
- Conflicts and Needs verification counts.

**Sections.** There are 12 sections, and each one names the agents that use it:
- **Required:** company, target customer (ICP), buyer personas, goals, positioning and offer, qualification
  rules, buying signals.
- **Optional enrichment:** competitors, brand voice, go-to-market, evidence and sources, fit examples.

Each section is Missing, Incomplete, Needs review (B2.1) or Complete. When a section is open it shows:
- exactly what is missing;
- any unverified claims;
- its conflicts (B2.1);
- suggestions;
- an editor.

**Editors:**
- Goals, go-to-market and evidence get inline editors with an explicit Save.
- Every other section reuses the existing drawer editors.

**Suggestions:**
- They come only from research already stored (the latest completed website run) and from the existing free
  draft suggesters.
- Each one shows its source and confidence and offers **Accept**, **Edit first** or **Not now**.
- Nothing persists until it is accepted.
- Suggestions are offered only for empty fields, and an accepted list is unioned with what is already
  there. Research never overwrites what a user typed.

**Readiness never blocks.** Agents and features keep working whatever the score.

**Roles:**
- Members without edit rights see a read-only panel.
- The server refuses their writes (403) whatever the UI shows.

### Architecture
- **`_shared/companyBrainAssessment.ts`** is a pure assessment over the compiled Brain (`normalizeCompanyBrain`)
  and the raw profile, for goals and GTM, which the compiled V2 shape does not carry.
  - Unverified is flagged only where the data supports it: proof points with no evidence source, or a draft
    that was never activated.
- **`_shared/companyBrainCompletion.ts`** builds minimal patches and suggestions.
  - Goals, GTM and evidence send only the fields that changed.
  - Disqualifier edits keep the other buckets.
- **`_shared/companyBrainUpdate.ts`**: the authorized update action (`generate-company-brain-draft`, action
  `update`) accepts `goals`, `gtm` and `evidence`.
  - A strict shape sanitizer rejects unknown fields and wrong types.
  - Writes still go through compare-and-swap on `updated_at`, then `authorizedBrainWrite` and the revisions
    trigger. No new write path exists.
- **Frontend:** the frontend imports the shared modules through `src/lib/companyBrain/completion.ts`.
  - It reads stored research with a read-only select that RLS scopes (`src/lib/companyBrain/researchRuns.ts`).
  - The page source still never names the data client (an existing guard test).

## 3. B2.1: one ICP

### Before
The ICP lived in up to four places:
- `target_customer`;
- `buyer_personas`;
- the legacy `icp` mirror, which ATLAS and pilot-chat read;
- `signal_preferences`.

The copies could silently disagree. A real example from R1.1: a size label of "5" with enforced bounds of 2–2.
The `setup-company-brain` analyze step could write a model-generated `icp` over a structured Brain.

### After
- **Authority.** `target_customer` (with `buyer_personas` and `pain_points`) is the authoritative ICP. `icp`
  and `signal_preferences` are projections. Every authorized edit rewrites the mirror in the same write
  (`companyBrainMirror`, already used by both write paths). B2.1 proves this for both paths.
- **Detection.** `_shared/companyBrainIcpConsistency.ts` sorts each disagreement into one of three kinds:
  - **Out of date:** the copy lead search reads differs in industries, geography, size, buyer roles or
    disqualifiers.
  - **Contradiction:** an industry is both targeted and excluded, a persona is also an excluded title, or a
    size label disagrees with its bounds.
  - **Signal monitoring:** monitoring watches an excluded industry, or watches regions outside the ICP. This
    kind is advisory.
- **Resolution in the UI:**
  - Each conflict appears on its section and compares "Your ICP" (or the specific field) with the other
    copy.
  - It offers one-click resolutions, each an ordinary authorized update.
  - The section with conflicts opens first.
  - A filled section with an open conflict reads **Needs review** and earns half credit until it is
    resolved.
  - Applying the resolutions converges to zero conflicts (unit-tested). ATLAS then reads the authoritative
    ICP.
- **Write guard.** The update path refuses any write that *creates* a contradiction (`400 icp_contradiction`,
  with the reason). The page shows "This change would contradict your ICP".
  - Contradictions already on record never block an unrelated edit, so existing Brains stay editable.
  - Extra monitoring regions stay advisory.
- **Analyze.** `setup-company-brain`'s analyze no longer writes the model's `icp` or competitor list over a
  structured Brain. They are still returned in the draft for review. A legacy-only Brain keeps the old
  behaviour.
- **Qualification in guided completion.** The qualification section (disqualifiers and review rules) is a
  required essential. Its conflicts and suggestions appear in the panel.

## 4. Tests (all data fictional)

| Lane | Result |
|---|---|
| Edge-function suite (whole repo) | 10,215 passed / 0 failed |
| Infra | 335 / 0 |
| Frontend (UI guards) | 798 / 0 |
| `deno check` (32 functions) | pass |
| tsc / eslint ratchets | 23 / 1,265: at baseline, no new findings |
| `npm run build` | pass |
| Database contract lane (real Postgres and PostgREST) | 458 / 0 |
| Golden ATLAS contract | 12 / 0, unchanged |
| B2.0 completion unit tests | 15 / 0 |
| B2.1 consistency unit tests | 13 / 0 |
| Browser, real stack (GoTrue, Postgres, PostgREST, Vite, headless Chrome) | completion 4/4, memory 2/2 |

**The completion browser test covers:**
- goals typed, saved and reloaded;
- a website-research suggestion accepted;
- edit-first on a suggestion;
- "Not now" writes nothing;
- a stale save is refused (409);
- the viewer is read-only, and a bypass write gets 403;
- the ATLAS context is unchanged by completion edits;
- B2.1: 8 conflicts shown, resolutions clicked, ATLAS reads Retail and France afterwards, and the server
  refuses a contradiction-creating write (400);
- alignment of the open section's layout.

The function call log shows only `update` calls: no research and no provider calls.

## 5. Known limitations
- **Workspace scope:** B2.0 covers the agency (workspace) Brain only. Client-scoped Brains keep the existing
  page.
- **Goals and GTM suggestions:** these sections get no suggestions, because no stored research covers them.
  Users type them.
- **Unverified flag:** it is shown only where data supports it (proof points without sources, an un-activated
  draft). Per-field provenance is B2.2.
- **Size guard:** it blocks only *new* contradictions, so a contradiction already on record must be resolved
  in the panel.
- **Signal-monitoring geography drift:** it is advisory and never refused.
- **Live verification:** nothing is verified live yet. See §7.

## 6. Manual test guide (local or TEST, fictional workspace)
1. Sign in as an owner or editor of a workspace whose Brain is activated. Open **Company Brain**.
2. Check the readiness panel:
   - The overview ring links to it.
   - Essentials count only the sections that are really complete.
3. Open **Business goals**:
   - Enter a primary objective and a 90-day target, then click **Save**.
   - Reload the page. The values persist and the section reads Complete.
4. Open **Positioning & offer**. If website research was stored, a suggestion card shows its source:
   - **Edit first**: change the text, then accept.
   - **Not now** on another card: nothing is saved.
5. Edit one field in two tabs, then save in both. The second save says the Brain changed and reloads
   (no silent overwrite).
6. Use a Brain whose legacy copy disagrees, or edit the industries in the drawer and compare. The conflicts
   appear on **Target customer (ICP)**:
   - Click **Update the copy lead search reads…**. The conflict disappears.
   - Run an ATLAS search. It uses the ICP industries.
7. In the drawer, add a target industry as a disqualifier. The save is refused with "This change would
   contradict your ICP".
8. Sign in as a viewer. The panel is read-only, with no Save or Accept buttons.

## 7. Remaining live TEST gates (not done: need approval and credentials)
- **Deploy to TEST:** `generate-company-brain-draft` and `setup-company-brain` must be deployed to TEST
  (`tlvnfrxzjhsjgdofwehb`) and the frontend run against TEST. The GitHub `supabase-test` environment's
  `SUPABASE_ACCESS_TOKEN` is expired (401).
- **Fictional workspace:** per ATLAS's policy, TEST holds no Brain rows, so a separate fictional workspace is
  needed. ATLAS fixtures are not touched.
- **Live checks:** repeat §6 on TEST. Confirm one ATLAS search reads the resolved ICP. Confirm the revisions
  table records each completion save.

## 8. Next: B2.2 and B2.3
- **B2.2: provenance and evidence** (additive migration; coordinate ownership with the ATLAS session):
  - Add `source` and `reason` to `company_brain_revisions`, set by the writer RPC from a session-local
    setting.
  - Accepted suggestions carry `research:<run id>`.
  - Show "where this came from" per section.
  - Turn "Needs verification" into per-field evidence.
  - The contract lane must prove a browser cannot forge the source.
- **B2.3: activate memory:**
  - "Add a preference", "Record a decision" and "This is wrong" entry points on the Brain page, using
    existing V1 memory.
  - ORION proposes decisions; a person approves them.
  - The review queue appears on the dashboard.
  - The contract test checks that a UI preference reaches ORION's effective profile within the same request
    cycle.
