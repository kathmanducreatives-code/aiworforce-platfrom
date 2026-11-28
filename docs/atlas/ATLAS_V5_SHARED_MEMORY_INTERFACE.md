# ATLAS ⇄ Company Brain — shared memory-exclusion interface (V5)

Status: **proposed by ATLAS, 2026-11-28**. It needs the Company Brain session's agreement before either side merges.
ATLAS branch: `feat/atlas-v5-g2-g3-memory`. The interface itself is in commit `6b32828f`.

## Field

`ContractBrainInput.excluded_industries_memory` is defined in `supabase/functions/_shared/missionContract/brain.ts`.

```ts
export interface MemoryIndustryExclusion {
  value: string;              // the industry as approved ("crypto", "oil and gas")
  memory_id: string;          // company_brain_memory.id (provenance; shown and kept on the requirement)
  approval_status: string;    // must be "approved"
  lifecycle_status: string;   // must be "active"
  scope?: string | null;      // "workspace" or absent
  workspace_id?: string | null; // when present, must be the workspace being planned
  expires_at?: string | null; // when present and past, the memory has expired
}
```

## What Brain sends, what ATLAS does

| | Company Brain (owner: Brain session) | ATLAS (owner: ATLAS session) |
|---|---|---|
| **Source** | One entry per approved, servable `exclusion` memory of type `industry`, taken from `deriveExclusions(...).items`. Brain keeps the `memory_id`; it does **not** fold the entries into `excluded_industries_explicit`. | Reads only `excluded_industries_memory` for memory. Profile exclusions stay in `excluded_industries_explicit` and `excluded_industries_generic`, unchanged. |
| **Filtering** | The loader's existing rule: approved and servable only. | Re-checks with `servableMemoryExclusions`. Anything not `approved`, `active`, workspace-scoped, this workspace and unexpired is **refused with a reason** and listed on the plan. It is never applied. |
| **Identity** | `memory_id` | A memory-only exclusion becomes requirement `memory:exclusion:industry:<slug>` with policy `company_brain_memory_exclusion`. A profile exclusion keeps `brain:exclusion:industry:<slug>`. |
| **Dedup** | none needed | `mergeExclusions` keys on `normalizePhrase(value)`: one requirement per industry, with every source (`request`, `brain_profile`, `brain_memory`) and every memory id kept (`Origin.memoryIds`, sorted). Profile plus memory → the `brain:` id, labelled "workspace rule and approved memory". |
| **Authority** | unchanged | Policy, the same as an explicit workspace exclusion. It narrows and never targets. A request asking for the excluded industry becomes a **question before approval**; neither side wins silently. A request that already excludes it adds nothing, and its provenance is recorded. No new precedence rule. |
| **Flexible Discovery** | — | Never relaxed. It is listed on the plan as "kept". |
| **Enforcement** | — | **Screened**: a company whose industry or business-model evidence names it is rejected. The plan is never blocked, because no tool can prove a company is *outside* an industry. If there's no industry evidence at all, the company is `unknown` (needs verification), never passed. |

## Normalization and matching (`supabase/functions/_shared/exclusionPhrase.ts`, `EXCLUSION_MATCH_VERSION = "phrase-v1"`)

- Case-insensitive; words split on non-alphanumerics; `&` reads as `and`; plurals become singular (`agencies` → `agency`).
- **Whole words, in order, adjacent.** "oil" does not match "toilet"; "ai" does not match "retail"; "real estate" does not match "estate planning".
- An exclusion also matches on its **core**, with generic head nouns (agency, company, firm, business, service, provider…) dropped: "staffing agencies" matches "Staffing and Recruiting".
- Known limit: "crypto" does **not** match the single word "cryptocurrency". Whole-word matching was required. Brain may approve both spellings as separate memories if a workspace wants both.

## Approvals and memory changes (G4, ATLAS, commit `43359431`)

A plan signs `workspaceRulesFingerprint(contractInput)`, a hash of the **effective** workspace rules: ICP fill-ins, the size rule, profile exclusions, and servable approved-memory exclusions (value plus `memory_id`). A run recomputes it from the Brain *now*, through `loadBrainPlanningContext`. Any difference refuses the run (`409`, `stage: "approval"`, `code: "brain_changed"`) with nothing bought, and the user re-plans.

- A pending, expired, retracted or cross-workspace memory acts on nothing, so it changes nothing.
- A memory that is approved, retracted, or has its value or id changed invalidates earlier approvals.
- What Brain needs to do: nothing beyond the field. The fingerprint is read through the same loader as planning, so plan and run see the same memories.

## Compatibility

- **Additive.** The field is optional; absent or empty, every contract hashes exactly as before (tested). `Origin.memoryIds` is present only when memory contributed.
- `applyCompanyBrain(contract, brain, { workspaceId, now })`. The third argument is optional, so existing callers (`chatIntegration.ts`) are unchanged.
- **Legacy path** (contract mode off): the same resolver (`resolveWorkspaceExclusions`) applies profile and memory exclusions as required criteria, signed into the approval replay (`replay.brain.exclusions`).

## Requested change on the Company Brain side (not made by ATLAS)

1. `leadPipeline/brainContext.ts` (Brain-owned; G1 `cc21d393` / `ab60be23` on `claude/brain-v2-integration`): `withMemoryExclusions` should set `contractInput.excluded_industries_memory` from the exclusion items, one per item with its `memory_id`, instead of appending values to `excluded_industries_explicit`. Today's G1 loses the provenance.
2. `brainMemoryModel.ts` `matchExclusion` uses substring `includes` (oil → toilet). ATLAS doesn't call it for discovery. If Brain uses it elsewhere, `exclusionMatches` from `exclusionPhrase.ts` is the shared replacement.
3. Merge order: ATLAS's branch first (it defines the field), then Brain's loader change. Until Brain sends the field, ATLAS behaves exactly as today for memory.
