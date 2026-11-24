// ATLAS → ORION: what an approved research mission actually produced.
//
// ONE result contract for every ending, so ORION can never mistake an attempt
// for an outcome:
//   qualified / rejected / already_known / missing_evidence /
//   insufficient_information / blocked_budget / failed
//
// HONESTY RULES (also enforced by agent_handoff_advance):
//   * a result that was not persisted is never `completed` — it is `failed`
//     (nothing saved) or `partially_completed` (some stages saved);
//   * `qualified` must name the saved lead_candidates row;
//   * provider-returned contacts are NEVER independently verified here:
//     `contacts.independently_verified` is forced false whatever the input says.
//
// The ATLAS mission engine is owned by the ATLAS track. `atlasResultFromMission`
// adapts the fields a finished mission already exposes; wiring it into the
// mission's completion path is that track's one-line change (see
// docs/plans/agent-collaboration/README.md). Until then results arrive through
// the collaboration endpoint's service-key `atlas_result` action.
//
// PURE.

import type { HandoffStatus } from "./contract.ts";

export const ATLAS_RESULT_VERSION = "atlas-research-result-v1" as const;

export const QUALIFICATIONS = ["qualified", "rejected", "already_known", "missing_evidence", "insufficient_information", "blocked_budget", "failed"] as const;
export type Qualification = typeof QUALIFICATIONS[number];

export interface AtlasResearchResult {
  result_version: typeof ATLAS_RESULT_VERSION;
  handoff_id: string;
  signal_id: string | null;
  company: { name: string; domain: string | null };
  qualification: Qualification;
  /** Did ATLAS's own write of the outcome succeed? */
  persisted: boolean;
  lead_candidate_id: string | null;
  account_id: string | null;
  reasons: string[];
  evidence: Array<{ ref: string; url?: string | null }>;
  confidence: "high" | "medium" | "low";
  budget: { credits_reserved: number; credits_charged: number; status: "within_budget" | "exhausted" | "not_started" };
  execution: { status: "completed" | "partial" | "failed" | "not_started"; stages_completed: string[]; error: string | null };
  contacts: { count: number; independently_verified: false };
  next_step: string;
  summary: string;
}

/** Normalize and harden a reported result. Never trusts a claim of verified contacts. */
export function normalizeAtlasResult(r: Partial<AtlasResearchResult> & { handoff_id: string; company: { name: string; domain: string | null } }): AtlasResearchResult {
  const q: Qualification = (QUALIFICATIONS as readonly string[]).includes(String(r.qualification)) ? r.qualification as Qualification : "failed";
  const exec = r.execution ?? { status: "failed" as const, stages_completed: [], error: "no execution report" };
  const persisted = r.persisted === true;
  const qualification: Qualification = q === "qualified" && (!persisted || !r.lead_candidate_id) ? (persisted ? "missing_evidence" : "failed") : q;
  const out: AtlasResearchResult = {
    result_version: ATLAS_RESULT_VERSION, handoff_id: r.handoff_id, signal_id: r.signal_id ?? null, company: r.company,
    qualification, persisted, lead_candidate_id: qualification === "qualified" ? r.lead_candidate_id ?? null : r.lead_candidate_id ?? null,
    account_id: r.account_id ?? null, reasons: (r.reasons ?? []).slice(0, 10).map(String),
    evidence: (r.evidence ?? []).filter((e) => !e.url || /^https?:\/\//.test(e.url)).slice(0, 20),
    confidence: r.confidence === "high" || r.confidence === "medium" ? r.confidence : "low",
    budget: r.budget ?? { credits_reserved: 0, credits_charged: 0, status: "not_started" },
    execution: exec,
    contacts: { count: Math.max(0, Number(r.contacts?.count ?? 0)), independently_verified: false },
    next_step: "", summary: "",
  };
  out.next_step = nextStep(out);
  out.summary = orionReads(out);
  return out;
}

/** The handoff status this result may move to. Mirrors agent_handoff_advance. */
export function handoffStatusFor(r: AtlasResearchResult): HandoffStatus {
  if (r.qualification === "blocked_budget") return "blocked";
  if (!r.persisted || r.qualification === "failed") return "failed";
  if (r.execution.status === "partial") return "partially_completed";
  return "completed";
}

function nextStep(r: AtlasResearchResult): string {
  switch (r.qualification) {
    case "qualified": return `Review ${r.company.name} in Leads. Outreach still needs your separate approval.`;
    case "rejected": return "Nothing to do. Consider approving the fit note ATLAS proposed for your Company Brain.";
    case "already_known": return `${r.company.name} is already in your workspace; open the existing record.`;
    case "missing_evidence": return "ATLAS could not confirm fit from evidence; retry later or research manually.";
    case "insufficient_information": return "Too little public information to qualify; keep watching for new signals.";
    case "blocked_budget": return "Research stopped at your credit limit. Add credits or raise the limit, then retry.";
    case "failed": return "Research did not finish. You can retry; nothing was charged beyond what the ledger shows.";
  }
}

/** What ORION may say about it. Never "completed research" unless it was saved. */
export function orionReads(r: AtlasResearchResult): string {
  const who = r.company.name;
  if (!r.persisted) return `ATLAS research on ${who} did not save a result${r.execution.error ? ` (${r.execution.error})` : ""}; treat it as not done.`;
  const why = r.reasons.length ? ` ${r.reasons.slice(0, 2).join("; ")}.` : "";
  const contacts = r.contacts.count ? ` ${r.contacts.count} provider-returned contact(s), not independently verified.` : "";
  const partial = r.execution.status === "partial" ? " Some research steps did not finish." : "";
  switch (r.qualification) {
    case "qualified": return `ATLAS qualified ${who} against your ICP (confidence ${r.confidence}).${why}${contacts}${partial}`;
    case "rejected": return `ATLAS found ${who} does not fit your ICP.${why}${partial}`;
    case "already_known": return `${who} is already known in your workspace; ATLAS did not create a duplicate.${partial}`;
    case "missing_evidence": return `ATLAS could not find enough evidence to qualify ${who}.${why}${partial}`;
    case "insufficient_information": return `There is not enough public information on ${who} yet.${why}${partial}`;
    case "blocked_budget": return `ATLAS research on ${who} was blocked by your credit budget.`;
    case "failed": return `ATLAS research on ${who} failed.${partial}`;
  }
}

/**
 * Adapter from a finished ATLAS mission's existing outputs (verdict per company,
 * the saved lead row, the ledger charge, an error) to the result contract.
 */
export function atlasResultFromMission(i: {
  handoff_id: string; signal_id: string | null; company: { name: string; domain: string | null };
  verdict: "pass" | "fail" | "duplicate" | "insufficient" | "unverifiable" | null;
  lead_candidate_id: string | null; account_id?: string | null; reasons?: string[];
  evidence?: Array<{ ref: string; url?: string | null }>; confidence?: "high" | "medium" | "low";
  credits_reserved?: number; credits_charged?: number; budget_refused?: boolean;
  stages_completed?: string[]; error?: string | null; persisted: boolean; contacts?: number;
}): AtlasResearchResult {
  const qualification: Qualification = i.budget_refused ? "blocked_budget"
    : i.error && !i.verdict ? "failed"
    : i.verdict === "pass" ? "qualified" : i.verdict === "fail" ? "rejected" : i.verdict === "duplicate" ? "already_known"
    : i.verdict === "insufficient" ? "insufficient_information" : i.verdict === "unverifiable" ? "missing_evidence" : "failed";
  return normalizeAtlasResult({
    handoff_id: i.handoff_id, signal_id: i.signal_id, company: i.company, qualification, persisted: i.persisted,
    lead_candidate_id: i.lead_candidate_id, account_id: i.account_id ?? null, reasons: i.reasons ?? [], evidence: i.evidence ?? [],
    confidence: i.confidence ?? "low",
    budget: { credits_reserved: i.credits_reserved ?? 0, credits_charged: i.credits_charged ?? 0,
      status: i.budget_refused ? "exhausted" : (i.credits_reserved ?? 0) > 0 ? "within_budget" : "not_started" },
    execution: { status: i.error ? (i.verdict ? "partial" : "failed") : i.verdict ? "completed" : "not_started",
      stages_completed: i.stages_completed ?? [], error: i.error ?? null },
    contacts: { count: i.contacts ?? 0, independently_verified: false },
  });
}
