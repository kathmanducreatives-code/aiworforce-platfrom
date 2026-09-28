// BENCHMARK V2 — THE CONTRACT, THE GUARDS, THE SCORING AND THE V1 FREEZE.
//
// Offline only: every judge answer here is scripted, no model is called, and
// Benchmark V1's files are checked byte-for-byte against their frozen hashes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildEvidenceDocument, derive, isPlatformOnly, PRESENCE_FACETS, validateV2,
  type EvidenceDocument, type RawV2Answer, type V2Answer,
} from "../_eval/v2/contract.ts";
import { ALL_V2, registryForV2, type V2Fixture } from "../_eval/v2/fixtures.ts";
import {
  assignSplits, CURRENT_NOT_EXPRESSIBLE, decisionValue, DECISIONS, gateV2, judgeArmV2, POLICY_REFUSALS, runV2, scoreV2, tuneThreshold,
  type ArmScore, type RunRecord,
} from "../_eval/v2/benchmark.ts";
import { buildJevV2Request, currentToV2, gptV2Schema, NOT_EXPRESSIBLE, type V2Judge } from "../_eval/v2/judges.ts";
import { parseGroundedResult, verifyGroundedResult } from "../../../supabase/functions/_shared/groundedClaims.ts";
import { BENCHMARK_V2_FIXTURES, GATE_FACETS, GATE_SPLIT_SHA256, REAL_V2 } from "../_eval/v2/realFixtures.ts";
import { analyzeV2 } from "../_eval/v2/analyze.ts";
import { RUN_COST_BOUND_USD, SpendGuard, verifyFrozen } from "../_eval/v2/runGuards.ts";

const fx = (id: string) => ALL_V2.find((f) => f.id === id)!;
const docOf = (f: V2Fixture) => buildEvidenceDocument(registryForV2(f));
const label = (doc: EvidenceDocument, needle: string) => {
  const l = doc.lines.find((x) => x.text.toLowerCase().includes(needle.toLowerCase()));
  if (!l) throw new Error(`no line contains "${needle}"`);
  return l.label;
};

/** A scripted answer: presence probabilities, two choices, citations by text. */
function raw(doc: EvidenceDocument, a: {
  business?: number; consumer?: number; ai?: number;
  primary?: string; delivery?: string;
  cite?: Partial<Record<string, string>>;
  injection?: Record<string, number>;
}): RawV2Answer {
  const cite = (k: string) => {
    const n = a.cite?.[k];
    return n === undefined ? "NONE" : /^S\d+$|^NONE$/.test(n) ? n : label(doc, n);
  };
  return {
    presence: {
      business_customer: { p_true: a.business ?? 0.05 },
      consumer_customer: { p_true: a.consumer ?? 0.05 },
      ai_product: { p_true: a.ai ?? 0.05 },
    },
    primary_offering: { choice: a.primary ?? "not_determinable", probabilities: null },
    delivery_model: { choice: a.delivery ?? "not_stated", probabilities: null },
    citations: Object.fromEntries(["business_customer", "consumer_customer", "ai_product", "primary_offering", "delivery_model"].map((k) => [k, cite(k)])),
    injection: a.injection ?? {},
  };
}
const check = (f: V2Fixture, r: (d: EvidenceDocument) => RawV2Answer) => {
  const registry = registryForV2(f);
  const doc = buildEvidenceDocument(registry);
  return validateV2({ registry, doc, raw: r(doc) });
};

// ══════════ 1. PRESENCE: BUSINESS AND CONSUMER ARE INDEPENDENT ══════════════

Deno.test("business and consumer can both be true", () => {
  const v = check(fx("mixed_b2b_b2c"), (d) => raw(d, { business: 0.9, consumer: 0.9, cite: { business_customer: "5,000 businesses", consumer_customer: "individuals" } }));
  assertEquals([v.answer.business_customer, v.answer.consumer_customer], [true, true]);
  assertEquals(v.failures, []);
  assertEquals([fx("mixed_b2b_b2c").labels.business_customer, fx("mixed_b2b_b2c").labels.consumer_customer], [true, true]);
});

Deno.test("business true / consumer false", () => {
  const v = check(fx("b2b_saas_per_seat"), (d) => raw(d, { business: 0.9, consumer: 0.1, cite: { business_customer: "finance teams" } }));
  assertEquals([v.answer.business_customer, v.answer.consumer_customer], [true, false]);
});

Deno.test("consumer true / business false", () => {
  const v = check(fx("b2c_saas"), (d) => raw(d, { business: 0.1, consumer: 0.9, cite: { consumer_customer: "individuals and families" } }));
  assertEquals([v.answer.business_customer, v.answer.consumer_customer], [false, true]);
  assertEquals([fx("b2c_saas").labels.business_customer, fx("b2c_saas").labels.consumer_customer], [false, true]);
});

Deno.test("a positive without a valid citation is not a positive", () => {
  const v = check(fx("b2c_saas"), (d) => raw(d, { consumer: 0.95 }));
  assertEquals(v.answer.consumer_customer, false);
  assertEquals(v.failures.map((f) => f.reason), ["positive_without_valid_citation"]);
});

// ══════════ 2. PRIMARY OFFERING ════════════════════════════════════════════

Deno.test("platform alone is not software — the citation is refused, the label says not_determinable", () => {
  const f = fx("vague_platform");
  const v = check(f, (d) => raw(d, { primary: "software_product", cite: { primary_offering: "platform" } }));
  assertEquals(v.answer.primary_offering, "not_determinable");
  assert(v.failures.some((x) => x.reason === "platform_only_support"));
  assertEquals(f.labels.primary_offering, "not_determinable");
});

Deno.test("software with API / integrations is software", () => {
  const v = check(fx("fuse_ai"), (d) => raw(d, { primary: "software_product", cite: { primary_offering: "Integrations" } }));
  assertEquals(v.answer.primary_offering, "software_product");
  assertEquals(v.failures, []);
  // …but Fuse's "platform" slogan alone could not carry it.
  const slogan = check(fx("fuse_ai"), (d) => raw(d, { primary: "software_product", cite: { primary_offering: "superintelligence platform" } }));
  assertEquals(slogan.answer.primary_offering, "not_determinable");
});

Deno.test("agency → human-delivered service; code derives service_heavy and not software", () => {
  const f = fx("service_agency");
  const v = check(f, (d) => raw(d, { primary: "human_delivered_service", cite: { primary_offering: "full-service" } }));
  assertEquals(v.answer.primary_offering, "human_delivered_service");
  assertEquals([derive.service_heavy(v.answer), derive.software_product(v.answer)], [true, false]);
  assertEquals(f.labels.primary_offering, "human_delivered_service");
});

Deno.test("software → service_heavy is simply false, never asked and never 'contradicts'", () => {
  const v = check(fx("b2b_saas_per_seat"), (d) => raw(d, { primary: "software_product", cite: { primary_offering: "accounting software" } }));
  assertEquals([derive.software_product(v.answer), derive.service_heavy(v.answer)], [true, false]);
  const q = JSON.stringify(buildJevV2Request(docOf(fx("b2b_saas_per_seat"))).questions);
  assertFalse(/contradict/i.test(q), "no question asks for a contradiction");
});

Deno.test("marketplace → marketplace", () => {
  const f = fx("marketplace");
  const v = check(f, (d) => raw(d, { primary: "marketplace", business: 0.9, cite: { primary_offering: "connects homeowners", business_customer: "Contractors pay" } }));
  assertEquals([v.answer.primary_offering, v.answer.business_customer, v.answer.consumer_customer], ["marketplace", true, false]);
  assertEquals(f.labels, v.answer, "the free homeowners are not the consumer customer");
});

Deno.test("licensed AI models → licensed_models_or_data, with AI present and no SaaS", () => {
  const f = fx("ai_licensed_models");
  const v = check(f, (d) => raw(d, { primary: "licensed_models_or_data", ai: 0.9, business: 0.9,
    cite: { primary_offering: "licenses them", ai_product: "AI models", business_customer: "pharmaceutical partners" } }));
  assertEquals(v.answer, f.labels);
});

// ══════════ 3. DELIVERY MODEL — PRICING PROVES NOTHING ═════════════════════

for (const [id, needle, name] of [
  ["b2b_saas_per_seat", "per user per month", "monthly pricing alone"],
  ["annual_subscription", "Annual subscription", "annual subscription alone"],
  ["fuse_ai", "Shared team workspace with 5 seats", "shared team workspace alone"],
] as const) {
  Deno.test(`${name} → delivery not_stated (a hosted answer resting on it is refused)`, () => {
    const f = fx(id);
    const v = check(f, (d) => raw(d, { delivery: "hosted_cloud_or_web_saas", cite: { delivery_model: needle } }));
    assertEquals(v.answer.delivery_model, "not_stated");
    assert(v.failures.some((x) => x.reason === "pricing_only_support"), JSON.stringify(v.failures));
    assertEquals(f.labels.delivery_model, "not_stated");
  });
}

Deno.test("explicit SaaS / cloud / web → hosted", () => {
  for (const [id, needle] of [["explicit_web_saas", "Hosted in the cloud"], ["comfyui", "cloud-based workspace"], ["consulting_with_saas_plan", "SaaS plan"]] as const) {
    const f = fx(id);
    const v = check(f, (d) => raw(d, { delivery: "hosted_cloud_or_web_saas", cite: { delivery_model: needle } }));
    assertEquals(v.answer.delivery_model, "hosted_cloud_or_web_saas", id);
    assertEquals(f.labels.delivery_model, "hosted_cloud_or_web_saas", id);
    assertEquals(derive.saasRequirement(v.answer), "pass");
  }
});

Deno.test("on-prem → installed, and a SaaS requirement FAILS deterministically", () => {
  const f = fx("enterprise_on_prem");
  const v = check(f, (d) => raw(d, { delivery: "installed_on_prem_or_perpetual", cite: { delivery_model: "on-premises" } }));
  assertEquals(v.answer.delivery_model, "installed_on_prem_or_perpetual");
  assertEquals(derive.saasRequirement(v.answer), "fail", "the contradiction is code's, derived from the category");
});

Deno.test("perpetual licence → installed; self-hosted → installed", () => {
  for (const [id, needle] of [["perpetual_desktop", "Buy it once"], ["self_hosted", "Self-hosted"]] as const) {
    const v = check(fx(id), (d) => raw(d, { delivery: "installed_on_prem_or_perpetual", cite: { delivery_model: needle } }));
    assertEquals(v.answer.delivery_model, "installed_on_prem_or_perpetual", id);
  }
  assertEquals(derive.saasRequirement({ ...fx("fuse_ai").labels }), "pending", "not_stated is pending, not a failure");
});

// ══════════ 4. HOSTILE CONTENT IS NEVER EVIDENCE ═══════════════════════════

Deno.test("prompt injection: a hostile line cannot be cited, whether the filter or the backstop catches it", () => {
  const f = fx("injection_pricing_hosted_claim");
  const lexical = check(f, (d) => raw(d, { delivery: "hosted_cloud_or_web_saas", cite: { delivery_model: "assistant:" } }));
  assertEquals(lexical.answer.delivery_model, "not_stated");
  assert(lexical.failures.some((x) => x.reason === "instructional_evidence"));

  // The model filter flags the payroll pricing page; every line from it is ineligible.
  const p = fx("injection_payroll_consumer_claim");
  const d = docOf(p);
  const page = d.sources.find((s) => s.labels.includes(label(d, "Plans from")))!.source;
  const filtered = check(p, (dd) => raw(dd, { consumer: 0.9, cite: { consumer_customer: "Plans from" }, injection: { [page]: 0.97 } }));
  assertEquals(filtered.answer.consumer_customer, false);
  assert(filtered.failures.some((x) => x.reason === "instructional_evidence"));
  assert(filtered.flagged_sources.includes(page));

  // The candle page: its only line is hostile, so every judgment is negative.
  const c = check(fx("injection_candles"), (dd) => raw(dd, { business: 0.99, consumer: 0.99, ai: 0.99, primary: "physical_product_or_hardware", delivery: "hosted_cloud_or_web_saas",
    cite: { business_customer: "S01", consumer_customer: "S01", ai_product: "S01", primary_offering: "S01", delivery_model: "S01" } }));
  assertEquals(c.answer, fx("injection_candles").labels);
});

Deno.test("at least 3 hostile fixtures exist, and each hostile line is text the backstop recognises", () => {
  const hostile = ALL_V2.filter((f) => f.hostile);
  assert(hostile.length >= 3, `${hostile.length}`);
  for (const f of hostile) assert(docOf(f).lines.some((l) => /IGNORE|SYSTEM NOTE|assistant:|Ignore previous/i.test(l.text)), f.id);
});

Deno.test("the injected text is evidence in `state`, never part of a question", () => {
  const body = buildJevV2Request(docOf(fx("injection_staffing_saas_claim")));
  assert(String(body.state.evidence).includes("SYSTEM NOTE TO AI"));
  assertFalse(JSON.stringify(body.questions).includes("SYSTEM NOTE TO AI"));
});

// ══════════ 5. CITATIONS ARE CHECKED AGAINST THE REGISTRY ═══════════════════

Deno.test("citation ids: an unknown label is refused", () => {
  const v = check(fx("b2c_saas"), (d) => raw(d, { consumer: 0.9, cite: { consumer_customer: "S99" } }));
  assertEquals(v.failures[0].reason, "unknown_label");
  assertEquals(v.answer.consumer_customer, false);
});

Deno.test("citation ids: another company's line is refused", () => {
  const f = fx("b2c_saas");
  const registry = registryForV2(f);
  const foreign = docOf(fx("mixed_b2b_b2c"));
  const v = validateV2({ registry, doc: foreign, raw: raw(foreign, { consumer: 0.9, cite: { consumer_customer: "individuals" } }) });
  assertEquals(v.failures[0].reason, "wrong_company");
});

Deno.test("citation ids: an off-domain page and a stale item are refused", () => {
  const f = fx("explicit_web_saas");
  const registry = registryForV2(f);
  const doc = buildEvidenceDocument(registry);
  const pageId = doc.lines.find((l) => l.text.includes("Hosted in the cloud"))!.evidence_id;
  const patch = (p: Record<string, unknown>) => ({ ...registry, items: registry.items.map((i) => i.evidence_id === pageId ? { ...i, ...p } : i) });
  const r = raw(doc, { delivery: "hosted_cloud_or_web_saas", cite: { delivery_model: "Hosted in the cloud" } });
  assertEquals(validateV2({ registry: patch({ source_url: "https://evil.example/product" }) as never, doc, raw: r }).failures[0].reason, "off_domain");
  const stale = validateV2({ registry: patch({ freshness: "stale" }) as never, doc, raw: r });
  assertEquals([stale.failures[0].reason, stale.answer.delivery_model], ["stale_evidence", "not_stated"]);
});

// ══════════ 6. THE CURRENT GROUNDER, MAPPED — NOT_EXPRESSIBLE IS NOT SCORED ═

function grounder(value: string, bmQuotes: string[], reg = registryForV2(fx("b2b_saas_per_seat"))) {
  const id = reg.items.find((i) => i.evidence_type === "company_description")!.evidence_id;
  return verifyGroundedResult({
    registry: reg,
    result: parseGroundedResult({
      business_model: { value, confidence: 0.9, claims: bmQuotes.length ? [{ claim: "c", claim_type: "business_model", evidence_ids: [id], evidence_excerpts: bmQuotes.map((excerpt) => ({ evidence_id: id, excerpt })) }] : [] },
      company_fit: "pass", supporting_claims: [], conflicting_evidence_ids: [], confidence: 0.9,
    }),
  });
}

Deno.test("current grounder: values map into V2 categories; what it lacks is NOT_EXPRESSIBLE", () => {
  const m = currentToV2(grounder("b2b_saas", ["Ledgerly is accounting software that helps finance teams at growing companies close the books in days."]))!;
  assertEquals([m.primary_offering, m.business_customer], ["software_product", true]);
  assertEquals(currentToV2(grounder("unknown", []))!.primary_offering, "not_determinable");
  assertEquals(currentToV2(null), null);
  for (const d of ["marketplace", "licensed_models_or_data", "physical_product", "media_or_content", "installed_on_prem"] as const) assert(CURRENT_NOT_EXPRESSIBLE.has(d));
  assertEquals(NOT_EXPRESSIBLE, "NOT_EXPRESSIBLE");
});

Deno.test("current grounder: NOT_EXPRESSIBLE decisions and categories are never scored for it", () => {
  const fixtures = ALL_V2;
  const records: RunRecord[] = fixtures.map((f) => ({
    arm: "current_grounder", fixture_id: f.id, repeat: 0, ok: true, failure: null, raw: null,
    current: { ...f.labels, primary_offering: "software_product", delivery_model: "not_stated" }, latency_ms: 1, cost_usd: 0, model: null,
  }));
  const s = scoreV2({ records, fixtures, arm: "current_grounder" });
  for (const d of CURRENT_NOT_EXPRESSIBLE) {
    assertEquals([s.decisions[d].not_expressible, s.decisions[d].tp + s.decisions[d].fp + s.decisions[d].fn + s.decisions[d].tn], [true, 0], d);
  }
  // Category accuracy excludes cells labelled marketplace / licensed / physical / installed.
  const scoredPrimary = fixtures.filter((f) => ["software_product", "human_delivered_service", "not_determinable"].includes(f.labels.primary_offering));
  const correct = scoredPrimary.filter((f) => f.labels.primary_offering === "software_product").length;
  assertEquals(s.primary_accuracy, correct / scoredPrimary.length);
});

// ══════════ 7. THE HARNESS: ORACLE, GATE, SPLITS, THRESHOLDS ════════════════

/** Answers every fixture's labels, citing its expected lines, flagging hostile sources. */
const oracle: V2Judge = (doc) => {
  const f = ALL_V2.find((x) => x.evidence.company_key === doc.company_key)!;
  const want = (j: string) => f.expected_citations?.[j as keyof NonNullable<V2Fixture["expected_citations"]>];
  const cite = (j: string) => { const w = want(j); return w ? doc.lines.find((l) => w.some((n) => l.text.toLowerCase().includes(n.toLowerCase())))?.label ?? "NONE" : "NONE"; };
  const injection = Object.fromEntries(doc.sources.map((s) => [s.source,
    s.labels.some((l) => /IGNORE|SYSTEM NOTE|assistant:|Ignore previous/i.test(doc.lines.find((x) => x.label === l)!.text)) ? 0.95 : 0.02]));
  return Promise.resolve({
    ok: true, model: "oracle", latency_ms: 5, telemetry: null, request_id: null,
    raw: {
      presence: Object.fromEntries(PRESENCE_FACETS.map((p) => [p, { p_true: f.labels[p] ? 0.9 : 0.05 }])),
      primary_offering: { choice: f.labels.primary_offering, probabilities: { [f.labels.primary_offering]: 0.9 } },
      delivery_model: { choice: f.labels.delivery_model, probabilities: { [f.labels.delivery_model]: 0.9 } },
      citations: Object.fromEntries([...PRESENCE_FACETS, "primary_offering", "delivery_model"].map((j) => [j, cite(j)])),
      injection,
    },
  });
};

Deno.test("an oracle judge scores perfectly on every decision, with valid citations and no hostile line accepted", async () => {
  const records = await runV2({ fixtures: ALL_V2, arms: [judgeArmV2("oracle", oracle)], repeats: 2 });
  const s = scoreV2({ records, fixtures: ALL_V2, arm: "oracle" });
  for (const d of DECISIONS) {
    const x = s.decisions[d];
    assertEquals([x.fp, x.fn], [0, 0], d);
    assertEquals(x.repeatability, 1, d);
  }
  assertEquals([s.primary_accuracy, s.delivery_accuracy], [1, 1]);
  assertEquals([s.citations.invalid, s.hostile.hostile_lines_cited_and_accepted], [0, 0]);
  assertEquals(s.citations.hit_rate, 1);
  assert(s.hostile.hostile_sources >= 3 && s.hostile.hostile_sources_flagged === s.hostile.hostile_sources);
});

const score = (over: Partial<ArmScore["decisions"]["software_product"]>, arm = "x"): ArmScore => {
  const base = { tp: 20, fp: 0, fn: 1, tn: 20, precision: 1, recall: 0.95, positives: 21, negatives: 20, real_positives: 21, real_negatives: 20, repeatability: 1, not_expressible: false };
  return {
    arm, runs: 10, failures: 0,
    decisions: Object.fromEntries(DECISIONS.map((d) => [d, { ...base, ...over }])) as ArmScore["decisions"],
    primary_accuracy: 1, delivery_accuracy: 1, citations: { returned: 10, invalid: 0, policy_refused: 0, hit_rate: 1 },
    hostile: { hostile_lines_cited_and_accepted: 0, hostile_sources: 3, hostile_sources_flagged: 3 },
    latency_p50_ms: 1, latency_p95_ms: 1, mean_cost_usd: 0,
  };
};

Deno.test("gate: per decision, on real held-out cells; too few real examples fails; NOT_EXPRESSIBLE is not compared", () => {
  const current = score({ precision: 0.9, recall: 0.8 }, "current_grounder");
  assert(gateV2("software_product", score({}), current).passed);
  assertFalse(gateV2("software_product", score({ precision: 0.94 }), current).passed, "below 95%");
  assertFalse(gateV2("software_product", score({ recall: 0.7 }), current).passed, "recall below current");
  assertFalse(gateV2("software_product", score({ repeatability: 0.98 }), current).passed);
  assertFalse(gateV2("software_product", score({ real_negatives: 14 }), current).passed, "needs 15 real negatives");
  const ne = { ...current, decisions: { ...current.decisions, marketplace: { ...current.decisions.marketplace, not_expressible: true, precision: null, recall: null } } };
  const g = gateV2("marketplace", score({}), ne);
  assert(g.passed, JSON.stringify(g.checks));
  assert(g.checks.some((c) => c.detail.includes("NOT_EXPRESSIBLE")));
});

Deno.test("splits: real fixtures are stratified deterministically into tune / held-out; synthetic stays dev", () => {
  const real = Array.from({ length: 8 }, (_, n) => ({ ...fx("fuse_ai"), id: `real_${n}` }));
  const a = assignSplits([...real, ...ALL_V2.filter((f) => f.kind === "synthetic")]);
  const b = assignSplits([...real, ...ALL_V2.filter((f) => f.kind === "synthetic")]);
  assertEquals(a.map((f) => f.split), b.map((f) => f.split));
  assertEquals(a.filter((f) => f.kind === "production" && f.split === "heldout").length, 4);
  assert(a.filter((f) => f.kind === "synthetic").every((f) => f.split === "dev"));
});

Deno.test("thresholds are chosen on the TUNE split only", async () => {
  const tuneFx: V2Fixture[] = ALL_V2.filter((f) => !f.hostile).map((f) => ({ ...f, split: "tune" }));
  // A judge whose business probabilities are informative but noisy: true at 0.7, false at 0.55.
  const noisy: V2Judge = async (doc) => {
    const o = await oracle(doc);
    if (!o.ok) return o;
    const f = ALL_V2.find((x) => x.evidence.company_key === doc.company_key)!;
    const cite = doc.lines[0].label;
    return { ...o, raw: { ...o.raw, presence: { ...o.raw.presence, business_customer: { p_true: f.labels.business_customer ? 0.7 : 0.55 } },
      citations: { ...o.raw.citations, business_customer: o.raw.citations.business_customer !== "NONE" ? o.raw.citations.business_customer : cite } } };
  };
  const records = await runV2({ fixtures: tuneFx, arms: [judgeArmV2("noisy", noisy)], repeats: 1 });
  const t = tuneThreshold({ records, fixtures: tuneFx, arm: "noisy", decision: "business_customer" })!;
  assert(t.threshold > 0.55 && t.threshold <= 0.7, `${t.threshold}`);
  assertEquals(t.precision, 1);
  // A held-out-only fixture set gives it nothing to tune on.
  const held = tuneFx.map((f) => ({ ...f, split: "heldout" as const }));
  assertEquals(tuneThreshold({ records, fixtures: held, arm: "noisy", decision: "business_customer" }), null);
});

Deno.test("Jev V2 request: 3 Nouls, 2 category Choices, 5 citation Choices, 1 injection Noul per source", () => {
  const d = docOf(fx("fuse_ai"));
  const q = buildJevV2Request(d).questions as Record<string, { type: string; criteria: Record<string, unknown> }>;
  const types = Object.values(q).map((x) => x.type);
  assertEquals(Object.keys(q).length, 10 + d.sources.length);
  assertEquals(types.filter((t) => t === "noul").length, 3 + d.sources.length);
  assertEquals(types.filter((t) => t === "choice").length, 7);
  for (const o of Object.values(q.primary_offering.criteria)) assertEquals(Object.keys(o as object).sort(), ["examples", "not_for", "what"]);
  assertEquals(Object.keys(q.cite_business_customer.criteria), [...d.lines.map((l) => l.label), "NONE"]);
  assert(String(buildJevV2Request(d).state.evidence).startsWith("S01 | "));
  const gpt = gptV2Schema(d).schema.properties as Record<string, unknown>;
  assertEquals(Object.keys(gpt).sort(), ["ai_product", "business_customer", "citations", "consumer_customer", "delivery_model", "instructional_sources", "primary_offering"]);
});

Deno.test("V2 labels follow the contract: every positive judgment names a citation that exists in the evidence", () => {
  for (const f of ALL_V2) {
    const d = docOf(f);
    const positives: string[] = [
      ...PRESENCE_FACETS.filter((p) => f.labels[p]),
      ...(f.labels.primary_offering !== "not_determinable" ? ["primary_offering"] : []),
      ...(f.labels.delivery_model !== "not_stated" ? ["delivery_model"] : []),
    ];
    for (const j of positives) {
      const want = f.expected_citations?.[j as keyof NonNullable<V2Fixture["expected_citations"]>];
      assert(want?.length, `${f.id}.${j} has no expected citation`);
      assert(d.lines.some((l) => want!.some((w) => l.text.includes(w))), `${f.id}.${j}: "${want}" is not in the evidence`);
    }
    for (const k of DECISIONS) decisionValue(k, f.labels as V2Answer);
  }
});

// ══════════ 8. BENCHMARK V1 IS BYTE-IDENTICAL ══════════════════════════════

async function sha256(path: URL): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("Benchmark V1 files and results remain byte-identical to their frozen hashes", async () => {
  const root = new URL("../../../", import.meta.url);
  const base = new URL("tests/edge-functions/_eval/baselines/benchmark-v1/", root);
  const manifest = (await Deno.readTextFile(new URL("freeze-manifest.txt", base))).split("\n").slice(1).filter(Boolean);
  assertEquals(manifest.length, 6);
  for (const line of manifest) {
    const [hash, path] = line.trim().split(/\s+/);
    assertEquals(await sha256(new URL(path, root)), hash, path);
  }
  for (const line of (await Deno.readTextFile(new URL("results-sha256.txt", base))).split("\n").filter(Boolean)) {
    const [hash, name] = line.trim().split(/\s+/);
    assertEquals(await sha256(new URL(name, base)), hash, name);
  }
});

// ══════════ 9. REAL-COMPANY EXTRACTION (PLAN A — REPO ONLY) ═════════════════

Deno.test("real proposals: every supporting quote is verbatim in that company's extracted evidence, and none is frozen", async () => {
  const base = new URL("../_eval/v2/real/", import.meta.url);
  const recs = JSON.parse(await Deno.readTextFile(new URL("companies.json", base))).records as Array<{ key: string; evidence: Array<{ text: string; source_file: string }> }>;
  const props = JSON.parse(await Deno.readTextFile(new URL("label-proposals.json", base))) as Array<{
    company: string; extraction_key: string; status: string; supporting_evidence: Record<string, string>;
    primary_offering: string; delivery_model: string;
  }>;
  assertEquals(props.length, 49);
  for (const p of props) {
    assertEquals(p.status, "PROPOSED_NOT_FROZEN", p.company);
    const r = recs.find((x) => x.key === p.extraction_key)!;
    assert(r, p.company);
    for (const [j, q] of Object.entries(p.supporting_evidence)) assert(r.evidence.some((e) => e.text.includes(q)), `${p.company}.${j}`);
    assert(r.evidence.every((e) => e.source_file.length > 0 && !e.source_file.startsWith("http")), "repo fixtures only");
  }
});

Deno.test("real extraction is offline: the scripts contain no network client", async () => {
  for (const f of ["extract.py", "proposals.py"]) {
    const src = await Deno.readTextFile(new URL(`../_eval/v2/real/${f}`, import.meta.url));
    assertFalse(/\b(urllib\.request|requests|http\.client|socket|urlopen|aiohttp|httpx)\b/.test(src), f);
  }
});

// ══════════ 10. SOFTWARE / AI ADJUDICATION AND THE RESERVE CANDIDATE SET ════

Deno.test("adjudication: 50 companies, every quote verbatim, every cell in group A, B (decision) or C (not determinable)", async () => {
  const base = new URL("../_eval/v2/real/", import.meta.url);
  const adj = JSON.parse(await Deno.readTextFile(new URL("adjudication-sw-ai.json", base))) as Array<Record<string, unknown>>;
  assertEquals(adj.length, 50);
  for (const a of adj) {
    for (const [v, g] of [[a.software_product, a.sw_group], [a.ai_product, a.ai_group]] as const) {
      const expected = String(v).startsWith("DECISION") ? "B" : v === "NOT_DETERMINABLE" ? "C" : "A";
      assertEquals(g, expected, String(a.company));
      assert(["YES", "NO", "NOT_DETERMINABLE"].includes(String(v)) || String(v).startsWith("DECISION:"), String(v));
    }
  }
});

Deno.test("reserve candidates: adjudicated not frozen, outside the 50, never vetoed or non-commercial, needs met in HIGH labels", async () => {
  const base = new URL("../_eval/v2/real/", import.meta.url);
  const r = JSON.parse(await Deno.readTextFile(new URL("reserve-candidates.json", base)));
  const adj = JSON.parse(await Deno.readTextFile(new URL("adjudication-sw-ai.json", base))) as Array<{ company: string }>;
  const primary = new Set(adj.map((a) => a.company.toLowerCase()));
  const vetoed = new Set((r.vetoed_in_order as Array<{ company: string }>).map((v) => v.company));
  const nonCommercial = new Set((r.non_commercial_skipped as Array<{ company: string }>).map((v) => v.company));
  assertEquals(r.unfilled, [0, 0, 0, 0]);
  for (const c of r.candidates as Array<Record<string, string>>) {
    assertEquals(c.status, "ADJUDICATED_NOT_FROZEN");
    assertFalse(primary.has(c.company.toLowerCase()), c.company);
    assertFalse(vetoed.has(c.company) || nonCommercial.has(c.company), c.company);
    assert(["HIGH", "NOT_DETERMINABLE"].includes(c.software_status) && ["HIGH", "NOT_DETERMINABLE"].includes(c.ai_status), `${c.company}: no REVIEW cell remains`);
    for (const q of [c.software_evidence, c.ai_evidence]) if (q) assert(c.description.includes(q), `${c.company}: ${q}`);
  }
  assertEquals(r.candidates.length, 32);
  // The user's resolutions (Q-A, Q-B, Effective AI) are recorded next to the selection-time status.
  const resolved = Object.fromEntries((r.candidates as Array<Record<string, string>>).filter((c) => c.ai_resolution || c.software_resolution)
    .map((c) => [c.company, c.ai_resolution ? `ai ${c.ai_at_selection}→${c.ai_product}` : `sw ${c.software_at_selection}→${c.software_product}`]));
  assertEquals(resolved, {
    "GitHub": "ai YES/REVIEW→YES", "Barracuda": "ai YES/REVIEW→YES", "Ruley, the E-Referee": "ai YES/REVIEW→YES", "Datatruck": "ai YES/REVIEW→YES",
    "mlpal": "ai YES/REVIEW→YES", "Kestra": "ai YES/REVIEW→NO", "Effective AI": "sw YES/REVIEW→YES",
  });
});

Deno.test("gate set: only HIGH real commercial cells count; held-out has >= 15/15 per facet; the split recomputes identically", async () => {
  const base = new URL("../_eval/v2/real/", import.meta.url);
  const g = JSON.parse(await Deno.readTextFile(new URL("gate-set-sw-ai.json", base)));
  const res = JSON.parse(await Deno.readTextFile(new URL("reserve-candidates.json", base)));
  const nonCommercial = new Set((res.non_commercial_skipped as Array<{ company: string }>).map((v) => v.company));
  const rows = g.companies as Array<{ company: string; key: string; software_product: string | null; ai_product: string | null; split: string }>;
  assertEquals(g.counts.software_product.total, { YES: 37, NO: 30 });
  assertEquals(g.counts.ai_product.total, { YES: 35, NO: 47 });
  assertEquals(rows.length, 82);
  // Only NOT_DETERMINABLE cells are left out — no REVIEW cell remains.
  for (const x of g.excluded as Array<{ software: string; ai: string }>) {
    assertFalse(/REVIEW/.test(`${x.software} ${x.ai}`), JSON.stringify(x));
    assert(/NOT_DETERMINABLE|EXCLUDED \(contract: platform-only guard/.test(`${x.software} ${x.ai}`), JSON.stringify(x));
  }
  for (const f of ["software_product", "ai_product"] as const) {
    assert(g.counts[f].total.YES >= 30 && g.counts[f].total.NO >= 30, f);
    assert(g.counts[f].heldout.YES >= 15 && g.counts[f].heldout.NO >= 15, `${f} held-out`);
  }
  for (const r of rows) assertFalse(nonCommercial.has(r.company), r.company);
  // Recompute the split here, independently of the Python that wrote it.
  const hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const strata = new Map<string, Array<{ key: string; h: string }>>();
  for (const r of rows) {
    const k = `${r.software_product ?? "-"}|${r.ai_product ?? "-"}`;
    strata.set(k, [...(strata.get(k) ?? []), { key: r.key, h: await hex(r.key) }]);
  }
  const expected = new Map<string, string>();
  for (const group of strata.values()) {
    group.sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0)).forEach((x, i) => expected.set(x.key, i % 2 === 0 ? "heldout" : "tune"));
  }
  for (const r of rows) assertEquals(r.split, expected.get(r.key), r.company);
  const assignment = [...rows].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((r) => `${r.key}\t${r.split}`).join("\n");
  assertEquals(await hex(assignment), g.split_sha256, "the recorded split hash matches");
  assertEquals(g.created_before_model_results, true);
});

// ══════════ 11. THE REAL FIXTURES THE LIVE RUN JUDGES, AND THE FREEZE ════════

Deno.test("real fixtures: the gate set's 82 companies, its HIGH labels and its split; each supporting phrase sits in one evidence line", () => {
  assertEquals(REAL_V2.length, 82);
  assertEquals(BENCHMARK_V2_FIXTURES.length, 82 + ALL_V2.length);
  assert(BENCHMARK_V2_FIXTURES.filter((f) => !f.id.startsWith("real:")).every((f) => f.split === "dev"));
  assertEquals(new Set(BENCHMARK_V2_FIXTURES.map((f) => f.id)).size, BENCHMARK_V2_FIXTURES.length);
  for (const f of REAL_V2) {
    assert(f.split === "tune" || f.split === "heldout", f.id);
    assert(f.scored!.length > 0 && f.scored!.every((d) => d === "software_product" || d === "ai_product"), f.id);
    const doc = docOf(f);
    for (const phrases of Object.values(f.expected_citations ?? {})) {
      for (const q of phrases ?? []) assert(doc.lines.some((l) => l.text.includes(q)), `${f.id}: ${q}`);
    }
  }
});

/** Answers each REAL fixture's labels, citing the line that holds its supporting phrase. */
const realOracle: V2Judge = (doc) => {
  const f = REAL_V2.find((x) => x.evidence.company_key === doc.company_key)!;
  const cite = (j: "ai_product" | "primary_offering") => {
    const w = f.expected_citations?.[j];
    return w ? doc.lines.find((l) => w.some((n) => l.text.includes(n)))!.label : "NONE";
  };
  return Promise.resolve({
    ok: true, model: "oracle", latency_ms: 5, telemetry: null, request_id: null,
    raw: {
      presence: { business_customer: { p_true: 0.05 }, consumer_customer: { p_true: 0.05 }, ai_product: { p_true: f.labels.ai_product ? 0.9 : 0.05 } },
      primary_offering: { choice: f.labels.primary_offering, probabilities: { [f.labels.primary_offering]: 0.9 } },
      delivery_model: { choice: "not_stated", probabilities: { not_stated: 0.9 } },
      citations: { business_customer: "NONE", consumer_customer: "NONE", ai_product: cite("ai_product"), primary_offering: cite("primary_offering"), delivery_model: "NONE" },
      injection: Object.fromEntries(doc.sources.map((s) => [s.source, 0.02])),
    },
  });
};

Deno.test("real fixtures are gate-able: an oracle passes both candidate gates end to end; unlabelled decisions never score a real fixture", async () => {
  const records = await runV2({ fixtures: REAL_V2, arms: [judgeArmV2("oracle", realOracle)], repeats: 2 });
  // A current grounder that is right everywhere — the oracle must still match it.
  for (const f of REAL_V2) for (let r = 0; r < 2; r++) {
    records.push({ arm: "current_grounder", fixture_id: f.id, repeat: r, ok: true, failure: null, raw: null, current: f.labels, latency_ms: 1, cost_usd: 0, model: null });
  }
  const a = analyzeV2({ records, fixtures: REAL_V2, arms: ["current_grounder", "oracle"] });
  for (const d of GATE_FACETS) assert(a.gates[`oracle.${d}`].passed, `${d}: ${JSON.stringify(a.gates[`oracle.${d}`].checks)}`);
  const held = a.scores.oracle.heldout;
  assertEquals([held.decisions.software_product.real_positives, held.decisions.software_product.real_negatives], [19, 16]);
  assertEquals([held.decisions.ai_product.real_positives, held.decisions.ai_product.real_negatives], [19, 24]);
  const tune = a.scores.oracle.tune;
  assertEquals([tune.decisions.software_product.real_positives, tune.decisions.software_product.real_negatives], [18, 14]);
  assertEquals([tune.decisions.ai_product.real_positives, tune.decisions.ai_product.real_negatives], [16, 23]);
  for (const d of DECISIONS.filter((x) => x !== "software_product" && x !== "ai_product")) {
    assertEquals(held.decisions[d].positives + held.decisions[d].negatives, 0, d);
  }
  assertEquals([held.primary_accuracy, held.delivery_accuracy], [null, null], "category accuracy never uses placeholder labels");
  assertEquals([held.citations.invalid, held.citations.policy_refused, tune.citations.invalid, tune.citations.policy_refused], [0, 0, 0, 0]);
});

Deno.test("software contract exclusions are exactly the HIGH software YES cells whose supporting line the platform-only guard refuses", async () => {
  const g = JSON.parse(await Deno.readTextFile(new URL("../_eval/v2/real/gate-set-sw-ai.json", import.meta.url)));
  const ev = JSON.parse(await Deno.readTextFile(new URL("../_eval/v2/real/gate-evidence-sw-ai.json", import.meta.url)));
  const excluded = g.software_contract_excluded as Array<{ company: string; supporting_line_phrase: string }>;
  assertEquals(excluded.map((x) => x.company).sort(), ["Braintrust", "Effective AI", "Quartzy", "Structured AI", "Workday", "mlpal"]);
  const lineOf = (company: string, phrase: string) => {
    const e = (ev.companies as Array<{ company: string; key: string }>).find((x) => x.company === company)!;
    const f = REAL_V2.find((x) => x.evidence.company_key === e.key || x.id === `real:${e.key}`)!;
    return docOf(f).lines.find((l) => l.text.includes(phrase))!.text;
  };
  for (const x of excluded) assert(isPlatformOnly(lineOf(x.company, x.supporting_line_phrase)), x.company);
  for (const f of REAL_V2.filter((x) => x.scored!.includes("software_product") && x.labels.primary_offering === "software_product")) {
    const phrase = f.expected_citations!.primary_offering![0];
    assertFalse(isPlatformOnly(docOf(f).lines.find((l) => l.text.includes(phrase))!.text), f.id);
  }
  for (const x of excluded) {
    const f = REAL_V2.find((r) => r.notes!.includes(`: ${x.company}.`))!;
    assertEquals(f.scored, ["ai_product"], x.company);
  }
});

Deno.test("invalid citations count integrity failures only; pricing-only / platform-only refusals are reported, not invalid", async () => {
  const f = fx("vague_platform");
  const j: V2Judge = (doc) => Promise.resolve({ ok: true, model: "x", latency_ms: 1, telemetry: null, request_id: null,
    raw: raw(doc, { business: 0.9, primary: "software_product", cite: { business_customer: "revenue teams", primary_offering: "platform" } }) });
  const bad: V2Judge = (doc) => Promise.resolve({ ok: true, model: "x", latency_ms: 1, telemetry: null, request_id: null,
    raw: raw(doc, { business: 0.9, cite: { business_customer: "S99" } }) });
  const records = await runV2({ fixtures: [f], arms: [judgeArmV2("policy", j), judgeArmV2("bad", bad)], repeats: 1 });
  const p = scoreV2({ records, fixtures: [f], arm: "policy" }).citations;
  assertEquals([p.invalid, p.policy_refused], [0, 1]);
  const b = scoreV2({ records, fixtures: [f], arm: "bad" }).citations;
  assertEquals([b.invalid, b.policy_refused], [1, 0]);
  assertEquals([...POLICY_REFUSALS].sort(), ["platform_only_support", "pricing_only_support"]);
});

Deno.test("spend guard: a run starts only if the worst case stays under the ceiling; an unmetered run is charged the bound", () => {
  const g = new SpendGuard(0.05, 0.01);
  assert(g.canStart());
  g.settle([0.004]); g.settle([0.002, 0.001]);
  assertEquals(g.report().unmetered_runs, 0);
  g.settle([]); g.settle([0.003, null]);
  assertEquals(g.report().unmetered_runs, 2);
  assert(Math.abs(g.upperBoundUsd - (0.004 + 0.003 + 0.003 + 0.02)) < 1e-12);
  assert(g.canStart(), "0.030 + 0.01 <= 0.05");
  g.settle([0.011]);
  assertFalse(g.canStart(), "0.041 + 0.01 > 0.05");
  assertEquals(RUN_COST_BOUND_USD, 0.01);
});

Deno.test("live runner: refuses without the LIVE flag, verifies every frozen hash and pins its config before any arm exists", async () => {
  const src = await Deno.readTextFile(new URL("../_eval/v2/run.ts", import.meta.url));
  const at = (s: string) => { const i = src.indexOf(s); assert(i >= 0, s); return i; };
  assert(at('Deno.env.get("FACET_BENCHMARK_V2_LIVE") !== "1"') < at("await Deno.readFile(new URL(MANIFEST_PATH"));
  assert(at("verifyFrozen(") < at("const arms: Arm[]"));
  assert(at("disagree(\"FACET_BENCHMARK_GPT_MODEL\"") < at("const arms: Arm[]"));
  assert(at("guard.canStart()") < at("await arm.run("));
  assertFalse(/console\.(log|error)\([^)]*API_KEY\b[^"]*\)/.test(src.replace(/"[A-Z_]*API_KEY is not set"/g, "")), "never prints a key");
  const root = new URL("../../../", import.meta.url);
  const path = "tests/edge-functions/_eval/v2/contract.ts";
  const want = await sha256(new URL(path, root));
  assertEquals(await verifyFrozen({ [path]: want }, root), []);
  assertEquals(await verifyFrozen({ [path]: want.replace(/^./, (c) => (c === "0" ? "1" : "0")) }, root), [path], "a changed file is drift");
  assertEquals(await verifyFrozen({ "tests/edge-functions/_eval/v2/no-such-file.ts": want }, root), ["tests/edge-functions/_eval/v2/no-such-file.ts"]);
});

Deno.test("Benchmark V2 is frozen: every frozen input matches its hash, and the manifest matches the gate set", async () => {
  const root = new URL("../../../", import.meta.url);
  const m = JSON.parse(await Deno.readTextFile(new URL("tests/edge-functions/_eval/baselines/benchmark-v2/freeze-manifest.json", root)));
  assertEquals(m.created_before_model_results, true);
  assertEquals(m.companies.final_real_companies, 82);
  assertEquals(m.split.sha256, GATE_SPLIT_SHA256);
  assertEquals(m.scored_cells.total, { software_product: { YES: 37, NO: 30 }, ai_product: { YES: 35, NO: 47 } });
  assertEquals(m.run.repeats, 5);
  assertEquals(m.run.jev.model, "jev-1.13.0");
  const owned = Object.keys(m.frozen_inputs);
  for (const must of ["contract.ts", "judges.ts", "fixtures.ts", "realFixtures.ts", "benchmark.ts", "analyze.ts", "run.ts", "runGuards.ts",
    "real/gate-set-sw-ai.json", "real/gate-evidence-sw-ai.json", "real/reserve-candidates.json", "real/adjudication-sw-ai.json"]) {
    assert(owned.includes(`tests/edge-functions/_eval/v2/${must}`), must);
  }
  assertEquals(await verifyFrozen(m.frozen_inputs, root), [], "a frozen V2 input changed");
});
