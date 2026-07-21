// The next step an outreach message asks for.
//
// WHY
//   The 2026-07-21 production message ended as a product statement with no ask:
//   "…we provide an AI workforce platform that automates … to help lean teams
//   grow faster." Nothing in the contract required a CTA, nothing validated one,
//   and the scorer had no CTA dimension — so a message with no next step was
//   accepted as a complete success.
//
// TENANCY
//   The CTA is derived from the authenticated workspace's own Company Brain.
//   Nothing here knows what any tenant sells. When the Brain names an approved
//   CTA it is used verbatim-in-spirit (`explicit`); otherwise a conservative one
//   is derived from an approved offer or use case (`derived`). A named resource,
//   audit, report, framework or demo is NEVER invented — offering something the
//   seller does not have is worse than offering nothing.

import type { SellerContext, SellerClaim } from "./sellerContext.ts";

export type CtaType =
  | "question"
  | "compare_notes"
  | "offer_resource"
  | "show_example"
  | "review_workflow"
  | "brief_call"
  | "custom";

export type CtaSource = "explicit" | "derived";

export interface CtaPlan {
  cta_type: CtaType;
  cta_source: CtaSource;
  /** The approved offer or next step this CTA points at. */
  cta_offer: string | null;
  /** Seller claim ids backing the CTA, so the ask is traceable to the Brain. */
  used_offer_ids: string[];
  /** CTA phrasings this workspace forbids. */
  forbidden_ctas: string[];
  /** False when the Brain cannot support ANY honest next step. */
  available: boolean;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Generic asks that work unchanged for any account and therefore say nothing.
 * Rejected unless a workspace explicitly approves that exact CTA.
 */
const GENERIC_CTA_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\binterested\s*\?/i, label: "generic_interested" },
  { re: /\bthoughts\s*\?/i, label: "generic_thoughts" },
  { re: /\bwant to learn more\b/i, label: "generic_learn_more" },
  { re: /\b(?:can|may) i send (?:you )?more info/i, label: "generic_send_info" },
  { re: /\bbook a demo\b/i, label: "generic_book_demo" },
  { re: /\bdo you have \d+ minutes\b/i, label: "generic_have_minutes" },
  { re: /\bwould love to connect\b/i, label: "generic_love_to_connect" },
  { re: /\blet me know\b/i, label: "generic_let_me_know" },
  { re: /\bcheck us out\b/i, label: "generic_check_us_out" },
];

/** High-friction asks that are unreasonable for a first message. */
const HIGH_FRICTION_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\b(?:30|45|60)[- ]minute\b/i, label: "friction_long_meeting" },
  { re: /\bsign up\b/i, label: "friction_sign_up" },
  { re: /\bstart a (?:trial|pilot)\b/i, label: "friction_trial" },
  { re: /\bcalendly|cal\.com|book(?:ing)? link\b/i, label: "friction_scheduling_link" },
];

/** Promises no Company Brain can license. */
const UNSUPPORTED_PROMISE_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\bguarantee(?:d|s)?\b/i, label: "promise_guarantee" },
  { re: /\breplace your (?:entire )?team\b/i, label: "promise_replace_team" },
  { re: /\b(?:double|triple|10x) your\b/i, label: "promise_multiplier" },
];

/**
 * Build the CTA plan for one message.
 *
 * Precedence: an explicitly approved workspace CTA, then a conservative CTA
 * derived from an approved offer/use-case claim. When neither exists the plan is
 * unavailable and the caller must not fabricate an ask.
 */
export function buildCtaPlan(seller: SellerContext, claims: SellerClaim[]): CtaPlan {
  const forbidden = seller.prohibited_claims.slice();

  // 1. Explicit — the workspace told us what to ask for.
  const explicit = seller.approved_ctas.map(str).find((c): c is string => !!c);
  if (explicit) {
    return {
      cta_type: "custom",
      cta_source: "explicit",
      cta_offer: explicit,
      used_offer_ids: [],
      forbidden_ctas: forbidden,
      available: true,
    };
  }

  // 2. Derived — point at something the Brain already approves. A use case or
  //    outcome is a real thing to compare notes on; an offer is something to
  //    show an example of. Neither invents a deliverable.
  const useCase = claims.find((c) => c.type === "use_case");
  if (useCase) {
    return {
      cta_type: "compare_notes",
      cta_source: "derived",
      cta_offer: useCase.text,
      used_offer_ids: [useCase.id],
      forbidden_ctas: forbidden,
      available: true,
    };
  }

  const outcome = claims.find((c) => c.type === "outcome" || c.type === "offer");
  if (outcome) {
    return {
      cta_type: "show_example",
      cta_source: "derived",
      cta_offer: outcome.text,
      used_offer_ids: [outcome.id],
      forbidden_ctas: forbidden,
      available: true,
    };
  }

  return {
    cta_type: "question",
    cta_source: "derived",
    cta_offer: null,
    used_offer_ids: [],
    forbidden_ctas: forbidden,
    available: false,
  };
}

// ------------------------------------------------------------- detection -----

/**
 * Does the message actually ask for a next step?
 *
 * A question mark is the clearest marker, but a low-friction ask can be a
 * statement ("Happy to share a short example."). Both count; neither is assumed.
 */
export function hasCta(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  if (/\?/.test(text)) return true;
  return /\b(?:happy to|worth|open to|glad to|i can share|let'?s)\b/i.test(text);
}

export type CtaViolation =
  | "failed_missing_cta"
  | "failed_invalid_cta"
  | "failed_unapproved_offer"
  | "failed_cta_high_friction"
  | "failed_cta_unsupported_promise";

export interface CtaValidation {
  ok: boolean;
  violations: CtaViolation[];
  /** Sanitized labels for observability. */
  reasons: string[];
}

/**
 * Validate the ask inside a message against the plan.
 *
 * `requireCta` exists because an informational message a workspace has
 * deliberately configured without an ask is legitimate — the default for cold
 * outreach is that a CTA IS required.
 */
export function validateCta(
  message: string,
  plan: CtaPlan,
  opts: { requireCta?: boolean } = {},
): CtaValidation {
  const requireCta = opts.requireCta !== false;
  const violations: CtaViolation[] = [];
  const reasons: string[] = [];
  const text = message ?? "";

  if (requireCta && !hasCta(text)) {
    violations.push("failed_missing_cta");
    reasons.push("no_next_step");
  }

  // A workspace may approve any of these explicitly; only reject when it has not.
  const explicitlyApproved = plan.cta_source === "explicit" && plan.cta_offer
    ? text.toLowerCase().includes(plan.cta_offer.toLowerCase())
    : false;

  if (!explicitlyApproved) {
    for (const { re, label } of GENERIC_CTA_PATTERNS) {
      if (re.test(text)) {
        violations.push("failed_invalid_cta");
        reasons.push(label);
      }
    }
  }

  for (const { re, label } of HIGH_FRICTION_PATTERNS) {
    if (re.test(text)) {
      violations.push("failed_cta_high_friction");
      reasons.push(label);
    }
  }

  for (const { re, label } of UNSUPPORTED_PROMISE_PATTERNS) {
    if (re.test(text)) {
      violations.push("failed_cta_unsupported_promise");
      reasons.push(label);
    }
  }

  // An ask with nothing behind it — the Brain supports no offer at all.
  if (requireCta && !plan.available && hasCta(text)) {
    violations.push("failed_unapproved_offer");
    reasons.push("no_approved_offer_behind_cta");
  }

  return { ok: violations.length === 0, violations: [...new Set(violations)], reasons };
}
