// AGENT COLLABORATION — the one typed contract every agent handoff uses.
//
// A HANDOFF is a structured, reviewable proposal from one agent to another:
// "LISA found X → ORION recommends ATLAS research Y". It is never a free-text
// instruction. It carries the company identity, the signals and leads it is
// about, the Company Brain fingerprint it was judged against, the evidence and
// its verification, the reason, whether a person must approve it, and an
// idempotency key so a duplicate signal or a retry finds the existing handoff.
//
// WHY A LEDGER AND NOT `approvals`. The existing `approvals` table is writable
// by any workspace member through RLS (a FOR ALL member policy), so a viewer
// could mark a row approved from the browser. Collaboration approvals gate paid
// research, so they live in `agent_handoffs` (held migration 20261112120000),
// which nobody writes directly: every transition is a SECURITY DEFINER function
// that re-checks the caller's CURRENT role in the same transaction.
//
// WHAT IT DOES NOT DO. It does not execute anything. Execution stays in the
// owning agent's existing workflow: an approved ATLAS handoff becomes a
// PREFILLED ATLAS plan the user still approves as a mission in Leads (paid
// discovery keeps its own approval and budget gates); an approved LYRA handoff
// becomes a `content_item` DRAFT (never published). The ledger only records
// what was proposed, decided and reported back.
//
// PURE. Mirrors the SQL vocabulary; pinned to it by the contract test.

export const COLLAB_CONTRACT_VERSION = "agent-collab-v1" as const;

export const AGENTS = ["lisa", "orion", "atlas", "lyra", "brain"] as const;
export type AgentName = typeof AGENTS[number];

export const HANDOFF_KINDS = ["atlas_research", "lyra_content", "orion_review"] as const;
export type HandoffKind = typeof HANDOFF_KINDS[number];

export const HANDOFF_STATUSES = [
  "proposed", "awaiting_review", "approved", "rejected", "queued", "running",
  "completed", "partially_completed", "failed", "cancelled", "blocked",
] as const;
export type HandoffStatus = typeof HANDOFF_STATUSES[number];

export const TERMINAL: ReadonlySet<HandoffStatus> = new Set(["rejected", "completed", "partially_completed", "failed", "cancelled", "blocked"]);

/** Every allowed transition. Mirrors agent_handoff_decide / agent_handoff_advance. */
export const TRANSITIONS: Record<HandoffStatus, readonly HandoffStatus[]> = {
  proposed: ["awaiting_review", "cancelled", "blocked"],
  awaiting_review: ["approved", "rejected", "cancelled", "blocked"],
  approved: ["queued", "cancelled", "blocked"],
  queued: ["running", "cancelled", "blocked", "failed"],
  running: ["completed", "partially_completed", "failed", "blocked"],
  // A failed run may be re-queued (bounded: the database refuses after 3 attempts).
  failed: ["queued"],
  completed: [], partially_completed: [], cancelled: [], rejected: [], blocked: [],
};

export const MAX_ATTEMPTS = 3;

export function canTransition(from: HandoffStatus, to: HandoffStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Transitions only a PERSON (editor/admin/owner) may make. */
export const HUMAN_DECISIONS = ["approve", "reject", "cancel"] as const;
export type HumanDecision = typeof HUMAN_DECISIONS[number];

export interface EvidenceRef {
  /** Where it is stored: `signal_events:<id>`, `signal_event_evidence:<id>`, `lead_candidates:<id>`, `content_item:<id>`. */
  ref: string;
  /** The public source, when there is one. Copied, never invented. */
  url?: string | null;
  excerpt?: string | null;
}

export interface Verification {
  /** LISA's counted level, or ATLAS's qualification evidence level. */
  level: "corroborated" | "self_reported" | "single_source" | "contradicted" | "inferred" | "unknown";
  independent_sources?: number;
  confidence: "high" | "medium" | "low";
  /** What is CONFIRMED (the event) vs INFERRED (the opportunity). Never merged. */
  confirmed: string[];
  inferred: string[];
}

export interface CompanyIdentity {
  name: string;
  /** Only when it came from a verified source (the subject's own site, or a stored account). */
  domain: string | null;
  account_id: string | null;
}

/** The structured handoff. `payload` is the target agent's typed request (see handoffs/*). */
export interface Handoff<P = unknown> {
  contract_version: typeof COLLAB_CONTRACT_VERSION;
  workspace_id: string;
  source_agent: AgentName;
  target_agent: AgentName;
  kind: HandoffKind;
  company: CompanyIdentity | null;
  signal_ids: string[];
  lead_ids: string[];
  brain_fingerprint: string | null;
  reason: string;
  evidence: EvidenceRef[];
  verification: Verification;
  requires_approval: boolean;
  idempotency_key: string;
  payload: P;
  /** The handoff this one came from (an ATLAS result → its research proposal). */
  parent_id?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const slug = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x";

/**
 * A duplicate signal, a retry or a second click computes the SAME key, so the
 * database's unique (workspace_id, idempotency_key) returns the existing row.
 * The key names the kind, the company and the signals — not the time.
 */
export function idempotencyKeyFor(kind: HandoffKind, company: CompanyIdentity | null, signalIds: string[], extra = ""): string {
  const who = company ? slug(company.domain ?? company.name) : "none";
  const sig = [...new Set(signalIds)].sort().join(",");
  return `${kind}:${who}:${sig || "nosignal"}${extra ? `:${slug(extra)}` : ""}`.slice(0, 300);
}

/** Validation the RPC repeats. Null when the handoff is well formed. */
export function handoffError(h: Handoff<unknown>): string | null {
  if (h.contract_version !== COLLAB_CONTRACT_VERSION) return "unknown contract version";
  if (!UUID.test(h.workspace_id)) return "workspace_id must be a uuid";
  if (!(AGENTS as readonly string[]).includes(h.source_agent) || !(AGENTS as readonly string[]).includes(h.target_agent)) return "unknown agent";
  if (h.source_agent === h.target_agent) return "an agent cannot hand off to itself";
  if (!(HANDOFF_KINDS as readonly string[]).includes(h.kind)) return "unknown kind";
  if (!h.reason?.trim()) return "a handoff needs a reason";
  if (!h.idempotency_key || h.idempotency_key.length > 300) return "idempotency_key required";
  if (h.signal_ids.some((s) => !UUID.test(s)) || h.lead_ids.some((s) => !UUID.test(s))) return "signal and lead ids must be uuids";
  if (h.evidence.some((e) => e.url && !/^https?:\/\//i.test(e.url))) return "evidence URLs must be http(s)";
  // Consequential work is always reviewed. Only an ORION review note may skip it.
  if ((h.kind === "atlas_research" || h.kind === "lyra_content") && !h.requires_approval) return "research and content handoffs require approval";
  if (h.kind === "atlas_research" && !h.company) return "research needs a company";
  return null;
}
