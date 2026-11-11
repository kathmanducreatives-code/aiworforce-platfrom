// TERRA BENCHMARK · the spending cap cannot be exceeded. Pure; no network.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  anthropicBody, approvalString, BENCH_CANDIDATES, hardCallBound, hardRunBound, liveApproval, manifest, openaiBody, outputCap,
  stageTasks, STAGE_CAPS_USD, summarize,
} from "../../../../scripts/model-bench/run.ts";
import { scoreOutput } from "../../../../scripts/model-bench/scorers.ts";
import { estimateTokens } from "../../../../scripts/model-bench/scorers.ts";
import { MODEL_PRICES } from "../../../../supabase/functions/_shared/modelCostModel.ts";
import { LIST_PRICES } from "../../../../scripts/model-bench/prices.ts";

const reader = (env: Record<string, string>) => (k: string) => env[k];

Deno.test("bench caps: stage 1 hard maximum ≤ $2, stage 2 ≤ $5, with zero retries", async () => {
  assert(hardRunBound(1) <= STAGE_CAPS_USD[1], String(hardRunBound(1)));
  assert(hardRunBound(2) <= STAGE_CAPS_USD[2], String(hardRunBound(2)));
  for (const s of [1, 2] as const) {
    const m = await manifest(s);
    assertEquals(m.fits_cap, true);
    assertEquals(m.retries, 0);
    assertEquals(m.calls, stageTasks(s).length * BENCH_CANDIDATES.length * 3);
  }
});

Deno.test("bench caps: the per-call bound dominates any real call (1 token ≥ 1 char; output at the hard cap)", () => {
  for (const c of BENCH_CANDIDATES) for (const t of stageTasks(1)) {
    const bound = hardCallBound(c, t);
    const p = MODEL_PRICES[c.model];
    const realisticWorst = (estimateTokens(t.system + t.user) * p.input_per_1m + outputCap(c, t) * p.output_per_1m) / 1e6;
    assert(bound >= realisticWorst, `${c.id}/${t.id}`);
  }
});

Deno.test("bench caps: the requests carry the hard output caps the bound assumes", () => {
  const t = stageTasks(1)[0];
  for (const c of BENCH_CANDIDATES) {
    const b = c.vendor === "openai" ? openaiBody(c, t) : anthropicBody(c, t);
    assertEquals(c.vendor === "openai" ? b.max_completion_tokens : b.max_tokens, outputCap(c, t));
  }
});

Deno.test("bench caps: live mode refuses without the exact stage approval, above the stage cap, or if the bound exceeds budget", () => {
  assertEquals(liveApproval(2, reader({}), 1).ok, false);
  assertEquals(liveApproval(2, reader({ AGENTORY_MODEL_BENCH_APPROVED: approvalString(2, 1) }), 1).ok, true);
  assertEquals(liveApproval(2, reader({ AGENTORY_MODEL_BENCH_APPROVED: approvalString(2, 1) }), 2).ok, false, "stage 1 approval does not run stage 2");
  assertEquals(liveApproval(10, reader({ AGENTORY_MODEL_BENCH_APPROVED: approvalString(10, 2) }), 2).ok, false, "above the $5 stage cap");
  const tight = liveApproval(1, reader({ AGENTORY_MODEL_BENCH_APPROVED: approvalString(1, 1) }), 1);
  assertEquals(tight.ok, false);
  assertStringIncludes((tight as { reason: string }).reason, "hard maximum");
});

Deno.test("bench: candidates are priced by the runtime table, and the audit price file agrees with it", () => {
  for (const c of BENCH_CANDIDATES) {
    const rt = MODEL_PRICES[c.model], au = LIST_PRICES[c.model];
    assert(rt, c.model);
    assertEquals([rt.input_per_1m, rt.cached_input_per_1m, rt.output_per_1m], [au.input, au.cached_input, au.output], c.model);
  }
});

Deno.test("bench: all eight audit categories are covered; stage 2 uses production-size prompts", () => {
  const cats = new Set(stageTasks(1).map((t) => t.category));
  for (const c of ["executive", "executive_brief", "planning", "lead_research", "market_signal", "content", "structured_output", "factual_reliability"]) {
    assert(cats.has(c as never), c);
  }
  const s1 = stageTasks(1), s2 = stageTasks(2);
  assert(s2.every((t, i) => t.system.length > s1[i].system.length + 3000), "real Agentory system prompts prepended");
});

Deno.test("bench: success scoring and cost per successful task", () => {
  const t = stageTasks(1).find((x) => x.id === "lyra-message-1")!;
  assertEquals(scoreOutput(t, "Congrats on the second plant in Dayton. Happy to share how other Ohio shops staffed theirs.").success, true);
  assertEquals(scoreOutput(t, "word ".repeat(95) + "Dayton").within_word_limit, false);
  const s = summarize([
    { candidate: "a", category: "x", success: true, latency_ms: 100, input_tokens: 10, output_tokens: 5, reasoning_tokens: null, cost_usd: 0.01, http: 200 },
    { candidate: "a", category: "x", success: false, latency_ms: 300, input_tokens: 10, output_tokens: 5, reasoning_tokens: null, cost_usd: 0.01, http: 500 },
  ]);
  assertEquals(s.a.success_rate, 0.5);
  assertEquals(s.a.cost_per_success_usd, 0.02);
  assertEquals(s.a.http_errors, 1);
});
