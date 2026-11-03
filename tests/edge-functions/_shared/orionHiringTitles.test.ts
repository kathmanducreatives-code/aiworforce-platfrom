// ORION's verified-hiring evidence carries its postings' titles (ATLAS review D1).
//
// leadCapabilityEngine derives `hiring: true` from a `hiring_verified` assessment and
// cited only the posting URLs. Qualification re-checks a NAMED title against posting
// titles, so without them every such company stayed pending for "hiring Account
// Executives". The engine now records each posting as the `job` item discovery already
// emits. Real stored production companies (run-1e52d43c lineage), restored by the
// production `restoreWorkingSet`, judged through ORION's own evidence path.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { type EngineCompany, missionCandidatesFrom, restoreWorkingSet } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import type { MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";

const NOW = new Date("2026-10-01T00:00:00Z");
const records = JSON.parse(await Deno.readTextFile(new URL("../../fixtures/lead-v2/run-1e52d43c/lineage.json", import.meta.url)))
  .current_state.lead_resume_checkpoint.companies;

const hiringCriterion = (qualifier: Record<string, unknown>): MissionCriterion => ({
  id: "hiring:test", kind: "hard", dimension: "hiring", value: { event: "hiring", subject: "company", qualifier },
  label: "Hiring", source: "user_explicit", user_phrase: "hiring", rationale: "test", status: "ok",
} as unknown as MissionCriterion);
const AE = hiringCriterion({ role_terms: ["account executives"], role_families: ["gtm_sales"] });
const GROWTH = hiringCriterion({ role_terms: ["growth marketers"], role_families: ["marketing_growth"] });

function judge(mutate: (c: EngineCompany) => void, criterion: MissionCriterion) {
  const cos = restoreWorkingSet(structuredClone(records));
  const c = cos.find((x) => String(x.key).includes("safetykit"))!;
  assert(c, "the stored SafetyKit company is in the fixture");
  assertEquals(c.hiring_assessment?.verdict, "hiring_verified", "it carries ORION's verified-hiring verdict");
  mutate(c);
  const cand = missionCandidatesFrom({ companies: [c] }, { missionId: "t", now: NOW })[0];
  return evaluateEligibility([criterion], cand.graph).checks.find((k) => k.dimension === "hiring")!;
}

Deno.test("ORION: the stored verified postings' titles reach qualification (with their URLs as provenance)", () => {
  const cos = restoreWorkingSet(structuredClone(records));
  const c = cos.find((x) => String(x.key).includes("safetykit"))!;
  const g = missionCandidatesFrom({ companies: [c] }, { missionId: "t", now: NOW })[0].graph;
  const jobs = g.claims.find((x) => x.dimension === "job");
  assert(jobs, "a job claim is recorded for the verified postings");
  const all = [jobs.current, ...jobs.supporting].filter(Boolean);
  assert(all.some((e) => (e!.value as { title?: string }).title === "Growth Lead"));
  assert(all.every((e) => e!.source.actor === "deterministic_verdict" && (e!.derived_from.length > 0 || e!.source.url)), "each title keeps its posting provenance");
});

Deno.test("ORION: a growth-family mission is unchanged — its verified 'Growth Lead' still passes", () => {
  assertEquals(judge(() => {}, GROWTH).result, "pass");
});

Deno.test("ORION: an Account Executive mission is NOT satisfied by a verified 'Growth Lead' opening", () => {
  const k = judge(() => {}, AE);
  assertEquals(k.result, "unknown");
  assert(/none is account executives/.test(k.reason), k.reason);
});

Deno.test("ORION: a verified AE opening now passes an Account Executive mission (it stayed pending without titles)", () => {
  const k = judge((c) => { c.hiring_jobs = [{ ...c.hiring_jobs[0], title: "Senior Account Executive" }]; }, AE);
  assertEquals(k.result, "pass", k.reason);
});

Deno.test("ORION: SDR / BDR / Sales Representative openings never satisfy an exact Account Executive mission", () => {
  for (const t of ["SDR", "BDR", "Sales Representative"]) {
    const k = judge((c) => { c.hiring_jobs = [{ ...c.hiring_jobs[0], title: t }]; }, AE);
    assertEquals(k.result, "unknown", t);
  }
});

Deno.test("ORION: a verified opening with no recorded title stays pending for an exact title (never pass)", () => {
  const k = judge((c) => { c.hiring_jobs = [{ ...c.hiring_jobs[0], title: null }]; }, AE);
  assertEquals(k.result, "unknown");
  assert(/without its title/.test(k.reason), k.reason);
});
