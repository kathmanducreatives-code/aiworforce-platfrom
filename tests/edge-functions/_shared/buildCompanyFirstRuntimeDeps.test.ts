// Parity tests for the extracted deps builder. Proves buildCompanyFirstRuntimeDeps
// (1) passes every field through unchanged, (2) includes the three conditional
// fields ONLY when supplied — so a V1 caller that omits executionBudget/actionBudget/
// bounds gets an object identical to the previous inline literal, and (3) the
// assembled deps run end-to-end through the controller exactly like hand-built deps.
// ZERO network (run without --allow-net).

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCompanyFirstRuntimeDeps,
} from "../../../supabase/functions/_shared/buildCompanyFirstRuntimeDeps.ts";
import {
  executeRunAgentCompanyFirstSourcing,
} from "../../../supabase/functions/_shared/executeRunAgentCompanyFirstSourcing.ts";
import { compileLeadEntityIntent } from "../../../supabase/functions/_shared/leadEntityIntent.ts";

const intent = compileLeadEntityIntent(
  "Founders of SaaS startups hiring Sales Operations in the United States",
);
const noopJobs = async () => [];
const noopPeople = async () => [];
const noopPersist = async () => ({ ok: true, accountId: null, contactId: null, leadCandidateId: null });

Deno.test("passthrough: required + always-set fields match the inputs", () => {
  const deps = buildCompanyFirstRuntimeDeps({
    intent, workspaceId: "ws-1", planId: "plan-9", taskId: "task-9",
    requestedLeadCount: 3,
    invokeJobs: noopJobs, invokePeople: noopPeople, persist: noopPersist,
  });
  assertEquals(deps.intent, intent);
  assertEquals(deps.workspaceId, "ws-1");
  assertEquals(deps.planId, "plan-9");
  assertEquals(deps.taskId, "task-9");
  assertEquals(deps.requestedLeadCount, 3);
  assertEquals(deps.invokeJobs, noopJobs);
  assertEquals(deps.invokePeople, noopPeople);
  assertEquals(deps.persist, noopPersist);
  // planId/taskId/brainConstraints/brainPolicyHash are always present (null when
  // unset), exactly as the previous inline literal always set them.
  assertEquals(deps.brainConstraints, null);
  assertEquals(deps.brainPolicyHash, null);
});

Deno.test("V1 parity: conditional fields ABSENT when not supplied", () => {
  const deps = buildCompanyFirstRuntimeDeps({
    intent, workspaceId: "ws-1", requestedLeadCount: 1,
    invokeJobs: noopJobs, invokePeople: noopPeople, persist: noopPersist,
  });
  // These three were `...(cond ? { field } : {})` spreads — absent, not undefined.
  assertFalse("executionBudget" in deps);
  assertFalse("actionBudget" in deps);
  assertFalse("bounds" in deps);
});

Deno.test("conditional fields PRESENT and equal when supplied", () => {
  const ab = () => ({ exhausted: false, remaining: 2, allowed: 3, reason: "ok" });
  const deps = buildCompanyFirstRuntimeDeps({
    intent, workspaceId: "ws-1", requestedLeadCount: 1,
    invokeJobs: noopJobs, invokePeople: noopPeople, persist: noopPersist,
    actionBudget: ab,
    bounds: { maxRounds: 0 },
    executionBudget: {},
  });
  assert("actionBudget" in deps);
  assertEquals(deps.actionBudget, ab);
  assertEquals(deps.bounds, { maxRounds: 0 });
  assert("executionBudget" in deps);
});

Deno.test("end-to-end: builder-assembled deps run like hand-built deps", async () => {
  const order: string[] = [];
  const jobs = [{
    title: "Sales Operations Manager", companyName: "BigID", companyWebsite: "https://bigid.com",
    companyLinkedinUrl: "https://linkedin.com/company/bigid", location: "New York, United States",
    jobUrl: "https://j/bigid", descriptionText: "US revenue operations",
    companyDescription: "B2B SaaS platform", id: "j1",
  }];
  const founders: Record<string, unknown[]> = {
    "bigid.com": [{
      fullName: "Dimitri Sirota", headline: "Co-Founder & CEO", linkedinUrl: "https://linkedin.com/in/d",
      experience: [{ companyName: "BigID", companyUrl: "https://linkedin.com/company/bigid", companyDomain: "bigid.com", title: "Co-Founder & CEO", current: true }],
    }],
  };
  const deps = buildCompanyFirstRuntimeDeps({
    intent, workspaceId: "ws-1", requestedLeadCount: 1, bounds: { maxRounds: 1 },
    invokeJobs: async () => { order.push("jobs"); return jobs; },
    invokePeople: async (envelope) => {
      const native = (envelope as { input: Record<string, unknown> }).input;
      order.push(`people:${native._scope_domain ?? native._scope_key}`);
      return founders[String(native._scope_domain ?? "")] ?? [];
    },
    persist: async (plan) => ({ ok: true, accountId: plan.verdict === "CONTACT" ? "acc-1" : null, contactId: null, leadCandidateId: "lc-1" }),
  });
  const r = await executeRunAgentCompanyFirstSourcing(deps);
  assertEquals(r.status, "completed");
  assertEquals(order[0], "jobs");
  assertEquals(order.filter((o) => o.startsWith("people:")).length, 1);
});
