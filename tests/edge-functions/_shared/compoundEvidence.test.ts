import { assertEquals, assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runCompoundSourcing, type CompoundDeps } from "../../../supabase/functions/_shared/compoundSourcingPipeline.ts";
import { validateEvidenceRefs, hiringEvidenceValid, auditCompoundWhyNow, auditCompoundOpener } from "../../../supabase/functions/_shared/compoundEvidence.ts";
import { compileLeadEntityIntent } from "../../../supabase/functions/_shared/leadEntityIntent.ts";

const NOW = "2026-07-24T00:00:00Z";
const intent = compileLeadEntityIntent("Founders of SaaS startups hiring Sales Operations in the United States");
const deps: CompoundDeps = {
  fetchJobs: () => [{ title: "Sales Operations Manager", company: "BigID", companyDomain: "bigid.com", companyDescription: "B2B SaaS platform", location: "New York, United States", url: "https://j/bigid" }],
  fetchPeopleForCompany: (s) => s.companyDedupeKey === "domain:bigid.com" ? [{ name: "Dimitri", title: "Co-Founder & CEO", linkedinUrl: "https://linkedin.com/in/d", currentCompany: "BigID", currentCompanyDomain: "bigid.com", isCurrent: true }] : [],
};

async function contact() {
  const { candidates } = await runCompoundSourcing(intent, deps, { now: NOW });
  return candidates.find((c) => c.verdict === "CONTACT")!;
}

Deno.test("known evidence id validates; unknown fails", async () => {
  const c = await contact();
  const jobId = c.evidence.find((e) => e.kind === "job")!.id;
  assert(validateEvidenceRefs(c, [jobId]).ok);
  const bad = validateEvidenceRefs(c, ["evi_job_domain:not-a-real-company"]);
  assertFalse(bad.ok);
  assert(bad.failures.some((f) => f.startsWith("unknown_evidence_id")));
});

Deno.test("missing job URL fails the required hiring-evidence check", async () => {
  const c = await contact();
  assert(hiringEvidenceValid(c));
  const stripped = { ...c, evidence: c.evidence.map((e) => e.kind === "job" ? { ...e, url: null } : e) };
  assertFalse(hiringEvidenceValid(stripped));
});

Deno.test("grounded why-now passes; unsupported claims fail", async () => {
  const c = await contact();
  const good = auditCompoundWhyNow("BigID is hiring a Sales Operations Manager.", c);
  assert(good.grounded, JSON.stringify(good));
  const bad = auditCompoundWhyNow("BigID recently raised a Series B and is building a sales team.", c);
  assertFalse(bad.grounded);
  assert(bad.violations.length > 0);
});

Deno.test("why-now for the wrong company is not company-specific", async () => {
  const c = await contact();
  assertFalse(auditCompoundWhyNow("Acme is hiring a Sales Operations Manager.", c).companySpecific);
});

Deno.test("grounded opener passes; unsupported/wrong-company opener fails", async () => {
  const c = await contact();
  assert(auditCompoundOpener(c.opener, c).ok);
  assertFalse(auditCompoundOpener("Congrats on your recent funding round!", c).ok);
  assertFalse(auditCompoundOpener("Saw that Acme is hiring.", c).ok);
});

Deno.test("the pipeline's own generated why-now/opener are grounded", async () => {
  const c = await contact();
  assert(auditCompoundWhyNow(c.whyNow, c).grounded);
  assert(auditCompoundOpener(c.opener, c).ok);
});
