// ONE canonical resolver for "is there a verified decision-maker we may write to?"
//
// WHY THIS EXISTS
//   The 2026-07-19 production batch blocked every lead with
//   `blocked_missing_verified_person` while the Workbench visibly displayed three
//   verified people per account. Both statements were true of different storage
//   locations:
//
//     raw.decision_makers                              ← verified people (legacy)
//     raw.agentory_workbench.decision_makers           ← status "not_started"
//
//   Those people were found by a decision-maker run that predates the namespaced
//   Workbench dual-write, so the namespace was never backfilled. The opener
//   backend read ONLY the namespace and concluded nobody existed.
//
//   This is a READ-TIME compatibility gap, not missing data — so it is fixed by
//   reading both, in a defined order, in one place. No migration.
//
// ALIAS HANDLING LIVES HERE AND NOWHERE ELSE. Callers get canonical fields.
//
// This does NOT lower the eligibility bar. A legacy record is accepted only when
// it independently proves what the namespace would have proved: verification
// status, a verified employer match, an identity and provider provenance.

// ------------------------------------------------------------------- types ----

export interface ResolvedPerson {
  contact_id?: string | null;
  full_name: string;
  first_name?: string | null;
  linkedin_url: string;
  current_title?: string | null;
  current_company_name?: string | null;
  role_family?: string | null;
  verification_status: "verified";
  verification_methods: string[];
  rank?: number | null;
  persisted: boolean;
}

export type DecisionMakerResolutionStatus = "verified" | "missing" | "contract_invalid";

export type DecisionMakerResolutionSource =
  | "workbench_last_success"
  | "legacy_decision_makers"
  | "none";

export interface DecisionMakerResolution {
  status: DecisionMakerResolutionStatus;
  source: DecisionMakerResolutionSource;
  person?: ResolvedPerson;
  reason_code: string;
}

/** Minimal shape of the namespaced stage this resolver needs. */
export interface WorkbenchDecisionMakerStage {
  status?: string | null;
  last_success?: {
    verified_count?: number;
    primary_full_name?: string | null;
    primary_linkedin_url?: string | null;
    primary_role_family?: string | null;
    primary_company_name?: string | null;
    primary_verification_methods?: string[];
    contact_id?: string | null;
  } | null;
}

// --------------------------------------------------------------- primitives ----

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : [];
}

/**
 * A usable profile URL. Deliberately strict: a bare name fragment, a relative
 * path or a non-http scheme is not proof of identity.
 */
function profileUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : null;
  } catch {
    return null;
  }
}

/**
 * Namespaced stage states that mean "the question was actually asked and
 * answered negatively". We must NOT fall back to a legacy array in these cases —
 * a newer authoritative rejection outranks an older stored success.
 */
const NAMESPACE_DECIDED_NEGATIVE: ReadonlySet<string> = new Set([
  "no_match",
  "rejected",
  "contract_invalid",
]);

// ------------------------------------------------------------ legacy record ----

/**
 * Accept a legacy `raw.decision_makers` entry ONLY when it independently proves
 * eligibility. Each check below replaces a guarantee the namespace would have
 * carried.
 */
function acceptLegacyPerson(raw: unknown): ResolvedPerson | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;

  // 1. Explicitly verified. "likely" / "unverified" / absent are all rejected.
  if (str(p.verification_status) !== "verified") return null;

  // 2. A VERIFIED employer match. Person-exists is not person-works-there.
  const match = (p.company_match ?? {}) as Record<string, unknown>;
  if (str(match.status) !== "verified") return null;

  // 3. Identity. `full_name` is canonical; `name` is the legacy alias.
  const full_name = str(p.full_name) ?? str(p.name);
  if (!full_name) return null;

  // 4. A real profile URL. `linkedin_url` canonical, `linkedinUrl` legacy alias.
  const linkedin_url = profileUrl(p.linkedin_url) ?? profileUrl(p.linkedinUrl) ?? profileUrl(p.evidence_url);
  if (!linkedin_url) return null;

  // 5. Provider provenance. A hand-entered row is not a provider-verified person.
  if (p.persisted !== true) return null;

  const verification_methods = strArray(p.verification_methods);
  if (verification_methods.length === 0) return null;

  const rankRaw = p.rank;
  const rank = typeof rankRaw === "number" && Number.isFinite(rankRaw) ? rankRaw : null;

  return {
    contact_id: str(p.contact_id),
    full_name,
    first_name: full_name.split(/\s+/)[0] ?? null,
    linkedin_url,
    current_title: str(p.current_title) ?? str(p.title),
    current_company_name: str(p.current_company_name) ?? str(p.company_name) ?? str(p.company),
    role_family: str(p.role_family),
    verification_status: "verified",
    verification_methods,
    rank,
    persisted: true,
  };
}

/**
 * A legacy entry that CLAIMS verification but cannot back it up is a contract
 * violation, not an absence — the difference between "nobody was found" and
 * "something is wrong with what we stored".
 */
function claimsVerified(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const p = raw as Record<string, unknown>;
  return str(p.verification_status) === "verified";
}

// -------------------------------------------------------------- the resolver ---

export function resolveVerifiedDecisionMakerForOutreach(input: {
  workbenchDecisionMakers?: WorkbenchDecisionMakerStage | null;
  legacyDecisionMakers?: unknown;
}): DecisionMakerResolution {
  const stage = input.workbenchDecisionMakers ?? null;
  const stageStatus = str(stage?.status) ?? "";
  const last = stage?.last_success ?? null;

  // ---- 1. Namespaced last_success wins whenever it is usable. ---------------
  //
  // `last_success` is durable by construction (mergeStage never clears it on a
  // later failure), so a failed latest attempt cannot erase a valid person here.
  if (last) {
    const full_name = str(last.primary_full_name);
    const linkedin_url = profileUrl(last.primary_linkedin_url);
    const methods = strArray(last.primary_verification_methods);
    const verifiedCount = typeof last.verified_count === "number" ? last.verified_count : 0;

    if (full_name && linkedin_url && methods.length > 0 && verifiedCount > 0) {
      return {
        status: "verified",
        source: "workbench_last_success",
        reason_code: "verified_person_resolved",
        person: {
          contact_id: str(last.contact_id),
          full_name,
          first_name: full_name.split(/\s+/)[0] ?? null,
          linkedin_url,
          current_title: null,
          current_company_name: str(last.primary_company_name),
          role_family: str(last.primary_role_family),
          verification_status: "verified",
          verification_methods: methods,
          rank: 1,
          persisted: true,
        },
      };
    }

    // A recorded success that cannot be read back is a contract violation. It
    // must NOT silently degrade into a legacy lookup.
    return {
      status: "contract_invalid",
      source: "workbench_last_success",
      reason_code: "blocked_person_contract_invalid",
    };
  }

  // ---- 2. The namespace holds a real negative answer → respect it. ----------
  if (NAMESPACE_DECIDED_NEGATIVE.has(stageStatus)) {
    return {
      status: stageStatus === "contract_invalid" ? "contract_invalid" : "missing",
      source: "none",
      reason_code: stageStatus === "contract_invalid"
        ? "blocked_person_contract_invalid"
        : "blocked_missing_verified_person",
    };
  }

  // ---- 3. The namespace was never answered → legacy fallback is allowed. ----
  //
  // Any other stage status (e.g. "running", "failed") is treated as
  // never-answered for READ purposes: it does not assert that no person exists,
  // and the legacy array may still hold a previously persisted verified success.
  const legacyArray = Array.isArray(input.legacyDecisionMakers) ? input.legacyDecisionMakers : [];
  if (legacyArray.length === 0) {
    return {
      status: "missing",
      source: "none",
      reason_code: "blocked_missing_verified_person",
    };
  }

  const accepted = legacyArray
    .map(acceptLegacyPerson)
    .filter((p): p is ResolvedPerson => p !== null)
    // Canonical rank order; an unranked person sorts last rather than first.
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));

  if (accepted.length > 0) {
    return {
      status: "verified",
      source: "legacy_decision_makers",
      reason_code: "verified_person_resolved",
      person: accepted[0],
    };
  }

  // Nothing was accepted. Distinguish "stored data claims a verification it
  // cannot support" from "no verified person was ever found".
  if (legacyArray.some(claimsVerified)) {
    return {
      status: "contract_invalid",
      source: "legacy_decision_makers",
      reason_code: "blocked_person_contract_invalid",
    };
  }

  return {
    status: "missing",
    source: "none",
    reason_code: "blocked_missing_verified_person",
  };
}
