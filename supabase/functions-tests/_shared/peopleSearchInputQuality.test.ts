// Provider-free validation for the HarvestAPI people-search input-quality fix.
// Exercises the production adapter + query/attempt builder + routing/handoff guards.
// Deterministic; no provider/LLM/Apify.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildHarvestApiPeopleInput } from "../../functions/_shared/harvestApiPeople.ts";
import {
  parsePeopleSearchIntent,
  buildPeopleSearchAttempts,
  parsePersonRoles,
  parseMarketTerms,
  buildMarketQuery,
  peopleAttemptFingerprint,
} from "../../functions/_shared/peopleSearchQueryBuilder.ts";
import { resolveProviderSource } from "../../functions/_shared/plannedToolResolver.ts";
import { buildProviderIndexFromItems, parseScoutCandidates, guardScoutToAria, type NormalizedProviderItem } from "../../functions/_shared/leadHandoffGuard.ts";
import { classifyProviderSourceOutcome, buildProviderSourceNoResults } from "../../functions/_shared/leadSourcingGate.ts";
import { filterPlanForMode, stepAllowedInMode } from "../../functions/_shared/executionMode.ts";
import { FROZEN_Q1_GENERIC_INPUT, FROZEN_MALFORMED_PAYLOAD, FROZEN_Q1_SCOUT_INSTRUCTION } from "../../functions/_shared/peopleSearchInputFixture.ts";

const Q1 = FROZEN_Q1_SCOUT_INSTRUCTION;
const CAP = 5;
const attempts = () => buildPeopleSearchAttempts(parsePeopleSearchIntent(Q1), { maxItems: CAP, takePages: 1, startPage: 1 });
const OFFICIAL = new Set(["profileScraperMode", "searchQuery", "maxItems", "startPage", "takePages", "currentJobTitles", "locations"]);

// 1) Full user instruction never passed directly into searchQuery.
Deno.test("1: full instruction never becomes searchQuery", () => {
  const q = String(buildHarvestApiPeopleInput({ ...FROZEN_Q1_GENERIC_INPUT }).searchQuery ?? "");
  assert(q !== Q1 && q.length < 40, `searchQuery too close to raw instruction: ${q}`);
});

// 2) Tool names never appear in searchQuery.
Deno.test("2: tool names never in searchQuery", () => {
  for (const a of attempts()) assert(!/apify|people_search|source_with/i.test(String(a.payload.searchQuery ?? "")));
  assert(!/apify/i.test(String(buildHarvestApiPeopleInput({ ...FROZEN_Q1_GENERIC_INPUT }).searchQuery ?? "")));
});

// 3) Requested counts never appear in searchQuery.
Deno.test("3: requested counts never in searchQuery", () => {
  for (const a of attempts()) assert(!/\b10-15\b|\b\d+\s+(?:leads?|founders?)\b/i.test(String(a.payload.searchQuery ?? "")));
});

// 4) Founder + co-founder roles map to currentJobTitles.
Deno.test("4: founder/co-founder → currentJobTitles", () => {
  assertEquals(parsePersonRoles(Q1), ["Founder", "Co-Founder"]);
  assertEquals(attempts()[0].payload.currentJobTitles, ["Founder", "Co-Founder"]);
});

// 5) United States maps to locations.
Deno.test("5: United States → locations", () => {
  assertEquals(parsePeopleSearchIntent(Q1).locations, ["United States"]);
  for (const a of attempts()) assertEquals(a.payload.locations, ["United States"]);
});

// 6) Market/category terms produce a concise fuzzy searchQuery.
Deno.test("6: market terms → concise searchQuery", () => {
  assertEquals(buildMarketQuery(parseMarketTerms(Q1)), "B2B SaaS OR AI SaaS");
  assertEquals(attempts()[0].payload.searchQuery, "B2B SaaS OR AI SaaS");
});

// 7) Unsupported employee-count preserved downstream, omitted from actor fields.
Deno.test("7: employee-count deferred, not an actor field", () => {
  const intent = parsePeopleSearchIntent(Q1);
  assertEquals(intent.deferred.employee_count, "10-150");
  assert(intent.deferred.raw_notes.some((n) => /employee_count/.test(n)));
  for (const a of attempts()) for (const v of Object.values(a.payload)) assert(!/10-150|employees?/i.test(JSON.stringify(v)));
});

// 8) Exact attempt correctly shaped.
Deno.test("8: exact attempt shape", () => {
  const e = attempts()[0];
  assertEquals(e.label, "exact");
  assertEquals(e.payload, { profileScraperMode: "Full", maxItems: 5, takePages: 1, startPage: 1, currentJobTitles: ["Founder", "Co-Founder"], locations: ["United States"], searchQuery: "B2B SaaS OR AI SaaS" });
});

// 9) Broadened materially differs from exact.
Deno.test("9: broadened differs from exact", () => {
  const [e, b] = attempts();
  assertEquals(b.label, "broadened");
  assert(JSON.stringify(b.payload) !== JSON.stringify(e.payload));
  assertEquals(b.payload.currentJobTitles, ["Founder", "Co-Founder", "CEO"]); // role alias added
  assertEquals(b.payload.searchQuery, "SaaS OR Artificial Intelligence"); // market relaxed
});

// 10) Minimal-safe differs from both prior attempts.
Deno.test("10: minimal_safe differs from exact and broadened", () => {
  const [e, b, m] = attempts();
  assertEquals(m.label, "minimal_safe");
  assert(JSON.stringify(m.payload) !== JSON.stringify(e.payload));
  assert(JSON.stringify(m.payload) !== JSON.stringify(b.payload));
  assertEquals("searchQuery" in m.payload, false); // market phrase dropped
});

// 11) takePages=1 on every capped attempt.
Deno.test("11: takePages=1 every attempt", () => { for (const a of attempts()) assertEquals(a.payload.takePages, 1); });

// 12) maxItems=5 on every attempt.
Deno.test("12: maxItems=5 every attempt", () => { for (const a of attempts()) assertEquals(a.payload.maxItems, 5); });

// 13) startPage=1 on every attempt.
Deno.test("13: startPage=1 every attempt", () => { for (const a of attempts()) assertEquals(a.payload.startPage, 1); });

// 14) No undefined / empty-string / unsupported fields sent.
Deno.test("14: only official, non-empty fields", () => {
  for (const a of attempts()) {
    for (const [k, v] of Object.entries(a.payload)) {
      assert(OFFICIAL.has(k), `unsupported field: ${k}`);
      assert(v !== undefined && v !== "", `empty field: ${k}`);
      if (Array.isArray(v)) assert(v.length > 0, `empty array: ${k}`);
    }
  }
});

// 15) Three retry fingerprints distinct.
Deno.test("15: three distinct fingerprints", () => {
  const fps = attempts().map((a) => a.fingerprint);
  assertEquals(new Set(fps).size, 3);
  for (const a of attempts()) assertEquals(a.fingerprint, peopleAttemptFingerprint(a.payload));
});

// 16) Hiring queries still use the jobs actor.
Deno.test("16: hiring query → jobs actor", () => {
  const r = resolveProviderSource("find companies hiring RevOps engineers right now");
  assertEquals(r?.kind, "jobs");
  assertEquals(r?.actor_key, "apify_jobs");
});

// 17) Non-lead research unaffected (founder query still routes people; research is not people sourcing).
Deno.test("17: founder query routes people (research unaffected)", () => {
  assertEquals(resolveProviderSource(Q1)?.actor_key, "apify_people_search");
});

// --- provider-backed handoff fixtures ---
const REAL_PROFILE: NormalizedProviderItem = { company: "Acme Robotics", name: "Jane Doe", person_linkedin_url: "https://linkedin.com/in/jane-doe", source_url: "https://linkedin.com/in/jane-doe" };

// 18) Zero valid actor rows still produce no_results.
Deno.test("18: zero rows ⇒ no_results", () => {
  const guard = guardScoutToAria(parseScoutCandidates(JSON.stringify({ candidates: [] }), null), buildProviderIndexFromItems([]));
  assertEquals(guard.shouldStop, true);
  assertEquals(classifyProviderSourceOutcome({ rawItemCount: 0, acceptedItemCount: 0 }), "provider_source_empty");
  assertEquals(buildProviderSourceNoResults("provider_source_empty").result_status, "no_results");
});

// 19) Returned profile fixtures normalize into provider-backed people.
Deno.test("19: profile fixture builds a non-empty provider index", () => {
  const idx = buildProviderIndexFromItems([REAL_PROFILE]);
  assert(idx.people.size > 0 || idx.urls.size > 0);
});

// 20) Provider-backed profiles may reach Aria.
Deno.test("20: provider-backed candidate reaches Aria", () => {
  const idx = buildProviderIndexFromItems([REAL_PROFILE]);
  const scout = JSON.stringify({ candidates: [{ name: "Jane Doe", company: "Acme Robotics", source_url: "https://linkedin.com/in/jane-doe" }] });
  const guard = guardScoutToAria(parseScoutCandidates(scout, null), idx);
  assertEquals(guard.verified.length, 1);
  assertEquals(guard.shouldStop, false);
});

// 21) Generic LLM identities remain blocked.
Deno.test("21: fabricated identity blocked before Aria", () => {
  const idx = buildProviderIndexFromItems([REAL_PROFILE]);
  const scout = JSON.stringify({ candidates: [{ name: "Made Up", company: "Nowhere Inc" }] });
  const guard = guardScoutToAria(parseScoutCandidates(scout, null), idx);
  assertEquals(guard.verified.length, 0);
  assertEquals(guard.shouldStop, true);
});

// 22) source_and_qualify_only still produces zero drafts/outreach steps.
Deno.test("22: SQO strips Penn/draft/send/publish", () => {
  const plan = [
    { agent_slug: "scout", tool_needed: "source_with_apify", step_index: 0 },
    { agent_slug: "aria", tool_needed: "extract_structured", step_index: 1 },
    { agent_slug: "penn", tool_needed: "draft_outreach", step_index: 2 },
  ];
  assertEquals(filterPlanForMode(plan, "source_and_qualify_only").steps.map((s) => s.agent_slug), ["scout", "aria"]);
  assertEquals(stepAllowedInMode({ tool_needed: "send_email" }, "source_and_qualify_only"), false);
});

// 23) Frozen Q1 payload BEFORE fix matches the observed malformed payload.
Deno.test("23: frozen malformed payload matches the observed live payload", () => {
  assertEquals(FROZEN_MALFORMED_PAYLOAD.searchQuery, FROZEN_Q1_SCOUT_INSTRUCTION);
  assertEquals("currentJobTitles" in FROZEN_MALFORMED_PAYLOAD, false);
});

// 24) Frozen Q1 CORRECTED payload no longer contains meta-instruction prose.
Deno.test("24: corrected payload has no meta-instruction prose", () => {
  const out = buildHarvestApiPeopleInput({ ...FROZEN_Q1_GENERIC_INPUT });
  const q = String(out.searchQuery ?? "");
  assert(!/apify_people_search|use\s|find\s+\d|using my icp|10-15|employees/i.test(q), `prose leaked: ${q}`);
  assertEquals(out.currentJobTitles, ["Founder", "Co-Founder"]);
});

// 25) searchQuery never contains repeated whitespace (normalization guard).
Deno.test("25: generated searchQuery has no repeated whitespace", () => {
  // Direct builder + several realistic queries, exact/broadened attempts, adapter.
  assertEquals(buildMarketQuery(["B2B SaaS", "AI SaaS"]), "B2B SaaS OR AI SaaS");
  assertEquals(buildMarketQuery(["B2B  SaaS ", "  AI SaaS"]), "B2B SaaS OR AI SaaS"); // messy input collapsed
  const queries = [
    Q1,
    "Find me 5 fintech founders and cybersecurity CEOs in London",
    "healthcare AI founders in the US, developer tools too",
  ];
  for (const src of queries) {
    for (const a of buildPeopleSearchAttempts(parsePeopleSearchIntent(src), { maxItems: CAP, takePages: 1, startPage: 1 })) {
      const q = String(a.payload.searchQuery ?? "");
      assert(!/\s{2,}/.test(q), `repeated whitespace in attempt: ${JSON.stringify(q)}`);
    }
    const aq = String(buildHarvestApiPeopleInput({ query: src, location: null, role_keywords: [], max_results: CAP }).searchQuery ?? "");
    assert(!/\s{2,}/.test(aq), `repeated whitespace in adapter: ${JSON.stringify(aq)}`);
  }
});
