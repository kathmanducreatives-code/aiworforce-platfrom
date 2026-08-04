// ONE CANONICAL ANSWER TO "IS THIS RECORD A QUALIFIED LEAD?"
//
// THE DEFECT THIS REPLACES
//
// A record could simultaneously carry:
//
//     fit_score: 58, fit_tier: "rejected", analyst_verdict: "needs_verification",
//     gate_decision: "accept", decision_maker_status: "missing",
//     contact_status: "needs_contact", quota_eligible: false
//
// …and different surfaces picked different fields. The Workbench read
// `gate_decision: "accept"` and rendered "Qualified lead — 1 of 5 CONTACT-ready",
// while the runtime had already scored it zero quota credit. The user saw a
// qualified lead that did not exist.
//
// Precedence here is explicit and ordered. The first controlling signal wins;
// legacy fit tier/score are DESCRIPTIVE CONTEXT ONLY and can never promote a
// record to CONTACT-ready.
//
// Pure — no React, no network.

export type QualificationLevel =
  /** No qualification signal of any kind. NOT a pass — see `not_evaluated`. */
  | 'not_evaluated'
  | 'contact_ready'
  | 'needs_decision_maker'
  | 'needs_verification'
  | 'not_qualified';

export interface QualificationRecord {
  /** Runtime's explicit answer. Highest precedence when present. */
  quota_eligible?: boolean | null;
  /** Final disposition from the compound pipeline. */
  disposition?: string | null;
  verdict?: string | null;
  decision_maker_status?: string | null;
  employer_match_status?: string | null;
  gate_decision?: string | null;
  analyst_verdict?: string | null;
  contact_status?: string | null;
  /** DESCRIPTIVE ONLY — never controlling. */
  fit_score?: number | null;
  fit_tier?: string | null;
}

export interface QualificationResult {
  level: QualificationLevel;
  /** True only when the record genuinely earns CONTACT quota credit. */
  contactReady: boolean;
  /** 1 for a CONTACT-ready lead, 0 for everything else. Never fractional. */
  quotaCredit: 0 | 1;
  /**
   * EXPLICIT positive qualification. The ONLY thing a "Qualified companies"
   * counter may count.
   *
   * Deliberately not `level !== 'not_qualified'`. TEST plan
   * edb4cbf6-…-65b1d3fbbcda published 20 rows with every field null; each fell
   * through to `needs_decision_maker`, which is not `not_qualified`, so the
   * Workbench reported 20 qualified companies for a run that qualified zero.
   * Absence of a verdict is not a verdict.
   */
  qualified: boolean;
  /** True once anything actually judged this record. */
  evaluated: boolean;
  /** The field that decided the outcome — for honest UI explanations. */
  decidedBy: string;
  /** Short lines the card renders, most important first. */
  displayLines: string[];
  /** Fit tier/score, carried as context. Never a qualification claim. */
  context: string[];
}

const REJECTING_DISPOSITIONS = new Set(['reject', 'skip', 'rejected', 'skipped']);
/** Verdicts that constitute an EXPLICIT pass. Nothing else qualifies. */
const QUALIFYING_DISPOSITIONS = new Set(['contact', 'qualified', 'accept', 'accepted', 'pass', 'passed']);
const MISSING_DM = new Set(['missing', 'none', 'not_found', 'needs_manual_review', 'unverified']);
const FAILED_EMPLOYER = new Set(['mismatch', 'failed', 'unverified', 'no_match', 'stale']);

function lc(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

/**
 * Resolve one record against the controlling order:
 *
 *   1. explicit quota_eligible
 *   2. final disposition (REJECT / SKIP)
 *   3. decision-maker verification
 *   4. current-employer verification
 *   5. deterministic gate result
 *   6. analyst verdict
 *   7. fit tier / score — context only
 */
export function resolveQualification(rec: QualificationRecord): QualificationResult {
  const context: string[] = [];
  if (typeof rec.fit_score === 'number') context.push(`Fit score ${rec.fit_score}`);
  if (rec.fit_tier) context.push(`Fit tier: ${rec.fit_tier}`);

  const dm = lc(rec.decision_maker_status);
  const employer = lc(rec.employer_match_status);
  const disposition = lc(rec.disposition) || lc(rec.verdict);
  const gate = lc(rec.gate_decision);
  const analyst = lc(rec.analyst_verdict);

  // Sub-signals are collected first so a blocked record can still say WHY, even
  // when an earlier rule is the one that decided it.
  const blockers: string[] = [];
  if (MISSING_DM.has(dm)) blockers.push('Decision-maker missing');
  if (FAILED_EMPLOYER.has(employer)) blockers.push('Current employer not verified');
  if (REJECTING_DISPOSITIONS.has(disposition)) blockers.push(`Disposition: ${disposition.toUpperCase()}`);
  if (gate === 'reject') blockers.push('Failed the qualification gate');
  if (analyst === 'needs_verification') blockers.push('Needs verification');

  const notReady = (level: QualificationLevel, decidedBy: string, lead: string): QualificationResult => ({
    level,
    contactReady: false,
    quotaCredit: 0,
    qualified: false,
    evaluated: true,
    decidedBy,
    // "0 quota credit" is stated explicitly so a visible card can never be
    // mistaken for progress toward the requested count.
    displayLines: dedupe([lead, ...blockers, 'Not CONTACT-ready', '0 quota credit']),
    context,
  });

  // 0. NOTHING JUDGED THIS RECORD.
  //
  // Every controlling field is absent, so no gate ran and no verdict exists.
  // The old code fell straight through to `needs_decision_maker`, which reads
  // as "nearly qualified" and was counted as qualified. Raw discovery is not a
  // near miss; it is an unanswered question.
  const hasAnySignal =
    rec.quota_eligible === true || rec.quota_eligible === false ||
    !!disposition || !!gate || !!analyst || !!dm || !!employer ||
    typeof rec.fit_score === 'number';
  if (!hasAnySignal) {
    return {
      level: 'not_evaluated',
      contactReady: false,
      quotaCredit: 0,
      qualified: false,
      evaluated: false,
      decidedBy: 'no_qualification_evidence',
      displayLines: dedupe([
        'Not evaluated',
        'No qualification verdict was recorded for this company',
        '0 quota credit',
      ]),
      context,
    };
  }

  // 1. EXPLICIT runtime answer wins over every heuristic below it.
  if (rec.quota_eligible === false) {
    return notReady(
      MISSING_DM.has(dm) ? 'needs_decision_maker' : 'needs_verification',
      'quota_eligible',
      analyst === 'needs_verification' ? 'Needs verification' : 'Not quota-eligible',
    );
  }

  // 2. Final disposition.
  if (REJECTING_DISPOSITIONS.has(disposition)) {
    return notReady('not_qualified', 'disposition', `Disposition: ${disposition.toUpperCase()}`);
  }

  // 3. Decision-maker verification.
  if (MISSING_DM.has(dm) || !dm) {
    return notReady('needs_decision_maker', 'decision_maker_status', 'Decision-maker missing');
  }

  // 4. Current-employer verification.
  if (FAILED_EMPLOYER.has(employer)) {
    return notReady('needs_verification', 'employer_match_status', 'Current employer not verified');
  }

  // 5. Deterministic gate.
  if (gate === 'reject') {
    return notReady('not_qualified', 'gate_decision', 'Failed the qualification gate');
  }

  // 6. Analyst verdict — advisory, but it can still withhold CONTACT-ready.
  if (analyst === 'needs_verification') {
    return notReady('needs_verification', 'analyst_verdict', 'Needs verification');
  }

  // Everything controlling passed. `quota_eligible === true` makes it explicit;
  // otherwise CONTACT status is the last requirement.
  if (rec.quota_eligible === true || (disposition === 'contact' && lc(rec.contact_status) !== 'needs_contact')) {
    return {
      level: 'contact_ready',
      contactReady: true,
      quotaCredit: 1,
      qualified: true,
      evaluated: true,
      decidedBy: rec.quota_eligible === true ? 'quota_eligible' : 'disposition',
      displayLines: ['CONTACT-ready', 'Verified decision-maker', 'Counts toward quota'],
      context,
    };
  }

  return notReady('needs_verification', 'contact_status', 'Not yet CONTACT-ready');
}

function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!x || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

/** Count CONTACT quota credit across records. Never counts visible cards. */
export function countContactReady(records: QualificationRecord[]): number {
  return records.reduce((n, r) => n + resolveQualification(r).quotaCredit, 0);
}

/**
 * Does this record carry an EXPLICIT positive company-qualification verdict?
 *
 * Separate from CONTACT-readiness: a company can be qualified while its
 * decision-maker work is still pending. Used by the "Qualified companies"
 * counter, which must never be satisfied by the absence of a rejection.
 */
export function isExplicitlyQualified(rec: QualificationRecord): boolean {
  if (rec.quota_eligible === true) return true;
  const d = lc(rec.disposition) || lc(rec.verdict);
  if (REJECTING_DISPOSITIONS.has(d)) return false;
  if (QUALIFYING_DISPOSITIONS.has(d)) return true;
  return lc(rec.gate_decision) === 'accept';
}
