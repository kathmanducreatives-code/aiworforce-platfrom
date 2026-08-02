import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildProviderQueries, expandLocations } from "./leadProviderQueryBuilder.ts";
import { extractLeadSearchIntent } from "./leadSearchIntent.ts";

const badQuery = "Find 5 AI SaaS companies recently funded hiring SDRs or GTM roles for outbound in US + EU";

Deno.test("Part2 #3/#4: targeted multi-queries, never one generic mega-string", () => {
  const qs = buildProviderQueries(extractLeadSearchIntent({ message: badQuery }));
  assert(qs.length >= 3, "multiple queries");
  // no query is the old giant blob
  assert(qs.every((q) => q.keywords.split(" ").length <= 6), "each query is short/precise");
  assert(qs.some((q) => /AI SaaS.*SDR|AI SaaS.*outbound/i.test(q.keywords)));
  assert(qs.some((q) => /GTM|Go-to-Market/i.test(q.keywords)));
  // the notorious mega blob must never appear
  assert(!qs.some((q) => /Business Development.*Demand Generation.*Revenue.*software/i.test(q.keywords)));
});

Deno.test("Part2 #1/#2: 'US + EU' splits into separate concrete locations; never literal Eu/US+EU", () => {
  const qs = buildProviderQueries(extractLeadSearchIntent({ message: badQuery }));
  const locs = new Set(qs.map((q) => q.location));
  assert([...locs].every((l) => l !== "US + EU" && l !== "EU" && l !== "US"));
  assert([...locs].some((l) => l === "United States"));
  assert([...locs].some((l) => /United Kingdom|Germany|Netherlands|France/.test(l)));
});

Deno.test("Part2 #5: each query has intent_tier + reason + required_evidence", () => {
  const qs = buildProviderQueries(extractLeadSearchIntent({ message: badQuery }));
  assert(qs.every((q) => ["strict", "relaxed", "broad"].includes(q.intent_tier)));
  assert(qs.every((q) => q.reason.length > 0 && q.required_evidence.includes("source_url")));
  assert(qs.some((q) => q.intent_tier === "strict"));
  // funding_required threads into strict evidence
  assert(qs.some((q) => q.intent_tier === "strict" && q.required_evidence.includes("recent_funding_proof")));
});

Deno.test("Part2: expandLocations maps US→United States+Remote, EU→named countries", () => {
  const us = expandLocations(extractLeadSearchIntent({ message: "Find 5 SaaS SDRs in the US" }));
  assertEquals(us.includes("United States"), true);
  assertEquals(us.includes("Remote United States"), true);
  const eu = expandLocations(extractLeadSearchIntent({ message: "Find 5 SaaS SDRs in EU" }));
  assert(["United Kingdom", "Germany", "Netherlands", "France"].every((c) => eu.includes(c)));
  assert(!eu.includes("EU") && !eu.includes("Europe"));
});

Deno.test("Part2: no locations → safe default United States (never empty/ambiguous)", () => {
  const qs = buildProviderQueries(extractLeadSearchIntent({ message: "Find 3 AI SaaS companies hiring SDRs" }));
  assert(qs.every((q) => q.location && q.location !== "US" && q.location !== "EU"));
  assert(qs.some((q) => q.location === "United States"));
});
