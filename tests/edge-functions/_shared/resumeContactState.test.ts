// RESUME STATE FROM CANONICAL PERSISTENCE — offline, isolated client.
//
// Drives the REAL `loadPriorContactIdentities` against a mock lead_candidates
// table, and asserts through source that run-agent performs the lookup BEFORE
// any paid boundary. ZERO network, ZERO paid Actor runs.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeCompanyFirstQuotaProgress, loadPriorContactIdentities,
  nextAdaptiveAction, reconcilePriorIdentities,
} from "../../../supabase/functions/_shared/qualifiedLeadPersistence.ts";

const WS = "ws-1", PLAN = "plan-1", TASK = "task-1";

/**
 * Mock client modelling PostgREST filter semantics.
 *
 * The distinction that matters: `.eq(col, null)` becomes `col=eq.null` and
 * matches NOTHING (SQL `= NULL` is never true), while `.is(col, null)` becomes
 * `col=is.null` and matches NULL rows. The mock reproduces that faithfully —
 * otherwise it would paper over the exact bug under test.
 */
function db(rows: Record<string, unknown>[], opts: { throwOn?: boolean } = {}) {
  const filters: Array<{ op: "eq" | "is"; col: string; val: unknown }> = [];
  const make = () => {
    const chain = {
      eq(col: string, val: unknown) { filters.push({ op: "eq", col, val }); return chain; },
      is(col: string, val: null) { filters.push({ op: "is", col, val }); return chain; },
      then(res: (v: { data: unknown }) => unknown, rej?: (e: unknown) => unknown) {
        if (opts.throwOn) return Promise.reject(new Error("db unavailable")).then(res, rej);
        const data = rows.filter((r) =>
          filters.every((f) => {
            const cell = (r as Record<string, unknown>)[f.col] ?? null;
            // `eq` with null matches nothing, exactly as PostgREST behaves.
            if (f.op === "eq") return f.val !== null && cell === f.val;
            return cell === null;
          }));
        return Promise.resolve({ data }).then(res, rej);
      },
    };
    return chain;
  };
  return {
    filters,
    client: { from: (_t: string) => ({ select: (_c: string) => make() }) },
  };
}

/** A persisted CONTACT row exactly as persistPlan writes one. */
const contactRow = (id: string, over: Record<string, unknown> = {}) => ({
  id, workspace_id: WS, plan_id: PLAN, account_id: `acct-${id}`, lead_type: "person",
  raw: { contact_eligible: true, task_id: TASK, record_kind: "founder",
    person: { source_profile_id: `P-${id}` } },
  ...over,
});

// ═══ 1. THE LOOKUP READS CANONICAL STATE ═══════════════════════════════════
Deno.test("1. persisted CONTACT rows become prior identities", async () => {
  const d = db([contactRow("lc1"), contactRow("lc2")]);
  const s = await loadPriorContactIdentities(d.client as never,
    { workspaceId: WS, planId: PLAN, taskId: TASK });
  assertEquals(s.identities, ["lc:lc1", "lc:lc2"]);
  assertEquals(s.source, "canonical_persisted_state");
  assertEquals(s.error, null);
  // Scope was pushed into the QUERY, not filtered only in memory.
  assertEquals(d.filters.find((f) => f.col === "workspace_id")?.val, WS);
  const plan = d.filters.find((f) => f.col === "plan_id")!;
  assertEquals(plan.op, "eq", "a real plan id uses equality");
  assertEquals(plan.val, PLAN);
});

// ═══ 2/13. QUOTA-SATISFIED RESUME ═════════════════════════════════════════
Deno.test("2/13. five persisted CONTACTs satisfy a quota of five => stop", async () => {
  const d = db(["a", "b", "c", "d", "e"].map((x) => contactRow(x)));
  const s = await loadPriorContactIdentities(d.client as never,
    { workspaceId: WS, planId: PLAN, taskId: TASK });
  assertEquals(s.identities.length, 5);
  const p = computeCompanyFirstQuotaProgress({
    persisted: [], legacyContactIdentities: s.identities, requestedQuota: 5 });
  assertEquals(p.remaining_quota, 0);
  assertEquals(nextAdaptiveAction(p).action, "stop_quota_satisfied");
});

// ═══ 3. PARTIAL QUOTA ═════════════════════════════════════════════════════
Deno.test("3. three persisted CONTACTs against a quota of five leave two", async () => {
  const d = db(["a", "b", "c"].map((x) => contactRow(x)));
  const s = await loadPriorContactIdentities(d.client as never,
    { workspaceId: WS, planId: PLAN, taskId: TASK });
  const p = computeCompanyFirstQuotaProgress({
    persisted: [], legacyContactIdentities: s.identities, requestedQuota: 5 });
  assertEquals(p.deduplicated_contact_credit, 3);
  assertEquals(p.remaining_quota, 2);
  assertEquals(nextAdaptiveAction(p).action, "continue_sourcing");
});

// ═══ 4. DUPLICATES ════════════════════════════════════════════════════════
Deno.test("4. the same persisted lead row twice counts once", async () => {
  const d = db([contactRow("dup"), contactRow("dup")]);
  const s = await loadPriorContactIdentities(d.client as never,
    { workspaceId: WS, planId: PLAN, taskId: TASK });
  assertEquals(s.identities, ["lc:dup"]);
});

// ═══ 5/9. EXCLUDED ROWS ═══════════════════════════════════════════════════
Deno.test("5/9. WATCH, NEEDS_REVIEW, account records and failed writes never count", async () => {
  const d = db([
    // contact_eligible false covers WATCH / NEEDS_REVIEW / REJECT / SKIP and a
    // CONTACT that lost its account — persistPlan sets the flag only for a
    // CONTACT with a real account id.
    contactRow("watch", { raw: { contact_eligible: false, task_id: TASK } }),
    contactRow("review", { raw: { contact_eligible: false, task_id: TASK } }),
    // Account-level record: progress, not a lead.
    contactRow("acct", { lead_type: "account" }),
    // A genuine one, to prove the filter is not simply rejecting everything.
    contactRow("real"),
  ]);
  const s = await loadPriorContactIdentities(d.client as never,
    { workspaceId: WS, planId: PLAN, taskId: TASK });
  assertEquals(s.identities, ["lc:real"]);
});

// ═══ 6. PENDING WORK ══════════════════════════════════════════════════════
Deno.test("6. zero prior CONTACT with pending work waits instead of sourcing", async () => {
  const d = db([contactRow("pending", { raw: { contact_eligible: false, task_id: TASK } })]);
  const s = await loadPriorContactIdentities(d.client as never,
    { workspaceId: WS, planId: PLAN, taskId: TASK });
  assertEquals(s.identities.length, 0);
  const p = computeCompanyFirstQuotaProgress({
    persisted: [], legacyContactIdentities: s.identities,
    requestedQuota: 5, contactPending: 2 });
  assertEquals(nextAdaptiveAction(p).action, "await_pending_work");
});

// ═══ 7/8. SCOPE ═══════════════════════════════════════════════════════════
Deno.test("7/8. rows from another workspace, plan or task contribute nothing", async () => {
  const d = db([
    contactRow("other_ws", { workspace_id: "ws-2" }),
    contactRow("other_plan", { plan_id: "plan-2" }),
    // Same workspace AND plan, but a sibling task — the plan filter alone would
    // let this through, which is why the loader re-checks raw.task_id.
    contactRow("other_task", {
      raw: { contact_eligible: true, task_id: "task-2", person: { source_profile_id: "X" } } }),
    contactRow("mine"),
  ]);
  const s = await loadPriorContactIdentities(d.client as never,
    { workspaceId: WS, planId: PLAN, taskId: TASK });
  assertEquals(s.identities, ["lc:mine"], "quota must never leak across scopes");
});

// ═══ 10/11. THE REQUEST BODY IS NOT AUTHORITATIVE ═════════════════════════
Deno.test("10/11. a stale or hostile request list cannot inflate quota", async () => {
  const d = db([contactRow("real")]);
  const s = await loadPriorContactIdentities(d.client as never,
    { workspaceId: WS, planId: PLAN, taskId: TASK });

  // No hint: persisted state is used as-is.
  assertEquals(reconcilePriorIdentities(s, null).identities, ["lc:real"]);
  assertEquals(reconcilePriorIdentities(s, []).identities, ["lc:real"]);

  // A hostile list claiming five extra leads changes nothing.
  const hostile = reconcilePriorIdentities(s,
    ["lc:fake1", "lc:fake2", "lc:fake3", "lc:fake4", "lc:fake5"]);
  assertEquals(hostile.identities, ["lc:real"], "persisted state wins");
  assertEquals(hostile.ignored_request_identities, 5);
  const p = computeCompanyFirstQuotaProgress({
    persisted: [], legacyContactIdentities: hostile.identities, requestedQuota: 5 });
  assertEquals(p.remaining_quota, 4, "the task must keep sourcing, not stop early");
});

// ═══ A LOOKUP FAILURE FAILS TOWARD SOURCING ═══════════════════════════════
Deno.test("a lookup failure yields zero prior credit, never a phantom quota", async () => {
  const d = db([contactRow("x")], { throwOn: true });
  const s = await loadPriorContactIdentities(d.client as never,
    { workspaceId: WS, planId: PLAN, taskId: TASK });
  assertEquals(s.identities.length, 0);
  assert(s.error, "the failure must be recorded, not swallowed silently");
  assertEquals(nextAdaptiveAction(computeCompanyFirstQuotaProgress({
    persisted: [], legacyContactIdentities: s.identities, requestedQuota: 5,
  })).action, "continue_sourcing", "failing closed here would stop a task on a phantom quota");
});

// ═══ 12/14. STRUCTURE: LOADED BEFORE ANY PAID BOUNDARY ════════════════════
Deno.test("12/14. run-agent loads persisted prior state before any provider call", async () => {
  const src = await Deno.readTextFile(new URL("../run-agent/index.ts", import.meta.url));

  // The request body is no longer the source.
  assertFalse(src.includes("legacyContactIdentities: []"),
    "an empty literal would silently disable resume credit");
  assertFalse(/const priorLegacyContactIdentities[^=]*=\s*collectLegacyContactIdentities\(\s*\(\(body/.test(src),
    "resume identities must not come from the request body");
  assert(src.includes("loadPriorContactIdentities("),
    "the canonical persisted lookup must be used");
  assert(src.includes("reconcilePriorIdentities("),
    "and any request hint must be reconciled, never trusted");

  // ORDERING: the lookup precedes BOTH paid boundaries.
  const lookup = src.indexOf("loadPriorContactIdentities(");
  const route = src.indexOf("executeCompanyFirstRoute({");
  const legacy = src.indexOf("executeRunAgentCompanyFirstSourcing({");
  assert(lookup > -1 && route > -1 && legacy > -1);
  assert(lookup < route, "prior state must load before company-first discovery");
  assert(lookup < legacy, "and before the legacy sourcing loop");

  // The pre-check gates the company-first route itself.
  assert(src.includes("const resumeSatisfied = priorDecision.action === \"stop_quota_satisfied\""),
    "a satisfied resume must be an explicit pre-loop decision");
  assert(src.includes("if (!resumeSatisfied && routeResolution.ok"),
    "a satisfied resume must skip company-first discovery entirely");
  assert(src.includes("quota_satisfied_by_persisted_prior_contacts"),
    "and skip the legacy loop with a recorded reason");

  // Diagnostics carry digests, not raw identifiers.
  assert(src.includes("identity_digests: priorContactState.identity_digests"));
  assertFalse(src.includes("identities: priorLegacyContactIdentities,"),
    "raw identities must not be logged");
});


// ═══ NULL plan_id — `IS NULL`, NEVER `= NULL` ══════════════════════════════
//
// PostgREST renders `.eq("plan_id", null)` as `plan_id=eq.null`, which matches
// no rows. A task with no plan would find none of its own persisted CONTACTs
// and re-source leads it had already paid for.

const nullPlanRow = (id: string, over: Record<string, unknown> = {}) => ({
  id, workspace_id: WS, plan_id: null, account_id: `acct-${id}`, lead_type: "person",
  raw: { contact_eligible: true, task_id: TASK, record_kind: "founder",
    person: { source_profile_id: `P-${id}` } },
  ...over,
});

Deno.test("N1. a non-null plan counts only that plan's CONTACT rows", async () => {
  const d = db([contactRow("mine"), contactRow("other", { plan_id: "plan-2" }), nullPlanRow("noplan")]);
  const s = await loadPriorContactIdentities(d.client as never,
    { workspaceId: WS, planId: PLAN, taskId: TASK });
  assertEquals(s.identities, ["lc:mine"]);
});

Deno.test("N2. a null plan loads rows where plan_id IS NULL", async () => {
  const d = db([nullPlanRow("a"), nullPlanRow("b")]);
  const s = await loadPriorContactIdentities(d.client as never,
    { workspaceId: WS, planId: null, taskId: TASK });
  assertEquals(s.identities, ["lc:a", "lc:b"],
    "a plan-less task must still find its own persisted CONTACTs");
  // The builder must have used `is`, not `eq` — `eq` would have matched nothing.
  const plan = d.filters.find((f) => f.col === "plan_id")!;
  assertEquals(plan.op, "is");
  assertEquals(plan.val, null);
});

Deno.test("N3. plan rows do not count for a null-plan task", async () => {
  const d = db([contactRow("planned"), nullPlanRow("mine")]);
  const s = await loadPriorContactIdentities(d.client as never,
    { workspaceId: WS, planId: null, taskId: TASK });
  assertEquals(s.identities, ["lc:mine"]);
});

Deno.test("N4. null-plan rows do not count for a task that has a plan", async () => {
  const d = db([nullPlanRow("noplan"), contactRow("mine")]);
  const s = await loadPriorContactIdentities(d.client as never,
    { workspaceId: WS, planId: PLAN, taskId: TASK });
  assertEquals(s.identities, ["lc:mine"]);
});

Deno.test("N5. workspace and task scope still apply on the null-plan path", async () => {
  const d = db([
    nullPlanRow("other_ws", { workspace_id: "ws-2" }),
    nullPlanRow("other_task", {
      raw: { contact_eligible: true, task_id: "task-2", person: { source_profile_id: "X" } } }),
    nullPlanRow("mine"),
  ]);
  const s = await loadPriorContactIdentities(d.client as never,
    { workspaceId: WS, planId: null, taskId: TASK });
  assertEquals(s.identities, ["lc:mine"]);
});

Deno.test("N6. a quota-satisfied null-plan resume stops before any provider call", async () => {
  const d = db(["a", "b", "c"].map((x) => nullPlanRow(x)));
  const s = await loadPriorContactIdentities(d.client as never,
    { workspaceId: WS, planId: null, taskId: TASK });
  const p = computeCompanyFirstQuotaProgress({
    persisted: [], legacyContactIdentities: s.identities, requestedQuota: 3 });
  assertEquals(p.remaining_quota, 0);
  assertEquals(nextAdaptiveAction(p).action, "stop_quota_satisfied",
    "before the fix this resumed with zero credit and sourced again");
});

Deno.test("N7. duplicate null-plan CONTACT rows still count once", async () => {
  const d = db([nullPlanRow("dup"), nullPlanRow("dup")]);
  const s = await loadPriorContactIdentities(d.client as never,
    { workspaceId: WS, planId: null, taskId: TASK });
  assertEquals(s.identities, ["lc:dup"]);
});

Deno.test("N8. WATCH/NEEDS_REVIEW/REJECT/SKIP still never count on the null-plan path", async () => {
  const d = db([
    nullPlanRow("watch", { raw: { contact_eligible: false, task_id: TASK } }),
    nullPlanRow("acct", { lead_type: "account" }),
    nullPlanRow("real"),
  ]);
  const s = await loadPriorContactIdentities(d.client as never,
    { workspaceId: WS, planId: null, taskId: TASK });
  assertEquals(s.identities, ["lc:real"]);
});

Deno.test("N9. the loader branches on the plan filter rather than always using eq", async () => {
  const src = await Deno.readTextFile(
    new URL("./qualifiedLeadPersistence.ts", import.meta.url));
  assert(src.includes('query.is("plan_id", null)'),
    "a null plan must use IS NULL");
  assert(src.includes('query.eq("plan_id", scope.planId)'),
    "a real plan must use equality");
  assertFalse(src.includes('.eq("plan_id", scope.planId ?? null)'),
    "the null case must not collapse back into eq");
});
