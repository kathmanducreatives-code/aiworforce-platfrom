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
  linkedInSearchQueryFor, normalizeDomain, prequalifyYcCompanies,
  shortlistForLinkedInResolution, shortlistSize, type YcCompanyInput,
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

// ═══════════════════════════════ 2/3. the shortlist is capped ══

Deno.test("2. a request for 5 leads caps the shortlist at 10", () => {
  assertEquals(shortlistSize(5), 10);
  assertEquals(shortlistSize(1), 5, "floor of 5");
  assertEquals(shortlistSize(50), 10, "ceiling of 10");
  assertEquals(shortlistSize(0), 5);
  assertEquals(LINKEDIN_RESOLUTION_CONCURRENCY, 2);
});

Deno.test("3. the real run shortlists 7, not 25", () => {
  const sl = shortlistForLinkedInResolution(run(), 5);
  assert(sl.length <= shortlistSize(5));
  assertEquals(sl.length, 7, "only companies with a real commercial signal");
  // The two strongest are the ones a human would pick.
  assertEquals(sl[0].name, "SnapMagic");
  assertEquals(sl[1].name, "Tara AI");
});

// ══════════════════ 4/5/6. technical-only never qualifies, full array read ══

Deno.test("4. technical-only companies are never shortlisted", () => {
  const sl = shortlistForLinkedInResolution(run(), 5).map((x) => x.name);
  for (const technicalOnly of ["Odeko", "Mashgin", "HackerRank", "Mux", "Streak", "Revion", "Hub"]) {
    assertFalse(sl.includes(technicalOnly), `${technicalOnly} hires only engineers — not a GTM signal`);
  }
  assertEquals(run().technical_only_companies, 13);
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
  assertEquals(shortlistForLinkedInResolution(r, 5).length, 0);
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
  assertEquals(linkedInSearchQueryFor(snap), "SnapMagic snapmagic.com");
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
