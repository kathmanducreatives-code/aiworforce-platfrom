// FLEXIBLE DISCOVERY (pilot 2026-11-23): relaxes only industry and excluded company types,
// GPT's related industries are validated and replayed, and every company's tier rests on
// evidence already gathered — an industry is never "verified" by a label.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  cleanRelated, expandIndustries, matchOf, readIndustryMap, relaxForFlexible, type IndustryMap,
} from "../../../../supabase/functions/_shared/leadPipeline/flexibleDiscovery.ts";
import type { DiscoverySpec } from "../../../../supabase/functions/_shared/leadPipeline/strategy.ts";
import type { PipelineLead } from "../../../../supabase/functions/_shared/leadPipeline/pipeline.ts";
import { handleStrategyRequest, parseStrategyRequest } from "../../../../supabase/functions/_shared/leadPipeline/service.ts";

const group = ["commercial contracting", "manufacturing"];
const crit = (o: Record<string, unknown>) => ({ status: "ok", label: String(o.dimension), ...o }) as never;
const spec = (): DiscoverySpec => ({
  industry: group, requirements: {
    criteria: [
      crit({ id: "geo", kind: "hard", dimension: "geography", value: "united states" }),
      crit({ id: "hire", kind: "hard", dimension: "hiring", value: "account executive" }),
      ...group.map((v, i) => crit({ id: `ind${i}`, kind: "hard", dimension: "industry", value: v, label: "Industry: commercial contracting or manufacturing", any_of: group })),
      crit({ id: "excl", kind: "hard", dimension: "exclusion", label: "Excluding: consumer", value: { field: "excluded_company_types", value: ["consumer"] } }),
      crit({ id: "excl-geo", kind: "hard", dimension: "exclusion", label: "Excluding: Canada", value: { field: "excluded_geographies", value: ["Canada"] } }),
      crit({ id: "bm", kind: "hard", dimension: "business_model", value: "B2B" }),
    ],
    hard: [{ criterionId: "ind0", key: "industry", values: ["commercial contracting"], label: "Industry", representable: true }],
    preferences: [],
  },
}) as unknown as DiscoverySpec;
const MAP: IndustryMap = { requested: group, related: ["Construction", "Wholesale"], source: "model", model: "m", error: null };

Deno.test("FLEXIBLE: only industry and excluded company types are relaxed — geography, hiring, geography exclusions and a required business model still gate", () => {
  const { spec: s, relaxed } = relaxForFlexible(spec(), MAP);
  const kind = Object.fromEntries(s.requirements.criteria.map((c) => [c.id, c.kind]));
  assertEquals(kind, { geo: "hard", hire: "hard", ind0: "target", ind1: "target", excl: "target", "excl-geo": "hard", bm: "hard" });
  assertEquals(relaxed.map((r) => r.label), ["Industry: commercial contracting or manufacturing", "Excluding: consumer"], "a group is listed once");
  assertEquals(s.requirements.hard.length, 0, "the relaxed industry leaves the provider-facing hard list");
  assertEquals(s.requirements.preferences.map((p) => p.criterionId), ["ind0"]);
  assertEquals(s.flexible?.industries.related, ["Construction", "Wholesale"]);
  assertEquals(spec().requirements.criteria.every((c) => c.kind === "hard"), true, "the input spec is not mutated");
});

Deno.test("FLEXIBLE: GPT's related industries are validated — no companies, no prose, no duplicates, at most 12", () => {
  assertEquals(cleanRelated(["Construction", "construction", "manufacturing", "Acme Corp is great; buy now!!!", 42, "", "Wholesale"], group),
    ["Construction", "Wholesale"]);
  assertEquals(cleanRelated(Array.from({ length: 20 }, (_, i) => `Industry ${String.fromCharCode(65 + i)}`), group).length, 12);
  assertEquals(readIndustryMap({ related: ["Construction", "<script>"], source: "model", model: "m" }, group).related, ["Construction"], "a replayed list is re-validated");
});

Deno.test("FLEXIBLE: without a model, or when it fails, only the requested industries are matched (never invented)", async () => {
  assertEquals((await expandIndustries(group, null)).related, []);
  const failing = (() => Promise.resolve({ ok: false, content: "", error: "boom", model: "m" })) as never;
  const r = await expandIndustries(group, failing);
  assertEquals([r.related, r.error], [[], "boom"]);
});

const lead = (o: { checks?: { dimension: string; result: string; url?: string }[]; industry?: string[]; bm?: string | null; jobs?: number; country?: string | null; desc?: string }): PipelineLead => ({
  leadKey: "k", company: { key: "k", name: "Co", domain: "co.example", linkedinUrl: "https://www.linkedin.com/company/co", providerCompanyIds: [], employeeCount: 50,
    industry: o.industry ?? [], hq: { country: o.country === undefined ? "United States" : o.country, region: null, city: null, source: null }, description: o.desc ?? null },
  qualification: { checks: (o.checks ?? []).map((c, i) => ({ criterion_id: `c${i}`, dimension: c.dimension, result: c.result, reason: "r", actor: "a",
    ...(c.url ? { evidence: [{ evidence_id: `e${i}`, actor: "a", url: c.url, observed_at: "2026-11-23T00:00:00Z", occurred_at: null }] } : {}) })), gaps: [], disproven: [], evidence_sources: {} },
  signals: Array.from({ length: o.jobs ?? 0 }, (_, i) => ({ type: "hiring", sourceUrl: `https://www.linkedin.com/jobs/view/${i}` })),
  ...(o.bm ? { businessModel: { companyKey: "k", status: o.bm, quote: "q", url: "https://co.example/", fetchedAt: null, reason: "" } } : {}),
}) as unknown as PipelineLead;
const VERIFIED = [{ dimension: "geography", result: "pass", url: "https://www.linkedin.com/company/co" }, { dimension: "hiring", result: "pass", url: "https://www.linkedin.com/jobs/view/1" }];

Deno.test("FLEXIBLE tiers: strong / close / exploratory / insufficient, each attribute verified, inferred or unknown", () => {
  const strong = matchOf(lead({ checks: VERIFIED, industry: ["Manufacturing"], bm: "verified_b2b" }), MAP);
  assertEquals([strong.tier, strong.attributes.industry.status, strong.attributes.hiring.status, strong.attributes.business_model.status], ["strong", "inferred", "verified", "verified"]);
  assert(strong.sources.includes("https://www.linkedin.com/jobs/view/1") && strong.sources.includes("https://co.example/"));

  const close = matchOf(lead({ checks: VERIFIED, industry: ["Construction"] }), MAP);
  assertEquals([close.tier, close.attributes.industry.value.startsWith("related"), close.attributes.business_model.status], ["close", true, "unknown"]);

  const software = matchOf(lead({ checks: VERIFIED, industry: ["Software Development"], bm: "verified_b2b" }), MAP);
  assertEquals([software.tier, software.attributes.industry.status], ["exploratory", "unknown"]);

  const consumer = matchOf(lead({ checks: [...VERIFIED, { dimension: "exclusion", result: "fail" }], industry: ["Manufacturing"], bm: "not_b2b" }), MAP);
  assertEquals([consumer.tier, consumer.attributes.consumer_only.status], ["exploratory", "verified"], "consumer-only is ranked last, not removed");

  // Sales hiring that did not pass the check is INFERRED, never verified.
  const related = matchOf(lead({ checks: [VERIFIED[0], { dimension: "hiring", result: "unknown" }], industry: ["Manufacturing"], bm: "likely_b2b", jobs: 1 }), MAP);
  assertEquals([related.tier, related.attributes.hiring.status], ["close", "inferred"]);

  const thin = matchOf(lead({ checks: [{ dimension: "geography", result: "unknown" }], industry: ["Manufacturing"] }), MAP);
  assertEquals([thin.tier, thin.attributes.headquarters.status, thin.attributes.hiring.status], ["insufficient", "inferred", "unknown"]);
});

Deno.test("FLEXIBLE request: only 'strict' or 'flexible' is accepted; absent stays strict", () => {
  const b = { action: "strategy_plan", workspace_id: "w", walk_id: "walk", query: "q" };
  assertEquals(parseStrategyRequest(b)?.mode, undefined);
  assertEquals(parseStrategyRequest({ ...b, discovery_mode: "strict" })?.mode, undefined);
  assertEquals(parseStrategyRequest({ ...b, discovery_mode: "flexible" })?.mode, "flexible");
  assertEquals(parseStrategyRequest({ ...b, discovery_mode: "loose" }), null);
  assert(typeof handleStrategyRequest === "function");
});
