// ONBOARDING SAVES THE SAME TRUTH THE COMPANY BRAIN PAGE SAVES (roadmap 1.2).
//
// #147 made the page's `update` write an exact legacy mirror. Onboarding's own
// save (save_draft / activate → applyBrainSave) still used the additive
// `mergeLegacyIcpProjection`: an empty structured list left the legacy copy
// holding the old value, the normalizer fell back to it, and a value cleared in
// onboarding review came back — in the agent prompt, in lead search, and in the
// completeness check that decides activation.
//
// These tests drive applyBrainSave and read the result the way each consumer
// does (page normalizer, agent prompt block, lead compiler), as
// companyBrainOneTruth.test.ts does for the page's edit path. Pure.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyBrainSave } from "../../../supabase/functions/_shared/companyBrainV2Save.ts";
import { planBrainUpdate } from "../../../supabase/functions/_shared/companyBrainUpdate.ts";
import { renderCompanyBrainBlock } from "../../../supabase/functions/_shared/companyBrainContext.ts";
import { compileCompanyBrainContext } from "../../../supabase/functions/_shared/companyBrainCompiler.ts";
import { normalizeCompanyBrain, mergeLegacyIcpProjection } from "../../../supabase/functions/_shared/normalizeCompanyBrain.ts";
import { normalizeCompanyBrain as normalizeForPage } from "../../../src/lib/normalizeCompanyBrain.ts";

type Raw = Record<string, unknown>;

/** A complete onboarding patch (all 8 required decisions). */
function complete(over: Raw = {}): Raw {
  return {
    company: { name: "Northwind", description: "Revenue analytics", business_model: "B2B SaaS", team_size: "24" },
    target_customer: {
      industries: ["Fintech"], business_models: [], geography: ["United Kingdom"], funding_stage: [],
      must_have: [], nice_to_have: [], company_size: { min: 50, max: 200, label: "" },
      disqualifiers: { industries: ["Agencies"], company_types: [], domains: [], keywords: [], titles: [] },
    },
    buyer_personas: ["CFO"], pain_points: ["Slow board reporting"], triggers: ["New funding"],
    ...over,
  };
}
/** What a draft saved by the OLD onboarding save looks like: v2 plus the additive legacy projection. */
function oldDraft(): Raw {
  const v2 = { schema_version: 2, ...complete() };
  return { ...v2, icp: mergeLegacyIcpProjection({}, normalizeCompanyBrain(v2)), signal_preferences: { industries: ["Fintech"], keywords: ["revops"] } };
}
const tc = (p: Raw) => normalizeForPage(p).target_customer;
const readers = (p: Raw) => ({
  page: tc(p).industries,
  agents: renderCompanyBrainBlock(p, true),
  leads: compileCompanyBrainContext({ workspace_id: "ws", profile: p }),
});

Deno.test("1.2-1 a value cleared in onboarding review stays cleared for every reader", () => {
  const r = applyBrainSave(oldDraft(), { target_customer: { ...tc(oldDraft()), industries: [] } } as never);
  const read = readers(r.profile);
  assertEquals(read.page, [], "page");
  assertEquals(read.leads.icp.industries, [], "lead search");
  assertFalse(read.agents.includes("Fintech"), "agent prompt");
  assertEquals((r.profile.icp as Raw).industries, [], "the legacy mirror is cleared, not left holding Fintech");
  assertEquals(r.normalized.target_customer.industries, []);
});

Deno.test("1.2-2 a cleared required decision no longer counts toward activation", () => {
  // Before: the legacy copy still held Fintech, the normalizer fell back to it,
  // and the Brain activated with no target market the user had kept.
  const r = applyBrainSave(oldDraft(), { target_customer: { ...tc(oldDraft()), industries: [] } } as never, { activate: true });
  assertFalse(r.onboarding_completed, "cannot activate on a value the user removed");
  assert(r.blocked_reasons.some((b) => /industr|market/i.test(b)), `blocked on the market: ${r.blocked_reasons.join("; ")}`);
});

Deno.test("1.2-3 a changed value replaces the old one everywhere; radar-only additions are kept", () => {
  const r = applyBrainSave(oldDraft(), { target_customer: { ...tc(oldDraft()), industries: ["Logistics"] } } as never);
  const read = readers(r.profile);
  assertEquals(read.page, ["Logistics"]);
  assertEquals(read.leads.icp.industries, ["Logistics"]);
  assert(read.agents.includes("Logistics"));
  assertFalse(read.agents.includes("Fintech"));
  const prefs = r.profile.signal_preferences as Raw;
  assertEquals(prefs.industries, [], "the radar copy dropped Fintech");
  assertEquals(prefs.keywords, ["revops"], "a value only the radar held is kept");
});

Deno.test("1.2-4 activation itself is unchanged: complete activates, incomplete does not", () => {
  const ok = applyBrainSave({}, complete() as never, { activate: true });
  assert(ok.onboarding_completed);
  assertEquals(ok.profile.is_draft, false);
  assertEquals((ok.profile.signal_preferences as Raw).industries, ["Fintech"], "radar defaults derived on activation, as before");
  const missing = applyBrainSave({}, complete({ buyer_personas: [] }) as never, { activate: true });
  assertFalse(missing.onboarding_completed);
});

Deno.test("1.2-5 a legacy-only profile keeps its values (there, legacy IS the truth)", () => {
  const legacy: Raw = { icp: { industries: ["Healthcare"], buyer_roles: ["COO"] }, company: { name: "Old Co" } };
  const r = applyBrainSave(legacy, { company: { description: "Clinic software" } } as never);
  assertEquals(tc(r.profile).industries, ["Healthcare"]);
  assertEquals((r.profile.icp as Raw).industries, ["Healthcare"]);
  assertEquals(normalizeForPage(r.profile).buyer_personas, ["COO"]);
});

Deno.test("1.2-6 the seller's own headcount is never mirrored as the target size", () => {
  const r = applyBrainSave({}, complete({ target_customer: { ...(complete().target_customer as Raw), company_size: { label: "" } } }) as never);
  assertEquals((r.profile.icp as Raw).company_size, "", "team_size 24 is not written as the target size");
});

Deno.test("1.2-7 onboarding then a page edit agree: both write paths produce the same mirror", () => {
  const onboarded = applyBrainSave({}, complete() as never, { activate: true }).profile;
  const t = tc(onboarded);
  const V = "2026-10-22T10:00:00+00:00";
  const viaPage = planBrainUpdate({ existing: onboarded, currentUpdatedAt: V, expectedUpdatedAt: V, alreadyActive: true,
    patch: { target_customer: { ...t, industries: ["Logistics"] } } });
  if (!viaPage.ok) throw new Error(viaPage.reason);
  const viaOnboarding = applyBrainSave(onboarded, { target_customer: { ...t, industries: ["Logistics"] } } as never);
  assertEquals((viaOnboarding.profile.icp as Raw).industries, (viaPage.profile.icp as Raw).industries);
  assertEquals((viaOnboarding.profile.signal_preferences as Raw).industries, (viaPage.profile.signal_preferences as Raw).industries);
});
