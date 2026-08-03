// THE ROUTE MUST SURVIVE THE PLAN CONTRACT.
//
// Production task a090311d-4d08-4cb8-895b-516e9135b803 (plan
// 15c385c3-fc88-43ff-a531-fb714a234875) ran Indeed -> LinkedIn Jobs -> Glassdoor
// for a SaaS-startup query. One cause was a propagation gap: run-agent inferred
// the route from `tool_input.user_request`, and no production plan populates
// that field. The request text lives in the top-level `instruction` and in
// `tool_input.query`.
//
// `inferRouteFromRequest(null)` returns `general_company_first` — a SILENT
// downgrade, not an error. That is what made it dangerous: every offline test
// passed, because they hand the request in directly.
//
// The fixture below is the REAL tool_input from that task: 18 fields, no
// `user_request`.
//
// ZERO network, ZERO Actor runs, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ROUTE_SOURCES, inferRouteFromRequest, validateHiringRoute,
} from "../../../supabase/functions/_shared/hiringRouteContract.ts";

const CANONICAL =
  "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";

/** Verbatim from the production plan's step[0].metadata.tool_input. */
const PRODUCTION_TOOL_INPUT: Record<string, unknown> = {
  query: CANONICAL,
  intent: "source_qualified_leads",
  reason: "classifier: company_hiring_sourcing → qualified_lead_sourcing",
  location: "USA",
  tool_name: "source_with_apify",
  confidence: 0.9,
  lead_intent: { count: 5, role_family: "sales_operations", source_type: "jobs" },
  max_results: 5,
  count_entity: "contact_ready_lead",
  quota_policy: "contact_only",
  role_keywords: ["Sales Operations", "Revenue Operations", "GTM Operations"],
  workflow_kind: "qualified_lead_sourcing",
  execution_mode: "company_first",
  missing_fields: [],
  needs_outreach: false,
  needs_enrichment: false,
  requested_lead_count: 5,
  // NOTE: no `user_request`. That absence IS the defect under test.
};

/**
 * The resolution run-agent uses. Mirrors the production call site.
 *
 * SUPERSEDED SHAPE: this began as a priority chain (`user_request ?? instruction
 * ?? query`). TEST task 8af17651-5fa2-48e2-af87-4bc923146243 showed a priority
 * chain still loses the route whenever the winning carrier is the planner's
 * rewrite, so every carrier is now scanned. See
 * `startupRouteFromPlanCarriers.test.ts`. The assertions below are unchanged in
 * intent and strictly harder to satisfy: the route must survive REGARDLESS of
 * which carrier holds the words.
 */
function resolveRouteRequest(
  toolInput: Record<string, unknown> | null,
  instruction: string | undefined,
  input?: string | null,
): string | null {
  return [
    toolInput?.user_request as string | undefined,
    input ?? undefined,
    instruction,
    toolInput?.query as string | undefined,
  ].filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    .join("\n") || null;
}

Deno.test("the production payload really has no user_request", () => {
  assertFalse("user_request" in PRODUCTION_TOOL_INPUT,
    "if this ever gains user_request the fixture stops reproducing the defect");
  assertEquals(PRODUCTION_TOOL_INPUT.requested_lead_count, 5);
});

Deno.test("REGRESSION: the old logic silently downgraded to general_company_first", () => {
  const oldValue = (PRODUCTION_TOOL_INPUT.user_request as string | undefined) ?? null;
  assertEquals(oldValue, null);
  assertEquals(inferRouteFromRequest(oldValue), "general_company_first",
    "this silent downgrade is what the fix removes");
});

Deno.test("a missing user_request no longer downgrades the route", () => {
  assertEquals(
    inferRouteFromRequest(resolveRouteRequest(PRODUCTION_TOOL_INPUT, CANONICAL)),
    "startup_company_first");
});

Deno.test("startup intent survives in WHICHEVER carrier holds it", () => {
  // Carriers present and DIFFERENT: the stage word must not be shadowed by a
  // sibling carrier that lacks it. This is what a priority chain got wrong.
  const shadowed = resolveRouteRequest(
    { ...PRODUCTION_TOOL_INPUT, query: "Find cybersecurity companies hiring RevOps" },
    CANONICAL);
  assert(shadowed!.includes(CANONICAL), "instruction is scanned");
  assert(shadowed!.includes("cybersecurity"), "tool_input.query is scanned too, not dropped");
  assertEquals(inferRouteFromRequest(shadowed), "startup_company_first");

  // Each carrier ALONE is sufficient.
  assertEquals(inferRouteFromRequest(
    resolveRouteRequest(PRODUCTION_TOOL_INPUT, undefined)), "startup_company_first",
    "tool_input.query alone");
  assertEquals(inferRouteFromRequest(
    resolveRouteRequest(null, CANONICAL)), "startup_company_first", "instruction alone");
  assertEquals(inferRouteFromRequest(
    resolveRouteRequest(null, undefined, CANONICAL)), "startup_company_first", "input alone");
  assertEquals(inferRouteFromRequest(resolveRouteRequest(
    { ...PRODUCTION_TOOL_INPUT, query: undefined, user_request: "YC startups hiring RevOps" },
    undefined)), "startup_company_first", "user_request alone");

  // No carrier at all is still the honest downgrade, not a crash.
  assertEquals(resolveRouteRequest(null, undefined), null);
  assertEquals(inferRouteFromRequest(null), "general_company_first");
});

Deno.test("the canonical query selects startup_company_first with memo23 FIRST", () => {
  const req = resolveRouteRequest(PRODUCTION_TOOL_INPUT, CANONICAL);
  const r = validateHiringRoute({ route: inferRouteFromRequest(req) }, { userRequest: req });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.validated_route, "startup_company_first");
  assertEquals(r.validated_source_order[0], "apify_yc_companies_memo23");
  assertEquals(r.validated_source_order[1], "apify_yc_companies_solidcode");
  // run-agent runs executeCompanyFirstRoute for any validated non-fallback route.
  assertFalse(r.validated_route === "broad_job_fallback",
    "a non-fallback route is what selects executeCompanyFirstRoute");
  assertEquals(r.fallback_reason, null);
});

Deno.test("Indeed, LinkedIn Jobs and Glassdoor are NOT selected", () => {
  const req = resolveRouteRequest(PRODUCTION_TOOL_INPUT, CANONICAL);
  const r = validateHiringRoute({ route: inferRouteFromRequest(req) }, { userRequest: req });
  assert(r.ok);
  if (!r.ok) return;
  // The exact actor keys production task a090311d executed.
  for (const legacy of [
    "apify_indeed_jobs_automation_lab", "apify_linkedin_jobs_crawlworks",
    "apify_glassdoor_jobs", "apify_ats_verification",
  ]) {
    assertFalse(r.validated_source_order.includes(legacy),
      `${legacy} ran in production task a090311d and must not be on this route`);
  }
  // They remain reachable ONLY through the fallback route, which needs a reason.
  assert(ROUTE_SOURCES.broad_job_fallback.includes("apify_indeed_jobs_automation_lab"));
  assertFalse(validateHiringRoute({ route: "broad_job_fallback" }).ok,
    "the legacy sources still require a structured fallback reason");
});

Deno.test("run-agent uses the widened resolution at the real call site", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  assert(src.includes("const routeUserRequest: string | null ="),
    "the resolved request must be a named value at the call site");
  assert(src.includes("instruction,"), "instruction must be a carrier");
  assert(src.includes("tool_input_body?.query as string | undefined"),
    "tool_input.query must be a carrier");
  assert(src.includes("inferRouteFromRequest(routeUserRequest)"),
    "route inference must read the resolved value");
  assert(src.includes("userRequest: routeUserRequest }"),
    "validation context must read the resolved value");
  assertFalse(src.includes("inferRouteFromRequest(tool_input_body?.user_request ?? null)"),
    "the user_request-only read is the defect and must not return");
});
