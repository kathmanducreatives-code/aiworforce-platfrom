# Company Brain Foundation v2 — Implementation Plan

Safe, staged rollout of a personalized, multi-tenant Company Brain / ICP. No production migrations, no providers, no deploys, no outreach. Frontend + edge-function code + a local migration file (not applied) only.

## Stage 0 — Audit (read-only, done in-plan)

Verify current provisioning end-to-end before touching code:

- `handle_new_user_workspace` trigger on `auth.users` → calls `provision_workspace_for_user`
- `provision_workspace_for_user` creates: `workspaces` row, `workspace_members` row (owner), `company_brain` row (`profile = '{}'::jsonb`, on-conflict skip)
- `profiles` row is created separately by `handle_new_user` trigger
- RLS: `has_workspace_access(user, workspace_id)` gates `company_brain`
- Onboarding writes via `useCompanyBrain` → `company_brain.profile` merged through `mergeProfile`

Gaps to confirm and fix in Stage 1:
- New `company_brain` row is `{}` — has no `schema_version`, no `setup_status`, no `brain_confidence`
- Existing rows may have `positioning`/`brand_voice` stored as raw strings
- Onboarding can be skipped (`onboarding_completed` stays false but users still use product)
- No structured `disqualifiers` buckets, no `target_customer`, no `positive/negative_examples`
- `deriveCompanyIcp` (Leads/Content) is not unified with `compileCompanyBrainContext` (Radar)

## Stage 1 — Schema v2 (additive, backward compatible)

**No table changes.** Keep `company_brain.profile jsonb`. Version the shape inside it.

New canonical shape (stored under existing `profile` key):

```
{
  schema_version: 2,
  setup_status: "incomplete" | "in_progress" | "complete",
  brain_confidence: "weak" | "partial" | "strong",
  target_customer: {
    industries, business_models, company_size:{min,max,label},
    funding_stage, geography, must_have, nice_to_have,
    disqualifiers: { industries, company_types, domains, keywords, titles }
  },
  buyer_personas, triggers, jobs_to_watch, competitors, tools,
  pain_points, positive_examples, negative_examples, content_angles,
  qualification_rules: { required_evidence, reject_if, manual_review_if },
  legacy: { icp, company, gtm, positioning, brand_voice }  // preserved as-is
}
```

Legacy top-level keys (`icp`, `company`, `gtm`, `positioning`, `brand_voice`, `founder`, `goals`, `approval_rules`, `workflow_preferences`, `onboarding_meta`, `integration_status`) are **kept in place** during read/write so nothing that reads them today breaks. The normalizer projects them into v2 on read.

## Stage 2 — Shared normalizer (frontend + edge)

Create pure, deterministic normalizers used everywhere the brain is read:

- `src/lib/normalizeCompanyBrain.ts`
- `supabase/functions/_shared/normalizeCompanyBrain.ts` (Deno mirror)

Behavior:
- Accepts any legacy or v2 profile shape
- Coerces string `positioning` → `{ promise: <string> }`; string `brand_voice` → `{ tone: <string> }`
- Guarantees array fields are arrays; disqualifiers become the 5 structured buckets
- Maps legacy `icp.industries/company_size/geography/buyer_roles/pain_points/disqualifiers` → `target_customer.*` when v2 slots are empty
- **Never** invents targeting: empty in → empty out
- Computes `brain_confidence` from field density (weak / partial / strong)
- Sets `setup_required = true` when key ICP slots (industries + buyer_personas OR target_customer.must_have) are empty

Tests (`normalizeCompanyBrain.test.ts` + Deno equivalent):
- empty → weak, setup_required, no broad SaaS defaults
- string positioning/brand_voice → structured objects
- legacy icp → v2 target_customer projection
- v2 preferred over legacy when both present
- disqualifiers preserved and structured

## Stage 3 — Provisioning hardening (migration file only, not applied)

Create `supabase/migrations/<ts>_company_brain_v2_defaults.sql` (**do not run** — reviewer approval required later):

- Update `provision_workspace_for_user` so the initial `company_brain` insert seeds:
  ```
  { schema_version: 2, setup_status: 'incomplete', brain_confidence: 'weak',
    target_customer: { …empty structured shell… },
    buyer_personas: [], triggers: [], … , qualification_rules: {…} }
  ```
- Idempotent backfill for existing workspaces whose `profile` lacks `schema_version`: merge v2 skeleton into `profile` while preserving all existing keys under a `legacy` view (non-destructive — original keys stay top-level).
- No RLS or GRANT changes needed — existing policies already cover the row.

Also verify (in the same migration file, as comments and `RAISE NOTICE` checks) that:
- `has_workspace_access` gates `company_brain` for `SELECT`/`UPDATE`
- No `anon` grants on `company_brain`
- Service role usage is only in edge functions

## Stage 4 — Onboarding writes v2 cleanly

Update `src/lib/companyBrainSchema.ts` + onboarding wizard components:
- Add v2 sections to the wizard: Your Company, Ideal Customers, Buyers, Buying Triggers, Disqualifiers, Examples, Content & Outreach
- Wizard saves through a v2-aware `saveBrain(patch)` that:
  1. Reads current profile
  2. Runs it through the normalizer
  3. Deep-merges patch into v2 slots
  4. Writes back with `schema_version: 2` and recomputed `brain_confidence` / `setup_status`
- Zod validation before save; reject raw strings where objects are expected
- Show completeness score + "setup incomplete" banner where required ICP fields are missing

Do not delete legacy wizard steps in this stage — hide/repurpose them so existing users don't lose data.

## Stage 5 — Compiler unification

Update `supabase/functions/_shared/companyBrainCompiler.ts`:
- Read normalized v2 first; fall back to legacy projection
- Emit a single canonical `CompiledBrain` including `brain_confidence`, `setup_required`, structured disqualifiers, positive/negative examples, qualification rules
- When `setup_required`:
  - Radar: cap scores; forbid `verified` status
  - Leads: no broad-industry expansion
  - Content: low-confidence mode / ask for missing info
  - Outreach: skip drafting for companies matching any disqualifier bucket

Extend existing `companyBrainCompiler.test.ts` with:
- empty brain → setup_required=true, no verified path
- Agentory-like brain → strict B2B SaaS ICP
- lab/analytical/pharma/chemicals/packaging/staffing rejected for B2B SaaS
- AI SaaS hiring Founding AE / B2B SaaS hiring SDR accepted
- ICP score 0 cannot be verified; buyer-only signal cannot be verified

## Stage 6 — Product-wide adoption (Radar now, adapters for the rest)

- Radar (`run-radar-scan` and scorers): switch to compiled brain, enforce `setup_required` gates in scoring
- Leads / Content / Agents / Outreach: add thin adapter that calls the normalizer + compiler and exposes the same fields today's `deriveCompanyIcp` returns, so callers migrate without behavior change
- Full replacement of `deriveCompanyIcp` is left as a follow-up commit with its own test pass

## Stage 7 — Safety + validation (no runtime side effects)

- `deno check` on touched edge functions
- `deno test` on shared modules
- `bunx vitest run` on new/updated frontend tests
- `tsgo` typecheck
- Grep guardrails for `auto-send|auto-post|auto-comment|auto-dm|service_role` misuse, hardcoded workspace IDs, auto-applied migrations, fake seed data

## Deliverables

1. `src/lib/normalizeCompanyBrain.ts` (+ tests)
2. `supabase/functions/_shared/normalizeCompanyBrain.ts` (+ Deno tests)
3. Updated `src/lib/companyBrainSchema.ts` (v2 types, defaults, merge)
4. Onboarding wizard updates (v2 sections, validation, completeness)
5. Updated `supabase/functions/_shared/companyBrainCompiler.ts` (+ expanded tests)
6. Radar scorer updates to respect `setup_required`
7. Adapter layer for Leads/Content/Agents/Outreach
8. Migration file `supabase/migrations/<ts>_company_brain_v2_defaults.sql` — **created, not applied**
9. Written report covering the 13 required items

## Non-goals / explicit stops

- No new per-user tables
- No production migration run
- No Apify / Firecrawl / provider calls
- No Radar scan, no outreach send
- No Commit 4B work
- No changes to Supabase secrets, RLS grants, or auth config beyond what the migration file proposes

## Open questions before I start building

1. **Migration application**: I'll create the migration file but leave it unapplied. Confirm you want it staged this way (you review and apply later), rather than skipping the SQL entirely for this pass.
2. **Legacy field handling**: I plan to keep legacy top-level keys in place (non-destructive) and only project them into v2 via the normalizer. Confirm — the alternative is moving them under a `legacy` sub-object, which is cleaner but touches every legacy reader.
3. **Onboarding UX**: extend the existing wizard with new v2 sections, or add a separate "ICP Setup" flow triggered when `setup_required=true`? I'll default to extending the existing wizard unless you prefer the separate flow.
