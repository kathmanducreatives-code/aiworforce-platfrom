import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyGeography,
  resolveGeographyConstraint,
  matchTypedGeography,
} from "./geographyConstraint.ts";
import type { CandidateLocation } from "./locationMatch.ts";

const US = (over: Partial<CandidateLocation> = {}): CandidateLocation => ({ text: "Somewhere", country: "United States", country_code: "US", ...over });

// ---- classification ----
Deno.test("classify: exact + embedded country designators → country", () => {
  assertEquals(classifyGeography("United States").type, "country");
  assertEquals(classifyGeography("USA").type, "country");
  assertEquals(classifyGeography("United States (Remote)").type, "country"); // embedded — the v81 shape
  assertEquals(classifyGeography("United States").country_code, "US");
});
Deno.test("classify: US state → region; locality → city", () => {
  assertEquals(classifyGeography("California").type, "region");
  assertEquals(classifyGeography("Texas").type, "region");
  assertEquals(classifyGeography("San Francisco").type, "city");
  assertEquals(classifyGeography("Greater Philadelphia").type, "city");
});

// ---- resolver: country intent governs; explicit user locality wins ----
Deno.test("resolve: country from brain governs over diverged planner locality (v81 root cause)", () => {
  const c = resolveGeographyConstraint([
    { value: "United States (Remote)", source: "planner" }, // diverged, but still a country
    { value: "United States", source: "brain" },
    { value: "United States", source: "actor" },
  ]);
  assertEquals(c.type, "country");
  assertEquals(c.country_code, "US");
});
Deno.test("resolve: a non-country planner locality never downgrades a country intent", () => {
  const c = resolveGeographyConstraint([
    { value: "Austin", source: "planner" },     // planner-hallucinated locality
    { value: "United States", source: "brain" }, // country intent
  ]);
  assertEquals(c.type, "country"); // country governs (Section 5D)
});
Deno.test("resolve: an EXPLICIT user city request is authoritative", () => {
  const c = resolveGeographyConstraint([
    { value: "San Francisco", source: "user_explicit" },
    { value: "United States", source: "brain" },
  ]);
  assertEquals(c.type, "city");
  assertEquals(c.value, "San Francisco");
});

// ---- typed matching (Section 7 items 1-8) ----
const country = classifyGeography("United States");
Deno.test("1: US country request accepts New York profile", () => {
  assertEquals(matchTypedGeography(US({ text: "New York, NY", city: "New York", region: "NY" }), country).ok, true);
});
Deno.test("2: US country request accepts Philadelphia profile", () => {
  assertEquals(matchTypedGeography(US({ text: "Greater Philadelphia", city: "Philadelphia", region: "PA" }), country).ok, true);
});
Deno.test("3: US country request accepts California profile", () => {
  assertEquals(matchTypedGeography(US({ text: "San Francisco, California", city: "San Francisco", region: "CA" }), country).ok, true);
});
Deno.test("4: US country request rejects Canada profile", () => {
  const r = matchTypedGeography({ text: "Toronto, ON", country: "Canada", country_code: "CA", city: "Toronto", region: "ON" }, country);
  assertEquals(r.ok, false);
  assertEquals(r.reason, "wrong country");
  assertEquals(r.matcher_mode, "country");
});
const california = classifyGeography("California");
Deno.test("5: California region request accepts California profile", () => {
  assertEquals(matchTypedGeography({ text: "San Francisco, California", region: "CA", country_code: "US" }, california).ok, true);
});
Deno.test("6: California request rejects Texas profile", () => {
  const r = matchTypedGeography({ text: "Austin, Texas", region: "TX", country_code: "US" }, california);
  assertEquals(r.ok, false);
  assertEquals(r.matcher_mode, "region");
});
const sf = classifyGeography("San Francisco");
Deno.test("7: San Francisco city request accepts San Francisco", () => {
  assertEquals(matchTypedGeography({ text: "San Francisco Bay Area", city: "San Francisco" }, sf).ok, true);
});
Deno.test("8: San Francisco request rejects New York", () => {
  const r = matchTypedGeography({ text: "New York, NY", city: "New York" }, sf);
  assertEquals(r.ok, false);
  assertEquals(r.matcher_mode, "city");
});

// 11/12: structured country precedence
Deno.test("11/12: structured country code/name takes precedence over ambiguous text", () => {
  // Candidate text is a bare city, but structured country_code=US satisfies a US request.
  assertEquals(matchTypedGeography({ text: "Greater Philadelphia", country_code: "US" }, country).ok, true);
  assertEquals(matchTypedGeography({ text: "Greater Philadelphia", country: "United States" }, country).ok, true);
});

// 13: city text does not override a matching country code for a country request
Deno.test("13: a US-country request is satisfied by country evidence regardless of city text", () => {
  assertEquals(matchTypedGeography({ text: "Austin", country_code: "US" }, country).ok, true);
});

// 14: missing country evidence for a country request → missing location evidence
Deno.test("14: missing country evidence → missing location evidence (not wrong city/region)", () => {
  const r = matchTypedGeography({ text: "Remote" }, country);
  assertEquals(r.ok, false);
  assertEquals(r.reason, "missing location evidence");
});

// 9: planner prose cannot change a country constraint into a city constraint
Deno.test("9: planner prose cannot strengthen country into a city constraint", () => {
  const c = resolveGeographyConstraint([
    { value: "founders in San Francisco startups", source: "planner" }, // prose w/ a city word
    { value: "United States", source: "brain" },
  ]);
  // The country intent from the brain still governs.
  assertEquals(c.type, "country");
});
