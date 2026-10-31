// Transparent, configurable ranking — ordering only, never admission.
//
//   eligibility  the shared engine's verdict (evaluateEligibility). Only an
//                `eligible` lead enters the outreach queue; `pending` leads are
//                ranked in a separate review list; `ineligible` leads are not
//                ranked at all. No score, however high, changes this.
//   score        a sum of named factors, each with the points it gave and why.
//                Missing data scores 0 with the reason "unknown" — never a
//                penalty, never a pass. An undated signal scores 0 ("undated:
//                not counted as recent"). Stale signals score 0.
//
// The role factor reuses the Apify engine's classifyDecisionMakerRole.

import { classifyDecisionMakerRole, type DecisionMakerRoleFamily } from "../decisionMaker/roleFamily.ts";
import type { Eligibility } from "../candidateEligibility.ts";
import type { IcpConfig } from "./icp.ts";
import type { Signal, SignalType } from "./signals.ts";

export const RANKING_VERSION = "lead-pipeline-ranking-v1" as const;

export interface RankWeights {
  role: Partial<Record<DecisionMakerRoleFamily, number>>;
  /** Points per relevance keyword found in the company's own text, capped. */
  relevancePerHit: number;
  relevanceCap: number;
  /** Points removed per negative keyword (relevance only; never below 0 overall for the factor). */
  relevanceNegativePerHit: number;
  /** Points for an industry label in the ICP's preferred list. */
  industryLabel: number;
  /** Recent signals, by type; `relevantHiring` applies to a posting whose role matches. */
  signal: Partial<Record<SignalType, number>> & { relevantHiring?: number };
  /** A corroborated signal multiplies its points. */
  corroboratedMultiplier: number;
  /** Only `medium`/`high` confidence signals score fully; `low` scores this fraction. */
  lowConfidenceFraction: number;
  /** The provider says it holds a number for the person (a flag, not a verified phone). */
  phoneAvailable: number;
  /** An independent source (Apify company employees) shows the person currently there in a decision-maker role. */
  founderConfirmed: number;
  /** Size inside the ICP's preferred sub-band. */
  sizeSweetSpot: { min: number; max: number; points: number } | null;
}

export const DEFAULT_WEIGHTS: RankWeights = Object.freeze({
  role: { founder: 30, executive_revenue: 25, sales_leadership: 15, growth_leadership: 10, revenue_operations: 5, sales_operations: 5, other: 0 },
  relevancePerHit: 4, relevanceCap: 20, relevanceNegativePerHit: 6, industryLabel: 5,
  signal: { funding: 10, hiring: 4, relevantHiring: 10, expansion: 6, leadership_change: 6, linkedin_post: 3 },
  corroboratedMultiplier: 1.5, lowConfidenceFraction: 0.5,
  phoneAvailable: 8,
  founderConfirmed: 8,
  sizeSweetSpot: null,
}) as RankWeights;

export interface RankFactor { factor: string; points: number; why: string }

export interface RankInput {
  leadKey: string;
  eligibility: Eligibility;
  title: string | null;
  /** The company's own descriptive text (industry labels, keywords, description). */
  companyText: string[];
  industryLabels: string[];
  employeeCount: number | null;
  hasPhone: boolean | null;
  signals: readonly Signal[];
  /** Founder check result: true confirmed, false checked and not confirmed, null not checked. */
  founderConfirmed?: boolean | null;
}

export interface RankResult {
  leadKey: string;
  version: typeof RANKING_VERSION;
  eligibility: Eligibility;
  /** `queue` only when eligible; `review` when pending; `excluded` when ineligible. */
  lane: "queue" | "review" | "excluded";
  score: number;
  factors: RankFactor[];
  /** One sentence for a card. */
  explanation: string;
}

const round = (n: number) => Math.round(n * 10) / 10;

function hits(text: string, words: readonly string[]): string[] {
  const t = text.toLowerCase();
  return words.filter((w) => new RegExp(`(^|[^a-z0-9])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(t));
}

export function scoreLead(input: RankInput, icp: IcpConfig, w: RankWeights = DEFAULT_WEIGHTS): RankResult {
  const factors: RankFactor[] = [];
  const lane: RankResult["lane"] = input.eligibility === "eligible" ? "queue" : input.eligibility === "pending" ? "review" : "excluded";

  // Role.
  if (input.title) {
    const r = classifyDecisionMakerRole(input.title);
    factors.push({ factor: "role", points: w.role[r.role_family] ?? 0, why: `"${input.title}" reads as ${r.role_family.replace(/_/g, " ")}${r.disqualified_by ? ` (disqualified by ${r.disqualified_by})` : ""}` });
  } else factors.push({ factor: "role", points: 0, why: "unknown: no current title" });

  // ICP relevance (ordering only).
  const text = input.companyText.join(" \n ");
  if (text.trim()) {
    const pos = hits(text, icp.relevance.positive);
    const neg = hits(text, icp.relevance.negative);
    const pts = Math.max(0, Math.min(w.relevanceCap, pos.length * w.relevancePerHit) - neg.length * w.relevanceNegativePerHit);
    factors.push({ factor: "icp_relevance", points: pts, why: `${pos.length ? `mentions ${pos.join(", ")}` : "no ICP terms found"}${neg.length ? `; also ${neg.join(", ")}` : ""}` });
  } else factors.push({ factor: "icp_relevance", points: 0, why: "unknown: no company description or keywords" });
  const label = input.industryLabels.find((l) => icp.relevance.industryLabels.includes(l));
  factors.push(label
    ? { factor: "industry_label", points: w.industryLabel, why: `provider industry label "${label}"` }
    : { factor: "industry_label", points: 0, why: input.industryLabels.length ? `labels ${input.industryLabels.join(", ")} are not preferred` : "unknown: no industry label" });

  // Size sweet spot (ordering only; the hard size rule is the engine's).
  if (w.sizeSweetSpot) {
    const s = w.sizeSweetSpot;
    factors.push(input.employeeCount == null
      ? { factor: "size_fit", points: 0, why: "unknown: no headcount" }
      : { factor: "size_fit", points: input.employeeCount >= s.min && input.employeeCount <= s.max ? s.points : 0, why: `${input.employeeCount} employees${input.employeeCount >= s.min && input.employeeCount <= s.max ? ` inside ${s.min}–${s.max}` : ` outside ${s.min}–${s.max}`}` });
  }

  // Signals: one best signal per type counts.
  const byType = new Map<string, { pts: number; why: string }>();
  for (const s of input.signals) {
    const typeKey = s.type === "hiring" && s.evidence.fields.relevantRole === true ? "relevantHiring" : s.type;
    const base = (w.signal as Record<string, number | undefined>)[typeKey] ?? 0;
    let pts = 0;
    let why: string;
    if (s.recency === "undated") why = `${s.type}: undated, not counted as recent`;
    else if (s.recency === "stale") why = `${s.type}: ${s.eventDate!.slice(0, 10)} is outside the window`;
    else {
      pts = base * (s.confidence === "low" ? w.lowConfidenceFraction : 1) * (s.corroboration === "corroborated" ? w.corroboratedMultiplier : 1);
      why = `${typeKey === "relevantHiring" ? "hiring for a relevant role" : s.type.replace(/_/g, " ")} on ${s.eventDate!.slice(0, 10)} (${s.confidence} confidence, ${s.corroboration.replace("_", " ")}, via ${s.actor ?? s.provider})`;
    }
    const prev = byType.get(typeKey);
    if (!prev || pts > prev.pts) byType.set(typeKey, { pts, why });
  }
  for (const [k, v] of byType) factors.push({ factor: `signal:${k}`, points: round(v.pts), why: v.why });
  if (!input.signals.length) factors.push({ factor: "signals", points: 0, why: "unknown: no signals collected (not a negative)" });

  if (input.founderConfirmed != null) {
    factors.push(input.founderConfirmed
      ? { factor: "founder_confirmed", points: w.founderConfirmed, why: "an independent source shows the person currently there in a decision-maker role" }
      : { factor: "founder_confirmed", points: 0, why: "independent check did not confirm the person (not a negative)" });
  }

  // Phone availability is the provider's flag only.
  factors.push(input.hasPhone === true
    ? { factor: "phone_available", points: w.phoneAvailable, why: "the provider says it holds a number (not verified)" }
    : { factor: "phone_available", points: 0, why: input.hasPhone === false ? "the provider holds no number" : "unknown: no phone flag" });

  const score = round(factors.reduce((a, f) => a + f.points, 0));
  const top = factors.filter((f) => f.points > 0).sort((a, b) => b.points - a.points).slice(0, 3).map((f) => f.why);
  const gate = lane === "queue" ? "Eligible" : lane === "review" ? "Pending eligibility (not queued)" : "Ineligible (not ranked for outreach)";
  return { leadKey: input.leadKey, version: RANKING_VERSION, eligibility: input.eligibility, lane, score, factors, explanation: `${gate}; score ${score}${top.length ? ` — ${top.join("; ")}` : ""}.` };
}

/** Order leads: queue lane first by score, then review lane. Excluded leads come back last and unordered. */
export function rankLeads(inputs: readonly RankInput[], icp: IcpConfig, w: RankWeights = DEFAULT_WEIGHTS): RankResult[] {
  const scored = inputs.map((i) => scoreLead(i, icp, w));
  const lane = { queue: 0, review: 1, excluded: 2 } as const;
  return scored.sort((a, b) => lane[a.lane] - lane[b.lane] || (a.lane === "excluded" ? 0 : b.score - a.score) || a.leadKey.localeCompare(b.leadKey));
}
