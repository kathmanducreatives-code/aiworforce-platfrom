// ONBOARDING RESEARCH, LOCALLY — FIXTURES OR A HONEST REFUSAL, NEVER A GUESS.
//
// Both onboarding research steps are provider calls, and local development has
// no provider keys, so "Analyze LinkedIn profile" and "Analyze company" both
// answered `*_not_configured` and the flow below them could not be developed at
// all.
//
// `AGENTORY_LOCAL_PROVIDER_MODE=mock` fills the SAME `ResearchDeps` from
// fixtures. What these pin is that the mock is a provider substitute and
// nothing more: the same normalizer, the same shape, the same refusals — and
// that it can never, under any environment, be reachable from a hosted project.
//
// PURE. No network, no database, no provider.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveLocalProviderMode, mockResearchDeps, isLocalSupabaseUrl,
  mockLinkedInProfileRow, mockSiteMap, mockSitePages, mockDraftFromEvidence,
  extractEvidenceJson, LOCAL_PROVIDER_MODE_ENV,
} from "../../../supabase/functions/_shared/companyBrainResearch/localProviderMode.ts";
import {
  enrichFounderFromLinkedIn, normalizeFounderProfile, isLinkedInProfileUrl,
} from "../../../supabase/functions/_shared/companyBrainResearch/founderLinkedIn.ts";
import {
  enrichCompanyFromWebsite, selectPages, isExcludedPath,
} from "../../../supabase/functions/_shared/companyBrainResearch/companyWebsite.ts";
import type { ResearchDeps } from "../../../supabase/functions/_shared/companyBrainResearch/types.ts";

const LOCAL = "http://kong:8000";
const env = (o: Record<string, string>) => (k: string) => o[k];
const PROFILE = "https://www.linkedin.com/in/prasidha-sarawagi-6175142a3/";
const SITE = "https://agentory.space";

// ── THE GUARD: A HOSTED PROJECT CAN NEVER SERVE FIXTURES ─────────────────────

Deno.test("mock mode is refused unless Supabase is a local stack", () => {
  // The real local topology: inside the CLI's edge runtime the injected URL is
  // the container gateway, not loopback. A loopback-only test rejected every
  // genuine local function — this is the case that caught that.
  for (const url of [LOCAL, "http://127.0.0.1:54321", "http://localhost:54321", "http://host.docker.internal:54321"]) {
    assertEquals(resolveLocalProviderMode(env({ SUPABASE_URL: url, [LOCAL_PROVIDER_MODE_ENV]: "mock" })).mode, "mock", url);
  }
  // And the case that matters: production is https, and is refused.
  for (const url of ["https://ohsdatpvfdjdemstoiuj.supabase.co", "https://example.com", "https://127.0.0.1"]) {
    const r = resolveLocalProviderMode(env({ SUPABASE_URL: url, [LOCAL_PROVIDER_MODE_ENV]: "mock" }));
    assertEquals(r.mode, "unset", url);
    assert(r.ignored_reason, "a refused flag must say why");
  }
  assertEquals(isLocalSupabaseUrl(undefined), false);
  assertEquals(isLocalSupabaseUrl("not a url"), false);
});

Deno.test("an unrecognised mode is ignored, loudly, and never becomes mock", () => {
  for (const v of ["mocks", "MOCK ", "true", "1", "yes"]) {
    const r = resolveLocalProviderMode(env({ SUPABASE_URL: LOCAL, [LOCAL_PROVIDER_MODE_ENV]: v }));
    if (v.trim().toLowerCase() === "mock") continue; // " MOCK " trims to mock, which is fine
    assertEquals(r.mode, "unset", v);
    assert(r.ignored_reason);
  }
  assertEquals(resolveLocalProviderMode(env({ SUPABASE_URL: LOCAL })).mode, "unset");
});

Deno.test("live mode NEVER falls back to fixtures", () => {
  // The whole point of naming the modes: asking for live providers without keys
  // is a configuration error, not an invitation to invent data.
  const r = resolveLocalProviderMode(env({ SUPABASE_URL: LOCAL, [LOCAL_PROVIDER_MODE_ENV]: "live" }));
  assertEquals(r.mode, "live");
  assertEquals(r.ignored_reason, null);
});

// ── THE FOUNDER STEP ─────────────────────────────────────────────────────────

Deno.test("a valid LinkedIn profile URL researches through the real normalizer", async () => {
  const r = await enrichFounderFromLinkedIn({ profileUrl: PROFILE, consent: true }, mockResearchDeps());
  assertEquals(r.ok, true);
  assertEquals(r.research?.source_url, PROFILE);
  assert(r.research?.name, "the normalizer must produce a name");
  assert((r.research?.experience.length ?? 0) > 0);
  assertEquals(r.research?.confidence, "high");
});

Deno.test("a malformed LinkedIn URL is refused before any provider runs", async () => {
  let called = 0;
  const deps: ResearchDeps = { ...mockResearchDeps(), runApifyActor: (a, i) => { called++; return mockResearchDeps().runApifyActor!(a, i); } };
  for (const bad of ["", "not a url", "https://example.com/in/x", "https://linkedin.com/company/agentory", "linkedin.com/in/x"]) {
    const r = await enrichFounderFromLinkedIn({ profileUrl: bad, consent: true }, deps);
    assertEquals(r.ok, false, bad);
    assertEquals(r.reason, "invalid_linkedin_profile_url", bad);
  }
  assertEquals(called, 0, "a malformed URL must not reach the provider");
  assertEquals(isLinkedInProfileUrl(PROFILE), true);
});

Deno.test("consent is still required in mock mode", async () => {
  const r = await enrichFounderFromLinkedIn({ profileUrl: PROFILE, consent: false }, mockResearchDeps());
  assertEquals([r.ok, r.reason], [false, "consent_not_given"]);
});

Deno.test("a provider failure stays a failure — the mock is not a fallback", async () => {
  const deps: ResearchDeps = { runApifyActor: () => Promise.reject(new Error("apify_500")) };
  const r = await enrichFounderFromLinkedIn({ profileUrl: PROFILE, consent: true }, deps);
  assertEquals(r.ok, false);
  assertEquals(r.research, null);
});

Deno.test("no contact field ever leaves the founder normalizer", () => {
  // The fixture carries none, and a provider that returned some would be
  // stripped. Both paths are the same code.
  const withContacts = { ...mockLinkedInProfileRow(PROFILE), email: "x@y.com", phoneNumber: "+1 555", contactInfo: { email: "a@b.c" } };
  const out = JSON.stringify(normalizeFounderProfile(withContacts, PROFILE));
  for (const leak of ["x@y.com", "+1 555", "a@b.c"]) assertEquals(out.includes(leak), false, leak);
});

// ── THE COMPANY STEP ─────────────────────────────────────────────────────────

Deno.test("the company site is DISCOVERED, not assumed", async () => {
  const r = await enrichCompanyFromWebsite({ websiteUrl: SITE }, mockResearchDeps());
  assertEquals(r.ok, true);
  const urls = (r.research?.source_pages ?? []).map((p) => (typeof p === "string" ? p : (p as { url: string }).url));
  assertEquals(urls[0], SITE, "the homepage is always read first");
  // Pages the map offered and the selector must REFUSE.
  for (const dropped of [`${SITE}/login`, `${SITE}/privacy`, "https://twitter.com/someone"]) {
    assertEquals(urls.includes(dropped), false, dropped);
  }
  assert(urls.includes(`${SITE}/pricing`), "a mapped pricing page should be read");
  assertEquals(isExcludedPath(`${SITE}/login`), true);
});

Deno.test("a page that is not in the map is never fetched", () => {
  // `/pricing` is read because the MAP offered it, not because the path was
  // guessed. A site whose map has no pricing page yields no pricing read.
  const chosen = selectPages(SITE, [SITE, `${SITE}/about`], 10);
  assertEquals(chosen.includes(`${SITE}/pricing`), false);
  assertEquals(chosen, [SITE, `${SITE}/about`]);
});

Deno.test("the homepage is read whether or not the user typed a trailing slash", async () => {
  for (const typed of [SITE, `${SITE}/`]) {
    const r = await enrichCompanyFromWebsite({ websiteUrl: typed }, mockResearchDeps());
    assertEquals(r.ok, true, typed);
    assert((r.pages_fetched ?? 0) >= 2, typed);
  }
});

Deno.test("an unreachable website fails honestly — no invented company", async () => {
  const deps: ResearchDeps = { firecrawlScrape: () => Promise.resolve(null), firecrawlMap: () => Promise.resolve([]) };
  const r = await enrichCompanyFromWebsite({ websiteUrl: "https://nothing-here.invalid" }, deps);
  assertEquals([r.ok, r.error], [false, "no_pages_fetched"]);
  assertEquals(r.research, null);
});

Deno.test("a malformed website URL is refused before any provider runs", async () => {
  let called = 0;
  const deps: ResearchDeps = { firecrawlScrape: () => { called++; return Promise.resolve(null); } };
  for (const bad of ["", "agentory.space", "ftp://agentory.space", "javascript:alert(1)"]) {
    const r = await enrichCompanyFromWebsite({ websiteUrl: bad }, deps);
    assertEquals(r.reason, "invalid_website_url", bad);
  }
  assertEquals(called, 0);
});

Deno.test("website facts separate what a page SAID from what was inferred", async () => {
  const r = await enrichCompanyFromWebsite({ websiteUrl: SITE }, mockResearchDeps());
  const res = r.research!;
  // FACTS: every one carries the page it came from.
  assert(res.evidence.length > 0);
  for (const e of res.evidence) {
    assert(e.source_url, "a fact without a source is not a fact");
    assert(e.page_type, "a fact must say what kind of page it came from");
  }
  // INFERENCES: named as guesses, and confirmable.
  assert("target_users_guess" in res);
  assert("needs_confirmation" in res);
  assert("ambiguous" in res);
});

// ── MOCK AND LIVE NORMALIZE IDENTICALLY ──────────────────────────────────────

Deno.test("the same provider row normalizes identically in mock and live mode", async () => {
  // The "live" adapter here is the real one's shape: a function that returns
  // provider rows. Give both adapters the SAME row and the results must not
  // differ by a byte — that is what makes the mock worth developing against.
  const row = mockLinkedInProfileRow(PROFILE);
  const live: ResearchDeps = { runApifyActor: () => Promise.resolve([structuredClone(row)]) };
  const a = await enrichFounderFromLinkedIn({ profileUrl: PROFILE, consent: true }, mockResearchDeps());
  const b = await enrichFounderFromLinkedIn({ profileUrl: PROFILE, consent: true }, live);
  assertEquals(JSON.stringify(a.research), JSON.stringify(b.research));

  const pages = mockSitePages(SITE);
  const liveWeb: ResearchDeps = {
    firecrawlMap: () => Promise.resolve(mockSiteMap(SITE)),
    firecrawlScrape: (u) => Promise.resolve(structuredClone(pages.get(u) ?? null)),
  };
  const c = await enrichCompanyFromWebsite({ websiteUrl: SITE }, mockResearchDeps());
  const d = await enrichCompanyFromWebsite({ websiteUrl: SITE }, liveWeb);
  assertEquals(JSON.stringify(c.research), JSON.stringify(d.research));
});

Deno.test("every fixture says that it is one", () => {
  // The marker lives where the live actor puts the profile text: `basic_info.about`.
  const row = mockLinkedInProfileRow(PROFILE);
  assert(JSON.stringify(row).includes("local fixture"), "the profile row must say it is a fixture");
  assert(normalizeFounderProfile(row, PROFILE).summary.includes("local fixture"),
    "and the marker must survive normalization, where a reader will see it");
  for (const p of mockSitePages(SITE).values()) {
    assert(String(p.markdown).includes("local fixture"), p.url);
  }
});

// ── THE DRAFT FIXTURE RESTATES EVIDENCE; IT DOES NOT INVENT ──────────────────

Deno.test("the fixture draft is built from the evidence in the prompt", () => {
  const user = 'RESEARCH EVIDENCE:\n' + JSON.stringify({
    company_understanding: {
      company_name: "Agentory", website: SITE, one_line_summary: "AI teammates.",
      product_category: "AI workforce platform", business_model: "B2B SaaS", primary_users: ["founders"],
    },
    user_provided: { founder: { name: "A Founder", role: "Founder" }, company: { name: "Agentory" } },
    founder_research: { name: "A Founder", current_role: "Founder & CEO", location: "Kathmandu, Nepal", summary: "s" },
  }, null, 2) + "\n\nDraft the Company Brain…";
  const d = mockDraftFromEvidence(user);
  const company = d.company as Record<string, unknown>;
  assertEquals(company.name, "Agentory");
  assertEquals(company.category, "AI workforce platform");
  assertEquals(company.business_model, "B2B SaaS");
  // NOT INVENTED: a fixture writes no personas, triggers or angles.
  for (const k of ["buyer_personas", "triggers", "content_angles", "competitors", "pain_points"]) {
    assertEquals((d[k] as unknown[]).length, 0, k);
  }
  assert(String(d._fixture).includes("local fixture"));
});

Deno.test("evidence extraction survives braces inside strings", () => {
  const j = extractEvidenceJson('RESEARCH EVIDENCE:\n{"a":"a } brace","b":{"c":1}}\n\nrest');
  assertEquals(j, { a: "a } brace", b: { c: 1 } });
  assertEquals(extractEvidenceJson("no json here"), null);
});

// ── WHAT THE LIVE RUN TAUGHT THE FIXTURES ────────────────────────────────────
//
// Live run 5HusFT12Zs4pSS1nd against `apimaestro/linkedin-profile-detail`
// returned a shape no fixture had: the profile row nests everything under
// `basic_info`, `location` is an OBJECT, and skills arrive as `top_skills`.
// The normalizer read `location` with `asString`, got "" from the object, and
// dropped the founder's location on every profile from that actor — silently,
// with `confidence: "high"`, because nothing else was missing.
//
// These pin the real provider's shape, so the next fixture cannot drift back to
// the shape the code merely expected.

Deno.test("LIVE SHAPE: a location object becomes a location", () => {
  const row = {
    basic_info: {
      fullname: "A Founder", headline: "Founder @ Example",
      location: { country: "Nepal", city: "Kathmandu, Bāgmatī", full: "Kathmandu, Bāgmatī, Nepal", postal_code: "", country_code: "NP" },
      about: "Building things.", current_company: "Example", email: null, top_skills: [],
    },
    experience: [{ title: "Founder", company: "Example" }],
    education: [{ school: "A University" }],
  };
  const r = normalizeFounderProfile(row, PROFILE);
  assertEquals(r.location, "Kathmandu, Bāgmatī, Nepal");
  assertEquals(r.name, "A Founder");
  assertEquals(r.current_company, "Example");
});

Deno.test("LIVE SHAPE: a location object with no `full` is assembled from its parts", () => {
  const r = normalizeFounderProfile(
    { fullname: "B", headline: "h", location: { city: "Lisbon", country: "Portugal" }, experience: [{ title: "t", company: "c" }] },
    PROFILE,
  );
  assertEquals(r.location, "Lisbon, Portugal");
});

Deno.test("LIVE SHAPE: a plain string location still works", () => {
  const r = normalizeFounderProfile({ fullname: "C", headline: "h", location: "Berlin, Germany" }, PROFILE);
  assertEquals(r.location, "Berlin, Germany");
  assertEquals(normalizeFounderProfile({ fullname: "D" }, PROFILE).location, "");
});

Deno.test("LIVE SHAPE: the email field this actor carries never reaches the result", () => {
  // The live actor is the "+ EMAIL" variant: `basic_info.email` exists on every
  // row. It was null for the profile we ran, but the KEY is always there, and a
  // profile that exposes one must not be stored.
  const r = normalizeFounderProfile(
    { basic_info: { fullname: "E", headline: "h", email: "founder@example.com", location: "X" }, experience: [] },
    PROFILE,
  );
  assertEquals(JSON.stringify(r).includes("founder@example.com"), false);
  assertEquals(JSON.stringify(r).toLowerCase().includes("email"), false);
});

Deno.test("LIVE SHAPE: top_skills is read like skills", () => {
  const r = normalizeFounderProfile(
    { fullname: "F", headline: "h", top_skills: ["Go-to-market", "Outbound"] }, PROFILE,
  );
  assertEquals(r.skills, ["Go-to-market", "Outbound"]);
});
