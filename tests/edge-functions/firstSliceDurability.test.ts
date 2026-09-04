// PHASE 2 — PAID DISCOVERY MUST BE DURABLE BEFORE THE MODEL WORK BEGINS.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Lineage 610951da, 2026-09-04, from its own logs:
//
//     08:36:43  discovery returned          (one Apify call, one credit)
//     08:37:00  mission-triage batch 2, 25 companies
//     08:38:40  isolate killed by the platform
//     ...       no checkpoint, ever
//
// `publish("accounts_found")` sat at the END of the discovery capability, after
// triage and after the execution-plan amendment — both model calls. The slice
// died inside them. The task kept `checkpoint_version: 0` and no
// `company_first_state`, `eligibleForAutoResume` answered `no_checkpoint` on
// every sweeper tick for two hours, and the mission's spend was stranded.
//
// The fix publishes the moment the paid rows are admitted, before any model
// work. These tests assert the ORDER, because the order is the whole fix.
//
// ZERO network, ZERO DB, ZERO model, ZERO provider spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runCapabilityPlan } from "../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { parseLeadMissionDeterministic } from "../../supabase/functions/_shared/leadMission.ts";
import { stubMissionEvaluator } from "./_shared/missionEvaluatorFixture.ts";
import type { LeadMissionV1 } from "../../supabase/functions/_shared/leadMission.ts";
import type { CompiledActorCall } from "../../supabase/functions/_shared/hiringActorInputs.ts";
import type { CheckpointSnapshot } from "../../supabase/functions/_shared/leadCapabilityEngine.ts";

const CANONICAL =
  "Find B2B SaaS companies in the United Kingdom hiring sales representatives. " +
  "Return 5 qualified leads.";

const mission = (): LeadMissionV1 => {
  const m = parseLeadMissionDeterministic(CANONICAL);
  return {
    ...m, requested_count: 5,
    company_profile: { ...m.company_profile, employee_range: { min: 20, max: 200 } },
  };
};

const BRAIN = {
  employee_min: 20, employee_max: 200,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
} as never;

const row = (i: number) => ({
  companyName: `Co${i}`,
  linkedinUrl: `https://www.linkedin.com/company/co-${i}`,
  website: `https://co-${i}.com`,
  employeeCount: 60,
  description: `Co${i} is a B2B SaaS platform sold on subscription.`,
});

/** Everything that happened, in order, so the ORDER can be asserted. */
type Event =
  | { kind: "provider"; actorKey: string }
  | { kind: "triage" }
  | { kind: "checkpoint"; coherent: boolean; companies: number; completed: string[] };

interface SliceRun {
  events: Event[];
  /**
   * THE DEATH SNAPSHOT: the events that had happened at the instant triage was
   * entered — which is where 610951da was killed.
   *
   * This, not a thrown error, is the honest model of a platform kill. An
   * exception unwinds through the engine's own catch, which then publishes a
   * checkpoint on its way out; a killed isolate publishes NOTHING. A test that
   * throws inside triage therefore passes under the old ordering too — it
   * measures the error path, not the durability of the paid rows. Asserting on
   * this prefix measures what actually survives a kill: what was already
   * written when the fatal line was reached.
   */
  atDeath: Event[] | null;
}

async function runSlice(): Promise<SliceRun> {
  const events: Event[] = [];
  let atDeath: Event[] | null = null;
  await runCapabilityPlan({
    invoke: (call: CompiledActorCall<unknown>) => {
      events.push({ kind: "provider", actorKey: call.actorKey });
      return Promise.resolve(
        Array.from({ length: 6 }, (_, i) => row(i)) as Record<string, unknown>[],
      );
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    evaluateMission: stubMissionEvaluator({ mission_fit: "review" }),
    planDiscovery: () => Promise.resolve([{
      actor_key: "apify_linkedin_company_search", role: "primary",
      input: { searchQuery: "B2B SaaS", locations: ["United Kingdom"] },
    }]),
    // THE MODEL WORK THAT KILLED 610951da, at 08:37:00. The run does not
    // survive this call, so everything durable had to exist before it.
    triageCompanies: () => {
      atDeath ??= [...events];
      events.push({ kind: "triage" });
      return Promise.resolve({ companies: [] });
    },
    onCheckpoint: (snap: CheckpointSnapshot) => {
      events.push({
        kind: "checkpoint",
        coherent: snap.coherent,
        companies: snap.resume_records.length,
        completed: [...snap.state.completed_capabilities],
      });
    },
  } as never, {
    mission: mission(),
    plan: buildCapabilityGraph(mission() as never),
    brain: BRAIN, maxCandidates: 50, remainingLeads: 5,
    readEnv: () => undefined,
  } as never);
  return { events, atDeath };
}

const checkpointsIn = (evts: Event[]) =>
  evts.filter((e) => e.kind === "checkpoint") as Array<
    Extract<Event, { kind: "checkpoint" }>
  >;

Deno.test("THE STRAND: the paid rows are checkpointed before triage is entered", async () => {
  const { events, atDeath } = await runSlice();
  assert(atDeath, "triage must have been reached, or this proves nothing");
  assert(events.some((e) => e.kind === "provider"), "discovery must have run");

  // 610951da's exact position: discovery has been PAID FOR, triage is about to
  // start, the isolate is about to be killed. What is on disk?
  const durable = checkpointsIn(atDeath);
  assert(
    durable.length >= 1,
    "ZERO checkpoints existed when the killer line was reached — this is " +
      "610951da: one Apify credit spent, `checkpoint_version: 0`, " +
      "`no_checkpoint` on every sweeper tick for two hours",
  );
});

Deno.test("THE RESUME: that checkpoint is one `assessCheckpointResume` accepts", async () => {
  // A checkpoint that exists but is refused is the same outcome as no
  // checkpoint. `assessCheckpointResume` demands coherence, restorable
  // companies, and a COMPLETED discovery capability — the last is why writing
  // state at the preflight, before any rows existed, could not have worked.
  const { atDeath } = await runSlice();
  assert(atDeath, "triage must have been reached");
  const first = checkpointsIn(atDeath)[0];
  assert(first, "no checkpoint to assess");

  assert(first.coherent, "an incoherent checkpoint is refused");
  assert(first.companies > 0, "refused as `no_restorable_companies`");
  assert(
    first.completed.some((c) => c.includes("discovery") || c.includes("resolution")),
    `refused as discovery-not-complete; completed = [${first.completed.join(", ")}]`,
  );
});

Deno.test("the pool is not double-counted by publishing twice", async () => {
  // The capability publishes AGAIN at the end of the block, carrying whatever
  // triage and the amendment decided. Publishing is cheap; FINISHING twice
  // would count the same pool twice, so only the publish is repeated.
  const { events } = await runSlice();
  const all = checkpointsIn(events);
  assert(all.length >= 2, `expected an early and a final publish, got ${all.length}`);
  const last = all[all.length - 1];
  assertEquals(
    last.completed.filter((c) => c.includes("discovery")).length <= 1,
    true,
    `discovery counted twice: [${last.completed.join(", ")}]`,
  );
});
