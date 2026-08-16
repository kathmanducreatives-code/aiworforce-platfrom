// STAGE 3 — THE FIRST CODE THAT MOVES MONEY, AND WHAT STOPS IT MOVING WRONGLY.
//
// These prove the rules that decide a charge:
//
//   * the caller cannot name a price, a workspace or a company we did not source;
//   * an unlock of a company absent from the run's OWN results is refused;
//   * a repeat unlock is a replay, not a second provider run;
//   * a provider that ran and verified nobody costs the user nothing;
//   * founder discovery is still unreachable from ordinary sourcing.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes. Every
// provider is injected.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  authorizeUnlock, deriveIdempotencyKey, findCompletedUnlock, findPoolRow,
  parseUnlockRequest, UNLOCK_REFUSAL_STATUS, UNLOCK_RESULT_KEY,
} from "../../../supabase/functions/_shared/founderUnlockContract.ts";
import {
  computeActualCharge, computeUnlockCharge, unlockPrice, UNLOCK_CREDIT_COSTS,
} from "../../../supabase/functions/_shared/pricing.ts";
import {
  runFounderUnlock, UNLOCK_PROVIDERS,
} from "../../../supabase/functions/_shared/founderUnlockRunner.ts";

const POOL_ROW = (over: Record<string, unknown> = {}) => ({
  company_key: "co1", company_name: "Co One",
  brain_decision: "qualified", recommended_action: "offer_founder_unlock",
  ...over,
});
const TASK_RESULT = (rows: Record<string, unknown>[] = [POOL_ROW()]) => ({
  workbench_pool: { rows },
});
const REQ = (over: Record<string, unknown> = {}) => ({
  task_id: "task-1", company_key: "co1", unlock_type: "founder_unlock", ...over,
});

// ═════════════════════════════════════════════ 1-8. the request contract ══

Deno.test("1-4. the request carries three fields and no authority", () => {
  const ok = parseUnlockRequest(REQ());
  assert(ok.ok);
  assertEquals(ok.request.task_id, "task-1");
  assertEquals(ok.request.unlock_type, "founder_unlock");

  for (const [body, refusal] of [
    [null, "invalid_json_body"],
    ["a string", "invalid_json_body"],
    [[], "invalid_json_body"],
    [{ company_key: "co1", unlock_type: "founder_unlock" }, "missing_task_id"],
    [{ task_id: "t", unlock_type: "founder_unlock" }, "missing_company_key"],
    [REQ({ unlock_type: "free_unlock" }), "invalid_unlock_type"],
    [REQ({ unlock_type: "" }), "invalid_unlock_type"],
  ] as const) {
    const r = parseUnlockRequest(body);
    assertFalse(r.ok, `${JSON.stringify(body)?.slice(0, 40)} must be refused`);
    assertEquals((r as { refusal: string }).refusal, refusal);
  }
});

Deno.test("5-6. price, workspace and credits supplied by a caller are ignored", () => {
  const r = parseUnlockRequest(REQ({
    price: 0, credits: 0, amount: 0, workspace_id: "someone-elses",
    idempotency_key: "attacker-chosen", founders: [{ name: "fake" }],
  }));
  assert(r.ok);
  // The parsed request has THREE fields. Nothing a caller invented survives.
  assertEquals(Object.keys(r.request).sort(),
    ["company_key", "task_id", "unlock_type"]);
});

Deno.test("7-8. the idempotency key is derived, and separates every purchase", () => {
  const k = deriveIdempotencyKey(REQ() as never);
  assertEquals(k, deriveIdempotencyKey(REQ() as never), "same purchase, same key");
  // A different company, run or kind is a DIFFERENT purchase.
  assert(k !== deriveIdempotencyKey(REQ({ company_key: "co2" }) as never));
  assert(k !== deriveIdempotencyKey(REQ({ task_id: "task-2" }) as never));
  assert(k !== deriveIdempotencyKey(REQ({ unlock_type: "contact_unlock" }) as never));
});

// ══════════════════════════════════ 9-16. you may only buy what you sourced ══

Deno.test("9-11. a company absent from the run's own results cannot be unlocked", () => {
  assertEquals(findPoolRow(TASK_RESULT(), "co1")?.company_key, "co1");
  assertEquals(findPoolRow(TASK_RESULT(), "not-sourced"), null);
  // Malformed or missing pools prove nothing, so they authorise nothing.
  for (const junk of [null, {}, { workbench_pool: {} }, { workbench_pool: { rows: "x" } }]) {
    assertEquals(findPoolRow(junk, "co1"), null);
  }

  const r = authorizeUnlock({
    request: REQ() as never, taskResult: TASK_RESULT(),
    founderUnlockCompleted: false,
  });
  assert(r.ok);

  // THE FORGERY CASE: a company key the caller invented.
  const forged = authorizeUnlock({
    request: REQ({ company_key: "acme-inc" }) as never,
    taskResult: TASK_RESULT(), founderUnlockCompleted: false,
  });
  assertFalse(forged.ok);
  assertEquals((forged as { refusal: string }).refusal, "company_not_in_pool");
});

Deno.test("12-13. a rejected or excluded company is not for sale", () => {
  for (const row of [
    POOL_ROW({ brain_decision: "reject" }),
    POOL_ROW({ recommended_action: "exclude" }),
  ]) {
    const r = authorizeUnlock({
      request: REQ() as never, taskResult: TASK_RESULT([row]),
      founderUnlockCompleted: false,
    });
    assertFalse(r.ok);
    assertEquals((r as { refusal: string }).refusal, "company_not_unlockable");
  }
});

Deno.test("14-15. contact unlock is a separate, later purchase", () => {
  const without = authorizeUnlock({
    request: REQ({ unlock_type: "contact_unlock" }) as never,
    taskResult: TASK_RESULT(), founderUnlockCompleted: false,
  });
  assertFalse(without.ok, "a contact unlock without a founder unlock must be refused");
  assertEquals((without as { refusal: string }).refusal, "founder_unlock_required_first");

  const withFounder = authorizeUnlock({
    request: REQ({ unlock_type: "contact_unlock" }) as never,
    taskResult: TASK_RESULT(), founderUnlockCompleted: true,
  });
  assert(withFounder.ok);
  // ITS OWN PRICE. A contact unlock never bundles the founder unlock's cost.
  assertEquals(withFounder.authorization.price, UNLOCK_CREDIT_COSTS.contact_unlock);
});

Deno.test("16. the price comes from the server catalogue alone", () => {
  const r = authorizeUnlock({
    request: REQ() as never, taskResult: TASK_RESULT(),
    founderUnlockCompleted: false,
  });
  assert(r.ok);
  assertEquals(r.authorization.price, 3);
  assertEquals(unlockPrice("founder_unlock"), 3);
  assertEquals(unlockPrice("contact_unlock"), 2);
  // Insufficient funds is a payment problem, and says so.
  assertEquals(UNLOCK_REFUSAL_STATUS.insufficient_credits, 402);
  assertEquals(UNLOCK_REFUSAL_STATUS.forbidden_workspace, 403);
});

// ════════════════════════════════════════════════ 17-22. what is charged ══

Deno.test("17-19. a provider that verified nobody costs the user nothing", () => {
  // The decision of record: a single-company unlock that found no one is
  // released in full, deliberately NOT the 20% minimum the bulk policy applies.
  const none = computeUnlockCharge({ reserved: 3, providerRan: true, verifiedCount: 0 });
  assertEquals(none.actual, 0);
  assertEquals(none.status, "not_charged");
  assert(none.reason.includes("verified nobody"));

  // Never charge for work that did not happen.
  const never = computeUnlockCharge({ reserved: 3, providerRan: false, verifiedCount: 0 });
  assertEquals(never.actual, 0);
  assertEquals(never.status, "not_charged");

  // A real result bills the reserved amount and never more.
  const hit = computeUnlockCharge({ reserved: 3, providerRan: true, verifiedCount: 2 });
  assertEquals(hit.actual, 3);
  assertEquals(hit.status, "charged");
});

Deno.test("20-22. the mirrored bulk policy still behaves like the frontend's", () => {
  assertEquals(computeActualCharge({
    estimated: 10, requested: 5, accepted: 5, providerRan: true,
  }), { actual: 10, status: "charged" });
  // The branch the unlock rule deliberately declines to use still exists here.
  assertEquals(computeActualCharge({
    estimated: 10, requested: 5, accepted: 0, providerRan: true,
  }), { actual: 2, status: "minimum_charge" });
  assertEquals(computeActualCharge({
    estimated: 10, requested: 5, accepted: 0, providerRan: false,
  }), { actual: 0, status: "not_charged" });
});

// ═══════════════════════════════════════════════ 23-30. the paid run ══

const PERSON = (id: string, company: string, url: string) => ({
  id, firstName: "Ada", lastName: id.toUpperCase(),
  linkedinUrl: `https://www.linkedin.com/in/${id}`,
  currentPositions: [{
    title: "Founder", companyName: company, companyLinkedinUrl: url, current: true,
  }],
});
const CO_URL = "https://www.linkedin.com/company/co1";

const runner = (over: Record<string, unknown> = {}) => ({
  invoke: () => Promise.resolve([PERSON("p1", "Co One", CO_URL)]),
  verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  ...over,
});

Deno.test("23-24. an unresolvable company spends nothing at all", async () => {
  let called = 0;
  const out = await runFounderUnlock(
    runner({ invoke: () => { called++; return Promise.resolve([]); } }) as never,
    { companyLinkedInUrl: "", roles: ["Founder"] });
  assertEquals(called, 0, "no provider may run without a company to search");
  assertFalse(out.providerRan, "providerRan false ⇒ the charge is zero");
  assertEquals(computeUnlockCharge({
    reserved: 3, providerRan: out.providerRan, verifiedCount: out.people.length,
  }).actual, 0);
});

Deno.test("25-26. verified people are returned; unverified ones are dropped", async () => {
  const out = await runFounderUnlock(runner({
    invoke: () => Promise.resolve([
      PERSON("p1", "Co One", CO_URL),
      PERSON("p2", "Somewhere Else", "https://www.linkedin.com/company/other"),
    ]),
    // Only the person actually at this company survives.
    verifyEmployer: (p: { current_employer: string | null }) => ({
      verified: p.current_employer === "Co One", outcome: "checked",
    }),
  }) as never, { companyLinkedInUrl: CO_URL, roles: ["Founder"] });

  assertEquals(out.candidatesReturned, 2);
  assertEquals(out.people.length, 1, "a person at another employer is not delivered");
  assertEquals(out.people[0].current_employer, "Co One");
  assert(out.providerRan);
});

Deno.test("27-28. an empty primary falls back once, within the approved pair", async () => {
  const used: string[] = [];
  const out = await runFounderUnlock(runner({
    invoke: (call: { actorKey: string }) => {
      used.push(call.actorKey);
      return Promise.resolve(used.length === 1 ? [] : [PERSON("p9", "Co One", CO_URL)]);
    },
  }) as never, { companyLinkedInUrl: CO_URL, roles: ["Founder"] });

  assertEquals(used.length, 2, "exactly one fallback");
  for (const a of used) {
    assert((UNLOCK_PROVIDERS as readonly string[]).includes(a),
      `${a} is not an approved unlock provider`);
  }
  assertEquals(out.people.length, 1);
});

Deno.test("29-30. a throwing provider does not throw the run, and bills nothing", async () => {
  const out = await runFounderUnlock(runner({
    invoke: () => Promise.reject(new Error("actor down")),
  }) as never, { companyLinkedInUrl: CO_URL, roles: ["Founder"] });

  assertEquals(out.people.length, 0);
  assertEquals(out.candidatesReturned, 0);
  // It DID run — money was spent on our side — but the user gets it back,
  // because they received nothing.
  assert(out.providerRan);
  assertEquals(computeUnlockCharge({
    reserved: 3, providerRan: out.providerRan, verifiedCount: out.people.length,
  }).actual, 0);
});

// ════════════════════════════════════════ 31-36. replay and regression ══

Deno.test("31-32. a completed unlock is found and returned instead of re-run", () => {
  const stored = {
    ...TASK_RESULT(),
    [UNLOCK_RESULT_KEY]: {
      co1: { founder_unlock: { transaction_id: "t1", people: [] } },
    },
  };
  assertEquals(
    findCompletedUnlock(stored, "co1", "founder_unlock")?.transaction_id, "t1");
  // A different company or kind has NOT been bought.
  assertEquals(findCompletedUnlock(stored, "co1", "contact_unlock"), null);
  assertEquals(findCompletedUnlock(stored, "co2", "founder_unlock"), null);
  assertEquals(findCompletedUnlock(null, "co1", "founder_unlock"), null);
});

Deno.test("33-36. the endpoint reserves before spending and cannot be bypassed", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/unlock-founders/index.ts", import.meta.url));

  // ORDER IS THE SAFETY PROPERTY: authorize, then reserve, then run, then finalize.
  const iAuth = src.indexOf("authorizeUnlock(");
  const iReserve = src.indexOf('rpc("credits_reserve"');
  const iRun = src.indexOf("runFounderUnlock(");
  const iFinal = src.indexOf('rpc("credits_finalize"');
  assert(iAuth > 0 && iReserve > iAuth, "authorization precedes the reservation");
  assert(iRun > iReserve, "no provider runs before a reservation succeeds");
  assert(iFinal > iRun, "the charge is finalized after the work");

  // The replay check happens before any money moves.
  assert(src.indexOf("findCompletedUnlock(") < iReserve,
    "an already-bought unlock must be returned before reserving");

  // A browser cannot present a service key, and the client cannot name a price.
  assert(src.includes("service_role_not_accepted"));
  assertFalse(src.includes("body.price"));
  assertFalse(src.includes("body.credits"));
  assertFalse(src.includes("body.workspace_id"));
  // Ownership is proven, never assumed.
  assert(src.includes("decideWorkspaceAccess"));
  assert(src.includes("workspace_members"));
  // The ledger is the only source of truth — never the client-writable blob.
  assertFalse(src.includes("company_brain"));
  for (const line of src.split("\n")) {
    if (line.includes("ohsdatpvfdjdemstoiuj")) {
      assert(line.trim().startsWith("//"), "production ref only in a comment");
    }
  }
});

Deno.test("37. founder discovery is still absent from ordinary sourcing", async () => {
  const { buildCapabilityGraph } = await import(
    "../../../supabase/functions/_shared/leadCapabilityGraph.ts");
  const { parseLeadMissionDeterministic } = await import(
    "../../../supabase/functions/_shared/leadMission.ts");
  // A query that explicitly asks for founders — the case that used to schedule
  // people stages for every qualified company before anyone agreed to buy one.
  const m = parseLeadMissionDeterministic(
    "Find founders of US B2B SaaS startups hiring Sales Ops. Return 25 leads.");
  const plan = buildCapabilityGraph(m);

  for (const stage of ["founder_discovery", "employer_verification", "contact_enrichment"]) {
    assertFalse(plan.steps.some((s: { capability: string }) => s.capability === stage),
      `${stage} must never be scheduled by sourcing`);
    assert((plan.prohibited as readonly string[]).includes(stage),
      `${stage} must be prohibited`);
  }
  for (const actor of UNLOCK_PROVIDERS) {
    assertFalse(plan.allowed_providers.includes(actor),
      `${actor} must not be reachable from a sourcing plan`);
  }
  // It is OFFERED, which costs nothing and runs nothing.
  assert(plan.offered_capabilities.includes("offer_founder_unlock"));
});
