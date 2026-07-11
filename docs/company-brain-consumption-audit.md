# Company Brain consumption audit

**Question answered:** *When I run Find Leads, Signals/Scout Radar, Content, Agents, and Outreach, are those systems actually using the active Company Brain saved for the current workspace?*

**Method:** static code-path trace of every consumer + deterministic tests
(`supabase/functions/_shared/companyBrainConsumption.test.ts`). No providers,
no live runs. Branch: `company-brain-consumption-workflow-audit`.

## Source of truth & data lineage

- **Storage:** one `company_brain` row per workspace; the ICP lives in the
  `profile` JSONB. There is **no separate "active" vs "draft" row** — "active" =
  `company_brain.onboarding_completed = true` (set by `activate`). Saved edits
  are therefore reflected **immediately** to every consumer (single row).
- **Canonical loader:** `_shared/getCompiledCompanyBrainForWorkspace.ts` —
  membership check → load `profile` → `normalizeCompanyBrain` →
  `compileCompanyBrainContext` → one `CanonicalCompanyBrain`. Empty brain →
  `setup_required = true` (never fabricates an ICP). **⚠ This canonical loader
  currently has ZERO callers** (see GAP C).
- **What consumers actually use today:** `compileCompanyBrainContext`
  (radar), `buildCompanyBrainContext` (agent prompt block), `companyIcpFilter`
  + `companyBrainIcp` (lead filtering), `icpSignalScorer` (radar scoring),
  `ariaScoring` (ranking). On `activate`, v2 is projected to legacy `profile.icp`
  (`mergeLegacyIcpProjection`) — the agent prompt block reads that projection for
  the ICP/industries/buyer-roles line.

```
Authenticated user (JWT)
  → active workspace (frontend WorkspaceContext)
  → edge function validates JWT + workspace_members membership   [orchestrate, run-radar-scan, pilot-chat ✓ | run-agent direct path — FIXED here]
  → company_brain.profile (by workspace_id)
  → normalize + compile (+ legacy icp projection)
  → downstream: query build / filter / score / prompt block / content plan
```

## Consumption matrix

| Surface | Entry point | Brain loader | Fields used | Active/draft | Workspace scoped | Missing-field behavior | Status |
|---|---|---|---|---|---|---|---|
| Find Leads (search) | frontend → `orchestrate` → `scout` step → `run-agent` | `orchestrate` loads `company_brain.profile`; `run-agent` re-loads it; `companyIcpFilter` + `companyBrainIcp` | industries, business_models, company_size, geography, disqualifiers, keywords-to-avoid, buyer roles | latest saved (single row) | **YES** — orchestrate does JWT+membership | ICP filter no-ops on empty fields; `setup_required` line injected | **WIRED** |
| Lead qualification / gate | `run-agent` → `leadQualityGate` + `companyIcpFilter` | same load | disqualifiers, negative industries, excluded types, required evidence | latest saved | YES (via orchestrate) | disqualifier match → reject; empty → pass-through | **WIRED** |
| Lead ranking | `run-agent`/`orchestrate` → `ariaScoring` (`companyIcpFilter`) | same load | industries, size, geography, buyer_roles, disqualifiers, funding_stage | latest saved | YES | disqualified always loses; thin brain → low confidence | **WIRED** |
| Scout Radar / Signals | frontend → `run-radar-scan` | `compileCompanyBrainContext` + `profile.signal_preferences` | icp, triggers (hiring/funding/tech/competitor), query_strategy, disqualifiers, qualification_rules | latest saved | **YES** — JWT + `workspace_members` check in-function | empty → fewer queries; compiler `setup_required` | **WIRED** |
| Signals verification | `run-radar-scan` → `radarCandidatePipeline` → `icpSignalScorer` | compiled brain | proof/evidence gate, ICP fit, trigger match, disqualifiers, buyer relevance | latest saved | YES | no proof → not verified; disqualifier → rejected; **title alone ≠ verified** | **WIRED** |
| Content (founder posts/ideas) | frontend → `orchestrate` (`content_engagement_loop`) → `scribe` in `run-agent` | `buildContentLoopPlan(profile)` + agent brain block | positioning promise, content_angles, pain_points, brand voice, avoid-phrases, audience/angle/tone | latest saved | YES (via orchestrate) | brain block emits `setup_required`; nothing auto-posts | **WIRED — after Fix A** |
| Agents (scout, aria, penn, hawk, scribe) | `run-agent` prompt assembly | `renderBrainForAgent` → `buildCompanyBrainContext` | full block: ICP, disqualifiers, pains, triggers, angles, positioning, voice + avoid, approval rules | active only (`onboarding_completed`) | YES (via orchestrate; direct path FIXED) | block emits explicit "setup needed" line | **WAS BROKEN → FIXED (Fix A)** |
| Outreach prep (penn) | `run-agent` `penn` step / `generate_outreach` lead action | agent brain block + `executeLeadAction` | buyer personas, pains, trigger, proof, positioning, voice, banned claims, approval rules | active | YES (direct path FIXED) | approval-first (`draft-only`, email/DM require approval); **never auto-sends** | **WIRED — after Fix A/B** |

## Gaps found

### GAP A — Agent prompt brain injection was DEAD (HIGH, correctness) — FIXED
`run-agent`'s `renderBrainForAgent(brain)` called `hasUsableBrain(brain, null)`.
`hasUsableBrain` returns false unless `onboardingCompleted === true`, so with a
hardcoded `null` it **always** emitted *"no company brain yet"* to every agent
(Scout/Aria/Penn/Hawk/Scribe). Lead **filtering** still used the brain, but the
agents' **reasoning/generation** (Scout query phrasing, Scribe content, Penn
outreach copy) was brain-blind.
- **Risk:** content/outreach ignored positioning, voice, banned claims, angles;
  agents could produce generic or off-brand copy despite an active brain.
- **Fix:** `run-agent` now selects `onboarding_completed` and passes it through;
  the block is rendered by a new shared, tested `renderCompanyBrainBlock(profile,
  onboardingCompleted)` in `companyBrainContext.ts`.
- **Files:** `run-agent/index.ts`, `_shared/companyBrainContext.ts`.

### GAP B — run-agent direct path had no membership check (HIGH, isolation) — FIXED
The frontend calls `run-agent` directly for Workbench lead actions
(`src/lib/leadActions.ts`). `run-agent` used the service-role key and trusted
`body.workspace_id` / `body.user_id` with **no JWT/membership check**, so a
crafted request could act on another workspace's brain/leads.
- **Risk:** cross-workspace consumption of another tenant's ICP/leads.
- **Fix:** a fail-closed guard (`_shared/workspaceAccessGuard.ts` decision +
  wiring). Service-role bearer (orchestrate) stays trusted; a user JWT must be a
  `workspace_members` member of the target workspace, else 401/403.
- **Files:** `run-agent/index.ts`, `_shared/workspaceAccessGuard.ts`.

### GAP C — Canonical shared loader is unused (MEDIUM, architecture) — DOCUMENTED
`getCompiledCompanyBrainForWorkspace` (the documented "single access layer")
has **zero callers**; each surface loads/derives the brain via older modules
(`compileCompanyBrainContext`, `buildCompanyBrainContext`, `companyIcpFilter`,
`companyBrainIcp`, `icpSignalScorer`). They are individually workspace-scoped
and correct, but there are ~4 parallel read paths.
- **Risk:** drift — a future field added to the canonical layer won't reach
  consumers; harder to reason about "the" brain.
- **Recommendation (not done here — too broad for a focused fix):** converge
  radar/leads/content onto `getCompiledCompanyBrainForWorkspace` incrementally,
  keeping the compiled sub-objects for backward compat.

### Minor notes (not gaps)
- The agent prompt block's ICP/industries/buyer-roles line reads the **legacy
  `profile.icp` projection** (written by `activate`), not v2 `target_customer`
  directly. Activated brains have it; a pure-v2 profile without the projection
  would show pains/angles/voice but no ICP line. Voice/angles/pains/positioning
  are read from v2 top-level fields directly.
- The compiler **unions** legacy `profile.icp.industries` into targeting for
  backward compat — v2 is never overridden, but generic legacy terms can be
  added. Verified by `consume-6`.
- The compiler applies **SaaS buyer-title expansions** when the brain shows SaaS
  context (including when it merely *targets* SaaS companies), so generic titles
  like "Head of Growth" can appear even for a recruitment agency. Deterministic
  per-brain; not a cross-workspace leak.

## Missing-field behavior (Phase 8)

- Empty/absent brain → canonical `setup_required = true`, empty targeting,
  **no fabricated ICP** (`consume-5`).
- Agent prompt block injects an explicit *"Setup needed: Company Brain ICP
  incomplete — ask for target customer + buyer roles before targeting; draft
  low-confidence only, never claim a strong fit."* line when industries+buyers
  and must-have are all absent (`companyBrainContext.ts`).
- `companyIcpFilter` no-ops each constraint that is empty (does not broaden to a
  generic SaaS search on its own).

## Workspace isolation results (proved by tests)

- `run-radar-scan`, `orchestrate`, `pilot-chat`: JWT + `workspace_members` check
  before loading the brain. ✓
- `run-agent` direct path: **now** membership-checked (Fix B). ✓
- Canonical loader: rejects non-members / missing user (`consume-1`, `consume-3`).
- Two workspaces (A: B2B SaaS founders; B: recruitment agency) compile to
  different ICPs; distinctive tokens do not cross (`consume-4`).

## Verdicts

| Surface | Verdict |
|---|---|
| Find Leads | **YES** (main path; direct Workbench path isolation FIXED) |
| Lead qualification | **YES** |
| Lead ranking | **YES** |
| Scout Radar | **YES** |
| Signals verification | **YES** |
| Content | **PARTIAL → YES after Fix A** (was brain-blind in agent prompt) |
| Agents | **NO → YES after Fix A** (prompt block was dead) |
| Outreach preparation | **PARTIAL → YES after Fix A/B**; approval-first, never auto-sends |

## Providers / deploy

No providers were called. Edge functions changed (`run-agent`) require a
**redeploy** to take effect. No migrations, no schema change.
