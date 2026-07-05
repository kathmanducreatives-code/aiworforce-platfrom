import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyRole,
  posterHintToDecisionMaker,
  extractBuyerCluesFromDescription,
  personHintsToDecisionMakers,
  peopleContactsToDecisionMakers,
  matchEmailToPerson,
  buildDecisionMakers,
} from "./decisionMakers.ts";
import type { PersonHint, ContactEvidence } from "./companyEnrichment.ts";

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

Deno.test("peopleContactsToDecisionMakers requires name + linkedin url (never fabricates)", () => {
  const dms = peopleContactsToDecisionMakers([
    { name: "Jane Doe", title: "Head of Growth", linkedin_url: "https://www.linkedin.com/in/janedoe" },
    { name: "No Url", title: "CEO", linkedin_url: null },
  ]);
  assertEquals(dms.length, 1);
  assertEquals(dms[0].confidence, "medium"); // revenue_growth tier
});
