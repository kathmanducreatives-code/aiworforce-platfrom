// The live paraphrase study's spending guard (owner-authorised ≤ $2, ≤ 180 calls): it is
// enforced at the transport, so neither the study loop nor the provider client's own
// retry can exceed it. Offline: the network is a stub.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { budgetGuard, runStudy } from "../../../scripts/dev/live-paraphrase-study.ts";
import { loadCases } from "../../../scripts/dev/interpretation-corpus.ts";

const ok = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ usage: { prompt_tokens: 3000, completion_tokens: 800 } })) });
const URL_ = "https://api.openai.com/v1/chat/completions";
const init = (chars = 9000) => ({ method: "POST", body: "x".repeat(chars) });

Deno.test("guard: a request whose WORST case would cross the budget is never sent", async () => {
  let sent = 0;
  const g = budgetGuard({ budgetUsd: 0.006, maxCalls: 100, model: "gpt-5.6-luna", send: () => { sent++; return ok(); } });
  // luna worst case: 3000 in × $0.20/M + 4000 out × $1.20/M = $0.0054
  assertEquals((await g.fetch(URL_, init())).status, 200);
  const second = await g.fetch(URL_, init());
  assertEquals(second.status, 400, "refused locally");
  assert((await second.text()).includes("budget_refused"));
  assertEquals(sent, 1);
  assert(g.state().spentUsd <= 0.006);
});

Deno.test("guard: the call cap counts every HTTP request, retries included", async () => {
  let sent = 0;
  const g = budgetGuard({ budgetUsd: 100, maxCalls: 3, model: "gpt-5.6-luna", send: () => { sent++; return ok(); } });
  for (let i = 0; i < 5; i++) await g.fetch(URL_, init());
  assertEquals(sent, 3);
  assertEquals(g.state().refused, 2);
});

Deno.test("guard: only the model provider can be reached — never a lead provider", async () => {
  let sent = 0;
  const g = budgetGuard({ budgetUsd: 100, maxCalls: 100, model: "gpt-5.6-luna", send: () => { sent++; return ok(); } });
  assertEquals((await g.fetch("https://api.apify.com/v2/acts/x/runs", init())).status, 400);
  assertEquals(sent, 0);
});

Deno.test("guard: a response without usage is booked at its worst case, never as free", async () => {
  const g = budgetGuard({ budgetUsd: 100, maxCalls: 100, model: "gpt-5.6-luna",
    send: () => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("oops") }) });
  await g.fetch(URL_, init());
  assertEquals(g.state().ledger[0].basis, "worst_case");
  assert(g.state().spentUsd > 0.005);
});

Deno.test("guard: an unpriced model refuses to run at all (the budget could not be enforced)", () => {
  let threw = false;
  try { budgetGuard({ budgetUsd: 2, maxCalls: 180, model: "mystery-model", send: ok }); } catch { threw = true; }
  assert(threw);
});

Deno.test("study (dry run): stops at the first refusal — no call after the budget says stop", async () => {
  const cases = loadCases().slice(0, 3);
  const r = await runStudy({ repeats: 3, budgetUsd: 0.02, maxCalls: 180, dryRun: true, cases });
  assert(r.spent_usd <= 0.02, `spent ${r.spent_usd}`);
  assertEquals(r.refused, 1, "one refusal, then the loop stops");
  assert(r.calls < 3 * cases.reduce((n, c) => n + c.phrasings.length, 0));
});
