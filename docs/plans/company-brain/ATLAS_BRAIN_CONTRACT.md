# ATLAS ⇄ Company Brain: interface contract `atlas-brain-v1`

This contract is for the ATLAS (lead) track. Company Brain V1 **did not change** how ATLAS reads the Brain today: `intelligence/missionContext.ts` still calls `getCompiledCompanyBrainForWorkspace`, and that function is byte-for-byte unchanged.

## Opting in

Make this one change at the single call site in `missionContext.ts`:

```ts
- const res = await getCompiledCompanyBrainForWorkspace(db, workspaceId, opts);
+ const res = await getCompiledCompanyBrainWithMemory(db, workspaceId, opts); // _shared/atlasBrainContract.ts
```

The opt-in call returns two things:

- `brain`: the same `CanonicalCompanyBrain` shape, built from the effective profile (the profile with approved memory folded in).
- `contract`: an `AtlasBrainContract` with these fields:

| Field | Meaning |
|---|---|
| `contract_version` | Always `"atlas-brain-v1"`. Fields are only ever added, never removed. |
| `industries`, `company_size`, `geography` | The current ICP. A newer preference wins over an older profile edit, and the reverse is also true. |
| `exclusions.{industries,companies,geographies,keywords}` | Explicit exclusions a person set. These are also merged into `brain.disqualifiers`. |
| `rejected_lead_refs`, `rejected_account_refs` | Records a person rejected. **Skip those records only.** They are not industry or company rules. |
| `icp_changed_at` | When the ICP last changed (ISO timestamp), so long-running missions can tell their criteria are out of date. |
| `fingerprint` | Changes whenever the profile or memory changes. |

## What stays the same

**Compatibility promise:** for a workspace with no memory, `brain` is deep-equal to what ATLAS receives today. This is pinned by `tests/edge-functions/_shared/companyBrainMemoryIntegration.test.ts` across a V2 profile, a legacy profile and an empty one.

Memory never relaxes a qualification, budget, dedupe or approval rule, because none of those rules live in the Brain.

## A pre-existing compiler behaviour the ATLAS track should know about

This is not caused by V1. `companyBrainCompiler.ts:313` applies `DEFAULT_DISQUALIFIERS` whenever the Brain states no disqualifiers of its own. That list includes `manufacturing` and `logistics`.

The consequences:

- A Brain whose ICP *is* Manufacturing or Logistics gets those industries disqualified by default.
- Adding any explicit exclusion turns the defaults off, because the compiler's rule is that the Brain wins.

The compiler is shared with ATLAS, so V1 does not change this.
