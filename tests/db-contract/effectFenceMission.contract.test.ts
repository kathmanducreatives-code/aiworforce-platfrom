// THE EFFECT FENCE ON A WHOLE LEAD MISSION (EXEC-EFFECT): the real run-agent
// handler behind the real lead-mission runner, the durable smoke admission and
// the fence over it (as the worker installs them), scripted OpenAI and Apify.
//
// The requester's membership is removed, and committed, the moment the paid
// job search is bought. What was bought still settles — its status and dataset
// are read and its credit is charged once — but nothing NEW starts: no model
// call, no second purchase. The control runs the identical mission with the
// fence installed and no removal, and qualifies the lead as before.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DETAILS, JOBS, runScenario } from "./lib/discoveryScenario.ts";
import { sql } from "./lib/harness.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };
type Req = { method: string; host: string; path: string };

Deno.test("fence mission: removed once the job search is bought — it settles, nothing new starts", opts, async () => {
  const r = await runScenario({ label: "fence-remove-after-jobs", effectFence: true, removeMemberAt: "jobs_post" });
  const cut = r.trace.member_removed_after as number;
  assert(typeof cut === "number", "the removal happened at the job-search purchase");
  const after = (r.trace.requests as Req[]).slice(cut);
  assertEquals(after.filter((q) => q.host === "api.openai.com").length, 0, "no model call after the removal");
  assertEquals(after.filter((q) => q.method !== "GET"), [], "no purchase after the removal");
  assert(after.some((q) => q.path.endsWith("/actor-runs/run-jobs")), "the bought run's status is still read (settlement)");
  assertEquals(r.outcome.details_requested, [], "the second actor is never bought");
  assertEquals(r.outcome.provider.map((p: unknown[]) => p[0]), [JOBS], "only the pre-removal purchase was admitted");
  // The bought search is charged once. The refused second start is reported
  // "purchase may exist" (the fence cannot rule out an earlier attempt), so its
  // credit is HELD, never refunded early (R1) — and the reaper releases it,
  // since no purchase was ever recorded for it.
  assertEquals(r.outcome.credits, { apify_linkedin_job_search: "charged", apify_linkedin_company_details: "reserved" });
  assert(r.outcome.terminal.length > 0, `the task ended terminal: ${JSON.stringify(r.outcome.terminal)}`);
  await sql`update public.credit_transactions set created_at = now() - interval '2 hours' where workspace_id = ${r.m.ws}`;
  await sql`select public.credits_release_stale(interval '30 minutes')`;
  const [bal] = await sql`select balance_credits, reserved_credits from public.workspace_credit_balances where workspace_id = ${r.m.ws}`;
  assertEquals([bal.balance_credits, bal.reserved_credits], [9, 0], "after the reaper: one credit spent, nothing held");
});

Deno.test("fence mission control: the same mission with the fence and no removal qualifies the lead", opts, async () => {
  const r = await runScenario({ label: "fence-control", effectFence: true });
  assertEquals(r.outcome.provider.map((p: unknown[]) => p[0]), [JOBS, DETAILS]);
  assertEquals(r.outcome.qualified.length, 1, JSON.stringify(r.outcome));
});
