# Company Brain — architecture

The Company Brain is the **root source of truth** for everything that decides
*who we target, what we say, and what we refuse to touch*: Leads/Workbench,
Scout Radar/Signals, Content/Scribe, the agents, Outreach, workflows,
qualification and scoring, and every provider query.

If a feature invents its own ICP, it will drift from this one — and drift here
means targeting the wrong companies.

---

## 1. Where it is stored

One row per workspace:

```
public.company_brain
  workspace_id            uuid  primary key → workspaces(id)
  profile                 jsonb   ← the entire Brain lives here
  onboarding_completed    boolean
  onboarding_completed_at timestamptz
  created_at, updated_at
```

> ⚠️ **`profile` is the only place Brain data lives.** There is no
> `signal_preferences` column, no `icp` column. Radar reads
> `profile.signal_preferences`. Writing any of these as a table column makes the
> upsert fail at runtime.

Research provenance (which provider read which URL, and what it returned) lives
in `public.company_brain_research_runs` — workspace-scoped, RLS-gated, written
only by edge functions via `service_role`.

The chain: `auth.users → profiles → workspaces → workspace_members →
company_brain → signals / leads / content / agents / outreach`.

---

## 2. How it is normalized

`normalizeCompanyBrain(profile)` → `CompanyBrainV2`.

Pure and deterministic. It accepts **any** historical shape and returns one safe
object. Crucially it **never invents targeting**: empty in → empty out.

- v2 fields win; legacy `icp.*` is projected into `target_customer.*` only when
  the v2 slot is empty.
- Corrupted values coerce safely (a `positioning` that is a bare string becomes
  `{ promise: "<string>" }`).
- Derived flags (`setup_status`, `brain_confidence`, `setup_required`) are always
  **recomputed**, never trusted from the stored blob.

There are two hand-mirrored copies — keep them in sync:

- `supabase/functions/_shared/normalizeCompanyBrain.ts` (edge, authoritative)
- `src/lib/normalizeCompanyBrain.ts` (frontend preview)

### v2 → legacy compatibility projection

Onboarding v3 writes `target_customer` / `buyer_personas` /
`qualification_rules`. Several long-lived readers still expect legacy
`profile.icp.*`. `projectV2ToLegacyIcp()` bridges them:

| v2 (source of truth) | legacy `icp.*` |
|---|---|
| `target_customer.industries` | `icp.industries` |
| `buyer_personas` | `icp.buyer_roles` |
| `target_customer.disqualifiers.*` (all buckets, flattened) | `icp.disqualifiers` |
| `target_customer.company_size.label` | `icp.company_size` |
| `target_customer.geography[0]` | `icp.geography` |
| `pain_points` | `icp.pain_points` |

`applyBrainSave()` persists this projection alongside the v2 truth, so a v3 Brain
is visible to legacy readers **without editing them**.

> This is a **compatibility bridge, not a second source of truth.** v2 always
> wins. Delete the bridge once every reader uses the access layer.

---

## 3. How it is compiled

`compileCompanyBrainContext({ workspace_id, profile, signal_preferences })`
→ `CompanyBrainContext`.

Normalization gives you *what the user said*. Compilation gives you *what to
search for*: query terms, category expansions, negative terms, buyer titles,
disqualifier sets, and an evidence trail (`meta.matched_from` records which Brain
field produced each derived term).

It expands SaaS/revenue vocabulary **only when the Brain actually shows that
context**, and it folds `SOFTWARE_ICP_DISQUALIFIERS` into the disqualifier set
when the ICP is software — so a lab / analytical-services / pharma / chemicals /
packaging / staffing account hard-rejects even when its job title matches.

---

## 4. The one-access-layer rule

```ts
import { getCompiledCompanyBrainForWorkspace } from "../_shared/getCompiledCompanyBrainForWorkspace.ts";

const { ok, brain, error } = await getCompiledCompanyBrainForWorkspace(admin, workspace_id, { userId });
if (!ok) return json({ error }, error === "forbidden" ? 403 : 404);
if (brain.setup_required) { /* degrade — do not fabricate an ICP */ }
```

It performs, in order: **membership check → load `profile` → normalize →
compile → one canonical object.**

A workspace with no Brain row is **not** an error. It returns a conservative,
empty Brain with `setup_required = true` so callers degrade instead of crashing.

### Rules

1. **Do not read `company_brain.profile` directly** in a feature. Go through the
   access layer. (Unavoidable exceptions: the onboarding writer itself, and
   `run-agent` until it is migrated — see *Known debt*.)
2. **Do not re-derive ICP, targeting or disqualifiers** anywhere else.
3. **Do not add another `DEFAULT_DISQUALIFIERS` list.** See below.

---

## 5. What each feature consumes

| Feature | Fields |
|---|---|
| Leads / Workbench | `target_customer`, `buyer_personas`, `disqualifiers`, `qualification_rules`, `legacy_icp` |
| Scout Radar / Signals | `query_strategy`, `triggers`, `jobs_to_watch`, `disqualifiers`, `setup_required` |
| Content / Scribe | `content_angles`, `positioning`, `brand_voice`, `pain_points`, `positive_examples` |
| Agents (Pilot, Scout, Aria, Hawk, Scribe) | `company_summary`, `target_customer`, `buyer_personas`, `disqualifiers`, `setup_required` |
| Outreach | `buyer_personas`, `pain_points`, `positioning`, `brand_voice`, `disqualifiers`, `negative_examples` |
| Workflows / next actions | `setup_required`, `brain_confidence`, `missing_fields` |
| Provider queries | `query_strategy`, `disqualifiers` |

The agent roster is **Pilot, Scout, Aria, Hawk, Scribe** (`agentorySystemPrompt.ts`).
Never name an agent that does not exist in code.

---

## 6. `setup_required`

`setup_required = true` means the Brain has no workable ICP — there is no
(industries **and** buyer personas) pair and no `must_have`.

When it is true, every feature must **degrade honestly**:

- Radar emits **no verified Top Signals** and runs low-cap queries.
- Provider query builders return **no broad queries** (`buildApifyJobsInput`
  returns an empty set rather than fanning out blind).
- Agents/content say what is missing instead of guessing.
- Outreach drafts low-confidence only, and never claims a strong fit.

`brain_confidence` (`weak | partial | strong`) and `missing_fields` tell the UI
*what* to ask for. Activation is refused until every required slot is filled — a
half-built Brain can be saved as a draft but never marked complete.

---

## 7. Disqualifiers

Three buckets, all enforced before anything reaches the user:

1. **Brain-supplied** — `target_customer.disqualifiers.{industries, company_types, keywords, titles, domains}`.
2. **`DEFAULT_DISQUALIFIERS`** — safe high-risk defaults, applied **only** when
   the Brain supplies none.
3. **`SOFTWARE_ICP_DISQUALIFIERS`** — merged **on top** whenever the ICP is
   software/SaaS. Lab testing, analytical services, pharma, chemicals,
   packaging, staffing/recruiting. These hard-reject regardless of job title.

Both constants live in **`companyBrainIcp.ts`** and nowhere else.

> ⚠️ **Do not add a duplicate `DEFAULT_DISQUALIFIERS` list.** This has already
> gone wrong three times (`companyBrainIcp.ts`, `leadQualityGate.ts`,
> `leadSearchIntent.ts`), and the copies diverged: the `leadQualityGate` list is
> missing pharma, chemicals, packaging and lab/analytical, so a
> Pace-Analytical-class account could pass the Workbench gate. Collapsing these
> into the one constant is tracked debt.

A disqualifier hit is a **hard reject** (`verification_status: "rejected"`,
`signal_score: 0`) — never a score penalty.

---

## 8. Qualification rules

`qualification_rules` encodes *what proof a lead needs before we trust it*:

- `required_evidence` — must be present to accept (e.g. `job_url`).
- `reject_if` — hard reject.
- `manual_review_if` — accept, but flag for a human.

Related invariants enforced by the scorer:

- A **buyer/title match alone can never be verified.** Real ICP fit (a matched
  industry/category, or an in-band company size) is required. "Director of
  Commercial Analytics" at a lab is not a Top Signal for a B2B-SaaS ICP.
- No source URL or no evidence text ⇒ capped score and `needs_verification`.
- Funding needs an amount, round, or investor evidence.

---

## 9. Known debt

- `run-agent/index.ts` still reads raw `brain.icp.*`. The compatibility
  projection keeps it correct; migrate it to the access layer when the
  `lead-quality-trace-fixes` branch is rebased.
- Three `DEFAULT_DISQUALIFIERS` lists (see §7). Collapse to one.
- `leadQualityGate.ts` / `leadSearchIntent.ts` / `leadMatchTier.ts` still hold
  their own targeting logic.
- Outreach performs **no** disqualifier check before drafting.
- Workflows ignore `setup_required` / `brain_confidence` / `missing_fields`.
- There is no Content/Scribe backend; `content_angles` is currently unread.
- `normalizeCompanyBrain.ts` is duplicated (edge + frontend).
