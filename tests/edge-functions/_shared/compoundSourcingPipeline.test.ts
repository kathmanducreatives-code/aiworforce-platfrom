// Orchestration tests for the company-first pipeline — mocked actors, ZERO network.

import { assertEquals, assert, assertFalse, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runCompoundSourcing, type CompoundJob, type CompoundPerson, type CompoundDeps } from "../../supabase/functions/_shared/compoundSourcingPipeline.ts";
import { compileLeadEntityIntent } from "../../supabase/functions/_shared/leadEntityIntent.ts";

const NOW = "2026-07-24T00:00:00Z";
const intent = compileLeadEntityIntent("Founders of SaaS startups hiring Sales Operations in the United States");

const SAAS = "B2B SaaS analytics platform";
const jobs: CompoundJob[] = [
  { title: "Sales Operations Manager", company: "BigID", companyDomain: "bigid.com", companyDescription: SAAS, location: "New York, United States", url: "https://j/bigid-1" },
  { title: "Revenue Operations Analyst", company: "BigID", companyDomain: "bigid.com", companyDescription: SAAS, location: "New York, United States", url: "https://j/bigid-2" }, // dup company
  { title: "Sales Operations Manager", company: "Optivas Advisors", companyDomain: "optivas.com", companyDescription: "boutique management advisory for SMB leaders", location: "Boston, United States", url: "https://j/opt" }, // vertical fail
  { title: "Account Executive", company: "CloudCo", companyDomain: "cloudco.com", companyDescription: SAAS, location: "Austin, United States", url: "https://j/ae" }, // generic role
  { title: "Sales Operations Manager", company: "UKCo", companyDomain: "ukco.com", companyDescription: SAAS, location: "London, United Kingdom", url: "https://j/uk" }, // non-US
  { title: "Sales Operations Manager", company: "Mystery", companyDescription: SAAS, location: "Denver, United States", url: "https://j/mys" }, // no strong id → no lookup
  { title: "Revenue Operations Manager", company: "Vanta", companyDomain: "vanta.com", companyDescription: SAAS, location: "San Francisco, United States", url: "https://j/vanta" },
  { title: "Sales Operations Manager", company: "Acme", companyDomain: "acme.com", companyDescription: SAAS, location: "Chicago, United States", url: "https://j/acme" },
  { title: "Sales Operations Manager", company: "Beta", companyDomain: "beta.com", companyDescription: SAAS, location: "Seattle, United States", url: "https://j/beta" },
];

const peopleByKey: Record<string, CompoundPerson[]> = {
  "domain:bigid.com": [{ name: "Dimitri Sirota", title: "Co-Founder & CEO", linkedinUrl: "https://linkedin.com/in/dimitri", currentCompany: "BigID", currentCompanyDomain: "bigid.com", isCurrent: true }],
  "domain:vanta.com": [{ name: "Imposter", title: "Founder", linkedinUrl: "https://linkedin.com/in/imposter", currentCompany: "OtherCorp", currentCompanyDomain: "other.com", isCurrent: true }], // off-company
  "domain:acme.com": [{ name: "Old Founder", title: "Co-Founder", linkedinUrl: "https://linkedin.com/in/old", currentCompany: "Acme", currentCompanyDomain: "acme.com", endDate: "2024-01-01" }], // historical
  "domain:beta.com": [{ name: "Amb Founder", title: "Founder", linkedinUrl: "https://linkedin.com/in/amb", currentCompany: "Beta" }], // name-only → ambiguous
};

function makeDeps(order: string[]): CompoundDeps {
  return {
    fetchJobs: (_q, _m) => { order.push("jobs"); return jobs; },
    fetchPeopleForCompany: (scope, _m) => { order.push(`people:${scope.companyDedupeKey}`); return peopleByKey[scope.companyDedupeKey ?? ""] ?? []; },
  };
}

Deno.test("jobs are fetched BEFORE any people search (company-first ordering)", async () => {
  const order: string[] = [];
  await runCompoundSourcing(intent, makeDeps(order), { now: NOW });
  assertEquals(order[0], "jobs");
  assert(order.slice(1).every((o) => o.startsWith("people:")));
});

Deno.test("the pipeline refuses a non-compound intent", async () => {
  const pure = compileLeadEntityIntent("Find founders in Austin");
  await assertRejects(() => runCompoundSourcing(pure, makeDeps([]), {}));
});

Deno.test("full company-first run produces correct verdicts", async () => {
  const { candidates, diagnostics } = await runCompoundSourcing(intent, makeDeps([]), { now: NOW });
  const by = (name: string) => candidates.find((c) => c.person.name === name);

  // BigID founder currently at BigID → CONTACT, cites the verified Sales Ops job.
  const d = by("Dimitri Sirota")!;
  assertEquals(d.verdict, "CONTACT");
  assert(d.whyNow.includes("Sales Operations Manager"));
  assert(d.evidence.some((e) => e.kind === "job" && e.url === "https://j/bigid-1"));
  assert(d.account.canonicalDomain === "bigid.com"); // has an account, not null

  // off-company founder → REJECT, never CONTACT.
  assertEquals(by("Imposter")!.verdict, "REJECT");
  assert(diagnostics.offCompanyPeople >= 1);
  // historical founder → REJECT.
  assertEquals(by("Old Founder")!.verdict, "REJECT");
  // ambiguous (name-only current employer) → not CONTACT.
  assert(by("Amb Founder")!.verdict !== "CONTACT");

  // Advisory company dropped, generic AE dropped, non-US dropped, no-id company no lookup.
  assertFalse(candidates.some((c) => c.account.name === "Optivas Advisors"));
  assertFalse(candidates.some((c) => c.jobEvidence.title === "Account Executive"));
  assertFalse(candidates.some((c) => c.account.name === "UKCo"));
  assertFalse(candidates.some((c) => c.account.name === "Mystery"));
  // NEVER an accountless candidate.
  assert(candidates.every((c) => c.account.dedupeKey != null));
});

Deno.test("one company appears once even from multiple jobs (dedupe)", async () => {
  const { candidates } = await runCompoundSourcing(intent, makeDeps([]), { now: NOW });
  const bigidCandidates = candidates.filter((c) => c.account.canonicalDomain === "bigid.com");
  // one founder, one account — the two BigID jobs collapsed to one company.
  assertEquals(bigidCandidates.length, 1);
});

Deno.test("input ORDER does not change canonical selection (deterministic)", async () => {
  const order: string[] = [];
  const a = await runCompoundSourcing(intent, makeDeps(order), { now: NOW });
  const reversedJobs = [...jobs].reverse();
  const depsRev: CompoundDeps = { fetchJobs: () => reversedJobs, fetchPeopleForCompany: (s) => peopleByKey[s.companyDedupeKey ?? ""] ?? [] };
  const b = await runCompoundSourcing(intent, depsRev, { now: NOW });
  assertEquals(a.candidates.map((c) => c.person.name).sort(), b.candidates.map((c) => c.person.name).sort());
  // CONTACT set identical regardless of input order.
  const contacts = (r: typeof a) => r.candidates.filter((c) => c.verdict === "CONTACT").map((c) => c.person.name).sort();
  assertEquals(contacts(a), contacts(b));
});

Deno.test("a failed hard gate can never be CONTACT (off-company beats any score)", async () => {
  const { candidates } = await runCompoundSourcing(intent, makeDeps([]), { now: NOW });
  for (const c of candidates) {
    if (Object.values(c.gates).includes("fail")) assertFalse(c.verdict === "CONTACT");
  }
});
