// Pure lead-detail helpers — Display-layer cleanup for the Workbench Lead
// Detail drawer. No React / no `@/` imports, so this is unit-testable under
// Deno like the other src/lib models.
//
// Solves four concrete drawer problems:
//   1. Scraped-content markdown leakage (image alt text, empty links, escaped
//      newlines, raw property keys such as public_contact_email).
//   2. Source strings rendered raw (linkedin_people_search · profile_only).
//   3. Decision-makers leaking across companies when stale jsonb is read.
//   4. Contradictory lead status (20/100 weak verdict presented as contact-ready).

/** Strip scraped markdown / formatting leakage before displaying a string. */
export function cleanMarkdownLeakage(input: unknown): string {
  if (typeof input !== "string") return "";
  let s = input;
  // Markdown images: ![alt](url) or ![](url) or ![alt]() — drop entirely.
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  // Markdown links with empty labels: [](url) — drop the syntax, keep nothing.
  s = s.replace(/\[\s*\]\([^)]*\)/g, "");
  // Markdown links with a real label: [label](url) → label.
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Raw HTML tags (mostly <br>, <p>, <a ...>) — strip tags, keep inner text.
  s = s.replace(/<[^>]+>/g, "");
  // Escaped newlines / literal "\n" / "\r" sequences left by JSON round-trips.
  s = s.replace(/\\[nr]/g, "\n");
  // Empty parentheses left behind after stripping images/links.
  s = s.replace(/\(\s*\)/g, "");
  // Markdown emphasis leftovers: **, __, `, _ (only when used as markup).
  s = s.replace(/[*`_]{1,3}/g, "");
  // Horizontal rules / list bullets left in inline text.
  s = s.replace(/^\s*[-*+]\s+/gm, "");
  // Multiple spaces → single; collapse leading/trailing whitespace per line;
  // cap consecutive blank lines at one (preserve real line breaks).
  s = s
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s;
}

const SOURCE_LABELS: Record<string, string> = {
  job_poster: "From the job post",
  firecrawl_team_page: "From the company website",
  linkedin_people_search: "Verified from LinkedIn profile",
  website_contact_page: "From the company website",
};

/** Convert an internal source code into human-readable copy. Never raw. */
export function humanizeSource(source: unknown): string | null {
  if (typeof source !== "string" || !source.trim()) return null;
  return SOURCE_LABELS[source.trim()] ?? null;
}

const CONTACT_STATUS_LABELS: Record<string, string> = {
  profile_only: "Profile found · Company match pending",
  public_email_found: "Public email found",
  needs_contact_enrichment: "Needs contact enrichment",
};

/** Convert an internal contact-status code into human-readable copy. */
export function humanizeContactStatus(status: unknown): string | null {
  if (typeof status !== "string" || !status.trim()) return null;
  return CONTACT_STATUS_LABELS[status.trim()] ?? null;
}

/** Convert a snake_case internal property name into readable text. */
export function humanizePropertyName(name: unknown): string {
  if (typeof name !== "string" || !name.trim()) return "";
  const parts = name.trim().split("_").filter(Boolean);
  if (parts.length === 0) return "";
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

export type CompanyMatchStatus = "verified" | "likely" | "weak" | "no_match";

/** Minimal shape of a decision-maker row used for client-side scoping. */
export interface DecisionMakerLike {
  name?: string | null;
  title?: string | null;
  linkedinUrl?: string | null;
  source?: string | null;
  confidence?: string | null;
  contact_status?: string | null;
  why_this_person?: string | null;
  company_match?: { status?: CompanyMatchStatus | string | null } | null;
}

/**
 * Defensively scope decision-makers to the currently selected company. The
 * server-side runner already verifies membership, but the drawer reads jsonb
 * that may have been written by an older run, so this guard stops any stale or
 * unverified person from being shown as a normal contact. Verified + likely
 * pass through; weak / no-match / missing-company-match move to the "unverified"
 * bucket and never become the recommended contact.
 */
export function scopeDecisionMakersToCompany<T extends DecisionMakerLike>(list: unknown): {
  verified: T[];
  unverified: T[];
} {
  const arr = Array.isArray(list) ? (list as T[]) : [];
  const verified: T[] = [];
  const unverified: T[] = [];
  for (const d of arr) {
    if (!d || typeof d !== "object") continue;
    const status = (d?.company_match?.status ?? "").toString().toLowerCase();
    if (status === "verified" || status === "likely") verified.push(d);
    else unverified.push(d);
  }
  return { verified, unverified };
}

export interface LeadStatusSummary {
  /** Coarse bucket the drawer + table agree on. */
  bucket: "high_fit" | "watch" | "weak_signal" | "rejected";
  /** Short human label, never raw (e.g. "Weak fit · valid signal"). */
  label: string;
  /** Honest one-line caption for the drawer. */
  caption: string | null;
  /** Whether the lead should be presented as contact-ready. */
  contact_ready: boolean;
}

export interface LeadStatusInput {
  verdict?: string | null;
  final_overall_fit?: number | null;
  fit_score?: number | null;
  confidence_level?: string | null;
  gate_decision?: string | null;
  recommended_next_action?: string | null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Resolve a single, coherent lead-status bucket from gate + fit + verdict +
 * recommended next step. Removes visibly contradictory states — e.g. a 20/100
 * weak-verdict lead with a deprioritize recommendation is never "contact-ready".
 * Purely derived from inputs; no business-logic change.
 */
export function summarizeLeadStatus(input: LeadStatusInput): LeadStatusSummary {
  const v = (input.verdict ?? "").toString().toLowerCase().trim();
  const fit = num(input.final_overall_fit) ?? num(input.fit_score);
  const gate = (input.gate_decision ?? "").toString().toLowerCase().trim();
  const next = (input.recommended_next_action ?? "").toString().toLowerCase().trim();
  const conf = (input.confidence_level ?? "").toString().toLowerCase().trim();

  const isRejectGate = gate === "reject" || gate === "rejected" || gate === "hard_reject" || gate === "hard_rejected";
  const isWeakVerdict = v === "weak" || v === "weak_fit" || v === "needs_verification" || v === "deprioritize" || v === "deprioritized";
  const isStrongVerdict = v === "strong" || v === "high_fit" || v === "hot" || v === "qualified";
  const lowFit = fit !== null && fit < 50;
  const deprioritizeNext = /depriorit|skip|do not contact|reject|dismiss/.test(next);
  const validSignalNext = !deprioritizeNext && !!next && /watch|review|monitor|nurture|later/.test(next);

  // 1. Hard reject or explicit deprioritize → never contact-ready.
  if (isRejectGate || deprioritizeNext) {
    return {
      bucket: "rejected",
      label: "Deprioritized",
      caption: "Weak fit — deprioritized. Kept for record only.",
      contact_ready: false,
    };
  }
  // 2. Strong verdict + non-low fit + accept/contact gate → high fit.
  if (isStrongVerdict && (fit === null || fit >= 60) && !isRejectGate) {
    return {
      bucket: "high_fit",
      label: "High fit",
      caption: conf ? `Strong match · ${conf} confidence` : "Strong match",
      contact_ready: true,
    };
  }
  // 3. Weak verdict / low fit but retained — honest "watch" bucket.
  if (isWeakVerdict || lowFit || validSignalNext) {
    return {
      bucket: validSignalNext ? "weak_signal" : "watch",
      label: validSignalNext ? "Weak fit · valid signal" : "Needs review",
      caption: validSignalNext
        ? "Low overall fit, retained for one useful signal — verify before contacting."
        : "Below the current fit bar — review before any outreach.",
      contact_ready: false,
    };
  }
  // 4. Default: treat as needs review, never as automatically contact-ready.
  return {
    bucket: "watch",
    label: "Needs review",
    caption: null,
    contact_ready: false,
  };
}

/** True only when a draft body / personalized message looks non-empty and clean. */
export function hasReadableMessage(body: unknown): boolean {
  if (typeof body !== "string") return false;
  const cleaned = cleanMarkdownLeakage(body).trim();
  return cleaned.length > 0 && !/^draft (withheld|not generated)/i.test(cleaned);
}
