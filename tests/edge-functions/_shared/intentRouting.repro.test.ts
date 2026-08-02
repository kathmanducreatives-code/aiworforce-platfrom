// Reproduction: the CURRENT production routing flips a founder (person) request
// to the JOBS actor when it evaluates the planner-rewritten Scout instruction
// instead of the original user instruction. Uses production resolveProviderSource
// + extractLeadDetails. Deterministic; no provider.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveProviderSource } from "../../supabase/functions/_shared/plannedToolResolver.ts";
import { extractLeadDetails } from "../../supabase/functions/_shared/leadIntake.ts";
import {
  ORIGINAL_USER_INSTRUCTION,
  PLANNER_SCOUT_INSTRUCTION,
  CURRENT_WRONG_ROUTE,
  REQUIRED_ROUTE,
  FROZEN_WRONG_PERSISTED_ROWS,
} from "../../supabase/functions/_shared/intentRoutingFixture.ts";

Deno.test("repro: routing the PLANNER Scout prose flips a founder request to apify_jobs", () => {
  // run-agent currently calls resolveProviderSource(instruction ?? input), i.e. the
  // planner-rewritten Scout instruction. "hiring signals" → jobs.
  assertEquals(extractLeadDetails(PLANNER_SCOUT_INSTRUCTION).mode, "hiring");
  const r = resolveProviderSource(PLANNER_SCOUT_INSTRUCTION);
  assertEquals(r?.kind, CURRENT_WRONG_ROUTE.kind);
  assertEquals(r?.actor_key, CURRENT_WRONG_ROUTE.actor_key);
});

Deno.test("repro: routing the ORIGINAL user instruction would (correctly) select people search", () => {
  const r = resolveProviderSource(ORIGINAL_USER_INSTRUCTION);
  assertEquals(r?.kind, REQUIRED_ROUTE.kind);
  assertEquals(r?.actor_key, REQUIRED_ROUTE.actor_key);
});

Deno.test("repro: the flip is driven purely by which instruction is evaluated", () => {
  const fromPlanner = resolveProviderSource(PLANNER_SCOUT_INSTRUCTION);
  const fromOriginal = resolveProviderSource(ORIGINAL_USER_INSTRUCTION);
  assert(fromPlanner?.actor_key !== fromOriginal?.actor_key, "same query, two answers — instruction source decides the actor");
});

Deno.test("repro: the four persisted rows are jobs, not founders", () => {
  assertEquals(FROZEN_WRONG_PERSISTED_ROWS.length, 4);
  for (const row of FROZEN_WRONG_PERSISTED_ROWS) assert(/\/jobs\/view\//.test(row.source_url), "row is a job posting URL");
});
