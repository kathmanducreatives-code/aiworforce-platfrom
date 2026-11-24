// PROVIDER COMPARISON — Apify only vs LeadOcean only vs both CONCURRENTLY, one mission.
//
//   deno run --allow-read --allow-write --allow-env scripts/dev/provider-comparison.ts [--out docs/benchmarks/provider-comparison]
//
// OFFLINE and recorded: the real mission compiler (v1 and contract v3), strategy planner,
// approval check, multi-provider executor, durable ledger (memory), cross-provider merge and
// shared qualification engine run against SYNTHETIC provider responses (`.example`
// companies, no real company or person, no contact value); the network is blocked. It
// measures how each provider mode serves the SAME mission, and what each contributes.
//
// The world (ground truth stated before the run):
//   Apify job search  Northwind, Quartz (Account Executive, US, recent)      → should qualify
//                     Maple (AE, but HQ Toronto)                               → contradiction: rejected
//                     Glowcart (only an SDR posting — the excluded role)       → never qualifies
//                     Harbor (AE, no company record)                           → pending
//                     Apex (staffing agency), Shopco (stale posting)           → dropped
//   LeadOcean people  Northwind, Quartz (also found by Apify)                  → one company each
//                     Cobalt Desk, Pinecrest (LeadOcean only; no job evidence) → pending: hiring unproven
//                     Pinecrest's headcount claim contradicts its company record (the engine's evidence)
//                     LeadOcean's industry for Northwind disagrees with Apify's   → provider conflict kept
// LeadOcean has no hiring data (docs/PROVIDER_CAPABILITIES.md), so on a hiring mission it can
// contribute candidates, never qualified companies, on its own.

import { LO_PEOPLE, RECORDS, runScenario, type RunRecord, type Scenario } from "./discovery-benchmark.ts";
import { companyRecord } from "../../tests/edge-functions/_shared/leadPipeline/fixtures.ts";
import type { DiscoveryStrategyId } from "../../supabase/functions/_shared/leadPipeline/strategy.ts";
import { type ProviderRunSummary, summarizeProviderRun } from "../../supabase/functions/_shared/leadPipeline/providerRunSummary.ts";

export const MISSION = "Find US B2B companies actively hiring Account Executives, excluding SDRs.";
export const TRUTH_QUALIFIED = ["northwind.example", "quartzlabs.example"];

// ── The recorded world (this process only: the benchmark's own baseline is untouched) ──
const p = (id: string, name: string, title: string, company: string, domain: string, employees: number, industry = "Software Development") =>
  ({ id, name, title, company, domain, industry, employees });
LO_PEOPLE.comparison = [
  p("9001", "Mia Hart", "Founder & CEO", "Northwind Ledger", "northwind.example", 80, "Financial Services"), // disagrees with Apify's industry: a conflict to keep
  p("9002", "Noah Bell", "CEO", "Quartz Labs", "quartzlabs.example", 30),
  p("9003", "Ola Reed", "VP Sales", "Cobalt Desk", "cobaltdesk.example", 120),
  p("9004", "Pia Ford", "Head of Sales", "Cobalt Desk", "cobaltdesk.example", 120), // same employer: one company
  p("9005", "Quin Lowe", "Founder", "Pinecrest Apps", "pinecrest.example", 340), // claim contradicts the record's 11-50
];
const rec = (slug: string, name: string, city: string, band: [number, number]) =>
  companyRecord(slug, { name, website: `https://${slug}.example`, hqCountry: "US", city, band });
RECORDS.cobaltdesk ??= rec("cobaltdesk", "Cobalt Desk", "Portland", [51, 200]);
RECORDS.pinecrest ??= rec("pinecrest", "Pinecrest Apps", "Raleigh", [11, 50]);

const US = { geographies: ["United States"], hard_constraints: [{ field: "geography", operator: "in", value: ["United States"], reason: "US" }] };
const V1 = { ...US, company_types: ["B2B"], requested_opportunity_count: 5, preferred_signals: ["hiring Account Executives but not SDRs"], signal_recency_days: 30, strategies: ["hiring"] };
const V3_UNDERSTANDING = {
  roles: [{ span: "Account Executives", title: "account_executive", family: null, relation: "required" },
    { span: "excluding SDRs", title: "sales_development_representative", family: null, relation: "excluded" }],
  role_match: "any", places: [{ span: "US", place: "united states", other_place: null, scope: "headquarters", necessity: "required" }],
  industries: [], signals: [{ span: "actively hiring Account Executives", kind: "hiring", necessity: "required" }],
  signal_logic: "all", ambiguities: [], unsupported: [],
};

export const MODES: { mode: string; strategy: DiscoveryStrategyId; allowReviewOnly?: boolean }[] = [
  { mode: "Apify only", strategy: "apify_only" },
  // LeadOcean cannot prove hiring: the planner refuses it for this mission unless review-only
  // candidates are explicitly allowed. Stated, never implied.
  { mode: "LeadOcean only", strategy: "leadocean_only", allowReviewOnly: true },
  { mode: "Concurrent", strategy: "apify_leadocean_concurrent" },
];

function scenario(m: typeof MODES[number], contract: "v1" | "v3"): Scenario {
  return {
    id: `PC-${m.strategy}-${contract}`, group: "X", title: m.mode, request: MISSION, count: 5, strategy: m.strategy,
    proposal: V1, people: "comparison" as never, allowReviewOnly: m.allowReviewOnly, contract, understanding: V3_UNDERSTANDING,
    truthQualified: TRUTH_QUALIFIED,
    // One ceiling for every mode, large enough that no provider's result set is cut: the
    // comparison measures the providers, not the budget (offline: nothing is spent).
    budget: { maxLeadoceanRecords: 20, maxApifyUsd: 0.25 },
    spec: { hard: ["US headquarters", "B2B", "hiring Account Executives (≤30 days)", "never SDR"], preferences: [], verification: [],
      providers: m.mode, expected: "Northwind and Quartz qualify; nothing else does", pass: "precision 1.0" },
    check: () => ({ pass: true, detail: "" }),
  };
}

export interface ModeResult {
  mode: string; strategy: string; contract: string;
  planStatus: string; planBlockedReason: string | null; hardRequirements: string[]; searchedTitles: string[];
  rawRecords: { apifyJobRows: number; apifyCompanyRecords: number; leadoceanRecords: number };
  uniqueCompanies: number; qualified: number; pending: number; rejected: number;
  verifiedEvidenceCoverage: number | null; duplicateRate: number | null;
  companies: { domain: string | null; verdict: string; sources: string[]; gaps: string[] }[];
  falseQualified: string[]; missedQualified: string[];
  apiFailures: string[]; runtimeMs: number; costApifyUsd: number; leadoceanRecords: number; costPerQualifiedUsd: number | null;
  conflicts: string[];
  /** The same per-provider summary the strategy_run response carries (dashboard numbers). */
  summary: ProviderRunSummary | null;
}

export async function compare(contract: "v1" | "v3" = "v3"): Promise<ModeResult[]> {
  const out: ModeResult[] = [];
  for (const m of MODES) {
    const r: RunRecord = await runScenario(scenario(m, contract), { walkId: `pc-${m.strategy}-${contract}` });
    const raw = {
      apifyJobRows: r.providerCalls.filter((c) => c.capability.includes("job")).reduce((n, c) => n + c.items, 0),
      apifyCompanyRecords: r.providerCalls.filter((c) => c.capability.includes("company_record") || c.capability.includes("company_details")).reduce((n, c) => n + c.items, 0),
      leadoceanRecords: r.leadoceanRecords,
    };
    const rawRows = raw.apifyJobRows + raw.leadoceanRecords;
    const companies = r.companies.map((c) => ({ domain: c.domain, verdict: c.verdict, sources: [...c.sources].sort(), gaps: c.gaps }));
    const verified = r.companies.filter((c) => c.evidence.some((e) => /company_details|company_record|job_search/.test(e))).length;
    const conflicts = (r.run?.queue ?? []).concat(r.run?.review ?? [], r.run?.excluded ?? [])
      .flatMap((l) => (l.qualification?.checks ?? []).filter((k) => /conflict|contradict/i.test(k.reason)).map((k) => `${l.company.domain}: ${k.reason.slice(0, 120)}`));
    out.push({
      mode: m.mode, strategy: m.strategy, contract, planStatus: r.planStatus, planBlockedReason: r.planBlockedReason,
      hardRequirements: r.hardRequirements, searchedTitles: r.searchedTitles, rawRecords: raw,
      uniqueCompanies: r.uniqueCompanies, qualified: r.qualified, pending: r.review, rejected: r.rejected,
      verifiedEvidenceCoverage: r.uniqueCompanies ? Math.round((verified / r.uniqueCompanies) * 100) / 100 : null,
      duplicateRate: rawRows ? Math.round((1 - r.uniqueCompanies / Math.max(rawRows, r.uniqueCompanies)) * 100) / 100 : null,
      companies, falseQualified: r.falseQualified, missedQualified: r.missedQualified,
      apiFailures: [...r.errors, ...(r.run?.steps ?? []).filter((x) => x.status === "failed").map((x) => `${x.capability}: ${x.reason}`)],
      runtimeMs: r.runtimeMs, costApifyUsd: r.costUsd.apify, leadoceanRecords: r.leadoceanRecords, costPerQualifiedUsd: r.costPerQualifiedUsd,
      conflicts, summary: r.run ? summarizeProviderRun(r.run) : null,
    });
  }
  return out;
}

/** Who found what: Apify-only, LeadOcean-only, both, and what each contributed beyond the other. */
export function overlap(results: ModeResult[]) {
  const set = (mode: string, pred: (c: ModeResult["companies"][number]) => boolean = () => true) =>
    new Set(results.find((x) => x.mode === mode)!.companies.filter(pred).map((c) => c.domain ?? "?"));
  const a = set("Apify only"), l = set("LeadOcean only"), combined = results.find((x) => x.mode === "Concurrent")!;
  const by = (src: string) => new Set(combined.companies.filter((c) => c.sources.some((s) => s.includes(src))).map((c) => c.domain ?? "?"));
  const ca = by("apify"), cl = by("leadocean");
  const qualified = set("Concurrent", (c) => c.verdict === "qualified");
  const qa = set("Apify only", (c) => c.verdict === "qualified"), ql = set("LeadOcean only", (c) => c.verdict === "qualified");
  return {
    apifyOnly: [...ca].filter((d) => !cl.has(d)).sort(), leadoceanOnly: [...cl].filter((d) => !ca.has(d)).sort(),
    both: [...ca].filter((d) => cl.has(d)).sort(), totalUnique: combined.uniqueCompanies,
    standalone: { apify: [...a].sort(), leadocean: [...l].sort() },
    additionalQualified: { byApify: [...qualified].filter((d) => !ql.has(d)).sort(), byLeadOcean: [...qualified].filter((d) => !qa.has(d)).sort() },
  };
}

if (import.meta.main) {
  const outArg = Deno.args.indexOf("--out");
  const out = outArg >= 0 ? Deno.args[outArg + 1] : "docs/benchmarks/provider-comparison";
  const v3 = await compare("v3"), v1 = await compare("v1");
  const report = { mission: MISSION, truthQualified: TRUTH_QUALIFIED, v3, v1, overlap: overlap(v3),
    contractsAgree: JSON.stringify(v3.map((x) => x.companies)) === JSON.stringify(v1.map((x) => x.companies)) };
  await Deno.mkdir(out, { recursive: true });
  const strip = (r: ModeResult[]) => r.map(({ runtimeMs: _t, ...x }) => x); // runtime varies run to run: reported, not recorded
  await Deno.writeTextFile(`${out}/comparison.json`, JSON.stringify({ ...report, v3: strip(v3), v1: strip(v1) }, null, 1) + "\n");
  console.log(JSON.stringify(report.overlap));
  for (const r of v3) console.log(`${r.mode.padEnd(15)} plan=${r.planStatus} unique=${r.uniqueCompanies} qualified=${r.qualified} pending=${r.pending} rejected=${r.rejected} fq=${r.falseQualified} apify=$${r.costApifyUsd} lo=${r.leadoceanRecords} failures=${r.apiFailures.length} ${r.planBlockedReason ?? ""}`);
  console.log("contracts agree (v1 vs v3):", report.contractsAgree);
}

/** The scenario builder, for the frontend test that reads a real executor run (tests/frontend/strategyDiscovery.test.ts). */
export const scenarioFor = scenario;
