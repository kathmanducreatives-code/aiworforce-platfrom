import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildHarvestApiPeopleInput } from "../../../supabase/functions/_shared/harvestApiPeople.ts";
import {
  normalizeDiscoveredContact,
  matchContactToAccountDetailed,
  planContactAttachments,
  buildContactSearchQueries,
  personaForAccounts,
  type AccountForContacts,
} from "../../../supabase/functions/_shared/contactDiscovery.ts";

// ============ People-search actor input (yield fixes) ============

Deno.test("people input: founder role aliases become SEPARATE title filters", () => {
  const out = buildHarvestApiPeopleInput({
    query: "Founder Healthcare", location: "London",
    role_keywords: ["Founder", "Co-Founder", "CEO"], max_results: 5,
  });
  const titles = out.currentJobTitles as string[];
  assertEquals(titles, ["Founder", "Co-Founder", "CEO"]); // not one joined "Founder Co-Founder Ceo"
  assert(titles.length === 3);
});

Deno.test("people input: searchQuery carries industry (not title); location lives in locations[]", () => {
  const out = buildHarvestApiPeopleInput({
    query: "Founder Healthcare", location: "London",
    role_keywords: ["Founder", "Co-Founder", "CEO"], max_results: 5,
    user_input: { keywords: ["Healthcare AI", "healthtech"] },
  });
  const sq = String(out.searchQuery).toLowerCase();
  assert(sq.includes("healthcare"), `searchQuery should include industry: ${out.searchQuery}`);
  // Location is a structured filter, not fuzzy searchQuery text.
  assert(!sq.includes("london"), `searchQuery must not carry location: ${out.searchQuery}`);
  assertEquals(out.locations, ["London"]);
});

Deno.test("people input: strict London preserved in locations", () => {
  const out = buildHarvestApiPeopleInput({ query: "Founder", location: "London", role_keywords: ["Founder"], max_results: 5 });
  assertEquals(out.locations, ["London"]);
});

Deno.test("people input: only official fields emitted (no raw Agentory keys)", () => {
  const out = buildHarvestApiPeopleInput({ query: "Founder Healthcare", location: "London", role_keywords: ["Founder"], max_results: 5 });
  for (const k of Object.keys(out)) {
    assert(!["role_keywords", "max_results", "location", "query"].includes(k), `leaked raw field: ${k}`);
  }
  assertEquals(out.maxItems, 5);
});

// ============ Decision-maker search + matching ============

const ACCTS: AccountForContacts[] = [
  { lead_candidate_id: "a1", company: "Acme", signal_role: "Founder" },
  { lead_candidate_id: "a2", company: "Globex", signal_role: "Founder" },
];

Deno.test("decision-maker queries use account company names", () => {
  const persona = personaForAccounts(ACCTS);
  const qs = buildContactSearchQueries(ACCTS, persona, { maxQueries: 6 });
  assert(qs.some((q) => /acme/i.test(q)), "should query Acme");
  assert(qs.some((q) => /globex/i.test(q)), "should query Globex");
});

Deno.test("match: 'Acme AI Inc.' contact → account 'Acme' = high confidence", () => {
  const c = normalizeDiscoveredContact({ name: "Jane Doe", title: "Founder", linkedinUrl: "https://linkedin.com/in/jane", company: "Acme AI Inc." })!;
  const m = matchContactToAccountDetailed(c, ACCTS);
  assert(m.matched && m.confidence === "high", JSON.stringify(m));
  assertEquals(m.lead_candidate_id, "a1");
});

Deno.test("match: unrelated company → not matched (low)", () => {
  const c = normalizeDiscoveredContact({ name: "Bob", title: "CEO", linkedinUrl: "https://linkedin.com/in/bob", company: "Initech" })!;
  const m = matchContactToAccountDetailed(c, ACCTS);
  assert(!m.matched);
});

Deno.test("normalize: nested company + firstName/lastName extracted", () => {
  const c = normalizeDiscoveredContact({ firstName: "Mark", lastName: "Young", headline: "Founder at Acme", currentPosition: { companyName: "Acme", title: "Founder" }, linkedinUrl: "https://linkedin.com/in/mark" });
  assert(c);
  assertEquals(c!.name, "Mark Young");
  assertEquals(c!.company, "Acme");
});

Deno.test("attach: missing title or URL → not attached", () => {
  const noTitle = planContactAttachments([{ name: "X", company: "Acme", linkedinUrl: "https://linkedin.com/in/x" }], ACCTS);
  assertEquals(noTitle.length, 0);
  const noUrl = planContactAttachments([{ name: "X", title: "Founder", company: "Acme" }], ACCTS);
  assertEquals(noUrl.length, 0);
  const noName = planContactAttachments([{ title: "Founder", company: "Acme", linkedinUrl: "https://linkedin.com/in/x" }], ACCTS);
  assertEquals(noName.length, 0);
});

Deno.test("attach: high-confidence contact attaches; company mismatch rejected", () => {
  const plan = planContactAttachments([
    { name: "Jane Doe", title: "Founder", linkedinUrl: "https://linkedin.com/in/jane", company: "Acme AI Inc." },
    { name: "Zed", title: "CEO", linkedinUrl: "https://linkedin.com/in/zed", company: "Unrelated Corp" },
  ], ACCTS);
  assertEquals(plan.length, 1);
  assertEquals(plan[0].lead_candidate_id, "a1");
  assertEquals(plan[0].confidence, "high");
});

Deno.test("attach: one decision-maker per account (no duplicate accounts)", () => {
  const plan = planContactAttachments([
    { name: "Jane", title: "Founder", linkedinUrl: "https://linkedin.com/in/jane", company: "Acme" },
    { name: "John", title: "CEO", linkedinUrl: "https://linkedin.com/in/john", company: "Acme" },
  ], ACCTS);
  assertEquals(plan.length, 1); // not two for the same account
});
