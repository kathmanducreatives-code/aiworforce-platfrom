// A COMPLETED DISCOVERY MAY REOPEN — ONLY ON AN EXPLICIT REPLENISHMENT DEBT.
//
// ── THE DEFECT THIS CLOSES ─────────────────────────────────────────────────
//
// `replenishment_required` shipped able to say "widen the pool" and unable to
// cause it. Discovery is deliberately absent from `CAPABILITY_STAGE`, so once
// it completes every later slice skips it — correct as a default, and the
// reason the new decision did nothing: the continuation ran, discovery was
// skipped, the frontier was still empty, and the lineage burned barren slices
// until `no_progress` stopped it. That is a WORSE terminal answer than the
// `frontier_exhausted` it replaced, because it is less true.
//
// The exception added is the narrowest one that works, and these tests pin
// every edge of it: only discovery, only on a recorded debt, never on a met
// quota, and never at the cost of the pool already built.
//
// ZERO network, ZERO DB, ZERO provider spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runCapabilityPlan } from "../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  parseLeadMissionDeterministic,
} from "../../supabase/functions/_shared/leadMission.ts";
import { stubMissionEvaluator } from "./_shared/missionEvaluatorFixture.ts";
import type { LeadMissionV1 } from "../../supabase/functions/_shared/leadMission.ts";
import type { CompiledActorCall } from "../../supabase/functions/_shared/hiringActorInputs.ts";

const CANONICAL =
  "Find B2B SaaS companies in the United Kingdom hiring sales representatives. " +
  "Return 5 qualified leads.";

const mission = (): LeadMissionV1 => {
  const m = parseLeadMissionDeterministic(CANONICAL);
  return {
    ...m,
    requested_count: 5,
    // A lookup-shaped mission, for the same reason the wiring suite uses one:
    // these tests are about REOPENING discovery, not about whether a name
    // matcher may serve a concept query.
    known_companies: ["Anthropic", "Figma"],
    company_profile: { ...m.company_profile, employee_range: { min: 20, max: 200 } },
  };
};

const BRAIN = {
  employee_min: 20, employee_max: 200,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
} as never;

const row = (i: number, page: number) => ({
  companyName: `Co${page}_${i}`,
  linkedinUrl: `https://www.linkedin.com/company/co${page}-${i}`,
  website: `https://co${page}-${i}.com`,
  employeeCount: 60,
  description: `Co${page}_${i} is a B2B SaaS platform sold on subscription.`,
});

interface Call { actorKey: string; input: Record<string, unknown> }

/**
 * Run one slice.
 *
 * `state` and `resume` are what a continuation carries; passing them is how
 * these tests reproduce a second slice without a database.
 */
const slice = async (o: {
  state?: Record<string, unknown>;
  discoveryReplenishment?: Record<string, unknown> | null;
  resumeRecords?: unknown[];
}) => {
  const calls: Call[] = [];
  const result = await runCapabilityPlan({
    invoke: (call: CompiledActorCall<unknown>) => {
      const input = (call as unknown as { input: Record<string, unknown> }).input ?? {};
      calls.push({ actorKey: call.actorKey, input });
      if (call.actorKey === "apify_linkedin_company_search") {
        const page = Number(input.startPage ?? 1);
        // A DIFFERENT PAGE RETURNS DIFFERENT COMPANIES, as a real index does.
        return Promise.resolve(
          Array.from({ length: 6 }, (_, i) => row(i, page)) as Record<string, unknown>[],
        );
      }
      return Promise.resolve(
        Array.from({ length: 6 }, (_, i) => row(i, 1)) as Record<string, unknown>[],
      );
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    evaluateMission: stubMissionEvaluator({ mission_fit: "pass" }),
    planDiscovery: () => Promise.resolve([{
      actor_key: "apify_linkedin_company_search", role: "primary",
      input: { searchQuery: "B2B SaaS", locations: ["United Kingdom"] },
    }]),
  } as never, {
    mission: mission(),
    plan: buildCapabilityGraph(mission() as never),
    brain: BRAIN,
    maxCandidates: 50,
    remainingLeads: 5,
    readEnv: () => undefined,
    ...(o.state ? { state: o.state } : {}),
    // A CONTINUATION ALWAYS CARRIES ITS RESUME SCOPE. Without it the engine has
    // no checkpoint to restore the working set FROM, which is a property of
    // this harness rather than of the code under test — production reaches the
    // engine through `run-agent`, which always supplies it.
    ...(o.resumeRecords
      ? {
        resume: {
          workspace_id: "ws-test",
          lineage_root_task_id: "lineage-test",
          records: o.resumeRecords,
        },
      }
      : {}),
    ...(o.discoveryReplenishment !== undefined
      ? { discoveryReplenishment: o.discoveryReplenishment }
      : {}),
  } as never);
  return { calls, result: result as unknown as { state: Record<string, unknown> } };
};

const discoveryCalls = (calls: Call[]) =>
  calls.filter((c) => c.actorKey === "apify_linkedin_company_search");

Deno.test("a completed discovery normally stays skipped", async () => {
  const first = await slice({});
  const completed = first.result.state.completed_capabilities as string[];
  assert(
    completed.some((c) => c.includes("company_discovery")),
    "the first slice must complete discovery",
  );

  // Second slice, no debt. The default must be unchanged: nothing re-bought.
  const second = await slice({ state: first.result.state });
  assertEquals(
    discoveryCalls(second.calls).length, 0,
    "a completed capability is not re-paid for without an explicit debt",
  );
});

Deno.test("only replenishment_required reopens discovery", async () => {
  const first = await slice({});

  // A debt that is not the right one changes nothing.
  const wrongReason = await slice({
    state: first.result.state,
    discoveryReplenishment: {
      reason: "quota_unmet_frontier_remains",
      pages_taken: { apify_linkedin_company_search: 1 },
      sources_attempted: ["apify_linkedin_company_search"],
    },
  });
  assertEquals(
    discoveryCalls(wrongReason.calls).length, 0,
    "no reason other than replenishment_required may reopen discovery",
  );

  const reopened = await slice({
    state: first.result.state,
    discoveryReplenishment: {
      reason: "replenishment_required",
      pages_taken: { apify_linkedin_company_search: 1 },
      sources_attempted: ["apify_linkedin_company_search"],
    },
  });
  assert(
    discoveryCalls(reopened.calls).length > 0,
    "an explicit replenishment debt must actually reopen discovery",
  );
});

Deno.test("a reopened slice resumes at the next page, never the last one", async () => {
  const first = await slice({});
  const firstPages = discoveryCalls(first.calls)
    .map((c) => Number(c.input.startPage ?? 1));

  const reopened = await slice({
    state: first.result.state,
    discoveryReplenishment: {
      reason: "replenishment_required",
      // The lineage has already bought pages 1 and 2.
      pages_taken: { apify_linkedin_company_search: 2 },
      sources_attempted: ["apify_linkedin_company_search"],
    },
  });
  const pages = discoveryCalls(reopened.calls)
    .map((c) => Number(c.input.startPage ?? 1));
  assert(pages.length > 0, "the reopened slice must call the source");
  for (const p of pages) {
    assert(p >= 3,
      `a resumed replenishment must not re-ask a bought page (got ${p}, ` +
      `pages 1-2 were already taken; first slice used ${firstPages.join(",")})`);
  }
});

Deno.test("reopening never discards the pool already built", async () => {
  // THE HAZARD: the restore lives in the branch a reopen skips. Losing it would
  // drop every triage verdict, enrichment, hiring assessment and Brain decision
  // the lineage had already paid for.
  const first = await slice({});
  const firstKeys = (first.result.state.company_keys as string[]) ?? [];
  assert(firstKeys.length > 0, "the first slice must build a pool");
  const records = (first.result as unknown as { resume_records?: unknown[] })
    .resume_records ?? [];
  assert(records.length > 0, "the first slice must checkpoint its companies");

  const reopened = await slice({
    state: first.result.state,
    resumeRecords: records,
    discoveryReplenishment: {
      reason: "replenishment_required",
      pages_taken: { apify_linkedin_company_search: 1 },
      sources_attempted: ["apify_linkedin_company_search"],
    },
  });
  const afterKeys = (reopened.result.state.company_keys as string[]) ?? [];
  for (const k of firstKeys) {
    assert(afterKeys.includes(k),
      `replenishment dropped a company the lineage already held: ${k}`);
  }
  assert(afterKeys.length >= firstKeys.length,
    "replenishment adds to the pool; it never replaces it");
  assertEquals(new Set(afterKeys).size, afterKeys.length,
    "and the merged pool carries no duplicate key");
});

Deno.test("a debt reopens discovery and nothing else", async () => {
  const first = await slice({});
  const completedBefore = new Set(
    first.result.state.completed_capabilities as string[]);

  const reopened = await slice({
    state: first.result.state,
    discoveryReplenishment: {
      reason: "replenishment_required",
      pages_taken: { apify_linkedin_company_search: 1 },
      sources_attempted: ["apify_linkedin_company_search"],
    },
  });

  // Every non-discovery capability that had completed must still be counted as
  // resumed rather than re-bought.
  const outcomes = (reopened.result as unknown as {
    outcomes?: Array<Record<string, unknown>>;
  }).outcomes ?? [];
  for (const o of outcomes) {
    const cap = String(o.capability);
    if (cap.includes("company_discovery")) continue;
    if (!completedBefore.has(cap)) continue;
    assertEquals(o.status, "skipped_resumed",
      `${cap} was completed and must not become runnable again`);
  }
});
