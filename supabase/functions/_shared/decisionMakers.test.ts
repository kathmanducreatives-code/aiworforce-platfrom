import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyRole,
  posterHintToDecisionMaker,
  extractBuyerCluesFromDescription,
  personHintsToDecisionMakers,
  peopleContactsToDecisionMakers,
  matchEmailToPerson,
  buildDecisionMakers,
  verifyCompanyMatch,
  type CompanyRef,
} from "./decisionMakers.ts";
import type { PersonHint, ContactEvidence } from "./companyEnrichment.ts";

// ---- Bug #1: company verification for people-search results ----
const cekura: CompanyRef = { name: "Cekura", domain: "cekura.ai", website: "https://www.cekura.ai", companyLinkedinUrl: "https://www.linkedin.com/company/cekuraai?trk=x" };

Deno.test("Bug1 #1: Founder + matching company LinkedIn URL → verified → high", () => {
  const { accepted } = peopleContactsToDecisionMakers([
    { name: "Sid Kabra", title: "Co-Founder", linkedin_url: "https://linkedin.com/in/sidkabra", company: "Cekura", company_url: "https://www.linkedin.com/company/cekuraai" },
  ], cekura);
  assertEquals(accepted[0].company_match.status, "verified");
  assertEquals(accepted[0].confidence, "high");
  assert(!/at this company/i.test(accepted[0].why_this_person));
});

Deno.test("Bug1 #2: Founder + matching domain → verified → high", () => {
  const { accepted } = peopleContactsToDecisionMakers([
    { name: "A B", title: "CEO", linkedin_url: "https://linkedin.com/in/ab", company_url: "https://cekura.ai/team" },
  ], cekura);
  assertEquals(accepted[0].company_match.status, "verified");
  assertEquals(accepted[0].confidence, "high");
});

Deno.test("Bug1 #3: Founder + only matching company NAME → likely (verify before outreach)", () => {
  const { accepted } = peopleContactsToDecisionMakers([
    { name: "C D", title: "Founder", linkedin_url: "https://linkedin.com/in/cd", company: "Cekura Inc" },
  ], cekura);
  assertEquals(accepted[0].company_match.status, "likely");
  assert(/verify/i.test(accepted[0].why_this_person));
});

Deno.test("Bug1 #4: Founder from unrelated company → rejected, not a decision-maker", () => {
  const { accepted, rejected } = peopleContactsToDecisionMakers([
    { name: "Randeep Chopra", title: "Founder", linkedin_url: "https://linkedin.com/in/randeep", company: "Immigration Advisors" },
  ], cekura);
  assertEquals(accepted.length, 0);
  assertEquals(rejected.length, 1);
  assert(/does not match/i.test(rejected[0].reason));
});

Deno.test("Bug1 #5: 'Founder, Immigration Specialist' off-company is not a Cekura buyer", () => {
  const { accepted, rejected } = peopleContactsToDecisionMakers([
    { name: "X Y", title: "Founder, Immigration Specialist", linkedin_url: "https://linkedin.com/in/xy", company: "Some Law Firm" },
  ], cekura);
  assertEquals(accepted.length, 0);
  assert(rejected.some((r) => r.name === "X Y"));
});

Deno.test("Bug1 #6: no-match wording is honest — never 'at this company'", () => {
  const { rejected } = peopleContactsToDecisionMakers([
    { name: "Mark Anderson", title: "Founder", linkedin_url: "https://linkedin.com/in/mark", company: "MBH Fund II" },
  ], cekura);
  assert(!/at this company/i.test(rejected[0].reason));
  assert(/discarded/i.test(rejected[0].reason));
});

Deno.test("Bug1 #7: mixed batch — only company-matched people persist", () => {
  const res = buildDecisionMakers({
    company: cekura,
    peopleSearch: [
      { name: "Real Founder", title: "CEO", linkedin_url: "https://linkedin.com/in/real", company_url: "https://www.linkedin.com/company/cekuraai" },
      { name: "Fake Founder", title: "Founder", linkedin_url: "https://linkedin.com/in/fake", company: "Other Co" },
    ],
  });
  assertEquals(res.decision_makers.map((d) => d.name), ["Real Founder"]);
  assertEquals(res.rejected.map((r) => r.name), ["Fake Founder"]);
});

Deno.test("verifyCompanyMatch: weak headline mention needs verification; recruiter never high", () => {
  const weak = verifyCompanyMatch(cekura, { company: "Freelance", headline: "Advisor to Cekura and others" });
  assertEquals(weak.status, "weak");
  const { accepted } = peopleContactsToDecisionMakers([
    { name: "R P", title: "Technical Recruiter", linkedin_url: "https://linkedin.com/in/rp", company_url: "https://www.linkedin.com/company/cekuraai" },
  ], cekura);
  assertEquals(accepted[0].confidence, "low"); // verified company but recruiter → still low
});

Deno.test("classifyRole: founder/growth are buyers, recruiter/HR are not", () => {
  assertEquals(classifyRole("Co-Founder & CEO").tier, "founder");
  assert(classifyRole("Co-Founder & CEO").isBuyer);
  assertEquals(classifyRole("Head of Revenue").tier, "revenue_growth");
  assert(classifyRole("VP of Sales").isBuyer);
  assertEquals(classifyRole("Technical Recruiter").tier, "recruiter");
  assert(!classifyRole("Technical Recruiter").isBuyer);
  assertEquals(classifyRole("Talent Acquisition Partner").isBuyer, false);
});

Deno.test("Test 1: founder job poster → high-confidence decision-maker (job_poster)", () => {
  const dm = posterHintToDecisionMaker(
    { name: "Jane Doe", profile_url: "https://www.linkedin.com/in/janedoe", title: "Co-Founder & CEO" },
    "Founding Account Executive",
  )!;
  assertEquals(dm.source, "job_poster");
  assertEquals(dm.confidence, "high");
  assertEquals(dm.linkedinUrl, "https://www.linkedin.com/in/janedoe");
  assertEquals(dm.evidence_url, "https://www.linkedin.com/in/janedoe");
  assertEquals(dm.contact_status, "profile_only");
  assertEquals(dm.email, null);
  assert(/founder/i.test(dm.why_this_person));
});

Deno.test("Test 2: recruiter job poster → low-priority hint, NOT the buyer", () => {
  const dm = posterHintToDecisionMaker(
    { name: "Sam Ruiz", profile_url: "https://www.linkedin.com/in/samruiz", title: "Technical Recruiter" },
    "RevOps Lead",
  )!;
  assertEquals(dm.confidence, "low");
  assert(/recruiter|not the buyer/i.test(dm.why_this_person));
});

Deno.test("poster without a profile URL is not fabricated into a contact", () => {
  assertEquals(posterHintToDecisionMaker({ name: "Jane Doe", profile_url: null, title: "CEO" }), null);
  assertEquals(posterHintToDecisionMaker({ name: null, profile_url: "https://x" }), null);
});

Deno.test("Test 3: descriptionText 'Founded by X and Y' + reports-to + first-sales-team clues", () => {
  const clues = extractBuyerCluesFromDescription(
    "Acme was founded by Jane Doe and John Smith. You will be reporting to the Head of Demand Generation while building our first sales team and working directly with leadership.",
  );
  const founders = clues.filter((c) => c.kind === "founder_mention").map((c) => c.person_name);
  assertEquals(founders.sort(), ["Jane Doe", "John Smith"]);
  assert(clues.some((c) => c.kind === "reports_to" && /Demand Generation/i.test(c.role ?? "")));
  assert(clues.some((c) => c.kind === "first_sales_team"));
  assert(clues.some((c) => c.kind === "work_with_leadership"));
});

Deno.test("Test 4-adjacent: firecrawl founder PersonHint → decision-maker with evidence url", () => {
  const hints: PersonHint[] = [
    { name: "Jane Doe", title: "CEO & Co-Founder", source: "firecrawl_team_page", evidence_url: "https://acme.com/team", confidence: "high" },
  ];
  const dms = personHintsToDecisionMakers(hints);
  assertEquals(dms[0].source, "firecrawl_team_page");
  assertEquals(dms[0].evidence_url, "https://acme.com/team");
  assertEquals(dms[0].linkedinUrl, null);
  assertEquals(dms[0].contact_status, "needs_contact_enrichment");
});

Deno.test("Test 8/9: name-matched public email attaches; generic inbox does not; nothing guessed", () => {
  const emails: ContactEvidence[] = [
    { type: "email", value: "jane@acme.com", source_url: "https://acme.com/contact", confidence: "high" },
    { type: "email", value: "hello@acme.com", source_url: "https://acme.com/contact", confidence: "high" },
  ];
  assertEquals(matchEmailToPerson("Jane Doe", emails)?.value, "jane@acme.com");
  assertEquals(matchEmailToPerson("Mark Powers", emails), null); // no guessed pattern
  const hints: PersonHint[] = [{ name: "Jane Doe", title: "Founder", source: "firecrawl_team_page", evidence_url: "https://acme.com/team", confidence: "high" }];
  const dm = personHintsToDecisionMakers(hints, { emails })[0];
  assertEquals(dm.contact_status, "public_email_found");
  assertEquals(dm.email, "jane@acme.com");
  assertEquals(dm.email_source_url, "https://acme.com/contact");
});

Deno.test("buildDecisionMakers: founder poster outranks a people-search sales rep; dedupes", () => {
  const res = buildDecisionMakers({
    poster: { name: "Jane Doe", profile_url: "https://www.linkedin.com/in/janedoe", title: "Founder & CEO" },
    jobTitle: "Founding AE",
    descriptionText: "Founded by Jane Doe. Building our first sales team.",
    enrichment: { founders: [{ name: "Jane Doe", title: "CEO", source: "firecrawl_team_page", evidence_url: "https://acme.com/team", confidence: "high" }] },
    peopleSearch: [{ name: "Bob Rep", title: "Account Executive", linkedin_url: "https://www.linkedin.com/in/bobrep" }],
  });
  // Jane appears from poster + firecrawl but is deduped to one, ranked first.
  assertEquals(res.decision_makers[0].name, "Jane Doe");
  assertEquals(res.decision_makers[0].source, "job_poster");
  assertEquals(res.decision_makers.filter((d) => d.name === "Jane Doe").length, 1);
  assert(!res.needs_manual_review);
  assert(res.buyer_clues.some((c) => c.kind === "first_sales_team"));
});

Deno.test("buildDecisionMakers: only a recruiter poster → needs_manual_review", () => {
  const res = buildDecisionMakers({
    poster: { name: "Sam Ruiz", profile_url: "https://www.linkedin.com/in/samruiz", title: "Recruiter" },
    jobTitle: "RevOps",
  });
  assert(res.needs_manual_review);
  assertEquals(res.decision_makers[0].confidence, "low");
});

Deno.test("peopleContactsToDecisionMakers requires name + linkedin url + company match", () => {
  const lead = { name: "Acme", companyLinkedinUrl: "https://www.linkedin.com/company/acme" };
  const { accepted, rejected } = peopleContactsToDecisionMakers([
    { name: "Jane Doe", title: "Head of Growth", linkedin_url: "https://www.linkedin.com/in/janedoe", company_url: "https://www.linkedin.com/company/acme" },
    { name: "No Url", title: "CEO", linkedin_url: null, company_url: "https://www.linkedin.com/company/acme" },
    { name: "Off Company", title: "Founder", linkedin_url: "https://www.linkedin.com/in/off", company: "Other Inc" },
  ], lead);
  assertEquals(accepted.length, 1);
  assertEquals(accepted[0].name, "Jane Doe");
  assertEquals(accepted[0].confidence, "high");        // revenue_growth + verified company → high
  assert(rejected.some((r) => r.name === "Off Company"));
});
