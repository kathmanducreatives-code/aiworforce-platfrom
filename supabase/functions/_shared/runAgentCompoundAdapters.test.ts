// Contract + orchestration tests for the compound adapters & execution composer.
// Real-shaped rows (keys taken from normalizeApifyJobRow + harvestapi). ZERO network.

import { assertEquals, assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compoundJobsFromRawRows, normalizedJobToCompoundJob } from "./runAgentCompoundJobAdapter.ts";
import { peopleRowToCompoundPerson, compoundPeopleFromRows, buildScopedPeopleInput } from "./runAgentCompoundPeopleAdapter.ts";
import { buildCompoundPersistencePlan } from "./runAgentCompoundPersistenceAdapter.ts";
import { runAgentCompoundExecution } from "./runAgentCompoundExecution.ts";
import { runCompoundSourcing } from "./compoundSourcingPipeline.ts";
import { buildPeopleScope } from "./scopedPeopleSearch.ts";
import { resolveCompanyIdentity } from "./companyIdentity.ts";
import { compileLeadEntityIntent } from "./leadEntityIntent.ts";

const NOW = "2026-07-24T00:00:00Z";
const intent = compileLeadEntityIntent("Founders of SaaS startups hiring Sales Operations in the United States");

// ---- job adapter (real normalizeApifyJobRow input keys) --------------------
const rawJob = (o: Record<string, unknown> = {}) => ({ title: "Sales Operations Manager", companyName: "BigID", companyWebsite: "https://bigid.com", companyLinkedinUrl: "https://linkedin.com/company/bigid", location: "New York, United States", jobUrl: "https://j/bigid", descriptionText: "Own US revenue operations.", companyDescription: "B2B SaaS platform", postedAt: "2026-07-10", id: "job1", ...o });

Deno.test("1/4/5. real job row maps + preserves url/company id/location", () => {
  const { jobs } = compoundJobsFromRawRows([rawJob()], 25);
  assertEquals(jobs.length, 1);
  assertEquals(jobs[0].title, "Sales Operations Manager");
  assertEquals(jobs[0].url, "https://j/bigid");
  assertEquals(jobs[0].companyDomain, "bigid.com");
  assertEquals(jobs[0].location, "New York, United States");
});
Deno.test("2/3. missing title+company → not mapped; missing url → dropped", () => {
  assertEquals(normalizedJobToCompoundJob({ jobTitle: null, company: null } as never), null);
  const { jobs, dropped } = compoundJobsFromRawRows([rawJob({ jobUrl: null, link: null, url: null, applyUrl: null })], 25);
  assertEquals(jobs.length, 0);
  assert(dropped.some((d) => d.reason === "missing_job_url"));
});
Deno.test("8. malformed rows do not crash the run", () => {
  const { jobs } = compoundJobsFromRawRows([null, 123, {}, "x", rawJob()], 25);
  assertEquals(jobs.length, 1);
});
Deno.test("9. job result limit is enforced", () => {
  const { jobs } = compoundJobsFromRawRows([rawJob({ id: "a", jobUrl: "https://j/a" }), rawJob({ id: "b", jobUrl: "https://j/b" }), rawJob({ id: "c", jobUrl: "https://j/c" })], 2);
  assertEquals(jobs.length, 2);
});

// ---- people adapter (harvestapi profile shape) -----------------------------
const rawPerson = (o: Record<string, unknown> = {}) => ({ fullName: "Dimitri Sirota", headline: "Co-Founder & CEO", linkedinUrl: "https://linkedin.com/in/dimitri", experience: [{ companyName: "BigID", companyUrl: "https://linkedin.com/company/bigid", companyDomain: "bigid.com", title: "Co-Founder & CEO", current: true }], ...o });

Deno.test("11/13/14. maps current employment + preserves company + LinkedIn ids", () => {
  const p = peopleRowToCompoundPerson(rawPerson())!;
  assertEquals(p.name, "Dimitri Sirota");
  assertEquals(p.currentCompany, "BigID");
  assertEquals(p.currentCompanyDomain, "bigid.com");
  assertEquals(p.linkedinUrl, "https://linkedin.com/in/dimitri");
  assertEquals(p.isCurrent, true);
});
Deno.test("12/15. historical + conflicting employment preserved", () => {
  const p = peopleRowToCompoundPerson(rawPerson({ experience: [{ companyName: "OldCo", companyDomain: "old.com", title: "Founder", current: false, endDate: "2023-01-01" }, { companyName: "NowCo", companyDomain: "now.com", current: true }] }))!;
  // the current role is preferred as primary.
  assertEquals(p.currentCompany, "NowCo");
});
Deno.test("16. scoped people input carries the company + role", () => {
  const scope = buildPeopleScope(resolveCompanyIdentity({ name: "BigID", linkedin_url: "https://linkedin.com/company/bigid" }), { requestedRole: "founder", queryIntent: "q" })!;
  const input = buildScopedPeopleInput(scope, 2);
  assertEquals((input.currentJobTitles as string[])[0], "founder");
  assert(JSON.stringify(input.currentCompanies).includes("linkedin.com/company/bigid"));
  assertEquals(input.max_results, 2);
});
Deno.test("18. people result limit is enforced", () => {
  const { people } = compoundPeopleFromRows([rawPerson(), rawPerson({ fullName: "X", linkedinUrl: "https://l/x" })], 1);
  assertEquals(people.length, 1);
});
Deno.test("19. malformed people rows are dropped, not thrown", () => {
  const { people, dropped } = compoundPeopleFromRows([null, {}, "x", rawPerson()], 10);
  assertEquals(people.length, 1);
  assert(dropped >= 2);
});

// ---- persistence adapter ---------------------------------------------------
async function contactCandidate() {
  const { candidates } = await runCompoundSourcing(intent, {
    fetchJobs: () => [{ title: "Sales Operations Manager", company: "BigID", companyDomain: "bigid.com", companyLinkedinUrl: "https://linkedin.com/company/bigid", companyDescription: "B2B SaaS platform", location: "New York, United States", url: "https://j/bigid" }],
    fetchPeopleForCompany: (s) => s.companyDedupeKey === "li_id:bigid" || s.companyDedupeKey === "domain:bigid.com" ? [{ name: "Dimitri", title: "Co-Founder & CEO", linkedinUrl: "https://linkedin.com/in/d", currentCompany: "BigID", currentCompanyDomain: "bigid.com", isCurrent: true }] : [],
  }, { now: NOW });
  return candidates.find((c) => c.verdict === "CONTACT")!;
}

Deno.test("21/24/25/26. qualified candidate plans an account + attaches evidence; never accountless CONTACT", async () => {
  const plan = buildCompoundPersistencePlan(await contactCandidate(), "ws-1");
  assertEquals(plan.verdict, "CONTACT");
  assertFalse(plan.contactBlocked);
  assert(plan.account != null && (plan.account.domain === "bigid.com"));
  assert((plan.leadCandidate.raw.evidence_ids as string[]).length >= 1);
  assert((plan.leadCandidate.raw.job_evidence as { url: string }).url === "https://j/bigid");
});
Deno.test("24/28. an accountless / off-company candidate can never plan CONTACT", async () => {
  const c = await contactCandidate();
  const accountless = { ...c, account: resolveCompanyIdentity({ name: "NoId Co" }) };
  assertEquals(buildCompoundPersistencePlan(accountless, "ws-1").verdict, "NEEDS_REVIEW");
  const offCompany = { ...c, employer: { ...c.employer, outcome: "verified_mismatch" as const } };
  assertEquals(buildCompoundPersistencePlan(offCompany, "ws-1").verdict, "REJECT");
});

// ---- execution composer (orchestration) ------------------------------------
function execDeps(order: string[], jobRows: unknown[], peopleByKey: Record<string, unknown[]>, opts: { jobsThrow?: boolean } = {}) {
  return {
    invokeJobs: async () => { order.push("jobs"); if (opts.jobsThrow) throw new Error("boom"); return jobRows; },
    invokePeople: async (envelope: Record<string, unknown>) => {
      const native = envelope.input as Record<string, unknown>;
      order.push(`people:${native._scope_key}`);
      return peopleByKey[String(native._scope_key)] ?? [];
    },
    persist: async (_p: unknown) => ({ ok: true, accountId: "acc", contactId: "c", leadCandidateId: "lc" }),
  };
}
const jobRows = [rawJob(), { title: "Sales Operations Manager", companyName: "Optivas Advisors", companyWebsite: "https://optivas.com", location: "Boston, United States", jobUrl: "https://j/opt", companyDescription: "boutique management advisory for SMB leaders", id: "job2" }];
const peopleByKey = { "domain:bigid.com": [rawPerson()], "li_id:bigid": [rawPerson()] };

Deno.test("31/32. jobs run BEFORE people; people only for verified companies", async () => {
  const order: string[] = [];
  const res = await runAgentCompoundExecution(intent, execDeps(order, jobRows, peopleByKey), { now: NOW, workspaceId: "ws-1" });
  assertEquals(order[0], "jobs");
  // One jobs call per compiled keyword variant; all of them precede any people call.
  const lastJobs = order.lastIndexOf("jobs");
  const firstPeople = order.findIndex((o) => o.startsWith("people:"));
  assert(firstPeople === -1 || lastJobs < firstPeople);
  // Optivas (advisory) is dropped → never triggers a people lookup.
  assertFalse(order.some((o) => o.includes("optivas")));
  assertEquals(res.status, "ok");
});
Deno.test("36. jobs failure → explicit sourcing failure, NO generic people fallback", async () => {
  const order: string[] = [];
  const res = await runAgentCompoundExecution(intent, execDeps(order, jobRows, peopleByKey, { jobsThrow: true }), { now: NOW, workspaceId: "ws-1" });
  assertEquals(res.status, "sourcing_failed");
  assertFalse(order.some((o) => o.startsWith("people:"))); // never fell back to a founder search
});
Deno.test("37. no valid companies → no people lookups", async () => {
  const order: string[] = [];
  // only the advisory job (dropped) → 0 verified companies
  const res = await runAgentCompoundExecution(intent, execDeps(order, [jobRows[1]], {}), { now: NOW, workspaceId: "ws-1" });
  assertEquals(res.status, "no_companies");
  assertFalse(order.some((o) => o.startsWith("people:")));
});
Deno.test("39/40. company-first results flow to persistence; metadata reflects path", async () => {
  const res = await runAgentCompoundExecution(intent, execDeps([], jobRows, peopleByKey), { now: NOW, workspaceId: "ws-1" });
  assert(res.plans.length >= 1);
  assert(res.persisted.every((p) => p.ok));
  assert(res.diagnostics.jobsInvoked && res.diagnostics.peopleCalls >= 1);
});
