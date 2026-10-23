// The read-only decision-maker billing impact query against real Postgres,
// with ledger rows written by the production writer: two actions (one row; two
// rows with a fallback stage) measure 2 charged today, 4 with the quote fix,
// 6 per row.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildStartedRow, createLedgerWriter, type LedgerDb } from "../../supabase/functions/_shared/executionLedger.ts";
import { seedWorkspace, serviceClient, sql, uuid } from "./lib/harness.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };
const impact = Deno.readTextFileSync(new URL("../../scripts/test-project/decision-maker-billing-impact.sql", import.meta.url));

async function action(ws: string, rows: Array<{ li: string; stages: number }>) {
  const task = uuid();
  const key = `${task}:person_resolution:no-hash`;
  const [r] = await sql`select public.credits_reserve(${ws}::uuid, 1, ${key}, 'provider_call', ${task}::uuid, null) as r`;
  await sql`select public.credits_finalize(${(r.r as { transaction_id: string }).transaction_id}::uuid, 1, 'charged', 'test')`;
  const w = createLedgerWriter((await serviceClient()) as unknown as LedgerDb);
  for (const row of rows) for (let s = 0; s < row.stages; s++) {
    const started = buildStartedRow({ workspace_id: ws, task_id: task, stage: "person_resolution", reason: "find_decision_makers",
      provider_id: "apify", actor_id: "harvestapi/linkedin-company-employees", logical_call_key: key,
      request_input: { company_linkedin_url: row.li, source_type: "people_profiles" } } as never);
    await w.insert(started);
    await w.finalize(started.id!, { status: "succeeded", provider_run_id: `run-${uuid().slice(0, 8)}` });
  }
}

Deno.test("decision-maker impact: today, with the quote fix, and per row", opts, async () => {
  const run = async () => ([...await sql.unsafe(impact.replace(":days", "90").replace(":price", "2"))] as Array<Record<string, unknown>>)[0];
  const before = await run();
  const ws = await seedWorkspace();
  await sql`insert into public.workspace_credit_balances (workspace_id, balance_credits) values (${ws}, 10)`;
  await action(ws, [{ li: "https://www.linkedin.com/company/acme", stages: 1 }]);
  await action(ws, [{ li: "https://www.linkedin.com/company/beta", stages: 2 }, { li: "https://www.linkedin.com/company/gamma", stages: 1 }]);
  const after = await run();
  const d = (k: string) => Number(after[k]) - Number(before[k]);
  assertEquals([d("actions"), d("started_rows"), d("multi_row_actions")], [2, 3, 1]);
  assertEquals([d("charged_today"), d("with_quote_fix"), d("with_per_row")], [2, 4, 6]);
});
