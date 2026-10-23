// A DECISION-MAKER UNLOCK IS CHARGED ONCE PER ROW, AT THE QUOTED PRICE.
//
// Measured before this change, through the real adapter and runTool: every
// people search in one lead action shared one credit key,
// `<task>:person_resolution:no-hash`, so an action over N rows was reserved and
// charged ONCE in total, whatever N and however many stages ran. The Workbench
// quotes the price per row. Keyed per lead (`decisionMakerUnlockHash`), each
// row reserves the quoted price once and its fallback stage replays it.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runTool } from "../../../supabase/functions/_shared/toolRegistry.ts";
import { makePeopleSearchProvider } from "../../../supabase/functions/_shared/decisionMaker/providerAdapter.ts";
import { planPeopleSearch } from "../../../supabase/functions/_shared/decisionMaker/searchPlanner.ts";
import { resolveDecisionMakerCompanyIdentity } from "../../../supabase/functions/_shared/decisionMaker/companyIdentity.ts";
import { decisionMakerUnlockHash } from "../../../supabase/functions/_shared/paidCallInputHash.ts";
import { priceFor } from "../../../supabase/functions/_shared/creditPricing.ts";

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
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** Every search starts and finishes at once, finding nobody, so each row runs both stages. */
const apify = (u: string | URL | Request, init?: RequestInit) => {
  const url = String(u instanceof Request ? u.url : u);
  if ((init?.method ?? "GET") === "POST") return Promise.resolve(json(201, { data: { id: "run-1", defaultDatasetId: "ds-1", status: "SUCCEEDED" } }));
  if (url.includes("/datasets/")) return Promise.resolve(json(200, []));
  return Promise.resolve(json(200, { data: { id: "run-1", defaultDatasetId: "ds-1", status: "SUCCEEDED" } }));
};
const LEADS = [
  { id: "lead-acme", name: "Acme", li: "https://www.linkedin.com/company/acme", domain: "acme.com" },
  { id: "lead-beta", name: "Beta", li: "https://www.linkedin.com/company/beta", domain: "beta.io" },
];

/** One lead action over LEADS, every stage of every row; the credit ledger as the RPCs saw it. */
async function action(perLeadKey: boolean) {
  const txns = new Map<string, { id: string; reserved: number; charged: number | null; reserves: number }>();
  const admin = {
    from: () => noopQuery(),
    rpc: (fn: string, a: Record<string, unknown>) => {
      if (fn === "credits_reserve") {
        const k = String(a.p_idempotency_key);
        const t = txns.get(k);
        if (t) { t.reserves++; return Promise.resolve({ data: { ok: true, replayed: true, transaction_id: t.id }, error: null }); }
        txns.set(k, { id: `txn-${txns.size}`, reserved: Number(a.p_amount), charged: null, reserves: 1 });
        return Promise.resolve({ data: { ok: true, replayed: false, transaction_id: `txn-${txns.size - 1}`, balance_after: 9 }, error: null });
      }
      if (fn === "credits_finalize") {
        const t = [...txns.values()].find((x) => x.id === a.p_transaction_id)!;
        if (t.charged !== null) return Promise.resolve({ data: { ok: true, replayed: true, actual_credits: t.charged }, error: null });
        t.charged = Number(a.p_actual);
        return Promise.resolve({ data: { ok: true, actual_credits: t.charged }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  const ctx = { workspace_id: "00000000-0000-0000-0000-000000000001", task_id: "11111111-1111-4111-8111-111111111111", agent_slug: "hawk", agent_id: null, admin };
  const real = globalThis.fetch;
  globalThis.fetch = apify as typeof fetch;
  try {
    for (const lead of LEADS) {
      const provider = makePeopleSearchProvider(runTool as never, ctx, perLeadKey ? decisionMakerUnlockHash(lead.id) : null);
      const identity = resolveDecisionMakerCompanyIdentity({ company_name: lead.name, company_linkedin_url: lead.li, domain: lead.domain });
      for (const stage of ["company_employee_search", "domain_people_search"] as const) {
        const planned = planPeopleSearch(identity, stage, {});
        if (planned.ok) await provider(planned.plan);
      }
    }
  } finally {
    globalThis.fetch = real;
  }
  return [...txns.entries()].map(([key, t]) => ({ key, ...t }));
}

Deno.test("per-lead key: each row reserves the quoted price once, its fallback replays it, and is charged once", async () => {
  const price = priceFor("find_decision_makers");
  const t = await action(true);
  assertEquals(t.length, LEADS.length, "one credit transaction per row");
  for (const x of t) {
    assertEquals([x.reserved, x.charged], [price, price], x.key);
    assert(x.reserves >= 2, `the fallback stage replayed the row's reservation (${x.reserves})`);
  }
  assertEquals(t.reduce((a, x) => a + (x.charged ?? 0), 0), price * LEADS.length, "the action costs the quoted price per row");
  assertEquals(new Set(t.map((x) => x.key)).size, LEADS.length);
});

Deno.test("BEFORE (no per-lead key): the whole action shares one credit — charged once for every row", async () => {
  const t = await action(false);
  assertEquals(t.length, 1);
  assert(t[0].key.endsWith(":no-hash"), t[0].key);
  assertEquals(t[0].charged, priceFor("find_decision_makers"), "one charge for two rows");
});

Deno.test("the executor passes the row's billing key to the people-search provider", () => {
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/_shared/leadActionExecutor.ts", import.meta.url));
  assert(src.includes("decisionMakerUnlockHash(String(lead.lead_candidate_id))"));
});
