// Competitor intelligence — classify a candidate company as a DIRECT / ADJACENT /
// REPLACEMENT competitor, or not a competitor at all. PURE / Deno-testable.
//
// Hard rule: sharing a generic keyword like "AI" or "sales" is NOT enough. A
// competitor requires real overlap in buyer, category, or the job-to-be-done.
// Seeds come only from the workspace Company Brain (no global competitor list).

import type { RadarIntelligenceProfile } from "./radarIntelligenceProfile.ts";

export type CompetitorClass = "direct" | "adjacent" | "replacement" | "not_competitor";

export interface CompetitorClassification {
  class: CompetitorClass;
  overlaps: { seed: boolean; category: boolean; buyer: boolean; workflow: boolean };
  matched: string[];
  reason: string;
  confidence: "high" | "medium" | "low";
}

// Generic terms that must NEVER, alone, make something a competitor.
const GENERIC_ONLY = ["ai", "artificial intelligence", "sales", "software", "saas", "platform", "b2b", "tool", "automation"];

function lc(s: string): string { return (s ?? "").toLowerCase(); }
function overlapTerms(hay: string, terms: string[]): string[] {
  const out: string[] = [];
  for (const t of terms) {
    const n = lc(t);
    if (n.length < 3) continue;
    if (GENERIC_ONLY.includes(n)) continue; // generic terms don't count as overlap
    if (hay.includes(n)) out.push(t);
  }
  return [...new Set(out)];
}

export interface CompetitorCandidate {
  name?: string;
  description?: string;   // what the company does
  category?: string;
  target_buyer?: string;
  workflow?: string;      // the job-to-be-done it addresses
}

export function classifyCompetitor(candidate: CompetitorCandidate, profile: RadarIntelligenceProfile): CompetitorClassification {
  const blob = lc([candidate.name, candidate.description, candidate.category, candidate.target_buyer, candidate.workflow].filter(Boolean).join(" "));
  const name = lc(candidate.name ?? "");

  // Explicit workspace seed → direct (the brain named it).
  const seedHit = [...profile.competitors.seeds].find((s) => s && (name.includes(lc(s)) || blob.includes(lc(s))));
  const adjacentToolHit = [...profile.competitors.adjacent_tools].find((s) => s && blob.includes(lc(s)));

  const categoryOverlap = overlapTerms(blob, [...profile.target_company.categories, ...profile.target_company.industries]);
  const buyerOverlap = overlapTerms(blob, profile.buyers.titles);
  const workflowOverlap = overlapTerms(blob, [...profile.buying_signals.workflow_pain, ...profile.topics]);

  const overlaps = { seed: !!seedHit, category: categoryOverlap.length > 0, buyer: buyerOverlap.length > 0, workflow: workflowOverlap.length > 0 };
  const matched = [...new Set([...(seedHit ? [seedHit] : []), ...categoryOverlap, ...buyerOverlap, ...workflowOverlap])];
  const realOverlapCount = [overlaps.category, overlaps.buyer, overlaps.workflow].filter(Boolean).length;

  if (seedHit) {
    return { class: "direct", overlaps, matched, reason: `Named competitor in your Company Brain ("${seedHit}").`, confidence: "high" };
  }
  // Replacement: an adjacent tool/workflow-stack that replaces part of the value.
  if (adjacentToolHit || (overlaps.workflow && !overlaps.buyer && !overlaps.category)) {
    return { class: "replacement", overlaps, matched, reason: `Overlaps a workflow you replace${adjacentToolHit ? ` (${adjacentToolHit})` : ""}.`, confidence: "medium" };
  }
  // Direct: same buyer AND same category (and by implication outcome).
  if (overlaps.buyer && overlaps.category) {
    return { class: "direct", overlaps, matched, reason: "Same target buyer and category as your ICP.", confidence: "medium" };
  }
  // Adjacent: some real overlap (buyer or category or workflow), but not both buyer+category.
  if (realOverlapCount >= 1) {
    return { class: "adjacent", overlaps, matched, reason: "Overlapping buyer/category/workflow, different core product.", confidence: "medium" };
  }
  return { class: "not_competitor", overlaps, matched, reason: "Only generic keyword overlap — not a competitor.", confidence: "low" };
}

export interface CompetitorSignalView {
  valid: boolean;
  competitor_name: string;
  competitor_class: CompetitorClass;
  change_detected: string;
  missing_evidence: string[];
}

/** A competitor signal must name a concrete change with evidence. */
export function buildCompetitorSignal(args: {
  candidate: CompetitorCandidate; classification: CompetitorClassification;
  change?: string; evidenceUrl?: string;
}): CompetitorSignalView {
  const missing: string[] = [];
  if (!args.evidenceUrl?.trim()) missing.push("Evidence URL");
  if (!args.change?.trim()) missing.push("What changed (launch/pricing/positioning/etc.)");
  const isCompetitor = args.classification.class !== "not_competitor";
  return {
    valid: isCompetitor && missing.length === 0,
    competitor_name: args.candidate.name ?? "Unknown",
    competitor_class: args.classification.class,
    change_detected: args.change?.trim() || "(no specific change identified)",
    missing_evidence: missing,
  };
}
