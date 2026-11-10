// LISA → ORION: does this signal deserve executive attention, and what next?
//
// ORION does NOT re-process signals. It reads LISA's downstream contract
// (lisa/weekly.ts `AgentSignal`: counted verification, lifecycle, currency,
// relevance with reasons, Brain fingerprint) and applies LISA's own elevation
// rule (`isElevatable`). On top it adds only what is ORION's to judge: the
// Company Brain's exclusions and a person's past decisions, and which agent
// should act.
//
// CONFIRMED vs INFERRED. `confirmed_event` is what the sources say happened.
// `inferred_opportunity` is ORION's reading of what it might mean for this
// customer ("may be worth researching"), always worded as a possibility and
// kept in a separate field. A recommendation never states the inference as fact.
//
// NEVER TRUSTED: dismissed, disputed (contradicted), retracted, expired or
// stale signals; single-source claims; unsourced claims; excluded companies;
// companies a person (or an approved ATLAS finding) marked as not a fit.
//
// PURE.

import type { SharedBrainContext } from "../companyBrainContextLoader.ts";
import { matchExclusion } from "../brainMemoryModel.ts";
import { orionView } from "../companyBrainAgentViews.ts";
import { isElevatable, type AgentSignal } from "../lisa/weekly.ts";
import type { CompanyIdentity, EvidenceRef, Verification } from "./contract.ts";

export type OrionAttention = "executive" | "watch" | "none";
export type OrionBlock =
  | "not_current" | "unverified" | "no_source" | "excluded_by_brain" | "dismissed_by_you"
  | "not_a_fit_per_brain" | "excluded_by_relevance";

export interface RecommendedAction {
  agent: "atlas" | "lyra" | "orion";
  kind: "atlas_research" | "lyra_content" | "orion_review";
  action: string;
  requires_approval: boolean;
  /** What approving it means, in plain words. */
  approval_note: string;
}

export interface OrionOpportunity {
  signal_id: string;
  discovered_by: "lisa";
  company: CompanyIdentity;
  category: AgentSignal["category"];
  confirmed_event: string;
  inferred_opportunity: string | null;
  trusted: boolean;
  attention: OrionAttention;
  blocked: OrionBlock | null;
  blocked_detail: string | null;
  why_it_matters: string;
  why_now: string;
  evidence: EvidenceRef[];
  verification: Verification;
  recommended: RecommendedAction[];
  brain_fingerprint: string | null;
  brain_influence: string[];
}

/** The company's own site in the evidence, when present: the only domain ORION treats as verified. */
export function verifiedDomain(s: AgentSignal): string | null {
  if (s.company.domain) return s.company.domain;
  const label = s.company.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const first = s.company.name.toLowerCase().split(/\s+/)[0]?.replace(/[^a-z0-9]/g, "") ?? "";
  for (const e of s.evidence) {
    const l = (e.domain.split(".").slice(-2, -1)[0] ?? "");
    if (l.length >= 4 && (l === label || l === first || label.startsWith(l))) return e.domain;
  }
  return null;
}

/** Facts an APPROVED review recorded about an account's fit (from ATLAS feedback). */
function notAFit(brain: SharedBrainContext | null, domain: string | null, name: string): string | null {
  if (!brain) return null;
  for (const f of brain.facts) {
    if (f.category !== "account_fit") continue;
    const v = (f.value ?? {}) as { domain?: string; name?: string; fit?: string; reason?: string };
    const same = (domain && v.domain === domain) || (v.name && v.name.toLowerCase() === name.toLowerCase());
    if (same && v.fit === "not_a_fit") return v.reason ?? "marked not a fit";
  }
  return null;
}

const CATEGORY_WORD: Record<AgentSignal["category"], string> = {
  expansion: "expansion", funding: "new funding", hiring: "hiring push", product_launch: "product launch",
};

export function assessForOrion(s: AgentSignal, brain: SharedBrainContext | null, now: Date = new Date()): OrionOpportunity {
  const domain = verifiedDomain(s);
  const company: CompanyIdentity = { name: s.company.name, domain, account_id: null };
  const evidence: EvidenceRef[] = [
    { ref: `signal_events:${s.id}`, url: s.source_url },
    ...s.evidence.filter((e) => e.url && e.url !== s.source_url).map((e) => ({ ref: `signal_events:${s.id}`, url: e.url })),
  ];
  const confirmed_event = `${s.what_happened}${s.event_date ? ` (${s.event_date})` : ""} — ${s.verification === "corroborated"
    ? `confirmed by ${s.independent_sources} independent sources` : s.verification === "self_reported"
    ? "announced by the company itself" : s.verification === "single_source" ? "reported by one source only, not yet confirmed"
    : "sources contradict each other"}.`;
  const industryReason = s.relevance.reasons.find((r) => r.startsWith("Matches your target industry"));
  const industry = industryReason?.match(/industry: ([^(]+?) \(/)?.[1] ?? null;
  const geoReason = s.relevance.reasons.find((r) => r.startsWith("In your target geography"));
  const geo = geoReason?.match(/geography: ([^(]+?) \(/)?.[1] ?? null;
  const verification: Verification = {
    level: s.verification === "model_inference" ? "inferred" : s.verification,
    independent_sources: s.independent_sources, confidence: s.confidence,
    confirmed: s.currency === "current" && (s.verification === "corroborated" || s.verification === "self_reported") ? [confirmed_event] : [],
    inferred: [],
  };
  const base = {
    signal_id: s.id, discovered_by: "lisa" as const, company, category: s.category, confirmed_event,
    why_it_matters: s.why_it_matters, why_now: s.why_now, evidence, verification,
    brain_fingerprint: brain?.fingerprint ?? null, brain_influence: s.brain_influence,
  };
  const block = (blocked: OrionBlock, detail: string): OrionOpportunity =>
    ({ ...base, inferred_opportunity: null, trusted: false, attention: "none", blocked, blocked_detail: detail, recommended: [] });

  // 1. LISA's own rule: current, counted-verified, sourced.
  if (!isElevatable(s)) {
    if (s.currency !== "current") return block("not_current", `The signal is ${s.currency}; it is not used for recommendations.`);
    if (!s.source_url) return block("no_source", "No source link; LISA cannot show where this came from.");
    if (s.relevance.band === "excluded") return block("excluded_by_relevance", s.relevance.why_it_matters);
    return block("unverified", `Only ${s.verification === "single_source" ? "one source" : "conflicting sources"} so far — shown on the Signals page, not recommended.`);
  }
  // 2. The Company Brain: exclusions and a person's decisions.
  if (brain) {
    const ex = matchExclusion(brain.exclusions, { name: s.company.name, domain });
    if (ex) return block("excluded_by_brain", `Your Company Brain excludes ${ex}.`);
    const view = orionView(brain, now);
    if (view.dismissed_signal_refs.has(s.id)) return block("dismissed_by_you", "You dismissed this signal.");
    const nf = notAFit(brain, domain, s.company.name);
    if (nf) return block("not_a_fit_per_brain", `Your Company Brain records that ${s.company.name} is not a fit: ${nf}.`);
  }

  const hasBrain = !!brain && brain.status !== "missing";
  const isCompetitor = s.relevance.reasons.some((r) => /^Competitor /.test(r) || r.startsWith("A competitor in your Company Brain"));
  const recommended: RecommendedAction[] = [];
  let inferred: string | null = null;

  if (!hasBrain) {
    inferred = null;
    recommended.push({ agent: "orion", kind: "orion_review", action: "Complete your Company Brain so ORION can judge whether this matters to you.",
      requires_approval: false, approval_note: "No action is taken." });
  } else if (isCompetitor) {
    inferred = `${s.company.name} is a competitor you track; its ${CATEGORY_WORD[s.category]} may change how buyers compare you.`;
    recommended.push({ agent: "orion", kind: "orion_review", action: s.suggested_action, requires_approval: false, approval_note: "Advice only; nothing runs." });
    if (s.relevance.band === "high") {
      recommended.push({ agent: "lyra", kind: "lyra_content", action: `Draft a post on what ${s.company.name}'s ${CATEGORY_WORD[s.category]} means for buyers — no direct comparison claims.`,
        requires_approval: true, approval_note: "Approving creates an unpublished draft for review." });
    }
  } else if (s.relevance.band !== "low") {
    inferred = `${s.company.name} may be worth researching because its ${CATEGORY_WORD[s.category]}${
      industry ? ` aligns with your target ${industry.toLowerCase()} market` : " may create a need you solve"}${geo ? ` in ${geo}` : ""}. This is an inference, not a confirmed buying intent.`;
    recommended.push({ agent: "atlas", kind: "atlas_research", action: `Research ${s.company.name} as a potential customer.`,
      requires_approval: true, approval_note: "Approving prepares an ATLAS research plan. Paid discovery still needs your mission approval in Leads; no contacts are enriched and nobody is contacted." });
    if (s.relevance.band === "high") {
      recommended.push({ agent: "lyra", kind: "lyra_content", action: `Draft a post on what this ${CATEGORY_WORD[s.category]} means for your audience.`,
        requires_approval: true, approval_note: "Approving creates an unpublished draft for review." });
    }
  }
  verification.inferred = inferred ? [inferred] : [];
  const attention: OrionAttention = !hasBrain ? "watch" : s.relevance.band === "high" ? "executive" : s.relevance.band === "medium" ? "watch" : "none";
  return { ...base, inferred_opportunity: inferred, trusted: true, attention, blocked: null, blocked_detail: null, recommended };
}
