import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildQualificationObservability,
  buildQualificationFunnel,
  buildSourceGateDiagnostic,
} from "./qualificationObservability.ts";
import { classifyGeography, matchTypedGeography, resolveGeographyConstraint } from "./geographyConstraint.ts";

// ---- Section 6: live v81 failure replay (country intent, US profiles) ----
// Five genuine US people from DIFFERENT cities, structured country present.
const US_PEOPLE = [
  { name: "A", city: "New York", region: "NY", text: "New York, NY", country: "United States", country_code: "US" },
  { name: "B", city: "Philadelphia", region: "PA", text: "Greater Philadelphia", country: "United States", country_code: "US" },
  { name: "C", city: "San Francisco", region: "CA", text: "San Francisco Bay Area", country: "United States", country_code: "US" },
  { name: "D", city: "Austin", region: "TX", text: "Austin, Texas", country: "United States", country_code: "US" },
  { name: "E", city: "Boston", region: "MA", text: "Greater Boston", country: "United States", country_code: "US" },
];
const CANADA = { name: "Z", city: "Toronto", region: "ON", text: "Toronto, ON", country: "Canada", country_code: "CA" };

const countryUS = classifyGeography("United States");

Deno.test("replay: US country request accepts all differing-city US profiles", () => {
  for (const p of US_PEOPLE) {
    assertEquals(matchTypedGeography(p, countryUS).ok, true, `${p.name} (${p.text}) should pass US`);
  }
});
Deno.test("replay: genuine non-US profile still rejected (wrong country)", () => {
  const r = matchTypedGeography(CANADA, countryUS);
  assertEquals(r.ok, false);
  assertEquals(r.reason, "wrong country");
});

// ---- (15) normalized_count reports pre-source-gate normalized candidates ----
Deno.test("15: normalized_count reflects all normalized candidates, not source-accepted", () => {
  // v81 shape: 5 normalized, 0 source-accepted, 5 source-rejected.
  const f = buildQualificationFunnel({
    raw_count: 5, normalized_count: 5, source_gate_accepted: 0, source_gate_rejected: 5,
    hard_gate_rejected: 0, qualification_accepted: 0, qualification_staged: 0, qualification_rejected: 0,
    persisted_count: 0, downstream_aria_count: 0,
  });
  assertEquals(f.normalized_count, 5);
  assertEquals(f.source_gate_accepted, 0);
  assertEquals(f.source_gate_rejected, 5);
  assertEquals(f.reconciles, true); // 5 == 0 + 5
});

// ---- (16) source_gate_rejected count is authoritative + reconciles ----
Deno.test("16: funnel reconciles with source-gate rejections; mismatch flagged", () => {
  const bad = buildQualificationFunnel({
    raw_count: 5, normalized_count: 5, source_gate_accepted: 0, source_gate_rejected: 4, // 5 != 0+4
    hard_gate_rejected: 0, qualification_accepted: 0, qualification_staged: 0, qualification_rejected: 0,
    persisted_count: 0, downstream_aria_count: 0,
  });
  assertEquals(bad.reconciles, false);
});

// ---- (17) source-rejected candidate diagnostics are included ----
Deno.test("17: source-gate rejected diagnostics surface in observability", () => {
  const obs = buildQualificationObservability({
    funnel: { raw_count: 5, normalized_count: 5, source_gate_accepted: 0, source_gate_rejected: 5, hard_gate_rejected: 0, qualification_accepted: 0, qualification_staged: 0, qualification_rejected: 0, persisted_count: 0, downstream_aria_count: 0 },
    candidates: [],
    source_gate_rejected: US_PEOPLE.map((p) => ({
      name: p.name, company: "Co", source_url: `https://www.linkedin.com/in/${p.name}`,
      provider_verified: true, actor_key: "apify_people_search", actor_id: "harvestapi/linkedin-profile-search", artifact_type: "person_candidate",
      requested_geography_value: "United States", requested_geography_type: "country", requested_country_code: "US",
      candidate_location_text: p.text, candidate_country: p.country, candidate_country_code: p.country_code, candidate_region: p.region, candidate_city: p.city,
      matcher_mode: "country", source_gate_reason: "wrong city/region (strict)", source_gate_reason_code: "wrong_city_region",
    })),
    requested_limit: 5, target_entity: "person", expected_artifact_type: "person_candidate",
  });
  assertEquals(obs.source_gate_rejected.length, 5);
  assertEquals(obs.candidates.length, 0);
  for (const d of obs.source_gate_rejected) {
    assertEquals(d.source_gate_decision, "reject");
    assertEquals(d.reached_qualification, false); // (20) cannot reach qualification
    assertEquals(d.persisted, false);             // (20) cannot persist
    assert(!!d.requested_geography_type && !!d.matcher_mode);
  }
});

// ---- (18) source-gate diagnostics are sanitized ----
Deno.test("18: source-gate diagnostic strips PII/secrets and public-URL only", () => {
  const d = buildSourceGateDiagnostic({
    name: "Founder", company: "Acme contact ceo@acme.com +1 415 555 9090 Bearer sk_live_ABCDEF",
    source_url: "https://user:pw@www.linkedin.com/in/x?utm=1#frag",
    provider_verified: true, source_gate_reason: "wrong country (strict)", source_gate_reason_code: "wrong_country",
    candidate_country_code: "CA",
  });
  const json = JSON.stringify(d);
  assert(!/ceo@acme\.com|555 9090|sk_live_|Bearer /.test(json), json);
  assertEquals(d.source_url, undefined); // userinfo URL dropped
  assert(!("email" in d) && !("phone" in d) && !("raw" in d));
});

// ---- (19) qualification-rejected counts remain separate from source-gate ----
Deno.test("19: source-gate and qualification rejections are separate funnel stages", () => {
  const f = buildQualificationFunnel({
    raw_count: 10, normalized_count: 10, source_gate_accepted: 5, source_gate_rejected: 5,
    hard_gate_rejected: 0, qualification_accepted: 2, qualification_staged: 3, qualification_rejected: 0,
    persisted_count: 2, downstream_aria_count: 5,
  });
  assertEquals(f.source_gate_rejected, 5);
  // Staged is its OWN bucket now: a source-gate rejection, a qualification rejection
  // and a staged candidate are three different things.
  assertEquals(f.qualification_rejected, 0);
  assertEquals(f.staged_count, 3);
  assertEquals(f.reconciles, true); // 10==5+5 and 5==0+2+3+0
});

// ---- (22) explicit city/region request keeps strict locality behavior ----
Deno.test("22: an explicit user city request stays strict (SF accepts SF, rejects NY)", () => {
  const c = resolveGeographyConstraint([
    { value: "San Francisco", source: "user_explicit" },
    { value: "United States", source: "brain" },
  ]);
  assertEquals(c.type, "city");
  assertEquals(matchTypedGeography({ text: "San Francisco Bay Area", city: "San Francisco" }, c).ok, true);
  assertEquals(matchTypedGeography({ text: "New York, NY", city: "New York" }, c).ok, false);
});
