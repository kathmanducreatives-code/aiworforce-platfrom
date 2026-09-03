// EVIDENCE DEBT GATE (P1) — pure / deterministic. No provider, no model, no DB.
//
// Answers ONE question per company: is this candidate blocked ONLY because a
// requirement lacks evidence, and is it worth paying to find out?
//
// ── WHY THIS IS CODE AND NOT A MODEL ───────────────────────────────────────
//
// This gate decides who we are willing to SPEND on. That is a money decision,
// so it is deterministic, ordered, and inspectable. The model's job starts
// afterwards, on the candidates this gate already approved, and it is asked
// what to look for — never whether to look.
//
// ── THE ORDER IS THE POLICY ────────────────────────────────────────────────
//
// Cheapest disqualifier first, so a company excluded on employee count never
// reaches a paid page fetch. On the acceptance lineage `a5c1616e` this order
// selects 7-8 of 99: it rejects the 30 excluded on size before anything else,
// then the 27 whose hiring was refuted, and keeps only the candidates that
// passed every checkable requirement and stalled on one they could not prove.
//
// ── WHAT IS NOT A DEBT ─────────────────────────────────────────────────────
//
// A CONTRADICTED requirement is not a debt. `failed_requirements` non-empty
// means the evidence answered the question and the answer was no; buying pages
// to argue with it would be buying a second opinion, not evidence. Only an
// UNKNOWN is worth money.

import type { MissionEvaluation } from "./missionEvaluation.ts";
import { requirementId } from "./evidenceRequest.ts";

/** Why a company was NOT given an evidence debt. One reason, the first that hit. */
export type DebtSkipReason =
  | "not_evaluated"
  | "already_decided"
  | "requirement_contradicted"
  | "hiring_not_verified"
  | "identity_unresolved"
  | "no_domain"
  | "no_open_question"
  | "budget_exhausted";

export interface EvidenceDebt {
  company_key: string;
  company_name: string | null;
  /** CODE-SUPPLIED, from enriched firmographics. Never model-authored. */
  domain: string;
  requirement_id: string;
  /**
   * The requirement the evaluator could not settle.
   *
   * Carried VERBATIM from the evaluator's own `unknown_fields`. Nothing here
   * parses, matches or classifies it — that is what keeps this path generic
   * across "B2B SaaS", "sells to banks" and "uses Salesforce" alike.
   */
  open_question: string;
  /** Evidence types the registry already holds, so the planner does not re-ask. */
  known_evidence_types: string[];
  /** Ranking only. Higher is a stronger candidate; never a threshold. */
  match_score: number;
}

export interface DebtSkip {
  company_key: string;
  reason: DebtSkipReason;
}

export interface EvidenceDebtReport {
  debts: EvidenceDebt[];
  skipped: DebtSkip[];
  /** Counts by skip reason, for one-line observability. */
  skip_counts: Record<string, number>;
}

/**
 * The minimum this gate needs from a company. Structural, so `EngineCompany`
 * satisfies it without this module importing the engine (which would drag the
 * engine's subtree into any consumer's deploy graph).
 */
export interface DebtCandidate {
  key: string;
  company: { company_name?: string | null } | null;
  enriched:
    | { company_name?: string | null; canonical_domain?: string | null }
    | null;
  mission_evaluation: MissionEvaluation | null;
  identity: { status?: string } | null;
  /** Registry evidence types already held for this company. */
  known_evidence_types?: string[];
}

export interface DebtGateOptions {
  /** Hard cap on debts returned per slice. Code-owned budget. */
  max_companies: number;
  /**
   * Company keys that already hold web evidence for the same requirement.
   * Supplied by the caller from cache; a hit is not a debt.
   */
  already_researched?: ReadonlySet<string>;
}

/**
 * `identity.status` values that mean identity is settled and usable.
 *
 * `IdentityStatus` is `verified_match | ambiguous | mismatch | unresolved`.
 * Only the first attributes a page to the right company; `ambiguous` is
 * exactly the case where a fetch could be attributed to the WRONG one, which
 * is worse than no evidence.
 */
const IDENTITY_OK: ReadonlySet<string> = new Set(["verified_match"]);

/**
 * Compute evidence debts.
 *
 * Pure: same input, same output, no clock and no IO. The caller decides what to
 * do with the result — in P1 that is "log it", nothing more.
 */
export function computeEvidenceDebts(
  companies: readonly DebtCandidate[],
  opts: DebtGateOptions,
): EvidenceDebtReport {
  const debts: EvidenceDebt[] = [];
  const skipped: DebtSkip[] = [];
  const skip = (company_key: string, reason: DebtSkipReason) => {
    skipped.push({ company_key, reason });
  };

  // Ranked before the budget is applied, so a cap keeps the BEST candidates
  // rather than whichever the pool happened to list first.
  const ranked = [...companies].sort((a, b) =>
    (b.mission_evaluation?.match_score ?? 0) -
    (a.mission_evaluation?.match_score ?? 0)
  );

  for (const c of ranked) {
    const e = c.mission_evaluation;

    // 1. Never evaluated — there is no stated gap to research.
    if (!e) { skip(c.key, "not_evaluated"); continue; }

    // 2. Already decided. A qualified company needs nothing; a rejected one was
    //    answered. Only `insufficient_evidence` means "we have not finished
    //    looking", and it is the only status this gate acts on.
    if (e.decision !== "insufficient_evidence") {
      skip(c.key, "already_decided");
      continue;
    }

    // 3. Contradicted, not unknown. See the header: buying pages to dispute
    //    evidence we already have is not evidence collection.
    if (e.failed_requirements.length > 0) {
      skip(c.key, "requirement_contradicted");
      continue;
    }

    // 4. Hiring is a CHEAP hard constraint on a hiring mission and it has
    //    already been paid for. A company whose hiring was refuted or never
    //    established does not become qualified by proving its business model,
    //    so researching it buys nothing this mission can use.
    if (e.hiring_fit !== "verified") {
      skip(c.key, "hiring_not_verified");
      continue;
    }

    // 5. Identity must be settled before we attribute a page to a company.
    if (!IDENTITY_OK.has(String(c.identity?.status ?? ""))) {
      skip(c.key, "identity_unresolved");
      continue;
    }

    // 6. A domain is the only thing that makes a page fetch possible, and it
    //    must come from enrichment — never from a model, never guessed.
    const domain = (c.enriched?.canonical_domain ?? "").trim();
    if (!domain) { skip(c.key, "no_domain"); continue; }

    // 7. The evaluator must have said WHAT it could not settle. Without an open
    //    question there is nothing to ask, and inventing one here would be this
    //    module deciding meaning — precisely what it must not do.
    const open = e.unknown_fields.map((s) => s.trim()).filter(Boolean);
    if (open.length === 0) { skip(c.key, "no_open_question"); continue; }

    // 8. Cache hit — already researched for this requirement.
    const openQuestion = open[0];
    const rid = requirementId(openQuestion);
    if (opts.already_researched?.has(`${c.key}:${rid}`)) {
      skip(c.key, "already_decided");
      continue;
    }

    // 9. Budget. Applied last so it is a BUDGET and not a filter: everything
    //    above is about whether research is warranted at all.
    if (debts.length >= opts.max_companies) {
      skip(c.key, "budget_exhausted");
      continue;
    }

    debts.push({
      company_key: c.key,
      company_name: c.enriched?.company_name ?? c.company?.company_name ?? null,
      domain,
      requirement_id: rid,
      open_question: openQuestion,
      known_evidence_types: c.known_evidence_types ?? [],
      match_score: e.match_score,
    });
  }

  const skip_counts: Record<string, number> = {};
  for (const s of skipped) {
    skip_counts[s.reason] = (skip_counts[s.reason] ?? 0) + 1;
  }

  return { debts, skipped, skip_counts };
}
