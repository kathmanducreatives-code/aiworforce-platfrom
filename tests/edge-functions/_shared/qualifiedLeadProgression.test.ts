// AUTOMATIC COMPANY → CONTACT-READY PROGRESSION, through the REAL pipeline.
//
// The brief's rule: the presence of helper modules is not proof. Every assertion
// below runs `runCompoundSourcing` — the function the real controller calls — with
// mocked providers, and checks what the pipeline itself did.
//
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runCompoundSourcing, type CompoundDeps, type CompoundJob, type CompoundPerson } from "../../../supabase/functions/_shared/compoundSourcingPipeline.ts";
import { compileLeadEntityIntent } from "../../../supabase/functions/_shared/leadEntityIntent.ts";

const NOW = "2026-07-24T00:00:00Z";
const intent = compileLeadEntityIntent("Founders of SaaS startups hiring Sales Operations in the United States");
const SAAS = "B2B SaaS analytics platform";

const job = (company: string, domain: string, title = "Sales Operations Manager"): CompoundJob => ({
  title, company, companyDomain: domain, companyDescription: SAAS,
  location: "Austin, United States", url: `https://j/${domain}`,
});

const founder = (company: string, domain: string, o: Partial<CompoundPerson> = {}): CompoundPerson => ({
  name: "A Founder", title: "Co-Founder & CEO", linkedinUrl: `https://linkedin.com/in/${domain}`,
  currentCompany: company, currentCompanyDomain: domain, isCurrent: true, ...o,
});

function deps(jobs: CompoundJob[], people: Record<string, CompoundPerson[]>, order: string[] = []): CompoundDeps {
  return {
    fetchJobs: () => { order.push("jobs"); return jobs; },
    fetchPeopleForCompany: (scope) => {
      order.push(`people:${scope.companyDedupeKey}`);
      return people[scope.companyDedupeKey ?? ""] ?? [];
    },
  };
}

// ================================= 7. PEOPLE SEARCH IS AUTOMATIC ==============

Deno.test("7. a qualified company automatically triggers a people search — no user action", async () => {
  const order: string[] = [];
  const run = await runCompoundSourcing(
    intent,
    deps([job("Acme", "acme.com")], { "domain:acme.com": [founder("Acme", "acme.com")] }, order),
    { now: NOW },
  );
  // The pipeline itself called the people provider for the qualified company.
  assert(order.includes("people:domain:acme.com"), `people search never ran: ${order.join(", ")}`);
  assertEquals(run.diagnostics.decisionMaker.searchesExecuted, 1);
  assert(run.diagnostics.decisionMaker.peopleReturned >= 1);
});

Deno.test("7b. jobs are always fetched before people — company-first ordering holds", async () => {
  const order: string[] = [];
  await runCompoundSourcing(
    intent,
    deps([job("Acme", "acme.com")], { "domain:acme.com": [founder("Acme", "acme.com")] }, order),
    { now: NOW },
  );
  assertEquals(order[0], "jobs");
  assert(order.slice(1).every((o) => o.startsWith("people:")));
});

Deno.test("9. a company that cannot be scoped becomes a visible pending row, not a silent drop", async () => {
  // No domain ⇒ no scoped search is possible.
  const noId: CompoundJob = {
    title: "Sales Operations Manager", company: "Mystery", companyDescription: SAAS,
    location: "Denver, United States", url: "https://j/mys",
  };
  const run = await runCompoundSourcing(intent, deps([noId], {}), { now: NOW });
  assert(run.pendingDecisionMakers.length >= 1, "an unscopeable company must still surface");
  assertEquals(run.pendingDecisionMakers[0].reason, "company_identity_insufficient_for_scoped_search");
  // And it produced no CONTACT candidate.
  assertFalse(run.candidates.some((c) => c.verdict === "CONTACT"));
});

// ============================ 8,9. DETERMINISTIC ROLE + EMPLOYER GATES =========

Deno.test("8. decision-maker role classification is deterministic and gate-recorded", async () => {
  const run = await runCompoundSourcing(
    intent,
    deps([job("Acme", "acme.com")], {
      "domain:acme.com": [
        founder("Acme", "acme.com"),
        founder("Acme", "acme.com", { name: "An Engineer", title: "Staff Engineer", linkedinUrl: "https://linkedin.com/in/eng" }),
      ],
    }),
    { now: NOW },
  );
  const engineer = run.candidates.find((c) => c.person?.name === "An Engineer");
  assert(engineer, "the non-decision-maker should still be evaluated, not dropped silently");
  assertEquals(engineer!.gates.person_role, "fail");
  assertFalse(engineer!.verdict === "CONTACT");

  const ceo = run.candidates.find((c) => c.person?.name === "A Founder");
  assertEquals(ceo!.gates.person_role, "pass");
});

Deno.test("9/12. an employer MISMATCH cannot progress to CONTACT", async () => {
  const run = await runCompoundSourcing(
    intent,
    deps([job("Vanta", "vanta.com")], {
      "domain:vanta.com": [founder("OtherCorp", "other.com", { name: "Imposter", currentCompany: "OtherCorp", currentCompanyDomain: "other.com" })],
    }),
    { now: NOW },
  );
  const c = run.candidates.find((x) => x.person?.name === "Imposter")!;
  assertEquals(c.gates.employer_match, "fail");
  assertFalse(c.verdict === "CONTACT");
  assertEquals(run.diagnostics.decisionMaker.employerVerified, 0);
  assert(run.diagnostics.decisionMaker.employerMismatch >= 1);
});

Deno.test("9b. a FORMER founder (historical only) cannot progress", async () => {
  const run = await runCompoundSourcing(
    intent,
    deps([job("Acme", "acme.com")], {
      "domain:acme.com": [founder("Acme", "acme.com", { name: "Old Founder", endDate: "2024-01-01", isCurrent: false })],
    }),
    { now: NOW },
  );
  const c = run.candidates.find((x) => x.person?.name === "Old Founder")!;
  assertEquals(c.gates.employer_match, "fail");
  assertFalse(c.verdict === "CONTACT");
});

Deno.test("9c. an AMBIGUOUS employer is not promoted — unknown never counts as pass", async () => {
  const run = await runCompoundSourcing(
    intent,
    deps([job("Beta", "beta.com")], {
      "domain:beta.com": [{ name: "Amb Founder", title: "Founder", linkedinUrl: "https://linkedin.com/in/amb", currentCompany: "Beta" }],
    }),
    { now: NOW },
  );
  const c = run.candidates.find((x) => x.person?.name === "Amb Founder")!;
  assertEquals(c.gates.employer_match, "unknown");
  assertFalse(c.verdict === "CONTACT");
});

// ======================================= 13. ONLY CONTACT-READY COUNTS ========

Deno.test("13. a verified founder at the qualified company reaches CONTACT", async () => {
  const run = await runCompoundSourcing(
    intent,
    deps([job("Acme", "acme.com")], { "domain:acme.com": [founder("Acme", "acme.com")] }),
    { now: NOW },
  );
  const c = run.candidates.find((x) => x.person?.name === "A Founder")!;
  assertEquals(c.gates.employer_match, "pass");
  assertEquals(c.gates.person_role, "pass");
  assertEquals(c.gates.company_brain, "pass");
  assertEquals(c.verdict, "CONTACT");
  assertEquals(run.diagnostics.decisionMaker.employerVerified, 1);
});

Deno.test("13b. WATCH / NEEDS_REVIEW / REJECT candidates never carry a CONTACT verdict", async () => {
  const run = await runCompoundSourcing(
    intent,
    deps([job("Acme", "acme.com"), job("Vanta", "vanta.com")], {
      "domain:acme.com": [founder("Acme", "acme.com")],
      "domain:vanta.com": [founder("OtherCorp", "other.com", { name: "Imposter" })],
    }),
    { now: NOW },
  );
  const contacts = run.candidates.filter((c) => c.verdict === "CONTACT");
  assertEquals(contacts.length, 1, "only the verified-employer founder may be CONTACT");
  assertEquals(contacts[0].person?.name, "A Founder");
});

// =============================== 20. PR #127 DIAGNOSTICS REMAIN INTACT ========

Deno.test("20. every evaluated company still produces a diagnostic alongside progression", async () => {
  const run = await runCompoundSourcing(
    intent,
    deps([job("Acme", "acme.com")], { "domain:acme.com": [founder("Acme", "acme.com")] }),
    { now: NOW },
  );
  assert(run.companyDiagnostics.length >= 1, "PR #127 diagnostics must survive");
  for (const d of run.companyDiagnostics) assertEquals(d.quota_eligible, false);
});
