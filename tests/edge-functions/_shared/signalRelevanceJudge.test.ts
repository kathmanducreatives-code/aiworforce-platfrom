// PHASE 7 — LUNA, VALIDATE, THEN TERRA. AND ONLY THEN.
//
// The escalation rule is the expensive one to get wrong: escalating on a
// provider outage pays a costlier model to hit the same wall, and never
// escalating wastes a repairable answer. These pin which is which.
//
// The model is a stub. No network, no key, no database.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  judgeCluster, buildRelevancePrompt, isRepairable,
  type JudgeDeps, type RelevanceContext,
} from "../../../supabase/functions/_shared/signalRelevanceJudge.ts";
import { deterministicVerdict } from "../../../supabase/functions/_shared/signalRelevance.ts";
import {
  clusterSignalEvents, type ClusterableEvent,
} from "../../../supabase/functions/_shared/signalCluster.ts";
import { routeModel, escalationRoute, SOL } from "../../../supabase/functions/_shared/gptModelRouter.ts";

const NOW = Date.parse("2026-08-25T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const ev = (id: string, over: Partial<ClusterableEvent> = {}): ClusterableEvent => ({
  id, workspace_id: "w", signal_type: "sales_hiring", signal_category: "gtm",
  origin: "scheduled_monitor", subject_type: "competitor", subject_key: "vercel",
  account_id: null, occurred_at: daysAgo(10), occurred_at_basis: "source_reported",
  observed_at: daysAgo(1), verification_status: "unverified",
  lifecycle_status: "active", ...over,
});

const cluster = () =>
  clusterSignalEvents([
    ev("e-hiring"),
    ev("e-expansion", { signal_type: "market_expansion", signal_category: "growth" }),
  ], { now: NOW }).clusters[0];

const CTX: RelevanceContext = {
  offer: "AI GTM workforce",
  problem_solved: "founders cannot prospect while building",
  icp_industries: ["B2B SaaS"],
  buyer_roles: ["Founder"],
};

/** A stub provider that answers with whatever JSON it is told, in order. */
function stub(answers: unknown[], record: string[] = []): JudgeDeps {
  let i = 0;
  return {
    readEnv: (k) => (k === "OPENAI_API_KEY" ? "test-key" : undefined),
    fetch: (_u, init) => {
      const body = JSON.parse(String((init as { body?: string }).body ?? "{}"));
      record.push(String(body.model ?? "?"));
      const a = answers[Math.min(i++, answers.length - 1)];
      if (a instanceof Error) {
        return Promise.resolve({
          ok: false, status: 429, text: () => Promise.resolve(a.message),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(JSON.stringify({
            choices: [{ message: { content: JSON.stringify(a) } }],
            usage: { prompt_tokens: 400, completion_tokens: 60 },
            model: body.model,
          })),
      });
    },
    sleep: () => Promise.resolve(),
  };
}

const GOOD = {
  relevance: "high",
  why_now: "Vercel is expanding and hiring at once.",
  why_it_matters: "That overlaps your ICP and the growth problem you solve.",
  evidence_event_ids: ["e-hiring", "e-expansion"],
  timely: true,
};

// ── 1–2. THE ROUTE ──────────────────────────────────────────────────────────

Deno.test("1. Luna leads and Terra repairs — Sol is never routed here", () => {
  const primary = routeModel("signal_relevance");
  assertEquals(primary.model, "gpt-5.6-luna");
  assertEquals(primary.slot, "primary");

  const repair = escalationRoute("signal_relevance", "a miscited id");
  assert(repair, "the stage must be able to escalate once");
  assertEquals(repair!.model, "gpt-5.6-terra");
  assertEquals(repair!.slot, "escalation");

  // NO SOL IN NORMAL PRODUCTION. Neither slot may reach it.
  assertFalse([primary.model, repair!.model].includes(SOL));
  const REPAIR_STAGE = routeModel("signal_relevance_repair");
  assertEquals(REPAIR_STAGE.model, "gpt-5.6-terra");
  assertFalse(REPAIR_STAGE.model === SOL);
});

Deno.test("2. one Luna call is enough when the answer is grounded", async () => {
  const models: string[] = [];
  const v = await judgeCluster(cluster(), CTX, stub([GOOD], models), NOW);
  assertEquals(v.source, "model");
  assertEquals(v.relevance, "high");
  assertEquals(models, ["gpt-5.6-luna"], "a good answer must not be re-bought");
});

// ── 3–5. WHEN TERRA IS AND IS NOT WORTH BUYING ──────────────────────────────

Deno.test("3. a REPAIRABLE answer escalates once, and the repair is believed", async () => {
  const models: string[] = [];
  const v = await judgeCluster(
    cluster(), CTX,
    // Luna cites an id from nowhere; Terra gets it right.
    stub([{ ...GOOD, evidence_event_ids: ["made-up"] }, GOOD], models),
    NOW,
  );
  assertEquals(models, ["gpt-5.6-luna", "gpt-5.6-terra"]);
  assertEquals(v.source, "model");
  assertEquals(v.evidence_event_ids.sort(), ["e-expansion", "e-hiring"]);
});

Deno.test("4. a PROVIDER FAILURE does not escalate — it falls back", async () => {
  // Paying a costlier model to meet the same outage is spend with no possible
  // return. The deterministic cluster stands.
  const models: string[] = [];
  const c = cluster();
  const v = await judgeCluster(c, CTX, stub([new Error("rate limited")], models), NOW);
  // TERRA IS NEVER BOUGHT. The provider layer retries a 429 on the SAME model —
  // its own policy, and not an escalation — so the check is that the expensive
  // model never appears, not that exactly one call was made.
  assertFalse(models.includes("gpt-5.6-terra"), `escalated on an outage: ${models.join(", ")}`);
  assert(models.length > 0 && models.every((m) => m === "gpt-5.6-luna"));
  assertEquals(v.source, "deterministic");
  assertEquals(v.adjusted_priority, c.priority);
  assert(/unavailable/.test(v.adjustments[0]), v.adjustments[0]);
});

Deno.test("5. a repair that is also unusable leaves the floor standing", async () => {
  const models: string[] = [];
  const c = cluster();
  const v = await judgeCluster(
    c, CTX,
    stub([{ ...GOOD, evidence_event_ids: ["nope"] }, { relevance: "wat" }], models),
    NOW,
  );
  assertEquals(models.length, 2, "exactly one repair — there is no third try");
  assertEquals(v.source, "deterministic");
  assertEquals(v.adjusted_priority, c.priority);
});

Deno.test("6. only shape and grounding faults are repairable", () => {
  const c = cluster();
  assert(isRepairable(deterministicVerdict(c, '"urgent" is not a relevance band')));
  assert(isRepairable(deterministicVerdict(c, "the verdict cited no evidence, and an uncited verdict is not believed")));
  // An outage is not something a re-read fixes.
  assertFalse(isRepairable(deterministicVerdict(c, "the model was unavailable (rate_limited)")));
  assertFalse(isRepairable(deterministicVerdict(c, "the model returned no usable answer")));
});

// ── 7. NOTHING TO CITE, NOTHING TO BUY ──────────────────────────────────────

Deno.test("7. a cluster whose events have no ids is never sent", async () => {
  const models: string[] = [];
  const { clusters } = clusterSignalEvents(
    [{ ...ev("x"), id: undefined } as ClusterableEvent], { now: NOW });
  const v = await judgeCluster(clusters[0], CTX, stub([GOOD], models), NOW);
  assertEquals(models, [], "paying to be refused is spend with a known outcome");
  assertEquals(v.source, "deterministic");
});

// ── 8. WHAT THE MODEL IS SHOWN ──────────────────────────────────────────────

Deno.test("8. the prompt names both times, and carries only this cluster", () => {
  const { system, user } = buildRelevancePrompt(cluster(), CTX, NOW);
  const payload = JSON.parse(user);

  // THE TWO TIMES, NAMED SEPARATELY. Collapsing them is how a year-old story
  // becomes "this week".
  const e = payload.situation.events[0];
  assert("happened_days_ago" in e && "observed_days_ago" in e);
  assertEquals(e.date_is_reported_by_source, true);

  // The workspace's own context, and nothing from anywhere else.
  assertEquals(payload.workspace.offer, "AI GTM workforce");
  assertEquals(payload.situation.subject, "vercel");
  assertEquals(payload.situation.events.length, 2);

  // The system prompt states the rules the validator enforces, so the model is
  // asked for what it will actually be held to.
  assert(/Cite only event ids/.test(system));
  assert(/SOURCE date/.test(system));
  assert(/NOT deciding whether/.test(system));
});

// ── 9. THE LEDGER ───────────────────────────────────────────────────────────

Deno.test("9. cost, latency and outcome reach the ledger hook", async () => {
  const rows: Record<string, unknown>[] = [];
  const deps = { ...stub([GOOD]), onJudgeCall: (r: Record<string, unknown>) => { rows.push(r); } };
  await judgeCluster(cluster(), CTX, deps as JudgeDeps, NOW);

  assertEquals(rows.length, 1);
  assertEquals(rows[0].stage, "signal_relevance");
  assertEquals(rows[0].model, "gpt-5.6-luna");
  assertEquals(rows[0].outcome, "believed");
  assertEquals(rows[0].input_tokens, 400);
  assertEquals(rows[0].output_tokens, 60);
  assert(typeof rows[0].latency_ms === "number");
});

Deno.test("10. a failure and a refusal are recorded, not only a success", async () => {
  // A ledger that only records what worked cannot answer "what did we pay for
  // and get nothing from".
  const failed: Record<string, unknown>[] = [];
  await judgeCluster(cluster(), CTX, {
    ...stub([new Error("boom")]),
    onJudgeCall: (r: Record<string, unknown>) => { failed.push(r); },
  } as JudgeDeps, NOW);
  assertEquals(failed.length, 1);
  assertEquals(failed[0].outcome, "failed");
  assertEquals(failed[0].estimated_cost_usd, null);

  const refused: Record<string, unknown>[] = [];
  await judgeCluster(cluster(), CTX, {
    ...stub([{ ...GOOD, evidence_event_ids: ["nope"] }, { relevance: "wat" }]),
    onJudgeCall: (r: Record<string, unknown>) => { refused.push(r); },
  } as JudgeDeps, NOW);
  assertEquals(refused.length, 2, "the repair is recorded too");
  assertEquals(refused[0].outcome, "refused");
});
