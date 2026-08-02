// Founder LinkedIn adapter — fixture tests. NO provider ever runs here:
// `deps.runApifyActor` is either omitted or a local stub.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeFounderProfile, enrichFounderFromLinkedIn, isLinkedInProfileUrl,
  stripContactFields, deriveCredibilitySignals, deriveGtmRelevance,
} from "../../functions/_shared/founderLinkedIn.ts";

const PROFILE_URL = "https://www.linkedin.com/in/jane-doe";

// A realistic Apify LinkedIn-profile row, including contact fields we must drop.
const fixture = {
  fullName: "Jane Doe",
  headline: "Co-Founder & CEO at Cekura — building AI SaaS for revenue teams",
  location: "San Francisco, CA",
  summary: "Previously led Sales Operations at Acme. Raised a seed round in 2025.",
  skills: ["Outbound", "RevOps", "Pipeline generation", "Python"],
  experience: [
    { title: "Co-Founder & CEO", company: "Cekura", duration: "2024–now" },
    { title: "Head of Revenue Operations", company: "Acme", duration: "2021–2024" },
  ],
  education: [{ school: "MIT", degree: "BSc Computer Science" }],
  email: "jane@cekura.ai",          // must be stripped
  phone: "+1 555 0100",             // must be stripped
  contact_info: { twitter: "@jane" }, // must be stripped
};

Deno.test("1. fixture normalizes into FounderResearch", () => {
  const r = normalizeFounderProfile(fixture, PROFILE_URL);
  assertEquals(r.name, "Jane Doe");
  assertEquals(r.current_role, "Co-Founder & CEO");
  assertEquals(r.current_company, "Cekura");
  assertEquals(r.experience.length, 2);
  assertEquals(r.education[0].school, "MIT");
  assertEquals(r.source_url, PROFILE_URL);
  assert(r.skills.includes("RevOps"));
});

Deno.test("2. contact fields are stripped — onboarding never scrapes contacts", () => {
  const cleaned = stripContactFields(fixture as Record<string, unknown>);
  assert(!("email" in cleaned));
  assert(!("phone" in cleaned));
  assert(!("contact_info" in cleaned));
  const serialized = JSON.stringify(normalizeFounderProfile(fixture, PROFILE_URL));
  assert(!/jane@cekura\.ai/.test(serialized), "email must not survive normalization");
  assert(!/555 0100/.test(serialized), "phone must not survive normalization");
});

Deno.test("3. credibility + GTM relevance derived only from read text", () => {
  const cred = deriveCredibilitySignals({ headline: fixture.headline, summary: fixture.summary, experience: fixture.experience });
  assert(cred.some((c) => /co-founder|ceo/i.test(c)));
  const gtm = deriveGtmRelevance({ headline: fixture.headline, summary: fixture.summary, skills: fixture.skills, experience: fixture.experience });
  assert(gtm.some((g) => /revenue operations|gtm|revops/i.test(g)));
});

Deno.test("4. weak evidence → low confidence + missing_evidence, never invented", () => {
  const r = normalizeFounderProfile({ fullName: "Solo" }, PROFILE_URL);
  assertEquals(r.confidence, "low");
  assert(r.missing_evidence.includes("work experience"));
  assertEquals(r.current_company, "");
  assertEquals(r.experience, []);
});

Deno.test("5. only linkedin.com/in/ profile URLs accepted", () => {
  assert(isLinkedInProfileUrl(PROFILE_URL));
  assert(isLinkedInProfileUrl("https://linkedin.com/in/foo"));
  assert(!isLinkedInProfileUrl("https://linkedin.com/company/foo"));
  assert(!isLinkedInProfileUrl("https://example.com/in/foo"));
  assert(!isLinkedInProfileUrl("not a url"));
});

Deno.test("6. consent is required — no provider is called without it", async () => {
  let called = false;
  const r = await enrichFounderFromLinkedIn(
    { profileUrl: PROFILE_URL, consent: false },
    { runApifyActor: async () => { called = true; return [fixture]; } },
  );
  assertEquals(r.ok, false);
  assertEquals(r.reason, "consent_not_given");
  assertEquals(called, false, "provider must NOT run without consent");
});

Deno.test("7. invalid URL → skipped, no provider call", async () => {
  let called = false;
  const r = await enrichFounderFromLinkedIn(
    { profileUrl: "https://linkedin.com/company/acme", consent: true },
    { runApifyActor: async () => { called = true; return []; } },
  );
  assertEquals(r.reason, "invalid_linkedin_profile_url");
  assertEquals(called, false);
});

Deno.test("8. unconfigured provider → honest skip, never throws", async () => {
  const r = await enrichFounderFromLinkedIn({ profileUrl: PROFILE_URL, consent: true }, {});
  assertEquals(r.ok, false);
  assertEquals(r.reason, "apify_not_configured");
});

Deno.test("9. with consent + stub actor → exactly ONE profile requested, actor id configurable", async () => {
  let usedActor = "";
  let input: any = null;
  const r = await enrichFounderFromLinkedIn(
    { profileUrl: PROFILE_URL, consent: true },
    {
      actorId: (env, fallback) => (env === "APIFY_ACTOR_LINKEDIN_PROFILE_SCRAPER" ? "custom/actor" : fallback),
      runApifyActor: async (actor, i) => { usedActor = actor; input = i; return [fixture]; },
    },
  );
  assertEquals(r.ok, true);
  assertEquals(usedActor, "custom/actor", "env-configured actor id wins");
  assertEquals(input.profileUrls.length, 1, "one profile max during onboarding");
  assertEquals(input.maxItems, 1);
  assertEquals(r.research?.name, "Jane Doe");
});
