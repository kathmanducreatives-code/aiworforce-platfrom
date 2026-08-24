// THE MONITORING ENDPOINT'S BOUNDARIES, PINNED AGAINST ITS OWN SOURCE.
//
// `monitoringRunner.test.ts` proves the ORCHESTRATION cannot produce Lead rows.
// This file proves the ENDPOINT that wires it cannot either — a distinction
// that matters, because every boundary the runner enforces could be undone one
// import above it. A future edit that reaches for the persistence bridge, or
// spends under the Lead authority, or wires the chain re-planner back in, fails
// here rather than in production.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = await Deno.readTextFile(
  new URL("../../../supabase/functions/run-monitoring-scan/index.ts", import.meta.url),
);

/** Every module that can put a row in front of a Lead user. */
const LEAD_PERSISTENCE_MODULES = [
  "qualifiedLeadPersistence",
  "qualificationPersistence",
  "leadWorkbenchProjection",
  "leadMissionPersistenceProjection",
  "companyFirstPersistenceProjection",
  "runAgentCompoundPersistenceAdapter",
  "finalCandidateState",
  "radarCandidatePipeline",
  "memoryWriter",
] as const;

Deno.test("1. the endpoint imports no Lead persistence module", () => {
  for (const m of LEAD_PERSISTENCE_MODULES) {
    assert(
      !SRC.includes(`${m}.ts`),
      `run-monitoring-scan imports ${m} — monitoring must not be able to write Lead rows`,
    );
  }
});

Deno.test("2. it spends under the monitoring authority, never the Lead one", () => {
  assert(SRC.includes("persistenceAuthority: MONITORING_AUTHORITY"));
  assert(
    !SRC.includes(`"capability_engine"`),
    "the endpoint names the Lead authority — the legacy writer would publish behind it",
  );
});

Deno.test("3. it owns no provider call — every actor invocation is the shared seam", () => {
  assert(SRC.includes("buildInvoker"), "the endpoint must use the shared execution seam");
  assert(
    !SRC.includes("source_with_apify"),
    "the endpoint names an actor tool directly — that is a second provider stack",
  );
  assert(!/apify\.com|actor_id\s*:/i.test(SRC), "the endpoint carries actor knowledge");
});

Deno.test("4. it does not wire the runtime chain re-planner", () => {
  // `monitoringPlanViolations` checks the plan ONCE, before spend. A planner
  // that can amend the capability chain afterwards would make that check
  // advisory rather than binding.
  assert(
    !/planExecution\s*:/.test(SRC),
    "planExecution is wired — it can amend the chain after the boundary check ran",
  );
});

Deno.test("5. the two engine seams whose absence would silently empty the feed ARE wired", () => {
  // Absent `planDiscovery`, the engine blocks discovery outright; absent
  // `evaluateMission`, nothing ever qualifies. Either omission yields a run
  // that reports success and writes zero events.
  assert(/planDiscovery\s*:/.test(SRC), "planDiscovery missing — discovery would be blocked");
  assert(/evaluateMission\s*:/.test(SRC), "evaluateMission missing — nothing could qualify");
});

Deno.test("6. held evidence is read across origins, not just monitoring's own", () => {
  const load = SRC.slice(SRC.indexOf("loadHeldEvidence:"), SRC.indexOf("writeEvent:"));
  assert(load.includes("signal_events"), "the pre-flight must read the shared store");
  assert(
    !load.includes(`.eq("origin"`),
    "held evidence is filtered by origin — Lead-proved evidence would be re-purchased",
  );
});

Deno.test("7. a human caller is authorised before the service client exists", () => {
  const membership = SRC.indexOf("workspace_members");
  const adminClient = SRC.indexOf("createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)");
  assert(membership > 0, "no membership check — the service client bypasses RLS");
  assert(
    membership < adminClient,
    "the membership check must be settled before an RLS-bypassing client is built",
  );
  assert(SRC.includes("forbidden_workspace"));
});

Deno.test("7b. only the service role key may skip membership, and never the anon key", () => {
  // The scheduled path exists because a cadence has no user signed in. It is
  // the ONE path that skips membership, so what admits a caller to it is the
  // whole boundary: the bearer must BE the service role key.
  assert(
    SRC.includes("token === SUPABASE_SERVICE_ROLE_KEY"),
    "the scheduled path must be gated on the service role key itself",
  );
  assert(
    SRC.includes("SUPABASE_SERVICE_ROLE_KEY.length > 0"),
    "an unset service key would make every caller `scheduled`",
  );
  assert(
    !/scheduled\s*=\s*[^;]*ANON/.test(SRC),
    "the anon key must never admit a caller to the membership-free path",
  );
  // And a scheduled run must not invent a user.
  assert(
    /userId:\s*string\s*\|\s*null\s*=\s*null/.test(SRC),
    "a scheduled run has no user and must not fabricate one",
  );
});

Deno.test("8. an unconfigured workspace is reported, not silently succeeded", () => {
  assert(SRC.includes("no_monitoring_subjects"));
  const idx = SRC.indexOf("no_monitoring_subjects");
  const around = SRC.slice(idx - 200, idx + 200);
  assertEquals(around.includes("ok: false"), true, "an empty watch list must not read as success");
});
