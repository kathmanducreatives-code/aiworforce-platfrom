
# Company Brain Contamination Audit — Agentory (READ-ONLY)

No writes, refreshes, generations, or model calls were performed. All findings come from SELECT queries against the connected production database and static reads of the deployed source.

---

## 1. Environment

| Item | Value |
|---|---|
| Lovable project ID | `a1a1da21-639c-4595-b640-24b81598d408` |
| Published frontend | `agentory.space` |
| Connected Supabase project ref | **`wqnigjhcwjxtmordrwno`** |
| Correct production project? | **YES** (matches expected; not TEST `zbwsbnqqpkvdhqwavjke`) |

## 2. Workspace resolution

| Item | Value |
|---|---|
| Workspace ID | `e510c1a6-…6ed995` (owner "prasidha's Workspace", created 2026-05-27) |
| Owner user ID | `63365602-…4c43b` |
| `company_brain` rows for workspace | **1** (canonical, no duplicates) |
| `onboarding_completed` | true (2026-07-12 14:41:57 UTC) |
| Brain `updated_at` | 2026-07-20 15:58:17 UTC |

## 3. Seller identity — flat vs nested (verified contamination)

| JSON path | Value | Contains "Goji" | Currently read by generator |
|---|---|---|---|
| `profile.company_name` (flat) | **`"goji"`** | ✅ | ✅ **WINS** |
| `profile.company.name` (nested) | `"Agentory"` | ❌ | fallback only |
| `profile.website_url` (flat) | **`"https://app.gojiberry.ai/home"`** | ✅ | ✅ |
| `profile.company.website_url` (nested) | `"https://agentory.space"` | ❌ | fallback only |
| `profile.linkedin_company_url` (flat) | **`"…/company/gojiberryai"`** | ✅ | ✅ |
| `profile.company.linkedin_url` (nested) | **`"…/company/gojiberryai"`** | ✅ | — nested also contaminated |
| `profile.company.category` | `"AI workforce platform"` | ❌ | — |
| `profile.company_summary` / `profile.short_description` | **`"Goji is an AI-powered platform … data analysis and business intelligence…"`** | ✅ | ✅ |
| `profile.positioning.promise` | `"Agentory helps founders…"` | ❌ | ✅ |
| `profile.positioning.offer` | **`"An AI workforce platform … talent discovery, candidate intelligence, and outreach."`** | ❌ Goji, ✅ recruiting | ✅ |
| `profile.positioning.use_cases` | `["Automate passive talent discovery","Deliver verified candidate intelligence","Screen candidates","Source talent",…]` | ✅ recruiting | ✅ |
| `profile.positioning.avoid_positioning` | includes `"Tool for enterprise-level recruiting"` | prohibited | — |
| `profile.content_angles` | `"The future of recruiting: AI-powered talent discovery and outreach."`, `"Agentory vs. traditional CRMs for recruiting agencies."` | ✅ recruiting | ✅ |
| `profile.brand_voice.example_message` | `"…AI workforce. Automate passive talent discovery and outreach…"` | ✅ recruiting | ✅ |
| `profile.icp.pain_points` | includes `"Time spent on manual candidate screening and sourcing"`, `"Automating passive talent discovery"`, `"Delivering verified candidate intelligence"` | ✅ recruiting | ✅ |
| `profile.icp.disqualifiers` | includes `"staffing and recruiting"` (correct) | — | ✅ |
| `profile.what_we_do`, `preferred_cta`, `approved_ctas`, `banned_claims`, `domain*` | null | — | — |

**Both `company_name = "goji"` and `company.name = "Agentory"` coexist.** The Company Brain editor writes nested `company.name` (visible in UI as "Agentory"), while the legacy flat `company_name` was never cleared and still says "goji". No per-field timestamp/provenance is stored, so newer-value comparison is unavailable.

## 4. Recursive contamination scan

Case-insensitive matches inside `profile` JSON:

- **goji** → `company_name` ("goji"), `website_url` ("app.gojiberry.ai"), `linkedin_company_url`, `company.linkedin_url`, `company_summary`, `short_description` (all approved slots; all currently read by generator)
- **talent / candidate / recruiting / sourcing / passive talent discovery / candidate intelligence** → present in APPROVED slots: `positioning.offer`, `positioning.use_cases`, `content_angles`, `brand_voice.example_message`, `icp.pain_points`, plus a nested `legacy.icp.buyer_roles` including `"Recruiting"`. Same terms also (correctly) appear in `positioning.avoid_positioning` and `icp.disqualifiers` — **direct contradiction between approved and prohibited buckets**.
- **relationship management** → not present in Brain (but present in the generated opener, see §8).

## 5. Research / source records (`company_brain_research_runs`)

15 runs on file, all `status=completed`. Timeline of `source_url`:

| created_at (UTC) | source_type | source_url |
|---|---|---|
| 2026-07-10 08:59 | company_website | **https://agentory.space** |
| 2026-07-10 15:49 | founder_linkedin | prasidha-sarawagi |
| 2026-07-10 15:50 | founder_linkedin | **rajroy** (unexpected second founder) |
| 2026-07-10 15:51 | company_website | **https://gojiberry.ai/** ← Goji ingested as seller website |
| 2026-07-10 15:52 | ai_draft | — |
| 2026-07-11 06:00–06:03 | linkedin + website `https://agentory.space` + ai_draft | — |
| 2026-07-12 08:08–08:10 | linkedin + website `https://agentory.space` + ai_draft | — |
| 2026-07-12 14:39–14:41 | linkedin + website `https://agentory.space` + ai_draft (last) | — |

The schema has no `treated_as_seller_website` / `treated_as_competitor` flag — **the system never structurally distinguished seller website from competitor/reference website**. The Goji URL was ingested through the same `company_website` refresh path that ingests `agentory.space`, so its extracted fields were merged into seller identity slots.

## 6. Legacy Company Brain storage

`workspaces` table has **no `company_brain` column** (verified via `\d workspaces`). Hypothesis 5 does not apply — no legacy `workspaces.company_brain` blob exists to conflict with `company_brain.profile`.

## 7. Manual-edit vs refresh timeline

Field-level history is not stored (provenance gap). Row-level timestamps:

- Onboarding completed: **2026-07-12 14:41:57**
- Last research run: **2026-07-12 14:41:38** (`ai_draft`)
- Last Brain `updated_at`: **2026-07-20 15:58:17** → a manual edit occurred **after** the last automated refresh. That edit fixed the nested `company.name` to "Agentory" and set the nested website to `agentory.space`, but **did not clear the flat legacy keys** (`company_name`, `website_url`, `linkedin_company_url`, `company_summary`, `short_description`) nor the recruiting-flavored `positioning.*`, `content_angles`, `icp.pain_points`.
- Latest Goji-mentioning generation: **2026-07-21 09:22:47** (see §8), **after** the manual correction — the generator still read the stale flat fields.

## 8. Latest Goji generation

Most recent Goji-mentioning artifact is a `tasks` row (agent_slug `penn`), workspace matches:

| Field | Value |
|---|---|
| Task ID | `44ce104d-…3398` |
| Workspace | `e510c1a6-…6ed995` ✅ same |
| Agent | `penn` |
| Status | `awaiting_approval` (not sent) |
| Updated | 2026-07-21 09:22:47 UTC |
| Opener excerpt | *"…Goji offers an AI workforce platform with specialized agents that share a 'company brain' to automate intelligence gathering and relationship management…"* |
| `sent` per-lead flag | **false** (0 drafts approved, 0 sent) |
| Prior task `2b0f5808-…` (2026-07-21 07:43) | opener does not name Goji but uses generic "our AI agents" |

Per-field provenance (brain_id, generator contract version, model, function revision) is **not persisted on `tasks.output`** in this workspace — provenance gap. No matching row in `outreach_drafts` (latest there is 2026-06-11), and no matching row in `saved_outputs`/`agent_runs` — the Goji output lives only in `tasks.output`.

**Source of "Goji" — proven in code:** `supabase/functions/_shared/workbench/sellerContext.ts:149`

```ts
const seller_company_name = firstStr(p.company_name, namedOnly(p.company).name);
```

`firstStr` returns the first non-empty argument. With `profile.company_name = "goji"` present, the nested `company.name = "Agentory"` is never consulted. This is a **legacy-flat-before-nested** bug, exactly hypothesis 2/B. Not model-invented, not a stale snapshot, not cross-workspace.

## 9. Deployed revision

Lovable does not expose a per-Edge-Function Git SHA that we can read from the database. **Exact run-agent Git SHA cannot be independently verified from this read-only session.** The last recorded deploy in this conversation was `run-agent` from source SHA `fa54399d…` (PR #79). PR #81 status = **unknown** from a read-only vantage point; the presence of the flat-before-nested bug on 2026-07-21 09:22 confirms the fix (if any) is not yet effective in production.

## 10. Cross-workspace leakage checks

| Check | Result |
|---|---|
| Company Brain queried by active workspace only | PASS — hook filters by `workspace_id` and RLS is `has_workspace_access` |
| Latest Goji generation's workspace matches Brain workspace | PASS — both `e510c1a6-…6ed995` |
| Seller claims came from same workspace | PASS — sourced from the same `company_brain.profile` |
| Global default Brain used | PASS (none exists) |
| Another workspace's Brain read | PASS (no evidence) |

## 11. Root-cause classification

Primary:
- **B. Flat `company_name` overrode nested `company.name`.** Proven in code (`sellerContext.ts:149`) and in data (`company_name="goji"` while `company.name="Agentory"`).
- **A. Competitor URL was ingested as seller website.** `research_runs` shows `source_type="company_website"` with `source_url="https://gojiberry.ai/"` on 2026-07-10 15:51 — the refresh path treats any supplied website as the seller's and merged its extracted description/LinkedIn into flat seller slots. No competitor/reference distinction exists in the schema.

Contributing:
- **D. Automated refresh overwrote manual edits.** The subsequent user correction updated nested `company.*` but did not overwrite the flat legacy fields the generator still prefers; the recruiting-flavored `positioning.*`, `content_angles`, `icp.pain_points`, and `brand_voice.example_message` also survived.

Not applicable / not evidenced:
- C (no `workspaces.company_brain`), E (no snapshot reuse), F (correct project), G (no cross-workspace), H (Goji is in data, not invented), I (deploy staleness cannot be proven, but B alone explains the output).

## 12. Final report (numbered)

1. Production project ref: `wqnigjhcwjxtmordrwno`
2. Correct production project confirmed: **yes**
3. User/workspace: `63365602-…4c43b` → workspace `e510c1a6-…6ed995` ("prasidha's Workspace"), membership present
4. `company_brain` rows: **1**
5. Nested seller name: `Agentory`
6. Flat seller name: **`goji`**
7. Authoritative seller name under current code: **`goji`** (flat wins in `sellerContext.ts`)
8. Nested seller website: `https://agentory.space`
9. Flat seller website: **`https://app.gojiberry.ai/home`**
10. Goji JSON paths: `company_name`, `website_url`, `linkedin_company_url`, `company.linkedin_url`, `company_summary`, `short_description`
11. Goji research/source records: `company_brain_research_runs.id = 01260f8b-…8757` (source_url `https://gojiberry.ai/`, 2026-07-10 15:51); founder run `30bf0931-…7734` for `linkedin.com/in/rajroy` (unexpected non-Agentory founder)
12. Recruiting/talent approved paths: `positioning.offer`, `positioning.use_cases`, `content_angles`, `brand_voice.example_message`, `icp.pain_points`, `legacy.icp.buyer_roles`
13. Recruiting/talent prohibited paths: `positioning.avoid_positioning`, `icp.disqualifiers`
14. Approved/prohibited contradictions: **yes** — same recruiting vocabulary present in both
15. Legacy `workspaces.company_brain`: **not present** (column does not exist)
16. Manual edit timestamp: **2026-07-20 15:58:17 UTC** (Brain `updated_at`)
17. Automated refresh timestamp: **2026-07-12 14:41:38 UTC** (last `ai_draft` research run)
18. Refresh followed manual correction: **no** — manual edit is newer than last refresh, yet flat legacy fields remain stale
19. Latest generation timestamp: **2026-07-21 09:22:47 UTC** (task `44ce104d-…3398`)
20. Seller name used by latest generation: **`Goji`**
21. Seller identity source: **`profile.company_name`** (flat legacy field), via `sellerContext.ts:149`
22. Company Brain row/version used: the single canonical row for workspace `e510c1a6-…6ed995` (no versioning)
23. Deployed run-agent revision: **cannot be independently verified from read-only session** (last recorded deploy in project history: SHA `fa54399d…`)
24. PR #81 deployed: **unknown** (behavioural evidence suggests fix, if any, is not effective — flat-before-nested still occurring on 2026-07-21)
25. Cross-workspace leakage evidence: **no**
26. Primary root cause: **B — Flat `company_name` overrode nested `company.name`** (compounded by A — competitor URL ingested as seller website)
27. Contributing root causes: A, D
28. Code cleanup required: **yes** — invert precedence in `sellerContext.ts` (nested first, flat as legacy fallback), and add a competitor/reference distinction to the research/refresh ingestion path
29. Production-data cleanup required: **yes** — clear or overwrite `profile.company_name`, `profile.website_url`, `profile.linkedin_company_url`, `profile.company.linkedin_url`, `profile.company_summary`, `profile.short_description`; scrub recruiting vocabulary from `positioning.offer/use_cases`, `content_angles`, `brand_voice.example_message`, `icp.pain_points`
30. Migration likely required: **no schema migration** for the immediate fix; the data cleanup is a JSONB update. A future migration to add per-field provenance and a competitor-vs-seller flag on `company_brain_research_runs` is recommended
31. Safe immediate next step: **quarantine, don't regenerate.** Do a targeted data patch on the single `company_brain` row for workspace `e510c1a6-…6ed995`, clearing the six Goji-tainted flat fields and rewriting the four recruiting-flavored approved slots. Then approve one controlled Harmonic regeneration to verify the seller identity is now "Agentory"
32. Remaining unknowns: exact deployed run-agent Git SHA; whether the `rajroy` founder_linkedin research run represents another user or a paste error; per-field write history (no provenance stored)

Stop after report. Production writes = 0. Refreshes = 0. Generations = 0. Model calls = 0. Outreach sent = 0.
