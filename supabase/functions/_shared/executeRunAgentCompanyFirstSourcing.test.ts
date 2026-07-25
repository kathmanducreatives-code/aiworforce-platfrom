// Runtime integration tests for the company-first path — mocked runTool / people
// actor / persistence / clock. ZERO network (run without --allow-net).

import { assertEquals, assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { executeRunAgentCompanyFirstSourcing, type CompanyFirstRuntimeDeps } from "./executeRunAgentCompanyFirstSourcing.ts";
import { isCompanyFirstRequest } from "./runAgentCompoundBridge.ts";
import type { CompoundPersistencePlan } from "./runAgentCompoundPersistenceAdapter.ts";
import { compileLeadEntityIntent } from "./leadEntityIntent.ts";

const NOW = "2026-07-24T00:00:00Z";
const intent = compileLeadEntityIntent("Founders of SaaS startups hiring Sales Operations in the United States");

const jobRow = (o: Record<string, unknown> = {}) => ({ title: "Sales Operations Manager", companyName: "BigID", companyWebsite: "https://bigid.com", companyLinkedinUrl: "https://linkedin.com/company/bigid", location: "New York, United States", jobUrl: "https://j/bigid", descriptionText: "US revenue operations", companyDescription: "B2B SaaS platform", id: "j1", ...o });
const founder = (o: Record<string, unknown> = {}) => ({ fullName: "Dimitri Sirota", headline: "Co-Founder & CEO", linkedinUrl: "https://linkedin.com/in/d", experience: [{ companyName: "BigID", companyUrl: "https://linkedin.com/company/bigid", companyDomain: "bigid.com", title: "Co-Founder & CEO", current: true }], ...o });

interface Harness { order: string[]; peopleInputs: Record<string, unknown>[]; plans: CompoundPersistencePlan[]; deps: CompanyFirstRuntimeDeps }
function harness(jobs: unknown[], peopleByCompanyDomain: Record<string, unknown[]>, opts: { jobsThrow?: boolean } = {}): Harness {
  const order: string[] = []; const peopleInputs: Record<string, unknown>[] = []; const plans: CompoundPersistencePlan[] = [];
  const deps: CompanyFirstRuntimeDeps = {
    // These legacy scenarios assert single-round sourcing behaviour, so the quota
    // is 1: the controller stops as soon as one eligible lead exists (or the
    // search space is exhausted), preserving the original one-batch expectations.
    intent, workspaceId: "ws-1", now: NOW, requestedLeadCount: 1, bounds: { maxRounds: 1 },
    invokeJobs: async () => { order.push("jobs"); if (opts.jobsThrow) throw new Error("boom"); return jobs; },
    // `envelope` = wrapper controls + actor-native fields under `input`.
    invokePeople: async (envelope) => {
      const native = envelope.input as Record<string, unknown>;
      order.push(`people:${native._scope_domain ?? native._scope_key}`);
      peopleInputs.push(native);
      return peopleByCompanyDomain[String(native._scope_domain ?? "")] ?? [];
    },
    persist: async (plan) => { plans.push(plan); return { ok: true, accountId: plan.verdict === "CONTACT" ? "acc-1" : null, contactId: null, leadCandidateId: "lc-1" }; },
  };
  return { order, peopleInputs, plans, deps };
}

Deno.test("1/2/4/6/7. jobs first; people only for verified companies, one per company, scoped", async () => {
  const advisory = jobRow({ companyName: "Optivas Advisors", companyWebsite: "https://optivas.com", companyLinkedinUrl: null, companyDescription: "boutique management advisory for SMB leaders", jobUrl: "https://j/opt", id: "j2" });
  const h = harness([jobRow(), advisory], { "bigid.com": [founder()] });
  const r = await executeRunAgentCompanyFirstSourcing(h.deps);
  assertEquals(h.order[0], "jobs");
  // Jobs may run once per compiled keyword variant, but EVERY jobs call must
  // precede EVERY people call.
  const lastJobs = h.order.lastIndexOf("jobs");
  const firstPeople = h.order.findIndex((o) => o.startsWith("people:"));
  assert(firstPeople === -1 || lastJobs < firstPeople);
  assertFalse(h.order.some((o) => o.includes("optivas"))); // advisory dropped → no people call
  assertEquals(h.order.filter((o) => o.startsWith("people:")).length, 1); // one verified company
  assertEquals(r.status, "completed");
});

Deno.test("5. the scoped people input carries the company LinkedIn URL + role", async () => {
  const h = harness([jobRow()], { "bigid.com": [founder()] });
  await executeRunAgentCompanyFirstSourcing(h.deps);
  const inp = h.peopleInputs[0];
  assert(JSON.stringify(inp.currentCompanies).includes("linkedin.com/company/bigid"));
  // Titles now come from the compiled intent's expanded executive roles.
  assertEquals(inp.currentJobTitles, ["Founder", "Co-Founder", "CEO"]);
  assertEquals(inp.searchQuery, "Founder OR Co-Founder OR CEO");
});

Deno.test("8/11. a verified founder persists as CONTACT with an account id", async () => {
  const h = harness([jobRow()], { "bigid.com": [founder()] });
  const r = await executeRunAgentCompanyFirstSourcing(h.deps);
  const contact = h.plans.find((p) => p.verdict === "CONTACT")!;
  assert(contact.account?.domain === "bigid.com");
  assertEquals(r.counts.contact, 1);
  assert(r.items.some((i) => i.verdict === "CONTACT" && i.accountId === "acc-1"));
});

Deno.test("12/13/15. off-company / historical / evidence-less never persist as CONTACT", async () => {
  const off = harness([jobRow({ companyName: "Vanta", companyWebsite: "https://vanta.com", companyLinkedinUrl: "https://linkedin.com/company/vanta", jobUrl: "https://j/v", id: "jv" })], { "vanta.com": [founder({ experience: [{ companyName: "OtherCorp", companyDomain: "other.com", title: "Founder", current: true }] })] });
  const ro = await executeRunAgentCompanyFirstSourcing(off.deps);
  assertEquals(ro.counts.contact, 0);
  assert(off.plans.every((p) => p.verdict !== "CONTACT"));

  const hist = harness([jobRow({ companyName: "Acme", companyWebsite: "https://acme.com", companyLinkedinUrl: "https://linkedin.com/company/acme", jobUrl: "https://j/a", id: "ja" })], { "acme.com": [founder({ experience: [{ companyName: "Acme", companyDomain: "acme.com", title: "Co-Founder", current: false, endDate: "2023-01-01" }] })] });
  const rh = await executeRunAgentCompanyFirstSourcing(hist.deps);
  assertEquals(rh.counts.contact, 0);
});

Deno.test("16. a generic AE job does not qualify for Sales Operations", async () => {
  const h = harness([jobRow({ title: "Account Executive", descriptionText: "Close new business deals and hit quota.", jobUrl: "https://j/ae" })], { "bigid.com": [founder()] });
  const r = await executeRunAgentCompanyFirstSourcing(h.deps);
  // AE dropped by the job-family gate → no verified companies → quota unmet.
  // The status vocabulary is now the typed terminal set (Part F).
  assert(r.status !== "completed");
  assertEquals(r.counts.contact, 0);
  assertEquals(r.quota.eligible_leads, 0);
});

Deno.test("17/19. jobs failure → provider_failure, ZERO people, no fallback", async () => {
  const h = harness([jobRow()], { "bigid.com": [founder()] }, { jobsThrow: true });
  const r = await executeRunAgentCompanyFirstSourcing(h.deps);
  assertEquals(r.status, "provider_failure");   // was "sourcing_failed"
  assertFalse(h.order.some((o) => o.startsWith("people:")));
});

Deno.test("18. no qualifying companies → zero people lookups", async () => {
  const advisoryOnly = jobRow({ companyName: "Optivas Advisors", companyDescription: "management advisory firm", jobUrl: "https://j/opt", id: "j2" });
  const h = harness([advisoryOnly], {});
  const r = await executeRunAgentCompanyFirstSourcing(h.deps);
  assert(r.status !== "completed");
  assertEquals(r.quota.eligible_leads, 0);
  assertFalse(h.order.some((o) => o.startsWith("people:")));
});

Deno.test("22/24/25. duplicate company/person collapse; input order is deterministic", async () => {
  const h1 = harness([jobRow({ jobUrl: "https://j/1" }), jobRow({ title: "Revenue Operations Manager", jobUrl: "https://j/2" })], { "bigid.com": [founder()] });
  const r1 = await executeRunAgentCompanyFirstSourcing(h1.deps);
  assertEquals(r1.counts.verifiedCompanies, 1); // two BigID jobs → one company
  const h2 = harness([jobRow({ title: "Revenue Operations Manager", jobUrl: "https://j/2" }), jobRow({ jobUrl: "https://j/1" })], { "bigid.com": [founder()] });
  const r2 = await executeRunAgentCompanyFirstSourcing(h2.deps);
  assertEquals(r1.counts.contact, r2.counts.contact);
});

Deno.test("30/31. result matches the contract + reports the executed mode", async () => {
  const h = harness([jobRow()], { "bigid.com": [founder()] });
  const r = await executeRunAgentCompanyFirstSourcing(h.deps);
  assertEquals(r.executed_sourcing_mode, "company_first");
  assertEquals(r.routing.company_first, true);
  assert(typeof r.counts.verifiedCompanies === "number");
  assert(Array.isArray(r.items));
});

Deno.test("27/28/29. routing decision leaves pure person/company/job-seeker as NOT company-first", () => {
  assertFalse(isCompanyFirstRequest(compileLeadEntityIntent("find founders in Austin")));
  assertFalse(isCompanyFirstRequest(compileLeadEntityIntent("Sales Operations candidates looking for work")));
  assert(isCompanyFirstRequest(intent)); // the compound one IS company-first
});

Deno.test("34. people-lookup count cannot exceed the verified-company count", async () => {
  const jobs = [jobRow(), jobRow({ companyName: "Vanta", companyWebsite: "https://vanta.com", companyLinkedinUrl: "https://linkedin.com/company/vanta", title: "Revenue Operations Manager", jobUrl: "https://j/v", id: "jv" })];
  const h = harness(jobs, { "bigid.com": [founder()], "vanta.com": [founder({ fullName: "C", experience: [{ companyName: "Vanta", companyDomain: "vanta.com", title: "Founder", current: true }] })] });
  const r = await executeRunAgentCompanyFirstSourcing(h.deps);
  const peopleCalls = h.order.filter((o) => o.startsWith("people:")).length;
  assert(peopleCalls <= r.counts.verifiedCompanies);
});
