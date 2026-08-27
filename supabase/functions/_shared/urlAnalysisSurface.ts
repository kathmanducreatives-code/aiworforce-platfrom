// A PAGE THE USER POINTED AT IS ANALYSED, NOT SEARCHED FOR.
//
// ── WHY THIS IS ITS OWN SURFACE ────────────────────────────────────────────
//
// "Analyse https://stripe.com/jobs" is a `research` request — a fresh look at
// one thing the user named. But the thing they named is a PAGE, and the lead
// pipeline's idea of a named entity is a COMPANY. Without this route the URL
// travels into `known_companies`, and `scanProposalForViolations` — the scan
// that refuses any url anywhere in a proposal, because a proposal that can name
// a URL can name a provider — raises `url:known_companies[0]` and the whole
// request is refused as uncompilable.
//
// That is a real refusal of a request the system can serve perfectly well: it
// has Firecrawl, and reading a page nobody has to be found first is the
// cheapest research this product does.
//
// ── AND WHY THE FORMAT CHECK HERE IS NOT A SEMANTIC REGEX ──────────────────
//
// Three separate regexes used to answer "is there a URL in this message?" —
// `workflowClassifier.looksLikeURL`, `intentRouter`'s URL test, and
// `toolInputPlanner`'s `hasUrl` — each run over the RAW SENTENCE, each deciding
// what the user meant.
//
// This one runs over `reference.value`: a field Chat Brain already produced by
// deciding the user was pointing at that thing. The meaning is settled before
// this function is called; all it asks is what FORM the referenced value takes,
// which is the same question `resolveCompanyIdentity` asks of a domain and
// `normalizeCompanyLinkedInUrl` asks of a LinkedIn URL. Validating the format of
// a structured value is not the same as reading a sentence.
//
// Pure. No network, no database, no model.

import type { RequestV1, RequestPart } from "./requestV1.ts";

export const URL_ANALYSIS_VERSION = "url-analysis-surface-v1" as const;

export interface UrlAnalysisPlan {
  version: typeof URL_ANALYSIS_VERSION;
  /** The page to read. Null when the request referenced none. */
  url: string | null;
  /** Which part asked, so a failure can name it. */
  part_id: string | null;
  /** What the user wants to know about the page, verbatim. */
  question: string;
}

/**
 * An absolute http(s) URL, or null.
 *
 * DELIBERATELY STRICT. A bare hostname is not accepted: "stripe.com" is a
 * DOMAIN, which identifies a company and belongs to the lead path, while
 * "https://stripe.com/jobs" is a PAGE. Treating the two alike would send every
 * named company to Firecrawl instead of to identity resolution.
 */
export function asAnalysableUrl(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s || !/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    if (!u.hostname || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Does any reference on this part name a page rather than an entity? */
export function partReferencesUrl(part: RequestPart): string | null {
  for (const ref of part.subject.references ?? []) {
    // A REFERENT IS NEVER A PAGE. `prior_result` points at something displayed
    // earlier, and its value is a pronoun or an ordinal — resolving it is the
    // referent resolver's job, not this one's.
    if (ref.kind === "prior_result") continue;
    const url = asAnalysableUrl(ref.value);
    if (url) return url;
  }
  return null;
}

/**
 * What would this request analyse?
 *
 * Pure and total. A request naming no page yields `url: null`, which the router
 * reads as "this is not a page-analysis request" and routes elsewhere — it is
 * not an error and never a refusal on its own.
 */
export function planUrlAnalysis(request: RequestV1): UrlAnalysisPlan {
  const base = {
    version: URL_ANALYSIS_VERSION,
    question: request.utterance,
  };
  for (const part of request.parts) {
    // Only a FRESH look at a named thing. A `read` that happens to quote a URL
    // is asking what we already hold about it, and must not reach a provider.
    if (part.objective !== "research") continue;
    const url = partReferencesUrl(part);
    if (url) return { ...base, url, part_id: part.id };
  }
  return { ...base, url: null, part_id: null };
}
