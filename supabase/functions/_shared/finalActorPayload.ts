// THE LAST GATE BEFORE APIFY.
//
// Production task 2425ec4f (2026-07-30) proved the failure this module exists to
// stop. `compileHiringSourceInput` produced a correct, Crawlworks-native payload
// for `linkedin_job_discovery`:
//
//   { query, location, jobsToFetch: 18, timePostedRange, enrichCompanyDetails,
//     onSite, remote, hybrid, fullTime }
//
// which matches the actor's published input schema (verified 2026-07-30 against
// apify.com/crawlworks/linkedin-jobs-scraper/input-schema). It was then discarded:
// `toolRegistry` resolved the ACTOR from `ACTOR_REGISTRY` but the input ADAPTER
// from `APIFY_ACTORS[source_type]`, and because no `APIFY_ACTORS` entry has
// `actor_id === "crawlworks/linkedin-jobs-scraper"`, it fell back to the entry for
// `source_type: "jobs"` — the Curious-Coder serializer. Apify received
// `{ urls, count, scrapeCompany, useIncognitoMode, splitByLocation }` and answered
//
//   "Input is not valid: Field input.jobsToFetch is required"
//
// Two things were missing: the compiled payload was not treated as authoritative,
// and nothing validated the object that was actually about to be sent. Validating
// one object and invoking a different one is the defect, not the schema.
//
// SCOPE. This validates REQUIRED-FIELD PRESENCE and forbidden-key absence for the
// dynamic hiring-source capabilities. It is not a full JSON-schema validator and
// does not attempt to re-derive the provider's own rules — the compiler owns
// shaping. This owns "is the thing we are about to send the thing we compiled".
//
// PURE. No network, no provider call, no credential access.

/** Capabilities whose payload is compiled by `actorInputPlanner` and sent verbatim. */
export type ValidatedCapability =
  | "indeed_job_discovery"
  | "linkedin_job_discovery"
  | "glassdoor_job_discovery"
  | "yc_job_discovery"
  | "ats_job_verification";

export const FINAL_PAYLOAD_VALIDATOR_VERSION = "final-actor-payload-1.0.0";

interface CapabilityPayloadRule {
  /** The actor this capability resolves to. Recorded for the audit trail. */
  actorId: string;
  /**
   * Provenance of the required-field rule.
   *
   * `official:<date>` — re-read from the actor's published input schema in this
   * change. `compiler:<module>` — derived from the in-repo capability compiler's
   * own emitted shape, which is the authority that produces the payload. The
   * distinction is recorded rather than smoothed over: only one actor was
   * re-verified against Apify today.
   */
  schemaVerifiedOn: string;
  /**
   * At least one of each group must be present. Groups express real provider
   * alternatives — Crawlworks accepts `searchUrls` OR `query`, not neither.
   */
  requiredAnyOf: string[][];
  /** Keys that must be present outright. */
  requiredAll: string[];
  /**
   * Keys that prove the WRONG serializer produced this object. Their presence is
   * the signature of the Curious-Coder adapter, which is exactly what leaked into
   * the Crawlworks call.
   */
  forbidden: string[];
}

/**
 * Per-capability required-field rules.
 *
 * `forbidden` is deliberately narrow: it names the legacy serializer's own keys,
 * so a regression that re-routes a dynamic capability through the generic `jobs`
 * adapter fails HERE, locally, instead of at Apify's 400.
 */
const RULES: Record<ValidatedCapability, CapabilityPayloadRule> = {
  linkedin_job_discovery: {
    actorId: "crawlworks/linkedin-jobs-scraper",
    schemaVerifiedOn: "official:2026-07-30",
    requiredAnyOf: [["searchUrls", "query"]],
    requiredAll: ["jobsToFetch"],
    forbidden: ["urls", "count", "scrapeCompany", "useIncognitoMode", "splitByLocation", "maxItems"],
  },
  indeed_job_discovery: {
    actorId: "automation-lab/indeed-scraper",
    schemaVerifiedOn: "compiler:actorInputPlanner",
    requiredAnyOf: [["query", "urls"]],
    requiredAll: ["maxItems"],
    forbidden: ["jobsToFetch", "count", "scrapeCompany", "useIncognitoMode", "splitByLocation"],
  },
  glassdoor_job_discovery: {
    actorId: "valig/glassdoor-jobs-scraper",
    schemaVerifiedOn: "compiler:actorInputPlanner",
    requiredAnyOf: [["keywords", "query"]],
    requiredAll: [],
    forbidden: ["urls", "count", "scrapeCompany", "useIncognitoMode", "splitByLocation", "jobsToFetch"],
  },
  yc_job_discovery: {
    actorId: "parsebird/yc-jobs-scraper",
    schemaVerifiedOn: "compiler:actorInputPlanner",
    requiredAnyOf: [["searchQuery", "query"]],
    requiredAll: [],
    forbidden: ["urls", "count", "scrapeCompany", "useIncognitoMode", "splitByLocation", "jobsToFetch", "maxItems"],
  },
  ats_job_verification: {
    actorId: "bovi/greenhouse-lever-ashby-job-scraper",
    schemaVerifiedOn: "compiler:actorInputPlanner",
    requiredAnyOf: [],
    requiredAll: [],
    forbidden: ["useIncognitoMode", "splitByLocation"],
  },
};

export function isValidatedCapability(v: unknown): v is ValidatedCapability {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(RULES, v);
}

export interface FinalPayloadVerdict {
  ok: boolean;
  capability: string;
  actorId: string | null;
  validatorVersion: string;
  schemaVerifiedOn: string | null;
  /** Keys actually present on the payload. Names only — never values. */
  payloadKeys: string[];
  /** Codes, never provider prose. */
  violations: string[];
}

/**
 * Is this payload safe to send to this capability's actor?
 *
 * An unknown capability passes: legacy `apify_jobs` workflows do not compile
 * through this path and must be unaffected.
 */
export function validateFinalActorPayload(
  capability: string | null | undefined,
  payload: unknown,
): FinalPayloadVerdict {
  const keys = payload && typeof payload === "object" && !Array.isArray(payload)
    ? Object.keys(payload as Record<string, unknown>).sort()
    : [];

  if (!isValidatedCapability(capability)) {
    return {
      ok: true, capability: String(capability ?? "unknown"), actorId: null,
      validatorVersion: FINAL_PAYLOAD_VALIDATOR_VERSION, schemaVerifiedOn: null,
      payloadKeys: keys, violations: [],
    };
  }

  const rule = RULES[capability];
  const violations: string[] = [];

  if (keys.length === 0) violations.push("empty_payload");

  const present = new Set(keys);
  for (const group of rule.requiredAnyOf) {
    if (!group.some((k) => present.has(k))) {
      violations.push(`missing_required_any_of:${group.join("|")}`);
    }
  }
  for (const k of rule.requiredAll) {
    if (!present.has(k)) violations.push(`missing_required:${k}`);
  }
  for (const k of rule.forbidden) {
    // A forbidden key means another vendor's serializer produced this object.
    if (present.has(k)) violations.push(`foreign_serializer_key:${k}`);
  }

  return {
    ok: violations.length === 0,
    capability,
    actorId: rule.actorId,
    validatorVersion: FINAL_PAYLOAD_VALIDATOR_VERSION,
    schemaVerifiedOn: rule.schemaVerifiedOn,
    payloadKeys: keys,
    violations,
  };
}

/** The safe record of one final-payload decision. Key names and codes only. */
export function finalPayloadDiagnostics(v: FinalPayloadVerdict): Record<string, unknown> {
  return {
    capability_key: v.capability,
    actor_id: v.actorId,
    validator_version: v.validatorVersion,
    schema_verified_on: v.schemaVerifiedOn,
    final_payload_keys: v.payloadKeys,
    final_schema_validation: v.ok ? "passed" : "failed",
    violations: v.violations,
  };
}
