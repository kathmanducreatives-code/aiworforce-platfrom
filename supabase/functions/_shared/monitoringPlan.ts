// SIGNALS RECOVERY · MONITORING PLANS — what would be watched, before anything is.
//
// A request to monitor (a named company, or an ICP described in words) becomes a DRAFT plan:
//   target            a named company (identity from the resolver binding) or the Company Brain
//                     targeting (radarTargeting) narrowed by what the request said
//   signal categories canonical LISA types, from the request's events, else the Brain's own
//                     declared buying signals
//   sources           which kind of evidence each category needs, and whether that source is
//                     configured RIGHT NOW (never assumed)
//   frequency         once / daily / weekly (as asked; default once)
//   estimated usage   searches and credits per scan, from the real price table and scan cap
//   constraints       approval required, zero provider calls before approval, exclusions honoured
//
// A plan never runs anything. Approval and activation happen in the database
// (monitoring_plan_decide), by an owner/admin/editor. PURE: no database, no network.
import type { RequestPart, RequestV1 } from "./requestV1.ts";
import type { RadarTargeting } from "./radarScanPlanner.ts";
import { priceFor } from "./creditPricing.ts";
import { MAX_SEARCHES_PER_SCAN } from "./signalScanBudget.ts";

export const MONITORING_PLAN_VERSION = "monitoring-plan-v1" as const;

/** The canonical LISA signal categories a plan may watch. */
export const SIGNAL_CATEGORIES = [
  "hiring", "expansion", "funding", "leadership_change", "technology",
  "product_launch", "partnership", "acquisition", "pricing", "competitor",
] as const;
export type SignalCategory = typeof SIGNAL_CATEGORIES[number];

/** A workspace's own words for a buying signal → the canonical category. */
const CATEGORY_WORDS: ReadonlyArray<[SignalCategory, RegExp]> = [
  ["hiring", /\b(hir(e|es|ing)|recruit|job (opening|posting)s?|headcount|open roles?)\b/i],
  ["expansion", /\b(expan(d|ds|ding|sion)|new (site|plant|location|office|facility|market)|opens?|growth|growing)\b/i],
  ["funding", /\b(fund(ing|ed|raise)|raised|investment|series [a-e]|seed)\b/i],
  ["leadership_change", /\b(leadership|new (ceo|cfo|coo|cro|vp|head|director)|executive (change|hire)|appoint(ed|ment))\b/i],
  ["technology", /\b(technolog(y|ies)|adopt(s|ed|ion)?|implement(s|ed|ation)?|software|digital|automation|erp|crm)\b/i],
  ["product_launch", /\b(launch(es|ed)?|new product|releases?)\b/i],
  ["partnership", /\bpartner(ship|s|ed)?\b/i],
  ["acquisition", /\b(acqui(re|res|red|sition)|merger|m&a)\b/i],
  ["pricing", /\bpric(e|es|ing)\b/i],
  ["competitor", /\bcompetitor(s)?\b/i],
];
export function categoriesFrom(texts: readonly string[]): SignalCategory[] {
  const out: SignalCategory[] = [];
  for (const t of texts) for (const [c, re] of CATEGORY_WORDS) if (re.test(t) && !out.includes(c)) out.push(c);
  return out;
}

/** What evidence a category needs, and which configured source can supply it. */
export interface PlanSource { category: SignalCategory; source: string; ready: boolean; why: string }
export interface ProviderReadiness {
  /** LISA's evidence pipeline (web/news search + independent verification). */
  lisa: boolean;
  /** Job-posting collection (the shared capability engine). */
  jobs: boolean;
  /** Fixture replay only (Brain TEST / local): sources are simulated, never real evidence. */
  fixture_mode: boolean;
}
export function sourcesFor(categories: readonly SignalCategory[], r: ProviderReadiness): PlanSource[] {
  return categories.map((category): PlanSource => {
    if (category === "hiring") {
      return { category, source: "Job postings (shared capability engine)", ready: r.jobs,
        why: r.jobs ? "configured" : "no job-posting provider is configured on this project" };
    }
    return { category, source: "News, press and company pages (LISA, independently verified)", ready: r.lisa,
      why: r.lisa ? (r.fixture_mode ? "fixture replay only — not real market evidence" : "configured") : "LISA's evidence provider is not configured on this project" };
  });
}

export interface MonitoringPlanDraft {
  version: typeof MONITORING_PLAN_VERSION;
  kind: "company" | "icp";
  title: string;
  target: { label: string; identifier: string } | (Partial<RadarTargeting> & { label: string });
  signal_categories: SignalCategory[];
  sources: PlanSource[];
  frequency: "once" | "daily" | "weekly";
  estimated_usage: { scans_per_week: number; max_searches_per_scan: number; credits_per_search: number;
    max_credits_per_scan: number; max_credits_per_week: number; note: string };
  constraints: { requires_approval: true; provider_calls_before_approval: 0; respects_exclusions: string[];
    evidence_requirements: string[]; execution: string };
}

export type PlanRefusal = "not_a_monitor_request" | "no_target";

/**
 * Build the draft from the understood request, the resolver's binding for a named company (the
 * ONLY accepted identity) and the Company Brain targeting. A request with no named company is
 * an ICP plan when the Brain (or the request) describes a market; otherwise it is refused.
 */
export function buildMonitoringPlan(input: {
  request: RequestV1;
  message: string;
  /** The resolver's binding for the named company, if one resolved. */
  company?: { label: string; identifier: string } | null;
  targeting: RadarTargeting | null;
  readiness: ProviderReadiness;
}): { ok: true; plan: MonitoringPlanDraft } | { ok: false; refusal: PlanRefusal } {
  const part: RequestPart | undefined = input.request.parts.find((p) => p.objective === "monitor");
  if (!part) return { ok: false, refusal: "not_a_monitor_request" };

  const asked = categoriesFrom([
    ...(part.requirements ?? []).map((r) => `${r.event ?? ""} ${r.phrase ?? ""}`),
    input.message,
  ]);
  const declared = categoriesFrom(input.targeting?.buying_signals ?? []);
  const signal_categories = asked.length ? asked : declared.length ? declared : (["hiring", "expansion"] as SignalCategory[]);

  const frequency = /\b(daily|every day|each day)\b/i.test(input.message) ? "daily"
    : /\b(weekly|every week|each week)\b/i.test(input.message) ? "weekly" : "once";
  const scans_per_week = frequency === "daily" ? 7 : 1;
  const searches = Math.min(MAX_SEARCHES_PER_SCAN, signal_categories.length * 3);
  const credits = priceFor("signal_search");
  const estimated_usage = {
    scans_per_week, max_searches_per_scan: searches, credits_per_search: credits,
    max_credits_per_scan: searches * credits, max_credits_per_week: searches * credits * scans_per_week,
    note: "Upper bound from the price table and the scan cap; the workspace's monitoring budget ceiling still applies.",
  };

  const targeting = input.targeting;
  const constraints = {
    requires_approval: true as const,
    provider_calls_before_approval: 0 as const,
    respects_exclusions: [...(targeting?.excluded_industries ?? [])],
    evidence_requirements: [...(targeting?.evidence_requirements ?? ["source_url", "event_date"])],
    execution: "Nothing runs until an owner, admin or editor approves AND activates this plan. Activation is the only step that starts monitoring.",
  };

  if (input.company?.identifier) {
    return { ok: true, plan: {
      version: MONITORING_PLAN_VERSION, kind: "company", title: `Watch ${input.company.label}`,
      target: { label: input.company.label, identifier: input.company.identifier },
      signal_categories, sources: sourcesFor(signal_categories, input.readiness), frequency, estimated_usage, constraints,
    } };
  }
  // ICP-wide: the Brain's targeting is the market; the request may only narrow categories.
  if (!targeting || (!targeting.industries.length && !targeting.locations.length)) return { ok: false, refusal: "no_target" };
  const size = targeting.company_size;
  const sizeText = size.min != null || size.max != null ? ` with ${size.min ?? "?"}–${size.max ?? "?"} employees` : "";
  const label = `${targeting.locations.join(", ") || "Any region"} ${targeting.industries.join(", ") || "companies"}${sizeText}`.trim();
  return { ok: true, plan: {
    version: MONITORING_PLAN_VERSION, kind: "icp", title: `Monitor ${label}`,
    target: { label, industries: targeting.industries, locations: targeting.locations, company_size: size,
      business_models: targeting.business_models, buyer_personas: targeting.buyer_personas, job_titles: targeting.job_titles,
      qualification: targeting.qualification, excluded_industries: targeting.excluded_industries },
    signal_categories, sources: sourcesFor(signal_categories, input.readiness), frequency, estimated_usage, constraints,
  } };
}

const CATEGORY_LABEL: Record<SignalCategory, string> = {
  hiring: "Hiring", expansion: "Expansion", funding: "Funding", leadership_change: "Leadership changes",
  technology: "Technology adoption", product_launch: "Product launches", partnership: "Partnerships",
  acquisition: "Acquisitions", pricing: "Pricing changes", competitor: "Competitor moves",
};
export const categoryLabel = (c: string) => (CATEGORY_LABEL as Record<string, string>)[c] ?? c.replace(/_/g, " ");

/** The chat answer for a saved draft. Says plainly that nothing has run. */
export function renderMonitoringPlan(p: MonitoringPlanDraft): string {
  const lines = [
    `Draft monitoring plan saved — nothing is running. **${p.title}**`,
    "",
    `- Watching for: ${p.signal_categories.map(categoryLabel).join(", ")}`,
    `- Frequency once activated: ${p.frequency}`,
    `- Sources: ${p.sources.map((s) => `${categoryLabel(s.category)} → ${s.source}${s.ready ? "" : ` (not available: ${s.why})`}`).join("; ")}`,
    `- Estimated usage: up to ${p.estimated_usage.max_searches_per_scan} searches (${p.estimated_usage.max_credits_per_scan} credits) per scan, ${p.estimated_usage.max_credits_per_week} credits per week at most`,
    ...(p.constraints.respects_exclusions.length ? [`- Excludes: ${p.constraints.respects_exclusions.join(", ")}`] : []),
    `- Evidence required for every signal: ${p.constraints.evidence_requirements.join(", ")}`,
    "",
    "Approve it, then activate it, from the Signals page (owner, admin or editor). No provider is called before that.",
  ];
  if (p.sources.some((s) => !s.ready)) lines.push("", "Some sources are not configured yet, so activation would not collect those categories until they are.");
  return lines.join("\n");
}

/** LISA Watch: the request, read as a single monitor part (a named company stays a reference). */
export function asMonitorRequest(request: RequestV1): RequestV1 {
  const first = request.parts[0];
  const refs = request.parts.flatMap((p) => p.subject.references ?? []);
  const named = refs.some((r) => r.kind === "named");
  return { ...request, objective: "monitor" as RequestV1["objective"],
    parts: [{ ...first, objective: "monitor", subject: { ...first.subject, entity: named ? "company" : "market", references: named ? refs : [] },
      requirements: request.parts.flatMap((p) => p.requirements ?? []), depends_on: [] }] };
}
