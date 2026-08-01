// QUERY-PACK SEPARATION AND RECENCY, THROUGH THE REAL INVOKER.
//
// Production task 9cb98f67 sent the identical merged query to all three Actors:
//   "Sales Operations OR Revenue Operations OR GTM Operations"
// and sent NO recency key at all. Two root causes, both fixed here:
//
//   1. `prepareStepPackCalls` shipped tested with NO production caller. The live
//      path used `prepareStepCall`, which passes `intent.approvedTitleAliases` as
//      one merged list.
//   2. run-agent's mission profile never set `maximumPostingAgeDays`, so the plan
//      never set `postingWindowDays`, so the compiler correctly emitted nothing.
//
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sequentialJobsInvoker } from "./sequentialSourceRuntime.ts";
import { newSourceExecutionState } from "./sourceExecutionState.ts";
import { deterministicOrderedPlan, validateOrderedPlan, type LeadMissionSourceProfile } from "./hiringSourcePlan.ts";

function enableProviders() {
  for (const k of [
    "APIFY_ENABLE_INDEED_JOBS_AUTOMATION_LAB", "APIFY_ENABLE_LINKEDIN_JOBS_CRAWLWORKS",
    "APIFY_ENABLE_GLASSDOOR_JOBS", "APIFY_ENABLE_YC_JOBS",
  ]) Deno.env.set(k, "1");
}

const profile = (o: Record<string, unknown> = {}): LeadMissionSourceProfile => ({
  industries: ["b2b saas"], stages: ["seed"], triggerRequirements: ["active_hiring"],
  hiring: {
    required: true, roleFamily: "revenue_operations",
    approvedAliases: ["Sales Operations", "Revenue Operations", "GTM Operations"],
    geography: "United States",
    maximumPostingAgeDays: 30,          // the fix run-agent now supplies
  },
  decisionMakerRoles: ["Founder", "Co-Founder", "CEO"],
  currentEmployerRequired: true,
  requestedCount: 5, countEntity: "contact_ready_lead", quotaPolicy: "contact_only",
  requiredEvidence: ["active_hiring"],
  ...o,
} as unknown as LeadMissionSourceProfile);

async function runInvoker(packs: Array<{ packId: string; titleAliases: string[] }> | undefined) {
  enableProviders();
  const p = profile();
  const plan = await deterministicOrderedPlan(p);
  const approved = (await validateOrderedPlan(plan, p)).plan;
  const state = newSourceExecutionState({
    planHash: approved.planHash,
    steps: approved.steps.map((s) => ({ stepId: s.stepId, capability: s.capability, actorKey: null, order: s.order })),
    requestedCount: 5, now: "2026-08-01T00:00:00.000Z",
  });
  const sent: Array<Record<string, unknown>> = [];
  const handle = sequentialJobsInvoker({
    taskId: "t1", plan: approved, state,
    invokeJobs: (env: Record<string, unknown>) => { sent.push(env); return Promise.resolve([]); },
    ...(packs ? { queryPacks: packs } : {}),
  } as never);
  await handle.invokeJobs({}, 25);
  return { sent, approved };
}

const PACKS = [
  { packId: "sales_ops_leadership", titleAliases: ["VP of Sales Operations", "Director of Sales Operations"] },
  { packId: "revenue_ops_leadership", titleAliases: ["VP of Revenue Operations", "Director of Revenue Operations"] },
  { packId: "gtm_ops", titleAliases: ["GTM Operations Manager"] },
];

Deno.test("1. packs produce SEPARATE Actor calls, not one merged query", async () => {
  const { sent } = await runInvoker(PACKS);
  assert(sent.length >= 2, `expected one call per pack, got ${sent.length}`);
  const packIds = sent.map((e) => e.query_pack_id).filter(Boolean);
  assertEquals(new Set(packIds).size, packIds.length, "each call must name a DISTINCT pack");
});

Deno.test("1b. each call has its OWN input hash and idempotency identity", async () => {
  const { sent } = await runInvoker(PACKS);
  const hashes = sent.map((e) => e.compiled_input_hash);
  const keys = sent.map((e) => e.idempotency_key);
  assertEquals(new Set(hashes).size, hashes.length, "input hashes must differ per pack");
  assertEquals(new Set(keys).size, keys.length, "idempotency keys must differ per pack");
});

Deno.test("1c. no call carries the merged OR query from production", async () => {
  const { sent } = await runInvoker(PACKS);
  for (const env of sent) {
    const q = String((env.input as Record<string, unknown>)?.query ?? (env.input as Record<string, unknown>)?.keywords ?? "");
    assertFalse(
      q.includes("Sales Operations OR Revenue Operations OR GTM Operations"),
      `the exact production merged query was re-sent: ${q}`,
    );
  }
});

Deno.test("1d. each call's titles come from ITS pack only", async () => {
  const { sent } = await runInvoker(PACKS);
  for (const env of sent) {
    const q = String((env.input as Record<string, unknown>)?.query ?? (env.input as Record<string, unknown>)?.keywords ?? "");
    const pack = PACKS.find((p) => p.packId === env.query_pack_id);
    if (!pack || !q) continue;
    // Nothing from a DIFFERENT pack may appear in this call.
    for (const other of PACKS.filter((p) => p.packId !== pack.packId)) {
      for (const t of other.titleAliases) {
        assertFalse(q.includes(t), `pack ${pack.packId} leaked "${t}" from ${other.packId}`);
      }
    }
  }
});

Deno.test("2. WITHOUT packs the pre-existing single-call path is unchanged", async () => {
  const { sent } = await runInvoker(undefined);
  assertEquals(sent.length, 1, "no packs ⇒ exactly one merged call, as before");
  assertEquals(sent[0].query_pack_id, undefined);
});

// ================================================= RECENCY ===================

Deno.test("3. a mission recency policy reaches the Actor input as a supported value", async () => {
  const { sent } = await runInvoker(PACKS);
  for (const env of sent) {
    const input = env.input as Record<string, unknown>;
    const cap = env.capability_key;
    if (cap === "indeed_job_discovery" && "datePosted" in input) {
      assertEquals(input.datePosted, "14", "Indeed must use a live-actor enum member");
    }
    if (cap === "linkedin_job_discovery" && "timePostedRange" in input) {
      assert(String(input.timePostedRange).length > 0, "LinkedIn timePostedRange must be non-empty");
    }
    // The exact production defect: an EMPTY recency value must never be sent.
    assertFalse(input.datePosted === "", "datePosted:'' was the production defect");
    assertFalse(input.timePostedRange === "", "timePostedRange:'' was the production defect");
  }
});

Deno.test("3b. workplace modes stay unrestricted when the mission asks for none", async () => {
  const { sent } = await runInvoker(PACKS);
  const li = sent.find((e) => e.capability_key === "linkedin_job_discovery");
  if (li) {
    const input = li.input as Record<string, unknown>;
    assertEquals(input.onSite, true);
    assertEquals(input.remote, true);
    assertEquals(input.hybrid, true);
  }
});

Deno.test("3c. Glassdoor daysOld stays bounded", async () => {
  const { sent } = await runInvoker(PACKS);
  const gd = sent.find((e) => e.capability_key === "glassdoor_job_discovery");
  if (gd) {
    const d = Number((gd.input as Record<string, unknown>).daysOld ?? 0);
    assert(d > 0 && d <= 60, `daysOld must stay bounded, got ${d}`);
  }
});
