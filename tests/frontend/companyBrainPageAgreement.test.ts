// WHAT THE REDESIGNED PAGE SHOWS IS WHAT THE AGENTS AND LEAD SEARCH READ.
//
// Roadmap Phase 5 ("UI agreement"): after any edit the page can make, the page's
// own normalizer, the backend normalizer and the lead-search compiler agree on
// every targeting field, and reopening an editor shows exactly what was saved —
// a cleared list stays cleared. Edits are built by the page's patch builders and
// applied by the backend `update` planner (#147), as in production.
//
// The seller's own team size and location are left empty here: whether they
// may stand in for the TARGET is roadmap 1.4 (qualification owner), pinned by
// leadSearchSellerFallbacks.pending.test.ts, not by this file.
//
// Pure. No React, no network.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildFieldPatch, initialFor } from "../../src/lib/companyBrainPatch.ts";
import type { SectionKey } from "../../src/lib/companyBrainHealth.ts";
import { normalizeCompanyBrain as pageNormalize } from "../../src/lib/normalizeCompanyBrain.ts";
import { normalizeCompanyBrain as backendNormalize } from "../../supabase/functions/_shared/normalizeCompanyBrain.ts";
import { compileCompanyBrainContext } from "../../supabase/functions/_shared/companyBrainCompiler.ts";
import { planBrainUpdate } from "../../supabase/functions/_shared/companyBrainUpdate.ts";
import { applyBrainSave } from "../../supabase/functions/_shared/companyBrainV2Save.ts";

type Raw = Record<string, unknown>;
const lc = (xs: string[]) => xs.map((x) => x.toLowerCase()).sort();

/** A Brain as onboarding activates it: structured, legacy mirror and radar copy all present. */
function onboarded(): Raw {
  return applyBrainSave({}, {
    company: { name: "Northwind", description: "Revenue analytics", business_model: "B2B SaaS" },
    target_customer: {
      industries: ["Fintech", "SaaS"], geography: ["United States"], business_models: [], funding_stage: [], must_have: [], nice_to_have: [],
      company_size: { min: 50, max: 200, label: "" },
      disqualifiers: { industries: ["Agencies"], company_types: [], domains: [], keywords: ["crypto"], titles: [] },
    },
    buyer_personas: ["CFO", "VP Finance"], pain_points: ["Slow reporting"], triggers: ["New funding"], jobs_to_watch: ["FP&A Lead"],
  } as never, { activate: true }).profile as Raw;
}

/** One inline edit, saved the way the page saves it. */
function edit(profile: Raw, section: SectionKey, changes: Record<string, unknown>): Raw {
  const shown = pageNormalize(profile);
  const plan = planBrainUpdate({
    existing: profile, currentUpdatedAt: "v1", expectedUpdatedAt: "v1", alreadyActive: true,
    patch: buildFieldPatch(section, changes as never, shown),
  });
  if (!plan.ok) throw new Error(`update refused: ${plan.reason} ${plan.detail ?? ""}`);
  return plan.profile;
}

function assertAgreement(profile: Raw, label: string) {
  const page = pageNormalize(profile);
  const backend = backendNormalize(profile);
  const tc = (b: typeof page) => b.target_customer;
  assertEquals(tc(page).industries, tc(backend).industries, `${label}: industries (page vs agents)`);
  assertEquals(tc(page).geography, tc(backend).geography, `${label}: geography`);
  assertEquals(tc(page).company_size, tc(backend).company_size, `${label}: size`);
  assertEquals(tc(page).disqualifiers, tc(backend).disqualifiers, `${label}: exclusions`);
  assertEquals(page.buyer_personas, backend.buyer_personas, `${label}: buyers`);
  assertEquals(page.pain_points, backend.pain_points, `${label}: pain points`);
  assertEquals(page.triggers, backend.triggers, `${label}: triggers`);
  assertEquals(page.jobs_to_watch, backend.jobs_to_watch, `${label}: jobs to watch`);

  // Lead search unions the structured Brain with the legacy and radar copies;
  // after a save those copies hold nothing the page doesn't show.
  const ctx = compileCompanyBrainContext({ workspace_id: "ws", profile });
  assertEquals(lc(ctx.icp.industries), lc(tc(page).industries), `${label}: lead-search industries`);
  assertEquals(lc(ctx.icp.locations), lc(tc(page).geography), `${label}: lead-search locations`);
  assertEquals([ctx.icp.company_size_min ?? null, ctx.icp.company_size_max ?? null],
    [tc(page).company_size.min, tc(page).company_size.max], `${label}: lead-search size`);
  // Every industry the page excludes, lead search excludes. NOT equality: the
  // compiler also reads the flattened legacy `icp.disqualifiers` (all five
  // buckets) as industries, so a keyword or title exclusion becomes an excluded
  // industry too. That is compiler-owned: roadmap 1.4, contract C4.
  const excluded = new Set(lc(ctx.disqualifiers.industries));
  for (const x of lc(tc(page).disqualifiers.industries)) assert(excluded.has(x), `${label}: lead search does not exclude ${x}`);
}

Deno.test("P5-1 an onboarded Brain: the page and every reader agree before any edit", () => {
  assertAgreement(onboarded(), "onboarded");
});

Deno.test("P5-2 each page edit is what the readers see, and what the editor reopens with", () => {
  const steps: Array<[string, SectionKey, Record<string, unknown>, (p: Raw) => void]> = [
    ["replace industries", "targeting", { industries: ["Logistics"] },
      (p) => assertEquals(initialFor("targeting", pageNormalize(p)).industries, ["Logistics"])],
    ["clear industries", "targeting", { industries: [] },
      (p) => assertEquals(initialFor("targeting", pageNormalize(p)).industries, [])],
    ["narrow the size", "targeting", { size_min: "200", size_max: "1000" },
      (p) => assertEquals([pageNormalize(p).target_customer.company_size.min, pageNormalize(p).target_customer.company_size.max], [200, 1000])],
    ["change geography", "targeting", { geography: ["Canada", "United Kingdom"] },
      (p) => assertEquals(initialFor("targeting", pageNormalize(p)).geography, ["Canada", "United Kingdom"])],
    ["remove a buyer", "buyers", { buyer_personas: ["CFO"] },
      (p) => assertEquals(initialFor("buyers", pageNormalize(p)).buyer_personas, ["CFO"])],
    ["replace pain points", "buyers", { pain_points: ["Manual close"] },
      (p) => assertEquals(initialFor("buyers", pageNormalize(p)).pain_points, ["Manual close"])],
    ["move exclusions to another bucket", "disqualifiers", { disq_industries: [], disq_company_types: ["Agency"] },
      (p) => assertEquals(initialFor("disqualifiers", pageNormalize(p)).disq_industries, [])],
    ["clear the watched jobs", "signals", { jobs_to_watch: [] },
      (p) => assertEquals(initialFor("signals", pageNormalize(p)).jobs_to_watch, [])],
  ];
  let profile = onboarded();
  for (const [label, section, changes, reopens] of steps) {
    profile = edit(profile, section, changes);
    assertAgreement(profile, label);
    reopens(profile);
  }
});

Deno.test("P5-3 a cleared list survives a reload: nothing is re-derived from the legacy or radar copy", () => {
  const cleared = edit(onboarded(), "targeting", { industries: [] });
  const reloaded = JSON.parse(JSON.stringify(cleared)) as Raw; // what the next page load reads
  assertEquals(pageNormalize(reloaded).target_customer.industries, []);
  assertEquals(compileCompanyBrainContext({ workspace_id: "ws", profile: reloaded }).icp.industries, []);
});
