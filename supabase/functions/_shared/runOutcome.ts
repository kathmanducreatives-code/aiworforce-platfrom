// WHAT THE RUN MAY SAY ABOUT ITSELF.
//
// ── THREE THINGS THIS PRODUCT TOLD USERS THAT WERE NOT TRUE ────────────────
//
// 2026-08-29, conversation 4c4ddb5a, all three inside ninety seconds:
//
//   11:13:03  "Nothing is lost and nothing extra was charged."
//             Ten credit_transactions rows on this lineage carried
//             `status: charged`, several written seconds later.
//
//   11:14:24  "11 identities resolved but none passed the Company Brain."
//             `company_brain_qualification` reported `eligible: 3,
//             reached_evaluation: 0`. Nobody was evaluated. Nothing passed
//             because nothing was asked.
//
//   11:14:36  "No credits charged, nothing sent."
//             A hardcoded string literal, emitted whenever `produced === 0`.
//
// None of them read a row. The first two are template branches chosen from
// counts the renderer happened to hold; the third is a constant.
//
// ── THE RULE ───────────────────────────────────────────────────────────────
//
// A claim about spend, evaluation, qualification, continuation or persistence
// is a claim about the world, and the world is in the database. Every field
// below names the table it is read FROM, and the renderers may say only what
// the contract carries.
//
// THE ABSENCE OF A FACT IS ITSELF A FACT, and it has its own sentence. "We did
// not evaluate them" and "we evaluated them and they failed" are different
// things to be told, and the whole class of defect here is a renderer that
// could not tell them apart.
//
// Pure. The reader that gathers the facts lives beside it; this file decides
// what may be said about them and nothing else.

import { canonicalProviderCostUsd, type ProviderCostColumns } from "./executionLedger.ts";
import { decisionSummary, type WorkbenchCounts } from "./workbenchMissionView.ts";

export const RUN_OUTCOME_VERSION = "run-outcome-v1" as const;

/**
 * How the request ended, in the vocabulary the product invariant names.
 *
 * `PARTIALLY_SATISFIED` is deliberately distinct from `FAILED`: a run that
 * verified three companies and ran out of clock did not fail, and saying so is
 * the difference between "try again" and "we lost your work".
 */
export type RunState =
  | "SATISFIED"
  | "PARTIALLY_SATISFIED"
  | "REQUIRES_APPROVAL"
  | "UNSUPPORTED"
  | "FAILED";

/** Spend, from `credit_transactions` and `lead_execution_calls`. Never inferred. */
export interface SpendFacts {
  /** Rows with `status = 'charged'`, summed on `actual_credits`. */
  credits_charged: number;
  /** `record_kind = 'provider_call'` rows for this lineage. */
  provider_calls: number;
  /**
   * Summed CANONICAL provider cost (`canonicalProviderCostUsd`): the receipt-
   * settled bill where a receipt settled the call, else the provider-reported
   * figure at completion. Null when no row carries either — which is a
   * different statement from zero and must render differently.
   *
   * It summed `actual_cost_usd` alone, which is the charge as known when the
   * call returned and can be a fraction of the bill: canary abc316e8 reported
   * $0.0242 for calls Apify billed $0.0278.
   */
  usd_reported: number | null;
  /** Calls still `started` or `timed_out`: bought, and not yet read. */
  unsettled_operations: number;
  /**
   * Calls a later generation ADOPTED instead of re-buying.
   *
   * `status = 'reused'`. Reported because it is the difference between a
   * continuation that cost money and one that did not, and because it is the
   * only visible proof that the lineage-scoped idempotency key is working. A
   * user looking at two slices and one charge is owed the sentence that explains
   * why.
   */
  reused_operations: number;
}

/** The funnel, from the engine's own persisted state. */
export interface FunnelFacts {
  discovered: number;
  shortlisted: number;
  deferred: number;
  identity_resolved: number;
  enriched: number;
  hiring_verified: number;
  hiring_refuted: number;
  /** Companies whose evidence was never obtained. NOT a verdict. */
  hiring_evidence_unavailable: number;
  /**
   * Job rows the hiring verdicts actually CITE, summed.
   *
   * The count that separates a verdict from an assertion. A run reporting three
   * verified companies and zero cited rows has three claims and no evidence,
   * which is exactly the state lineage 862e81be was left in on 2026-08-30.
   */
  cited_rows: number;
  excluded: ReadonlyArray<{ reason: string; count: number }>;
}

/**
 * Qualification, from `capability_outcomes` and the evaluation telemetry.
 *
 * `ran` is NOT "the capability block executed" — it executed three times on
 * 2026-08-29 and evaluated nobody. It is whether any company was actually
 * assessed, which is the only thing that licenses a sentence about what the
 * Brain decided.
 */
export interface QualificationFacts {
  eligible: number;
  evaluated: number;
  qualified: number;
  rejected: number;
  /**
   * Eligible companies the evaluator never got to.
   *
   * Carried rather than left to subtraction: a reader that has to compute
   * `eligible - evaluated` to discover that nobody was judged is a reader that
   * will not compute it, and will say "none qualified" instead.
   */
  not_reached: number;
  /** Why nothing was evaluated, when nothing was. */
  not_reached_reason: string | null;
  /**
   * THE CANONICAL DECISIONS, when the run produced them (Lead V2).
   *
   * The Workbench's own counts (`workbench_mission_view.counts`) summarised by
   * the same `decisionSummary` the continuation gate reads. When present, every
   * field above is DERIVED from this, so the completion message, the run list
   * and the Workbench describe one set of decisions. Null for a run that
   * predates the canonical view; the fields above are then the legacy counters.
   *
   * OPTIONAL ON INPUT, ALWAYS PRESENT ON THE RECORD. A caller that has no
   * canonical view may omit it; `buildRunOutcome` writes `null`, and a stored
   * `RunOutcomeV1` always carries the key (`OutcomeQualification`), so
   * `undefined` never reaches a reader or a round-trip.
   */
  canonical?: CanonicalDecisionFacts | null;
}

/** Candidate state as the canonical eligibility decided it — nothing else. */
export interface CanonicalDecisionFacts {
  source: "workbench_mission_view";
  discovered: number;
  /** Surfaced leads: every eligible candidate, whatever its label. */
  qualified: number;
  /** A hard requirement not yet established: evidence is owed, nothing is disproven. */
  pending: number;
  /** A hard requirement disproven on verified evidence. */
  ineligible: number;
  /** Removed by the free pre-pass, before any paid research. */
  screened_out: number;
  /** Still owed investigation or identity — work, not a decision. */
  undecided: number;
  /**
   * The dimensions the mission's criteria name (hard and target), as the same
   * view states them. Decides what a message may talk about: a mission with no
   * `hiring` criterion is never told about hiring. Null when the view carried
   * no criteria (an older or trimmed record) — then nothing is suppressed.
   */
  mission_dimensions: string[] | null;
}

export interface PersistenceFacts {
  leads_written: number;
  signals_written: number;
}

export interface ContinuationFacts {
  required: boolean;
  resumable: boolean;
  reason: string | null;
}

export interface RunFacts {
  requested: number;
  spend: SpendFacts;
  funnel: FunnelFacts;
  qualification: QualificationFacts;
  persistence: PersistenceFacts;
  continuation: ContinuationFacts;
  /** Capabilities that reported an outcome, by id. */
  completed_capabilities: readonly string[];
  gaps: ReadonlyArray<{ code: string; detail: string }>;
}

/** Qualification as a stored outcome holds it: `canonical` is null or a value, never absent. */
export type OutcomeQualification = QualificationFacts & { canonical: CanonicalDecisionFacts | null };

export interface RunOutcomeV1 extends RunFacts {
  version: typeof RUN_OUTCOME_VERSION;
  state: RunState;
  qualification: OutcomeQualification;
}

/**
 * Decide the state from the facts, and only from the facts.
 *
 * Note what is NOT here: `produced === 0`. A run that delivered nothing may be
 * partially satisfied (it verified companies and ran out of clock), failed (a
 * provider refused), or unsupported (the mission asked for something we cannot
 * do) — and the renderer used to pick one by looking at a single number.
 */
export function buildRunOutcome(facts: RunFacts): RunOutcomeV1 {
  const delivered = facts.persistence.leads_written;
  const state: RunState = delivered >= facts.requested && facts.requested > 0
    ? "SATISFIED"
    : facts.gaps.some((g) => g.code === "provider_failure")
    ? "FAILED"
    // Work remains and the run knows how to come back for it.
    : facts.continuation.required && facts.continuation.resumable
    ? "PARTIALLY_SATISFIED"
    : delivered > 0
    ? "PARTIALLY_SATISFIED"
    // Nothing delivered, nothing left to do, nothing broken: the honest answer
    // is that the request was served and came up short, not that it failed.
    : "PARTIALLY_SATISFIED";
  // `canonical` is always present on the record — null when the run has no
  // canonical view — so a stored outcome round-trips field for field.
  return {
    version: RUN_OUTCOME_VERSION, state, ...facts,
    qualification: { ...facts.qualification, canonical: facts.qualification.canonical ?? null },
  };
}

// ─────────────────────────────────────────────────────────── the sentences ───

/**
 * What was spent.
 *
 * NEVER "No credits charged" unless the ledger says zero. That string was a
 * constant emitted on `produced === 0`, which is a statement about results and
 * not about money.
 */
export function renderSpendClause(o: RunOutcomeV1): string {
  const { credits_charged: credits, provider_calls: calls, unsettled_operations: unsettled } = o.spend;
  if (credits === 0 && calls === 0) {
    return o.spend.reused_operations > 0
      // Free, but not because nothing happened — because an earlier slice paid.
      ? `No new credits were used; ${o.spend.reused_operations} ` +
        `${o.spend.reused_operations === 1 ? "result was" : "results were"} ` +
        `reused from work already paid for.`
      : "No credits were used.";
  }
  const creditWord = credits === 1 ? "credit" : "credits";
  const callWord = calls === 1 ? "provider call" : "provider calls";
  const parts = [`${credits} ${creditWord} across ${calls} ${callWord}.`];
  // WORK ADOPTED RATHER THAN RE-BOUGHT. Said out loud because a user comparing
  // two slices against one charge is otherwise looking at an unexplained
  // discrepancy, and because it is the only place the lineage-scoped
  // idempotency key becomes visible to the person paying for it.
  const reused = o.spend.reused_operations;
  if (reused > 0) {
    parts.push(`${reused} ${reused === 1 ? "result was" : "results were"} ` +
      `reused from work already paid for.`);
  }
  // A bought answer nobody has read yet is part of what was spent, and the user
  // is the person paying for it.
  if (unsettled > 0) {
    parts.push(`${unsettled} ${unsettled === 1 ? "result is" : "results are"} still being collected.`);
  }
  return parts.join(" ");
}

/**
 * What the Brain decided — or that it did not decide.
 *
 * The branch that did not exist. "None passed the Company Brain" was reachable
 * whenever `qualified === 0 && identities_resolved > 0`, with no check that
 * qualification had evaluated anybody, and it was said about a stage that had
 * evaluated nobody.
 */
export function renderQualificationClause(o: RunOutcomeV1): string {
  const q = o.qualification;
  // THE CANONICAL DECISIONS, said as the Workbench says them.
  const c = q.canonical;
  if (c) {
    const decided = c.qualified + c.pending + c.ineligible;
    if (decided === 0 && c.undecided === 0) return "No company reached qualification.";
    const parts = [`${c.qualified} qualified`];
    if (c.pending > 0) parts.push(`${c.pending} pending (a requirement is not yet established)`);
    if (c.ineligible > 0) parts.push(`${c.ineligible} ruled out`);
    const head = `${decided} ${decided === 1 ? "company was" : "companies were"} checked against your requirements: ${parts.join(", ")}.`;
    return c.undecided > 0
      ? `${head} ${c.undecided} ${c.undecided === 1 ? "was" : "were"} not reached.`
      : head;
  }
  if (q.eligible === 0) {
    return "No company reached qualification.";
  }
  if (q.evaluated === 0) {
    const why = q.not_reached_reason ? ` (${q.not_reached_reason})` : "";
    return `${q.eligible} ${q.eligible === 1 ? "company was" : "companies were"} ` +
      `ready for qualification, and the run stopped before ${
        q.eligible === 1 ? "it was" : "they were"} evaluated${why}.`;
  }
  if (q.qualified === 0) {
    // GRAMMAR ONLY. The plural branch read "3 companies were evaluated and none
    // not match this workspace's profile" — the negation was applied twice, once
    // by "none" and once by "not". Semantics are unchanged: this sentence still
    // fires only when companies WERE evaluated and none qualified, which is a
    // real verdict and must stay distinguishable from "nobody was evaluated".
    return q.evaluated === 1
      ? "1 company was evaluated and did not match this workspace's profile."
      : `${q.evaluated} companies were evaluated and none matched this workspace's profile.`;
  }
  return `${q.evaluated} evaluated, ${q.qualified} qualified.`;
}

/**
 * What is still owed.
 *
 * A company whose evidence was never obtained is NOT a company that failed, and
 * conflating them is what let a scheduling failure read as a business answer.
 */
export function renderOutstandingClause(o: RunOutcomeV1): string {
  // The canonical decisions already say what is owed (pending, not reached),
  // in `renderQualificationClause`. A legacy hiring counter must not add a
  // second account of it — a funding mission was told "2 still need a hiring
  // check" (canary 89adf8fb) because the legacy funnel counts every company
  // without a hiring verdict, hiring requirement or not.
  if (o.qualification.canonical) return "";
  const parts: string[] = [];
  const f = o.funnel;
  if (f.hiring_evidence_unavailable > 0) {
    parts.push(`${f.hiring_evidence_unavailable} still ${
      f.hiring_evidence_unavailable === 1 ? "needs" : "need"} a hiring check`);
  }
  if (f.deferred > 0) parts.push(`${f.deferred} not yet looked at`);
  if (parts.length === 0) return "";
  return ` ${parts.join(" and ")}.`;
}

/**
 * THE COMPLETION MESSAGE'S ACCOUNT OF CANDIDATES, from the canonical decisions.
 *
 * The panel message used to build its own: discovered, "embedded open roles",
 * "strong commercial expansion signals", "N qualified" from the legacy
 * qualification list, and "marked not qualified" for every shortlisted company.
 * On canary 89adf8fb — a FUNDING mission — that would have said "evaluated 0
 * embedded open roles", "2 showed strong commercial expansion signals" and
 * called BigRio "not qualified" while the Workbench showed it PENDING.
 *
 * With canonical decisions present this is the only account: the discovered
 * count and the qualification clause the Workbench agrees with, and a tail that
 * names pending as pending. Null when the outcome has no canonical view — the
 * caller then keeps its legacy sentence for rows written before it existed.
 */
export function renderCanonicalCompletion(o: RunOutcomeV1): { evidence: string; tail: string } | null {
  const c = o.qualification.canonical;
  if (!c) return null;
  const found = `I discovered ${c.discovered} ${c.discovered === 1 ? "company" : "companies"}` +
    (c.screened_out > 0 ? ` and screened out ${c.screened_out} before any paid research` : "") + ".";
  const tail = c.qualified > 0 ? ""
    : c.pending > 0
    ? ` ${c.pending === 1 ? "The pending company is" : "The pending companies are"} in Workbench with the requirement still to be established.`
    : " None qualified yet.";
  return { evidence: `${found} ${renderQualificationClause(o)}`, tail };
}

/** The whole message, assembled from clauses that each read a fact. */
export function renderRunOutcome(o: RunOutcomeV1): string {
  const led = o.persistence.leads_written;
  const head = `${led} of ${o.requested} ${led === 1 ? "lead" : "leads"} saved.`;
  // A mission that asked nothing about hiring is not told about hiring.
  const looked = `I looked at ${o.funnel.discovered} ${o.funnel.discovered === 1 ? "company" : "companies"}`;
  const funnel = hiringInScope(o) === false
    ? `${looked} and shortlisted ${o.funnel.shortlisted}.`
    : `${looked}, shortlisted ${o.funnel.shortlisted}, and confirmed hiring at ${o.funnel.hiring_verified}.`;
  return [
    head, funnel, renderQualificationClause(o).trim(),
    renderSpendClause(o).trim(),
  ].join(" ") + renderOutstandingClause(o);
}

/**
 * The checkpoint card.
 *
 * It used to end "Nothing is lost and nothing extra was charged" — unconditional,
 * and false every time a slice had bought anything. What is true and worth
 * saying is that the work is kept and that continuing reuses it.
 */
export function renderCheckpointNotice(o: RunOutcomeV1, resumable: boolean): string {
  const found = o.funnel.discovered > 0
    ? ` — ${o.funnel.discovered} companies found, ${o.funnel.shortlisted} shortlisted`
    : "";
  const spent = renderSpendClause(o);
  return resumable
    ? `This run hit its time limit partway through, so I've saved where it got to${found}. ` +
      `${spent} Use Continue below to pick it up — it reuses the work already paid for ` +
      `instead of searching again.`
    : `This run hit its time limit partway through${found}. ${spent} ` +
      `I can't pick this one up where it left off.`;
}

// ──────────────────────────────────────────────────── the durable record ───
//
// THE OUTCOME IS PERSISTED, NOT RECOMPUTED PER SURFACE.
//
// Every surface that describes a run used to derive its own answer from
// whatever it happened to have: the Pilot from `tasks.status`, the Workbench
// from company rows, the completion message from `produced`, the checkpoint card
// from nothing at all. Four derivations, four vocabularies, and no way to tell
// which one was right — the 2026-08-29 run was described three different ways in
// ninety seconds and all three were wrong.
//
// `run-agent` computes this ONCE, at completion, from the ledger and the engine's
// own state, and writes it to `tasks.result.run_outcome`. Everything downstream
// reads that field. A run can then be judged from the row alone, without a log
// line or a join.

export const RUN_OUTCOME_RESULT_KEY = "run_outcome" as const;

/**
 * Read the outcome a run recorded about itself.
 *
 * Returns null when the row predates this contract — deliberately, and not an
 * empty outcome: "this run did not record an outcome" and "this run recorded a
 * zero outcome" are different facts, and a caller handed zeros would state them
 * as though the run had reported them. Callers fall back to
 * `readFactsFromResult` explicitly, so the degraded path is visible at the call
 * site rather than hidden here.
 */
export function readPersistedRunOutcome(result: unknown): RunOutcomeV1 | null {
  const stored = rec(rec(result)[RUN_OUTCOME_RESULT_KEY]);
  if (stored.version !== RUN_OUTCOME_VERSION) return null;
  const s = rec(stored.spend), f = rec(stored.funnel);
  const q = rec(stored.qualification), pr = rec(stored.persistence);
  const c = rec(stored.continuation);
  return {
    version: RUN_OUTCOME_VERSION,
    state: (typeof stored.state === "string" ? stored.state : "PARTIALLY_SATISFIED") as RunState,
    requested: num(stored.requested),
    spend: {
      credits_charged: num(s.credits_charged), provider_calls: num(s.provider_calls),
      // Preserved as null. Rounding an unknown cost to zero is the whole bug.
      usd_reported: typeof s.usd_reported === "number" ? s.usd_reported : null,
      unsettled_operations: num(s.unsettled_operations),
      reused_operations: num(s.reused_operations),
    },
    funnel: {
      discovered: num(f.discovered), shortlisted: num(f.shortlisted),
      deferred: num(f.deferred), identity_resolved: num(f.identity_resolved),
      enriched: num(f.enriched), hiring_verified: num(f.hiring_verified),
      hiring_refuted: num(f.hiring_refuted),
      hiring_evidence_unavailable: num(f.hiring_evidence_unavailable),
      cited_rows: num(f.cited_rows),
      excluded: Array.isArray(f.excluded)
        ? (f.excluded as Array<Record<string, unknown>>).map((e) => ({
            reason: String(e.reason ?? "unknown"), count: num(e.count) }))
        : [],
    },
    qualification: {
      eligible: num(q.eligible), evaluated: num(q.evaluated),
      qualified: num(q.qualified), rejected: num(q.rejected),
      not_reached: num(q.not_reached),
      not_reached_reason: typeof q.not_reached_reason === "string"
        ? q.not_reached_reason : null,
      canonical: readCanonical(q.canonical),
    },
    persistence: {
      leads_written: num(pr.leads_written), signals_written: num(pr.signals_written),
    },
    continuation: {
      required: c.required === true, resumable: c.resumable === true,
      reason: typeof c.reason === "string" ? c.reason : null,
    },
    completed_capabilities: Array.isArray(stored.completed_capabilities)
      ? (stored.completed_capabilities as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
    gaps: Array.isArray(stored.gaps)
      ? (stored.gaps as Array<Record<string, unknown>>).map((g) => ({
          code: String(g.code ?? "unknown"), detail: String(g.detail ?? "") }))
      : [],
  };
}

function readCanonical(v: unknown): CanonicalDecisionFacts | null {
  const c = rec(v);
  if (c.source !== "workbench_mission_view") return null;
  return {
    source: "workbench_mission_view",
    discovered: num(c.discovered), qualified: num(c.qualified), pending: num(c.pending),
    ineligible: num(c.ineligible), screened_out: num(c.screened_out), undecided: num(c.undecided),
    mission_dimensions: Array.isArray(c.mission_dimensions)
      ? (c.mission_dimensions as unknown[]).filter((d): d is string => typeof d === "string") : null,
  };
}

/**
 * The canonical decisions a result carries, or null.
 *
 * Read from `workbench_mission_view.counts` — the counts the Workbench renders —
 * through `decisionSummary`, the same summary the continuation gate uses. There
 * is no second derivation here: a run_outcome that disagreed with the Workbench
 * would be two interpretations of one set of candidates.
 */
export function canonicalDecisionFacts(result: unknown): CanonicalDecisionFacts | null {
  const counts = rec(rec(rec(result).workbench_mission_view).counts);
  if (Object.keys(counts).length === 0) return null;
  const full: WorkbenchCounts = {
    discovered: num(counts.discovered), screened_out: num(counts.screened_out),
    investigating: num(counts.investigating), identity_unresolved: num(counts.identity_unresolved),
    pending: num(counts.pending), exact_match: num(counts.exact_match),
    strong_opportunity: num(counts.strong_opportunity), worth_considering: num(counts.worth_considering),
    low_priority: num(counts.low_priority), ineligible: num(counts.ineligible),
  };
  return {
    source: "workbench_mission_view", ...decisionSummary(full),
    mission_dimensions: missionDimensions(rec(rec(result).workbench_mission_view).mission),
  };
}

/**
 * The criterion dimensions the canonical view lists, sorted and unique. The
 * view states `dimension`; a view stored before it did is read from the id,
 * whose format `${dimension}:${slug}` is `deriveMissionCriteria`'s own.
 */
function missionDimensions(mission: unknown): string[] | null {
  const criteria = rec(mission).criteria;
  if (!Array.isArray(criteria) || criteria.length === 0) return null;
  const dims = criteria.map((c) => {
    const r = rec(c);
    if (typeof r.dimension === "string" && r.dimension) return r.dimension;
    return typeof r.id === "string" && r.id.includes(":") ? r.id.slice(0, r.id.indexOf(":")) : null;
  }).filter((d): d is string => !!d);
  return dims.length ? [...new Set(dims)].sort() : null;
}

/**
 * May this outcome talk about hiring? False only when the canonical view says
 * the mission names no hiring criterion; null (unknown) keeps legacy wording.
 */
export function hiringInScope(o: RunOutcomeV1): boolean | null {
  const dims = o.qualification.canonical?.mission_dimensions ?? null;
  return dims === null ? null : dims.includes("hiring");
}

/**
 * A one-line verdict for a list, from the same record.
 *
 * The Pilot lists runs; a list cannot carry four clauses per row. This is the
 * shortest true thing, and it is still read from the outcome rather than from
 * `tasks.status` — which is what let "complete" stand for a run that saved
 * nothing and left eleven companies mid-investigation.
 */
export function renderRunHeadline(o: RunOutcomeV1): string {
  const led = o.persistence.leads_written;
  const money = o.spend.credits_charged > 0
    ? `${o.spend.credits_charged} ${o.spend.credits_charged === 1 ? "credit" : "credits"}`
    : "no credits";
  const c = o.qualification.canonical;
  const tail = o.continuation.required && o.continuation.resumable
    ? ", can be continued"
    : o.qualification.not_reached > 0
    ? `, ${o.qualification.not_reached} not yet evaluated`
    : c && c.pending > 0
    ? `, ${c.pending} pending evidence`
    : "";
  return `${led} of ${o.requested} saved · ${money}${tail}`;
}

// ────────────────────────────────────────────────────────────── the reader ───
//
// Separated from the contract on purpose: the rules above are testable without a
// database, and this is the only place that knows which tables hold the truth.

type Rows = Promise<{ data: unknown; error: unknown }>;

export interface OutcomeDb {
  from(table: string): {
    select(cols: string): {
      eq(c: string, v: string): {
        eq(c2: string, v2: string): Rows;
        in(c2: string, v: readonly string[]): Rows;
      } & Rows;
    };
  };
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const rec = (v: unknown): Record<string, unknown> =>
  (v && typeof v === "object" ? v as Record<string, unknown> : {});

/**
 * Read what this lineage actually spent.
 *
 * ── SCOPED TO THE LINEAGE, NOT THE TASK ───────────────────────────────────
 *
 * A continuation is the same request. Reporting one generation's spend as the
 * whole request's is how "nothing extra was charged" could be almost true and
 * still wrong: the slice saying it had charged nothing YET, while the lineage
 * it belonged to had charged ten credits.
 *
 * Best-effort: a reader that throws would take down the message it exists to
 * make honest, so an unreadable ledger produces zeros AND says so through
 * `usd_reported: null` rather than asserting a figure it does not have.
 */
export async function readSpendFacts(
  db: OutcomeDb, workspaceId: string, taskIds: readonly string[],
): Promise<SpendFacts> {
  const empty: SpendFacts = {
    credits_charged: 0, provider_calls: 0, usd_reported: null,
    unsettled_operations: 0, reused_operations: 0,
  };
  if (taskIds.length === 0) return empty;
  try {
    const [credits, calls] = await Promise.all([
      db.from("credit_transactions").select("actual_credits, status, task_id")
        .eq("workspace_id", workspaceId).in("task_id", taskIds),
      db.from("lead_execution_calls")
        .select("status, actual_cost_usd, settled_usd, settlement_source, record_kind, task_id")
        .eq("workspace_id", workspaceId).in("task_id", taskIds),
    ]);
    const creditRows = (Array.isArray(credits.data) ? credits.data : []) as
      Array<{ actual_credits?: unknown; status?: unknown }>;
    const callRows = (Array.isArray(calls.data) ? calls.data : []) as
      Array<{ status?: unknown; record_kind?: unknown } & ProviderCostColumns>;

    const provider = callRows.filter((r) => r.record_kind === "provider_call");
    const priced = provider.map(canonicalProviderCostUsd).filter((c): c is number => c !== null);
    return {
      credits_charged: creditRows
        .filter((r) => r.status === "charged")
        .reduce((n, r) => n + num(r.actual_credits), 0),
      provider_calls: provider.length,
      // NULL, NOT ZERO, when nothing reported a price. "We do not know what this
      // cost" and "this cost nothing" are different sentences.
      usd_reported: priced.length === 0
        ? null
        : Math.round(priced.reduce((n, c) => n + c, 0) * 10_000) / 10_000,
      unsettled_operations: provider.filter(
        (r) => r.status === "started" || r.status === "timed_out").length,
      reused_operations: provider.filter((r) => r.status === "reused").length,
    };
  } catch {
    return empty;
  }
}

/**
 * THE MODEL LEDGER'S TOTAL for these tasks: Σ (actual, else estimate) over
 * `lead_model_calls` — the same per-row price the workspace spend ceiling sums
 * (`modelSpendCeiling`). A row with neither, or `cost_source: "unknown"`, is
 * counted as unpriced, never as free. `{ usd: 0, unpriced_calls: 0, ok: false }`
 * when the read fails, so a caller can tell "nothing" from "could not read".
 */
export async function readModelSpendUsd(
  db: OutcomeDb, workspaceId: string, taskIds: readonly string[],
): Promise<{ usd: number; priced_calls: number; unpriced_calls: number; ok: boolean }> {
  if (taskIds.length === 0) return { usd: 0, priced_calls: 0, unpriced_calls: 0, ok: true };
  try {
    const res = await db.from("lead_model_calls")
      .select("estimated_cost_usd, actual_cost_usd, cost_source, task_id")
      .eq("workspace_id", workspaceId).in("task_id", taskIds);
    if (res.error) return { usd: 0, priced_calls: 0, unpriced_calls: 0, ok: false };
    const rows = (Array.isArray(res.data) ? res.data : []) as Array<Record<string, unknown>>;
    let usd = 0, priced = 0, unpriced = 0;
    for (const r of rows) {
      const actual = r.actual_cost_usd === null || r.actual_cost_usd === undefined ? null : num(r.actual_cost_usd);
      const est = r.estimated_cost_usd === null || r.estimated_cost_usd === undefined ? null : num(r.estimated_cost_usd);
      const cost = actual ?? est;
      if (r.cost_source === "unknown" || cost === null) unpriced++;
      else { priced++; usd += cost; }
    }
    return { usd: Math.round(usd * 1_000_000) / 1_000_000, priced_calls: priced, unpriced_calls: unpriced, ok: true };
  } catch {
    return { usd: 0, priced_calls: 0, unpriced_calls: 0, ok: false };
  }
}

/**
 * Read the funnel and the qualification result out of the engine's own state.
 *
 * `reached_evaluation` is the field that decides whether anything may be said
 * about what the Brain concluded. It is produced by `summariseEvaluationPaths`
 * and it was already being written on every run — including the three runs that
 * reported `eligible: 3, reached_evaluation: 0` while the product told the user
 * "none passed the Company Brain".
 */
export function readFactsFromResult(result: unknown, requested: number): RunFacts {
  const r = rec(result);
  const state = rec(r.capability_execution_state);
  const progress = rec(state.progress);
  const paths = rec(r.evaluation_paths);
  const persistence = rec(r.lead_library_persistence);
  const companies = Array.isArray(rec(r.lead_resume_checkpoint).companies)
    ? (rec(r.lead_resume_checkpoint).companies as Array<Record<string, unknown>>)
    : [];

  const countHiring = (stage: string) =>
    companies.filter((c) => c.hiring === stage).length;

  const canonical = canonicalDecisionFacts(result);
  const eligible = num(paths.eligible ?? progress.eligible_opportunities);
  const evaluated = num(paths.reached_evaluation);
  const completed = Array.isArray(state.completed_capabilities)
    ? (state.completed_capabilities as unknown[]).filter(
        (c): c is string => typeof c === "string")
    : [];

  return {
    requested,
    spend: {
      credits_charged: 0, provider_calls: 0, usd_reported: null,
      unsettled_operations: 0, reused_operations: 0,
    },
    funnel: {
      discovered: num(progress.accounts_found),
      shortlisted: num(progress.shortlisted),
      deferred: companies.filter((c) => c.identity === "deferred").length,
      identity_resolved: num(progress.identity_resolved),
      enriched: num(progress.companies_enriched),
      hiring_verified: countHiring("verified_externally") +
        countHiring("verified_from_existing_evidence"),
      hiring_refuted: countHiring("not_verified"),
      hiring_evidence_unavailable: countHiring("evidence_unavailable"),
      // Counted from the rows themselves, never from the number of verdicts.
      cited_rows: companies.reduce((n, c) => {
        const snap = rec(c.snapshot);
        const src = rec(snap.hiring_assessment).evidence_source;
        const cited = typeof src === "string" && src.length > 0 && src !== "none";
        return n + (cited && Array.isArray(snap.hiring_jobs) ? snap.hiring_jobs.length : 0);
      }, 0),
      excluded: Object.entries(rec(progress.exclusion_reasons))
        .map(([reason, count]) => ({ reason, count: num(count) })),
    },
    qualification: canonical
      // ONE INTERPRETATION. With the canonical view present, every count is
      // derived from it: eligible = surfaced (every eligible candidate is a
      // lead), evaluated = every candidate the canonical eligibility decided or
      // is holding, rejected = hard claims disproven, not_reached = work still
      // owed. The legacy `evaluation_paths` counters (canary 89adf8fb: "eligible
      // 2, evaluated 0") are not read at all.
      ? {
        eligible: canonical.qualified,
        evaluated: canonical.qualified + canonical.pending + canonical.ineligible,
        qualified: canonical.qualified,
        rejected: canonical.ineligible,
        not_reached: canonical.undecided,
        not_reached_reason: canonical.undecided > 0
          ? (typeof state.terminal_reason === "string" && state.terminal_reason
            ? state.terminal_reason
            : "the run stopped first")
          : null,
        canonical,
      }
      : {
        eligible, evaluated,
        qualified: num(progress.qualified_companies),
        rejected: Math.max(0, evaluated - num(progress.qualified_companies)),
        not_reached: Math.max(0, eligible - evaluated),
        // THE SENTENCE THAT DID NOT EXIST. Only set when nothing was evaluated,
        // because that is the only case a verdict may not be reported for.
        not_reached_reason: eligible > 0 && evaluated === 0
          ? (typeof state.terminal_reason === "string" && state.terminal_reason
            ? state.terminal_reason
            : "the run stopped first")
          : null,
        canonical: null,
      },
    persistence: {
      leads_written: num(persistence.persisted),
      signals_written: num(rec(r.lead_runtime).signals_written),
    },
    continuation: {
      required: r.terminal_status === "continuation_required",
      resumable: companies.length > 0,
      reason: typeof state.terminal_reason === "string" ? state.terminal_reason : null,
    },
    completed_capabilities: completed,
    gaps: [],
  };
}
