// COMPANY-FIRST MUST FINISH AT CONTACTS, NOT AT ACCOUNTS.
//
// The production run reviewed 21 jobs, accepted 2 companies, reported
// CONTACT-ready = 0 and "Needs contact = 2", then stopped and recommended the
// manual "Find decision-makers" action — while displaying "Found 2 of 5".
//
// ROOT CAUSE, confirmed in code: `buildPeopleScope` returns null for a company
// with only a weak (name) identity — correctly, because a name-only people
// search returns the wrong people. The defect was the `.filter()` that followed
// in the pipeline's stage 4: the company simply VANISHED from the run. No
// search, no candidate, no counter, no explanation. Downstream it reappeared as
// an account row, so zero contact-ready people looked like progress.
//
// The refusal to search is kept. The silence is what these tests remove.
//
// PURE. No provider, model, network or database access.

import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runCompoundSourcing, assertDecisionMakerRole, decisionMakerTitlesFor,
  type CompoundJob, type CompoundPerson,
} from "../../supabase/functions/_shared/compoundSourcingPipeline.ts";
import { isQuotaEligibleCandidate } from "../../supabase/functions/_shared/leadQuotaPolicy.ts";
import type { CompanyBrainHardConstraints } from "../../supabase/functions/_shared/companyIcpFilter.ts";

const NOW = "2026-07-27T00:00:00.000Z";

const BRAIN: CompanyBrainHardConstraints = {
  positive_industries: ["b2b saas", "saas"], business_models: ["saas"],
  allowed_stages: ["pre-seed", "seed", "series a"],
  min_employees: 5, max_employees: 200,
  require_founder_led: true, unknown_evidence: "research", strict_industry: true,
};

const INTENT = {
  company_gate_required: true, hiring_signal_required: true,
  geographies: ["United States"], company_categories: ["saas"],
  requested_person_role: "founder",
  original_user_instruction: "Find founders of SaaS startups hiring Sales Operations in the United States.",
} as never;

/** A qualified company WITH a strong identity (domain + LinkedIn). */
function scopeableJob(company: string): CompoundJob {
  return {
    title: "Sales Operations Lead", company,
    companyDomain: `${company.toLowerCase()}.com`,
    companyWebsite: `https://${company.toLowerCase()}.com`,
    companyLinkedinUrl: `https://linkedin.com/company/${company.toLowerCase()}`,
    companyDescription: "B2B SaaS company", industries: ["B2B SaaS"],
    location: "San Francisco, CA", url: `https://jobs.example/${company.toLowerCase()}`,
    descriptionExcerpt: "Own revenue operations.",
    companyEmployeeCount: 40, companyStage: "seed",
    companyBusinessModel: "SaaS", companyFounderLed: true,
  };
}

/** A qualified company with ONLY a name — the production shape that vanished. */
function nameOnlyJob(company: string): CompoundJob {
  return {
    ...scopeableJob(company),
    companyDomain: null, companyWebsite: null, companyLinkedinUrl: null,
  };
}

const FOUNDER: CompoundPerson = {
  name: "A Founder", title: "Founder & CEO", linkedinUrl: "https://linkedin.com/in/afounder",
  currentCompany: "Bloom", currentCompanyDomain: "bloom.com", isCurrent: true,
};
const EMPLOYEE: CompoundPerson = {
  name: "An Employee", title: "Sales Operations Manager", linkedinUrl: "https://linkedin.com/in/anemployee",
  currentCompany: "Bloom", currentCompanyDomain: "bloom.com", isCurrent: true,
};
const EX_FOUNDER: CompoundPerson = {
  name: "Ex Founder", title: "Founder", linkedinUrl: "https://linkedin.com/in/exfounder",
  currentCompany: "Somewhere Else", currentCompanyDomain: "elsewhere.com", isCurrent: false,
  endDate: "2024-01-01",
};

function deps(jobs: CompoundJob[], people: CompoundPerson[] = [FOUNDER]) {
  const calls: Array<{ company: string | null; scopedBy: string; role: string | null }> = [];
  return {
    calls,
    d: {
      fetchJobs: () => jobs,
      fetchPeopleForCompany: (scope: { companyName?: string | null; scopedBy?: string; requestedRole?: string | null }) => {
        calls.push({ company: scope.companyName ?? null, scopedBy: String(scope.scopedBy), role: scope.requestedRole ?? null });
        return people;
      },
    },
  };
}

const run = (jobs: CompoundJob[], people?: CompoundPerson[]) => {
  const { d, calls } = deps(jobs, people);
  return runCompoundSourcing(INTENT, d as never, {
    now: NOW, brainConstraints: BRAIN, brainPolicyHash: "policy-1",
  }).then((r) => ({ r, calls }));
};

// ====================================== the workflow reaches the people stage ===

Deno.test("C1 a qualified-lead mission reaches decision-maker search automatically", async () => {
  const { r, calls } = await run([scopeableJob("Bloom")]);
  assertEquals(r.diagnostics.decisionMaker.qualifiedCompanies, 1);
  assertEquals(r.diagnostics.decisionMaker.searchesPlanned, 1);
  assertEquals(r.diagnostics.decisionMaker.searchesExecuted, 1);
  assertEquals(calls.length, 1, "no manual step is required to search decision-makers");
});

Deno.test("C2 it does not stop after company qualification", async () => {
  const { r } = await run([scopeableJob("Bloom")]);
  assert(r.candidates.length > 0, "company qualification is not the end of the run");
  assertEquals(r.diagnostics.decisionMaker.contactReady, 1);
});

// ============================ the silent drop is now visible and never counts ===

Deno.test("C3 an unscopeable qualified company is PENDING, not silently dropped", async () => {
  const { r, calls } = await run([nameOnlyJob("BrainCo")]);

  assertEquals(calls.length, 0, "a name-only company must not be people-searched");
  assertEquals(r.diagnostics.decisionMaker.pendingIdentity, 1);
  assertEquals(r.pendingDecisionMakers.length, 1, "it must be REPORTED, not vanish");
  assertEquals(r.pendingDecisionMakers[0].reason, "company_identity_insufficient_for_scoped_search");
  assertEquals(r.pendingDecisionMakers[0].company.name, "BrainCo");
});

Deno.test("C4 a pending company produces NO candidate and cannot satisfy quota", async () => {
  const { r } = await run([nameOnlyJob("BrainCo")]);
  assertEquals(r.candidates.length, 0, "a pending company is not a lead");
  assertEquals(r.diagnostics.decisionMaker.contactReady, 0);
  for (const c of r.candidates) assertEquals(isQuotaEligibleCandidate(c, "contact_only"), false);
});

Deno.test("C5 the production shape: 2 qualified companies, 0 contact-ready", async () => {
  // Exactly the reported run — both companies unscopeable.
  const { r, calls } = await run([nameOnlyJob("BrainCo"), nameOnlyJob("Acme")]);
  assertEquals(r.diagnostics.decisionMaker.qualifiedCompanies, 2);
  assertEquals(r.diagnostics.decisionMaker.pendingIdentity, 2);
  assertEquals(r.diagnostics.decisionMaker.contactReady, 0);
  assertEquals(calls.length, 0);
  // The honest statement is "2 qualified companies, 0 of 5 contact-ready".
  assertEquals(r.candidates.filter((c) => isQuotaEligibleCandidate(c, "contact_only")).length, 0);
});

// =========================================================== role separation ===

Deno.test("C6 decision-maker titles are Founder / Co-Founder / CEO", () => {
  assertEquals(decisionMakerTitlesFor("founder"), ["Founder", "Co-Founder", "CEO"]);
  assertEquals(decisionMakerTitlesFor("CEO"), ["Founder", "Co-Founder", "CEO"]);
  assertEquals(decisionMakerTitlesFor(null), ["Founder", "Co-Founder", "CEO"]);
});

Deno.test("C7 a HIRING role can never be used as a person title", () => {
  for (const bad of [
    "Sales Operations", "Revenue Operations", "GTM Operations",
    "Sales Ops", "SDR", "BDR", "Account Executive",
  ]) {
    assertThrows(() => assertDecisionMakerRole(bad), Error, "decision_maker_role_contaminated");
  }
  // Legitimate decision-maker roles pass.
  for (const ok of ["founder", "co-founder", "CEO", "owner"]) assertDecisionMakerRole(ok);
});

Deno.test("C8 the executed searches carry the decision-maker role, not the hiring role", async () => {
  const { r, calls } = await run([scopeableJob("Bloom")]);
  assertEquals(calls[0].role, "founder");
  assert(!/sales operations/i.test(String(calls[0].role)), "hiring title must not reach the people query");
  assertEquals(r.diagnostics.decisionMaker.roleTitlesUsed, ["Founder", "Co-Founder", "CEO"]);
});

// ======================================================== company scoping ===

Deno.test("C9 every executed people search is company-scoped by a strong identity", async () => {
  const { r, calls } = await run([scopeableJob("Bloom"), scopeableJob("Vanta")]);
  assertEquals(calls.length, 2);
  for (const call of calls) {
    assert(["linkedin_id", "linkedin_url", "domain"].includes(call.scopedBy), `weak scope: ${call.scopedBy}`);
    assert(call.company, "a scoped search always names its company");
  }
  assertEquals(Object.keys(r.diagnostics.decisionMaker.scopedBy).length > 0, true);
});

// =============================================== employer verification gates ===

Deno.test("C10 a verified current Founder at the qualified company becomes CONTACT", async () => {
  const { r } = await run([scopeableJob("Bloom")], [FOUNDER]);
  const c = r.candidates[0];
  assertEquals(c.employer.outcome, "verified_match");
  assertEquals(c.verdict, "CONTACT");
  assertEquals(isQuotaEligibleCandidate(c, "contact_only"), true);
  assertEquals(r.diagnostics.decisionMaker.employerVerified, 1);
});

Deno.test("C11 the right company but the WRONG role is rejected", async () => {
  const { r } = await run([scopeableJob("Bloom")], [EMPLOYEE]);
  const c = r.candidates[0];
  assertEquals(c.gates.person_role, "fail");
  assertEquals(c.verdict, "REJECT");
  assertEquals(isQuotaEligibleCandidate(c, "contact_only"), false);
});

Deno.test("C12 a HISTORICAL founder who left does not count", async () => {
  const { r } = await run([scopeableJob("Bloom")], [EX_FOUNDER]);
  const c = r.candidates[0];
  assert(c.employer.outcome !== "verified_match", `got ${c.employer.outcome}`);
  assert(c.verdict !== "CONTACT", "a former founder is not a contact-ready lead");
  assertEquals(isQuotaEligibleCandidate(c, "contact_only"), false);
});

// ================================================== contact-only quota rules ===

Deno.test("C13 only CONTACT satisfies a contact-only quota", () => {
  assertEquals(isQuotaEligibleCandidate({ verdict: "CONTACT" }, "contact_only"), true);
  for (const v of ["WATCH", "NEEDS_REVIEW", "REJECT", "SKIP"]) {
    assertEquals(isQuotaEligibleCandidate({ verdict: v }, "contact_only"), false, v);
  }
});

Deno.test("C14 five verified founders complete a quota of five", async () => {
  const jobs = ["Bloom", "Vanta", "Ramp", "Linear", "Merge"].map(scopeableJob);
  const { d } = deps(jobs);
  // Each company returns its own current founder.
  const withFounder = {
    fetchJobs: () => jobs,
    fetchPeopleForCompany: (scope: { companyName?: string | null; companyDomain?: string | null }) => [{
      name: `${scope.companyName} Founder`, title: "Founder & CEO",
      linkedinUrl: `https://linkedin.com/in/${String(scope.companyName).toLowerCase()}-founder`,
      currentCompany: scope.companyName ?? null, currentCompanyDomain: scope.companyDomain ?? null, isCurrent: true,
    }],
  };
  void d;
  const r = await runCompoundSourcing(INTENT, withFounder as never, {
    now: NOW, brainConstraints: BRAIN, brainPolicyHash: "policy-1",
  });
  const eligible = r.candidates.filter((c) => isQuotaEligibleCandidate(c, "contact_only"));
  assertEquals(eligible.length, 5, `expected 5 contact-ready, got ${eligible.length}`);
  assertEquals(r.diagnostics.decisionMaker.contactReady, 5);
});

// ============================================ PR #104 enforcement still holds ===

Deno.test("C15 a Notion-shaped company never reaches people search", async () => {
  const notion: CompoundJob = { ...scopeableJob("Notion"), companyEmployeeCount: 7337, companyStage: "series c" };
  const { r, calls } = await run([notion, scopeableJob("Bloom")]);
  assert(!calls.some((c) => String(c.company).toLowerCase().includes("notion")), "no people call for a Brain-rejected company");
  assertEquals(r.diagnostics.companyBrain.blockedBeforePeopleSearch, 1);
  assertEquals(r.diagnostics.decisionMaker.qualifiedCompanies, 1, "only the qualifying company reaches the people stage");
});

Deno.test("C16 a 40-person qualified company DOES reach a scoped founder search", async () => {
  const { r, calls } = await run([scopeableJob("Bloom")]);
  assertEquals(r.diagnostics.companyBrain.hardPass, 1);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].company, "Bloom");
});

// ==================================================== backward compatibility ===

Deno.test("C17 a run with no Brain still reaches the people stage as before", async () => {
  const { d, calls } = deps([scopeableJob("Bloom")]);
  const r = await runCompoundSourcing(INTENT, d as never, { now: NOW });
  assertEquals(r.diagnostics.companyBrain.enforced, false);
  assertEquals(calls.length, 1, "legacy callers are unaffected");
  assertEquals(r.pendingDecisionMakers.length, 0);
});

Deno.test("C18 diagnostics expose the funnel without leaking private data", async () => {
  const { r } = await run([scopeableJob("Bloom"), nameOnlyJob("BrainCo")]);
  const dm = r.diagnostics.decisionMaker;
  assertEquals(dm.qualifiedCompanies, 2);
  assertEquals(dm.searchesPlanned, 1);
  assertEquals(dm.pendingIdentity, 1);
  assertEquals(dm.peopleReturned, 1);
  assertEquals(dm.contactReady, 1);

  const blob = JSON.stringify(r.diagnostics);
  for (const marker of ["api_key", "Bearer", "authorization", "@"]) {
    assert(!blob.toLowerCase().includes(marker.toLowerCase()), `diagnostics leaked ${marker}`);
  }
});

Deno.test("C19 the pipeline's OWN US check understands subnational evidence", async () => {
  // The second US gate in the system. PR #102 fixed the qualified-lead location
  // gate; this one never learned, so "San Francisco, CA" resolved to `unknown`
  // and every verified founder degraded to WATCH — no US company-first run could
  // ever complete its contact quota.
  for (const loc of ["San Francisco, CA", "Dallas, TX", "Remote, US", "Austin, Texas"]) {
    const { r } = await run([{ ...scopeableJob("Bloom"), location: loc }]);
    assertEquals(r.candidates[0]?.gates.us_relevance, "pass", `${loc} should be US`);
    assertEquals(r.candidates[0]?.verdict, "CONTACT", `${loc} should reach CONTACT`);
  }
  // A genuinely foreign job is still refused — and refused EARLIER than this
  // gate: stage 2 drops it before the company is ever formed, so it costs no
  // enrichment and no people call.
  const { r: foreign, calls } = await run([{ ...scopeableJob("Bloom"), location: "Toronto, ON" }]);
  assertEquals(foreign.candidates.length, 0, "a Canadian job must not produce a candidate");
  assertEquals(foreign.diagnostics.droppedJobs, 1);
  assertEquals(calls.length, 0, "and must not cost a people call");
});
