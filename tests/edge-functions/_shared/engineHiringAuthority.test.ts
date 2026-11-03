// R7 (mission reliability S2): ORION's derived `hiring: proven` must earn its authority.
//
// leadCapabilityEngine turned a `hiring_verified` verdict straight into `proven` — the
// one evidence producer that bypassed `authorityForEvidence`. The verdict's postings now
// go through the same `job_evidence` rule as every other producer, keyed by each
// posting's own source. Real stored production company (run-1e52d43c lineage).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { companyEvidenceItems, type EngineCompany, jobAuthoritySource, missionCandidatesFrom, restoreWorkingSet } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import type { MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";

const NOW = new Date("2026-10-01T00:00:00Z");
const records = JSON.parse(await Deno.readTextFile(new URL("../../fixtures/lead-v2/run-1e52d43c/lineage.json", import.meta.url)))
  .current_state.lead_resume_checkpoint.companies;
const HIRING = {
  id: "hiring:test", kind: "hard", dimension: "hiring", value: { event: "hiring", subject: "company", qualifier: { role_families: ["marketing_growth"] } },
  label: "Hiring", source: "user_explicit", user_phrase: "hiring", rationale: "test", status: "ok",
} as unknown as MissionCriterion;

function company(mutate: (c: EngineCompany) => void = () => {}): EngineCompany {
  const c = restoreWorkingSet(structuredClone(records)).find((x) => String(x.key).includes("safetykit"))!;
  assertEquals(c.hiring_assessment?.verdict, "hiring_verified");
  mutate(c);
  return c;
}
const hiringItem = (c: EngineCompany) => companyEvidenceItems(c, "t").find((e) => e.evidence_id === `drv_${c.key}_hiring`)!;
const check = (c: EngineCompany) =>
  evaluateEligibility([HIRING], missionCandidatesFrom({ companies: [c] }, { missionId: "t", now: NOW })[0].graph).checks.find((k) => k.dimension === "hiring")!;

Deno.test("R7: a verdict on real job-search postings is proven, WITH the authority record that says why", () => {
  const c = company();
  const item = hiringItem(c);
  assertEquals(item.status, "proven");
  assertEquals(item.authority?.rule, "job_evidence");
  assertEquals(check(c).result, "pass");
});

Deno.test("R7 negative: the same verdict on postings from a source that cannot prove a job is NOT proof", () => {
  const c = company((x) => { x.hiring_jobs = x.hiring_jobs.map((j) => ({ ...j, source: "linkedin_company_profile" })); });
  const item = hiringItem(c);
  assertEquals(item.status, "plausible", "a verdict is not authority");
  assert(item.authority && item.authority.level !== "proven");
  assert(check(c).result !== "pass", "missing authority can never qualify a company");
  // Each posting carries its own authority too.
  const jobs = companyEvidenceItems(c, "t").filter((e) => e.dimension === "job");
  assert(jobs.length > 0 && jobs.every((j) => j.status === "plausible"));
});

Deno.test("R7: posting sources map to the authority layer's route keys; an unknown source maps to itself", () => {
  assertEquals(jobAuthoritySource("harvestapi/linkedin-job-search"), "apify_linkedin_job_search");
  assertEquals(jobAuthoritySource("apify_linkedin_job_search"), "apify_linkedin_job_search");
  assertEquals(jobAuthoritySource("something_else"), "something_else");
});
