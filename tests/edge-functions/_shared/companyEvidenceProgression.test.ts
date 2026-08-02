// CHANGESET 5 PROOF — company evidence and automatic progression.
//
// Every stage below is the EXISTING production path. Nothing here creates a
// second controller, people-search pathway, enrichment pipeline, persistence
// writer or quota system; the fixtures drive the real one and assert what it
// does with evidence that is present, missing, negative or conflicting.
//
//   provider result -> normalization -> company identity -> company evidence
//     -> Company Brain -> enrichment -> Brain re-evaluation -> qualified account
//     -> people search -> employer verification -> contact enrichment -> CONTACT

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runCompoundSourcing, type CompoundDeps, type CompoundJob, type CompoundPerson,
} from "../../../supabase/functions/_shared/compoundSourcingPipeline.ts";
import { compileLeadEntityIntent } from "../../../supabase/functions/_shared/leadEntityIntent.ts";
import { buildCompoundPersistencePlan } from "../../../supabase/functions/_shared/runAgentCompoundPersistenceAdapter.ts";
import { buildCompanyRowPersistencePlan } from "../../../supabase/functions/_shared/companyRowProjection.ts";
import type { CompanyBrainHardConstraints } from "../../../supabase/functions/_shared/companyIcpFilter.ts";

const NOW = "2026-07-30T00:00:00Z";
const SAAS = "B2B SaaS platform for revenue teams";

const intent = compileLeadEntityIntent(
  "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.",
);

/** A startup-shaped Brain: SaaS, at most 200 people, unknown => research. */
const BRAIN: CompanyBrainHardConstraints = {
  positive_industries: ["saas", "software"],
  business_models: ["saas"],
  max_employees: 200,
  unknown_evidence: "research",
};

/** The same Brain for a workspace that treats missing evidence as a blocker. */
const STRICT_BRAIN: CompanyBrainHardConstraints = { ...BRAIN, unknown_evidence: "reject" };

function job(over: Partial<CompoundJob> & { company: string; domain: string }): CompoundJob {
  const { company, domain, ...rest } = over;
  return {
    title: "Sales Operations Manager",
    company,
    companyDomain: domain,
    companyDescription: SAAS,
    industries: ["SaaS"],
    location: "San Francisco, United States",
    url: `https://linkedin.example/jobs/${domain}`,
    postedDate: "2026-07-20T00:00:00Z",
    ...rest,
  };
}

const founder = (name: string, company: string, domain: string): CompoundPerson => ({
  name, title: "Co-Founder & CEO",
  linkedinUrl: `https://linkedin.com/in/${name.toLowerCase().replace(/\s+/g, "-")}`,
  currentCompany: company, currentCompanyDomain: domain, isCurrent: true,
});

const LIMITS = { rawJobs: 40, verifiedCompanies: 12, founderLookups: 12, foundersPerCompany: 2, ranked: 20 };

function deps(jobs: CompoundJob[], people: Record<string, CompoundPerson[]>): CompoundDeps {
  return {
    fetchJobs: () => jobs,
    fetchPeopleForCompany: (scope) => people[scope.companyDedupeKey ?? ""] ?? [],
  };
}

function run(
  jobs: CompoundJob[],
  people: Record<string, CompoundPerson[]> = {},
  brain: CompanyBrainHardConstraints | null = BRAIN,
) {
  return runCompoundSourcing(intent, deps(jobs, people), {
    now: NOW,
    limits: LIMITS,
    ...(brain ? { brainConstraints: brain } : {}),
  });
}

// -------------------------------------------- source-backed evidence mapping ---

Deno.test("ThisWay Global: source-backed size, industry and description reach Company Brain", async () => {
  const { diagnostics } = await run([
    job({
      company: "ThisWay Global", domain: "thisway.com",
      companyEmployeeCount: 45,
      companyStage: "series a",
      companyBusinessModel: "saas",
      industries: ["SaaS", "HR Technology"],
      companyDescription: "B2B SaaS hiring-intelligence platform",
    }),
  ]);
  assertEquals(diagnostics.companyBrain.evaluated, 1, "Company Brain never saw the company");
  assertEquals(diagnostics.companyBrain.hardPass, 1, "enriched evidence did not produce a pass");
  assertEquals(diagnostics.companyBrain.hardFail, 0);
});

Deno.test("strong identity with missing evidence is PENDING, not an immediate fail", async () => {
  const { diagnostics, pendingDecisionMakers, candidates } = await run([
    // Strong identity + a real hiring signal, but NO headcount, stage or model.
    job({ company: "Evidenceless", domain: "evidenceless.com", industries: [], companyDescription: null }),
  ]);
  assertEquals(diagnostics.companyBrain.hardFail, 0, "unknown was treated as a proven negative");
  assertEquals(diagnostics.companyBrain.evidencePending, 1);
  assertEquals(diagnostics.companyBrain.blockedBeforePeopleSearch, 0, "a pending company was dropped");
  assert(
    pendingDecisionMakers.length + candidates.length > 0,
    "a pending company vanished instead of staying visible",
  );
});

Deno.test("a workspace Brain MAY define missing evidence as a hard blocker", async () => {
  const { diagnostics } = await run(
    [job({ company: "Evidenceless", domain: "evidenceless.com", industries: [], companyDescription: null })],
    {},
    STRICT_BRAIN,
  );
  assertEquals(diagnostics.companyBrain.hardFail, 1, "an explicit reject policy was not honoured");
  assertEquals(diagnostics.companyBrain.blockedBeforePeopleSearch, 1, "a rejected company still cost a people call");
});

Deno.test("a clearly oversized company is deterministically rejected", async () => {
  const { candidates, pendingDecisionMakers, diagnostics } = await run([
    job({ company: "Megacorp", domain: "megacorp.com", companyEmployeeCount: 7337, companyBusinessModel: "saas" }),
  ], { "domain:megacorp.com": [founder("Big Boss", "Megacorp", "megacorp.com")] });
  assertEquals(diagnostics.companyBrain.hardFail, 1);
  const names = [...candidates.map((c) => c.account.name), ...pendingDecisionMakers.map((p) => p.company.name)];
  assertFalse(names.includes("Megacorp"), "an oversized company reached the Workbench");
});

Deno.test("explicit negative evidence and missing evidence are different outcomes", async () => {
  const negative = await run([
    job({ company: "Megacorp", domain: "megacorp.com", companyEmployeeCount: 7337 }),
  ]);
  const missing = await run([
    job({ company: "Evidenceless", domain: "evidenceless.com", industries: [], companyDescription: null }),
  ]);
  assertEquals(negative.diagnostics.companyBrain.hardFail, 1);
  assertEquals(missing.diagnostics.companyBrain.hardFail, 0);
  assertEquals(missing.diagnostics.companyBrain.evidencePending, 1);
});

// ------------------------------------------------- automatic progression -----

Deno.test("a qualified company automatically progresses to a verified founder and CONTACT", async () => {
  const { candidates } = await run(
    [job({ company: "Vanta", domain: "vanta.com", companyEmployeeCount: 120, companyBusinessModel: "saas" })],
    { "domain:vanta.com": [founder("Christina Cacioppo", "Vanta", "vanta.com")] },
  );
  const contact = candidates.find((c) => c.verdict === "CONTACT");
  assert(contact, "a qualified company did not progress to a CONTACT-ready person");
  assertEquals(contact!.employer.outcome, "verified_match", "employer was not deterministically verified");
  assert(contact!.jobEvidence.url, "the CONTACT lost its hiring evidence");

  const plan = buildCompoundPersistencePlan(contact!, "ws-1");
  assertEquals(plan.leadCandidate.raw.quota_eligible, true, "a CONTACT-ready person earned no quota credit");
});

Deno.test("an employer mismatch cannot progress", async () => {
  const { candidates, pendingDecisionMakers } = await run(
    [job({ company: "Census", domain: "getcensus.com", companyEmployeeCount: 80, companyBusinessModel: "saas" })],
    {
      "domain:getcensus.com": [{
        name: "Wrong Person", title: "Founder", linkedinUrl: "https://linkedin.com/in/wrong",
        currentCompany: "SomewhereElse", currentCompanyDomain: "elsewhere.com", isCurrent: true,
      }],
    },
  );
  assertFalse(candidates.some((c) => c.verdict === "CONTACT"), "an unverified employer became CONTACT");
  assertEquals(pendingDecisionMakers.length, 1, "the qualified company stopped being visible");
  const plan = buildCompanyRowPersistencePlan(pendingDecisionMakers[0], "ws-1");
  assertEquals(plan.leadCandidate.raw.quota_eligible, false, "a company row earned quota credit");
  assertEquals(plan.contactBlocked, true);
});

Deno.test("a verified founder with missing contact evidence carries an unresolved contact reference", async () => {
  const { candidates } = await run(
    [job({ company: "Linear", domain: "linear.app", companyEmployeeCount: 90, companyBusinessModel: "saas" })],
    {
      "domain:linear.app": [{
        // Verified employer, but no profile URL and no contact method at all.
        name: "Karri Saarinen", title: "Co-Founder & CEO",
        currentCompany: "Linear", currentCompanyDomain: "linear.app", isCurrent: true,
      }],
    },
  );
  const c = candidates[0];
  assert(c, "a qualified company produced no decision-maker row");
  assertEquals(c.employer.outcome, "verified_match");
  // The employer evidence reference has no URL: contact enrichment is still owed.
  const employerRef = c.evidence.find((e) => e.kind === "employer");
  assertEquals(employerRef?.url, null, "contact evidence was fabricated");
  // Identity falls back to a deterministic name key rather than a fake profile.
  assert(c.personKey.startsWith("name:"), "a missing profile produced an invented identity");
});


Deno.test("sufficient contact evidence becomes CONTACT-ready and counts exactly once", async () => {
  const { candidates } = await run(
    [
      job({ company: "Ramp", domain: "ramp.com", companyEmployeeCount: 150, companyBusinessModel: "saas" }),
      // A second posting at the SAME company must not double-count.
      job({ company: "Ramp", domain: "ramp.com", title: "Revenue Operations Manager", url: "https://indeed.example/jobs/ramp-2" }),
    ],
    { "domain:ramp.com": [founder("Eric Glyman", "Ramp", "ramp.com")] },
  );
  const contacts = candidates.filter((c) => c.verdict === "CONTACT");
  assertEquals(contacts.length, 1, "one company produced more than one CONTACT credit");
  assertEquals(
    buildCompoundPersistencePlan(contacts[0], "ws-1").leadCandidate.raw.quota_eligible,
    true,
  );
});

Deno.test("evidence is never fabricated: an unqualified company gains nothing by being retried", async () => {
  const rows = [job({ company: "Optivas Advisors", domain: "optivas.com", companyDescription: "boutique management consulting and advisory services", industries: ["Consulting"] })];
  const first = await run(rows);
  const second = await run(rows);
  assertEquals(first.diagnostics.companyBrain.hardPass, second.diagnostics.companyBrain.hardPass);
  const names = [...second.candidates.map((c) => c.account.name), ...second.pendingDecisionMakers.map((p) => p.company.name)];
  assertFalse(names.includes("Optivas Advisors"));
});
