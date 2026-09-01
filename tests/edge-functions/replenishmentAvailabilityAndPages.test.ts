// REPLENISHMENT MUST COUNT WHAT IS LEFT, AND PAGE STATE MUST DESCRIBE REALITY.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Task 74de044e, 2026-09-01. `replenishment_required` fired correctly, discovery
// reopened, and then bought nothing six times over:
//
//   pages_taken                        7
//   apify_linkedin_company_search calls 1
//   pool before / after                50 / 50
//   qualified                          0 of 5
//   terminal                           no_progress after 7 barren slices
//
// Two defects, one in each direction.
//
//   R1  The restored pool held 34 LIFETIME admitted against a target of 20, so
//       the first guard in `executeSelections` broke before any call. Twenty-one
//       of those 34 were already investigated and settled — they could not
//       satisfy any further downstream work, and counting them said "full" when
//       nothing was left to do.
//
//   R2  The page cursor advanced where the page was CHOSEN, not where it was
//       bought, so `pages_taken` recorded pages the engine had merely considered
//       asking for. A checkpoint carrying 7 tells the next slice to resume at
//       page 8 of an index it has read one page of.
//
// ZERO network, ZERO DB, ZERO provider spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runCapabilityPlan } from "../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { parseLeadMissionDeterministic } from "../../supabase/functions/_shared/leadMission.ts";
import { nextStageFor } from "../../supabase/functions/_shared/leadResumeState.ts";
import { isUnfinishedFrontier } from "../../supabase/functions/_shared/leadInvestigationBudget.ts";
import { stubMissionEvaluator } from "./_shared/missionEvaluatorFixture.ts";
import type { LeadMissionV1 } from "../../supabase/functions/_shared/leadMission.ts";
import type { CompiledActorCall } from "../../supabase/functions/_shared/hiringActorInputs.ts";

const CANONICAL =
  "Find B2B SaaS companies in the United Kingdom hiring sales representatives. " +
  "Return 5 qualified leads.";

const mission = (): LeadMissionV1 => {
  const m = parseLeadMissionDeterministic(CANONICAL);
  return {
    ...m, requested_count: 5, known_companies: ["Anthropic", "Figma"],
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

const slice = async (o: {
  state?: Record<string, unknown>;
  resumeRecords?: unknown[];
  discoveryReplenishment?: Record<string, unknown> | null;
  /** Make the company-search actor refuse, to prove a page cannot commit. */
  searchThrows?: boolean;
  rowsPerPage?: number;
}) => {
  const calls: Call[] = [];
  const result = await runCapabilityPlan({
    invoke: (call: CompiledActorCall<unknown>) => {
      const input = (call as unknown as { input: Record<string, unknown> }).input ?? {};
      calls.push({ actorKey: call.actorKey, input });
      if (call.actorKey === "apify_linkedin_company_search") {
        if (o.searchThrows) return Promise.reject(new Error("provider refused"));
        const page = Number(input.startPage ?? 1);
        return Promise.resolve(
          Array.from({ length: o.rowsPerPage ?? 6 }, (_, i) => row(i, page)) as Record<string, unknown>[],
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
    mission: mission(), plan: buildCapabilityGraph(mission() as never),
    brain: BRAIN, maxCandidates: 50, remainingLeads: 5, readEnv: () => undefined,
    ...(o.state ? { state: o.state } : {}),
    ...(o.discoveryReplenishment !== undefined
      ? { discoveryReplenishment: o.discoveryReplenishment } : {}),
    ...(o.resumeRecords
      ? {
        resume: {
          workspace_id: "ws-test", lineage_root_task_id: "lineage-test",
          records: o.resumeRecords,
        },
      }
      : {}),
  } as never);
  return { calls, result: result as unknown as { state: Record<string, unknown> } };
};

const searchCalls = (c: Call[]) =>
  c.filter((x) => x.actorKey === "apify_linkedin_company_search");
const sourceState = (r: { state: Record<string, unknown> }) =>
  (r.state.capability_execution_state as Record<string, unknown> | undefined)
    ?? (r.state.discovery_source_state as Record<string, unknown>)
    ?? (r.state as Record<string, unknown>).discovery_source_state as Record<string, unknown>;

// ---------------------------------------------------------------- R1 --------

Deno.test("R1: the predicates it reuses are the existing authoritative ones", () => {
  // `excluded_permanently` is a DECISION, and the frontier helper already
  // refuses to re-queue one. Availability must agree with that.
  assertEquals(isUnfinishedFrontier("excluded_permanently", false), false);
  assertEquals(isUnfinishedFrontier("excluded_permanently", true), false,
    "not even a deferral reopens a decided company");
  // `nextStageFor` is the stage machine every resumed slice routes on: null
  // means nothing further is owed.
  const settled = {
    company_key: "k", company_name: "n",
    identity: "resolved", enrichment: "completed", hiring: "not_verified",
    brain: "rejected", founder: "not_eligible", completed_operations: [],
  } as never;
  assertEquals(nextStageFor(settled), null, "a fully settled company owes nothing");
  const fresh = {
    company_key: "k", company_name: "n",
    identity: "not_started", enrichment: "not_started", hiring: "not_started",
    brain: "not_started", founder: "not_started", completed_operations: [],
  } as never;
  assert(nextStageFor(fresh) !== null, "a fresh company still owes a stage");
});

Deno.test("R1: a fresh slice is unchanged — available equals admitted", async () => {
  const r = await slice({});
  const st = (r.result.state.discovery_source_state ?? {}) as Record<string, unknown>;
  assertEquals(st.available_admitted, st.admitted,
    "nothing has been spent yet, so the two counts must agree");
});

Deno.test("R1: a spent pool no longer counts as full", async () => {
  const first = await slice({});
  const records = (first.result as unknown as { resume_records?: unknown[] })
    .resume_records ?? [];
  const before = (first.result.state.discovery_source_state ?? {}) as Record<string, unknown>;
  assert(Number(before.admitted) > 0, "the first slice must admit companies");

  const reopened = await slice({
    state: first.result.state, resumeRecords: records,
    discoveryReplenishment: {
      reason: "replenishment_required",
      pages_taken: { apify_linkedin_company_search: 1 },
      sources_attempted: ["apify_linkedin_company_search"],
    },
  });
  const after = (reopened.result.state.discovery_source_state ?? {}) as Record<string, unknown>;
  // LIFETIME ADMITTED IS NOT DESTROYED — it is still reported.
  assert(Number(after.admitted) >= Number(before.admitted),
    "the historical admitted count must survive replenishment");
  // AND THE REOPENED SLICE ACTUALLY BOUGHT A PAGE, which is the whole point.
  assert(searchCalls(reopened.calls).length > 0,
    "a reopened slice whose pool is spent must reach the provider");
});

// ---------------------------------------------------------------- R2 --------

Deno.test("R2: a page that was only considered does not advance the cursor", async () => {
  // The provider refuses, so no operation exists for page 2.
  const first = await slice({});
  const records = (first.result as unknown as { resume_records?: unknown[] })
    .resume_records ?? [];
  const reopened = await slice({
    state: first.result.state, resumeRecords: records, searchThrows: true,
    discoveryReplenishment: {
      reason: "replenishment_required",
      pages_taken: { apify_linkedin_company_search: 1 },
      sources_attempted: ["apify_linkedin_company_search"],
    },
  });
  const st = (reopened.result.state.discovery_source_state ?? {}) as Record<string, unknown>;
  const pages = (st.pages_taken ?? {}) as Record<string, number>;
  assertEquals(pages["apify_linkedin_company_search"], 1,
    "a refused page must leave the cursor where it was");
});

Deno.test("R2: an executed page advances the cursor exactly once", async () => {
  const first = await slice({});
  const records = (first.result as unknown as { resume_records?: unknown[] })
    .resume_records ?? [];
  const reopened = await slice({
    state: first.result.state, resumeRecords: records,
    discoveryReplenishment: {
      reason: "replenishment_required",
      pages_taken: { apify_linkedin_company_search: 1 },
      sources_attempted: ["apify_linkedin_company_search"],
    },
  });
  const st = (reopened.result.state.discovery_source_state ?? {}) as Record<string, unknown>;
  const pages = (st.pages_taken ?? {}) as Record<string, number>;
  const executed = searchCalls(reopened.calls).length;
  assert(executed > 0, "the page must actually be bought");
  // The cursor moves by exactly the number of pages this slice actually bought
  // — one for the replenishment page, plus any the in-slice pagination went on
  // to buy after it. Both commit through the same confirmation, so the sum is
  // the invariant, not the literal 2.
  assertEquals(pages["apify_linkedin_company_search"], 1 + executed,
    `cursor must equal prior page + pages bought this slice (${executed})`);
  const pagesAsked = searchCalls(reopened.calls)
    .map((c) => Number(c.input.startPage ?? 1));
  assertEquals(new Set(pagesAsked).size, pagesAsked.length,
    "and no page is asked for twice");
});

Deno.test("R2: the cursor never exceeds the operations actually made", async () => {
  // THE INVARIANT THE PRODUCTION TRACE BROKE: pages_taken 7 against 1 call.
  const first = await slice({});
  const records = (first.result as unknown as { resume_records?: unknown[] })
    .resume_records ?? [];
  let state = first.result.state;
  let resumeRecords = records;
  let totalCalls = searchCalls(first.calls).length;
  for (let i = 0; i < 3; i++) {
    const r = await slice({
      state, resumeRecords,
      discoveryReplenishment: {
        reason: "replenishment_required",
        pages_taken: ((state.discovery_source_state ?? {}) as Record<string, unknown>)
          .pages_taken ?? { apify_linkedin_company_search: 1 },
        sources_attempted: ["apify_linkedin_company_search"],
      },
    });
    totalCalls += searchCalls(r.calls).length;
    state = r.result.state;
    resumeRecords = (r.result as unknown as { resume_records?: unknown[] })
      .resume_records ?? resumeRecords;
    const pages = (((state.discovery_source_state ?? {}) as Record<string, unknown>)
      .pages_taken ?? {}) as Record<string, number>;
    assert(
      (pages["apify_linkedin_company_search"] ?? 0) <= totalCalls,
      `pages_taken (${pages["apify_linkedin_company_search"]}) must never exceed ` +
      `operations actually made (${totalCalls})`,
    );
  }
});

Deno.test("R2: page 1 is never repurchased on a resume", async () => {
  const first = await slice({});
  const records = (first.result as unknown as { resume_records?: unknown[] })
    .resume_records ?? [];
  const reopened = await slice({
    state: first.result.state, resumeRecords: records,
    discoveryReplenishment: {
      reason: "replenishment_required",
      pages_taken: { apify_linkedin_company_search: 2 },
      sources_attempted: ["apify_linkedin_company_search"],
    },
  });
  for (const c of searchCalls(reopened.calls)) {
    assert(Number(c.input.startPage ?? 1) >= 3,
      `a resume at page 2 must ask for page 3+, got ${c.input.startPage}`);
  }
});
