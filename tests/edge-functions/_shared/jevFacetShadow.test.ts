// THE JEV FACET SHADOW — JEV MAY ANSWER; ONLY CODE MAY BELIEVE, AND IN PHASE 1
// NOTHING IS BELIEVED AT ALL.
//
// Phase 1 of the Agentory + Jev company-evidence architecture:
//
//   registry → deterministic snippets → Jev (typed questions, snippet ids)
//            → deterministic validation → a diagnostic, compared with the
//              CURRENT grounder, which stays canonical
//
// These pin the snippet builder, the validation rules, the adapter's documented
// contract, the failure behaviour, and — the point of Phase 1 — that the shadow
// has no path to anything canonical. ZERO network: every judge is scripted and
// every fetch is a fake.

import { assert, assertEquals, assertFalse, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ATTESTED_FACETS, buildEvidenceSnippets, compareWithCurrent, currentGrounderView, splitIntoSnippetTexts,
  validateFacetAnswers, type AttestedFacet, type FacetVerdict, type RawFacetAnswers, type SnippetSet,
} from "../../../supabase/functions/_shared/facetAttestation.ts";
import {
  JEV_API_URL, JEV_MODEL_ROLE, buildJevRequest, evaluateFacets, parseJevResponse, type FacetJudge, type JudgeOutcome,
} from "../../../supabase/functions/_shared/jevProvider.ts";
import { buildJevShadow, isJevShadowEnabled } from "../../../supabase/functions/_shared/jevShadowBinding.ts";
import {
  excerptIsPresent, parseGroundedResult, verifyGroundedResult, type GroundedVerification,
} from "../../../supabase/functions/_shared/groundedClaims.ts";
import { regroundPendingClaims } from "../../../supabase/functions/_shared/webEvidenceRegrounding.ts";
import type { EvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import type { ModelCallTelemetry } from "../../../supabase/functions/_shared/modelCostModel.ts";
import { ALL_FIXTURES, COMFYUI, FUSE, SYNTHETIC, registryFor, type FacetFixture } from "../_eval/facetFixtures.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const ON: Record<string, string> = {
  JEV_SHADOW_ENABLED: "true", JEV_SHADOW_WORKSPACES: WS, JEV_API_KEY: "test-key",
};
const env = (over: Record<string, string | undefined> = {}) => (k: string) => ({ ...ON, ...over })[k];
const fixture = (id: string) => ALL_FIXTURES.find((f) => f.id === id)!;

/** The snippet id whose text contains `needle`. */
function idWith(set: SnippetSet, needle: string): string {
  const s = set.snippets.find((x) => x.text.toLowerCase().includes(needle.toLowerCase()));
  if (!s) throw new Error(`no snippet contains "${needle}"`);
  return s.snippet_id;
}

/** A judge that answers the fixture's labels, citing its expected support — a perfect judge. */
function oracleJudge(f: FacetFixture): FacetJudge {
  return ({ snippets }) => {
    const answers: RawFacetAnswers = {};
    for (const facet of ATTESTED_FACETS) {
      const label = f.labels[facet];
      const needle = f.expected_support?.[facet]?.find((n) => snippets.snippets.some((s) => s.text.toLowerCase().includes(n.toLowerCase())));
      answers[facet] = {
        verdict: label,
        support: label === "states" && needle ? idWith(snippets, needle) : "NONE",
        contradiction: label === "contradicts" ? snippets.snippets.find((s) => s.evidence_type === "web_page")?.snippet_id ?? "NONE" : "NONE",
        confidence: 0.9,
      };
    }
    return Promise.resolve(ok(answers));
  };
}

function ok(answers: RawFacetAnswers): JudgeOutcome {
  return {
    ok: true, answers, model: "jev-1.13.0", latency_ms: 12, request_id: "req-1",
    telemetry: {
      version: "model-cost-model-v1", role: JEV_MODEL_ROLE, model: "jev-1.13.0", reasoning_effort: null,
      input_tokens: 1000, cached_input_tokens: null, output_tokens: 10, estimated_cost_usd: 0.000042,
      actual_cost_usd: null, cost_source: "event_priced", latency_ms: 12, fallback_reason: null,
    } as ModelCallTelemetry,
  };
}

/** Says `states` for every facet, citing the first snippet — the worst plausible judge. */
const yesToEverything: FacetJudge = ({ snippets }) => Promise.resolve(ok(Object.fromEntries(ATTESTED_FACETS.map((f) => [f, {
  verdict: "states", support: snippets.snippets[0]?.snippet_id, contradiction: "NONE", confidence: 0.99,
}]))));

/** A grounded binding whose grounder returns `v` — typed as production's is. */
const stub = (v: GroundedVerification | null) => ({
  groundCompany: (_i: { registry: EvidenceRegistry; requiresCommercialSignal: boolean }) => Promise.resolve(v),
});

/** The current grounder's recorded 62450e73 answer on Fuse, verified. */
function fuseVerification(reg: EvidenceRegistry, which = 0): GroundedVerification {
  return verifyGroundedResult({ registry: reg, result: parseGroundedResult(FUSE.recorded_grounder!(reg)[which]) });
}

// ══════════ 1. SNIPPETS ═════════════════════════════════════════════════════

Deno.test("snippets: stable ids — the same evidence gives the same snippets, whatever the item order", () => {
  const reg = registryFor(FUSE);
  const a = buildEvidenceSnippets(reg);
  const b = buildEvidenceSnippets({ ...reg, items: [...reg.items].reverse() });
  const c = buildEvidenceSnippets(registryFor(FUSE));
  assertEquals(a.snippets.map((s) => s.snippet_id), b.snippets.map((s) => s.snippet_id));
  assertEquals(a.snippets.map((s) => s.snippet_id), c.snippets.map((s) => s.snippet_id), "rebuilt from scratch: identical");
  assertEquals(new Set(a.snippets.map((s) => s.snippet_id)).size, a.snippets.length, "unique within the set");
});

Deno.test("snippets: every snippet is its evidence's own text, verbatim, with its provenance", () => {
  for (const f of ALL_FIXTURES) {
    const reg = registryFor(f);
    const set = buildEvidenceSnippets(reg);
    for (const s of set.snippets) {
      const item = reg.items.find((i) => i.evidence_id === s.evidence_id)!;
      assert(excerptIsPresent(s.text, item.source_text), `${f.id}: "${s.text}" is not in ${s.evidence_id}`);
      assertEquals([s.company_key, s.evidence_type, s.source_url, s.fetched_at], [reg.company_key, item.evidence_type, item.source_url, item.observed_at]);
      assert(s.allowed_facets.length > 0);
    }
  }
});

Deno.test("snippets: a price and its period are one snippet; a join that is not verbatim is never made", () => {
  const texts = splitIntoSnippetTexts("PRICING\n\n# Time is money.\n\nSolo\n\n$60\n\nper month\n\nSeats\n\n50/seat");
  assert(texts.includes("Solo $60 per month"));
  assert(texts.includes("Seats 50/seat"));
  assertFalse(texts.some((t) => t.startsWith("PRICING Time")), "the '#' sits between them in the source");
});

Deno.test("snippets: only this company's valid, allowed, on-site evidence — the registry is never written", () => {
  const reg = registryFor(FUSE);
  const before = JSON.stringify(reg);
  const foreign = { ...reg.items[0], evidence_id: "web_page:web:other", company_key: "https://www.linkedin.com/company/other", source_text: "Other Co sells to banks." };
  const invalid = { ...reg.items[0], evidence_id: "web_page:web:bad", verification_state: "invalid" as const, source_text: "Provider failed." };
  const offsite = { ...reg.items[0], evidence_id: "web_page:web:off", source_url: "https://evil.example/pricing", source_text: "We sell to consumers only." };
  const set = buildEvidenceSnippets({ ...reg, items: [...reg.items, foreign, invalid, offsite] });
  assertFalse(set.snippets.some((s) => ["web_page:web:other", "web_page:web:bad", "web_page:web:off"].includes(s.evidence_id)));
  assert(set.snippets.some((s) => s.evidence_type === "company_description"), "a LinkedIn description is not a first-party page and is kept");
  assertEquals(JSON.stringify(reg), before);
});

// ══════════ 2. DETERMINISTIC VALIDATION ════════════════════════════════════

function validate(reg: EvidenceRegistry, set: SnippetSet, facet: AttestedFacet, a: RawFacetAnswers[AttestedFacet]) {
  const answers = Object.fromEntries(ATTESTED_FACETS.map((f) => [f, { verdict: "not_stated", support: "NONE", contradiction: "NONE" }])) as RawFacetAnswers;
  answers[facet] = a;
  return validateFacetAnswers({ registry: reg, snippets: set, answers });
}

Deno.test("validation: a valid snippet lets `states` stand", () => {
  const reg = registryFor(FUSE);
  const set = buildEvidenceSnippets(reg);
  const r = validate(reg, set, "saas_delivery", { verdict: "states", support: idWith(set, "50/seat"), contradiction: "NONE", confidence: 0.8 });
  assertEquals(r.facets.saas_delivery.verdict, "states");
  assertEquals(r.facets.saas_delivery.supporting_snippet_ids, [idWith(set, "50/seat")]);
  assertEquals(r.failures, []);
});

Deno.test("validation: an invented snippet id is discarded, and `states` without valid support falls to not_stated", () => {
  const reg = registryFor(FUSE);
  const set = buildEvidenceSnippets(reg);
  const r = validate(reg, set, "saas_delivery", { verdict: "states", support: "s00000000", contradiction: "NONE" });
  assertEquals(r.facets.saas_delivery.verdict, "not_stated");
  assertEquals(r.facets.saas_delivery.downgraded, "states_without_valid_support");
  assertEquals(r.failures.map((f) => f.reason).sort(), ["states_without_valid_support", "unknown_snippet_id"]);
  assertEquals(r.rejected_snippet_ids, ["s00000000"]);
});

Deno.test("validation: another company's snippet is rejected as wrong_company", () => {
  const reg = registryFor(FUSE);
  const set = buildEvidenceSnippets(reg);
  const other = buildEvidenceSnippets(registryFor(COMFYUI));
  const smuggled: SnippetSet = { ...set, snippets: [...set.snippets, other.snippets[0]] };
  const r = validate(reg, smuggled, "business_customer", { verdict: "states", support: other.snippets[0].snippet_id, contradiction: "NONE" });
  assertEquals(r.failures[0].reason, "wrong_company");
  assertEquals(r.facets.business_customer.verdict, "not_stated");
});

Deno.test("validation: an evidence type the claim cannot rest on is rejected; an industry label alone cannot carry a customer", () => {
  const reg = registryFor(FUSE);
  const industry = { ...reg.items[0], evidence_id: "company_industry:li:x", evidence_type: "company_industry" as const, source_url: null, source_text: "Software for businesses" };
  const reg2 = { ...reg, items: [...reg.items, industry] };
  const set = buildEvidenceSnippets(reg2);
  const id = set.snippets.find((s) => s.evidence_id === industry.evidence_id)!.snippet_id;
  const product = validate(reg2, set, "software_product", { verdict: "states", support: id, contradiction: "NONE" });
  assertEquals(product.failures.find((f) => f.snippet_id === id)?.reason, "evidence_type_not_allowed");
  const customer = validate(reg2, set, "business_customer", { verdict: "states", support: id, contradiction: "NONE" });
  assertEquals(customer.facets.business_customer.downgraded, "contextual_only_support");
  assertEquals(customer.facets.business_customer.verdict, "not_stated");
});

Deno.test("validation: stale evidence, altered text and an off-site page are all rejected", () => {
  const reg = registryFor(FUSE);
  const set = buildEvidenceSnippets(reg);
  const id = idWith(set, "50/seat");
  const pageId = set.snippets.find((s) => s.snippet_id === id)!.evidence_id;
  const withItem = (patch: Record<string, unknown>) => ({ ...reg, items: reg.items.map((i) => i.evidence_id === pageId ? { ...i, ...patch } : i) });
  const ans = { verdict: "states", support: id, contradiction: "NONE" };
  assertEquals(validate(withItem({ freshness: "stale" }) as EvidenceRegistry, set, "saas_delivery", ans).failures[0].reason, "stale_evidence");
  assertEquals(validate(withItem({ source_text: "Contact sales for pricing." }) as EvidenceRegistry, set, "saas_delivery", ans).failures[0].reason, "snippet_altered");
  assertEquals(validate(withItem({ source_url: "https://evil.example/pricing" }) as EvidenceRegistry, set, "saas_delivery", ans).failures[0].reason, "off_domain");
});

Deno.test("validation: a contradiction needs a valid contradicting snippet; code derives contradiction_present", () => {
  const f = fixture("negation");
  const reg = registryFor(f);
  const set = buildEvidenceSnippets(reg);
  const no = idWith(set, "No subscriptions");
  const r = validate(reg, set, "saas_delivery", { verdict: "contradicts", support: "NONE", contradiction: no });
  assertEquals([r.facets.saas_delivery.verdict, r.contradiction_present], ["contradicts", true]);
  const bare = validate(reg, set, "saas_delivery", { verdict: "contradicts", support: "NONE", contradiction: "NONE" });
  assertEquals([bare.facets.saas_delivery.verdict, bare.facets.saas_delivery.downgraded, bare.contradiction_present],
    ["not_stated", "contradicts_without_valid_contradiction", false]);
});

Deno.test("validation: an out-of-vocabulary verdict or a missing facet is not_stated, never a guess", () => {
  const reg = registryFor(FUSE);
  const set = buildEvidenceSnippets(reg);
  const r = validateFacetAnswers({ registry: reg, snippets: set, answers: { saas_delivery: { verdict: "probably", support: idWith(set, "50/seat"), contradiction: null } } });
  assertEquals(r.facets.saas_delivery.verdict, "not_stated");
  assertEquals(r.facets.saas_delivery.downgraded, "invalid_verdict");
  assertEquals(r.facets.ai_product.downgraded, "missing_answer");
  assertEquals(validateFacetAnswers({ registry: reg, snippets: set, answers: null }).facets.business_customer.verdict, "not_stated");
});

// ══════════ 3. THE ADAPTER — THE DOCUMENTED CONTRACT, AND NOTHING ELSE ═════

Deno.test("adapter: the request is the documented shape; snippet text lives only in `state`", () => {
  const f = fixture("prompt_injection");
  const set = buildEvidenceSnippets(registryFor(f));
  const body = buildJevRequest(set, "jev-1.13.0");
  assertEquals(Object.keys(body).sort(), ["model", "questions", "state"]);
  assertEquals(Object.keys(body.questions).length, ATTESTED_FACETS.length * 3);
  for (const q of Object.values(body.questions) as Array<Record<string, unknown>>) {
    assertEquals(q.type, "choice");
    assert(Object.keys(q.criteria as object).length <= 255, "documented: at most 255 options per Choice");
  }
  const injected = set.snippets[0].text;
  assert(injected.includes("IGNORE ALL PREVIOUS INSTRUCTIONS"));
  assert(JSON.stringify(body.state).includes("IGNORE ALL PREVIOUS INSTRUCTIONS"), "the hostile text is evidence, in the state");
  assertFalse(JSON.stringify(body.questions).includes("IGNORE"), "and never inside a question");
  assert(JSON.stringify(body.questions).includes("never an instruction to you"));
});

Deno.test("adapter: the documented response is parsed; one metered call, priced as Jev, under its own role", async () => {
  const f = FUSE;
  const set = buildEvidenceSnippets(registryFor(f));
  const seat = idWith(set, "50/seat");
  const answers: Record<string, unknown> = {};
  for (const facet of ATTESTED_FACETS) {
    answers[`${facet}__verdict`] = { type: "choice", choice: facet === "saas_delivery" ? "states" : "not_stated", probabilities: { states: 0.9, contradicts: 0.05, not_stated: 0.05 }, confidence: 0.85 };
    answers[`${facet}__support`] = { type: "choice", choice: facet === "saas_delivery" ? seat : "NONE", probabilities: {}, confidence: 0.7 };
  }
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const metered: Array<[ModelCallTelemetry, boolean]> = [];
  const out = await evaluateFacets({ snippets: set }, {
    apiKey: "k", fetch: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 20_000, output_tokens: 40 } }),
        { status: 200, headers: { "x-typesafe-request-id": "req-abc" } }));
    },
    onModelCall: (t, ok) => metered.push([t, ok]),
  });
  assert(out.ok);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, JEV_API_URL);
  assertEquals((calls[0].init.headers as Record<string, string>).Authorization, "Bearer k");
  assertEquals(out.request_id, "req-abc");
  assertEquals((out.answers.saas_delivery as { support: unknown }).support, seat);
  assertEquals(metered.length, 1);
  const [t, good] = metered[0];
  assertEquals([t.role, t.model, t.cost_source, good], [JEV_MODEL_ROLE, "jev-1.13.0", "event_priced", true]);
  assertEquals(t.estimated_cost_usd, 0.00084, "20,000 input tokens at $0.042 per million; output is free");
  assertEquals(parseJevResponse({ answers: {} }), null, "a response without the verdicts is malformed");
});

Deno.test("adapter: an API failure is an outcome, not a throw — and a call that reached Jev is recorded unpriced, never free", async () => {
  const set = buildEvidenceSnippets(registryFor(FUSE));
  const metered: Array<[ModelCallTelemetry, boolean]> = [];
  for (const [status, failure] of [[500, "http_error"], [429, "rate_limited"], [529, "overloaded"], [401, "unauthorized"], [422, "rejected_request"]] as const) {
    const out = await evaluateFacets({ snippets: set }, {
      apiKey: "k", fetch: () => Promise.resolve(new Response("{\"error\":\"x\"}", { status })), onModelCall: (t, ok) => metered.push([t, ok]),
    });
    assertEquals([out.ok, !out.ok && out.failure], [false, failure]);
  }
  assert(metered.every(([t, ok]) => !ok && t.cost_source === "unknown" && t.estimated_cost_usd === null));
  const noKey = await evaluateFacets({ snippets: set }, { apiKey: null, fetch: () => { throw new Error("must not be called"); } });
  assertEquals([noKey.ok, !noKey.ok && noKey.failure], [false, "no_api_key"]);
  const junk = await evaluateFacets({ snippets: set }, { apiKey: "k", fetch: () => Promise.resolve(new Response("not json", { status: 200 })) });
  assertEquals([junk.ok, !junk.ok && junk.failure], [false, "malformed_response"]);
});

Deno.test("adapter: a Jev that does not answer in time is a timeout, bounded by the configured limit", async () => {
  const set = buildEvidenceSnippets(registryFor(FUSE));
  const t0 = Date.now();
  const out = await evaluateFacets({ snippets: set }, {
    apiKey: "k", timeoutMs: 30,
    fetch: (_u, init) => new Promise((_r, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }),
  });
  assertEquals([out.ok, !out.ok && out.failure], [false, "timeout"]);
  assert(Date.now() - t0 < 1000);
});

// ══════════ 4. THE SHADOW — ENABLEMENT AND FAILURE ═════════════════════════

Deno.test("enablement: OFF by default; each missing condition names itself; an unpriced alias refuses to run", () => {
  assertEquals(isJevShadowEnabled(WS, () => undefined).reason, "flag_off");
  assertEquals(isJevShadowEnabled(WS, env({ JEV_SHADOW_WORKSPACES: "" })).reason, "no_allowlist");
  assertEquals(isJevShadowEnabled("other", env()).reason, "workspace_not_listed");
  assertEquals(isJevShadowEnabled(WS, env({ JEV_API_KEY: "" })).reason, "no_api_key");
  assertEquals(isJevShadowEnabled(WS, env({ JEV_MODEL: "jev-latest" })).reason, "model_unpriced");
  const on = isJevShadowEnabled(WS, env());
  assertEquals([on.enabled, on.model], [true, "jev-1.13.0"]);
});

Deno.test("flag OFF: no Jev call, and the binding is the SAME object", async () => {
  let called = 0;
  const shadow = buildJevShadow({ workspaceId: WS, read: () => undefined, judge: () => { called++; return yesToEverything({} as never); } });
  const binding = { groundCompany: async () => null, mode: "shadow" as const };
  assert(shadow.wrapBinding(binding) === binding);
  shadow.observe({ registry: registryFor(FUSE), verification: null, source: "batch" });
  await shadow.settle(10);
  assertEquals(called, 0);
  assertEquals([shadow.report().enabled, shadow.report().calls_started], [false, 0]);
});

Deno.test("failure: a Jev that throws, fails or hangs never touches the grounder's result or the run", async () => {
  const reg = registryFor(FUSE);
  const v = fuseVerification(reg);
  const judges: FacetJudge[] = [
    () => Promise.reject(new Error("boom")),
    () => Promise.resolve({ ok: false, failure: "http_error", detail: "HTTP 500", latency_ms: 5, telemetry: null }),
    () => new Promise(() => {}), // never answers
  ];
  for (const judge of judges) {
    const shadow = buildJevShadow({ workspaceId: WS, read: env(), judge });
    const wrapped = shadow.wrapBinding(stub(v));
    const got = await wrapped.groundCompany!({ registry: reg, requiresCommercialSignal: false });
    assert(got === v, "the grounder's own object, untouched");
    const t0 = Date.now();
    await shadow.settle(50);
    assert(Date.now() - t0 < 1000, "settle is bounded");
    const r = shadow.report();
    assert(r.calls_failed + r.unsettled >= 1, JSON.stringify(r));
  }
});

Deno.test("budget: the call cap and the run's own model budget are honoured before every call", async () => {
  const reg = registryFor(FUSE);
  let calls = 0;
  const judge: FacetJudge = (i) => { calls++; return oracleJudge(FUSE)(i); };
  const capped = buildJevShadow({ workspaceId: WS, read: env({ JEV_SHADOW_MAX_CALLS: "2" }), judge });
  for (let n = 0; n < 5; n++) capped.observe({ registry: reg, verification: null, source: "batch" });
  await capped.settle(100);
  assertEquals([calls, capped.report().skipped.call_cap], [2, 3]);
  const broke = buildJevShadow({ workspaceId: WS, read: env(), judge, allowSpend: () => false });
  broke.observe({ registry: reg, verification: null, source: "batch" });
  assertEquals([calls, broke.report().skipped.run_budget], [2, 1]);
});

// ══════════ 5. ZERO CANONICAL AUTHORITY ════════════════════════════════════

Deno.test("authority: with Jev ON and saying the opposite of everything, the canonical re-grounding is IDENTICAL", async () => {
  const reg = registryFor(FUSE);
  const v = fuseVerification(reg, 1);
  const run = async (ground: (i: { registry: EvidenceRegistry; requiresCommercialSignal: boolean }) => Promise<GroundedVerification | null>) => {
    const applied: Array<[string, GroundedVerification]> = [];
    const report = await regroundPendingClaims({
      candidates: [{ company_key: reg.company_key, business_model_pending: true, grounded_source_urls: [] }],
      requiresCommercialSignal: false,
      deps: {
        pagesFor: () => Promise.resolve(FUSE.pages.map((p) => ({ source_url: p.url, page_intent: p.intent, source_text: p.text, fetched_at: null }))),
        rebuildRegistry: () => reg,
        ground: ({ registry, requiresCommercialSignal }) => ground({ registry: registry as EvidenceRegistry, requiresCommercialSignal }),
        apply: (k, ver) => { applied.push([k, ver]); return { item: { status: "proven" }, decision: "accepted" }; },
      },
    });
    return { report, applied };
  };
  const plain = await run(async () => v);
  const shadow = buildJevShadow({ workspaceId: WS, read: env(), judge: yesToEverything });
  const shadowed = await run(shadow.wrapBinding(stub(v)).groundCompany!);
  await shadow.settle(100);
  assertEquals(shadowed.report, plain.report);
  assertEquals(shadowed.applied.length, 1);
  assert(shadowed.applied[0][1] === v, "the engine is handed the grounder's verification, not Jev's reading");
  const rec = shadow.report().records[0];
  assertEquals(rec.outcome, "ok");
  assertEquals(shadow.report().authority, "none");
});

Deno.test("authority: the shadow reads a COPY — the registry and the verification are never written", async () => {
  const reg = registryFor(FUSE);
  const v = fuseVerification(reg);
  const before = [JSON.stringify(reg), JSON.stringify(v)];
  const shadow = buildJevShadow({ workspaceId: WS, read: env(), judge: yesToEverything });
  await shadow.wrapBinding(stub(v)).groundCompany!({ registry: reg, requiresCommercialSignal: false });
  shadow.observe({ registry: reg, verification: v, source: "batch" });
  await shadow.settle(100);
  assertEquals([JSON.stringify(reg), JSON.stringify(v)], before);
});

Deno.test("authority: nothing in the product reads the shadow back — no eligibility, Workbench, route, provider or terminal path", async () => {
  const root = new URL("../../../supabase/functions/", import.meta.url);
  const hits: Record<string, string[]> = { jev_shadow: [], jevShadowBinding: [], observeGrounding: [], facetAttestation: [] };
  async function* walk(dir: URL, prefix = ""): AsyncGenerator<{ path: string; text: string }> {
    for await (const e of Deno.readDir(dir)) {
      const child = new URL(e.name + (e.isDirectory ? "/" : ""), dir);
      if (e.isDirectory) yield* walk(child, `${prefix}${e.name}/`);
      else if (e.name.endsWith(".ts")) yield { path: `${prefix}${e.name}`, text: await Deno.readTextFile(child) };
    }
  }
  for await (const f of walk(root)) {
    const code = f.text.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
    for (const k of Object.keys(hits)) if (code.includes(k)) hits[k].push(f.path);
  }
  // The diagnostic key is WRITTEN in exactly one place and read nowhere.
  assertEquals(hits.jev_shadow, ["run-agent/index.ts"]);
  const runAgent = await Deno.readTextFile(new URL("run-agent/index.ts", root));
  assertEquals((runAgent.match(/jev_shadow/g) ?? []).length, 1, "one write, into grounded_brain_diagnostics");
  assertEquals(hits.jevShadowBinding, ["run-agent/index.ts"], "one importer: run-agent");
  assertEquals(hits.facetAttestation.sort(), [
    "_shared/gptFacetJudge.ts", "_shared/jevProvider.ts", "_shared/jevShadowBinding.ts",
  ].sort(), "only the Jev modules import the attestation; no canonical module does");
  assertEquals(hits.observeGrounding.sort(), ["_shared/leadCapabilityEngine.ts", "run-agent/index.ts"].sort());
  // Every use of the shadow in run-agent is one of the four permitted shapes.
  const uses = [...runAgent.matchAll(/jevShadow\.[a-zA-Z]+/g)].map((m) => m[0]);
  for (const u of uses) {
    assert(["jevShadow.enabled", "jevShadow.enablement", "jevShadow.wrapBinding", "jevShadow.observe", "jevShadow.settle", "jevShadow.report"].includes(u), u);
  }
  // The engine ignores what the observer returns and swallows what it throws.
  const engine = await Deno.readTextFile(new URL("_shared/leadCapabilityEngine.ts", root));
  assert(/try \{\s*deps\.observeGrounding\(\{ registry, verification: batchGrounded, source: "batch" \}\);\s*\} catch/.test(engine));
});

Deno.test("authority: the shadow makes no call but Jev's — no provider, no other network", async () => {
  const real = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = ((u: string | URL | Request) => { seen.push(String(u)); return Promise.reject(new Error("no network in tests")); }) as typeof fetch;
  try {
    const reg = registryFor(FUSE);
    const shadow = buildJevShadow({ workspaceId: WS, read: env() });
    await shadow.wrapBinding(stub(fuseVerification(reg))).groundCompany!({ registry: reg, requiresCommercialSignal: false });
    await shadow.settle(200);
    assertEquals(seen, [JEV_API_URL]);
    assertEquals(shadow.report().records[0].failure, "network", "and its failure stays a diagnostic");
  } finally {
    globalThis.fetch = real;
  }
});

// ══════════ 6. REGRESSIONS AND HARD CASES ══════════════════════════════════

Deno.test("Fuse regression: all three production grounder answers, compared facet by facet with a correct Jev", async () => {
  const reg = registryFor(FUSE);
  const views = FUSE.recorded_grounder!(reg).map((a) => currentGrounderView(verifyGroundedResult({ registry: reg, result: parseGroundedResult(a) })));
  // Today's canonical reading, after facet completion: every run states the buyer and SaaS delivery.
  for (const v of views) {
    assertEquals([v.facets.business_customer, v.facets.saas_delivery], ["states", "states"]);
  }
  const shadow = buildJevShadow({ workspaceId: WS, read: env(), judge: oracleJudge(FUSE) });
  for (const [n, a] of FUSE.recorded_grounder!(reg).entries()) {
    const v = verifyGroundedResult({ registry: reg, result: parseGroundedResult(a) });
    await shadow.wrapBinding(stub(v)).groundCompany!({ registry: reg, requiresCommercialSignal: false });
    void n;
  }
  await shadow.settle(200);
  const recs = shadow.report().records;
  assertEquals(recs.length, 3);
  for (const r of recs) {
    assertEquals(r.facets!.saas_delivery.verdict, "states");
    assertEquals(r.facets!.business_customer.verdict, "states");
    assertEquals(r.validation_failures, []);
    // On Fuse today's canonical reader already states all four facets, so a
    // correct Jev agrees with it on every one of the three production answers.
    assertEquals([r.agreement, r.disagreement_facets], [true, []]);
  }
});

Deno.test("ComfyUI regression: the platform and pricing pages attest buyer, software and SaaS on first-party snippets", () => {
  const reg = registryFor(COMFYUI);
  const set = buildEvidenceSnippets(reg);
  assertEquals(set.snippets.every((s) => s.evidence_type === "web_page" && s.source_domain === "comfy.org"), true);
  const answers: RawFacetAnswers = {
    business_customer: { verdict: "states", support: idWith(set, "for businesses"), contradiction: "NONE" },
    saas_delivery: { verdict: "states", support: idWith(set, "billed per seat"), contradiction: "NONE" },
    software_product: { verdict: "states", support: idWith(set, "runs your ComfyUI workflows"), contradiction: "NONE" },
    consumer_customer: { verdict: "not_stated", support: "NONE", contradiction: "NONE" },
    service_heavy: { verdict: "not_stated", support: "NONE", contradiction: "NONE" },
    ai_product: { verdict: "not_stated", support: "NONE", contradiction: "NONE" },
  };
  const r = validateFacetAnswers({ registry: reg, snippets: set, answers });
  const got = Object.fromEntries(ATTESTED_FACETS.map((f) => [f, r.facets[f].verdict]));
  assertEquals(got, COMFYUI.labels);
  assertEquals(r.failures, []);
});

Deno.test("service-heavy and mixed-audience cases validate exactly the labels a correct judge gives", async () => {
  for (const id of ["service_agency", "mixed_b2b_b2c", "marketplace", "enterprise_on_prem"]) {
    const f = fixture(id);
    const reg = registryFor(f);
    const set = buildEvidenceSnippets(reg);
    const out = await oracleJudge(f)({ snippets: set });
    assert(out.ok);
    const r = validateFacetAnswers({ registry: reg, snippets: set, answers: out.answers });
    const got = Object.fromEntries(ATTESTED_FACETS.map((x) => [x, r.facets[x].verdict])) as Record<AttestedFacet, FacetVerdict>;
    for (const facet of ATTESTED_FACETS) {
      if (f.labels[facet] === "states" && !f.expected_support?.[facet]) continue; // no citable snippet named
      assertEquals(got[facet], f.labels[facet], `${id}.${facet}`);
    }
  }
  const mixed = validateFacetAnswers({
    registry: registryFor(fixture("mixed_b2b_b2c")),
    snippets: buildEvidenceSnippets(registryFor(fixture("mixed_b2b_b2c"))),
    answers: (await oracleJudge(fixture("mixed_b2b_b2c"))({ snippets: buildEvidenceSnippets(registryFor(fixture("mixed_b2b_b2c"))) }) as { answers: RawFacetAnswers }).answers,
  });
  assertEquals([mixed.facets.business_customer.verdict, mixed.facets.consumer_customer.verdict], ["states", "states"],
    "both audiences, independently — neither hides the other");
});

Deno.test("prompt injection: obeying the page is recorded as the judge's answer and changes nothing canonical", async () => {
  const f = fixture("prompt_injection");
  const reg = registryFor(f);
  const shadow = buildJevShadow({ workspaceId: WS, read: env(), judge: yesToEverything });
  const v = verifyGroundedResult({ registry: reg, result: parseGroundedResult({ business_model: { value: "unknown", confidence: 0, claims: [] }, company_fit: "review" }) });
  const got = await shadow.wrapBinding(stub(v)).groundCompany!({ registry: reg, requiresCommercialSignal: false });
  await shadow.settle(100);
  assert(got === v);
  const rec = shadow.report().records[0];
  // A judge that obeyed the page cites a REAL snippet — validation cannot catch
  // semantics, which is exactly why Phase 1 grants no authority and the
  // benchmark scores hostile fixtures separately.
  assertEquals(rec.facets!.business_customer.verdict, "states");
  assertEquals(rec.current_grounder_result.decision, "review");
  assertNotEquals(rec.agreement, true);
});

Deno.test("compare: the current system has no per-facet contradiction, so contradicts vs not_stated is agreement on 'not stated'", () => {
  const reg = registryFor(fixture("negation"));
  const set = buildEvidenceSnippets(reg);
  const att = validateFacetAnswers({ registry: reg, snippets: set, answers: Object.fromEntries(ATTESTED_FACETS.map((x) => [x, {
    verdict: x === "saas_delivery" ? "contradicts" : "not_stated", support: "NONE", contradiction: x === "saas_delivery" ? idWith(set, "No subscriptions") : "NONE",
  }])) });
  const cmp = compareWithCurrent(att, { available: true, value: "b2b_software", decision: "review", reasons: [], facets: Object.fromEntries(ATTESTED_FACETS.map((x) => [x, "not_stated"])) as never });
  assertEquals(cmp, { agreement: true, disagreement_facets: [] });
  void SYNTHETIC;
});
