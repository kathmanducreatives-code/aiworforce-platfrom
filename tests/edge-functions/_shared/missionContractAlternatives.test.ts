// PHASE A — ALTERNATIVES AND PLACES MEAN WHAT THE USER SAID (V5 validation 2026-11-20).
//
//   "HQ in Texas or Ohio", "manufacturers or distributors" compiled as ANDed hard criteria
//   (a Texas manufacturer rejected as "outside Ohio"), and a state the model put in the
//   country slot vanished with no question (the search ran worldwide). The contract now
//   forms any-of groups from the user's own joining words, keeps a named place, and asks
//   about a place it cannot match. These cases are request SHAPES, not single keywords.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { contractFromProposal } from "../../../supabase/functions/_shared/missionContract/interpret.ts";
import { compileContract } from "../../../supabase/functions/_shared/missionContract/compile.ts";
import { contractProblems, type MissionContract } from "../../../supabase/functions/_shared/missionContract/contract.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";

type Place = { span: string; place: string | null; other_place: string | null; scope: "headquarters" | "presence"; necessity: "required" | "preferred" | "excluded" };
const hq = (span: string, necessity: Place["necessity"] = "required"): Place => ({ span, place: null, other_place: span, scope: "headquarters", necessity });
const at = (span: string): Place => ({ span, place: null, other_place: span, scope: "presence", necessity: "required" });
const ind = (span: string, industry = span, necessity = "required") => ({ span, industry, necessity });
const read = (query: string, u: Record<string, unknown>): MissionContract => contractFromProposal(query, {
  understanding: { roles: [], role_match: "any", places: [], industries: [], signals: [], signal_logic: "all", ambiguities: [], unsupported: [], ...u },
  signal_windows: [], deliverable: { entity: "company", count: 5, count_span: "5", person_roles: [] }, company_size: null, funding_stages: [], forbid_broadening: [],
} as never).contract;
const groupOf = (c: MissionContract, prefix: string) => c.anyOf.find((g) => g.every((id) => id.startsWith(prefix))) ?? null;

Deno.test("headquarters alternatives are ONE group, whether joined by 'or' or 'and' (a company has one HQ)", () => {
  for (const q of ["Find 5 companies headquartered in Texas or Ohio.", "Find 5 companies headquartered in Texas and Ohio.", "Find 5 companies headquartered in Texas, Ohio or Georgia."]) {
    const places = q.includes("Georgia") ? [hq("Texas"), hq("Ohio"), hq("Georgia")] : [hq("Texas"), hq("Ohio")];
    const c = read(q, { places });
    assertEquals(groupOf(c, "geography:")?.length, places.length, q);
    assertEquals(c.requirements.find((r) => r.id === "geography:texas")!.alternatives, places.map((p) => p.span), q);
    assertEquals(contractProblems(c), [], q);
  }
});

Deno.test("presence: 'offices in Austin and Denver' requires both; 'Austin or Denver' is either", () => {
  assertEquals(groupOf(read("Find 5 companies with offices in Austin and Denver.", { places: [at("Austin"), at("Denver")] }), "geography:"), null);
  assertEquals(groupOf(read("Find 5 companies with offices in Austin or Denver.", { places: [at("Austin"), at("Denver")] }), "geography:")?.length, 2);
});

Deno.test("industries: 'or', commas and 'and' are alternatives; 'both … and' is a genuine AND", () => {
  const two = [ind("manufacturers", "manufacturing"), ind("industrial distributors", "industrial distribution")];
  for (const q of ["Find 5 manufacturers or industrial distributors.", "Find 5 manufacturers and industrial distributors."]) {
    assertEquals(groupOf(read(q, { industries: two }), "industry:")?.length, 2, q);
  }
  const four = [ind("commercial contracting"), ind("industrial distribution"), ind("commercial field services"), ind("manufacturing")];
  assertEquals(groupOf(read("Find 5 companies in commercial contracting, industrial distribution, commercial field services or manufacturing.", { industries: four }), "industry:")?.length, 4);
  assertEquals(groupOf(read("Find 5 companies that are both fintech and healthcare.", { industries: [ind("fintech"), ind("healthcare")] }), "industry:"), null);
});

Deno.test("never grouped: B2B with an industry, exclusions, preferences", () => {
  const b2b = read("Find 5 B2B manufacturers. Companies must be B2B.", { industries: [ind("Companies must be B2B", "B2B"), ind("manufacturers", "manufacturing")] });
  assertEquals(b2b.anyOf, []);
  const excl = read("Find 5 companies headquartered in Texas, not in Ohio.", { places: [hq("Texas"), { ...hq("Ohio"), necessity: "excluded" }] });
  assertEquals(excl.anyOf, []);
  const pref = read("Find 5 companies headquartered in Texas, ideally Austin.", { places: [hq("Texas"), hq("Austin", "preferred")] });
  assertEquals(pref.anyOf, []);
});

Deno.test("a state the model put in the COUNTRY slot is kept as the user's named place — never dropped", () => {
  const c = read("Find 5 companies headquartered in Texas.", { places: [{ span: "Texas", place: "texas", other_place: null, scope: "headquarters", necessity: "required" }] });
  assertEquals(c.requirements.filter((r) => r.dimension === "geography").map((r) => r.id), ["geography:texas"]);
  assertEquals(c.ambiguities, []);
});

Deno.test("a place it cannot match becomes a QUESTION that blocks approval — never a worldwide search", () => {
  const c = read("Find 5 companies headquartered in the Bay Area.", { places: [{ span: "the Bay Area", place: "sf_bay_area", other_place: null, scope: "headquarters", necessity: "required" }] });
  assertEquals(c.requirements.filter((r) => r.dimension === "geography"), []);
  assertEquals(c.ambiguities.length, 1);
  assert(c.ambiguities[0].question.includes("Which place"), c.ambiguities[0].question);
});

Deno.test("end to end: a Texas HQ satisfies 'Texas or Ohio'; a California HQ fails it", async () => {
  const c = read("Find 5 companies headquartered in Texas or Ohio.", { places: [hq("Texas"), hq("Ohio")] });
  const m = await compileContract(c) as { criteria: unknown[] };
  // The same evidence shape the Lead V2 quality suite uses (a proven, HQ-flagged company record).
  const geo = (text: string) => ({
    evidence_id: `q_co_geography_${text}`, company_key: "co", dimension: "geography", value: text, status: "proven",
    source: { provider: "apify", actor: "apify_linkedin_company_details", provider_call_id: "pc_co", url: null, excerpt: null },
    method: "provider_field", observed_at: new Date().toISOString(), valid_until: null, confidence: "high", derived_from: [],
    mission_id: null, origin: "lead_mission",
    authority: { version: "evidence-authority-v1", claim: "headquarters", level: "proven", rule: "li_record_flagged_headquarters", reason: "flagged" },
  });
  const verdict = (text: string) => evaluateEligibility(m.criteria as never, buildCompanyEvidenceGraph("co", [geo(text)] as never)).hard_checks.geography;
  assertEquals(verdict("Houston, Texas, United States"), "pass");
  assertEquals(verdict("Columbus, Ohio, United States"), "pass");
  assertEquals(verdict("Fresno, California, United States"), "fail");
});
