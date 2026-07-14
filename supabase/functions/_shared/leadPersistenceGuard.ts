// Centralized lead-persistence guard. Pure / deterministic (imports only
// leadHandoffGuard + leadProvenance). This is the single choke point every
// provider-sourced lead_candidates insert/upsert must pass BEFORE writing: an
// invalid provenance record must LITERALLY prevent the database write — stamping
// provider_provenance.verified=false and inserting anyway is NOT allowed.
//
// It also defines explicit lead origins, immutable provenance sealing, and the
// canonical no_results terminal payload.

import {
  buildProvenanceRecord, assertPersistenceProvenance, provenanceMatchesRun,
  type NormalizedProviderItem, type ProviderProvenanceRecord, type ProvenanceCtx,
} from "./leadHandoffGuard.ts";

// ---------------------------------------------------------------- lead origin --

export type LeadOrigin = "provider_sourced" | "user_entered" | "imported" | "internal_fixture";

export const LEAD_ORIGINS: ReadonlySet<LeadOrigin> = new Set(["provider_sourced", "user_entered", "imported", "internal_fixture"]);

/** internal_fixture is test-only; it must never be persisted in production runtime. */
export function assertProductionOrigin(origin: LeadOrigin): { ok: boolean; reason: string | null } {
  if (origin === "internal_fixture") return { ok: false, reason: "internal_fixture leads are prohibited in production runtime" };
  if (!LEAD_ORIGINS.has(origin)) return { ok: false, reason: `unknown lead origin "${origin}"` };
  return { ok: true, reason: null };
}

// --------------------------------------------------------- structured reasons --

export type ProvenanceRejectionReason =
  | "missing_provider" | "missing_actor_id" | "missing_provider_run_id" | "missing_source_url"
  | "missing_normalized_candidate_id" | "workflow_run_mismatch" | "plan_id_mismatch"
  | "unsupported_company_identity" | "unsupported_person_identity" | "unsupported_evidence_url"
  | "ambiguous_provider_match" | "unverified_person_company_association" | "missing_provider_provenance"
  | "unsupported_person_identity_person_level" | "internal_fixture_in_production";

/** Map the low-level assert reason string to a stable structured reason code. */
function toStructuredReason(reason: string | null): ProvenanceRejectionReason {
  const r = (reason ?? "").toLowerCase();
  // Order matters — check the specific field names BEFORE the generic
  // "missing provider" (which is a substring of "missing provider_run_id").
  if (r.includes("missing provider_provenance")) return "missing_provider_provenance";
  if (r.includes("actor_id")) return "missing_actor_id";
  if (r.includes("provider_run_id")) return "missing_provider_run_id";
  if (r.includes("workflow_run_id")) return "missing_provider_run_id";
  if (r.includes("source_url")) return "missing_source_url";
  if (r.includes("normalized_candidate_id")) return "missing_normalized_candidate_id";
  if (r.includes("person-level") || r.includes("person_linkedin_url")) return "unsupported_person_identity_person_level";
  if (r.includes("plan_id")) return "plan_id_mismatch";
  if (r.includes("missing provider")) return "missing_provider";
  return "ambiguous_provider_match";
}

export interface RejectionCounter {
  count: number;
  reasons: Record<string, number>;
}
export function newRejectionCounter(): RejectionCounter { return { count: 0, reasons: {} }; }
export function recordRejection(counter: RejectionCounter, reason: ProvenanceRejectionReason): void {
  counter.count += 1;
  counter.reasons[reason] = (counter.reasons[reason] ?? 0) + 1;
}

// ---------------------------------------------------- provider-insert guard ----

export interface GuardResult {
  allow: boolean;
  origin: LeadOrigin;
  provenance: ProviderProvenanceRecord | null;
  reason: ProvenanceRejectionReason | null;
}

/**
 * THE pre-insert guard for a provider-sourced lead. Builds the provenance record
 * from the normalized provider item + run context, then requires
 * verified=true AND that it belongs to the current run. Any failure ⇒ allow=false,
 * and the caller MUST NOT insert/upsert. A high fit score / confidence / canonical
 * decision can never override a failure here.
 *
 * user_entered / imported leads do not require provider provenance, but they may
 * NOT claim provider verification (provenance stays null / verified=false).
 */
export function guardProviderLeadInsert(args: {
  origin: LeadOrigin;
  item: NormalizedProviderItem;
  ctx: ProvenanceCtx;
  /** Force person-level validation (requires person_linkedin_url) even if the item
   * lacks a profile URL — so a name-only "person" is never accepted as an account. */
  level?: "account" | "person";
  counter?: RejectionCounter;
}): GuardResult {
  const { origin, item, ctx } = args;

  const prodOk = assertProductionOrigin(origin);
  if (!prodOk.ok) {
    if (args.counter) recordRejection(args.counter, "internal_fixture_in_production");
    return { allow: false, origin, provenance: null, reason: "internal_fixture_in_production" };
  }

  // Non-provider origins: allowed without provider provenance, but they cannot
  // claim provider verification.
  if (origin !== "provider_sourced") {
    return { allow: true, origin, provenance: null, reason: null };
  }

  const provenance = buildProvenanceRecord(item, ctx);
  // A caller that KNOWS this is a person lead forces person-level validation, so a
  // name-only person (no profile URL) can't slip through as an account lead.
  if (args.level === "person" && provenance.level !== "person") {
    provenance.level = "person";
    provenance.verified = false;
  }
  const check = assertPersistenceProvenance(provenance);
  if (!check.ok) {
    const reason = toStructuredReason(check.reason);
    if (args.counter) recordRejection(args.counter, reason);
    return { allow: false, origin, provenance, reason };
  }
  // Must belong to the current run (no stale/cross-run provenance ride-along).
  if (!provenanceMatchesRun(provenance, ctx)) {
    if (args.counter) recordRejection(args.counter, "workflow_run_mismatch");
    return { allow: false, origin, provenance, reason: "workflow_run_mismatch" };
  }
  // provenance.verified is set true by buildProvenanceRecord only when valid.
  if (provenance.verified !== true) {
    const reason = toStructuredReason(assertPersistenceProvenance(provenance).reason);
    if (args.counter) recordRejection(args.counter, reason);
    return { allow: false, origin, provenance, reason };
  }
  return { allow: true, origin, provenance, reason: null };
}

// ------------------------------------------------------- provenance immutability

/** Fields a downstream agent (Aria / memoryWriter / scoring / LLM) may never change. */
export const PROTECTED_PROVENANCE_FIELDS = [
  "provider", "actor_id", "provider_run_id", "provider_item_id", "normalized_candidate_id",
  "source_url", "company_domain", "company_linkedin_url", "person_linkedin_url",
  "evidence_url", "workflow_run_id", "plan_id", "trace_id",
] as const;

export interface SealResult {
  provenance: ProviderProvenanceRecord;
  provenance_overwrite_attempt: boolean;
}

/**
 * Preserve a trusted provider_provenance block against any incoming block that
 * tries to overwrite a protected field. When `trusted` exists, it wins verbatim;
 * if `incoming` differs on any protected field, we discard the incoming values and
 * flag provenance_overwrite_attempt=true. Score/confidence/decision are irrelevant.
 */
export function sealProvenance(
  trusted: ProviderProvenanceRecord | null | undefined,
  incoming: ProviderProvenanceRecord | null | undefined,
): SealResult {
  if (!trusted) {
    // No trusted block yet — accept the incoming as the new trusted record.
    return { provenance: (incoming ?? null) as ProviderProvenanceRecord, provenance_overwrite_attempt: false };
  }
  let attempt = false;
  if (incoming) {
    const t = trusted as unknown as Record<string, unknown>;
    const inc = incoming as unknown as Record<string, unknown>;
    for (const f of PROTECTED_PROVENANCE_FIELDS) {
      const a = t[f];
      const b = inc[f];
      const an = (a ?? "").toString().trim().toLowerCase();
      const bn = (b ?? "").toString().trim().toLowerCase();
      if (bn && an && bn !== an) { attempt = true; break; }
    }
  }
  // Trusted block is returned unchanged regardless of the incoming attempt.
  return { provenance: trusted, provenance_overwrite_attempt: attempt };
}

// ----------------------------------------------------------- no_results terminal

export interface NoResultsPayload {
  status: "no_results";
  leads: [];
  qualified_count: 0;
  contact_ready_count: 0;
  persisted_lead_count: 0;
  rejected_provenance_count: number;
  next_step: null;
}

/** The canonical no_results terminal. Aria/Penn are not invoked; nothing persists. */
export function buildNoResults(rejected_provenance_count = 0): NoResultsPayload {
  return {
    status: "no_results",
    leads: [],
    qualified_count: 0,
    contact_ready_count: 0,
    persisted_lead_count: 0,
    rejected_provenance_count: Math.max(0, rejected_provenance_count | 0),
    next_step: null,
  };
}
