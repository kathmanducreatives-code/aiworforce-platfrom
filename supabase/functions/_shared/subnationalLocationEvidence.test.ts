// SUBNATIONAL LOCATION EVIDENCE — the gate that rejected 20 genuine US jobs.
//
// Production task bb1ce7fe asked for SaaS startups hiring Sales Operations in
// the United States. The jobs actor returned exactly that, with locations like
// "Dallas, TX" and "San Francisco Bay Area". The country detector knew country
// names and country codes only, so every one resolved to NO country evidence and
// was rejected as `missing location evidence`. Zero companies reached
// enrichment, so no founder was ever searched for.
//
// A US state IS country evidence. These tests pin that, and pin the two things
// that must NOT change: a wrong country is still rejected, and an ambiguous or
// unstructured token is still refused rather than guessed.
//
// PURE. No provider, model, network or database access.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  matchesRequiredLocation,
  matchesRequiredLocationFromFields,
  detectCountryFromRegionText,
  normalizeRegionToken,
} from "./locationMatch.ts";

/** A job candidate as the jobs pipeline actually shapes it: text only. */
const job = (location: string) => ({ location });

const US = "United States";

// ============================================== the production false negatives ===

Deno.test("L1 US city/state job locations are US evidence", () => {
  for (const loc of [
    "Dallas, TX",
    "San Francisco, CA",
    "Austin, Texas",
    "Washington, DC",
    "San Francisco Bay Area",
    "Remote, US",
    "Remote - United States",
    "New York, NY",
    "Seattle, Washington",
    "Atlanta, GA",
  ]) {
    const m = matchesRequiredLocationFromFields(job(loc), US);
    assertEquals(m.ok, true, `${loc} should satisfy United States (reason: ${m.reason})`);
  }
});

Deno.test("L2 the evidence mode is reported for diagnostics", () => {
  assertEquals(matchesRequiredLocationFromFields(job("Dallas, TX"), US).mode, "city_region_text");
  assertEquals(matchesRequiredLocationFromFields(job("Remote - United States"), US).mode, "country_text");
  assertEquals(
    matchesRequiredLocation({ text: "Dallas", country_code: "US" }, US).mode,
    "structured_country",
  );
  assertEquals(matchesRequiredLocation({ region: "TX" }, US).mode, "structured_region");
  const miss = matchesRequiredLocationFromFields(job("Somewhere"), US);
  assertEquals(miss.mode, "unresolved");
  assertEquals(miss.normalized_country, null);
});

// ================================================ other countries still resolve ===

Deno.test("L3 Canada, the UK and Australia resolve to themselves", () => {
  const cases: Array<[string, string]> = [
    ["Toronto, ON", "Canada"], ["Vancouver, BC", "Canada"], ["Toronto, Ontario", "Canada"],
    ["London, UK", "United Kingdom"], ["Manchester, England", "United Kingdom"],
    ["Sydney, NSW", "Australia"], ["Melbourne, Victoria", "Australia"],
  ];
  for (const [loc, required] of cases) {
    const m = matchesRequiredLocationFromFields(job(loc), required);
    assertEquals(m.ok, true, `${loc} should satisfy ${required} (reason: ${m.reason})`);
  }
});

// ============================================ wrong country is STILL a rejection ===

Deno.test("L4 a resolved but WRONG country is rejected, never accepted", () => {
  const cases: Array<[string, string]> = [
    ["Toronto, ON", US], ["Vancouver, BC", US], ["London, England", US],
    ["Sydney, NSW", US], ["London, Ontario", "United Kingdom"], ["Dallas, TX", "Canada"],
  ];
  for (const [loc, required] of cases) {
    const m = matchesRequiredLocationFromFields(job(loc), required);
    assertEquals(m.ok, false, `${loc} must not satisfy ${required}`);
    assertEquals(m.reason, "wrong country", `${loc} vs ${required}`);
  }
});

Deno.test("L5 San Francisco, CA is the US state — not Canada", () => {
  assertEquals(matchesRequiredLocationFromFields(job("San Francisco, CA"), US).ok, true);
  assertEquals(matchesRequiredLocationFromFields(job("San Francisco, CA"), "Canada").ok, false);
});

// ================================================== ambiguity is refused, not guessed ===

Deno.test("L6 a bare region token is NOT geography", () => {
  for (const text of ["CA", "TX", "ON", "WA"]) {
    assertEquals(detectCountryFromRegionText(text), null, `bare ${text} must not resolve`);
  }
});

Deno.test("L7 region-shaped tokens in prose are not geography", () => {
  for (const text of [
    "Account Executive, CA market",
    "Senior Manager, US GAAP reporting",
    "Engineer, ON call rotation",
    "Director of Sales, TX and surrounding territory",
  ]) {
    assertEquals(detectCountryFromRegionText(text), null, `must not infer from: ${text}`);
  }
});

Deno.test("L8b a US state whose NAME is also a country resolves only by code", () => {
  // Georgia is a sovereign country as well as a US state. The name must not
  // resolve; the unambiguous code still does.
  assertEquals(detectCountryFromRegionText("Tbilisi, Georgia"), null);
  assertEquals(detectCountryFromRegionText("Atlanta, GA"), "US");
  assertEquals(matchesRequiredLocationFromFields(job("Tbilisi, Georgia"), US).ok, false);
  assertEquals(matchesRequiredLocationFromFields(job("Atlanta, GA"), US).ok, true);
});

Deno.test("L8 codes claimed by two countries are refused", () => {
  // WA = Washington and Western Australia; NT = Northwest Territories and
  // Northern Territory; SA reads far more widely as South Africa.
  for (const code of ["WA", "NT", "SA"]) {
    assertEquals(normalizeRegionToken(code), null, `${code} is ambiguous and must not resolve`);
  }
  // The full names remain unambiguous.
  assertEquals(normalizeRegionToken("Washington"), "US");
  assertEquals(normalizeRegionToken("Western Australia"), "AU");
  assertEquals(normalizeRegionToken("Northern Territory"), "AU");
});

Deno.test("L9 blank and malformed locations stay honest", () => {
  for (const loc of ["", "   ", ",", ", ,", "—", "Remote"]) {
    const m = matchesRequiredLocationFromFields(job(loc), US);
    assertEquals(m.ok, false, `${JSON.stringify(loc)} must not pass`);
    assertEquals(m.reason, "missing location evidence", JSON.stringify(loc));
  }
});

Deno.test("L10 a company name containing a location-like tail is not geography", () => {
  assertEquals(detectCountryFromRegionText("Acme, Inc"), null);
  assertEquals(detectCountryFromRegionText("Widgets, LLC"), null);
  assertEquals(detectCountryFromRegionText("Delta, Co"), null);
});

// ===================================================== documented precedence ===

Deno.test("L11 a structured country BEATS an inferred region", () => {
  // The provider says Canada; the text reads "San Francisco, CA". Structured
  // country wins, so this is Canadian and fails a US requirement.
  const cand = { text: "San Francisco, CA", country_code: "CA" };
  const m = matchesRequiredLocation(cand, US);
  assertEquals(m.ok, false);
  assertEquals(m.reason, "wrong country");
  assertEquals(m.mode, "structured_country");
  assertEquals(m.evidence_source, "country_code");
  assertEquals(matchesRequiredLocation(cand, "Canada").ok, true);
});

Deno.test("L12 a structured region is used when no structured country exists", () => {
  const m = matchesRequiredLocation({ text: "Somewhere", region: "TX" }, US);
  assertEquals(m.ok, true);
  assertEquals(m.mode, "structured_region");
});

Deno.test("L13 an empty requirement still imposes nothing", () => {
  assertEquals(matchesRequiredLocationFromFields(job("Toronto, ON"), "").ok, true);
  assertEquals(matchesRequiredLocationFromFields(job(""), null).ok, true);
});
