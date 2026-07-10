// Company Brain v2 save + activation gate. Pure — no DB, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mergeV2Patch, applyBrainSave, deriveSignalPreferences } from "./companyBrainV2Save.ts";
import { computeCompanyBrainCompleteness, canActivateBrain } from "./companyBrainCompleteness.ts";
import { normalizeCompanyBrain } from "./normalizeCompanyBrain.ts";

/** A patch that satisfies every activation requirement. */
const completePatch = () => ({
  company: { name: "Cekura", website_url: "https://cekura.ai", description: "AI SaaS", business_model: "B2B SaaS" },
  target_customer: {
    industries: ["B2B SaaS"], business_models: ["B2B SaaS"],
    company_size: { min: 10, max: 150, label: "10-150" },
    funding_stage: [], geography: ["US"], must_have: [], nice_to_have: [],
    disqualifiers: { industries: ["pharma"], company_types: [], domains: [], keywords: [], titles: [] },
  },
  buyer_personas: ["Founder"],
  triggers: ["recently funded"],
  jobs_to_watch: [],
  pain_points: ["manual outbound"],
  content_angles: [],
});

Deno.test("1. mergeV2Patch preserves legacy top-level keys and stamps schema_version", () => {
  const existing = { legacy_thing: "keep me", icp: { industries: ["old"] }, onboarding_meta: { step: "x" } };
  const merged = mergeV2Patch(existing, { buyer_personas: ["Founder"] } as any);
  assertEquals(merged.schema_version, 2);
  assertEquals(merged.legacy_thing, "keep me");
  assertEquals((merged.icp as any).industries, ["old"], "legacy icp untouched");
  assertEquals(merged.buyer_personas, ["Founder"]);
});

Deno.test("2. arrays replace, objects shallow-merge", () => {
  const existing = { company: { name: "Old", stage: "seed" }, buyer_personas: ["A", "B"] };
  const merged = mergeV2Patch(existing, { company: { name: "New" }, buyer_personas: ["C"] } as any);
  assertEquals((merged.company as any).name, "New");
  assertEquals((merged.company as any).stage, "seed", "untouched object key survives");
  assertEquals(merged.buyer_personas, ["C"], "array replaced wholesale");
});

Deno.test("3. client cannot fake derived flags", () => {
  const merged = mergeV2Patch({}, { setup_status: "complete", brain_confidence: "strong", setup_required: false } as any);
  assertEquals(merged.setup_status, undefined);
  assertEquals(merged.brain_confidence, undefined);
  assertEquals(merged.setup_required, undefined);
});

Deno.test("4. incomplete Brain can be SAVED as draft but never activated", () => {
  const r = applyBrainSave({}, { company: { name: "Cekura" } } as any, { activate: true });
  assertEquals(r.onboarding_completed, false);
  assert(r.blocked_reasons.length > 0);
  assert(r.blocked_reasons.some((b) => /Business model/i.test(b)));
  assertEquals(r.profile.setup_status, "in_progress");
  assertEquals(r.completeness.complete, false);
});

Deno.test("5. complete Brain + activate → onboarding_completed, setup_status complete, not a draft", () => {
  const r = applyBrainSave({ is_draft: true }, completePatch() as any, { activate: true });
  assertEquals(r.completeness.complete, true);
  assertEquals(r.onboarding_completed, true);
  assertEquals(r.profile.setup_status, "complete");
  assertEquals(r.profile.is_draft, false, "activation clears the draft flag");
  assertEquals(r.blocked_reasons, []);
});

Deno.test("6. save_draft never completes onboarding even when the Brain is complete", () => {
  const r = applyBrainSave({}, completePatch() as any, { activate: false });
  assertEquals(r.completeness.complete, true);
  assertEquals(r.onboarding_completed, false, "saving a draft must not finish onboarding");
  assertEquals(r.profile.setup_status, "in_progress");
});

Deno.test("7. derived flags are recomputed from the merged truth", () => {
  const r = applyBrainSave({}, completePatch() as any, { activate: true });
  assertEquals(r.profile.brain_confidence, r.completeness.confidence);
  assertEquals(r.profile.missing_fields, []);
  assertEquals(r.normalized.setup_status, "complete");
});

Deno.test("8. empty Brain → every requirement missing, 0-ish percent, weak", () => {
  const c = computeCompanyBrainCompleteness(normalizeCompanyBrain({}));
  assertEquals(c.complete, false);
  assertEquals(c.required_met, 0);
  assertEquals(c.confidence, "weak");
  assert(c.missing.includes("Company name"));
  assert(c.missing.includes("At least one disqualifier"));
  assertEquals(canActivateBrain(normalizeCompanyBrain({})), false);
});

Deno.test("9. each required field individually blocks activation", () => {
  const base = completePatch() as Record<string, any>;
  const drop = (mut: (p: Record<string, any>) => void) => {
    const p = structuredClone(base);
    mut(p);
    return applyBrainSave({}, p as any, { activate: true }).onboarding_completed;
  };
  assertEquals(drop((p) => { p.company.name = ""; }), false, "no name");
  assertEquals(drop((p) => { p.company.business_model = ""; }), false, "no business model");
  assertEquals(drop((p) => { p.target_customer.industries = []; p.target_customer.business_models = []; }), false, "no market");
  assertEquals(drop((p) => { p.buyer_personas = []; }), false, "no buyer");
  assertEquals(drop((p) => { p.triggers = []; p.jobs_to_watch = []; }), false, "no trigger");
  assertEquals(drop((p) => { p.target_customer.disqualifiers.industries = []; }), false, "no disqualifier");
  assertEquals(drop((p) => { p.pain_points = []; p.content_angles = []; }), false, "no pain/angle");
  assertEquals(drop((p) => { p.company.website_url = ""; p.company.description = ""; }), false, "no identity");
});

Deno.test("10. disqualifiers persist into their buckets; examples survive the round-trip", () => {
  const patch = { ...completePatch(), negative_examples: ["Pace Analytical"], positive_examples: ["Acme"] };
  const r = applyBrainSave({}, patch as any, { activate: true });
  assertEquals(r.normalized.target_customer.disqualifiers.industries, ["pharma"]);
  assertEquals(r.normalized.negative_examples, ["Pace Analytical"]);
  assertEquals(r.normalized.positive_examples, ["Acme"]);
});

Deno.test("11. corrupted string positioning/brand_voice normalize without throwing", () => {
  const r = applyBrainSave({ positioning: "just a string", brand_voice: "direct" }, completePatch() as any, { activate: true });
  assertEquals(r.normalized.positioning.promise, "just a string");
  assertEquals(r.normalized.brand_voice.tone, "direct");
  assertEquals(r.onboarding_completed, true);
});

Deno.test("12. signal_preferences derive from the Brain, only for fields it can support", () => {
  const r = applyBrainSave({}, completePatch() as any, { activate: true });
  const prefs = deriveSignalPreferences(r.normalized);
  assertEquals(prefs.industries, ["B2B SaaS"]);
  assertEquals(prefs.hiring_roles, ["Founder"]);
  assertEquals(prefs.disqualifiers, ["pharma"]);
  assertEquals("competitors" in prefs, false, "no competitors in Brain → no key invented");
});
