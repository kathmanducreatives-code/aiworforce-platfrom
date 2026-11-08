// Capability resolution (MRLE Phase 0): every REQUIRED criterion needs a step that proves its
// DIMENSION — decided by dimension and capability, never by the words of the request.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { proofNeeded, resolveRequirementRoutes, uncheckedQuestion, uncheckedRequired, type ProofDimension } from "../../../../supabase/functions/_shared/leadPipeline/capabilityResolution.ts";
import type { MissionCriterion } from "../../../../supabase/functions/_shared/missionCriteria.ts";

const crit = (o: Partial<MissionCriterion> & Record<string, unknown>): MissionCriterion =>
  ({ id: `${o.dimension}:${Math.random().toString(36).slice(2, 7)}`, kind: "hard", label: String(o.dimension), status: "ok", value: null, ...o }) as never;
const proves = (m: Partial<Record<ProofDimension, string[]>>) => new Map(Object.entries(m)) as Map<ProofDimension, string[]>;
const APIFY = proves({ identity: ["jobs", "record"], headquarters: ["record"], size_band: ["record"], hiring: ["jobs"] });

Deno.test("each dimension needs its own proof; unknown kinds need one no capability offers", () => {
  assertEquals(proofNeeded(crit({ dimension: "geography", geography_scope: "headquarters" }) as never), ["headquarters"]);
  assertEquals(proofNeeded(crit({ dimension: "geography", geography_scope: "presence" }) as never), ["presence"]);
  assertEquals(proofNeeded(crit({ dimension: "company_size" }) as never), ["size_band"]);
  assertEquals(proofNeeded(crit({ dimension: "business_model" }) as never), ["business_model"]);
  assertEquals(proofNeeded(crit({ dimension: "funding" }) as never), ["funding"]);
  assertEquals(proofNeeded(crit({ dimension: "exclusion", value: { field: "excluded_geographies", value: ["Canada"] } }) as never), ["headquarters"]);
  assertEquals(proofNeeded(crit({ dimension: "exclusion", value: { field: "excluded_company_types", value: ["staffing"] } }) as never), ["industry"]);
  for (const d of ["product_launch", "leadership_change", "technology", "constraint", "unrecognised_signal"]) assertEquals(proofNeeded(crit({ dimension: d }) as never), [], d);
  // A criterion the compiler itself marked unprovable needs a proof nothing can give.
  assertEquals(proofNeeded(crit({ dimension: "industry", status: "unprovable_today" }) as never), []);
});

Deno.test("REQUIRED and unproven → not_checkable with an explanation; the same as a preference → ranked_only", () => {
  for (const dim of ["business_model", "industry", "funding", "company_stage", "product_launch"]) {
    const [hard] = resolveRequirementRoutes([crit({ dimension: dim, label: `X ${dim}` })], APIFY);
    assertEquals(hard.route, "not_checkable", dim);
    assert(hard.explanation.startsWith("required, but"), hard.explanation);
    assert(uncheckedQuestion(hard).includes("review-only"));
    const [soft] = resolveRequirementRoutes([crit({ dimension: dim, kind: "target" })], APIFY);
    assertEquals(soft.route, "ranked_only", `${dim} preference never blocks`);
  }
});

Deno.test("a capability that proves the dimension makes it checked — whatever the value says", () => {
  const withSite = proves({ ...Object.fromEntries(APIFY), business_model: ["website"] });
  for (const value of ["B2B", "B2C", "D2C", "marketplace", "wholesale distributor"]) {
    const [r] = resolveRequirementRoutes([crit({ dimension: "business_model", value })], withSite);
    assertEquals([r.route, r.checkedBy], ["checked", ["website"]], value);
  }
  const rs = resolveRequirementRoutes([crit({ dimension: "geography", geography_scope: "headquarters" }), crit({ dimension: "hiring" }), crit({ dimension: "company_size" })], APIFY);
  assertEquals(uncheckedRequired(rs), []);
});

Deno.test("an any-of group is one requirement: checked when any alternative is", () => {
  const a = crit({ dimension: "hiring", any_of: ["signal:hiring", "signal:funding"] });
  const b = crit({ dimension: "funding", any_of: ["signal:hiring", "signal:funding"] });
  const rs = resolveRequirementRoutes([a, b], APIFY);
  assertEquals(rs.map((r) => r.route), ["checked", "checked"]);
  // Neither alternative provable: the whole group is unchecked.
  const none = resolveRequirementRoutes([crit({ dimension: "funding", any_of: ["x", "y"] }), crit({ dimension: "technology", any_of: ["x", "y"] })], APIFY);
  assertEquals(uncheckedRequired(none).length, 2);
});

// Regression (benchmark C2): "operating in the US" is a PRESENCE requirement. The LinkedIn
// company record proves it from its structured office list (candidateObservation
// `geography_presence`), exactly as it proves HQ. The registry once omitted `presence`, so
// every presence request was blocked as uncheckable although the engine qualified on it.
Deno.test("the real registry: the company record proves presence, so an Apify chain checks 'operates in the US'", async () => {
  const { DISCOVERY_CAPABILITIES } = await import("../../../../supabase/functions/_shared/leadPipeline/strategy.ts");
  const record = DISCOVERY_CAPABILITIES["apify.linkedin_company_record"];
  assert((record.proves as string[]).includes("presence"));
  const chain = [DISCOVERY_CAPABILITIES["apify.linkedin_job_search"], record];
  const real = new Map<ProofDimension, string[]>();
  for (const c of chain) for (const d of c.proves) real.set(d as ProofDimension, [...(real.get(d as ProofDimension) ?? []), c.id]);
  const [r] = resolveRequirementRoutes([crit({ dimension: "geography", geography_scope: "presence" })], real);
  assertEquals([r.route, r.checkedBy], ["checked", ["apify.linkedin_company_record"]]);
  // No discovery row proves presence on its own: a job search alone leaves it unchecked.
  const jobsOnly = new Map<ProofDimension, string[]>([["identity", ["jobs"]], ["hiring", ["jobs"]]]);
  assertEquals(resolveRequirementRoutes([crit({ dimension: "geography", geography_scope: "presence" })], jobsOnly)[0].route, "not_checkable");
});
