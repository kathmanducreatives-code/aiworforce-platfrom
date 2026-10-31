// ONE COMPANY BRAIN: THE PAGE, THE AGENTS AND LEAD SEARCH READ THE SAME TARGETING.
//
// docs/audits/company-brain-onboarding (Appendix A) showed one edit on the
// Company Brain page producing three different answers to "which industries do
// we target?": the page said Logistics, every agent prompt still said Fintech,
// and the lead compiler searched for both. A cleared value came back.
//
// These tests drive the real modules through the one edit path (planBrainUpdate,
// the logic behind generate-company-brain-draft `update`) and then read the
// result the way each consumer does:
//
//   page    — the frontend normalizer the Company Brain UI reads (src/lib)
//   agents  — renderCompanyBrainBlock, injected into every run-agent prompt
//   leads   — compileCompanyBrainContext, the lead path's ICP and exclusions
//
// Pure. No network, no database. The write's atomic version check lives in the
// edge handler; companyBrainWritePaths.test.ts pins it.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { planBrainUpdate, mirrorLegacyIcp } from "../../../supabase/functions/_shared/companyBrainUpdate.ts";
import { renderCompanyBrainBlock } from "../../../supabase/functions/_shared/companyBrainContext.ts";
import { compileCompanyBrainContext } from "../../../supabase/functions/_shared/companyBrainCompiler.ts";
import { normalizeCompanyBrain, mergeLegacyIcpProjection } from "../../../supabase/functions/_shared/normalizeCompanyBrain.ts";
import { normalizeCompanyBrain as normalizeForPage } from "../../../src/lib/normalizeCompanyBrain.ts";

type Raw = Record<string, unknown>;
const V1 = "2026-10-22T10:00:00.000000+00:00";

/** What onboarding's backend save stores today: v2 + the legacy icp projection + radar defaults. */
function onboarded(): Raw {
  const v2: Raw = {
    schema_version: 2,
    company: { name: "Northwind", description: "Revenue analytics", team_size: "24" },
    target_customer: {
      industries: ["Fintech"], business_models: ["B2B SaaS"], geography: ["United Kingdom"],
      funding_stage: ["Series A"], must_have: ["Hiring RevOps"], nice_to_have: ["Uses Salesforce"],
      company_size: { min: 50, max: 200, label: "" },
      disqualifiers: { industries: ["Agencies"], company_types: ["Pre-revenue startups"], domains: [], keywords: ["crypto"], titles: [] },
    },
    buyer_personas: ["CFO"],
    pain_points: ["Slow board reporting"],
    jobs_to_watch: ["FP&A Lead"],
    qualification_rules: { required_evidence: ["Public pricing page"], reject_if: ["Fewer than 20 employees"], manual_review_if: ["Holding group parent"] },
    brand_voice: { tone: "Direct", style_rules: ["Lead with a number"] },
  };
  return {
    ...v2,
    icp: mergeLegacyIcpProjection({}, normalizeCompanyBrain(v2)),
    signal_preferences: { industries: ["Fintech"], disqualifiers: ["Agencies"], hiring_roles: ["CFO"], keywords: ["revops"] },
  };
}

/** Apply one edit through the one write path; fail the test if it is refused. */
function edit(existing: Raw, patch: Raw, alreadyActive = true): Raw {
  const plan = planBrainUpdate({ existing, currentUpdatedAt: V1, expectedUpdatedAt: V1, patch, alreadyActive });
  if (!plan.ok) throw new Error(`update refused: ${plan.reason} ${plan.detail ?? ""}`);
  return plan.profile;
}

/** The section patch the Company Brain page sends for targeting (the drawer's buildPatch shape). */
function targeting(profile: Raw, changes: Raw): Raw {
  const t = normalizeForPage(profile).target_customer;
  return { target_customer: { ...t, ...changes } };
}

const readers = (p: Raw) => ({
  page: normalizeForPage(p).target_customer.industries,
  agents: renderCompanyBrainBlock(p, true),
  leads: compileCompanyBrainContext({ workspace_id: "ws", profile: p }),
});

Deno.test("1. Fintech → Logistics: page, agents and lead search all say Logistics", () => {
  const saved = edit(onboarded(), targeting(onboarded(), { industries: ["Logistics"] }));
  const r = readers(saved);
  assertEquals(r.page, ["Logistics"]);
  assertEquals(r.leads.icp.industries, ["Logistics"]);
  assert(r.agents.includes("Logistics"), "agents see the new industry");
  assertFalse(r.agents.includes("Fintech"), "agents no longer see the old one");
  assertFalse(JSON.stringify((saved.signal_preferences as Raw).industries).includes("Fintech"), "radar copy dropped it");
});

Deno.test("2. clearing a targeting value removes its effect everywhere", () => {
  const saved = edit(onboarded(), targeting(onboarded(), { industries: [] }));
  const r = readers(saved);
  assertEquals(r.page, []);
  assertEquals(r.leads.icp.industries, []);
  assertFalse(r.agents.includes("Fintech"));
  assertEquals((saved.icp as Raw).industries, [], "the legacy mirror is cleared, not left holding the old value");
});

Deno.test("3. clearing an exclusion: it stops excluding, and no other bucket resurrects as an industry", () => {
  const base = onboarded();
  const t = normalizeForPage(base).target_customer;
  const saved = edit(base, { target_customer: { ...t, disqualifiers: { ...t.disqualifiers, industries: [] } } });
  const page = normalizeForPage(saved).target_customer.disqualifiers;
  assertEquals(page.industries, [], "page: the industry exclusion is gone");
  assertEquals(page.company_types, ["Pre-revenue startups"], "the other buckets are kept");
  const leads = compileCompanyBrainContext({ workspace_id: "ws", profile: saved });
  assertFalse(leads.disqualifiers.industries_explicit.includes("Agencies"), "lead search stops excluding it");
  assertFalse(JSON.stringify(saved.signal_preferences).includes("Agencies"), "radar copy dropped it");
  const agents = renderCompanyBrainBlock(saved, true);
  assertFalse(agents.includes("Agencies"));
  assert(agents.includes("Pre-revenue startups"));
});

Deno.test("4. conflicting structured and legacy values: structured wins on the next save", () => {
  // A row the old page left divergent: v2 says Logistics, legacy icp and the
  // radar copy still say Fintech; the radar also holds a radar-only addition.
  const divergent: Raw = {
    ...onboarded(),
    target_customer: { ...(onboarded().target_customer as Raw), industries: ["Logistics"] },
    signal_preferences: { industries: ["Fintech", "Insurtech"] },
  };
  // Before any save the lead compiler still unions the stale copies — the
  // reason the write path must reconcile them.
  assert(compileCompanyBrainContext({ workspace_id: "ws", profile: divergent }).icp.industries.includes("Fintech"));
  // Any edit — even an unrelated one — repairs every copy.
  const saved = edit(divergent, { pain_points: ["Slow board reporting", "Manual reconciliations"] });
  const r = readers(saved);
  assertEquals(r.page, ["Logistics"]);
  assertEquals(r.leads.icp.industries.filter((x: string) => x !== "Insurtech"), ["Logistics"]);
  assertFalse(r.agents.includes("Fintech"));
  assertEquals((saved.signal_preferences as Raw).industries, ["Insurtech"], "a value only the radar was given is kept");
});

Deno.test("5. reload: what is saved reads back identically, and a second save changes nothing", () => {
  const once = edit(onboarded(), targeting(onboarded(), { industries: ["Logistics"], geography: ["Germany"] }));
  const reloaded = normalizeForPage(once);
  const twice = edit(once, targeting(once, {}));
  assertEquals(normalizeForPage(twice).target_customer, reloaded.target_customer, "idempotent");
  assertEquals(normalizeCompanyBrain(twice).target_customer.industries, reloaded.target_customer.industries, "frontend and backend normalizers agree");
  assertEquals((twice.icp as Raw).geography, "Germany");
});

Deno.test("6. concurrent edits: a save built on an old version is refused, never merged blind", () => {
  const base = onboarded();
  const stale = planBrainUpdate({ existing: base, currentUpdatedAt: "2026-10-22T10:05:00+00:00", expectedUpdatedAt: V1, patch: { pain_points: [] }, alreadyActive: true });
  assertEquals(stale.ok ? "ok" : stale.reason, "stale");
  const blind = planBrainUpdate({ existing: base, currentUpdatedAt: V1, expectedUpdatedAt: undefined, patch: { pain_points: [] }, alreadyActive: true });
  assertEquals(blind.ok ? "ok" : blind.reason, "missing_expected_version");
});

Deno.test("7. only structured keys are writable; legacy blocks and derived flags are not", () => {
  const legacy = planBrainUpdate({ existing: onboarded(), currentUpdatedAt: V1, expectedUpdatedAt: V1, patch: { icp: { industries: ["X"] } }, alreadyActive: true });
  assertEquals(legacy.ok ? "ok" : legacy.reason, "invalid_patch");
  const derived = planBrainUpdate({ existing: onboarded(), currentUpdatedAt: V1, expectedUpdatedAt: V1, patch: { setup_status: "complete" }, alreadyActive: false });
  assertEquals(derived.ok ? "ok" : derived.reason, "invalid_patch");
  const missing = planBrainUpdate({ existing: null, currentUpdatedAt: null, expectedUpdatedAt: V1, patch: {}, alreadyActive: false });
  assertEquals(missing.ok ? "ok" : missing.reason, "brain_not_found");
});

Deno.test("8. missing or partial onboarding: an edit never activates, and an active Brain stays active", () => {
  const draft: Raw = { schema_version: 2, company: { name: "Draftco" }, is_draft: true };
  const savedDraft = edit(draft, { buyer_personas: ["CFO"] }, false);
  assert(savedDraft.setup_status !== "complete", "a draft is not marked complete by an edit");
  assertEquals(savedDraft.is_draft, true);
  assert(renderCompanyBrainBlock(savedDraft, false).includes("no active company brain"), "an un-activated Brain is still not injected");
  const active = edit(onboarded(), targeting(onboarded(), { industries: [] }), true);
  assertEquals(active.is_draft, false);
  assertEquals(active.setup_status, "in_progress", "clearing a required field shows as incomplete, without deactivating");
});

Deno.test("9. agents receive every structured targeting rule, not only the ICP sentence", () => {
  const block = renderCompanyBrainBlock(onboarded(), true);
  for (const expected of [
    "Fintech", "B2B SaaS", "United Kingdom", "Series A", "50–200 employees",
    "Must have: Hiring RevOps", "Nice to have: Uses Salesforce",
    "Agencies", "Pre-revenue startups", "crypto",
    "Qualify only with evidence of: Public pricing page", "Send to review if: Holding group parent", "Reject if: Fewer than 20 employees",
    "Roles to watch for: FP&A Lead", "Voice rules: Lead with a number",
  ]) assert(block.includes(expected), `prompt is missing: ${expected}`);
});

Deno.test("10. the legacy mirror never copies the seller's own headcount as the target size", () => {
  const noTargetSize = normalizeCompanyBrain({ schema_version: 2, company: { team_size: "24" }, target_customer: {} });
  assertEquals(mirrorLegacyIcp({}, noTargetSize, {}).company_size, "");
  assertEquals(mirrorLegacyIcp({}, noTargetSize, { company_size: { min: 50, max: 200 } }).company_size, "50-200 employees");
});

Deno.test("11. legacy-only workspaces keep working: icp.* is still read when nothing structured exists", () => {
  const legacyOnly: Raw = {
    company_name: "Oldco", what_we_do: "Payroll software", who_we_sell_to: "HR leaders",
    icp: { industries: ["Healthcare"], buyer_roles: ["HR Director"], disqualifiers: ["Government"] },
  };
  const block = renderCompanyBrainBlock(legacyOnly, true);
  assert(block.includes("Healthcare") && block.includes("HR Director") && block.includes("Government"));
  assertEquals(normalizeForPage(legacyOnly).target_customer.disqualifiers.industries, ["Government"]);
  // Their first edit materialises the structured shape without losing anything.
  const saved = edit(legacyOnly, { pain_points: ["Manual payroll"] }, true);
  assertEquals(normalizeForPage(saved).target_customer.industries, ["Healthcare"]);
  assertEquals((saved.icp as Raw).industries, ["Healthcare"]);
});
