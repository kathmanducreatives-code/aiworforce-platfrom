// QUALIFIED-LEAD ROUTING DECISION.
//
// The 2026-07-26 manual run asked for "founders … Return 5 qualified leads" and was
// routed to the legacy account-opportunity workflow in `fast` mode, so the whole
// company-first runtime (quota controller, employer verification, checkpoint/resume)
// was unreachable from the product.
//
// This module makes the choice DETERMINISTIC and explainable. It runs before any
// model/template output and wins over it: a request that explicitly names people to
// contact, or a final lead quota, is a qualified-lead request — never an
// account-only signal scan.

import { inferVertical, type CompanyVertical as TaxonomyVertical } from "./jobIntentTaxonomy.ts";

export type WorkflowKind = "account_opportunity_sourcing" | "qualified_lead_sourcing";
export type WorkflowExecutionMode = "fast" | "company_first";

export interface QualifiedLeadRoute {
  workflowKind: WorkflowKind;
  executionMode: WorkflowExecutionMode;
  reasonCodes: string[];
  /** What the requested count actually counts. */
  countEntity: "account_opportunity" | "contact_ready_lead";
  quotaPolicy: "contact_only" | "account_only";
}

/**
 * Signals that the user wants PEOPLE they can contact, not just companies.
 *
 * `prospects?` and the bare `who (should i|to|can i|do i) contact/reach out
 * to/target/talk to/email/message` phrasing mirror `PERSON_NOUN_RE` /
 * `WHO_TO_CONTACT_RE` in `leadEntityIntent.ts` — this module cannot import
 * that file (the reverse import already exists, for
 * `extractRequestedLeadCount`, so that would be a cycle), so the vocabulary
 * is reproduced here rather than re-derived from scratch.
 */
const PERSON_TARGET_RE = /\b(founders?|co-?founders?|owners?|ceos?|presidents?|decision[-\s]?makers?|people to contact|contacts?|executives?|prospects?)\b/i;
const WHO_TO_CONTACT_RE = /\bwho (?:should i|to|can i|do i)\s+(?:contact|reach out to|target|talk to|email|message)\b/i;
/**
 * `draft outreach`/`for outbound` added 2026-08-09: "...and draft outreach"
 * and "...hiring SDRs... for outbound" both named explicit contact/outreach
 * intent that fell through every existing phrase here (which required the
 * fuller "reach out to"). Phrase-bound, NOT bare "outreach"/"outbound" —
 * `leadPlannerCallSite.test.ts`'s own NON_LEAD_REQUEST fixture is "write me a
 * linkedin post about outbound", a content request with no lead-sourcing
 * intent at all; a bare-word match would have wrongly rerouted it.
 */
const QUALIFIED_LEAD_RE = /\b(qualified leads?|contact[-\s]?ready|verified contacts?|leads? i can contact|reach out to|draft outreach|for outbound)\b/i;
const EMPLOYER_VERIFY_RE = /\b(current employer|currently works?|verified employer|still (?:at|works))\b/i;
/**
 * "Return 5 qualified leads", "give me 10 leads", "5 contact-ready leads" — and
 * now "5 SDR hiring leads", where a short descriptive phrase sits between the
 * count and "leads". Bounded to <=25 characters and stops at any clause break
 * (. , ; ! ?), so this stays a quota match on ONE clause rather than an
 * open-ended scan: "Find 100 companies, then maybe get some leads eventually"
 * does not match — the 100 quantifies companies, not leads, and the clause
 * break says so.
 */
const LEAD_QUOTA_RE = /\b(\d{1,3})\b[^.,;!?]{0,25}?\bleads?\b/i;
/** Explicitly account-shaped asks. */
const ACCOUNT_TARGET_RE = /\b(compan(?:y|ies)|accounts?|organi[sz]ations?|startups?|firms?)\b/i;

export function routeQualifiedLead(instruction: string | null | undefined): QualifiedLeadRoute {
  const text = String(instruction ?? "");
  const reasons: string[] = [];

  if (PERSON_TARGET_RE.test(text)) reasons.push(`person_target:${firstMatch(PERSON_TARGET_RE, text)}`);
  if (WHO_TO_CONTACT_RE.test(text)) reasons.push("who_to_contact");
  if (QUALIFIED_LEAD_RE.test(text)) reasons.push(`qualified_lead_phrase:${firstMatch(QUALIFIED_LEAD_RE, text)}`);
  if (EMPLOYER_VERIFY_RE.test(text)) reasons.push("current_employer_required");
  const quota = LEAD_QUOTA_RE.exec(text);
  if (quota) reasons.push(`lead_quota:${quota[1]}`);

  if (reasons.length > 0) {
    return {
      workflowKind: "qualified_lead_sourcing",
      executionMode: "company_first",
      reasonCodes: reasons,
      countEntity: "contact_ready_lead",
      quotaPolicy: "contact_only",
    };
  }

  if (ACCOUNT_TARGET_RE.test(text)) reasons.push("account_target_only");
  return {
    workflowKind: "account_opportunity_sourcing",
    executionMode: "fast",
    reasonCodes: reasons.length ? reasons : ["no_person_or_quota_signal"],
    countEntity: "account_opportunity",
    quotaPolicy: "account_only",
  };
}

// --------------------------------------------------------- contract vocabulary
//
// The preview renders from the CONTRACT, never from the generated workflow title,
// so the vocabulary has to be canonical and stable rather than whatever wording
// the industry string happened to carry.

export type CompanyVertical = TaxonomyVertical | null;
export type CompanyStage = "startup_or_small_team" | "growth_stage" | "enterprise" | null;

/**
 * Canonical vertical for the contract.
 *
 * Delegates to the ONE rule table in the taxonomy, so the preview the user
 * approves and the family the runtime searches can never disagree about the
 * industry. Returns "other" — not null — when text was supplied but matched
 * nothing, which is how the contract distinguishes "unrecognised" from "unstated".
 */
export function normalizeCompanyVertical(...sources: Array<string | null | undefined>): CompanyVertical {
  const text = sources.filter(Boolean).join(" ");
  if (!text.trim()) return null;
  return inferVertical(text) ?? "other";
}

const STAGE_RULES: Array<[Exclude<CompanyStage, null>, RegExp]> = [
  ["startup_or_small_team", /\b(startups?|early[-\s]stage|seed|small (?:team|business|compan(?:y|ies))|smb|founder[-\s]led)\b/i],
  ["growth_stage", /\b(growth[-\s]stage|scale[-\s]?ups?|series [b-d]\b|mid[-\s]market)\b/i],
  ["enterprise", /\b(enterprises?|fortune 500|large (?:compan(?:y|ies)|organi[sz]ations?))\b/i],
];

/** Canonical stage, or null when the request never constrained company size. */
export function inferCompanyStage(...sources: Array<string | null | undefined>): CompanyStage {
  const text = sources.filter(Boolean).join(" ");
  if (!text.trim()) return null;
  for (const [key, re] of STAGE_RULES) if (re.test(text)) return key;
  return null;
}

/**
 * The titles the preview shows and the runtime searches for.
 *
 * The UI role families are coarse: `gtm_sales` leads with SDR/BDR, so a request
 * for a manufacturer's FIRST SALESPERSON would have previewed "SDR, BDR, Sales
 * Development Representative" — titles that company never posts. The backend
 * registry is the more precise source when it recognises the request, so it wins;
 * the UI alias set is the fallback.
 */
export function contractJobTitles(
  uiFamilyAliases: string[],
  registryExactTitles: string[] | null | undefined,
): string[] {
  const registry = (registryExactTitles ?? []).filter(Boolean);
  return (registry.length ? registry : uiFamilyAliases).slice(0, 3);
}

/**
 * The structured contract carried through Start Workflow → orchestrate →
 * run-agent. Emitted by Pilot; rendered verbatim by the workflow preview.
 */
export interface QualifiedLeadContract {
  workflow_kind: "qualified_lead_sourcing";
  execution_mode: "company_first";
  target_entity: "company_and_person";
  signal_type: string;
  job_family: string | null;
  job_titles: string[];
  company_vertical: CompanyVertical;
  company_stage: CompanyStage;
  geography: string[];
  requested_person_roles: string[];
  current_employer_required: true;
  requested_lead_count: number;
  count_entity: "contact_ready_lead";
  quota_policy: "contact_only";
  original_instruction: string;
}

// ------------------------------------------------------- requested count -----
//
// The quota has to be tied to the ENTITY the user asked for, not to whichever
// number appears first. "Find founders at companies with 10-100 employees.
// Return 5 leads." states one quota — 5 — and three other numbers that are not
// quotas at all. A first-number rule reads it as 10.
//
// So a number only becomes the quota when the words around it say it counts the
// requested output: a person/lead noun directly after it, or an explicit
// delivery verb before it.

/** Number words worth supporting. Beyond twenty, people write digits. */
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, twentyfive: 25, thirty: 30, fifty: 50,
};
const NUM_SRC = `(\\d{1,3}|${Object.keys(NUMBER_WORDS).join("|")})`;

/** Nouns naming the FINAL requested output — a person we could contact. */
const CONTACT_ENTITY_NOUN_SRC =
  "(?:qualified\\s+|contact[-\\s]?ready\\s+|verified\\s+|new\\s+){0,2}"
  + "(?:leads?|contacts?|founders?|co-?founders?|ceos?|executives?|decision[-\\s]?makers?"
  + "|people|persons?|prospects?|buyers?|owners?|presidents?)";

/**
 * Ordered most-specific first. The number must be ATTACHED to the requested
 * output, either by the noun that follows it or by the verb that introduces it.
 *
 * The first pattern's gap allows up to 3 short role-phrase WORDS between the
 * count and the noun — "5 SDR hiring leads" needs exactly that for the same
 * reason `LEAD_QUOTA_RE` above does, and a request that routes to
 * qualified_lead_sourcing on that phrasing but then silently defaults its OWN
 * stated count would be a worse bug than the one this fixes.
 *
 * Deliberately word-bounded, not `LEAD_QUOTA_RE`'s character-bounded window:
 * a character bound alone let "Find CEOs at Series 2 startups and return 5
 * contacts." match on "2" (bridging all the way to "contacts" — regression
 * caught by the existing qualifiedLeadMultiRoleParsing.test.ts). Excluding
 * digits from the intervening words closes that specific bridge — a second
 * number ends the search for a noun after the first one — while still
 * reaching "leads" past two non-numeric words. "10-100 employees. Return 5
 * leads." still resolves to 5: the clause break before "leads" ends "100"'s
 * search the same as before.
 */
const REQUESTED_COUNT_PATTERNS: RegExp[] = [
  new RegExp(`\\b${NUM_SRC}\\b(?:\\s+(?!\\d)[a-z-]+){0,3}\\s+${CONTACT_ENTITY_NOUN_SRC}\\b`, "i"),
  new RegExp(`\\b(?:return|give\\s+me|send\\s+me|get\\s+me|i\\s+need|i\\s+want|deliver|find\\s+me)\\s+${NUM_SRC}\\b`, "i"),
];

function toCount(raw: string | undefined): number | null {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[-\s]/g, "");
  const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[key];
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
}

/**
 * The final-lead quota when the request states one.
 *
 * Recognises "Return 5 qualified leads", "Find 5 founders", "Find five CEOs",
 * "I need 5 decision-makers" and "…and return 5". Returns null when the request
 * never states a quota for the requested output — the caller keeps its own safe
 * default rather than being handed a number that meant something else.
 */
export function extractRequestedLeadCount(instruction: string | null | undefined): number | null {
  const text = String(instruction ?? "");
  for (const re of REQUESTED_COUNT_PATTERNS) {
    const m = re.exec(text);
    const n = toCount(m?.[1]);
    if (n != null) return n;
  }
  return null;
}

function firstMatch(re: RegExp, s: string): string {
  const m = new RegExp(re.source, re.flags.replace("g", "")).exec(s);
  return (m?.[0] ?? "").toLowerCase();
}
