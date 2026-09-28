// INSTRUMENTED COPY OF tests/edge-functions/_eval/runFacetBenchmark.ts.
// Same frozen modules, same arms in the same order, same repeats, same gating.
// The ONLY additions: each judge / grounder call is wrapped to RECORD its raw
// outcome (answers, confidences, quotes), and the full report is printed.
// Nothing is changed on the way through.

const R = "/Users/prasidha/agentory-main-local";
const { ALL_FIXTURES, registryFor } = await import(`${R}/tests/edge-functions/_eval/facetFixtures.ts`);
const { judgeArm, liveGrounderArm, runBenchmark, successGate } = await import(`${R}/tests/edge-functions/_eval/facetBenchmark.ts`);
const { jevJudge, DEFAULT_JEV_MODEL } = await import(`${R}/supabase/functions/_shared/jevProvider.ts`);
const { gptFacetJudge } = await import(`${R}/supabase/functions/_shared/gptFacetJudge.ts`);
const { buildGroundedBrainBinding } = await import(`${R}/supabase/functions/_shared/groundedBrainBinding.ts`);
const { buildEvidenceSnippets } = await import(`${R}/supabase/functions/_shared/facetAttestation.ts`);
const { businessModelDecision } = await import(`${R}/supabase/functions/_shared/groundedClaims.ts`);

if (Deno.env.get("FACET_BENCHMARK_LIVE") !== "1") {
  console.error("Refusing: this calls paid models. Set FACET_BENCHMARK_LIVE=1 to run it.");
  Deno.exit(2);
}

const wanted = new Set((Deno.env.get("FACET_BENCHMARK_ARMS") ?? "current,gpt,jev").split(",").map((s: string) => s.trim()));
const repeats = Math.max(1, Number(Deno.env.get("FACET_BENCHMARK_REPEATS") ?? "5") || 5);
// deno-lint-ignore no-explicit-any
const calls: any[] = [];
// deno-lint-ignore no-explicit-any
const sink = (t: any, ok: boolean) => { calls.push({ ...t, ok }); };
const lastCost = () => calls.at(-1)?.estimated_cost_usd ?? null;

// deno-lint-ignore no-explicit-any
const raw: any[] = [];
// deno-lint-ignore no-explicit-any
const recordJudge = (arm: string, judge: any) => async (i: any) => {
  const out = await judge(i);
  raw.push({ arm, company_key: i.snippets.company_key, out: out.ok
    ? { ok: true, model: out.model, latency_ms: out.latency_ms, request_id: out.request_id, answers: out.answers,
        tokens: { in: out.telemetry?.input_tokens ?? null, out: out.telemetry?.output_tokens ?? null }, cost: out.telemetry?.estimated_cost_usd ?? null }
    : { ok: false, failure: out.failure, detail: out.detail, latency_ms: out.latency_ms } });
  return out;
};

// deno-lint-ignore no-explicit-any
const arms: any[] = [];
if (wanted.has("current")) {
  const binding = buildGroundedBrainBinding({
    workspaceId: "facet-benchmark", originalUserQuery: null, callsRemaining: 10_000, onModelCall: sink,
  });
  if (!binding.groundCompany) throw new Error("the grounder is not available");
  const ground = binding.groundCompany;
  // deno-lint-ignore no-explicit-any
  const recordedGround = async (i: any) => {
    const v = await ground(i);
    raw.push({ arm: "current_grounder", company_key: i.registry.company_key, out: v ? {
      ok: true,
      value: v.classifier_result?.business_model?.value ?? null,
      bm_confidence: v.classifier_result?.business_model?.confidence ?? null,
      decision: businessModelDecision(v).decision,
      facets_stated: businessModelDecision(v).facets_stated,
      reasons: businessModelDecision(v).reasons,
      quotes: businessModelDecision(v).quotes.map((q: { excerpt: string; source?: string }) => (q.source ? `[${q.source}] ` : "") + q.excerpt),
      rejected: (v.rejected_claims ?? []).map((r: { claim_type: string; reason: string }) => `${r.claim_type}:${r.reason}`),
    } : { ok: false } });
    return v;
  };
  arms.push(liveGrounderArm(recordedGround, lastCost));
}
if (wanted.has("gpt")) {
  const effort = Deno.env.get("FACET_BENCHMARK_GPT_EFFORT");
  arms.push(judgeArm("gpt_fixed", recordJudge("gpt_fixed", gptFacetJudge({
    model: Deno.env.get("FACET_BENCHMARK_GPT_MODEL") ?? "gpt-5.6-luna",
    reasoningEffort: effort === "low" || effort === "medium" || effort === "high" ? effort : "none",
    deps: { onModelCall: sink },
  }))));
}
if (wanted.has("jev")) {
  const apiKey = Deno.env.get("JEV_API_KEY") ?? null;
  if (!apiKey) throw new Error("JEV_API_KEY is not set");
  arms.push(judgeArm("jev", recordJudge("jev", jevJudge({
    apiKey, model: Deno.env.get("JEV_MODEL") ?? DEFAULT_JEV_MODEL, onModelCall: sink,
  }))));
}

const report = await runBenchmark({ fixtures: ALL_FIXTURES, arms, repeats });
// deno-lint-ignore no-explicit-any
const by = (n: string) => report.arms.find((a: any) => a.arm === n);
const gates: Record<string, unknown> = {};
if (by("jev") && by("current_grounder")) gates.jev_vs_current = successGate(by("jev")!, by("current_grounder")!);
if (by("jev") && by("gpt_fixed")) gates.jev_vs_gpt_fixed = successGate(by("jev")!, by("gpt_fixed")!);
if (by("gpt_fixed") && by("current_grounder")) gates.gpt_fixed_vs_current = successGate(by("gpt_fixed")!, by("current_grounder")!);

// The snippet texts each judge saw, per fixture — deterministic, so recomputed.
const snippets = Object.fromEntries(ALL_FIXTURES.map((f: { id: string; company_key: string }) => {
  const s = buildEvidenceSnippets(registryFor(f));
  return [f.company_key, Object.fromEntries(s.snippets.map((x: { snippet_id: string; text: string }) => [x.snippet_id, x.text]))];
}));

console.log(JSON.stringify({
  fixtures: report.fixtures, repeats, metrics: report.arms, gates,
  model_calls: calls.length,
  model_cost_usd: calls.reduce((s: number, c: { estimated_cost_usd?: number }) => s + (c.estimated_cost_usd ?? 0), 0),
  calls, runs: report.runs, raw, snippets,
}));
