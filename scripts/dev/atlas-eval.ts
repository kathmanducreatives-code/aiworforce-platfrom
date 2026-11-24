// ATLAS EVALUATION CORPUS RUNNER — labelled qualification cases through the real path.
//
//   deno run --allow-read --allow-env scripts/dev/atlas-eval.ts            # print results + metrics
//
// Corpus: tests/fixtures/atlas-eval/v1/corpus.json (labels written from meaning and the
// owner's policy, never from code output). Every case runs PRODUCTION code end to end:
//
//   geography  request → compileLeadMission (criterion, HQ scope) → Apify company record
//              → readCompanyRecords (the production normaliser + evidence) →
//              evaluateEligibility → the geography check's result
//   titles     request + recorded model reading → compileLeadMission → specFromMission →
//              discoverHiringCompanies (the job-discovery role filter) with one posting →
//              evaluateEligibility on the discovered evidence → does the posting COUNT?
//
// Offline: synthetic `.example` companies, injected actor invoker, no network, no model.

import { compileLeadMission } from "../../supabase/functions/_shared/leadMissionCompiler.ts";
import { evaluateEligibility } from "../../supabase/functions/_shared/candidateEligibility.ts";
import { buildCompanyEvidenceGraph } from "../../supabase/functions/_shared/evidenceGraph.ts";
import type { ActorInvoker } from "../../supabase/functions/_shared/discoveryProviders/adapters/apify.ts";
import { readCompanyRecords } from "../../supabase/functions/_shared/leadPipeline/canonical.ts";
import { discoverHiringCompanies } from "../../supabase/functions/_shared/leadPipeline/apifyDiscovery.ts";
import { discoveryJobTitles, specFromMission } from "../../supabase/functions/_shared/leadPipeline/strategy.ts";

const ROOT = new URL("../../", import.meta.url);
export const CORPUS_PATH = "tests/fixtures/atlas-eval/v1/corpus.json";
const NOW = new Date("2026-11-01T12:00:00Z");

export interface GeoCase { id: string; required: string; hq: string | null; expect: "pass" | "fail" | "unknown" | "not_pass"; defect?: string }
export interface TitleCase { id: string; request: string; terms?: string[]; phrase?: string; posting: string; expect: "counts" | "excluded"; defect?: string; masked_by?: string; note?: string }
export interface Corpus { version: string; geography: GeoCase[]; titles: TitleCase[] }
export interface CaseResult { id: string; suite: "geography" | "titles"; expect: string; actual: string; ok: boolean; defect: string | null; maskedBy?: string | null; detail: string }

export const loadCorpus = (): Corpus => JSON.parse(Deno.readTextFileSync(new URL(CORPUS_PATH, ROOT)));

const BLANK = {
  requested_opportunity_count: 3, requested_contact_ready_count: null, company_types: [], geographies: [], employee_range: { min: null, max: null },
  decision_maker_roles: [], hard_constraints: [], soft_preferences: [], preferred_signals: [], adjacent_signals: [], excluded_signals: [],
  allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } }, disallowed_broadening: [],
  required_evidence: [], required_capabilities: [], preferred_source_strategy: [], evaluation_instructions: "", founder_unlock_recommended: false,
  confidence: 0.85, unknowns: [], known_companies: [], signal_recency_days: 30, required_signal_terms: [], no_broadening_requested: false,
  geography_is_hard: true, prohibitions: [], output_intent: "companies", strategies: [],
};
const compile = (query: string, p: Record<string, unknown>) =>
  compileLeadMission({ originalUserQuery: query, proposal: { ...BLANK, ...p } as never, requestedCount: 3 }).final_mission as unknown as Record<string, unknown>;
const criteriaOf = (m: Record<string, unknown>) => (m.criteria ?? []) as Record<string, unknown>[];

/** A harvestapi/linkedin-company record with the given HQ (null: no location at all). */
function companyRecordWith(slug: string, hq: string | null) {
  const parts = (hq ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    id: `li-${slug}`, name: `Eval ${slug}`, linkedinUrl: `https://www.linkedin.com/company/${slug}`, website: `https://${slug}.example`,
    employeeCount: 60, employeeCountRange: { start: 51, end: 200 }, companyType: "Privately Held",
    locations: hq ? [{ headquarter: true, city: parts[0] ?? null, parsed: { text: hq } }] : [],
  };
}

export async function geographyCase(c: GeoCase): Promise<CaseResult> {
  const mission = compile(`Find companies headquartered in ${c.required}.`, {
    geographies: [c.required], hard_constraints: [{ field: "geography", operator: "in", value: [c.required], reason: "stated" }],
  });
  const geo = criteriaOf(mission).filter((x) => x.dimension === "geography");
  const slug = `geo-${c.id.toLowerCase()}`;
  const invoke: ActorInvoker = () => Promise.resolve({ items: [companyRecordWith(slug, c.hq)], chargedUsd: 0.004 });
  const run = await readCompanyRecords([{ companyKey: slug, linkedinUrl: `https://www.linkedin.com/company/${slug}` }], invoke, { maxUsd: 1, now: NOW, idPrefix: "eval" });
  const graph = buildCompanyEvidenceGraph(slug, run.evidence.get(slug) ?? [], { now: NOW });
  const r = evaluateEligibility(geo as never, graph);
  const check = r.checks.find((k) => k.dimension === "geography");
  const actual = check?.result ?? "absent";
  const ok = c.expect === "not_pass" ? actual !== "pass" : actual === c.expect;
  return { id: c.id, suite: "geography", expect: c.expect, actual, ok, defect: c.defect ?? null, detail: `criterion ${JSON.stringify(geo[0]?.value)} scope ${geo[0]?.geography_scope ?? "-"}; ${check?.reason ?? "no check"}` };
}

function jobRow(title: string, slug: string) {
  return {
    id: `job-${slug}`, title, linkedinUrl: `https://www.linkedin.com/jobs/view/${slug}`, jobState: "LISTED", postedDate: "2026-10-28",
    company: {
      id: `c-${slug}`, universalName: slug, name: `Eval ${slug}`, linkedinUrl: `https://www.linkedin.com/company/${slug}`, website: `https://${slug}.example`,
      employeeCount: 60, employeeCountRange: { start: 51, end: 200 }, industries: [{ name: "Software Development" }],
      locations: [{ headquarter: true, parsed: { text: "Austin, Texas, United States" } }],
    },
    location: { linkedinText: "Austin, TX" }, descriptionText: "Hiring.",
  };
}

export async function titleCase(c: TitleCase): Promise<CaseResult> {
  const mission = compile(c.request, {
    geographies: ["United States"], hard_constraints: [{ field: "geography", operator: "in", value: ["United States"], reason: "US" }],
    preferred_signals: c.phrase ? [c.phrase] : ["hiring"], required_signal_terms: c.terms ?? [],
  });
  const spec = specFromMission(mission as never, { defaultCount: 3 });
  const slug = `t-${c.id.toLowerCase()}`;
  const invoke: ActorInvoker = () => Promise.resolve({ items: [jobRow(c.posting, slug)], chargedUsd: 0.002 });
  const d = await discoverHiringCompanies(spec, discoveryJobTitles(spec), invoke, { maxItems: 5, maxUsd: 1, now: NOW, idPrefix: "eval" });
  const evidence = d.evidence.get(slug) ?? [];
  const hiring = criteriaOf(mission).filter((x) => x.dimension === "hiring" && x.kind === "hard");
  let counts = false, why = `dropped by discovery (${JSON.stringify(d.dropped)})`;
  if (evidence.length) {
    const r = evaluateEligibility(hiring as never, buildCompanyEvidenceGraph(slug, evidence, { now: NOW }));
    const k = r.checks.find((x) => x.dimension === "hiring");
    counts = k?.result === "pass";
    why = `discovered; hiring check ${k?.result ?? "absent"} — ${k?.reason ?? ""}`;
  }
  const actual = counts ? "counts" : "excluded";
  const roles = (hiring[0]?.value as { qualifier?: unknown } | undefined)?.qualifier;
  return { id: c.id, suite: "titles", expect: c.expect, actual, ok: actual === c.expect, defect: c.defect ?? null, maskedBy: c.masked_by ?? null, detail: `${why}; requirement ${JSON.stringify(roles)}` };
}

export async function runCorpus(corpus = loadCorpus()): Promise<CaseResult[]> {
  const out: CaseResult[] = [];
  for (const c of corpus.geography) out.push(await geographyCase(c));
  for (const c of corpus.titles) out.push(await titleCase(c));
  return out;
}

/**
 * Metrics. A "positive" is a case whose label says the requirement is satisfied (geography
 * pass / title counts). False qualification = the code said satisfied where the label says
 * not; precision and recall are over the satisfied class.
 */
export function metrics(results: CaseResult[]) {
  const pos = (r: CaseResult, v: string) => r.suite === "geography" ? v === "pass" : v === "counts";
  const tp = results.filter((r) => pos(r, r.actual) && pos(r, r.expect)).length;
  const fp = results.filter((r) => pos(r, r.actual) && !pos(r, r.expect)).length;
  const fn = results.filter((r) => !pos(r, r.actual) && pos(r, r.expect)).length;
  const negatives = results.filter((r) => !pos(r, r.expect)).length;
  return {
    cases: results.length, correct: results.filter((r) => r.ok).length,
    precision: tp + fp ? Math.round((tp / (tp + fp)) * 1000) / 1000 : null,
    recall: tp + fn ? Math.round((tp / (tp + fn)) * 1000) / 1000 : null,
    falseQualificationRate: negatives ? Math.round((fp / negatives) * 1000) / 1000 : null,
    falseQualifications: results.filter((r) => pos(r, r.actual) && !pos(r, r.expect)).map((r) => r.id),
    misses: results.filter((r) => !pos(r, r.actual) && pos(r, r.expect)).map((r) => r.id),
    wrongButLabelledDefect: results.filter((r) => !r.ok && r.defect).map((r) => `${r.id}(${r.defect})`),
    wrongUnlabelled: results.filter((r) => !r.ok && !r.defect).map((r) => r.id),
    fixedButStillLabelled: results.filter((r) => r.ok && r.defect && !r.maskedBy).map((r) => `${r.id}(${r.defect})`),
  };
}

if (import.meta.main) {
  const results = await runCorpus();
  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.id} expect=${r.expect} actual=${r.actual}${r.defect ? ` [${r.defect}]` : ""} — ${r.detail.slice(0, 220)}`);
  for (const suite of ["geography", "titles"] as const) console.log(suite, JSON.stringify(metrics(results.filter((r) => r.suite === suite))));
}
