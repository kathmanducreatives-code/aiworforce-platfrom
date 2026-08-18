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

// ─────────────────────────── TWO BUDGETS, TWO COST MODELS, NEVER ONE ────────
//
// THE CONFLATION THIS REMOVES.
//
// `resolveInvestigationBudget` accepted a `stage2Ceiling` and, when Stage 2
// full-pool evaluation was enabled, adopted it as the paid ceiling. On TEST run
// ea2d02f2 that turned a GPT batch-read limit of 100 into an authorisation to
// buy 100 LinkedIn identity searches. 97 companies were shortlisted, 12 were
// reached in the 125s window, 85 were deferred and nothing was enriched.
//
// The two quantities have nothing in common:
//
//   GPT BUDGET            batched, cheap, ~1 call per 25 companies for triage
//                         and ~3s per company for evaluation. Reading 100
//                         companies is entirely reasonable.
//   INVESTIGATION BUDGET  one paid Actor start per company, ~10s each at
//                         concurrency 2, plus enrichment. Buying 100 is not
//                         reasonable and does not fit in an edge invocation.
//
// They are now separate functions with separate env vars, separate caps and
// separate telemetry. Neither can silently become the other, and
// `requested_count` sizes neither — it is what the run must RETURN, which is a
// product answer, not a spend decision.

export type BudgetSource =
  | "default"
  | "environment"
  | "pool_bound";

// NO `time_bound`. There used to be, and it described the opposite of the rule
// the engine actually follows: THE CLOCK DOES NOT SHRINK THE SHORTLIST.
// Shrinking it would strand companies permanently, because the shortlist is
// computed once per lineage and a resume skips completed capabilities — a
// company cut for want of time would never be reconsidered. `resolveTimeCapacity`
// therefore bounds the per-pass SLICE, inside the identity stage, where stopping
// early is deferral and a continuation picks the work up. The variant was
// declared, never produced and never read; leaving it implied a spend rule that
// does not exist.

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
 * How many companies this run may PAY to investigate.
 *
 * `requestedCount` is carried for observability and never sizes the answer —
 * neither as a multiplier nor as a floor. A floor was the last remaining path
 * by which the product question ("return 50 leads") could set the spend
 * decision, and it is exactly as unfounded as the multiplier it replaced:
 * asking for 50 leads does not make 50 paid investigations affordable, and a
 * run that cannot deliver 50 should say so through the shortfall rather than
 * spend its way there.
 *
 * `stage2Ceiling` is GONE. See the header: a GPT batch-read limit is not a
 * provider spend authorisation.
 *
 * This answers the COUNT question only. `resolveTimeCapacity` answers the other
 * half — how many companies the wall clock can actually reach, which is what
 * bound on run ea2d02f2 — and it is applied to the per-pass slice rather than
 * to this number, so a short invocation defers companies instead of deleting
 * them.
 */
export function resolveInvestigationBudget(i: {
  requestedCount: number;
  poolSize: number;
  read?: EnvReader;
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

// ──────────────────────────────── the wall clock is a budget too ────────────
//
// THE FAILURE THIS MODELS.
//
// A count budget authorises companies. It says nothing about whether they fit
// in an edge invocation, and on run ea2d02f2 they did not: 97 authorised, 12
// reached, 85 deferred, 0 enriched, 0 qualified. The run spent 114 of its 125
// seconds on identity searches and then had 10.8s left against an 18s
// checkpoint reserve, so enrichment never started for the five companies that
// HAD resolved.
//
// A company is not investigated when its identity resolves. It is investigated
// when it has been resolved, enriched, assembled into evidence, evaluated by
// the model and written down. Sizing the shortlist on the first of those five
// costs is what produced a run that started 97 journeys and finished none.
//
// So the capacity is computed from the FULL per-company cost, and the identity
// stage can no longer eat the window the later stages need.

export const IDENTITY_CALL_MS_ENV = "LEAD_IDENTITY_CALL_MS";
export const QUALIFICATION_PER_COMPANY_MS_ENV = "LEAD_QUALIFICATION_PER_COMPANY_MS";

/**
 * Per-company stage costs, in wall-clock milliseconds.
 *
 * MEASURED, not guessed — these are the medians from TEST run ea2d02f2, whose
 * provider ledger and function logs are the only real data this pipeline has:
 *
 *   identity search        ~9.5s per company   (12 calls / 114.2s)
 *   enrichment             ~12s per BATCH      (batched by LinkedIn URL)
 *   grounded brain         ~3.5s per company   (10:25:28 → :35 → :41 → :49)
 *   mission evaluator      ~3.2s per company   (10:25:32 → :38 → :44 → :55)
 *
 * Overridable, because they are latency estimates and latency moves.
 */
export const DEFAULT_IDENTITY_CALL_MS = 10_000;
export const DEFAULT_ENRICHMENT_CALL_MS = 12_000;
/** Grounded brain + evaluator, both serial, both per company. */
export const DEFAULT_QUALIFICATION_PER_COMPANY_MS = 7_000;

export interface TimeCapacity {
  /** Companies the remaining wall clock can carry end to end. */
  capacity: number;
  remaining_ms: number;
  /** Held back for the checkpoint write, so a deferral is always recordable. */
  reserve_ms: number;
  usable_ms: number;
  /** Serial-equivalent cost of carrying ONE company through every stage. */
  per_company_ms: number;
  identity_call_ms: number;
  enrichment_call_ms: number;
  qualification_ms: number;
  concurrency: number;
  enrichment_batch_size: number;
}

/**
 * How many companies the remaining wall clock can carry ALL THE WAY THROUGH.
 *
 * Identity parallelises across `concurrency`; enrichment is batched, so its
 * cost amortises over the batch; qualification is two serial model calls per
 * company and does not parallelise at all. The reserve is subtracted first —
 * checkpointing must be affordable even when capacity comes out at zero, or a
 * deferral cannot be recorded and the companies are stranded rather than
 * resumable.
 */
export function resolveTimeCapacity(i: {
  remainingMs: number;
  reserveMs: number;
  concurrency: number;
  enrichmentBatchSize: number;
  read?: EnvReader;
  /** Observed identity latency, when the deadline has measured one. */
  observedIdentityMs?: number | null;
}): TimeCapacity {
  const get: EnvReader = i.read ?? ((k) => {
    try { return Deno.env.get(k); } catch { return undefined; }
  });
  const envNum = (key: string, fallback: number): number => {
    const v = Number(get(key));
    return Number.isFinite(v) && v > 0 ? Math.trunc(v) : fallback;
  };

  // THE SLOWER OF CONFIGURED AND OBSERVED. An estimate may only move UP from
  // its safe baseline — the same rule `ExecutionDeadline.estimateFor` applies,
  // and for the same reason: one fast call must not talk the controller into
  // authorising work it cannot finish.
  const configuredIdentity = envNum(IDENTITY_CALL_MS_ENV, DEFAULT_IDENTITY_CALL_MS);
  const identity = Math.max(configuredIdentity, Math.trunc(i.observedIdentityMs ?? 0));
  const enrichment = DEFAULT_ENRICHMENT_CALL_MS;
  const qualification = envNum(
    QUALIFICATION_PER_COMPANY_MS_ENV, DEFAULT_QUALIFICATION_PER_COMPANY_MS);

  const concurrency = Math.max(1, Math.trunc(i.concurrency));
  const batch = Math.max(1, Math.trunc(i.enrichmentBatchSize));

  const perCompany =
    identity / concurrency +   // parallel across lanes
    enrichment / batch +       // amortised over the batched call
    qualification;             // strictly serial, two model calls

  const reserve = Math.max(0, Math.trunc(i.reserveMs));
  const usable = Math.max(0, Math.trunc(i.remainingMs) - reserve);
  const capacity = perCompany > 0 ? Math.floor(usable / perCompany) : 0;

  return {
    capacity: Math.max(0, capacity),
    remaining_ms: Math.max(0, Math.trunc(i.remainingMs)),
    reserve_ms: reserve,
    usable_ms: usable,
    per_company_ms: Math.round(perCompany),
    identity_call_ms: identity,
    enrichment_call_ms: enrichment,
    qualification_ms: qualification,
    concurrency,
    enrichment_batch_size: batch,
  };
}

/**
 * TIME MUST BOUND THE STAGE, NOT THE SHORTLIST.
 *
 * The obvious fix — shrink the shortlist to what the clock can carry — is
 * WRONG, and worth recording as such. `applyMissionIntelligence` runs inside
 * the discovery capability, and a resumed run skips completed capabilities, so
 * the shortlist is computed exactly once per lineage. A company dropped from it
 * for want of time would carry `budget_exhausted` forever and no continuation
 * would ever reconsider it. That trades one starvation for a worse one: silent,
 * permanent, and invisible to the resume machinery built to prevent it.
 *
 * The shortlist therefore stays a COUNT decision. The clock is enforced inside
 * the identity stage, which already has the machinery to stop early, mark
 * itself `incomplete`, name the companies it deferred, and let a continuation
 * finish exactly those. `identityStopThreshold` is that enforcement.
 *
 * ── WHAT IT RESERVES ────────────────────────────────────────────────────────
 *
 * Run ea2d02f2 spent 114 of 125 seconds resolving identities and then had
 * 10.8s against an 18s checkpoint reserve — so enrichment never started, the
 * five resolved companies reached the evaluator with no enrichment evidence,
 * and nothing qualified. Identity is not free to spend the window the stages
 * after it need.
 *
 * The reserve GROWS with what has already resolved, which is what makes this
 * self-limiting: every additional identity adds an enrichment slot and a
 * qualification pass to the work still owed, so the stage stops precisely when
 * finishing what it holds would cost the rest of the budget. The companies it
 * has not reached are deferred — resumably, by the mechanism that already
 * exists.
 */
export function downstreamReserveMs(i: {
  resolvedSoFar: number;
  capacity: TimeCapacity;
  checkpointReserveMs: number;
}): number {
  const resolved = Math.max(0, Math.trunc(i.resolvedSoFar));
  const c = i.capacity;
  // At least one enrichment call is owed the moment anything resolves.
  const enrichmentCalls = resolved === 0
    ? 0
    : Math.ceil(resolved / c.enrichment_batch_size);
  return enrichmentCalls * c.enrichment_call_ms +
    resolved * c.qualification_ms +
    Math.max(0, Math.trunc(i.checkpointReserveMs));
}

/**
 * The point at which identity resolution must stop starting new calls.
 *
 * ── WHY THE CALL COST IS ADDED, NOT MAX'd ──────────────────────────────────
 *
 * The guard is evaluated BEFORE a call starts, so whatever it permits will
 * still be running afterwards. Comparing `remaining` against the reserve alone
 * lets a call begin with just over the reserve left and finish below it — which
 * is precisely how run ea2d02f2 ended at 10,804ms against an 18,000ms reserve.
 * The last search was affordable when it started and was not by the time it
 * returned.
 *
 * The reserve must survive the work already in flight, so one call's estimate
 * is added to it. `Math.max` with the bare estimate keeps the original
 * guarantee — never start a call that cannot itself finish — for the case where
 * nothing has resolved yet and the downstream reserve is only the checkpoint.
 */
export function identityStopThreshold(i: {
  resolvedSoFar: number;
  capacity: TimeCapacity;
  checkpointReserveMs: number;
  perCallEstimateMs: number;
}): number {
  const perCall = Math.max(0, Math.trunc(i.perCallEstimateMs));
  return Math.max(perCall, downstreamReserveMs(i) + perCall);
}

// ──────────────────────────────── the GPT budget, which is a different thing ──

export const GPT_READ_BUDGET_ENV = "LEAD_GPT_READ_BUDGET";

/**
 * Companies GPT may READ per run — triage plus evaluation.
 *
 * Deliberately LARGER than the investigation budget and deliberately unrelated
 * to it. Triage is batched at 25 companies per call, so reading 100 costs four
 * cheap calls; evaluation is one call per company that actually survived to
 * qualification, which the investigation budget has already bounded.
 *
 * The default matches the discovery ceiling: everything discovered should be
 * triaged, because triage is the stage that decides where the expensive budget
 * goes and starving it is how a good company never gets ranked.
 */
export const DEFAULT_GPT_READ_BUDGET = 100;
export const MAX_GPT_READ_BUDGET = 500;

export interface GptBudget {
  version: typeof INVESTIGATION_BUDGET_VERSION;
  /** Companies GPT may read in triage. */
  read_budget: number;
  /** Per-company evaluator calls, bounded by what survives to qualification. */
  evaluation_budget: number;
  source: "default" | "environment" | "pool_bound";
  pool_size: number;
  cap: number;
}

/**
 * Size the CHEAP stages, independently of the paid ones.
 *
 * `investigationBudget` is passed only to bound the evaluation calls — a
 * company that was never investigated cannot be evaluated, so buying evaluator
 * calls beyond it would authorise spend for work that cannot happen. It does
 * NOT bound the read budget, which is the whole point: triage must see the
 * broad pool in order to choose the narrow one.
 */
export function resolveGptBudget(i: {
  poolSize: number;
  investigationBudget: number;
  read?: EnvReader;
}): GptBudget {
  const get: EnvReader = i.read ?? ((k) => {
    try { return Deno.env.get(k); } catch { return undefined; }
  });
  const pool = Math.max(0, Math.trunc(i.poolSize));

  let read_budget = DEFAULT_GPT_READ_BUDGET;
  let source: GptBudget["source"] = "default";
  const envRaw = Number(get(GPT_READ_BUDGET_ENV));
  if (Number.isFinite(envRaw) && envRaw > 0) {
    read_budget = Math.trunc(envRaw);
    source = "environment";
  }
  read_budget = Math.min(MAX_GPT_READ_BUDGET, read_budget);
  if (pool < read_budget) {
    read_budget = pool;
    source = "pool_bound";
  }

  return {
    version: INVESTIGATION_BUDGET_VERSION,
    read_budget,
    evaluation_budget: Math.max(0, Math.trunc(i.investigationBudget)),
    source,
    pool_size: pool,
    cap: MAX_GPT_READ_BUDGET,
  };
}

// ──────────────────────────────── the investigation frontier ────────────────
//
// THE DEFECT THIS REPLACES.
//
// The shortlist was a ONE-TIME PARTITION of the pool, computed inside the
// discovery capability. A resumed run skips completed capabilities, so it was
// computed exactly once per lineage and never revisited. A run that discovered
// 100 companies, investigated the 10 the budget allowed and qualified 2 could
// never look at the other 90 — not on a continuation, not ever.
//
// Worse, it did not fail quietly. Those 90 were checkpointed with
// `identity: "not_started"`, which `nextStageFor` reads as "still owes
// identity", so `buildCheckpoint` listed all 90 in `pending_company_keys` and
// set `continuation_required`. The product offered "Continue verification"
// forever, and every continuation restored the same frozen shortlist and did
// nothing for them.
//
// ── POOL AND SLICE ARE DIFFERENT THINGS ─────────────────────────────────────
//
// The budget answers "how much may we spend in one pass?". It was also being
// used to answer "how many companies exist for this mission?", which is the
// pool — and the pool must stay open until the goal is met or genuinely
// exhausted.
//
// So a company is no longer in or out. It carries a STATE, and the only state
// that closes it forever is one somebody actually decided.

export type InvestigationState =
  /** Ranked and waiting. Not judged, not spent on — the frontier. */
  | "pending_investigation"
  /** Selected for the current pass. */
  | "in_flight"
  /** Paid for and carried to a terminal outcome. */
  | "investigated"
  /** Closed by a decision: GPT said irrelevant, or a mission constraint. */
  | "excluded_permanently";

export const INVESTIGATION_STATES: readonly InvestigationState[] = [
  "pending_investigation", "in_flight", "investigated", "excluded_permanently",
];

export function asInvestigationState(v: unknown): InvestigationState {
  const s = String(v ?? "");
  return (INVESTIGATION_STATES as readonly string[]).includes(s)
    ? s as InvestigationState
    : "pending_investigation";
}

/** Is this company still available to investigate on a later pass? */
export function isFrontier(s: InvestigationState): boolean {
  return s === "pending_investigation";
}

/** Has anything been spent on this company? */
export function wasInvestigated(s: InvestigationState): boolean {
  return s === "in_flight" || s === "investigated";
}

export interface FrontierCandidate {
  company_key: string;
  state: InvestigationState;
  /** Position in the persisted triage ranking. Lower is better. */
  rank: number;
}

export interface SliceDecision {
  /** Companies to investigate on this pass. */
  selected: string[];
  /** Still waiting after this slice — the size of the remaining frontier. */
  remaining: number;
  /** Already carried to a terminal outcome. */
  investigated: number;
  /** Closed by a decision and never eligible again. */
  excluded: number;
  /** What bounded this slice. */
  reason: "budget" | "frontier_exhausted" | "no_capacity";
}

/**
 * Take the next slice of the frontier, in ranked order.
 *
 * Deliberately dumb: the ranking was decided once by GPT triage and persisted,
 * so selection is a cursor over it rather than a second opinion. That is what
 * makes it safe to run on EVERY invocation — it cannot disagree with itself
 * between passes, and it re-derives nothing.
 *
 * `budget` is the per-pass spend allowance, NOT the size of the pool. A slice
 * that empties the budget leaves the rest of the frontier exactly where it was:
 * `pending_investigation`, ranked, and recoverable by the next pass or the next
 * invocation.
 */
export function selectInvestigationSlice(
  candidates: readonly FrontierCandidate[], budget: number,
): SliceDecision {
  const cap = Math.max(0, Math.trunc(budget));
  const investigated = candidates.filter((c) => c.state === "investigated").length;
  const excluded = candidates.filter((c) => c.state === "excluded_permanently").length;
  const frontier = candidates
    .filter((c) => isFrontier(c.state))
    .slice()
    .sort((a, b) => a.rank - b.rank);

  const selected = frontier.slice(0, cap).map((c) => c.company_key);
  return {
    selected,
    remaining: frontier.length - selected.length,
    investigated,
    excluded,
    reason: cap === 0
      ? "no_capacity"
      : selected.length < cap
      ? "frontier_exhausted"
      : "budget",
  };
}

/**
 * Should another slice be taken, in THIS invocation?
 *
 * The yield question the pipeline never asked. A run that qualified 2 of a
 * requested 10 with 39 eligible companies untouched has not finished; it has
 * merely spent its first slice. It continues when all four hold:
 *
 *   * the goal is unmet
 *   * the frontier is non-empty
 *   * the wall clock can carry another slice end to end
 *   * we are under the pass ceiling
 *
 * The pass ceiling exists because every other guard is a measurement, and a
 * measurement that goes wrong should cost a bounded amount. It is not the
 * primary control — the clock is.
 */
export const MAX_INVESTIGATION_PASSES = 6;
export const MAX_PASSES_ENV = "LEAD_INVESTIGATION_MAX_PASSES";

/**
 * The pass ceiling, overridable.
 *
 * `1` disables multi-pass entirely — one slice, as before. Useful to an
 * operator who wants the old spend profile, and to a test whose subject is a
 * single stage rather than the yield loop.
 */
export function resolveMaxPasses(read?: EnvReader): number {
  const get: EnvReader = read ?? ((k) => {
    try { return Deno.env.get(k); } catch { return undefined; }
  });
  const raw = Number(get(MAX_PASSES_ENV));
  return Number.isFinite(raw) && raw > 0
    ? Math.min(Math.trunc(raw), MAX_INVESTIGATION_PASSES)
    : MAX_INVESTIGATION_PASSES;
}

export function shouldTakeAnotherSlice(i: {
  qualified: number;
  requestedCount: number;
  frontierRemaining: number;
  passesTaken: number;
  /** Companies the remaining wall clock can still carry end to end. */
  timeCapacity: number;
  /** Overridable ceiling; 1 disables multi-pass. */
  maxPasses?: number;
}): { take: boolean; reason: string } {
  const ceiling = i.maxPasses ?? MAX_INVESTIGATION_PASSES;
  if (i.qualified >= i.requestedCount) {
    return { take: false, reason: "quota_met" };
  }
  if (i.frontierRemaining <= 0) {
    return { take: false, reason: "frontier_exhausted" };
  }
  if (i.passesTaken >= ceiling) {
    return { take: false, reason: "pass_ceiling" };
  }
  if (i.timeCapacity <= 0) {
    // NOT A FAILURE. The frontier survives in the checkpoint and the next
    // invocation opens with a fresh window.
    return { take: false, reason: "no_time_for_another_slice" };
  }
  return { take: true, reason: "quota_unmet_frontier_remains" };
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

// ─────────────────────────────────────────── mission-triage concurrency ──

/**
 * How many mission-triage batches may be in flight at once.
 *
 * Triage is free, read-only, and partitioned across DISJOINT company sets, so
 * overlapping the calls costs nothing but concurrent model requests. Run one
 * after another, four batches took 33.6s of a 125s budget on task 83843770 —
 * more wall clock than the paid identity stage got — and identity then deferred
 * five of its ten companies for want of the time.
 *
 * FOUR IS THE POOL SHAPE, not a guess: the default pool is 100 companies and
 * `TRIAGE_BATCH_SIZE` is 25, so four lanes retire the whole pool in one wave.
 * Deliberately NOT tied to `LINKEDIN_RESOLUTION_CONCURRENCY` — that bounds paid
 * Actor calls against a different provider with different limits, and making one
 * knob serve both would mean tuning spend in order to fix latency.
 *
 * THE FAILURE MODE IS NON-DESTRUCTIVE. If concurrency provokes a rate limit the
 * call throws, and a thrown triage batch excludes nobody: those companies become
 * `uncertain`, which is fully investigable. Overshooting costs a ranking signal,
 * never a candidate.
 */
export const DEFAULT_TRIAGE_CONCURRENCY = 4;
export const MAX_TRIAGE_CONCURRENCY = 8;
export const TRIAGE_CONCURRENCY_ENV = "LEAD_TRIAGE_CONCURRENCY";

export function resolveTriageConcurrency(read?: EnvReader): number {
  const get: EnvReader = read ?? ((k) => {
    try { return Deno.env.get(k); } catch { return undefined; }
  });
  const raw = Number(get(TRIAGE_CONCURRENCY_ENV));
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_TRIAGE_CONCURRENCY;
  return Math.min(MAX_TRIAGE_CONCURRENCY, Math.trunc(raw));
}
