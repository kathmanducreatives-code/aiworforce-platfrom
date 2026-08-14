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
export const UNTRIAGED_POLICY_ENV = "LEAD_INVESTIGATION_UNTRIAGED";

/**
 * WHAT TO DO WITH CANDIDATES GPT NEVER JUDGED.
 *
 * Mission Intelligence is off by default (flag + workspace allow-list), so on
 * most runs today NOTHING semantic has looked at the pool. The question is what
 * the deterministic role vocabulary is then allowed to do about it.
 *
 *   rank           Its verdict ORDERS the pool and removes nobody. Ineligible
 *                  candidates rank last and are investigated only with budget
 *                  no better-ranked candidate wanted. This is the target
 *                  architecture: a substring match may not permanently exclude
 *                  a company, because nothing downstream can recover it.
 *
 *   eligible_only  Its verdict EXCLUDES, as it used to. Cheaper on a pool the
 *                  vocabulary mostly rejects, and wrong in exactly the way that
 *                  motivated Mission Intelligence — Founding Engineer, Member
 *                  of Technical Staff and Platform Engineer never enter the
 *                  pool for a Mission asking for software engineers.
 *
 * ── THE COST, STATED PLAINLY ────────────────────────────────────────────────
 *
 * `rank` spends the FULL budget whenever the pool is larger than the budget;
 * `eligible_only` spends only what the vocabulary approved. On the audited
 * 20-company fixture that is 10 identity searches against 4. Neither exceeds
 * `LEAD_INVESTIGATION_BUDGET` — the budget remains the one number that bounds
 * spend — but the default genuinely uses more of it than before.
 *
 * Configurable rather than assumed, because it is a money decision and it
 * belongs to an operator, not to a role dictionary.
 */
export type UntriagedPolicy = "rank" | "eligible_only";

export const DEFAULT_UNTRIAGED_POLICY: UntriagedPolicy = "rank";

export function resolveUntriagedPolicy(read?: EnvReader): UntriagedPolicy {
  const get: EnvReader = read ?? ((k) => {
    try { return Deno.env.get(k); } catch { return undefined; }
  });
  const raw = String(get(UNTRIAGED_POLICY_ENV) ?? "").trim().toLowerCase();
  return raw === "eligible_only" ? "eligible_only" : DEFAULT_UNTRIAGED_POLICY;
}

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
  /**
   * The deterministic pass's OPINION — ranking only, never a veto.
   *
   * Derived from `classifyTitle`, a substring match over a compiled role
   * vocabulary. See `buildSmartShortlist` for why this may not exclude.
   */
  eligible: boolean;
  /**
   * A MISSION-STATED, VERIFIED reason this candidate is disqualified.
   *
   * The one thing other than an explicit GPT `irrelevant` that removes a
   * candidate from the pool — and only ever `employee_size`, which fires solely
   * when the MISSION set a range and the company's size is known to be outside
   * it. That is a falsifiable fact about a constraint the user actually
   * expressed, so paying to investigate it buys a lead that cannot qualify.
   *
   * DELIBERATELY NOT the role taxonomy. `technical_only` and
   * `insufficient_commercial` are judgements, and they belong to GPT.
   */
  hard_exclusion?: string | null;
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
  /** Which untriaged policy produced this decision. Recorded, never inferred. */
  untriaged_policy: UntriagedPolicy;
  budget: InvestigationBudget;
  counts: Record<string, number>;
}

/**
 * Ranking tiers. LOWER IS INVESTIGATED FIRST.
 *
 * `relevant` outranks everything. Below it sit two different kinds of "we do not
 * know": a GPT `uncertain`, and a company with no GPT verdict at all. The second
 * is split by the deterministic pass — an `eligible` company ranks with the
 * uncertain ones, an ineligible one ranks last but STAYS IN THE RUN.
 */
const TIER: Record<string, number> = { relevant: 0, uncertain: 1 };
const NO_TRIAGE_ELIGIBLE_TIER = 1;
const NO_TRIAGE_INELIGIBLE_TIER = 2;

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
 *
 * ── THE DETERMINISTIC PASS RANKS; IT NO LONGER EXCLUDES ─────────────────────
 *
 * `eligible` comes from `classifyTitle`, a substring match over a compiled role
 * vocabulary. It used to remove a candidate outright whenever GPT had not
 * spoken — and GPT is off by default, so in production the brittle vocabulary
 * WAS the gate: a Mission asking for "software engineers" compiled the single
 * fragment "software engineer", and Founding Engineer, Member of Technical
 * Staff and Platform Engineer were dropped before anything could reconsider
 * them. Excluding here is irreversible; nothing downstream can recover a
 * candidate that never entered the pool.
 *
 * Demoting it to a ranking signal costs NOTHING, which is the point: the budget
 * bounds how many companies are investigated, so an ineligible candidate can
 * only ever consume budget that no better-ranked candidate wanted. Recall
 * improves, spend does not move, and the vocabulary keeps doing the one job it
 * is actually good at — ordering.
 */
export function buildSmartShortlist(
  candidates: readonly ShortlistCandidate[],
  budget: InvestigationBudget,
  opts: { untriaged?: UntriagedPolicy } = {},
): ShortlistDecision {
  const untriaged = opts.untriaged ?? DEFAULT_UNTRIAGED_POLICY;
  const excluded: ShortlistDecision["excluded"] = [];
  const counts: Record<string, number> = {
    relevant: 0, uncertain: 0, irrelevant: 0, ineligible: 0, no_triage: 0,
    hard_excluded: 0,
  };

  const ranked = candidates.filter((c) => {
    // ── THE TWO WAYS OUT OF THE POOL, AND THERE ARE ONLY TWO ─────────────
    //
    // A MISSION-STATED, VERIFIED DISQUALIFIER. Checked first, and NOT
    // overridable by triage: if the Mission asked for 10-150 employees and this
    // company verifiably has 350, no semantic verdict makes it in range.
    if (c.hard_exclusion) {
      counts.hard_excluded++;
      excluded.push({
        company_key: c.company_key,
        reason: `mission_constraint:${c.hard_exclusion}`,
      });
      return false;
    }
    // AN EXPLICIT GPT `irrelevant`, about a company GPT was actually shown.
    if (c.relevance === "irrelevant") {
      counts.irrelevant++;
      excluded.push({ company_key: c.company_key, reason: "triage_irrelevant" });
      return false;
    }
    if (c.relevance) counts[c.relevance]++;
    else {
      counts.no_triage++;
      if (!c.eligible) {
        counts.ineligible++;
        // THE LEGACY SPEND PROFILE, kept as an explicit operator choice rather
        // than as the silent default it used to be.
        if (untriaged === "eligible_only") {
          excluded.push({
            company_key: c.company_key, reason: "prequalification_ineligible",
          });
          return false;
        }
      }
    }
    return true;
  });

  const tierOf = (c: ShortlistCandidate): number => {
    const t = TIER[c.relevance ?? ""];
    if (t !== undefined) return t;
    return c.eligible ? NO_TRIAGE_ELIGIBLE_TIER : NO_TRIAGE_INELIGIBLE_TIER;
  };

  ranked.sort((a, b) => {
    const ta = tierOf(a);
    const tb = tierOf(b);
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
    untriaged_policy: untriaged,
    counts: { ...counts, selected: selected.length, ranked: ranked.length },
  };
}
