// COMPANY BRAIN V1 — THE MEMORY MODEL (pure).
//
// The vocabulary, the honesty rules and the read-time rules for the memory
// tables added by supabase/migrations-held/20261110120000_company_brain_memory.sql.
// The SQL CHECK constraints are the enforcement; this module is the SAME rules,
// stated once for TypeScript readers (the shared loader, the edge handler and
// the Company Brain page), and pinned to the SQL by brainMemoryModel.test.ts.
//
// ── WHAT IS SERVABLE ────────────────────────────────────────────────────────
//
// An agent may treat a memory item as company knowledge ONLY when it is
//   active, not expired, not redacted, and either a person's own entry or an
//   agent proposal a person approved.
// Stale and disputed items are shown to people ("needs review"), never fed to
// an agent as fact. Retracted, superseded, rejected and expired items are
// history.
//
// ── DECISIONS DO NOT GENERALISE ─────────────────────────────────────────────
//
// A decision applies to the record it names (scope + scope_ref). Rejecting one
// lead is not an industry exclusion. Exclusions exist only as explicit
// `preference` items in category `exclusions`, which a person created as such.
//
// PURE. No network, no database, no Deno APIs — importable by the frontend.

export const MEMORY_KINDS = ["fact", "preference", "decision"] as const;
export type MemoryKind = typeof MEMORY_KINDS[number];

export const MEMORY_SCOPES = ["workspace", "agent", "lead", "account", "signal", "recommendation", "content", "mission"] as const;
export type MemoryScope = typeof MEMORY_SCOPES[number];

export const VALUE_TYPES = ["text", "list", "number_range", "boolean", "object", "redacted"] as const;
export type ValueType = typeof VALUE_TYPES[number];

export const SOURCE_TYPES = [
  "user_provided", "corroborated", "provider_returned", "model_inference", "agent_suggestion", "system_migration",
] as const;
export type SourceType = typeof SOURCE_TYPES[number];

export const VERIFICATION_STATUSES = ["user_confirmed", "corroborated", "provider_reported", "unverified"] as const;
export type VerificationStatus = typeof VERIFICATION_STATUSES[number];

export const LIFECYCLE_STATUSES = ["active", "stale", "disputed", "superseded", "rejected", "retracted", "expired"] as const;
export type LifecycleStatus = typeof LIFECYCLE_STATUSES[number];

export const PROPOSAL_AGENTS = ["orion", "atlas", "lyra", "lisa"] as const;
export type ProposalAgent = typeof PROPOSAL_AGENTS[number];

export const PROPOSAL_SOURCE_TYPES = ["model_inference", "agent_suggestion", "provider_returned"] as const;

/** Decision types that may legitimately apply to the whole workspace. Mirrors the SQL. */
export const WORKSPACE_WIDE_DECISIONS = ["icp_changed", "strategy_selected", "brand_preference", "exclusion_added", "correction"] as const;

export const EXCLUSION_TYPES = ["industry", "company", "geography", "keyword"] as const;
export type ExclusionType = typeof EXCLUSION_TYPES[number];

/** One memory item as the tables store it (the columns the loader selects). */
export interface MemoryItem {
  id: string;
  workspace_id: string;
  kind: MemoryKind;
  category: string;
  fact_key: string;
  scope: MemoryScope;
  scope_ref: string | null;
  value_type: ValueType;
  value: unknown;
  version: number;
  source_type: SourceType;
  source_ref: string | null;
  source_url: string | null;
  verification_status: VerificationStatus;
  confidence: "high" | "medium" | "low";
  lifecycle_status: LifecycleStatus;
  persistence: "persistent" | "temporary";
  approval_status: "not_required" | "approved";
  created_by_kind: "user" | "agent" | "system";
  created_by_agent: string | null;
  approved_by?: string | null;
  proposal_id?: string | null;
  observed_at: string;
  review_at: string | null;
  expires_at: string | null;
  updated_at: string;
  redacted_at: string | null;
  reason?: string | null;
}

export const MEMORY_COLUMNS =
  "id, workspace_id, kind, category, fact_key, scope, scope_ref, value_type, value, version, source_type, source_ref, source_url, verification_status, confidence, lifecycle_status, persistence, approval_status, created_by_kind, created_by_agent, approved_by, proposal_id, observed_at, review_at, expires_at, updated_at, redacted_at, reason";

// ─────────────────────────────────────────────────────────── value checks ────

/** The SQL `company_brain_memory_value_valid`, in TypeScript. */
export function valueMatchesType(type: string, value: unknown): boolean {
  switch (type) {
    case "text": return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 2000;
    case "list": return Array.isArray(value) && value.length >= 1 && value.length <= 100 &&
      value.every((x) => typeof x === "string" && x.trim().length > 0);
    case "number_range": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const v = value as Record<string, unknown>;
      if (!("min" in v) && !("max" in v)) return false;
      const okNum = (x: unknown) => x === undefined || x === null || (typeof x === "number" && Number.isFinite(x));
      if (!okNum(v.min) || !okNum(v.max)) return false;
      return !(typeof v.min === "number" && typeof v.max === "number" && v.min > v.max);
    }
    case "boolean": return typeof value === "boolean";
    case "object": return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
    case "redacted": return value === null;
    default: return false;
  }
}

/**
 * The honesty rules (SQL CHECKs cbm_*), as one predicate. Returns the first
 * broken rule, or null. A model inference is never "verified" by anybody but a
 * person, and then it says so ('user_confirmed') while keeping its source type.
 */
export function provenanceViolation(i: Pick<MemoryItem,
  "source_type" | "verification_status" | "source_url" | "source_ref" | "created_by_kind" | "approval_status"> & { approved_by?: string | null; proposal_id?: string | null }): string | null {
  if ((i.source_type === "model_inference" || i.source_type === "agent_suggestion") &&
      !(i.verification_status === "unverified" || i.verification_status === "user_confirmed")) {
    return "a model inference or agent suggestion cannot be corroborated or provider-reported";
  }
  if (i.source_type === "provider_returned" && i.verification_status === "corroborated") {
    return "a provider answer alone is not independent corroboration";
  }
  if (i.verification_status === "corroborated" && !i.source_url && !i.source_ref) {
    return "corroboration needs a source";
  }
  if (i.source_type === "user_provided" && i.verification_status !== "user_confirmed") {
    return "a user's own entry is user-confirmed";
  }
  if (i.created_by_kind === "agent" && (i.approval_status !== "approved" || !i.approved_by || !i.proposal_id)) {
    return "agent-originated memory needs a person's approval";
  }
  return null;
}

// ───────────────────────────────────────────────────────── read-time state ────

/** How old a user-confirmed item may get before it is shown as "needs review". */
export const STALE_AFTER_DAYS: Readonly<Record<string, number>> = Object.freeze({
  competitors: 180, products: 365, company: 365, icp: 365, goals: 120, sales_priority: 90,
  content: 365, brand_voice: 365, exclusions: 730, customers: 365,
});
export const DEFAULT_STALE_AFTER_DAYS = 365;
/** Unconfirmed facts age faster: they were never a person's statement. */
export const UNCONFIRMED_STALE_AFTER_DAYS = 60;

export type EffectiveStatus = LifecycleStatus | "redacted";

/**
 * The status an item has NOW. Never writes: expiry and staleness are computed
 * at read time, so they need no cron and cannot be missed by one.
 * Decisions do not go stale (a choice made is still the choice made); they
 * only expire when they say so.
 */
export function effectiveStatus(i: MemoryItem, now: Date = new Date()): EffectiveStatus {
  if (i.redacted_at || i.value_type === "redacted") return "redacted";
  if (i.lifecycle_status !== "active") return i.lifecycle_status;
  const t = now.getTime();
  if (i.expires_at && Date.parse(i.expires_at) <= t) return "expired";
  if (i.kind === "decision") return "active";
  if (i.review_at && Date.parse(i.review_at) <= t) return "stale";
  const limit = i.verification_status === "user_confirmed" || i.verification_status === "corroborated"
    ? (STALE_AFTER_DAYS[i.category] ?? DEFAULT_STALE_AFTER_DAYS)
    : UNCONFIRMED_STALE_AFTER_DAYS;
  const seen = Date.parse(i.observed_at ?? i.updated_at);
  if (Number.isFinite(seen) && (t - seen) / 86_400_000 > limit) return "stale";
  return "active";
}

/** May an agent treat this item as company knowledge right now? */
export function isServable(i: MemoryItem, now: Date = new Date()): boolean {
  if (effectiveStatus(i, now) !== "active") return false;
  if (provenanceViolation(i)) return false;
  // Only a person's own entry, or something a person approved.
  if (i.created_by_kind === "agent") return i.approval_status === "approved";
  return i.verification_status === "user_confirmed" || i.verification_status === "corroborated" ||
    i.verification_status === "provider_reported";
}

/** Items a person should look at again: active-but-stale and disputed. */
export function needsReview(i: MemoryItem, now: Date = new Date()): boolean {
  const s = effectiveStatus(i, now);
  return s === "stale" || s === "disputed";
}

// ─────────────────────────────────────────────────────────── provenance UI ────

const SOURCE_LABEL: Record<SourceType, string> = {
  user_provided: "You entered this",
  corroborated: "Independently corroborated",
  provider_returned: "Reported by a data provider",
  model_inference: "Inferred by AI",
  agent_suggestion: "Suggested by an agent",
  system_migration: "Imported",
};
const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  user_confirmed: "confirmed by your team",
  corroborated: "corroborated by an independent source",
  provider_reported: "not independently verified",
  unverified: "unverified",
};

/** "Suggested by Lisa · confirmed by your team" — never more than the record says. */
export function provenanceLabel(i: Pick<MemoryItem, "source_type" | "verification_status" | "created_by_agent">): string {
  const src = i.source_type === "agent_suggestion" && i.created_by_agent
    ? `Suggested by ${i.created_by_agent.charAt(0).toUpperCase()}${i.created_by_agent.slice(1)}`
    : SOURCE_LABEL[i.source_type] ?? "Unknown source";
  if (i.source_type === "user_provided") return src;
  return `${src} · ${VERIFICATION_LABEL[i.verification_status] ?? "unverified"}`;
}

/** Short provenance tag for prompts: [you], [approved lisa suggestion], … */
export function provenanceTag(i: Pick<MemoryItem, "source_type" | "created_by_agent" | "approval_status">): string {
  if (i.source_type === "user_provided") return "you";
  if (i.approval_status === "approved" && i.created_by_agent) return `approved ${i.created_by_agent} ${i.source_type.replace("_", " ")}`;
  return i.source_type.replace("_", " ");
}

// ─────────────────────────────────────────────────────────── derived views ────

export interface Exclusions {
  industries: string[];
  companies: string[];
  geographies: string[];
  keywords: string[];
  /** The items they came from, for "why was this excluded?" */
  items: MemoryItem[];
}

const norm = (s: string) => s.trim().toLowerCase();
const uniq = (xs: string[]) => [...new Map(xs.filter(Boolean).map((x) => [norm(x), x.trim()])).values()];

/** Explicit, servable exclusions only — never derived from decisions. */
export function deriveExclusions(items: MemoryItem[], now: Date = new Date()): Exclusions {
  const ex = items.filter((i) => i.kind === "preference" && i.category === "exclusions" && isServable(i, now));
  const pick = (t: ExclusionType) => uniq(ex.flatMap((i) => {
    const v = i.value as Record<string, unknown> | null;
    const type = typeof v?.type === "string" ? v.type : i.fact_key.replace(/^exclusion\./, "").split(":")[0];
    if (type !== t) return [];
    if (typeof v?.value === "string") return [v.value];
    if (Array.isArray(v?.values)) return (v!.values as unknown[]).filter((x): x is string => typeof x === "string");
    return [];
  }));
  return { industries: pick("industry"), companies: pick("company"), geographies: pick("geography"), keywords: pick("keyword"), items: ex };
}

/** Does `text` hit an exclusion? Returns the matching exclusion, or null. */
export function matchExclusion(ex: Exclusions, subject: { name?: string | null; domain?: string | null; industry?: string | null; location?: string | null }): string | null {
  const hit = (needle: string, hay: string | null | undefined) => !!hay && norm(hay).includes(norm(needle)) && norm(needle).length > 1;
  for (const c of ex.companies) {
    const n = norm(c);
    if (subject.domain && (norm(subject.domain) === n || norm(subject.domain).endsWith(`.${n}`))) return `company ${c}`;
    if (subject.name && norm(subject.name) === n) return `company ${c}`;
  }
  for (const i of ex.industries) if (hit(i, subject.industry)) return `industry ${i}`;
  for (const g of ex.geographies) if (hit(g, subject.location)) return `geography ${g}`;
  for (const k of ex.keywords) if (hit(k, subject.name) || hit(k, subject.industry)) return `keyword ${k}`;
  return null;
}

/** Active decisions, newest first; temporary ones only while unexpired. */
export function activeDecisions(items: MemoryItem[], now: Date = new Date()): MemoryItem[] {
  return items.filter((i) => i.kind === "decision" && isServable(i, now))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
}

/** Refs a person explicitly decided against, by scope ('lead' → lead ids…). */
export function decidedAgainst(items: MemoryItem[], scope: MemoryScope, now: Date = new Date()): Set<string> {
  const NEGATIVE = /^(rejected|dismissed|declined|not_relevant|incorrect|false)$/;
  return new Set(activeDecisions(items, now)
    .filter((d) => d.scope === scope && d.scope_ref &&
      NEGATIVE.test(String((d.value as Record<string, unknown> | null)?.outcome ?? "")))
    .map((d) => d.scope_ref!));
}

// ─────────────────────────────────────────────────────── decision guards ────

/** The SQL rule: which decisions may be workspace-wide. Mirrors company_brain_memory_write. */
export function decisionScopeError(decisionType: string, scope: string, scopeRef: string | null): string | null {
  if (!(MEMORY_SCOPES as readonly string[]).includes(scope)) return "unknown scope";
  if ((scope === "workspace") !== (scopeRef == null || scopeRef === "")) return "scope_ref is required for a non-workspace scope, and forbidden for workspace";
  if (scope === "workspace" && !(WORKSPACE_WIDE_DECISIONS as readonly string[]).includes(decisionType)) {
    return `${decisionType} applies to one record: give scope and scope_ref`;
  }
  return null;
}

// ──────────────────────────────────────────────────────────── proposals ────

export interface ProposalInput {
  kind: "fact" | "preference";
  category: string;
  fact_key: string;
  scope?: MemoryScope;
  scope_ref?: string | null;
  value_type: Exclude<ValueType, "redacted">;
  value: unknown;
  rationale: string;
  evidence: Array<{ source_url?: string; source_ref?: string; observed_at?: string; excerpt?: string }>;
  source_type: typeof PROPOSAL_SOURCE_TYPES[number];
  confidence?: "high" | "medium" | "low";
  dedupe_key?: string;
}

/** Client-side mirror of the submit function's validation (fail fast, same rules). */
export function proposalError(p: ProposalInput, agent: string): string | null {
  if (!(PROPOSAL_AGENTS as readonly string[]).includes(agent)) return "unknown agent";
  if (p.kind !== "fact" && p.kind !== "preference") return "kind must be fact or preference";
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(p.category)) return "category malformed";
  if (!p.fact_key || p.fact_key !== p.fact_key.toLowerCase() || p.fact_key.length > 200) return "fact_key malformed";
  if (!(PROPOSAL_SOURCE_TYPES as readonly string[]).includes(p.source_type)) return "an agent can only propose an inference, a suggestion or a provider answer";
  if (!valueMatchesType(p.value_type, p.value)) return "value does not match value_type";
  if (!p.rationale?.trim()) return "a proposal needs a rationale";
  if (p.source_type === "provider_returned" && !(p.evidence?.length)) return "a provider-returned proposal needs evidence";
  if ((p.evidence ?? []).some((e) => e.source_url && !/^https?:\/\//i.test(e.source_url))) return "evidence URLs must be http(s)";
  return null;
}

/** Canonical domain for competitor/company keys: 'https://www.Rival.co/x' → 'rival.co'. */
export function canonicalDomain(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null;
}
