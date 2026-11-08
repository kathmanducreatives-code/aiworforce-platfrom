// LIKELY B2B, COUNTED ONLY WITH PERMISSION (product policy 2026-11-08):
//   Verified B2B   clear first-party statement → qualified, counts.
//   Likely B2B     the company's own pages suggest it, not definitively → counts ONLY when the
//                  user permits likely matches (hash-bound `accept_likely`), labelled likely,
//                  never verified; the engine's verdict stays pending.
//   Not B2B        contradicted by the company's own pages → excluded when B2B is required.
// An explicit "verified" in the request is never weakened: the permission is refused.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleStrategyRequest } from "../../../../supabase/functions/_shared/leadPipeline/service.ts";
import { modelGrounder } from "../../../../supabase/functions/_shared/leadPipeline/businessModelCheck.ts";
import { missionOutcome } from "../../../../supabase/functions/_shared/leadPipeline/outcome.ts";
import type { PipelineRow } from "../../../../supabase/functions/_shared/leadPipeline/projection.ts";
import { deps, fakeModel, MISSION, PAGES, req } from "./mrleFixtures.ts";

/** The fixture's grounder, except Quartz reads as B2B with LOW confidence: a plausible, unverified reading. */
const likelyModel = (calls: string[]) => {
  const base = fakeModel(calls);
  return async (r: { messages: { content: string }[] }) => {
    const out = await base(r) as { ok: true; json: { business_model: Record<string, unknown> } };
    const p = JSON.parse(r.messages[0].content);
    const page = (p.evidence as { evidence_id: string; evidence_type: string; source_text: string | null }[]).find((x) => x.evidence_type === "web_page" && x.source_text);
    if (page?.source_text === PAGES["quartz.example"]) {
      out.json.business_model = { value: "b2b_software", confidence: 0.3, claims: [{ claim: "quartz business model", claim_type: "business_model",
        evidence_ids: [page.evidence_id], evidence_excerpts: [{ evidence_id: page.evidence_id, excerpt: "Welcome. Learn more about us." }] }] };
    }
    return out;
  };
};

type RunLead = { company: { name: string }; statuses: { qualification: string }; businessModel?: { status: string }; acceptedAsLikely?: boolean };
type RunBody = { queue: RunLead[]; review: RunLead[]; outcome: { qualified: number; likely?: number; needsVerification: number; rejected: number; shortfall: number | null; summary: string } };

async function run(o: { acceptLikely: boolean; query?: string }) {
  const x = deps();
  x.d.groundBusinessModel = modelGrounder(likelyModel([]) as never, MISSION);
  const extra = { ...(o.acceptLikely ? { accept_likely: true } : {}), ...(o.query ? { query: o.query } : {}) };
  const planned = await handleStrategyRequest(req({ action: "strategy_plan", ...extra }), x.d);
  const plan = planned.body.plan as { status: string; planHash: string; estimate: { apifyUsd: number } } | undefined;
  if (!plan || plan.status !== "ready") return { planned, plan, ran: null, body: null as RunBody | null, x };
  const ran = await handleStrategyRequest(req({ action: "strategy_run", ...extra, approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd, token: planned.body.approval_token } }), x.d);
  return { planned, plan, ran, body: ran.body as unknown as RunBody, x };
}
const by = (body: RunBody) => Object.fromEntries([...body.queue, ...body.review].map((l) => [l.company.name, { q: l.statuses.qualification, bm: l.businessModel?.status ?? null, likely: l.acceptedAsLikely === true }]));

type Row = { lead_candidate: { status: string; raw: { agentory_pipeline: { accepted_as_likely?: boolean; business_model?: { status: string } | null } } } };
const written = (x: { written: PipelineRow[] }, site: string) => (x.written as unknown as (Row & { account: { domain: string | null } })[]).find((r) => r.account.domain === site);

Deno.test("default (no permission): only VERIFIED B2B counts; likely, mixed and silent stay open; consumer is excluded", async () => {
  const r = await run({ acceptLikely: false });
  const b = r.body!;
  assertEquals(by(b), {
    "Northwind Ledger": { q: "eligible", bm: "verified_b2b", likely: false },
    "Maple Goods": { q: "pending", bm: "mixed", likely: false },
    "Quartz Data": { q: "pending", bm: "likely_b2b", likely: false },
  });
  assertEquals([b.outcome.qualified, b.outcome.needsVerification, b.outcome.rejected, b.outcome.shortfall, "likely" in b.outcome], [1, 2, 1, 4, false]);
  assertEquals(b.outcome.summary, "Only 1 company qualified of 5 requested; 2 still need verification on business model.");
});

Deno.test("with permission: a LIKELY match counts, labelled likely and never verified; the engine's verdict stays pending", async () => {
  const r = await run({ acceptLikely: true });
  const b = r.body!;
  assertEquals(by(b)["Quartz Data"], { q: "pending", bm: "likely_b2b", likely: true });
  assertEquals(by(b)["Maple Goods"], { q: "pending", bm: "mixed", likely: false }, "a contradicted (mixed) reading never counts as likely");
  assertEquals([b.outcome.qualified, b.outcome.likely, b.outcome.needsVerification, b.outcome.shortfall], [1, 1, 1, 3]);
  assertStringIncludes(b.outcome.summary, "2 companies matched (1 verified, 1 likely B2B — not verified) of 5 requested");
  // Saved: the likely lead is NOT a qualified lead; it carries its label and the permission.
  const q = written(r.x, "quartz.example")!;
  assertEquals([q.lead_candidate.status, q.lead_candidate.raw.agentory_pipeline.business_model?.status, q.lead_candidate.raw.agentory_pipeline.accepted_as_likely], ["new", "likely_b2b", true]);
  assertEquals(written(r.x, "northwind.example")!.lead_candidate.status, "qualified");
  assertEquals(written(r.x, "harborkids.example"), undefined, "a consumer business is never saved when B2B is required");
});

Deno.test("the permission is part of the approved plan: it changes the hash, and a run cannot add it after approval", async () => {
  const without = await run({ acceptLikely: false });
  const withIt = await run({ acceptLikely: true });
  assert(without.plan!.planHash !== withIt.plan!.planHash);
  // Approve WITHOUT the permission, then try to run WITH it.
  const x = deps();
  x.d.groundBusinessModel = modelGrounder(likelyModel([]) as never, MISSION);
  const planned = await handleStrategyRequest(req({ action: "strategy_plan" }), x.d);
  const plan = planned.body.plan as { planHash: string; estimate: { apifyUsd: number } };
  const ran = await handleStrategyRequest(req({ action: "strategy_run", accept_likely: true, approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd, token: planned.body.approval_token } }), x.d);
  assertEquals(ran.status, 409);
  assertEquals(x.ap.calls.length, 0, "nothing was bought");
});

Deno.test("an explicit VERIFIED requirement is never weakened: counting likely matches is refused; without it the request plans", async () => {
  const q = "Find 5 verified B2B companies headquartered in the United States that must operate as B2B businesses, actively hiring Account Executives.";
  const refused = await run({ acceptLikely: true, query: q });
  assertEquals([refused.planned.status, refused.planned.body.status], [422, "not_approvable"]);
  assertStringIncludes(String(refused.planned.body.error), "verified");
  assertEquals(refused.x.ap.calls.length, 0);
  const plain = await run({ acceptLikely: false, query: q });
  assert(plain.planned.status !== 422 || !String(plain.planned.body.error).includes("likely matches"), "the refusal is only for counting likely matches");
});

Deno.test("outcome: without likely matches every outcome is exactly as before; likely matches are reported separately", () => {
  const cases = [
    { requested: 5, qualified: 5, pending: 0, rejected: 0, runStatus: "completed" as const },
    { requested: 5, qualified: 2, pending: 3, rejected: 1, runStatus: "completed" as const, openRequirements: ["business model"] },
    { requested: 5, qualified: 0, pending: 2, rejected: 0, runStatus: "completed" as const },
    { requested: 5, qualified: 0, pending: 0, rejected: 2, runStatus: "completed" as const },
    { requested: 5, qualified: 1, pending: 0, rejected: 0, runStatus: "cancelled" as const },
  ];
  for (const c of cases) assertEquals(missionOutcome({ ...c, likely: 0 }), missionOutcome(c));
  const o = missionOutcome({ requested: 5, qualified: 2, pending: 0, rejected: 0, likely: 3, runStatus: "completed" });
  assertEquals([o.status, o.qualified, o.likely, o.shortfall], ["completed", 2, 3, null]);
  assertEquals(o.summary, "5 companies matched (2 verified, 3 likely B2B — not verified) of 5 requested.");
  const n = missionOutcome({ requested: 5, qualified: 0, pending: 1, rejected: 0, likely: 2, runStatus: "completed" });
  assertEquals([n.status, n.shortfall], ["completed_with_shortfall", 3]);
});
