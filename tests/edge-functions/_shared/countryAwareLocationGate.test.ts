// Provider-free validation for the country-aware location gate + attempt audit.
// Exercises the production matcher, the real accept/report gates, routing/handoff
// guards, execution-mode filter, and the audit builder. Deterministic; no provider.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeCountry,
  detectCountryInText,
  matchesRequiredLocation,
  extractCandidateLocationEvidence,
} from "../../../supabase/functions/_shared/locationMatch.ts";
import { classifyResults } from "../../../supabase/functions/_shared/sourceQuality.ts";
import { validateSourcingResults } from "../../../supabase/functions/_shared/sourcingRetry.ts";
import { resolveProviderSource } from "../../../supabase/functions/_shared/plannedToolResolver.ts";
import { buildProviderIndexFromItems, parseScoutCandidates, guardScoutToAria } from "../../../supabase/functions/_shared/leadHandoffGuard.ts";
import { filterPlanForMode, stepAllowedInMode } from "../../../supabase/functions/_shared/executionMode.ts";
import {
  buildPeopleSearchAttempts,
  parsePeopleSearchIntent,
  buildSourcingAttemptAudit,
  sanitizeActorInputForAudit,
} from "../../../supabase/functions/_shared/peopleSearchQueryBuilder.ts";
import { RAW_LOCATION_A, RAW_LOCATION_C, rawProfile } from "../../../supabase/functions/_shared/peopleLocationFixture.ts";

const cand = (country: string | null, code: string | null, text = "") => ({ text, country, country_code: code });

// 1-4: US city/region + US country evidence passes a US constraint.
Deno.test("1: Greater Philadelphia + United States passes US", () => {
  assertEquals(matchesRequiredLocation(cand("United States", "US", "Greater Philadelphia"), "United States").ok, true);
});
Deno.test("2: San Francisco Bay Area + code US passes US", () => {
  assertEquals(matchesRequiredLocation(cand(null, "US", "San Francisco Bay Area"), "United States").ok, true);
});
Deno.test("3: Greater Boston + United States passes US", () => {
  assertEquals(matchesRequiredLocation(cand("United States", null, "Greater Boston"), "United States").ok, true);
});
Deno.test("4: Austin, Texas + United States passes US", () => {
  assertEquals(matchesRequiredLocation(cand("United States", "US", "Austin, Texas"), "United States").ok, true);
});

// 5-6: wrong country fails.
Deno.test("5: Greater London + United Kingdom fails US (wrong country)", () => {
  const m = matchesRequiredLocation(cand("United Kingdom", "GB", "Greater London"), "United States");
  assertEquals(m.ok, false); assertEquals(m.reason, "wrong country");
});
Deno.test("6: Toronto + Canada fails US (wrong country)", () => {
  const m = matchesRequiredLocation(cand("Canada", "CA", "Toronto"), "United States");
  assertEquals(m.ok, false); assertEquals(m.reason, "wrong country");
});

// 7-8: Remote semantics.
Deno.test("7: 'Remote' with no parsed country fails strict US (missing evidence)", () => {
  const m = matchesRequiredLocation(cand(null, null, "Remote"), "United States");
  assertEquals(m.ok, false); assertEquals(m.reason, "missing location evidence");
});
Deno.test("8: 'Remote' with parsed country US passes the country check", () => {
  assertEquals(matchesRequiredLocation(cand(null, "US", "Remote"), "United States").ok, true);
});

// 9-10: alias normalization.
Deno.test("9: US/USA/U.S./U.S.A./United States normalize to US", () => {
  for (const v of ["US", "USA", "U.S.", "U.S.A.", "United States", "united states of america"]) assertEquals(normalizeCountry(v), "US");
});
Deno.test("10: UK/GB/United Kingdom normalize to GB", () => {
  for (const v of ["UK", "GB", "United Kingdom"]) assertEquals(normalizeCountry(v), "GB");
});

// 11-12: country match must not satisfy a specific city/region.
Deno.test("11: US country match does NOT satisfy 'New York City'", () => {
  const m = matchesRequiredLocation(cand("United States", "US", "Greater Philadelphia"), "New York City");
  assertEquals(m.ok, false); assertEquals(m.reason, "wrong city/region");
});
Deno.test("12: San Francisco Bay Area does not satisfy 'London'", () => {
  const m = matchesRequiredLocation(cand("United States", "US", "San Francisco Bay Area"), "London");
  assertEquals(m.ok, false); assertEquals(m.reason, "wrong city/region");
});

// 13-14: missing structured country fallback (safe).
Deno.test("13: missing structured country falls back to explicit 'United States' string", () => {
  assertEquals(matchesRequiredLocation(cand(null, null, "United States"), "United States").ok, true);
});
Deno.test("14: an unrecognised city with no structured country does NOT infer a country", () => {
  // `detectCountryInText` is still country-names-and-codes only — unchanged.
  assertEquals(detectCountryInText("Greater Philadelphia"), null);
  assertEquals(detectCountryInText("Houston"), null); // no false 'us' substring match
  assertEquals(detectCountryInText("Dallas, TX"), null);

  // CONTRACT NARROWED (production task bb1ce7fe): the MATCHER now also consults
  // reviewed subnational evidence, so a US state or named metro resolves on its
  // own. That is the fix — "Dallas, TX" rejected as unknown killed the whole
  // company-first funnel. A city with no reviewed geography still resolves to
  // nothing, which is what this pins.
  const unknown = matchesRequiredLocation(cand(null, null, "Springfield"), "United States");
  assertEquals(unknown.reason, "missing location evidence");
  assertEquals(matchesRequiredLocation(cand(null, null, "Greater Philadelphia"), "United States").ok, true);
});

// 15-17: provider evidence retention + provenance.
Deno.test("15: normalized candidate retains original location text", () => {
  assertEquals(extractCandidateLocationEvidence(rawProfile("A B", RAW_LOCATION_A as any, "https://x")).text, "Greater Philadelphia");
});
Deno.test("16: normalized candidate retains parsed country + country code", () => {
  const e = extractCandidateLocationEvidence(rawProfile("A B", RAW_LOCATION_A as any, "https://x"));
  assertEquals(e.country, "United States"); assertEquals(e.country_code, "US");
});
Deno.test("17: location evidence is provider-backed only (empty raw ⇒ empty evidence, no fabrication)", () => {
  assertEquals(extractCandidateLocationEvidence({}), {});
  assertEquals(extractCandidateLocationEvidence(null), {});
});

// 18-19 REMOVED in the Mission cutover. They covered `filterPeopleCandidates`
// in _shared/sourceGates.ts — the legacy source gate that ran inside run-agent's
// deleted legacy sourcing block. Country filtering on the mission path is
// enforced by the capability engine's geography constraint, covered elsewhere.

// 20: LLM identities remain blocked.
Deno.test("20: fabricated (no provider index) identities remain blocked before Aria", () => {
  const guard = guardScoutToAria(parseScoutCandidates(JSON.stringify({ candidates: [{ name: "Made Up", company: "Nowhere" }] }), null), buildProviderIndexFromItems([]));
  assertEquals(guard.shouldStop, true);
});

// 21: SQO strips outreach.
Deno.test("21: source_and_qualify_only strips Penn/draft/send/publish", () => {
  const plan = [
    { agent_slug: "scout", tool_needed: "source_with_apify", step_index: 0 },
    { agent_slug: "aria", tool_needed: "extract_structured", step_index: 1 },
    { agent_slug: "penn", tool_needed: "draft_outreach", step_index: 2 },
  ];
  assertEquals(filterPlanForMode(plan, "source_and_qualify_only").steps.map((s) => s.agent_slug), ["scout", "aria"]);
  assertEquals(stepAllowedInMode({ tool_needed: "send_email" }, "source_and_qualify_only"), false);
});

// 22: zero accepted ⇒ no_results.
Deno.test("22: all wrong-country ⇒ zero accepted (honest no_results upstream)", () => {
  const crit = { requested: 5, role: null, location: "United States", source_type: "people_profiles" };
  const strict = { location: true, industry: false, stage: false, count_exact: false };
  const items = [{ name: "L L", location: "Greater London", location_country: "United Kingdom", location_country_code: "GB", source_url: "https://linkedin.com/in/l" }];
  assertEquals(classifyResults(items, crit, strict).accepted.length, 0);
  assertEquals(validateSourcingResults(items, crit, strict).length, 0);
});

// 23-25: attempt audit.
Deno.test("23: attempt labels are exact / broadened / minimal_safe", () => {
  const a = buildPeopleSearchAttempts(parsePeopleSearchIntent("find me 5 hot founders of B2B SaaS in the United States"), { maxItems: 5 });
  assertEquals(a.map((x) => x.label), ["exact", "broadened", "minimal_safe"]);
});
Deno.test("24: sanitized payload + fingerprint persisted in audit metadata", () => {
  const attempts = buildPeopleSearchAttempts(parsePeopleSearchIntent("find founders of B2B SaaS in the US"), { maxItems: 5 });
  const audit = buildSourcingAttemptAudit(attempts, [{ result_count: 2, accepted_count: 2 }, { result_count: 10, accepted_count: 0 }, { result_count: 10, accepted_count: 0 }], { actor_key: "apify_people_search", actor_implementation: "harvestapi/linkedin-profile-search" });
  assertEquals(audit.length, 3);
  assertEquals(audit[0].label, "exact");
  assert(audit[0].fingerprint.startsWith("pa_"));
  assertEquals(audit[0].actor_implementation, "harvestapi/linkedin-profile-search");
  assertEquals(audit[0].raw_item_count, 2);
  assert("searchQuery" in audit[0].sanitized_input || "currentJobTitles" in audit[0].sanitized_input);
});
Deno.test("25: secrets / authorization values are excluded from audit metadata", () => {
  const dirty = { searchQuery: "B2B SaaS", currentJobTitles: ["Founder"], token: "SECRET", Authorization: "Bearer x", apiKey: "k", password: "p" } as Record<string, unknown>;
  const clean = sanitizeActorInputForAudit(dirty);
  for (const k of ["token", "Authorization", "apiKey", "password"]) assertEquals(k in clean, false);
  assertEquals(clean.searchQuery, "B2B SaaS");
});

// 26: frozen Q1 no longer produces 22/22 wrong-location rejections.
Deno.test("26: 22 US-structured profiles are all accepted (no more 22/22 wrong-location)", () => {
  const crit = { requested: 5, role: null, location: "United States", source_type: "people_profiles" };
  const strict = { location: true, industry: false, stage: false, count_exact: false };
  const cities = ["Greater Philadelphia", "San Francisco Bay Area", "Greater Boston", "Austin, Texas", "Greater New York City Area"];
  const items = Array.from({ length: 22 }, (_, i) => ({
    name: `Founder ${i}`, location: cities[i % cities.length], location_country: "United States", location_country_code: "US",
    source_url: `https://linkedin.com/in/founder${i}`,
  }));
  const res = classifyResults(items, crit, strict);
  assertEquals(res.rejected.filter((r) => /location|country/.test(r.reason)).length, 0);
  assertEquals(res.accepted.length, 22);
});
