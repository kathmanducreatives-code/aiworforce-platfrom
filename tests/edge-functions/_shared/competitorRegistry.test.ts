import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getCompetitors, matchCompetitors, buildCompetitorSearchQueries } from "../../supabase/functions/_shared/competitorRegistry.ts";

Deno.test("matches GojiBerry aliases", () => {
  assert(matchCompetitors("people talking about GojiBerry on LinkedIn").some((c) => c.key === "gojiberry"));
  assert(matchCompetitors("check gojiberry.ai outbound").some((c) => c.key === "gojiberry"));
});

Deno.test("matches Clay (capitalized brand)", () => {
  const m = matchCompetitors("Find people talking about Clay on LinkedIn");
  assert(m.some((c) => c.key === "clay"));
});

Deno.test("matches Apollo with context", () => {
  assert(matchCompetitors("people complaining about Apollo outbound automation").some((c) => c.key === "apollo"));
});

Deno.test("no false positive for random text", () => {
  assertEquals(matchCompetitors("I went to the beach and read a book about pottery."), []);
  // ambiguous lowercase without brand caps or GTM context should not match
  assertEquals(matchCompetitors("we shaped the clay into a pot"), []);
});

Deno.test("builds search queries from matched competitors", () => {
  const matches = matchCompetitors("talking about GojiBerry and Clay GTM");
  const q = buildCompetitorSearchQueries({ competitors: matches });
  assert(q.some((s) => s.startsWith("GojiBerry")));
  assert(q.some((s) => s.startsWith("Clay")));
});

Deno.test("builds generic query when no competitor matched", () => {
  const q = buildCompetitorSearchQueries({ competitors: [], topic: "AI SDR tools", query: "track competitors" });
  assert(q.length > 0);
  assert(q.some((s) => /AI SDR/i.test(s)));
});

Deno.test("dedupes competitors and registry is non-empty", () => {
  const m = matchCompetitors("Clay Clay clay.com GTM automation");
  assertEquals(m.filter((c) => c.key === "clay").length, 1);
  assert(getCompetitors().length >= 16);
});
