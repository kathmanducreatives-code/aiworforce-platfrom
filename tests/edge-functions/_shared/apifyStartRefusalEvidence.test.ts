// WHY AN APIFY START WAS REFUSED — kept as evidence, safely.
//
// The first live canary (GitHub run 41038537870) had its only Apify start
// refused with HTTP 403. The ledger kept `{ status: 403 }` and nothing else, so
// neither the cause nor the fact that no run exists could be shown afterwards.
// Now a definite refusal of a START (Apify 400–403 on the POST) records
// `start_refused: true` and Apify's sanitised `error.type` — never its message,
// which can echo inputs or account details. An ambiguous answer (dropped
// connection, 5xx, a 2xx without a run, any resume GET) records neither, so it
// can never become evidence that no run exists.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { apifyErrorType, outcomeFromToolResultForTest, runTool } from "../../../supabase/functions/_shared/toolRegistry.ts";
import { hashInput } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

// As tests/edge-functions/_shared/ledgerRecoveryGaps.test.ts: credits observed, a fake token — no network.
Deno.env.set("LEAD_CREDIT_ENFORCEMENT", "observe");
Deno.env.set("MODEL_SPEND_ENFORCEMENT", "observe");
Deno.env.set("APIFY_API_TOKEN", "test-token-not-a-real-credential");

function noopQuery(): unknown {
  const q: Record<string, unknown> = {};
  const ret = () => q;
  for (const m of ["select", "insert", "update", "upsert", "delete", "eq", "in", "is", "not", "order", "limit", "match",
    "filter", "single", "maybeSingle", "range"]) q[m] = ret;
  (q as { then: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res);
  return q;
}
const INPUT = {
  mode: "companies", queries: [], topCompany: false, isHiring: true, nonprofit: false, batch: ["All Batches"],
  industries: ["B2B"], regions: ["United States of America"], minEmployeeSize: "10+", maxEmployeeSize: "500",
  scrapeFounderDetails: false, scrapeOpenJobs: true, enrichEmails: false, maxItems: 50,
};
const ENVELOPE = {
  selected_actor_key: "apify_yc_companies_memo23", actor_id: "memo23/y-combinator-scraper", compiled_actor_input: true,
  capability_key: "apify_yc_companies_memo23", input: INPUT, compiled_input_hash: hashInput(INPUT, "apify_yc_companies_memo23"),
};
const CTX = { workspace_id: "00000000-0000-0000-0000-000000000001", agent_slug: "scout", agent_id: null, admin: { from: () => noopQuery() } };
const SECRET_MESSAGE = "You do not have permission. Account P***a token apify_api_SECRET123 input {...}";

async function start(answer: () => Promise<Response>, envelope: Record<string, unknown> = ENVELOPE) {
  const real = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = ((_i: string | URL | Request, init?: RequestInit) => { if (init?.method === "POST") posts++; return answer(); }) as typeof globalThis.fetch;
  try { return { r: await runTool("source_with_apify", envelope, CTX as never), posts }; } finally { globalThis.fetch = real; }
}
const json = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
type D = Record<string, unknown>;

Deno.test("a refused START keeps Apify's error type and marks no run — never its message", async () => {
  for (const [status, type, code] of [[403, "insufficient-permissions", "apify_unauthorized"], [401, "token-not-valid", "apify_unauthorized"],
    [402, "not-enough-usage-to-run-paid-actor", "apify_insufficient_credits"], [400, "invalid-input", "apify_input_schema_error"]] as const) {
    const { r, posts } = await start(json(status, { error: { type, message: SECRET_MESSAGE } }));
    assertFalse(r.ok);
    assertEquals(r.error, code);
    assertEquals(posts, 1, "one start, never retried");
    const d = r.data as D;
    assertEquals([d.status, d.vendor_error_type, d.start_refused], [status, type, true]);
    const ledger = outcomeFromToolResultForTest(r, ENVELOPE);
    assertEquals(ledger.metadata, { resumable: null, status, start_refused: true, vendor_error_type: type });
    assert(!JSON.stringify(ledger).includes("SECRET123") && !JSON.stringify(ledger).includes("You do not have"), "Apify's message never reaches the ledger row");
  }
});

Deno.test("an unusual or hostile error type is dropped, not stored", () => {
  for (const t of ["", "a".repeat(65), "x'; drop table t;--", "has space", "<script>", 42, null, { nested: 1 }]) {
    assertEquals(apifyErrorType({ error: { type: t } }), null, JSON.stringify(t));
  }
  assertEquals(apifyErrorType({ error: { type: "Actor-Is-Not-Rented" } }), "actor-is-not-rented");
  assertEquals(apifyErrorType(null), null);
  assertEquals(apifyErrorType({ error: "plain string" }), null);
});

Deno.test("a refusal without an error type is still a refused start (the type is null)", async () => {
  const { r } = await start(json(403, {}));
  assertEquals(outcomeFromToolResultForTest(r, ENVELOPE).metadata, { resumable: null, status: 403, start_refused: true, vendor_error_type: null });
});

Deno.test("AMBIGUOUS answers are never evidence of no run: dropped, 5xx, a 2xx without a run, other 4xx", async () => {
  const cases: Array<() => Promise<Response>> = [
    () => Promise.reject(new TypeError("connection reset")), json(500, { error: { type: "internal-error" } }),
    json(503, {}), json(201, { data: { status: "READY" } }), json(404, { error: { type: "record-not-found" } }),
    json(429, { error: { type: "rate-limit-exceeded" } }),
  ];
  for (const answer of cases) {
    const { r } = await start(answer);
    const m = outcomeFromToolResultForTest(r, ENVELOPE).metadata as D;
    assertEquals(m.start_refused, undefined, JSON.stringify(m));
    assertEquals(m.vendor_error_type, undefined);
  }
});

Deno.test("a refused RESUME (a GET on an existing run) is never a refused start", async () => {
  const { r, posts } = await start(json(403, { error: { type: "insufficient-permissions" } }), { ...ENVELOPE, resume_run_id: "RUN-EXISTS" });
  assertEquals(posts, 0);
  const d = r.data as D;
  assertEquals([d.start_refused, d.run_id], [false, "RUN-EXISTS"], "the run it was reading is kept");
  assertEquals((outcomeFromToolResultForTest(r, ENVELOPE).metadata as D).start_refused, undefined);
});

Deno.test("a successful start's ledger metadata is unchanged: no refusal evidence on it", () => {
  const ok = { ok: true, data: { run_id: "RUN1", dataset_id: "DS1", items: [], status: "SUCCEEDED", resumable: false, start_refused: true } };
  const m = outcomeFromToolResultForTest(ok as never, ENVELOPE).metadata as D;
  assertEquals(m.start_refused, undefined, "only a FAILED start can carry it");
  assertEquals(m.vendor_error_type, undefined);
});
