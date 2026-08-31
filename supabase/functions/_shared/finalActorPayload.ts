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

import { ACTOR_INPUT_CONTRACTS } from "./actorInputContracts.ts";

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
    schemaVerifiedOn: "official:2026-07-30",
    requiredAnyOf: [["query", "urls"]],
    // POLICY, not schema: `maxItems` defaults to 50 and is optional, but an
    // unbounded discovery round is never something we want to pay for.
    requiredAll: ["maxItems"],
    forbidden: ["jobsToFetch", "count", "scrapeCompany", "useIncognitoMode", "splitByLocation", "limit", "maxResults", "keywords"],
  },
  glassdoor_job_discovery: {
    actorId: "valig/glassdoor-jobs-scraper",
    schemaVerifiedOn: "official:2026-07-30",
    requiredAnyOf: [],
    // BOTH REQUIRED by the actor. The previous inferred rule required neither and
    // accepted `query` as an alias for `keywords`, which this actor does not know.
    requiredAll: ["keywords", "location"],
    forbidden: ["urls", "count", "scrapeCompany", "useIncognitoMode", "splitByLocation", "jobsToFetch", "maxItems", "query", "maxResults"],
  },
  yc_job_discovery: {
    actorId: "parsebird/yc-jobs-scraper",
    schemaVerifiedOn: "official:2026-07-30",
    // `query` is NOT a field on this actor — only `searchQuery`.
    requiredAnyOf: [],
    requiredAll: [],
    forbidden: ["urls", "count", "scrapeCompany", "useIncognitoMode", "splitByLocation", "jobsToFetch", "maxItems", "limit", "query", "keywords", "location"],
  },
  ats_job_verification: {
    actorId: "bovi/greenhouse-lever-ashby-job-scraper",
    schemaVerifiedOn: "official:2026-07-30",
    // `companies` ONLY. The actor also accepts `presetLists`, but a preset bundle
    // turns this into unrestricted market discovery — which the product contract
    // forbids for a verification capability. Requiring `companies` is what makes
    // "ATS never runs without a known company identity" a local, testable rule
    // rather than a convention.
    requiredAll: ["companies"],
    requiredAnyOf: [],
    forbidden: ["useIncognitoMode", "splitByLocation", "presetLists", "urls", "count", "jobsToFetch", "maxItems", "limit"],
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
/**
 * Validate a payload against the actor's own verified contract.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * `RULES` below covers five job capabilities, each written after a specific
 * incident. Every company-side capability — search, details, employees, posts,
 * funding, news, technology, YC discovery — fell through to `ok: true`
 * unconditionally, so the last gate before a paid POST asserted nothing about
 * the calls that spend most of the money.
 *
 * `ACTOR_INPUT_CONTRACTS` already records each actor's verified fields, types
 * and enums. This reads that, rather than restating it: one schema source, and a
 * new actor is covered the moment its contract is added.
 */
/**
 * Arrays whose emptiness makes the call meaningless.
 *
 * Deliberately short. Every other array in every contract is a filter, and an
 * absent filter is a legitimate call.
 */
const REQUIRED_NON_EMPTY_ARRAYS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    apify_linkedin_company_details: ["companies"],
    apify_linkedin_job_search: ["company", "jobTitles"],
    apify_linkedin_company_employees: ["companies"],
  });

function validateAgainstContract(
  capability: string, payload: Record<string, unknown>,
): string[] {
  const contract = ACTOR_INPUT_CONTRACTS[capability];
  if (!contract) return [];
  const byName = new Map(contract.fields.map((f) => [f.name, f]));
  const violations: string[] = [];

  for (const [key, value] of Object.entries(payload)) {
    const field = byName.get(key);
    if (!field) {
      // An unknown key is another serializer's vocabulary, or a typo Apify will
      // silently ignore while charging for the run it did anyway.
      violations.push(`unsupported_field:${key}`);
      continue;
    }
    if (value === undefined || value === null) continue;

    // ARRAY VS SCALAR IS THE SHAPE THAT KEEPS BREAKING. `industries: "..."` is a
    // legal enum value in an illegal container, and iterating it yields one
    // violation per character.
    if (field.type === "array" && !Array.isArray(value)) {
      violations.push(`expected_array:${key}`);
      continue;
    }
    if (field.type !== "array" && Array.isArray(value)) {
      violations.push(`unexpected_array:${key}`);
      continue;
    }
    if (field.type === "integer" && !Number.isInteger(value)) {
      violations.push(`expected_integer:${key}`);
      continue;
    }
    if (field.type === "string" && typeof value !== "string") {
      violations.push(`expected_string:${key}`);
      continue;
    }
    if (field.type === "boolean" && typeof value !== "boolean") {
      violations.push(`expected_boolean:${key}`);
      continue;
    }
    if (field.type === "object" &&
        (typeof value !== "object" || Array.isArray(value))) {
      violations.push(`expected_object:${key}`);
      continue;
    }
    if (field.enum) {
      const vs = Array.isArray(value) ? value : [value];
      for (const v of vs) {
        if (!field.enum.includes(String(v))) {
          violations.push(`invalid_enum:${key}:${String(v)}`);
        }
      }
    }
    // AN EMPTY ARRAY IS ONLY WRONG WHERE THE ARRAY IS THE ARGUMENT.
    //
    // Not a blanket rule: `queries: []` is how memo23 says "no name filter" in
    // `mode: companies`, and rejecting it would refuse a payload production
    // sends correctly. Emptiness is a violation only for the fields that ARE the
    // call — the companies to enrich, the companies and titles to search.
    if (field.type === "array" && Array.isArray(value) && value.length === 0 &&
        (REQUIRED_NON_EMPTY_ARRAYS[capability] ?? []).includes(key)) {
      violations.push(`empty_array:${key}`);
    }
  }
  return violations;
}

export function validateFinalActorPayload(
  capability: string | null | undefined,
  payload: unknown,
): FinalPayloadVerdict {
  const isObject = !!payload && typeof payload === "object" && !Array.isArray(payload);
  const keys = isObject
    ? Object.keys(payload as Record<string, unknown>).sort()
    : [];

  // ── SHAPE FIRST, FOR EVERY CAPABILITY ────────────────────────────────────
  //
  // A top-level array or scalar is refused whether or not this capability has a
  // rule. It used to reach `ok: true` for anything unrecognised.
  if (!isObject) {
    return {
      ok: false, capability: String(capability ?? "unknown"), actorId: null,
      validatorVersion: FINAL_PAYLOAD_VALIDATOR_VERSION, schemaVerifiedOn: null,
      payloadKeys: [], violations: ["payload_not_object"],
    };
  }

  if (!isValidatedCapability(capability)) {
    // No bespoke rule — validate against the actor's own contract instead of
    // waving it through.
    const cap = String(capability ?? "unknown");
    const contractViolations = validateAgainstContract(
      cap, payload as Record<string, unknown>);
    if (keys.length === 0) contractViolations.unshift("empty_payload");
    return {
      ok: contractViolations.length === 0,
      capability: cap,
      actorId: ACTOR_INPUT_CONTRACTS[cap] ? cap : null,
      validatorVersion: FINAL_PAYLOAD_VALIDATOR_VERSION,
      schemaVerifiedOn: ACTOR_INPUT_CONTRACTS[cap]?.verified_at ?? null,
      payloadKeys: keys, violations: contractViolations,
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
  // AND the contract's own types/enums, where this capability has a contract.
  violations.push(...validateAgainstContract(capability, payload as Record<string, unknown>));

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
