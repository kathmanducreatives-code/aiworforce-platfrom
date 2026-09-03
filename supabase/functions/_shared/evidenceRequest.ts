// ADAPTIVE EVIDENCE ENRICHMENT — TYPED CONTRACTS (P0).
//
// Types only. Nothing here executes a provider, calls a model, or spends.
//
// WHY THIS EXISTS.
//
// The evaluator can understand a requirement it has no evidence to verify.
// Production run `a5c1616e` proved the shape: seven companies passed UK
// presence, employee count and verified sales hiring, carried ZERO failed
// requirements, and were still refused because "B2B SaaS" could not be proven
// from LinkedIn's `Software Development` industry label. The evaluator was
// right to refuse — the registry held nothing it could legally cite.
//
// This module is the vocabulary for asking for that missing evidence.
//
// THE ONE RULE THAT SHAPES EVERY TYPE HERE.
//
// GPT owns MEANING. Code owns MONEY, IDENTITY and SAFETY. So a request carries
// a model-authored `research_question` and `page_intents`, and code-authored
// `domain`, `max_pages` and `freshness_window_hours`. A model never names a
// URL, a domain, or a budget — those fields are not model-writable by
// construction, and `parseEvidencePlanStrict` in the planner drops anything
// that tries.
//
// NO KEYWORD MAPS. `PageIntent` is a fixed vocabulary of PAGE KINDS, not a
// table of requirement phrases. "B2B SaaS", "sells to banks" and "uses
// Salesforce" all travel the same path: the requirement text reaches the
// planner as prose and comes back as intents from this list. Nothing in this
// module — or anywhere on the path — branches on a requirement's wording.

import { canonicalJson, sha256Hex } from "./providerInputFingerprint.ts";

export const EVIDENCE_REQUEST_VERSION = "evidence-request-v1" as const;
export const WEB_EVIDENCE_CLAIM_VERSION = "web-evidence-claim-v1" as const;
export const WEB_EVIDENCE_RESULT_VERSION = "web-evidence-result-v1" as const;

/** Hex length for the ids minted here. Matches `FINGERPRINT_HEX_LENGTH`. */
export const EVIDENCE_ID_HEX_LENGTH = 24;

// ─────────────────────────────── requirements ───────────────────────────────

/**
 * What we know about ONE mission requirement for ONE company.
 *
 * `supported` is deliberately distinct from `verified`. Demanding that a
 * company literally write "we are a B2B SaaS company" is the bar that returned
 * 1 of 5; several credible corroborating facts are a legitimate answer. The
 * strength policy lives in the evaluator prompt, not in code, because it is a
 * judgement about evidence — but the STATES are typed here so code can reason
 * about which requirement is blocking without re-reading prose.
 */
export type RequirementStatus =
  /** Direct evidence, cited. */
  | "verified"
  /** Multiple credible corroborating facts, cited, no contradiction. */
  | "supported"
  /** Plausible, not established. NEVER the same as false. */
  | "insufficient_evidence"
  /** Evidence contradicts the requirement. */
  | "failed";

/** Statuses that mean the requirement is settled and need not be re-decided. */
const SETTLED: ReadonlySet<RequirementStatus> = new Set<RequirementStatus>([
  "verified",
  "supported",
  "failed",
]);

/**
 * True when a requirement is decided and a later pass may carry it forward.
 *
 * `insufficient_evidence` is the ONLY status that reopens: it is the one that
 * means "we have not finished looking".
 */
export function requirementIsSettled(s: RequirementStatus): boolean {
  return SETTLED.has(s);
}

export interface RequirementState {
  /** Stable across missions for the same compiled requirement text. */
  requirement_id: string;
  requirement_text: string;
  status: RequirementStatus;
  /** Registry ids backing the status. Empty for `insufficient_evidence`. */
  evidence_ids: string[];
  /**
   * The evaluator's own words for what is missing. Set ONLY when the status is
   * `insufficient_evidence`; this is what the planner is asked to answer, and
   * carrying it verbatim is what keeps the path free of phrase matching.
   */
  open_question: string | null;
  decided_at: string;
  decided_by: "code" | "gpt_evaluation" | "restored";
}

// ──────────────────────────────── page intents ──────────────────────────────

/**
 * The KINDS of page that can carry public evidence.
 *
 * A closed vocabulary on purpose: it is the boundary that stops a model from
 * directing a fetch at an arbitrary URL. The planner may only choose from
 * this list, and code resolves each entry to a path on the company's own
 * registrable domain.
 */
export const PAGE_INTENTS = [
  "homepage",
  "pricing",
  "product",
  "customers",
  "case_studies",
  "about",
  "integrations",
  "docs",
  "careers",
  "newsroom",
  "locations",
] as const;

export type PageIntent = typeof PAGE_INTENTS[number];

const PAGE_INTENT_SET: ReadonlySet<string> = new Set(PAGE_INTENTS);

export function isPageIntent(s: unknown): s is PageIntent {
  return typeof s === "string" && PAGE_INTENT_SET.has(s);
}

// ─────────────────────────────── the request ────────────────────────────────

/**
 * One company, one blocking requirement, one bounded research plan.
 *
 * Serializable, checkpointable, and provider-agnostic: nothing here names
 * Firecrawl. A provider adapter reads `domain` + `page_intents` and decides how
 * to satisfy them.
 */
export interface EvidenceRequestV1 {
  version: typeof EVIDENCE_REQUEST_VERSION;
  /** Deterministic. See `evidenceRequestId`. */
  request_id: string;
  /** Canonical LinkedIn company URL — the identity the whole engine uses. */
  company_key: string;
  /** CODE-SUPPLIED, from `enriched.canonical_domain`. Never model-authored. */
  domain: string;
  requirement_id: string;
  requirement_text: string;
  /** MODEL-AUTHORED. One sentence, answerable from public web pages. */
  research_question: string;
  /** MODEL-AUTHORED, ranked, from `PAGE_INTENTS`. Code caps the length. */
  page_intents: PageIntent[];
  /** Evidence types the registry already holds, so the planner does not re-ask. */
  known_evidence_types: string[];
  /** CODE-SUPPLIED budget. */
  max_pages: number;
  /** CODE-SUPPLIED freshness demand, in hours. */
  freshness_window_hours: number;
  /**
   * Always true in v1: we only research a requirement that is BLOCKING an
   * otherwise-viable candidate. Typed as a literal so widening it later is a
   * deliberate, visible change rather than a silently-passed flag.
   */
  blocking_qualification: true;
}

// ───────────────────────────────── the claim ────────────────────────────────

/**
 * A model's reading of a page, with the receipt.
 *
 * `excerpt` MUST be verbatim from the fetched page text. The extraction layer
 * validates it by substring match and DROPS anything that fails — the same
 * discipline `missionEvaluation` already applies to registry citations, and a
 * security control as much as a quality one: it bounds fabrication and it
 * bounds what injected page text can achieve.
 */
export interface WebEvidenceClaimV1 {
  version: typeof WEB_EVIDENCE_CLAIM_VERSION;
  company_key: string;
  requirement_id: string;
  /** The model's reading. An INFERENCE — never stored as a hard fact. */
  claim: string;
  /** VERBATIM from the page. Validated, not trusted. */
  excerpt: string;
  /** Must be a page we actually fetched. Never model-invented. */
  source_url: string;
  page_intent: PageIntent;
  supports: "supports" | "contradicts" | "inconclusive";
  confidence: "low" | "medium" | "high";
}

// ──────────────────────────────── the result ────────────────────────────────

export type WebPageStatus =
  | "ok"
  | "empty"
  | "blocked"
  | "not_found"
  | "timeout";

export interface WebEvidencePage {
  url: string;
  intent: PageIntent;
  /** The page's own words. A HARD FACT in the registry's sense. */
  markdown: string;
  fetched_at: string;
  status: WebPageStatus;
}

export interface WebEvidenceResultV1 {
  version: typeof WEB_EVIDENCE_RESULT_VERSION;
  request_id: string;
  pages: WebEvidencePage[];
  /**
   * `no_useful_pages` is an ANSWER, not a failure: we looked and the public web
   * does not say. It must resolve to `insufficient_evidence`, never to a failed
   * requirement.
   */
  outcome: "ok" | "no_useful_pages" | "site_unavailable" | "provider_error";
}

// ────────────────────────────── identity minting ────────────────────────────

/**
 * A requirement's stable identity.
 *
 * Derived from the NORMALISED requirement text alone, so the same requirement
 * in two differently-worded missions collides deliberately — that collision is
 * what lets a later mission reuse an earlier verdict. Case and surrounding
 * whitespace are noise; internal wording is not.
 */
export function requirementId(requirementText: string): string {
  const normalised = requirementText.trim().replace(/\s+/g, " ").toLowerCase();
  return sha256Hex(canonicalJson({ requirement: normalised }))
    .slice(0, EVIDENCE_ID_HEX_LENGTH);
}

/**
 * A request's identity.
 *
 * ── WHAT IS IN, AND WHY ────────────────────────────────────────────────────
 *
 * `domain`, `requirement_id` and the SORTED `page_intents`. Two requests that
 * would fetch the same pages to answer the same requirement about the same
 * company are the same request, whatever order the planner ranked the intents
 * in and whichever mission asked.
 *
 * ── WHAT IS DELIBERATELY OUT ───────────────────────────────────────────────
 *
 * `lineage_root`, `company_key`, mission wording, `research_question`, and any
 * timestamp. Including the lineage would defeat cross-mission reuse, which is
 * the entire point of caching evidence rather than answers. Including the
 * research question would make "B2B SaaS" and "software sold to businesses"
 * buy the same pages twice. Freshness is a TTL decision made at lookup time,
 * not an identity component.
 *
 * NOTE: this is the CACHE/REQUEST identity, not the spend identity. The
 * execution ledger keeps its own lineage-scoped `logical_call_key` so spend
 * stays attributable to one mission. The two are different scopes on purpose;
 * conflating them is the main trap in this design.
 */
export function evidenceRequestId(i: {
  domain: string;
  requirement_id: string;
  page_intents: readonly PageIntent[];
}): string {
  return sha256Hex(canonicalJson({
    domain: i.domain.trim().toLowerCase(),
    requirement_id: i.requirement_id,
    page_intents: [...i.page_intents].sort(),
  })).slice(0, EVIDENCE_ID_HEX_LENGTH);
}

/**
 * The registry id for one fetched page.
 *
 * Shaped like the ids already in `leadEvidenceRegistry` so a citation reads the
 * same whichever provider produced it: `web_page:<domain>:<intent>:<hash>`.
 */
export function webPageEvidenceId(i: {
  domain: string;
  intent: PageIntent;
  source_url: string;
}): string {
  const h = sha256Hex(canonicalJson({ url: i.source_url })).slice(0, 8);
  return `web_page:${i.domain.trim().toLowerCase()}:${i.intent}:${h}`;
}
