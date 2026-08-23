// BUYING A CONTACT METHOD FOR A PERSON WE ALREADY FOUND.
//
// ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
//
// `contact_unlock` charged 2 credits and called `runFounderUnlock` — the same
// LinkedIn people SEARCH the founder unlock had just run. The endpoint never
// branched on `unlock_type`; it used the field for a replay lookup, a ledger
// kind, a log line and a stored record, and then ran founder discovery again.
// `UnlockedPerson` carries no email and no phone, so the second purchase could
// not have delivered a contact method under any circumstances, and
// `founder_unlock_required_first` made it mandatory rather than optional.
//
// ── THE SHAPE THAT MAKES THIS DIFFERENT ─────────────────────────────────────
//
//   DISCOVERY   takes a COMPANY, returns candidate people, pays a start fee,
//               ranks and verifies. "Who is the buyer here?"
//   ENRICHMENT  takes a PERSON who is already resolved, returns more about
//               them, no start fee, no ranking. "What else do we know about
//               them, and can we reach them?"
//
// This module is the second one, and it refuses to be the first: with no
// resolved person it does not search, it declines.
//
// ── AN EMAIL LOOKUP IS AN ATTEMPT, NOT A PROMISE ────────────────────────────
//
// The Actor's paid event is "Profile details + email search" — a SEARCH. It
// bills whether or not an address comes back. So `not_found` is a first-class
// outcome here, distinct from a failure, and it is never softened into a
// guess: no name+domain construction, no pattern inference, no "likely" address.
// A user who paid for a miss is owed the word "none", not a fabrication.
//
// NO PHONE. Not "not yet" — the registered Actor returns none, and no other
// Actor in the catalog does either. A contact unlock that implied phone
// coverage would be selling something nothing here can produce.
//
// PURE. The provider is injected. No network, database or model access.

import {
  compileHarvestProfileScraperInput, type CompiledActorCall,
} from "./hiringActorInputs.ts";
import {
  PROFILE_SCRAPER_MODES, PROFILE_SCRAPER_EMAIL_MODE,
} from "./hiringActorCatalog.ts";

export const CONTACT_ENRICHMENT_VERSION = "contact-enrichment-v1" as const;

/** The one Actor this door may open. Nothing else is reachable from here. */
export const CONTACT_ENRICHMENT_ACTOR = "apify_linkedin_profile_enrichment" as const;

/**
 * The person to enrich, as decision-maker discovery left them.
 *
 * ── THREE IDENTIFIERS, IN PREFERENCE ORDER ─────────────────────────────────
 *
 * `company-employees` returns the opaque `ACwAAA…` member id and NEVER a vanity
 * slug — its own `company_employees_opaque_profile_url` defect says so. The
 * enrichment Actor accepts that form in `profileIds`, and putting it in `urls`
 * is the mistake the routing below exists to prevent.
 */
export interface ResolvedPerson {
  /** Stable provider id — the opaque member id, when discovery had one. */
  source_profile_id?: string | null;
  /** Profile URL as stored. May be the opaque form or a vanity slug. */
  linkedin_url?: string | null;
  full_name?: string | null;
  title?: string | null;
}

export type ContactRefusal =
  | "no_resolved_person"
  | "no_usable_profile_identifier"
  | "not_authorized"
  | "already_enriched";

export type ContactOutcomeStatus =
  /** An address was found and is quoted from the provider. */
  | "email_found"
  /** The lookup ran, was paid for, and returned nothing. An ANSWER. */
  | "not_found"
  /** The provider failed. NOT the same as "there is no email". */
  | "provider_error"
  /** Refused before any spend. */
  | "refused";

export interface ContactEvidenceRecord {
  status: ContactOutcomeStatus;
  /** The provider's own value, never constructed. */
  business_email: string | null;
  /** Where it came from, so a claim can be checked. */
  email_source: string | null;
  /**
   * ALWAYS NULL, and present so nobody adds it silently.
   *
   * No registered Actor returns a phone number. A field that quietly appeared
   * with a value would mean somebody wired in a provider nobody carded.
   */
  phone: null;
  linkedin_url: string | null;
  full_name: string | null;
  title: string | null;
  /** What was asked for and could not be established. */
  missing: string[];
  reason: string;
}

export interface ContactEnrichmentDeps {
  invoke: (call: CompiledActorCall<unknown>) => Promise<Record<string, unknown>[]>;
}

export interface ContactEnrichmentRequest {
  person: ResolvedPerson | null;
  /** The user pressed Find Contact Details. Never defaulted true. */
  emailLookupAuthorized: boolean;
  /**
   * What is already held for this person.
   *
   * REUSE IS CHECKED HERE, not only by the caller, because this module is the
   * one that would otherwise spend. See `contactAlreadyHeld`.
   */
  existing?: ContactEvidenceRecord | null;
}

export interface ContactEnrichmentOutcome {
  /** Did a provider actually execute? THE BILLING TURNS ON THIS. */
  provider_ran: boolean;
  record: ContactEvidenceRecord;
  refusal: ContactRefusal | null;
  /** The call as compiled, for the audit trail. Null when nothing ran. */
  call: CompiledActorCall<unknown> | null;
}

/**
 * Do we already hold a contact answer for this person?
 *
 * ── `not_found` COUNTS AS HELD ─────────────────────────────────────────────
 *
 * A paid lookup that returned nothing is an ANSWER about this person, and
 * running it again buys the same nothing at the same price. Re-running is only
 * right after the underlying facts change — a new employer, a new profile —
 * which is a different person record, not a retry of this one.
 *
 * `provider_error` is NOT held: nothing was established, and a retry is exactly
 * what should happen.
 */
export function contactAlreadyHeld(
  existing: ContactEvidenceRecord | null | undefined,
): boolean {
  if (!existing) return false;
  return existing.status === "email_found" || existing.status === "not_found";
}

/**
 * Which identifier field this person belongs in.
 *
 * Returns the payload fragment rather than a string, so the CALLER cannot put
 * an opaque member id in `urls` — the shape decides, not a convention someone
 * has to remember.
 */
export function profileTargetFor(
  person: ResolvedPerson,
): { profileIds: string[] } | { urls: string[] } | null {
  const id = (person.source_profile_id ?? "").toString().trim();
  // The opaque form, from `company-employees`. Its own field.
  if (id) return { profileIds: [id] };

  const url = (person.linkedin_url ?? "").toString().trim();
  if (!url) return null;
  // A stored URL may itself be the opaque member form. Route it by shape.
  const opaque = /\/in\/(ACw[A-Za-z0-9_-]+)/.exec(url);
  if (opaque) return { profileIds: [opaque[1]] };
  if (/linkedin\.com\/in\//i.test(url)) return { urls: [url] };
  return null;
}

const refuse = (
  refusal: ContactRefusal, reason: string, person?: ResolvedPerson | null,
): ContactEnrichmentOutcome => ({
  provider_ran: false,
  refusal,
  call: null,
  record: {
    status: "refused",
    business_email: null, email_source: null, phone: null,
    linkedin_url: person?.linkedin_url ?? null,
    full_name: person?.full_name ?? null,
    title: person?.title ?? null,
    missing: ["business_email"],
    reason,
  },
});

/**
 * Read an address out of a provider row.
 *
 * ── ONLY WHAT THE PROVIDER SAID ────────────────────────────────────────────
 *
 * Several plausible spellings of ONE fact are accepted, because the Actor's
 * output schema names `email` and adjacent scrapers use `emailAddress` or
 * `workEmail`. No alias crosses between facts, and nothing is assembled: a
 * first name and a company domain are not an email address, and the single
 * most damaging thing this module could do is behave as though they were.
 */
export function readProviderEmail(row: Record<string, unknown>): string | null {
  for (const key of ["email", "emailAddress", "workEmail", "businessEmail"]) {
    const v = row[key];
    if (typeof v === "string" && v.includes("@") && v.trim().length > 3) {
      return v.trim().toLowerCase();
    }
  }
  return null;
}

/**
 * Enrich one known person, buying an email lookup only when authorised.
 */
export async function runContactEnrichment(
  req: ContactEnrichmentRequest, deps: ContactEnrichmentDeps,
): Promise<ContactEnrichmentOutcome> {
  // ── 1. NEVER PURCHASE WHAT WE ALREADY HAVE ───────────────────────────────
  if (contactAlreadyHeld(req.existing)) {
    return {
      provider_ran: false,
      refusal: "already_enriched",
      call: null,
      record: {
        ...req.existing!,
        reason: `already established (${req.existing!.status}); nothing was purchased again`,
      },
    };
  }

  // ── 2. THIS ACTOR DOES NOT SEARCH ────────────────────────────────────────
  if (!req.person) {
    return refuse("no_resolved_person",
      "no decision maker has been resolved for this company. Contact enrichment " +
      "takes a person; it cannot find one. Run Find Decision Maker first.");
  }
  const target = profileTargetFor(req.person);
  if (!target) {
    return refuse("no_usable_profile_identifier",
      "the resolved person carries no LinkedIn profile id or URL, so there is " +
      "nothing to enrich.", req.person);
  }

  // ── 3. CONSENT IS EXPLICIT ───────────────────────────────────────────────
  if (req.emailLookupAuthorized !== true) {
    return refuse("not_authorized",
      "an email lookup is a separate, separately-priced action and was not " +
      "authorised.", req.person);
  }

  const compiled = compileHarvestProfileScraperInput({
    ...target,
    profileScraperMode: PROFILE_SCRAPER_EMAIL_MODE,
    emailLookupAuthorized: true,
  });
  if (!compiled.ok) {
    return refuse("no_usable_profile_identifier",
      `the enrichment call did not compile: ${compiled.errors.join("; ")}`,
      req.person);
  }

  let rows: Record<string, unknown>[];
  try {
    rows = await deps.invoke(compiled);
  } catch (err) {
    // A PROVIDER FAILURE IS NOT A NEGATIVE FACT. "We could not check" and "we
    // checked and there is nothing" are different answers and only one of them
    // should stop a user retrying.
    return {
      provider_ran: true, refusal: null, call: compiled,
      record: {
        status: "provider_error",
        business_email: null, email_source: null, phone: null,
        linkedin_url: req.person.linkedin_url ?? null,
        full_name: req.person.full_name ?? null,
        title: req.person.title ?? null,
        missing: ["business_email"],
        reason: `the enrichment provider failed: ${String(err)}. This is not ` +
          `evidence that no address exists.`,
      },
    };
  }

  const row = rows[0] ?? {};
  const email = readProviderEmail(row);

  return {
    provider_ran: true,
    refusal: null,
    call: compiled,
    record: {
      status: email ? "email_found" : "not_found",
      business_email: email,
      email_source: email ? CONTACT_ENRICHMENT_ACTOR : null,
      phone: null,
      linkedin_url: (typeof row.linkedinUrl === "string" ? row.linkedinUrl : null)
        ?? req.person.linkedin_url ?? null,
      full_name: req.person.full_name ?? null,
      title: req.person.title ?? null,
      missing: email ? [] : ["business_email"],
      reason: email
        ? `business email supplied by ${CONTACT_ENRICHMENT_ACTOR}`
        : "the email lookup ran and returned no address. This is an answer " +
          "about this person, not a failure, and re-running buys the same " +
          "nothing at the same price.",
    },
  };
}

/** The modes this capability may use. Exported so a test can pin the pair. */
export const CONTACT_ENRICHMENT_MODES = PROFILE_SCRAPER_MODES;
