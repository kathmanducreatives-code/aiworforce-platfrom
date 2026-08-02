import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeTerm, capCount, sanitizeQuery, normalizeLeadInput } from "../../../supabase/functions/_shared/inputNormalize.ts";
import { roleAliases, industrySynonyms, broadenAttempt, broadenCompetitorQueries, dedupeByKey } from "../../../supabase/functions/_shared/broaden.ts";

Deno.test("typo normalization", () => {
  assertEquals(normalizeTerm("GGTM"), "GTM");
  assertEquals(normalizeTerm("healtcare"), "healthcare");
  assert(/early-stage startup/i.test(normalizeTerm("early-startup")));
  assertEquals(normalizeTerm("foudner"), "founder");
});

Deno.test("count cap: default 5, ceiling 25, floor 1", () => {
  assertEquals(capCount(undefined), 5);
  assertEquals(capCount(0), 5);
  assertEquals(capCount(10), 10);
  assertEquals(capCount(999), 25);
  assertEquals(capCount("3"), 3);
});

Deno.test("sanitizeQuery rejects raw descriptions, keeps short terms", () => {
  assertEquals(sanitizeQuery("GTM B2B SaaS USA"), "GTM B2B SaaS USA");
  assertEquals(sanitizeQuery("We build an AI workforce OS for founders and small GTM teams across B2B SaaS"), null);
  assertEquals(sanitizeQuery("AI SDR tools"), "AI SDR tools");
});

Deno.test("normalizeLeadInput fixes typos, caps count, drops unsupported fields", () => {
  const r = normalizeLeadInput({ query: "GGTM in healtcare", role_keywords: ["ggtm"], count: 99, weird_field: true, location: "USA" });
  assertEquals(r.count, 25);
  assert(r.role_keywords.includes("GTM"));
  assert(r.dropped_fields.includes("weird_field"));
  assert(r.changes.some((c) => /GGTM|query/i.test(c)));
});

Deno.test("role aliases + industry synonyms", () => {
  assert(roleAliases("GTM").includes("sales"));
  assert(roleAliases("founder").includes("CEO"));
  assert(industrySynonyms("healthcare").includes("digital health"));
  assert(industrySynonyms("b2b saas").includes("SaaS"));
});

Deno.test("broadenAttempt sequence: exact → aliases → relax", () => {
  const base = { role: "GTM", industry: "B2B SaaS", location: "USA", stage: "early-stage" };
  const a1 = broadenAttempt(1, base);
  assert(/Exact/i.test(a1.strategy) && !a1.relax_stage);
  const a2 = broadenAttempt(2, base);
  assert(/alias/i.test(a2.strategy) && a2.role_keywords.includes("sales"));
  const a3 = broadenAttempt(3, base);
  assert(a3.relax_stage, "attempt 3 relaxes stage when present");
});

Deno.test("competitor broadening: names → alternatives → category", () => {
  const a1 = broadenCompetitorQueries(1, ["Clay"], "AI SDR");
  assertEquals(a1, ["Clay"]);
  const a2 = broadenCompetitorQueries(2, ["Clay"], "AI SDR");
  assert(a2.some((q) => /alternative/i.test(q)));
  const a3 = broadenCompetitorQueries(3, ["Clay"], "AI SDR");
  assert(a3.some((q) => /AI SDR/i.test(q)));
});

Deno.test("dedupeByKey removes duplicates across attempts", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "a" }, { id: "" }];
  assertEquals(dedupeByKey(items, (x) => x.id).length, 2);
});

Deno.test("normalizeTerm: Recruting → recruiting (typo fix, no literal typo)", () => {
  assert(!/recruting/i.test(normalizeTerm("Recruting Agency")), "should not contain the typo");
  assertEquals(normalizeTerm("recruting"), "recruiting");
});
