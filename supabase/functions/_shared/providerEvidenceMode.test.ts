// NON-PERSISTING PROVIDER MODE + write-boundary regression for the second
// 2026-07-25 live defect: 20 accounts + 20 lead_candidates were written by
// source_with_apify BEFORE the company gate ran. ZERO network.

import { assertEquals, assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isNonPersistingProviderInput, withEvidenceOnlyPersistence, newWriteBoundary,
  recordProviderInvocation, writeBoundaryHolds, DEFER_PERSISTENCE_KEY,
} from "./providerEvidenceMode.ts";
import { runAgentCompoundExecution } from "./runAgentCompoundExecution.ts";
import { compileLeadEntityIntent } from "./leadEntityIntent.ts";

const NOW = "2026-07-25T00:00:00Z";
const intent = compileLeadEntityIntent("Founders of SaaS startups hiring Sales Operations in the United States");

const jobRow = (o: Record<string, unknown> = {}) => ({
  title: "Sales Operations Manager", companyName: "BigID", companyWebsite: "https://bigid.com",
  companyLinkedinUrl: "https://linkedin.com/company/bigid", location: "New York, United States",
  jobUrl: "https://j/bigid", descriptionText: "US revenue operations", companyDescription: "B2B SaaS platform", id: "j1", ...o,
});
const founder = () => ({
  fullName: "Dimitri Sirota", headline: "Co-Founder & CEO", linkedinUrl: "https://linkedin.com/in/d",
  experience: [{ companyName: "BigID", companyUrl: "https://linkedin.com/company/bigid", companyDomain: "bigid.com", title: "Co-Founder & CEO", current: true }],
});

/** A spy standing in for the real DB: any write here is a boundary violation. */
function dbSpy() {
  const writes: string[] = [];
  return {
    writes,
    /** Mimics runTool: persists provider output UNLESS defer_persistence is set. */
    runToolLike(input: Record<string, unknown>, items: unknown[]): unknown[] {
      if (input[DEFER_PERSISTENCE_KEY] !== true) {
        for (const _ of items) { writes.push("accounts.insert"); writes.push("lead_candidates.insert"); }
      }
      return items;
    },
  };
}

// ---- 25/26/32 the company-first adapters set the mode -----------------------
Deno.test("25/26/32. jobs AND people evidence calls are non-persisting; counter stays 0", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const res = await runAgentCompoundExecution(intent, {
    invokeJobs: async (input) => { seen.push(input); return [jobRow()]; },
    invokePeople: async (input) => { seen.push(input); return [founder()]; },
    persist: async () => ({ ok: true, accountId: "acc", contactId: null, leadCandidateId: "lc" }),
  }, { now: NOW, workspaceId: "ws" });

  assert(seen.length >= 2);
  for (const input of seen) assert(isNonPersistingProviderInput(input), `missing ${DEFER_PERSISTENCE_KEY}`);
  assertEquals(res.writeBoundary.providerSideWrites, 0);
  assertEquals(res.writeBoundary.invariantViolation, null);
  assert(writeBoundaryHolds(res.writeBoundary));
});

// ---- 27/28/29/34/35 zero DB writes end-to-end -------------------------------
Deno.test("27/28/29/34/35. real spec -> real builder -> mocked tool: ZERO provider-side writes, junk never persists", async () => {
  const spy = dbSpy();
  const persisted: string[] = [];
  const junk = [
    { title: "Customer Service Representative - Remote", companyName: "Sundayy", companyWebsite: "https://sundayy.com", location: "United States", jobUrl: "https://j/1", companyDescription: "job discovery", id: "x1" },
    { title: "Account Executive", companyName: "Careerscape", companyWebsite: "https://careerscape.com", location: "United States", jobUrl: "https://j/2", companyDescription: "staffing", id: "x2" },
  ];
  const res = await runAgentCompoundExecution(intent, {
    invokeJobs: async (input) => spy.runToolLike(input, [...junk, jobRow()]) as unknown[],
    invokePeople: async (input) => spy.runToolLike(input, [founder()]) as unknown[],
    persist: async (plan) => { persisted.push(`${plan.account?.name}:${plan.verdict}`); return { ok: true, accountId: "acc", contactId: null, leadCandidateId: "lc" }; },
  }, { now: NOW, workspaceId: "ws" });

  assertEquals(spy.writes.length, 0);                      // no account/lead_candidate inserts
  assertEquals(res.writeBoundary.providerSideWrites, 0);
  // The rejected raw rows never reached the guarded persistence adapter.
  assertFalse(persisted.some((p) => p.startsWith("Sundayy") || p.startsWith("Careerscape")));
  assertEquals(res.writeBoundary.persistedRecords, res.persisted.filter((p) => p.ok).length);
});

// ---- 30/31 existing behaviour preserved -------------------------------------
Deno.test("30/31. omitting the mode keeps ordinary persistence; explicit mode still works", () => {
  const ordinary = { selected_actor_key: "apify_jobs", input: { query: "x" } };
  assertFalse(isNonPersistingProviderInput(ordinary));     // legacy flows unchanged
  const evidence = withEvidenceOnlyPersistence(ordinary);
  assert(isNonPersistingProviderInput(evidence));
  assertEquals((evidence as Record<string, unknown>).selected_actor_key, "apify_jobs"); // non-destructive
  assertFalse(isNonPersistingProviderInput({ defer_persistence: "true" }));  // only strict true counts
  assertFalse(isNonPersistingProviderInput(null));
});

// ---- 33 a persisting evidence call trips the invariant ----------------------
Deno.test("33. a provider call without the mode fails the invariant instead of reporting clean persistence", () => {
  const b = newWriteBoundary();
  recordProviderInvocation(b, { query: "Sales Operations" }, "apify_jobs");
  assertEquals(b.providerSideWrites, 1);
  assert(b.invariantViolation?.includes("provider_side_write_risk"));
  assertFalse(writeBoundaryHolds(b));
});

// ---- 14 the jobs adapter consumes the spec, not intent.query ----------------
Deno.test("14. the jobs call receives compiled keywords, never the original sentence", async () => {
  const sent: Array<Record<string, unknown>> = [];
  await runAgentCompoundExecution(intent, {
    invokeJobs: async (input) => { sent.push(input); return [jobRow()]; },
    invokePeople: async () => [founder()],
    persist: async () => ({ ok: true, accountId: "a", contactId: null, leadCandidateId: "l" }),
  }, { now: NOW, workspaceId: "ws" });

  assert(sent.length > 0);
  for (const s of sent) {
    assertEquals(s.location, "United States");
    assert(String(s.query).length < 40);
    assertFalse(String(s.query).toLowerCase().includes("founders of"));
  }
  assertEquals(sent[0].query, "Sales Operations");
});

// ---- 12 no provider call when compilation fails -----------------------------
Deno.test("12b. an uncompilable request calls NO provider and reports unable_to_compile_job_search", async () => {
  const bad = compileLeadEntityIntent("Founders of SaaS startups that are hiring");
  let calls = 0;
  const res = await runAgentCompoundExecution(bad, {
    invokeJobs: async () => { calls++; return [jobRow()]; },
    invokePeople: async () => { calls++; return []; },
    persist: async () => ({ ok: true, accountId: null, contactId: null, leadCandidateId: null }),
  }, { now: NOW, workspaceId: "ws" });
  assertEquals(calls, 0);
  assertEquals(res.status, "unable_to_compile_job_search");
  assertEquals(res.writeBoundary.providerSideWrites, 0);
});

// ---- 21 shared ceiling across variants at runtime ---------------------------
Deno.test("21b. three keyword variants never exceed the single raw-job ceiling", async () => {
  let total = 0;
  await runAgentCompoundExecution(intent, {
    invokeJobs: async (input) => {
      const n = Number(input.max_results); total += n;
      return Array.from({ length: n }, (_, k) => jobRow({ id: `j${total}_${k}`, jobUrl: `https://j/${total}_${k}` }));
    },
    invokePeople: async () => [founder()],
    persist: async () => ({ ok: true, accountId: "a", contactId: null, leadCandidateId: "l" }),
  }, { now: NOW, workspaceId: "ws", limits: { rawJobs: 25 } });
  assert(total <= 25, `planned ${total} > 25`);
});
