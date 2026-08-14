// THE EVIDENCE BUDGET IS NOT THE REQUESTED LEAD COUNT.
//
// THE COUPLING THIS BREAKS.
//
// `shortlistSize(n) = min(DEFAULT_SHORTLIST_CEILING, max(5, n * 2))` derived how
// many companies could be PAID FOR from how many leads the user ASKED FOR. Two
// unrelated quantities, one number, and both of them wrong in practice:
//
//   * The ceiling is 10. Asking for 5 leads and asking for 50 both authorise
//     ten companies of paid evidence, so any request above five is arithmetically
//     unsatisfiable — there is no path by which ten investigated companies yield
//     fifty qualified ones.
//   * `× 2` encodes an assumed 50 % yield that nothing measures. When yield is
//     better, budget is wasted; when it is worse, the run under-delivers and the
//     number gives no way to say so.
//
// They are separate concepts and they are separated here:
//
//     requested_count    how many leads to RETURN         — a product answer
//     investigation      how many companies to PAY FOR     — a spend decision
//
// ── WHY THE DEFAULT DOES NOT CHANGE SPEND ────────────────────────────────────
//
// `DEFAULT_INVESTIGATION_BUDGET` is 10, which is exactly what the old ceiling
// allowed. This module changes the ARCHITECTURE — the budget is now an explicit,
// tunable quantity that no longer moves when someone edits a lead count — and
// deliberately does NOT change what a run costs. Raising it is a spend decision
// with a straightforward multiplier: every extra company is one identity search
// plus one enrichment slot. Turning the knob is the operator's call, not a side
// effect of this refactor.
//
// PURE. No provider import, no network, no database.

export const INVESTIGATION_BUDGET_VERSION = "lead-investigation-budget-v1" as const;

export type EnvReader = (key: string) => string | undefined;

export const INVESTIGATION_BUDGET_ENV = "LEAD_INVESTIGATION_BUDGET";

/**
 * Companies paid for per run, by default.
 *
 * TEN, matching what the previous shortlist ceiling permitted, so adopting this
 * module costs nothing. See the header: raising it is a deliberate act.
 */
export const DEFAULT_INVESTIGATION_BUDGET = 10;

/**
 * The most any configuration may authorise.
 *
 * A hard ceiling, not a default. An operator typo in one env var must not be
 * able to buy a hundred identity searches and a hundred enrichments; it can
 * reach this and no further.
 */
export const MAX_INVESTIGATION_BUDGET = 100;

export type BudgetSource = "default" | "environment" | "stage2_ceiling" | "pool_bound";

export interface InvestigationBudget {
  version: typeof INVESTIGATION_BUDGET_VERSION;
  /** Companies that may enter the paid stages. */
  budget: number;
  source: BudgetSource;
  /** What the run asked to RETURN. Recorded, never used to size the budget. */
  requested_count: number;
  /** Candidates actually available. */
  pool_size: number;
  cap: number;
}

/**
 * Decide how many companies this run may pay to investigate.
 *
 * `requestedCount` is carried for observability and NEVER multiplied into the
 * answer — that arithmetic is the bug this module exists to remove. The one
 * concession is a floor: a run may never investigate fewer companies than it
 * was asked to return, because that is unsatisfiable on its face.
 */
export function resolveInvestigationBudget(i: {
  requestedCount: number;
  poolSize: number;
  read?: EnvReader;
  /** Stage 2 evaluates a larger pool, so it may authorise a larger budget. */
  stage2Ceiling?: number | null;
}): InvestigationBudget {
  const get: EnvReader = i.read ?? ((k) => {
    try { return Deno.env.get(k); } catch { return undefined; }
  });
  const requested = Math.max(0, Math.trunc(i.requestedCount));
  const pool = Math.max(0, Math.trunc(i.poolSize));

  let budget = DEFAULT_INVESTIGATION_BUDGET;
  let source: BudgetSource = "default";

  const envRaw = Number(get(INVESTIGATION_BUDGET_ENV));
  if (Number.isFinite(envRaw) && envRaw > 0) {
    budget = Math.trunc(envRaw);
    source = "environment";
  } else if (i.stage2Ceiling && i.stage2Ceiling > budget) {
    // Stage 2 is the thing that can actually USE more companies.
    budget = Math.trunc(i.stage2Ceiling);
    source = "stage2_ceiling";
  }

  // A FLOOR, NOT A MULTIPLIER. Returning 20 leads from 10 investigated companies
  // is impossible; investigating 20 to return 20 is merely optimistic.
  if (requested > budget) {
    budget = requested;
    source = "default";
  }

  budget = Math.min(MAX_INVESTIGATION_BUDGET, budget);

  // Never authorise more than exists.
  if (pool < budget) {
    budget = pool;
    source = "pool_bound";
  }

  return {
    version: INVESTIGATION_BUDGET_VERSION,
    budget, source,
    requested_count: requested, pool_size: pool,
    cap: MAX_INVESTIGATION_BUDGET,
  };
}

// ─────────────────────────────────────────────────────────── smart shortlist ──

/** One candidate, as the shortlist ranker sees it. */
export interface ShortlistCandidate {
  company_key: string;
  /** Deterministic triage: did the free pass consider it eligible at all? */
  eligible: boolean;
  /** GPT triage verdict, when Mission Intelligence ran. */
  relevance?: "relevant" | "uncertain" | "irrelevant" | null;
  confidence?: number | null;
  signal_strength?: number | null;
  /** The deterministic prequalification score, as a last tiebreak. */
  score?: number | null;
  /** Stable, so equal candidates order identically on every run. */
  name?: string | null;
}

export interface ShortlistDecision {
  selected: string[];
  excluded: Array<{ company_key: string; reason: string }>;
  /** Ordered keys, so telemetry can show what nearly made it. */
  ranking: string[];
  budget: InvestigationBudget;
  counts: Record<string, number>;
}

const TIER: Record<string, number> = { relevant: 0, uncertain: 1 };

/**
 * Choose who to pay for, best first, up to the budget.
 *
 * ORDER: relevance tier, then signal strength, then confidence, then the
 * deterministic score, then name. The last is not cosmetic — the previous
 * implementation ordered by score and broke ties ALPHABETICALLY, so a run that
 * discovered the same pool twice investigated the same alphabetical prefix
 * twice. Name remains only as the final tiebreak, beneath three real signals.
 *
 * `irrelevant` is the ONLY verdict that excludes, and only when GPT explicitly
 * said it about a company it was shown. Everything else is ranked, and a company
 * that merely runs out of budget is recorded as `budget_exhausted` — it was not
 * judged, it was not reached.
 */
export function buildSmartShortlist(
  candidates: readonly ShortlistCandidate[],
  budget: InvestigationBudget,
): ShortlistDecision {
  const excluded: ShortlistDecision["excluded"] = [];
  const counts: Record<string, number> = {
    relevant: 0, uncertain: 0, irrelevant: 0, ineligible: 0, no_triage: 0,
  };

  const ranked = candidates.filter((c) => {
    if (c.relevance === "irrelevant") {
      counts.irrelevant++;
      excluded.push({ company_key: c.company_key, reason: "triage_irrelevant" });
      return false;
    }
    // NO TRIAGE ⇒ THE DETERMINISTIC PASS STILL GATES. With Mission Intelligence
    // off this is exactly the previous behaviour; with it on, `eligible` is
    // advisory and GPT decides.
    if (!c.relevance && !c.eligible) {
      counts.ineligible++;
      excluded.push({ company_key: c.company_key, reason: "prequalification_ineligible" });
      return false;
    }
    if (c.relevance) counts[c.relevance]++;
    else counts.no_triage++;
    return true;
  });

  ranked.sort((a, b) => {
    const ta = TIER[a.relevance ?? ""] ?? 1;
    const tb = TIER[b.relevance ?? ""] ?? 1;
    if (ta !== tb) return ta - tb;
    const sa = a.signal_strength ?? -1, sb = b.signal_strength ?? -1;
    if (sa !== sb) return sb - sa;
    const ca = a.confidence ?? -1, cb = b.confidence ?? -1;
    if (ca !== cb) return cb - ca;
    const pa = a.score ?? -1, pb = b.score ?? -1;
    if (pa !== pb) return pb - pa;
    return String(a.name ?? a.company_key).localeCompare(String(b.name ?? b.company_key));
  });

  const selected = ranked.slice(0, budget.budget).map((c) => c.company_key);
  for (const c of ranked.slice(budget.budget)) {
    excluded.push({ company_key: c.company_key, reason: "budget_exhausted" });
  }

  return {
    selected,
    excluded,
    ranking: ranked.map((c) => c.company_key),
    budget,
    counts: { ...counts, selected: selected.length, ranked: ranked.length },
  };
}
