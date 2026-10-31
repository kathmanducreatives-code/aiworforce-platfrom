// The provider planner: from a validated DiscoverySpec and the workspace's
// provider state to an explainable ExecutionPlan. Pure and deterministic — GPT
// interprets the request; these rules choose providers, so the same spec always
// yields the same plan (and plan hash). A plan is NOT authorization to buy:
// execution requires an approval naming its hash and caps (engine.ts).
//
// Decision rules
//   1 SEED — what defines the candidate population:
//       required hiring signal   → companies_by_hiring   (only Apify can)
//       required posts signal    → companies_by_posts    (only Apify can)
//       otherwise, people        → people_by_firmographics: LeadOcean (role +
//                                  industry + size + HQ filters, per-record) before
//                                  Apify people search (no industry filter, $0.10
//                                  minimum per run)
//       otherwise, companies     → companies_by_firmographics (LeadOcean)
//   2 PEOPLE — a company seed for a people request adds people_at_companies:
//       LeadOcean (records per person) before Apify company-employees ($0.05 minimum)
//   3 VERIFY — hard HQ / size → Apify company records (the only source whose record
//       can prove them under evidence authority); without it they stay unverified
//   4 FOUNDER — optional independent current-employment check (ranking only)
//   5 SIGNALS — preferred (not required) signals → optional Apify company signals
//   6 PHONES — never planned; a separate, separately authorized step
// A provider is usable only if registered `available`, enabled, permitted for the
// workspace, not excluded by the user, and — when the user named providers —
// named. A user-named provider that lacks a needed capability is honoured and the
// gap is explained, not silently replaced.

import type { ProviderId } from "../discoveryProviders/types.ts";
import { sha256Hex } from "../providerInputFingerprint.ts";
import { PIPELINE_ACTORS } from "../leadPipeline/apifyInvoker.ts";
import { worstCaseUsd } from "../leadPipeline/signals.ts";
import { offer, SOURCE_REGISTRY, worstCost, type Capability, type OfferRole } from "./sources.ts";
import type { DiscoverySpec } from "./spec.ts";

export const PLAN_VERSION = "discovery-plan-v1" as const;

export interface ProviderState { enabled: boolean; permitted: boolean; reason?: string | null }
export interface PlannerContext {
  providers: Record<ProviderId, ProviderState>;
  /** Workspace / provider spending limits for this run. */
  caps: { leadoceanRecords: number; apifyUsd: number };
  /** Days a cached company record stays reusable (evidence freshness). */
  cacheMaxAgeDays?: number;
  /** Candidates discovered per lead requested (yield allowance). */
  overfetch?: number;
}

export interface PlannedStep {
  id: string;
  provider: ProviderId;
  capability: Capability;
  role: OfferRole;
  dependsOn: string | null;
  maxItems: number;
  estimate: { unit: "record" | "usd"; worst: number };
  filters: string[];
  optional: boolean;
  why: string;
}

export interface ExecutionPlan {
  version: typeof PLAN_VERSION;
  status: "ready" | "partial_capability" | "blocked";
  strategy: string;
  steps: PlannedStep[];
  notSelected: { provider: ProviderId; why: string }[];
  verifies: string[];
  uncertain: string[];
  limitations: string[];
  estimated: { leadoceanRecords: number; apifyUsd: number };
  /** True when the plan had to shrink to fit the caps. */
  reducedForBudget: boolean;
  planHash: string;
  explanation: string[];
}

const PER_COMPANY_PEOPLE = 3;
const SIGNAL_POSTS = 3, SIGNAL_JOBS = 5;

function usable(p: ProviderId, cap: Capability, spec: DiscoverySpec, ctx: PlannerContext): { ok: boolean; why: string } {
  const d = SOURCE_REGISTRY[p];
  if (d.status !== "available") return { ok: false, why: d.reason ?? "registered but not enabled" };
  const st = ctx.providers[p];
  if (!st?.enabled) return { ok: false, why: st?.reason ?? "disabled for this workspace" };
  if (!st.permitted) return { ok: false, why: st.reason ?? "this workspace is not permitted to use it" };
  if (spec.providers.excluded.includes(p)) return { ok: false, why: "excluded by the request" };
  if (spec.providers.requested && !spec.providers.requested.includes(p)) return { ok: false, why: "not among the providers the request named" };
  const o = offer(p, cap);
  if (!o) return { ok: false, why: `cannot ${cap.replace(/_/g, " ")}` };
  if (o.status !== "available") return { ok: false, why: `${cap.replace(/_/g, " ")} is planned, not validated` };
  return { ok: true, why: "" };
}

/** The first usable provider, in preference order, with every rejection explained. */
function choose(cap: Capability, order: ProviderId[], spec: DiscoverySpec, ctx: PlannerContext, rejected: Map<ProviderId, string>): ProviderId | null {
  for (const p of order) {
    const u = usable(p, cap, spec, ctx);
    if (u.ok) return p;
    if (!rejected.has(p)) rejected.set(p, u.why);
  }
  return null;
}

export function planExecution(spec: DiscoverySpec, ctx: PlannerContext): ExecutionPlan {
  const overfetch = ctx.overfetch ?? 3;
  const steps: PlannedStep[] = [];
  const rejected = new Map<ProviderId, string>();
  const uncertain: string[] = [];
  const limitations: string[] = [];
  const verifies: string[] = [];
  const explanation: string[] = [];
  let gap = false;
  const discoverN = Math.min(100, spec.quantity * overfetch);
  const add = (s: Omit<PlannedStep, "id" | "estimate" | "filters">) => {
    const o = offer(s.provider, s.capability)!;
    const id = `s${steps.length + 1}`;
    steps.push({ ...s, id, estimate: { unit: o.cost.unit, worst: worstCost(o, s.maxItems) }, filters: o.filters });
    for (const n of o.notes) if (!limitations.includes(`${SOURCE_REGISTRY[s.provider].label}: ${n}`)) limitations.push(`${SOURCE_REGISTRY[s.provider].label}: ${n}`);
    return id;
  };
  const required = (k: string) => spec.signals.find((s) => s.kind === k && s.required);

  // 1 SEED
  let seed: string | null = null;
  let seedGivesPeople = false;
  const hiring = required("hiring"), posts = required("posts"), funding = spec.signals.find((s) => s.kind === "funding");
  if (hiring || posts) {
    const cap: Capability = hiring ? "companies_by_hiring" : "companies_by_posts";
    const p = choose(cap, ["apify", "leadocean", "apollo"], spec, ctx, rejected);
    if (p) {
      seed = add({ provider: p, capability: cap, role: "discover", dependsOn: null, maxItems: discoverN, optional: false,
        why: hiring ? `the request requires recent hiring (${(hiring.roles ?? spec.roles).join(", ") || "roles"}); only ${SOURCE_REGISTRY[p].label} can find employers by their open roles, dated`
          : `the request requires companies posting about ${(posts!.topics ?? []).join(", ")}; only ${SOURCE_REGISTRY[p].label} can search posts` });
      explanation.push(`Discovery starts from ${hiring ? "job postings" : "company posts"} (${SOURCE_REGISTRY[p].label}): the required signal defines the population.`);
    } else {
      gap = true;
      uncertain.push(`no usable provider can discover by ${hiring ? "hiring" : "posts"}: the required signal cannot be satisfied`);
    }
  }
  if (!seed) {
    const cap: Capability = spec.target === "people" ? "people_by_firmographics" : "companies_by_firmographics";
    const p = choose(cap, ["leadocean", "apify", "apollo"], spec, ctx, rejected);
    if (p) {
      seed = add({ provider: p, capability: cap, role: "discover", dependsOn: null, maxItems: discoverN, optional: false,
        why: p === "leadocean" ? "a structured search by role, industry, size and location: LeadOcean filters on all of them, priced per record"
          : `${SOURCE_REGISTRY[p].label} is the usable provider for a structured ${spec.target} search (fallback: fewer filters)` });
      seedGivesPeople = spec.target === "people";
      explanation.push(`Discovery is a structured ${spec.target} search via ${SOURCE_REGISTRY[p].label}.`);
    } else {
      gap = true;
      uncertain.push(`no usable provider can run a structured ${spec.target} search`);
    }
  }
  if (funding) {
    const lo = steps.find((s) => s.provider === "leadocean" && s.role === "discover");
    if (lo) explanation.push("Funding narrows the LeadOcean search as a provider claim (held for ~21% of companies); it prioritises verification and is never proof.");
    else uncertain.push("funding: no usable provider can filter by funding; funding stays unknown unless a dated post corroborates it");
    if (funding.required) uncertain.push("a funding requirement can only be met by provider claims plus corroborating posts; candidates without that stay needs_verification");
  }

  // 2 PEOPLE at seeded companies
  let peopleStep: string | null = null;
  if (seed && spec.target === "people" && !seedGivesPeople) {
    const p = choose("people_at_companies", ["leadocean", "apify", "apollo"], spec, ctx, rejected);
    if (p) {
      peopleStep = add({ provider: p, capability: "people_at_companies", role: "discover", dependsOn: seed, maxItems: Math.min(100, discoverN * PER_COMPANY_PEOPLE), optional: false,
        why: p === "leadocean" ? "decision-makers at the discovered companies, by company LinkedIn URL and title (per-record cost)"
          : "decision-makers at the discovered companies via the company-employees actor ($0.05 minimum per run)" });
    } else { gap = true; uncertain.push("no usable provider can find people at the discovered companies"); }
  }

  // 3 VERIFY
  const needHq = spec.verification.headquarters, needSize = spec.verification.size;
  if (needHq || needSize) {
    const p = choose("company_record", ["apify"], spec, ctx, rejected);
    if (p) {
      add({ provider: p, capability: "company_record", role: "verify", dependsOn: peopleStep ?? seed, maxItems: discoverN, optional: false,
        why: `${[needHq && "headquarters", needSize && "declared size"].filter(Boolean).join(" and ")} can only be proven by the company record under evidence-authority rules; provider search rows are claims` });
      verifies.push(...(needHq ? ["headquarters (single HQ-flagged location)"] : []), ...(needSize ? ["declared company size band"] : []), "company identity (LinkedIn URL / domain)");
      explanation.push(`Cached company records younger than ${ctx.cacheMaxAgeDays ?? 30} days are reused before any purchase; duplicates are removed before verification.`);
    } else { gap = true; uncertain.push("headquarters / size cannot be verified (no usable company-record source): candidates stay needs_verification"); }
  }

  // 4 FOUNDER relationship (optional)
  if (spec.target === "people" && spec.verification.founderRelationship) {
    const p = choose("founder_relationship", ["apify"], spec, ctx, rejected);
    if (p) add({ provider: p, capability: "founder_relationship", role: "verify", dependsOn: peopleStep ?? seed, maxItems: Math.min(100, spec.quantity * PER_COMPANY_PEOPLE), optional: true,
      why: "independent current-employment check for eligible companies; ranks, never gates" });
  }

  // 5 SIGNALS (optional: preferred signals only; required ones were the seed)
  const preferred = spec.signals.filter((s) => !s.required && (s.kind === "hiring" || s.kind === "posts" || s.kind === "expansion" || s.kind === "leadership_change"));
  if (preferred.length) {
    const p = choose("company_signals", ["apify"], spec, ctx, rejected);
    if (p) add({ provider: p, capability: "company_signals", role: "signal", dependsOn: seed, maxItems: spec.quantity, optional: true,
      why: `preferred signals (${preferred.map((s) => s.kind).join(", ")}) for eligible companies only; missing signals never block` });
    else uncertain.push(`preferred signals (${preferred.map((s) => s.kind).join(", ")}) unavailable: ranking proceeds without them`);
  }

  // The shared engine qualifies against hard firmographic criteria only (signals rank, never gate there).
  if (!spec.hard.some((k) => k === "geography_hq" || k === "employee_range" || k === "industry")) {
    uncertain.push("no hard company constraint (location, size or industry) was stated: the shared engine has nothing to qualify against, so candidates are returned for review, not as eligible");
  }

  // 6 PHONES — never in discovery
  if (spec.contact.phone === "wanted") limitations.push("phone numbers are a separate, separately approved enrichment step after review; discovery never requests them");

  // Requested-provider gaps
  if (spec.providers.requested) {
    for (const p of spec.providers.requested) if (!steps.some((s) => s.provider === p)) uncertain.push(`${SOURCE_REGISTRY[p].label} was requested but ${rejected.get(p) ?? "is not needed for any step of this request"}`);
  }

  // Estimates (signals priced per company from the actual actor prices) and caps
  const priceOf = (s: PlannedStep) => s.capability === "company_signals"
    ? Math.round(s.maxItems * (worstCaseUsd({ key: "p", ...PIPELINE_ACTORS.apify_linkedin_company_posts }, SIGNAL_POSTS) + worstCaseUsd({ key: "j", ...PIPELINE_ACTORS.apify_linkedin_job_search }, SIGNAL_JOBS)) * 1e6) / 1e6
    : s.estimate.worst;
  for (const s of steps) s.estimate.worst = priceOf(s);
  const budget = { leadoceanRecords: Math.min(ctx.caps.leadoceanRecords, spec.budget.leadoceanRecords ?? Infinity), apifyUsd: Math.min(ctx.caps.apifyUsd, spec.budget.apifyUsd ?? Infinity) };
  let reduced = false;
  const total = () => ({
    leadoceanRecords: steps.filter((s) => s.estimate.unit === "record").reduce((a, s) => a + s.estimate.worst, 0),
    apifyUsd: Math.round(steps.filter((s) => s.estimate.unit === "usd").reduce((a, s) => a + s.estimate.worst, 0) * 1e6) / 1e6,
  });
  // Shrink optional steps first, then everything proportionally, until the plan fits. Never exceed a cap.
  for (let i = 0; i < 40; i++) {
    const t = total();
    if (t.leadoceanRecords <= budget.leadoceanRecords && t.apifyUsd <= budget.apifyUsd + 1e-9) break;
    reduced = true;
    const over = steps.filter((s) => (s.estimate.unit === "record" ? t.leadoceanRecords > budget.leadoceanRecords : t.apifyUsd > budget.apifyUsd + 1e-9));
    const opt = over.filter((s) => s.optional);
    if (opt.length) { const drop = opt[opt.length - 1]; steps.splice(steps.indexOf(drop), 1); limitations.push(`optional step ${drop.capability} dropped to fit the budget`); continue; }
    for (const s of over) {
      s.maxItems = Math.max(0, Math.floor(s.maxItems * 0.75));
      const o = offer(s.provider, s.capability)!;
      s.estimate.worst = s.maxItems ? priceOf({ ...s, estimate: { unit: o.cost.unit, worst: worstCost(o, s.maxItems) } }) : 0;
    }
  }
  const est = total();
  if (est.leadoceanRecords > budget.leadoceanRecords || est.apifyUsd > budget.apifyUsd + 1e-9 || steps.some((s) => !s.optional && s.maxItems === 0)) {
    gap = true; uncertain.push("the budget cannot cover even a minimal run of the required steps");
  }
  if (reduced) limitations.push("the plan was reduced to fit the budget: fewer candidates than requested may result; unresolved ones stay needs_verification");

  const used = [...new Set(steps.map((s) => s.provider))];
  for (const p of Object.keys(SOURCE_REGISTRY) as ProviderId[]) {
    if (!used.includes(p)) {
      const why = rejected.get(p) ?? (p === "apollo" ? SOURCE_REGISTRY.apollo.reason! : "not needed: the selected providers cover every step more directly or more cheaply");
      const st = ctx.providers[p];
      // A disabled / unpermitted / unregistered provider says so, even when it was never needed.
      const state = SOURCE_REGISTRY[p].status !== "available" ? SOURCE_REGISTRY[p].reason : !st?.enabled ? (st?.reason ?? "disabled for this workspace") : !st.permitted ? (st.reason ?? "not permitted for this workspace") : null;
      rejected.set(p, state && !rejected.has(p) ? state : why);
    }
  }
  const notSelected = (Object.keys(SOURCE_REGISTRY) as ProviderId[]).filter((p) => !used.includes(p)).map((p) => ({ provider: p, why: rejected.get(p)! }));
  const blocked = !steps.some((s) => s.role === "discover");
  const strategy = used.length ? used.sort().join("+") : "none";
  // The WHOLE validated spec is bound into the hash: any change to what was shown needs a new approval.
  const planHash = sha256Hex(JSON.stringify([PLAN_VERSION, spec, steps.map((s) => [s.id, s.provider, s.capability, s.maxItems, s.dependsOn])])).slice(0, 16);
  return {
    version: PLAN_VERSION, status: blocked ? "blocked" : gap ? "partial_capability" : "ready", strategy, steps, notSelected,
    verifies, uncertain, limitations, estimated: est, reducedForBudget: reduced, planHash,
    explanation: [...explanation, ...steps.map((s) => `${s.id} ${SOURCE_REGISTRY[s.provider].label} · ${s.capability}${s.optional ? " (optional)" : ""}: ${s.why}`),
      ...notSelected.map((n) => `Not using ${SOURCE_REGISTRY[n.provider].label}: ${n.why}`)],
  };
}
