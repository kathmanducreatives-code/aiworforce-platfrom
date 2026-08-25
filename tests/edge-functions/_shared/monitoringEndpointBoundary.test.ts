// THE MONITORING ENDPOINT'S BOUNDARIES, PINNED AGAINST ITS OWN SOURCE.
//
// `monitoringRunner.test.ts` proves the ORCHESTRATION cannot produce Lead rows.
// This file proves the ENDPOINT that wires it cannot either — a distinction
// that matters, because every boundary the runner enforces could be undone one
// import above it. A future edit that reaches for the persistence bridge, or
// spends under the Lead authority, or wires the chain re-planner back in, fails
// here rather than in production.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";

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
  // NAMING AN ACTOR is the thing forbidden — not the ledger column that happens
  // to be called `actor_id`, which Phase 7 fills with the MODEL that judged a
  // cluster. The property is "this endpoint chooses no provider", so the check
  // is for provider identifiers, not for a column name.
  assert(!/apify\.com/i.test(SRC), "the endpoint names an Apify actor");
  assertFalse(
    /actor_id:\s*"[a-z0-9_]+\/[a-z0-9-]+"/i.test(SRC),
    "the endpoint hardcodes an actor id",
  );
  assertFalse(/harvestapi|memo23|datahyena|solidcode/i.test(SRC),
    "the endpoint names a provider actor");
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

Deno.test("9. the agent slug it spends under is one the tool registry actually allows", async () => {
  // Live run 2026-08-24: the endpoint presented `signals-monitor`, which is on
  // no allow-list, so every provider call returned `tool_forbidden` and the run
  // reported a clean success having collected nothing. A slug is not a label —
  // it is the permission, and `logToolCall` writes it to `tool_calls` as the
  // record of who bought what.
  const slug = SRC.match(/agent_slug:\s*"([a-z0-9_]+)"/)?.[1];
  assert(slug, "the endpoint must state the agent slug it spends under");

  const REGISTRY = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/toolRegistry.ts", import.meta.url),
  );
  const entry = REGISTRY.slice(REGISTRY.indexOf("  source_with_apify: {"));
  const allowed = entry.slice(0, entry.indexOf("},")).match(
    /allowed_agents:\s*\[([^\]]*)\]/,
  )?.[1] ?? "";
  assert(
    allowed.includes(`"${slug}"`),
    `the registry does not permit "${slug}" to use source_with_apify — every ` +
    `provider call would be forbidden. Allowed: ${allowed}`,
  );
  // AND IT MUST NOT BORROW A LEAD AGENT'S IDENTITY to get that permission.
  for (const leadAgent of ["scout", "hawk"]) {
    assert(slug !== leadAgent, `monitoring is spending as the Lead agent "${leadAgent}"`);
  }
});

Deno.test("10. it can see the wall clock, and a pending provider run is not a failure", async () => {
  // Live run 2026-08-24: the worker was killed with WORKER_RESOURCE_LIMIT while
  // an Apify job search was still RUNNING, and the engine recorded it as
  // `provider_error` — a paid run discarded, a capability failed for a reason
  // that was not the provider's, and a fallback free to spend against it.
  assert(
    SRC.includes("deadline: createExecutionDeadline("),
    "without a deadline the engine cannot reserve time to checkpoint",
  );
  assert(SRC.includes("readPendingRun"), "a started-but-unfinished run must not read as an error");

  // AND IT MUST BE THE SAME FUNCTION LEADS USE, not a second reading of the
  // same error shape. Both import it from the seam that throws that shape.
  const seam = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/capabilityExecution.ts", import.meta.url),
  );
  assert(seam.includes("export function readPendingRun("));
  const runAgent = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  assert(
    /import \{[^}]*readPendingRun[^}]*\} from "\.\.\/_shared\/capabilityExecution\.ts"/.test(runAgent),
    "run-agent must read pending runs through the shared seam, not a local copy",
  );
  assertFalse(
    /const readPendingRun\s*=/.test(runAgent),
    "run-agent still defines its own readPendingRun — two readings of one contract",
  );
});

Deno.test("11. a pass may ask to be smaller, never larger", () => {
  // Live run 2026-08-25: 25 funded companies discovered, ten enriched, and
  // `qualification_deadline_stop` fired with `evaluated: 0` — the wall clock was
  // gone before the first model call, so nothing could qualify and the feed
  // stayed empty for a run that had paid for everything up to that point.
  const fn = SRC.slice(SRC.indexOf("function requestedMaxCandidates("));
  const body = fn.slice(0, fn.indexOf("\n}"));

  // Clamped to the ceiling, never above it.
  assert(
    body.includes("Math.min(Math.floor(n), MONITORING_MAX_CANDIDATES)"),
    "a caller must not be able to ask for a larger pass than the ceiling",
  );
  // An absent or unusable value keeps today's behaviour.
  assert(
    /!Number\.isFinite\(n\) \|\| n < 1/.test(body),
    "an absent or unusable size must fall back to the ceiling, not to zero",
  );
  // And the size actually reaches BOTH the engine and the evaluation budget —
  // a shortlist of 25 with a pool of 3 would authorise calls for companies
  // that do not exist.
  assert(SRC.includes("shortlistSize: maxCandidates"), "the evaluation budget must follow");
  assert(SRC.includes("mission, plan, maxCandidates,"), "and so must the engine's pool bound");
  // It is reported, so a reader knows how big the pass actually was.
  assert(SRC.includes("max_candidates: maxCandidates"));
});
