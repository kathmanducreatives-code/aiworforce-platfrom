// S2 — one reader of a mission's meaning, used by the planner, ORION and qualification.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  criteriaFreezeState, criteriaFrozen, criteriaOf, CRITERIA_CONTRACT_VERSION, freezeCriteria, hiringRequirementOf, hiringTitleMatcher,
  signalAlternativesOf,
} from "../../../supabase/functions/_shared/missionCriteriaReader.ts";
import { deriveMissionCriteria, type MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { buildQualificationContext } from "../../../supabase/functions/_shared/missionQualificationContext.ts";
import { planStrategy, specFromMission } from "../../../supabase/functions/_shared/leadPipeline/strategy.ts";
import { requirementsFromMission } from "../../../supabase/functions/_shared/discoveryProviders/requirements.ts";
import { compilePhrasing, loadCases } from "../../../scripts/dev/interpretation-corpus.ts";

const phrasing = (id: string, label?: string) => {
  const c = loadCases().find((x) => x.id === id)!;
  return compilePhrasing(label ? c.phrasings.find((p) => p.label === label)! : c.phrasings[0]) as Record<string, unknown>;
};
const LEGACY = JSON.parse(Deno.readTextFileSync(new URL("../../fixtures/lead-v2/p0-legacy-graph-snapshots.json", import.meta.url))).cases;

Deno.test("reader: a legacy mission stored WITHOUT criteria is derived, never read as 'no requirements'", () => {
  const m = LEGACY[14].mission; // "Find US B2B SaaS companies." — no criteria field
  assertFalse(Array.isArray(m.criteria) && m.criteria.length > 0);
  assertEquals(JSON.stringify(criteriaOf(m)), JSON.stringify(deriveMissionCriteria(m)));
  // The planner and the provider requirements now see its geography (S0: geo=[]).
  assertEquals(specFromMission(m, { defaultCount: 5 }).geography.map((g) => g.toLowerCase()), ["united states"]);
  assert(requirementsFromMission(m).hard.some((h) => h.key === "geography_hq"));
});

Deno.test("reader: legacy policy is explicit — 'stored' keeps the plan-hash copy, 'rederive' is ORION's", () => {
  const m = { ...phrasing("M02"), criteria: [{ id: "x", kind: "hard", dimension: "industry", value: "stale" }] } as never;
  assertEquals((criteriaOf(m) as unknown as { value: string }[])[0].value, "stale", "the planner's stored copy (plan hashes unchanged)");
  assert(!(criteriaOf(m, { legacy: "rederive" }) as unknown as { value: string }[]).some((c) => c.value === "stale"), "ORION re-derives a legacy mission");
});

Deno.test("S3: a compiled mission is FROZEN, and its frozen criteria are exactly a derivation of its final fields", () => {
  for (const c of loadCases()) for (const p of c.phrasings) {
    const m = compilePhrasing(p) as Record<string, unknown>;
    assertEquals(criteriaFreezeState(m), "frozen", `${c.id}:${p.label}`);
    assertEquals(JSON.stringify(m.criteria), JSON.stringify(deriveMissionCriteria(m as never)), `${c.id}:${p.label}: frozen ≠ derived`);
  }
});

Deno.test("S3: a FROZEN mission means exactly its stored criteria, to every caller — a later compiler cannot change it", () => {
  const base = phrasing("M02");
  // Simulate a later compiler that would read the same fields differently: the frozen
  // mission keeps the meaning it was approved with.
  const frozen = freezeCriteria({ ...base, criteria: [{ id: "x", kind: "hard", dimension: "industry", value: "approved" }] });
  assert(criteriaFrozen(frozen));
  for (const legacy of ["stored", "rederive"] as const) {
    assertEquals((criteriaOf(frozen as never, { legacy }) as unknown as { value: string }[])[0].value, "approved", legacy);
  }
});

Deno.test("S3 negative: a frozen mission EDITED without re-freezing is void — never executed as approved", () => {
  const m = phrasing("M02");
  assertEquals(criteriaFreezeState(m), "frozen");
  const edited = { ...m, company_profile: { ...(m.company_profile as object), locations: ["Canada"] } };
  assertEquals(criteriaFreezeState(edited as never), "void", "a changed source field voids the freeze");
  assertEquals(JSON.stringify(criteriaOf(edited as never, { legacy: "rederive" })), JSON.stringify(deriveMissionCriteria(edited as never)),
    "a void freeze falls back to today's legacy behaviour");
  const tampered = { ...m, criteria: (m.criteria as unknown[]).slice(1) };
  assertEquals(criteriaFreezeState(tampered), "void", "changed criteria void it too");
  assertEquals(criteriaFreezeState({ ...m, criteria_contract_version: "criteria-v0" }), "void", "an unknown version is never honoured");
  assertEquals(criteriaFreezeState(LEGACY[14].mission), "legacy");
  assertFalse(criteriaFrozen({ criteria_contract_version: CRITERIA_CONTRACT_VERSION, criteria: [] }), "an empty array is no frozen meaning");
});

Deno.test("S3: freezing adds no field to the mission hash or the plan hash (approvals and tokens unaffected)", async () => {
  const { missionHash } = await import("../../../supabase/functions/_shared/leadMission.ts");
  const m = phrasing("M17");
  const unfrozen = { ...m } as Record<string, unknown>;
  delete unfrozen.criteria_contract_version; delete unfrozen.criteria_fingerprint;
  assertEquals(await missionHash(m as never), await missionHash(unfrozen as never));
  const { planSemantics } = await import("../../../supabase/functions/_shared/leadPipeline/strategy.ts");
  assertEquals(JSON.stringify(planSemantics(specFromMission(m as never, { defaultCount: 5 }))),
    JSON.stringify(planSemantics(specFromMission(unfrozen as never, { defaultCount: 5 }))));
});

Deno.test("ORION: the role vocabulary comes from the hiring CRITERION, exclusions included", () => {
  const m = phrasing("M07"); // AEs but not SDRs
  const v = buildQualificationContext(m as never, { criteriaAuthority: true }).role_vocabulary;
  assertEquals(v.from, "criteria");
  assert(v.required_titles.some((t) => /account executive/.test(t)));
  assert((v.excluded_titles ?? []).some((t) => /sdr/.test(t)), "an excluded role reaches ORION");
  assertFalse(v.required_titles.some((t) => /^sdrs?$/.test(t)), "never as a required title");
  // A role stated only in a constraint still reaches ORION (S0: roles_missing_from_orion_vocabulary).
  const c = phrasing("M01", "9fee47ba: role only as hard 'hiring_status' (fixed #219)");
  assert(buildQualificationContext(c as never, { criteriaAuthority: true }).role_vocabulary.required_titles.some((t) => /sales/.test(t)));
});

Deno.test("matcher: an excluded role never satisfies — on the family branch too (it used to be ignored there)", () => {
  const families = { roleTerms: ["salespeople"], roleFamilies: ["gtm_sales"], excludedRoleTerms: ["SDRs"] };
  const m = hiringTitleMatcher(families);
  assert(m("Account Executive"));
  assertFalse(m("Sales Development Representative"), "excluded by its registered title");
  assertFalse(m("SDR, EMEA"));
  const named = hiringTitleMatcher({ roleTerms: ["Account Executives"], roleFamilies: ["gtm_sales"], excludedRoleTerms: [] });
  assert(named("Senior Account Executive"));
  assertFalse(named("Account Manager"), "a named title is matched as that title");
  const vocab = hiringTitleMatcher({ roleTerms: [], roleFamilies: [], excludedRoleTerms: ["intern"] }, ["growth"]);
  assert(vocab("Growth Lead"));
  assertFalse(vocab("Growth Intern"), "the vocabulary branch honours exclusions too");
});

Deno.test("hiringRequirementOf: the requirement as the criteria state it", () => {
  const r = hiringRequirementOf(criteriaOf(phrasing("M05")) as MissionCriterion[])!;
  assertEquals(r.hard, true);
  assertEquals(r.roleMatch, "any");
  assertEquals(r.roleTerms.length, 2);
});

Deno.test("planner: an either/or group is ONE requirement, met when any member can be proven", () => {
  const m = phrasing("M08"); // raised funding OR hiring sales roles
  const crit = criteriaOf(m as never);
  assertEquals(signalAlternativesOf(crit), [["funding", "hiring"]]);
  const spec = specFromMission(m as never, { defaultCount: 5 });
  assertEquals(spec.signalAlternatives, [["funding", "hiring"]]);
  const plan = planStrategy(spec, {
    providers: { apify: { enabled: true, connected: true, authorized: true } },
    budget: { maxLeadoceanRecords: 0, maxApifyUsd: 1 }, user: { strategy: "apify_only" },
  } as never);
  const text = JSON.stringify(plan);
  assertFalse(/funding signal[^"]*: no step of/.test(text), "the funding branch alone is not an unprovable hard requirement");
  // AND stays two requirements (M18): funding is then hard on its own.
  const and = specFromMission(phrasing("M18") as never, { defaultCount: 5 });
  assertEquals(and.signalAlternatives, []);
  assert(and.signals.find((s) => s.kind === "funding")?.hard);
});

Deno.test("planner: a ranking-only signal the planner does not model is never made hard by an unrelated criterion", () => {
  const m = LEGACY[17].mission; // hard industry + geography, product_launch as a target
  const spec = specFromMission(m, { defaultCount: 5 });
  const crit = criteriaOf(m);
  assertEquals(crit.find((c) => c.dimension === "product_launch")?.kind, "target");
  assertFalse(spec.signals.some((s) => s.hard), "product_launch ranks; it was hard because 'industry' is also kind 'other'");
});

Deno.test("S3: pilot-chat freezes the APPROVED mission — after the Brain merge, with the card's criteria", () => {
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const at = src.indexOf("return freezeCriteria({");
  assert(at > 0, "the mission pilot-chat returns is frozen");
  const body = src.slice(at, src.indexOf("\n  });\n}", at));
  assert(body.includes("...merged.mission,"), "frozen after the Company Brain merge");
  assert(body.includes("criteria: deriveMissionCriteria(merged.mission, readiness),"), "with the criteria the card shows");
  // run-agent reports which meaning it executes.
  const run = Deno.readTextFileSync(new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  assert(run.includes("freeze: criteriaFreezeState(persistedMission)"));
});
