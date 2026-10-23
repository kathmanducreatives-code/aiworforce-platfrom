// A QUOTED UNLOCK IS SETTLED AT THE PRICE IT WAS QUOTED AND RESERVED.
//
// creditPricing.ts: "the moment a number appears on a button it has to be THE
// number the reserve uses". runTool reserved the quoted price
// (`find_decision_makers`: 2 credits) but settled a started call without an
// amount, so `settleProviderCall` charged its default of 1 and refunded the
// rest: every started decision-maker unlock was charged half of what the
// button showed. Unquoted provider calls keep their flat 1 credit.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runTool } from "../../../supabase/functions/_shared/toolRegistry.ts";
import { priceFor } from "../../../supabase/functions/_shared/creditPricing.ts";
import { CREDITS_PER_PROVIDER_CALL } from "../../../supabase/functions/_shared/creditAuthorization.ts";
import { hashInput } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

Deno.env.set("LEAD_CREDIT_ENFORCEMENT", "enforce");
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
const YC_INPUT = {
  mode: "companies", queries: [], topCompany: false, isHiring: true, nonprofit: false, batch: ["All Batches"],
  industries: ["B2B"], regions: ["United States of America"], minEmployeeSize: "10+", maxEmployeeSize: "500",
  scrapeFounderDetails: false, scrapeOpenJobs: true, enrichEmails: false, maxItems: 50,
};
const ENVELOPE = {
  selected_actor_key: "apify_yc_companies_memo23", actor_id: "memo23/y-combinator-scraper", compiled_actor_input: true,
  capability_key: "apify_yc_companies_memo23", input: YC_INPUT,
  compiled_input_hash: hashInput(YC_INPUT, "apify_yc_companies_memo23"),
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** Apify starts and finishes the run at once, with an empty dataset. */
const finished = (u: string | URL | Request, init?: RequestInit) => {
  const url = String(u instanceof Request ? u.url : u);
  if ((init?.method ?? "GET") === "POST") return Promise.resolve(json(201, { data: { id: "run-1", defaultDatasetId: "ds-1", status: "SUCCEEDED" } }));
  if (url.includes("/datasets/")) return Promise.resolve(json(200, []));
  return Promise.resolve(json(200, { data: { id: "run-1", defaultDatasetId: "ds-1", status: "SUCCEEDED" } }));
};
const refused = () => Promise.resolve(json(409, { error: { message: "refused" } }));

async function creditCalls(envelope: Record<string, unknown>, answer: typeof finished) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const admin = {
    from: () => noopQuery(),
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "credits_reserve") return Promise.resolve({ data: { ok: true, replayed: false, transaction_id: "txn-1", balance_after: 4 }, error: null });
      if (fn === "credits_finalize") return Promise.resolve({ data: { ok: true, actual_credits: args.p_actual }, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
  const real = globalThis.fetch;
  globalThis.fetch = answer as typeof globalThis.fetch;
  try {
    await runTool("source_with_apify", envelope, { workspace_id: "00000000-0000-0000-0000-000000000001", agent_slug: "scout", agent_id: null, admin } as never);
  } finally {
    globalThis.fetch = real;
  }
  const reserve = calls.find((c) => c.fn === "credits_reserve")!;
  const finalize = calls.find((c) => c.fn === "credits_finalize");
  return { reserved: reserve.args.p_amount, charged: finalize?.args.p_actual, status: finalize?.args.p_status };
}

Deno.test("a started decision-maker unlock is charged its quoted price, exactly what it reserved", async () => {
  const quoted = priceFor("find_decision_makers");
  assertEquals(quoted, 2, "the Workbench quote this test pins");
  const r = await creditCalls({ ...ENVELOPE, unlock_capability: "find_decision_makers" }, finished);
  assertEquals([r.reserved, r.charged, r.status], [quoted, quoted, "charged"]);
});

Deno.test("an unquoted provider call keeps its flat per-call credit", async () => {
  const r = await creditCalls(ENVELOPE, finished);
  assertEquals([r.reserved, r.charged, r.status], [CREDITS_PER_PROVIDER_CALL, CREDITS_PER_PROVIDER_CALL, "charged"]);
});

Deno.test("a refused quoted unlock is still refunded whole", async () => {
  const r = await creditCalls({ ...ENVELOPE, unlock_capability: "find_decision_makers" }, refused);
  assertEquals([r.reserved, r.charged, r.status], [2, 0, "not_charged"]);
});
