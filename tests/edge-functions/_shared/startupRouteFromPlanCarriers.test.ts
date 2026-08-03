// THE PLANNER'S REWRITE IS NOT THE USER'S WORDS.
//
// TEST task 8af17651-5fa2-48e2-af87-4bc923146243 (plan
// c2cf285d-fa72-43fe-9506-33195aefadf3, workspace
// 00000000-0000-0000-0000-000000000001) asked for founders of SaaS STARTUPS and
// executed harvestapi/linkedin-company-search (0 rows) followed by two broad
// LinkedIn Jobs rounds — 50 raw jobs, 20 companies evaluated, 0 qualified.
//
// PR #139 had already widened route inference from `tool_input.user_request` to
// `instruction`. That was not enough, and the reason is visible in this task's
// own payload: `instruction` is the PLANNER'S REWRITE. It reads "Find 5 jobs
// matching: Sales Operations OR Revenue Operations OR ..." and carries no
// company-stage word at all. Only the top-level `input` still said "startups".
//
// Ranking `instruction` above `input` therefore resolved a startup mission to
// `general_company_first` — silently, exactly as the `user_request`-only read
// did before it. The fix scans the UNION of every carrier.
//
// The fixture below is the VERBATIM payload of that task.
//
// ZERO network, ZERO Actor runs, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ROUTE_SOURCES, inferRouteFromRequest, validateHiringRoute,
} from "../../../supabase/functions/_shared/hiringRouteContract.ts";

/** Verbatim `tasks.payload.input` — the user's own sentence. */
const TASK_INPUT =
  "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";

/** Verbatim `tasks.payload.instruction` — the planner's job-shaped rewrite. */
const TASK_INSTRUCTION =
  "Find 5 jobs matching: Sales Operations OR Revenue Operations OR GTM Operations OR " +
  "Revenue Strategy and Operations OR Sales Strategy and Operations in USA " +
  "(roles: Sales Operations, Revenue Operations, GTM Operations, " +
  "Revenue Strategy and Operations, Sales Strategy and Operations)";

/** That task carried no `tool_input` at all: payload keys were input, step_index, instruction, lead_action. */
const TASK_TOOL_INPUT: Record<string, unknown> | null = null;

/** The resolution order run-agent uses. Mirrors the production call site. */
function resolveRouteRequest(
  toolInput: Record<string, unknown> | null,
  instruction: string | undefined,
  input: string | null | undefined,
): string | null {
  return [
    toolInput?.user_request as string | undefined,
    input ?? undefined,
    instruction,
    toolInput?.query as string | undefined,
  ].filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    .join("\n") || null;
}

Deno.test("the failed task's instruction really carries no company-stage word", () => {
  for (const marker of ["startup", "start-up", "yc", "seed", "series a", "early stage"]) {
    assertFalse(TASK_INSTRUCTION.toLowerCase().includes(marker),
      `if instruction ever gains "${marker}" this fixture stops reproducing the defect`);
  }
  assert(TASK_INPUT.toLowerCase().includes("startups"),
    "input is the only carrier that held the stage word");
});

Deno.test("REGRESSION: preferring instruction downgraded the route to general_company_first", () => {
  // The PR #139 resolution order: user_request -> instruction -> query.
  const pr139 = (TASK_TOOL_INPUT?.user_request as string | undefined)
    ?? TASK_INSTRUCTION
    ?? (TASK_TOOL_INPUT?.query as string | undefined)
    ?? null;
  assertEquals(pr139, TASK_INSTRUCTION);
  assertEquals(inferRouteFromRequest(pr139), "general_company_first",
    "this silent downgrade is what sent the mission to LinkedIn company search");
  // And that downgrade is what put the observed Actor on the route.
  assertEquals(ROUTE_SOURCES.general_company_first[0], "apify_linkedin_company_search");
});

Deno.test("scanning every carrier restores startup_company_first", () => {
  const req = resolveRouteRequest(TASK_TOOL_INPUT, TASK_INSTRUCTION, TASK_INPUT);
  assert(req !== null);
  assert(req!.includes(TASK_INPUT), "the user's verbatim sentence must be scanned");
  assert(req!.includes(TASK_INSTRUCTION), "the rewrite is still scanned, not discarded");
  assertEquals(inferRouteFromRequest(req), "startup_company_first");
});

Deno.test("the canonical query resolves to memo23 FIRST and solidcode as fallback", () => {
  const req = resolveRouteRequest(TASK_TOOL_INPUT, TASK_INSTRUCTION, TASK_INPUT);
  const r = validateHiringRoute({ route: inferRouteFromRequest(req) }, { userRequest: req });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.validated_route, "startup_company_first");
  assertEquals(r.validated_source_order[0], "apify_yc_companies_memo23");
  assertEquals(r.validated_source_order[1], "apify_yc_companies_solidcode");
  assertEquals(r.validated_source_order.length, 2);
  assertEquals(r.fallback_reason, null);
  // A non-fallback route is what selects executeCompanyFirstRoute in run-agent.
  assertFalse(r.validated_route === "broad_job_fallback");
});

Deno.test("the Actors this task actually ran are NOT on the fixed route", () => {
  const req = resolveRouteRequest(TASK_TOOL_INPUT, TASK_INSTRUCTION, TASK_INPUT);
  const r = validateHiringRoute({ route: inferRouteFromRequest(req) }, { userRequest: req });
  assert(r.ok);
  if (!r.ok) return;
  // harvestapi/linkedin-company-search returned 0 rows; apify_jobs then ran twice.
  for (const executed of ["apify_linkedin_company_search", "apify_jobs"]) {
    assertFalse(r.validated_source_order.includes(executed),
      `${executed} ran on task 8af17651 and must not be initial discovery for a startup mission`);
  }
});

Deno.test("broad job boards still require a structured, contract-valid reason", () => {
  // The legacy loop's own guard derives one of these; an invented string cannot pass.
  assertFalse(validateHiringRoute({ route: "broad_job_fallback" }).ok,
    "a fallback with no reason is rejected");
  assertFalse(validateHiringRoute({
    route: "broad_job_fallback", fallback_reason: "quota_unmet",
  }).ok, "an unlisted reason is rejected");
  for (const reason of [
    "primary_source_unavailable", "primary_source_no_candidates",
    "remaining_quota_justifies_round",
  ]) {
    const r = validateHiringRoute({ route: "broad_job_fallback", fallback_reason: reason });
    assert(r.ok, `${reason} is derived by run-agent and must be contract-valid`);
    if (r.ok) assertEquals(r.fallback_reason, reason);
  }
});

Deno.test("run-agent scans every carrier and guards the legacy loop at the real call site", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));

  // ── carrier union ──────────────────────────────────────────────────────────
  // SUPERSEDED SCOPE: the carrier union is now the COMPATIBILITY branch. A task
  // carrying a LeadMissionV1 routes from the mission's immutable query instead,
  // so the union must still exist and must sit behind the mission check. See
  // `leadMissionArchitecture.test.ts` for the mission path itself.
  assert(src.includes("const routeUserRequest: string | null = persistedMission"),
    "a mission must take precedence over any carrier");
  assert(src.includes("? persistedMission.original_user_query"),
    "a mission task routes from the immutable user query");
  assert(/:\s*\[\s*\n\s*tool_input_body\?\.user_request/.test(src),
    "the carrier list must survive as the fallback for pre-mission tasks");
  for (const carrier of [
    "tool_input_body?.user_request as string | undefined",
    "input ?? undefined",
    "instruction,",
    "tool_input_body?.query as string | undefined",
  ]) {
    assert(src.includes(carrier), `${carrier} must be a scanned carrier`);
  }
  assert(src.includes("inferRouteFromRequest(routeUserRequest)"),
    "route inference must read the resolved value");
  assert(src.includes("userRequest: routeUserRequest }"),
    "validation context must read the resolved value");
  assertFalse(src.includes("inferRouteFromRequest(tool_input_body?.user_request ?? null)"),
    "the user_request-only read is the original defect and must not return");
  assertFalse(/\?\?\s*instruction\s*\n\s*\?\?\s*\(tool_input_body\?\.query/.test(src),
    "the instruction-preferring chain is the PR #139 defect and must not return");

  // ── legacy containment ─────────────────────────────────────────────────────
  assert(src.includes("let legacyFallbackReason: string | null = null;"),
    "a broad-job fallback under a company-first route must be a recorded value");
  assert(src.includes('routeResolution.validated_route !== "broad_job_fallback"'),
    "the guard must key on the validated route");
  assert(src.includes('legacySkipReason = `broad_job_fallback_unjustified:'),
    "a reason the contract rejects must BLOCK the legacy loop, not excuse it");
  assert(src.includes("[run-agent][broad-job-fallback]"),
    "the fallback decision must be observable in logs");
});
