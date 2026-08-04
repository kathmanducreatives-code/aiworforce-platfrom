// WHAT SHAPE DOES THIS ACTOR ANSWER IN? — decided by the Actor, never by a default.
//
// TEST task 41342269-7664-4d23-960b-1e42ab0c25ee asked memo23 for YC COMPANIES,
// got 50 correct structured company rows back from Apify, and delivered 25
// LinkedIn-job records to the engine.
//
// The cause was one line in `runTool`:
//
//     const source_type = actorCfg?.source_type ?? normalizeApifySourceType(requested_source_type ?? "jobs");
//
// The capability engine sends `actor_id` + `selected_actor_key` and no
// `source_type`, and memo23 has no `APIFY_ACTORS` entry, so `actorCfg` was
// undefined and the whole response leg fell through to "jobs". Two things then
// happened, both silent:
//
//   * the dataset fetch was capped at 25 rows by the LinkedIn-Jobs pre-rank pool;
//   * every company row was rewritten by the JOBS normalizer, which nests the
//     original under `raw.provider_payload` and truncates it at 4,000 chars.
//
// `teamSize` and `openJobs` — the only two fields free commercial
// prequalification reads — were gone. It scored 25 companies with zero jobs and
// excluded all 25 as `insufficient_commercial`. Five of the nested payloads were
// truncated past recovery.
//
// THE RULE THIS MODULE EXISTS TO ENFORCE: a known Actor's response shape is a
// property OF THE ACTOR. It is never inferred from an absent request field, and
// a default is never allowed to reinterpret a company scraper as a job board.
//
// PURE. No network, no provider, no database.

export const RESPONSE_CONTRACT_VERSION = "provider-response-contract-v1" as const;

export type ProviderResponseKind =
  /** Complete company rows, exactly as the Actor emitted them. */
  | "structured_companies"
  | "jobs"
  | "people"
  | "profiles"
  | "generic";

/**
 * Actors whose output contract is a COMPLETE COMPANY ROW.
 *
 * Membership is by actor key AND actor id, because the two arrive
 * independently: the capability engine sends both, older callers send only one,
 * and a registry lookup can return neither.
 */
export const STRUCTURED_COMPANY_ACTOR_KEYS: ReadonlySet<string> = new Set([
  "apify_yc_companies_memo23",
  "apify_yc_companies_solidcode",
  "apify_linkedin_company_details",
  "apify_linkedin_company_search",
]);

export const STRUCTURED_COMPANY_ACTOR_IDS: ReadonlySet<string> = new Set([
  "memo23/y-combinator-scraper",
  "solidcode/ycombinator-scraper",
  "harvestapi/linkedin-company",
  "harvestapi/linkedin-company-search",
]);

/** Source-type aliases that genuinely mean "company row". */
const STRUCTURED_COMPANY_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "company_details", "companies", "company_search", "structured_companies",
]);

export interface ResponseKindInput {
  /** `selected_actor_key` as SENT by the caller — not the resolved registry key. */
  actorKey?: string | null;
  actorId?: string | null;
  /** The resolved source_type. Consulted last, and never as a fallback to "jobs". */
  sourceType?: string | null;
  /** An explicit `response_kind` on the envelope, when a caller states one. */
  declared?: string | null;
}

export class ProviderResponseContractError extends Error {
  readonly detail: Record<string, unknown>;
  constructor(message: string, detail: Record<string, unknown>) {
    super(message);
    this.name = "ProviderResponseContractError";
    this.detail = detail;
  }
}

function isStructuredCompanyActor(actorKey?: string | null, actorId?: string | null): boolean {
  return (!!actorKey && STRUCTURED_COMPANY_ACTOR_KEYS.has(actorKey)) ||
    (!!actorId && STRUCTURED_COMPANY_ACTOR_IDS.has(actorId));
}

/**
 * Decide how to read this Actor's response.
 *
 * PRECEDENCE IS DELIBERATE. The Actor's own identity wins over everything,
 * including a declared kind, because the Actor is the thing that actually
 * produced the bytes. `sourceType` is consulted only for Actors this module does
 * not know, and "jobs" is the last resort rather than the first.
 */
export function resolveResponseKind(i: ResponseKindInput): ProviderResponseKind {
  if (isStructuredCompanyActor(i.actorKey, i.actorId)) return "structured_companies";

  const declared = (i.declared ?? "").trim();
  if (declared === "structured_companies") {
    // A caller may NOT promote an unknown Actor to the structured path by
    // asserting it. Preserving a row shape we cannot verify is how a job record
    // would reach the company normalizer untouched.
    throw new ProviderResponseContractError(
      `response_kind "structured_companies" was declared for an actor that is not a known ` +
      `structured-company provider (actor_key=${i.actorKey ?? "null"}, actor_id=${i.actorId ?? "null"})`,
      { actor_key: i.actorKey ?? null, actor_id: i.actorId ?? null, declared },
    );
  }

  const st = (i.sourceType ?? "").trim().toLowerCase();
  if (STRUCTURED_COMPANY_SOURCE_TYPES.has(st)) return "structured_companies";
  if (st === "people_profiles") return "people";
  if (st === "linkedin_engagement" || st === "linkedin_comments") return "profiles";
  if (st && !/jobs/i.test(st)) return "generic";
  return "jobs";
}

/**
 * FAIL CLOSED when the Actor and the requested shape disagree.
 *
 * Asking a company scraper for jobs is not a preference, it is a bug — and the
 * silent version of it cost this project a paid run whose 50 correct rows were
 * discarded. It must surface as an error, not as 25 fabricated job records.
 */
export function assertResponseKindConsistent(i: ResponseKindInput): ProviderResponseKind {
  const kind = resolveResponseKind(i);
  const st = (i.sourceType ?? "").trim().toLowerCase();
  if (kind === "structured_companies" && st && /jobs/i.test(st)) {
    throw new ProviderResponseContractError(
      `actor ${i.actorId ?? i.actorKey} returns structured companies but the response was about ` +
      `to be read as "${st}". A company scraper must never take the jobs path.`,
      { actor_key: i.actorKey ?? null, actor_id: i.actorId ?? null, source_type: st, resolved_kind: kind },
    );
  }
  return kind;
}

// ------------------------------------------------------------- result read ----

/** The count ledger a company-discovery response must carry. */
export interface ResultCountLedger {
  /** What the Actor's dataset endpoint was asked for. */
  requested_limit: number;
  /** Rows actually downloaded from the dataset. */
  downloaded: number;
  /** Rows returned to the caller, after any cap. */
  returned: number;
  /** True when `returned < downloaded` — the caller is seeing less than we read. */
  truncated: boolean;
  truncation_reason: string | null;
}

export function buildCountLedger(
  requested_limit: number, downloaded: number, returned: number, reason: string | null,
): ResultCountLedger {
  return {
    requested_limit, downloaded, returned,
    truncated: returned < downloaded,
    truncation_reason: returned < downloaded ? reason : null,
  };
}

export interface ProviderResultEnvelope {
  items?: unknown;
  company_items?: unknown;
  [k: string]: unknown;
}

/**
 * Read the rows out of a provider result WITHOUT flattening or truncating them.
 *
 * The structured branch has historically returned rows under `company_items`
 * while every consumer read `items`, so a correct company response arrived as
 * `[]`. That is still true on this branch for `apify_linkedin_company_details`
 * — company enrichment gets zero rows today and nobody has noticed, because
 * identity resolution never produced a URL to enrich.
 *
 * Both keys are read here, and `items` is populated alongside `company_items` at
 * the producing end, so the two can never disagree again.
 */
export function readProviderResultItems(
  result: ProviderResultEnvelope | null | undefined,
  kind: ProviderResponseKind,
): Record<string, unknown>[] {
  if (!result || typeof result !== "object") return [];
  const pick = (v: unknown) => Array.isArray(v) ? v as Record<string, unknown>[] : null;
  if (kind === "structured_companies") {
    // `company_items` first: when both exist they are the same rows, and this
    // is the field the structured branch has always been authoritative on.
    return pick(result.company_items) ?? pick(result.items) ?? [];
  }
  return pick(result.items) ?? [];
}

/**
 * Do these rows still carry the fields a company decision needs?
 *
 * Used as a VISIBLE failure rather than a silent zero: a structured response
 * whose rows have been job-normalized has `raw.provider_payload` and no
 * top-level `teamSize`, which is exactly what this returns false for.
 */
export function structuredRowsLookIntact(
  rows: readonly Record<string, unknown>[],
): { intact: boolean; reason: string | null } {
  if (rows.length === 0) return { intact: true, reason: null };
  const nested = rows.filter((r) => {
    const raw = r.raw as Record<string, unknown> | undefined;
    return !!raw && typeof raw === "object" && "provider_payload" in raw;
  }).length;
  if (nested > 0) {
    return {
      intact: false,
      reason: `${nested}/${rows.length} rows carry raw.provider_payload — they were job-normalized`,
    };
  }
  return { intact: true, reason: null };
}
