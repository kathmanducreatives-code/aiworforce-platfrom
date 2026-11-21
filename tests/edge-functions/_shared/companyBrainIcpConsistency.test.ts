// COMPANY BRAIN V2 · B2.1 — one ICP: detect disagreements, resolve them through
// the authorized update, refuse writes that create contradictions. Fictional data.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assessIcpConsistency, introducedIcpContradictions, sizeFromLabel, writableAnalyzeDraft,
} from "../../../supabase/functions/_shared/companyBrainIcpConsistency.ts";
import { planBrainUpdate } from "../../../supabase/functions/_shared/companyBrainUpdate.ts";
import { applyBrainSave } from "../../../supabase/functions/_shared/companyBrainV2Save.ts";
import { assessCompanyBrain } from "../../../supabase/functions/_shared/companyBrainAssessment.ts";
import { compilerBrainContext } from "../../../supabase/functions/_shared/leadPipeline/brainContext.ts";

type Raw = Record<string, unknown>;
const P = JSON.parse(await Deno.readTextFile(new URL("../../fixtures/company-brain/atlas-contract-profiles.json", import.meta.url))).profiles as Record<string, Raw>;
const ids = (p: Raw) => assessIcpConsistency(p).conflicts.map((c) => c.id).sort();
const update = (existing: Raw, patch: Raw) =>
  planBrainUpdate({ existing, currentUpdatedAt: "v1", expectedUpdatedAt: "v1", patch, alreadyActive: true });

Deno.test("B2.1: size labels parse to bounds (only labels with numbers)", () => {
  assertEquals(sizeFromLabel("11-50"), { min: 11, max: 50 });
  assertEquals(sizeFromLabel("51–200 employees"), { min: 51, max: 200 });
  assertEquals(sizeFromLabel("1,000 to 5,000"), { min: 1000, max: 5000 });
  assertEquals(sizeFromLabel("100+"), { min: 100, max: null });
  assertEquals(sizeFromLabel("5"), { min: 5, max: 5 });
  assertEquals(sizeFromLabel("Founder-led to early-stage teams"), null);
});

Deno.test("B2.1: every disagreement in the contradictory fixture is found, with what each copy says", () => {
  assertEquals(ids(P.contradictory_copies), [
    "industry_targeted_and_excluded", "mirror_disqualifiers", "mirror_geography", "mirror_industries", "mirror_personas", "mirror_size",
    "radar_outside_geography", "size_label_vs_bounds",
  ]);
  const c = assessIcpConsistency(P.contradictory_copies).conflicts;
  const ind = c.find((x) => x.id === "mirror_industries")!;
  assertEquals([ind.kind, ind.authoritative, ind.other], ["projection_stale", ["Retail"], ["Manufacturing"]]);
  const size = c.find((x) => x.id === "size_label_vs_bounds")!;
  assertEquals([size.authoritative, size.other], [["10-50"], ["200-500"]]);
  assertEquals(c.find((x) => x.id === "radar_outside_geography")!.other, ["Brazil"]);
});

Deno.test("B2.1: the live shape's size label disagrees with its enforced bounds (the R1.1 finding); a stale persona copy is found too", () => {
  assertEquals(ids(P.live_shape), ["mirror_personas", "size_label_vs_bounds"]);
  const personas = assessIcpConsistency(P.live_shape).conflicts.find((x) => x.id === "mirror_personas")!;
  assertEquals(personas.other, ["Founder", "Head of Sales"], "the legacy copy lacks the third persona");
  const c = assessIcpConsistency(P.live_shape).conflicts.find((x) => x.id === "size_label_vs_bounds")!;
  assertStringIncludes(c.message, `"5"`);
  assertStringIncludes(c.message, "2");
});

Deno.test("B2.1: legacy-only and empty Brains have no other truth to disagree with", () => {
  assertEquals(ids(P.legacy_only), []);
  assertEquals(ids(P.empty), []);
  assertEquals(ids(P.v2_only), []);
});

Deno.test("B2.1: resolutions are ordinary authorized updates; applying them converges to zero conflicts", () => {
  let profile = P.contradictory_copies;
  for (let round = 0; round < 10; round++) {
    const conflicts = assessIcpConsistency(profile).conflicts;
    if (!conflicts.length) break;
    const plan = update(profile, conflicts[0].resolutions[0].patch);
    assert(plan.ok, `${conflicts[0].id}: ${!plan.ok && plan.detail}`);
    profile = plan.profile;
  }
  assertEquals(ids(profile), []);
  // ATLAS now reads the AUTHORITATIVE ICP, not the stale mirror (Manufacturing / Japan before).
  const atlas = compilerBrainContext(profile);
  assertEquals(atlas.industries, ["Retail"]);
  assertEquals(atlas.locations, ["France"]);
  assertEquals([atlas.employee_min, atlas.employee_max], [10, 50]);
});

Deno.test("B2.1: each resolution option does what it says", () => {
  const c = assessIcpConsistency(P.contradictory_copies).conflicts.find((x) => x.id === "industry_targeted_and_excluded")!;
  const keepTarget = update(P.contradictory_copies, c.resolutions.find((r) => r.id === "keep_target")!.patch);
  assert(keepTarget.ok);
  assertEquals(keepTarget.normalized.target_customer.industries, ["Retail"]);
  assertEquals(keepTarget.normalized.target_customer.disqualifiers.industries, []);
  const keepExcluded = update(P.contradictory_copies, c.resolutions.find((r) => r.id === "keep_excluded")!.patch);
  assert(keepExcluded.ok);
  assertEquals(keepExcluded.normalized.target_customer.industries, []);
  const size = assessIcpConsistency(P.live_shape).conflicts.find((x) => x.id === "size_label_vs_bounds")!;
  const useLabel = update(P.live_shape, size.resolutions.find((r) => r.id === "use_label")!.patch);
  assert(useLabel.ok);
  assertEquals(useLabel.normalized.target_customer.company_size, { min: 5, max: 5, label: "5" });
  const radar = assessIcpConsistency(P.contradictory_copies).conflicts.find((x) => x.id === "radar_outside_geography")!;
  const stop = update(P.contradictory_copies, radar.resolutions.find((r) => r.id === "stop_watching")!.patch);
  assert(stop.ok);
  assertEquals((stop.profile.signal_preferences as Raw).geographies, []);
});

Deno.test("B2.1: a write that CREATES a contradiction is refused, with the reason", () => {
  for (const [patch, expect] of [
    [{ target_customer: { disqualifiers: { industries: ["B2B Software"], company_types: [], domains: [], keywords: [], titles: [] } } }, "both a target industry and a disqualifier"],
    [{ buyer_personas: ["Founder", "Intern"] }, "both a buyer persona and an excluded title"],
    [{ signal_preferences: { industries: ["Gambling"], geographies: ["United States"] } }, "watches Gambling"],
  ] as const) {
    const plan = update(P.live_shape, patch as Raw);
    assertFalse(plan.ok, JSON.stringify(patch));
    assert(!plan.ok && plan.reason === "icp_contradiction");
    assertStringIncludes(!plan.ok ? plan.detail ?? "" : "", expect);
  }
  // A size label that disagrees with its own bounds, on a Brain whose size was consistent.
  const size = update(P.v2_only, { target_customer: { company_size: { min: 1, max: 10, label: "50-100" } } });
  assertFalse(size.ok);
  assert(!size.ok && size.reason === "icp_contradiction" && (size.detail ?? "").includes("Company size says"));
  // Only NEW contradictions are refused: replacing one size contradiction already on record is not blocked here,
  // and the Brain page offers its resolutions.
  assert(update(P.live_shape, { target_customer: { company_size: { min: 1, max: 10, label: "50-100" } } }).ok);
});

Deno.test("B2.1: contradictions already on record never block an unrelated edit; the radar may watch extra regions", () => {
  const goals = update(P.contradictory_copies, { goals: { gtm: "x" } });
  assert(goals.ok, !goals.ok ? goals.detail : "");
  const radar = update(P.live_shape, { signal_preferences: { industries: ["B2B Software"], geographies: ["United States", "Mexico"] } });
  assert(radar.ok, "watching an extra region is advisory, not refused");
  assert(assessIcpConsistency(radar.profile).conflicts.some((c) => c.id === "radar_outside_geography"));
  assertEquals(introducedIcpContradictions(P.live_shape, P.live_shape), []);
});

Deno.test("B2.1: every write path leaves the copies ATLAS reads in step with target_customer", () => {
  const patches: Raw[] = [
    { target_customer: { industries: ["Healthcare", "Biotech"] } },
    { target_customer: { geography: ["Germany", "Austria"] } },
    { target_customer: { company_size: { min: 11, max: 50, label: "11-50" } } },
    { buyer_personas: ["COO"] },
    { target_customer: { industries: [] } },
  ];
  for (const patch of patches) {
    const u = update(P.live_shape, patch);
    assert(u.ok, JSON.stringify(patch));
    assertFalse(assessIcpConsistency(u.profile).conflicts.some((c) => c.kind === "projection_stale"), `update ${JSON.stringify(patch)}`);
    const onboarding = applyBrainSave(P.live_shape, patch as never);
    assertFalse(assessIcpConsistency(onboarding.profile).conflicts.some((c) => c.kind === "projection_stale"), `onboarding ${JSON.stringify(patch)}`);
  }
});

Deno.test("B2.1: an AI analyze draft never overwrites a structured ICP or the confirmed competitors", () => {
  const draft = { company_summary: "s", icp: { industries: ["Everything"] }, competitors: ["Made-up Co"], brand_voice: "calm" };
  assertEquals(writableAnalyzeDraft(P.live_shape, draft), { company_summary: "s", brand_voice: "calm" });
  assertEquals(writableAnalyzeDraft(P.legacy_only, draft), draft, "a legacy-only Brain keeps the old behaviour");
});

Deno.test("B2.1: setup-company-brain's analyze writes only the writable part of the draft", async () => {
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/setup-company-brain/index.ts", import.meta.url));
  assertStringIncludes(src, "saveProfileWith((current) => ({ ...current, ...writableAnalyzeDraft(current, draft), enriched: enrichments.length > 0 }))");
  assertFalse(src.includes("saveProfile({ ...draft,"), "the old unguarded write is gone");
});

Deno.test("B2.1: conflicts feed the B2.0 assessment of the section they belong to", () => {
  const a = assessCompanyBrain(P.contradictory_copies, { conflicts: assessIcpConsistency(P.contradictory_copies).conflicts });
  assertEquals(a.conflicts, 8);
  assert(a.sections.find((s) => s.key === "target_customer")!.issues.filter((i) => i.kind === "conflicting").length >= 4);
});

Deno.test("B2.1: a filled section with an open conflict is not complete until it is resolved", () => {
  const conflicts = assessIcpConsistency(P.contradictory_copies).conflicts;
  const before = assessCompanyBrain(P.contradictory_copies, { conflicts });
  const tc = before.sections.find((s) => s.key === "target_customer")!;
  assertEquals([tc.status, tc.needs_review, tc.missing], ["incomplete", true, []]);
  const without = assessCompanyBrain(P.contradictory_copies);
  assertEquals(without.sections.find((s) => s.key === "target_customer")!.status, "complete");
  assert(before.score < without.score, "open conflicts cost readiness");
  assertEquals(before.required.complete, without.required.complete - 1);
});
