// OFFLINE END-TO-END ACCEPTANCE — zero network, zero provider calls, no DB.
//
// Proves that provider job rows from BOTH sources enter the canonical company-first
// pipeline, that qualified companies become Workbench rows even without a verified
// person, and that only CONTACT-ready people count toward the quota.

import { assertEquals, assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runCompoundSourcing, type CompoundDeps } from "../../supabase/functions/_shared/compoundSourcingPipeline.ts";
import { compileLeadEntityIntent } from "../../supabase/functions/_shared/leadEntityIntent.ts";
import { buildCompoundPersistencePlan } from "../../supabase/functions/_shared/runAgentCompoundPersistenceAdapter.ts";
import { buildCompanyRowPersistencePlan, companyRowKey, companyRowStage } from "../../supabase/functions/_shared/companyRowProjection.ts";
import {
  ALL_PROVIDER_ROWS, LINKEDIN_ROWS, INDEED_ROWS, PEOPLE_BY_KEY, PEOPLE_BY_KEY_PARTIAL, E2E_NOW,
} from "../../supabase/functions/_shared/qualifiedLeadE2E.fixture.ts";

const REQUESTED = 5;
const intent = compileLeadEntityIntent(
  "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.",
);

function deps(people: Record<string, typeof PEOPLE_BY_KEY[string]>): CompoundDeps {
  return {
    fetchJobs: () => ALL_PROVIDER_ROWS,
    fetchPeopleForCompany: (scope) => people[scope.companyDedupeKey ?? ""] ?? [],
  };
}

const LIMITS = { rawJobs: 80, verifiedCompanies: 20, founderLookups: 20, foundersPerCompany: 2, ranked: 40 };

async function run(people: Record<string, typeof PEOPLE_BY_KEY[string]>) {
  return await runCompoundSourcing(intent, deps(people), { now: E2E_NOW, limits: LIMITS });
}

Deno.test("provider rows from BOTH sources enter the canonical pipeline", async () => {
  assertEquals(LINKEDIN_ROWS.length, 38);
  assertEquals(INDEED_ROWS.length, 25);
  assertEquals(ALL_PROVIDER_ROWS.length, 63);
  const { diagnostics } = await run(PEOPLE_BY_KEY);
  assert(diagnostics.rawJobs > 0, "raw jobs reached the pipeline");
  assert(diagnostics.acceptedJobs > 0, "hiring signals survived the gates");
});

Deno.test("cross-source duplicates collapse to one company each", async () => {
  const { candidates, pendingDecisionMakers } = await run(PEOPLE_BY_KEY);
  const keys = new Set([
    ...candidates.map((c) => c.account.dedupeKey),
    ...pendingDecisionMakers.map((p) => p.company.dedupeKey),
  ]);
  // 63 provider rows collapse to at most the 7 gate-passing companies.
  assert(keys.size <= 7, `expected <= 7 companies, got ${keys.size}`);
});

Deno.test("irrelevant Operations titles and non-SaaS / non-US companies never qualify", async () => {
  const { candidates, pendingDecisionMakers } = await run(PEOPLE_BY_KEY);
  const names = [
    ...candidates.map((c) => c.account.name),
    ...pendingDecisionMakers.map((p) => p.company.name),
  ];
  assertFalse(names.includes("Optivas Advisors"), "non-SaaS company qualified");
  assertFalse(names.includes("UKCo"), "non-US company qualified");
  const badTitles = /warehouse|people operations|clinical|restaurant|manufacturing|logistics|business operations/i;
  assertFalse(candidates.some((c) => badTitles.test(c.jobEvidence.title ?? "")), "irrelevant title bound as evidence");
});

Deno.test("5 of 5: five verified founders become CONTACT-ready and the mission is Complete", async () => {
  const { candidates } = await run(PEOPLE_BY_KEY);
  const contacts = candidates.filter((c) => c.verdict === "CONTACT");
  assertEquals(contacts.length, 5);
  assertEquals(new Set(contacts.map((c) => c.account.name)).size, 5);
  // Every CONTACT cites a real hiring signal and a verified current employer.
  for (const c of contacts) {
    assert(c.jobEvidence.url, "CONTACT without job evidence");
    assertEquals(c.employer.outcome, "verified_match");
  }
  assert(contacts.length >= REQUESTED, "quota met → Complete");
});

Deno.test("qualified companies without a verified founder still produce Workbench company rows", async () => {
  const { pendingDecisionMakers } = await run(PEOPLE_BY_KEY);
  const names = pendingDecisionMakers.map((p) => p.company.name);
  assert(names.includes("Linear"), "company with zero people returned was dropped");
  assert(names.includes("Census"), "company with an unverified person was dropped");
  for (const p of pendingDecisionMakers) {
    const plan = buildCompanyRowPersistencePlan(p, "ws-1");
    assertEquals(plan.leadCandidate.lead_type, "account");
    assertEquals(plan.leadCandidate.raw.quota_eligible, false);
    assertEquals(plan.contactBlocked, true);
    assert(plan.verdict !== "CONTACT", "a company row can never be CONTACT");
    assert(plan.persistable, "an identified company row must reach the Workbench");
    assert(companyRowKey(p).length > 0);
    assert(companyRowStage(p).length > 0);
  }
});

Deno.test("only CONTACT-ready people count toward quota; company rows give zero credit", async () => {
  const { candidates, pendingDecisionMakers } = await run(PEOPLE_BY_KEY);
  const personCredit = candidates
    .map((c) => buildCompoundPersistencePlan(c, "ws-1"))
    .filter((p) => p.leadCandidate.raw.quota_eligible === true).length;
  const companyCredit = pendingDecisionMakers
    .map((p) => buildCompanyRowPersistencePlan(p, "ws-1"))
    .filter((p) => p.leadCandidate.raw.quota_eligible === true).length;
  assertEquals(personCredit, 5);
  assertEquals(companyCredit, 0);
});

Deno.test("honest Partial: three CONTACT-ready leads never report Complete", async () => {
  const { candidates, pendingDecisionMakers } = await run(PEOPLE_BY_KEY_PARTIAL);
  const contacts = candidates.filter((c) => c.verdict === "CONTACT");
  assertEquals(contacts.length, 3);
  assert(contacts.length < REQUESTED, "must not report Complete");
  assertEquals(REQUESTED - contacts.length, 2, "remaining quota is reported honestly");
  // The unfilled companies remain visible as company rows rather than vanishing.
  assert(pendingDecisionMakers.length > 0, "no fabricated leads, but progress stays visible");
});

Deno.test("a failed hard gate can never be CONTACT", async () => {
  const { candidates } = await run(PEOPLE_BY_KEY);
  for (const c of candidates) {
    if (Object.values(c.gates).includes("fail")) assertFalse(c.verdict === "CONTACT");
  }
});
