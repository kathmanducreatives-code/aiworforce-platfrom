// WHAT THE CHECKPOINT CARRIES, RECORDED AT THE MOMENT IT IS WRITTEN.
//
// ── THE QUESTION THIS EXISTS TO ANSWER ─────────────────────────────────────
//
// On lineage 4ef85feb the enrichment gate re-bought the same ten companies
// three times. Identity resolution grew 40 -> 46 -> 51 while enrichment
// selected 12 -> 18 -> 23, so the "already enriched" baseline sat frozen at
// exactly 28 across three consecutive slices and then jumped to 51 at the end.
//
// Every component tested correct in isolation, against real production data:
// `restoreWorkingSet` restores the payload from a real checkpoint record,
// `toResumeRecord` round-trips it, `checkpointSnapshot` uses that same path, no
// checkpoint was refused as incoherent, no write errored, and no two `run-agent`
// slices ran concurrently. The effect was visible; the mechanism was not.
//
// The gap: nothing recorded what the checkpoint HELD at write time.
// `companies_enriched` goes to `onProgress`, which logs nothing, and the
// checkpoint is overwritten in place, so the history is gone.
//
// `checkpoint_published` closes that gap. This test pins the two counts that
// matter and, more importantly, proves the log can DETECT a divergence — a
// diagnostic that cannot fail is not a diagnostic.
//
// ZERO network, ZERO DB, ZERO model, ZERO spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  checkpointSnapshot,
  runCapabilityPlan,
} from "../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { parseLeadMissionDeterministic } from "../../supabase/functions/_shared/leadMission.ts";
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

interface Logged { event: string; meta: Record<string, unknown> }

async function runSlice() {
  const logs: Logged[] = [];
  await runCapabilityPlan({
    invoke: (_call: CompiledActorCall<unknown>) =>
      Promise.resolve(
        Array.from({ length: 6 }, (_, i) => row(i)) as Record<string, unknown>[],
      ),
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    evaluateMission: stubMissionEvaluator({ mission_fit: "review" }),
    planDiscovery: () =>
      Promise.resolve([{
        actor_key: "apify_linkedin_company_search",
        role: "primary",
        input: { searchQuery: "B2B SaaS", locations: ["United Kingdom"] },
      }]),
    log: (event: string, meta: Record<string, unknown>) => logs.push({ event, meta }),
  } as never, {
    mission: mission(),
    plan: buildCapabilityGraph(mission() as never),
    brain: BRAIN, maxCandidates: 50, remainingLeads: 5,
    readEnv: () => undefined,
  } as never);
  return logs;
}

Deno.test("THE DIAGNOSTIC: every publish records what the checkpoint holds", async () => {
  const logs = await runSlice();
  const published = logs.filter((l) => l.event === "checkpoint_published");

  assert(
    published.length > 0,
    "no checkpoint_published event — the diagnostic is missing, and the next " +
      "run will be as unanswerable as lineage 4ef85feb",
  );

  for (const p of published) {
    for (const k of [
      "stage",
      "companies",
      "enriched_in_memory",
      "enriched_in_records",
      "identity_actionable",
      "coherent",
    ]) {
      assert(k in p.meta, `checkpoint_published is missing ${k}`);
    }
    assertEquals(
      typeof p.meta.enriched_in_memory,
      "number",
      "enriched_in_memory must be a count",
    );
    assertEquals(
      typeof p.meta.enriched_in_records,
      "number",
      "enriched_in_records must be a count",
    );
  }
});

Deno.test("in_memory and in_records agree on a healthy slice", async () => {
  // The invariant the production data appears to violate. If this ever fails
  // offline, the loss is in `toResumeRecord` and the search is over.
  const logs = await runSlice();
  const published = logs.filter((l) => l.event === "checkpoint_published");
  assert(published.length > 0);
  for (const p of published) {
    assertEquals(
      p.meta.enriched_in_records,
      p.meta.enriched_in_memory,
      `checkpoint dropped enrichment at stage ${p.meta.stage}: ` +
        `${p.meta.enriched_in_memory} in memory, ${p.meta.enriched_in_records} in records`,
    );
  }
});

Deno.test("THE DIAGNOSTIC CAN FAIL: a dropped payload is visible in the counts", () => {
  // A diagnostic that always reports agreement proves nothing. This builds the
  // divergence by hand and confirms the two counts separate — so a real
  // production divergence would be legible rather than silent.
  const withPayload = {
    key: "https://www.linkedin.com/company/co-0",
    company: { company_name: "Co0", linkedin_company_url: "https://www.linkedin.com/company/co-0" },
    identity: { status: "verified_match", linkedin_company_url: "https://www.linkedin.com/company/co-0" },
    enriched: { companyName: "Co0", employeeCount: 60 },
    enrichment_outcome: "success",
    stage_block: null, brain_gate: null,
    completed_operations: [], yc_open_jobs: [], hiring_jobs: [],
    shortlisted: true, investigation_state: "investigated",
  } as never;

  const snap = checkpointSnapshot(
    {
      completed_capabilities: [],
      pending_capabilities: [],
      company_keys: [],
      provider_attempts: [],
      pending_runs: [],
    } as never,
    [withPayload],
  );

  const inRecords = snap.resume_records.filter((r) => {
    const e = (r.snapshot as { enriched?: unknown } | null | undefined)?.enriched;
    return e !== null && e !== undefined;
  }).length;

  assertEquals(inRecords, 1, "a company with a payload must serialise with one");

  // And the negative: strip the payload, the count must drop. This is the shape
  // a real divergence would take.
  const stripped = { ...(withPayload as Record<string, unknown>), enriched: null } as never;
  const snap2 = checkpointSnapshot(
    {
      completed_capabilities: [],
      pending_capabilities: [],
      company_keys: [],
      provider_attempts: [],
      pending_runs: [],
    } as never,
    [stripped],
  );
  const inRecords2 = snap2.resume_records.filter((r) => {
    const e = (r.snapshot as { enriched?: unknown } | null | undefined)?.enriched;
    return e !== null && e !== undefined;
  }).length;

  assertEquals(inRecords2, 0, "a dropped payload must show as zero, not be masked");
});
