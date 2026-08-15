// DECIDE WHO IS WORTH PAYING FOR, BEFORE PAYING.
//
// Fixtures are the REAL 25 rows from memo23 run 3Hv80atfVioMT9e4y
// (dataset kXRsrxikjrEiWNdBe), which task c8a6e53d-c227-4405-9fcc-e0791b03a4ec
// turned into 16 paid Actor starts that all returned zero rows.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  LINKEDIN_RESOLUTION_CONCURRENCY, acceptLinkedInMatch, classifyJobTitle,
  linkedInSearchQueryFor, linkedInSlugToken, normalizeDomain,
  prequalifyYcCompanies, type YcCompanyInput,
} from "../../../supabase/functions/_shared/leadCommercialPrequalification.ts";

const c = (name: string, website: string, teamSize: number | null, jobs: string[]): YcCompanyInput =>
  ({ name, website, teamSize, batch: "W20", industries: ["B2B"], openJobs: jobs.map((title) => ({ title })) });

/** The real run, abbreviated to the fields prequalification reads. */
const REAL_25: YcCompanyInput[] = [
  c("Odeko", "http://www.odeko.com", 371, ["Brand Designer", "Senior/Staff Fullstack Engineer - Marketplace", "Senior DevOps Engineer"]),
  c("Mux", "http://mux.com", 95, ["Senior Platform Engineer"]),
  c("Bitmovin", "http://bitmovin.com", 145, ["Sales Director"]),
  c("SnapMagic", "https://www.snapmagic.com", 23, ["Head of Operations", "Head of Sales", "Head of Customer Success", "Enterprise Account Executive"]),
  c("Gemnote", "http://gemnote.com", 40, ["Head of Operations"]),
  c("Mashgin", "http://mashgin.com", 150, ["Senior Software Engineer, Backend", "Senior Technical Product Manager", "Software Engineer, Computer Vision and Deep Learning", "Senior Software Engineer, Full-Stack"]),
  c("Tara AI", "http://www.tara.ai", 13, ["Founding Account Executive — Remote", "Founding Account Executive — San Francisco, CA"]),
  c("Streak", "http://streak.com", 35, ["Staff UI Engineer"]),
  c("OneSignal", "https://onesignal.com", 150, ["Product Marketing Manager", "Senior Software Engineer, Email Team", "Staff Software Engineer, SMS Team (Fullstack)", "Senior Software Engineer, Journeys Team (Fullstack)"]),
  c("Magic", "https://getmagic.com/", 350, ["Account Executive - Global, Remote"]),
  c("HackerRank", "http://hackerrank.com", 300, ["Manager, Forward Deployed Engineering", "Forward Deployed Engineer", "Forward Deployed Engineer", "Hiring Senior Software Engineer"]),
  c("Apollo", "http://apollographql.com/", 200, ["Senior Customer Success Engineer", "Enterprise Sales Executive - West"]),
  c("Lob", "http://lob.com", 150, []),
  c("InfluxData", "https://influxdata.com", 210, []),
  c("Etleap", "https://etleap.com", 11, ["Senior Software Engineer - San Francisco (Onsite)", "Account Executive", "DevOps Engineer Latin America (remote)", "Software Engineer - Integrations South America (remote)"]),
  c("Padlet", "https://padlet.com", 65, []),
  c("Zentail", "https://zentail.com", 30, ["Business Development Representative - Hybrid", "Account Executive - Hybrid", "Software Engineer - Hybrid Preferred"]),
  c("Complir", "https://complir.io/", 13, ["Head of Germany"]),
  c("Hub", "https://hub.xyz", 10, ["Founding Engineer", "Field Operator - Brazil"]),
  c("Revion", "https://revion.inc", 10, ["Founding Engineer", "Founding Forward Deployed Enginner"]),
  // The five empty rows memo23 actually returned.
  ...Array.from({ length: 5 }, () => ({ name: null, website: null, teamSize: null, openJobs: [] })),
];

const SIZE = { min: 10, max: 150 };
const run = () => prequalifyYcCompanies(REAL_25, SIZE);

// ════════════════════════ 1. no Actor calls before prequalification ══

Deno.test("1. prequalification is pure — 25 companies cost zero Actor calls", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/leadCommercialPrequalification.ts", import.meta.url));
  for (const forbidden of ["fetch(", "invoke", "apifyFetch", "runTool", "await "]) {
    assertFalse(src.includes(forbidden), `${forbidden} must not appear — this stage is free`);
  }
  const r = run();
  assertEquals(r.total_rows, 25);
  assertEquals(r.unique_companies, 20);
  assertEquals(r.excluded.length, 5, "the five empty memo23 rows are excluded, not scored");
});

// ═══════════════════════════ 2/3. scoring, and the SIZE gate ══
//
// `shortlistSize` and `shortlistForLinkedInResolution` are DELETED, and the
// tests that exercised them went with them. They derived spend from the
// requested lead count (`min(10, max(5, n * 2))`) and then filtered on
// `c.eligible` — the role-vocabulary substring match. Both jobs now belong to
// `leadInvestigationBudget`: the budget is its own configurable number, and
// `buildSmartShortlist` ranks rather than excludes.
//
// What survives here is what prequalification still genuinely owns: scoring,
// dedupe, artifact removal, and the SIZE verdict — the one exclusion that is a
// verified fact rather than a judgement.

Deno.test("2. paid resolution concurrency is bounded", () => {
  // BOUNDED, and small. The exact value is a latency decision — it caps calls
  // in flight, not calls made — so pinning the literal only made tuning it look
  // like a spend regression. What must hold is that a bound exists and stays
  // inside a burst the provider can absorb.
  assert(Number.isInteger(LINKEDIN_RESOLUTION_CONCURRENCY));
  assert(LINKEDIN_RESOLUTION_CONCURRENCY >= 1,
    "zero lanes would stall the stage entirely");
  assert(LINKEDIN_RESOLUTION_CONCURRENCY <= 8,
    "an unbounded burst of paid Actor starts is the failure this guards");
});

Deno.test("3b. Apollo (200) and Magic (350) are marked out of range", () => {
  const r = run();
  for (const tooBig of ["Apollo", "Magic"]) {
    const c = r.companies.find((x) => x.name === tooBig)!;
    assert(c.best_tier !== null, `${tooBig} does have a real commercial opening`);
    assertEquals(c.size_status, "above_max");
    assertEquals(c.eligible, false, "a known out-of-range headcount is disqualifying on its own");
    // THE ONE EXCLUSION THAT STILL REMOVES A CANDIDATE FROM THE POOL — carried
    // to `buildSmartShortlist` as `hard_exclusion`, because it is a verified
    // fact about a constraint the MISSION stated.
    assertEquals(c.exclusion, "employee_size");
  }
});

Deno.test("3c. exclusion kinds are distinct and the totals reconcile", () => {
  const r = run();
  assertEquals(r.unique_companies, 20);
  assertEquals(r.eligible_companies, 5);
  assertEquals(r.employee_size_excluded, 5, "Apollo 200, Magic 350, HackerRank 300, InfluxData 210, Odeko 371");
  const kinds = new Set(r.companies.map((c) => c.exclusion));
  assert(kinds.has("employee_size") && kinds.has("technical_only") && kinds.has(null));
  // Every company is either eligible or carries exactly one exclusion reason.
  for (const c of r.companies) {
    assertEquals(c.eligible, c.exclusion === null, c.name);
  }
});

Deno.test("3d. an unverified size never outranks a verified in-range company", () => {
  const r = prequalifyYcCompanies([
    c("NoSize", "https://nosize.com", null, ["Head of Sales", "Account Executive"]),
    c("Verified", "https://verified.com", 20, ["Account Executive"]),
  ], SIZE);
  assertEquals(r.companies[0].name, "Verified", "verified in-range ranks first despite a lower score");
  assertEquals(r.companies[1].size_status, "size_unverified");
});

// ══════════════════ 4/5/6. technical-only never qualifies, full array read ══

Deno.test("4. technical-only companies are MARKED, not removed", () => {
  // This used to assert they were "never shortlisted". That was the defect:
  // `technical_only` comes from a substring match over a compiled role list, so
  // for a mission asking for engineers it excluded exactly what was requested.
  // The verdict is still recorded — it RANKS them last — and it no longer
  // removes anyone. Only `employee_size` does that.
  const r = run();
  assertEquals(r.technical_only_companies, 5);
  for (const c of r.companies.filter((x) => x.exclusion === "technical_only")) {
    assertEquals(c.eligible, false, `${c.name} is rated ineligible`);
    assertFalse(c.exclusion === "employee_size",
      `${c.name} carries a judgement, not a verified disqualifier`);
  }
});

Deno.test("5. the FULL jobs array is read — a commercial role after engineers is found", () => {
  const r = run();
  // Etleap: engineer FIRST, Account Executive second. The old code showed jobs[0].
  const etleap = r.companies.find((x) => x.name === "Etleap")!;
  assertEquals(etleap.jobs.length, 4);
  assertEquals(etleap.jobs[0].tier, "technical");
  assertEquals(etleap.best_tier, "B");
  assertEquals(etleap.strongest_signal, "Account Executive",
    "the strongest COMMERCIAL role is surfaced, never openJobs[0]");
  // Zentail: BDR first, engineer last.
  const zentail = r.companies.find((x) => x.name === "Zentail")!;
  assertEquals(zentail.tier_b, 2);
  assertEquals(zentail.technical, 1);
});

Deno.test("6. tier classification is commercial-first", () => {
  assertEquals(classifyJobTitle("Head of Sales"), "A");
  assertEquals(classifyJobTitle("Founding Account Executive — Remote"), "A",
    "must not be discarded as 'founding engineer'");
  assertEquals(classifyJobTitle("Revenue Operations Manager"), "A");
  assertEquals(classifyJobTitle("Account Executive"), "B");
  assertEquals(classifyJobTitle("Head of Operations"), "C");
  assertEquals(classifyJobTitle("Senior Software Engineer, Backend"), "technical");
  assertEquals(classifyJobTitle("Founding Engineer"), "technical");
});

Deno.test("6b. a lone Tier-C role is not a commercial signal", () => {
  const r = prequalifyYcCompanies([c("Gemnote", "http://gemnote.com", 40, ["Head of Operations"])], SIZE);
  assertEquals(r.companies[0].best_tier, null, "one ops role could be an office manager");
  // ...and it is rated ineligible, which now RANKS it last rather than deleting
  // it from the pool. `buildSmartShortlist` owns that decision.
  assertEquals(r.companies[0].eligible, false);
  assertEquals(r.companies[0].exclusion, "insufficient_commercial");
});

// ═══════════════════════════ 7. domain is the internal identity ══

Deno.test("7. domain is canonical identity; LinkedIn stays unresolved", () => {
  const r = run();
  const snap = r.companies.find((x) => x.name === "SnapMagic")!;
  assertEquals(snap.canonical_domain, "snapmagic.com", "www. and protocol stripped");
  assertEquals(snap.identity_confidence, "domain_exact");
  assertEquals(snap.linkedin_identity_status, "unresolved",
    "no LinkedIn URL means unresolved — never rejected, never qualified");
  assertEquals(normalizeDomain("https://getmagic.com/"), "getmagic.com");
  assertEquals(normalizeDomain("http://www.tara.ai"), "tara.ai");
  assertEquals(normalizeDomain(null), null);
  // THE QUERY IS THE BARE NAME. This used to assert "SnapMagic snapmagic.com",
  // and that exact string returned zero rows six times on TEST task 42e39fb1 —
  // the Actor matches company NAMES, and a domain is not a name. The domain is
  // still the canonical identity above; it just belongs in match verification,
  // never in the search.
  assertEquals(linkedInSearchQueryFor(snap), "SnapMagic");
});

// ═════════════════════════ 8. weak name-only matches are refused ══

Deno.test("8. a bare name match is rejected; domain or corroboration required", () => {
  const apollo = run().companies.find((x) => x.name === "Apollo")!;

  // The WRONG Apollo — same name, different company.
  const weak = acceptLinkedInMatch(apollo, { name: "Apollo", website: "https://apollo.io" });
  assertFalse(weak.accepted);
  assertEquals(weak.strength, "rejected_weak");

  // The right one, by domain.
  const exact = acceptLinkedInMatch(apollo, { name: "Apollo GraphQL", website: "https://apollographql.com" });
  assert(exact.accepted);
  assertEquals(exact.strength, "domain_exact");

  // Name plus corroborating evidence.
  const supported = acceptLinkedInMatch(apollo, {
    name: "Apollo", website: null, description: "apollographql developer platform",
  });
  assert(supported.accepted);
  assertEquals(supported.strength, "name_plus_evidence");

  assertFalse(acceptLinkedInMatch(apollo, { name: "Something Else" }).accepted);
});

// ═══════════════════════════════════ 9. artifacts are excluded ══

Deno.test("9. Y Combinator itself is never a prospect", () => {
  const r = prequalifyYcCompanies([
    c("Y Combinator", "https://www.ycombinator.com", 300, ["Software Product Design Engineer"]),
    c("Tara AI", "http://www.tara.ai", 13, ["Founding Account Executive"]),
  ], SIZE);
  assertEquals(r.unique_companies, 1);
  assertEquals(r.companies[0].name, "Tara AI");
  assert(r.excluded.some((e) => e.reason.includes("artifact")));
});

Deno.test("10. duplicates collapse on domain, not on row count", () => {
  const r = prequalifyYcCompanies([
    c("Tara AI", "http://www.tara.ai", 13, ["Founding Account Executive"]),
    c("Tara", "https://tara.ai/", 13, ["Founding Account Executive"]),
  ], SIZE);
  assertEquals(r.unique_companies, 1, "one company cannot take two shortlist slots");
});

// ═══════ M1-M6. THE IDENTITY MATCHER, against the run that lost five leads ══
//
// Task 9e86eb24: ten identity searches, EIGHT of which returned rows, and only
// three accepted matches. `provider_attempts` recorded rows of 5,5,5,5,2,5,3,5
// and two genuine empties — so five paid searches found the company and the
// matcher threw the answer away.
//
// The rule was right: a bare name match is not an identity. The EVIDENCE it
// accepted was not. Both tests were substrings against prose:
//
//   hay.includes("retellai")   — a description writes it "Retell AI"
//   hay.includes("usesimple")  — cannot appear in prose at all
//   hay.includes(one_liner.slice(0, 24))
//                              — 24 verbatim characters shared between a YC
//                                one-liner and a LinkedIn description
//
// `candidate.linkedinUrl` was on the input type and never read, and it is the
// one independent signal available: the slug is chosen on LinkedIn, the domain
// comes from YC, and neither is derived from the other.

/** A prequalified company, as the identity stage holds it. */
const co = (name: string, domain: string, oneLiner = "") => ({
  name, canonical_domain: domain, one_liner: oneLiner,
} as never);

Deno.test("M1. THE FIVE THAT WERE LOST: slug and domain agree, so the name stands", () => {
  // Every pair here is a real company from the run, with the LinkedIn slug it
  // actually uses. All five were rejected before this change.
  const cases: Array<[string, string, string]> = [
    ["Retell AI", "retellai.com", "https://www.linkedin.com/company/retell-ai"],
    ["Sixtyfour", "sixtyfour.ai", "https://www.linkedin.com/company/sixtyfour"],
    ["Artisan", "artisan.co", "https://www.linkedin.com/company/artisan"],
    ["Reacher", "reacherapp.com", "https://www.linkedin.com/company/reacher"],
    ["idler", "idler.ai", "https://www.linkedin.com/company/idler"],
  ];
  for (const [name, domain, linkedinUrl] of cases) {
    const r = acceptLinkedInMatch(co(name, domain), {
      name, linkedinUrl, website: null, description: "AI startup", location: "San Francisco, CA",
    });
    assert(r.accepted, `${name}: ${r.reason}`);
    assertEquals(r.strength, "name_plus_evidence");
  }
});

Deno.test("M2. the slugs that actually resolved keep resolving", () => {
  // Taken from `identity_restored_from_resume` on earlier runs — real pairs
  // where the domain and the slug shorten differently in each direction.
  const cases: Array<[string, string, string]> = [
    ["Godela", "godela.ai", "https://www.linkedin.com/company/godela-ai"],   // slug longer
    ["AgentMail", "agentmail.to", "https://www.linkedin.com/company/agentmailto"],
    ["Reacher", "reacherapp.com", "https://www.linkedin.com/company/reacher"], // domain longer
  ];
  for (const [name, domain, url] of cases) {
    assert(acceptLinkedInMatch(co(name, domain), { name, linkedinUrl: url }).accepted, name);
  }
});

Deno.test("M3. a bare name is STILL not an identity", () => {
  // The rule this whole gate exists for, unchanged. Same name, a slug that has
  // nothing to do with our domain.
  const wrong = acceptLinkedInMatch(co("Apollo", "apollographql.com"), {
    name: "Apollo", website: "https://apollo.io",
    linkedinUrl: "https://www.linkedin.com/company/apollo-io",
    description: "sales intelligence platform", location: "San Francisco, CA",
  });
  assertFalse(wrong.accepted, "a different Apollo must not be accepted");
  assertEquals(wrong.strength, "rejected_weak");

  // And with no corroborating field at all.
  const bare = acceptLinkedInMatch(co("Magic", "getmagic.com"), { name: "Magic" });
  assertFalse(bare.accepted);
});

Deno.test("M4. short tokens are not evidence", () => {
  // Two-letter TLD-ish fragments must not agree with everything. `co` is also
  // the reason `tokensAgree` has a floor.
  assertEquals(linkedInSlugToken("https://www.linkedin.com/company/ai"), "ai");
  const r = acceptLinkedInMatch(co("Hub", "hub.co"), {
    name: "Hub", linkedinUrl: "https://www.linkedin.com/company/hub-labs",
  });
  assertFalse(r.accepted, "a three-character domain token may not corroborate");
});

Deno.test("M5. the two genuinely ambiguous ones are still rejected", () => {
  // HONEST ABOUT THE LIMIT. Where the domain and the LinkedIn name share
  // nothing, this change does not invent a match — these stay unresolved and
  // resumable rather than being resolved to a guess.
  for (const [name, domain, slug] of [
    ["Simple AI", "usesimple.ai", "simple-ai"],
    ["David AI", "withdavid.ai", "david-ai"],
  ] as const) {
    const r = acceptLinkedInMatch(co(name, domain), {
      name, linkedinUrl: `https://www.linkedin.com/company/${slug}`,
    });
    assertFalse(r.accepted, `${name} has no independent corroboration and must stay unresolved`);
  }
});

Deno.test("M6. prose corroboration is compared as tokens, and domain still wins", () => {
  // "Retell AI" in a description now corroborates the domain `retellai`.
  const prose = acceptLinkedInMatch(co("Retell AI", "retellai.com"), {
    name: "Retell AI", linkedinUrl: null,
    description: "Retell AI builds voice agents", location: "San Francisco",
  });
  assert(prose.accepted, prose.reason);

  // An exact domain is still the strongest and is still checked first.
  const exact = acceptLinkedInMatch(co("Retell AI", "retellai.com"), {
    name: "Something Else", website: "https://www.retellai.com/",
  });
  assert(exact.accepted);
  assertEquals(exact.strength, "domain_exact");
});
