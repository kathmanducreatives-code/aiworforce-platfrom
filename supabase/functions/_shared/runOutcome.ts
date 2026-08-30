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
   * Summed `actual_cost_usd`. Null when no row carries one — which is a
   * different statement from zero and must render differently.
   */
  usd_reported: number | null;
  /** Calls still `started` or `timed_out`: bought, and not yet read. */
  unsettled_operations: number;
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
  /** Why nothing was evaluated, when nothing was. */
  not_reached_reason: string | null;
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

export interface RunOutcomeV1 extends RunFacts {
  version: typeof RUN_OUTCOME_VERSION;
  state: RunState;
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
  return { version: RUN_OUTCOME_VERSION, state, ...facts };
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
  if (credits === 0 && calls === 0) return "No credits were used.";
  const creditWord = credits === 1 ? "credit" : "credits";
  const callWord = calls === 1 ? "provider call" : "provider calls";
  const base = `${credits} ${creditWord} across ${calls} ${callWord}.`;
  // A bought answer nobody has read yet is part of what was spent, and the user
  // is the person paying for it.
  return unsettled > 0
    ? `${base} ${unsettled} ${unsettled === 1 ? "result is" : "results are"} still being collected.`
    : base;
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
    return `${q.evaluated} ${q.evaluated === 1 ? "company was" : "companies were"} ` +
      `evaluated and ${q.evaluated === 1 ? "did" : "none"} not match this workspace's profile.`;
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

/** The whole message, assembled from clauses that each read a fact. */
export function renderRunOutcome(o: RunOutcomeV1): string {
  const led = o.persistence.leads_written;
  const head = `${led} of ${o.requested} ${led === 1 ? "lead" : "leads"} saved.`;
  const funnel =
    `I looked at ${o.funnel.discovered} ${o.funnel.discovered === 1 ? "company" : "companies"}, ` +
    `shortlisted ${o.funnel.shortlisted}, and confirmed hiring at ${o.funnel.hiring_verified}.`;
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
    credits_charged: 0, provider_calls: 0, usd_reported: null, unsettled_operations: 0,
  };
  if (taskIds.length === 0) return empty;
  try {
    const [credits, calls] = await Promise.all([
      db.from("credit_transactions").select("actual_credits, status, task_id")
        .eq("workspace_id", workspaceId).in("task_id", taskIds),
      db.from("lead_execution_calls")
        .select("status, actual_cost_usd, record_kind, task_id")
        .eq("workspace_id", workspaceId).in("task_id", taskIds),
    ]);
    const creditRows = (Array.isArray(credits.data) ? credits.data : []) as
      Array<{ actual_credits?: unknown; status?: unknown }>;
    const callRows = (Array.isArray(calls.data) ? calls.data : []) as
      Array<{ status?: unknown; actual_cost_usd?: unknown; record_kind?: unknown }>;

    const provider = callRows.filter((r) => r.record_kind === "provider_call");
    const priced = provider.filter((r) => r.actual_cost_usd !== null &&
      r.actual_cost_usd !== undefined);
    return {
      credits_charged: creditRows
        .filter((r) => r.status === "charged")
        .reduce((n, r) => n + num(r.actual_credits), 0),
      provider_calls: provider.length,
      // NULL, NOT ZERO, when nothing reported a price. "We do not know what this
      // cost" and "this cost nothing" are different sentences.
      usd_reported: priced.length === 0
        ? null
        : Math.round(priced.reduce((n, r) => n + num(r.actual_cost_usd), 0) * 10_000) / 10_000,
      unsettled_operations: provider.filter(
        (r) => r.status === "started" || r.status === "timed_out").length,
    };
  } catch {
    return empty;
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

  const eligible = num(paths.eligible ?? progress.eligible_opportunities);
  const evaluated = num(paths.reached_evaluation);
  const completed = Array.isArray(state.completed_capabilities)
    ? (state.completed_capabilities as unknown[]).filter(
        (c): c is string => typeof c === "string")
    : [];

  return {
    requested,
    spend: { credits_charged: 0, provider_calls: 0, usd_reported: null, unsettled_operations: 0 },
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
      excluded: Object.entries(rec(progress.exclusion_reasons))
        .map(([reason, count]) => ({ reason, count: num(count) })),
    },
    qualification: {
      eligible, evaluated,
      qualified: num(progress.qualified_companies),
      rejected: Math.max(0, evaluated - num(progress.qualified_companies)),
      // THE SENTENCE THAT DID NOT EXIST. Only set when nothing was evaluated,
      // because that is the only case a verdict may not be reported for.
      not_reached_reason: eligible > 0 && evaluated === 0
        ? (typeof state.terminal_reason === "string" && state.terminal_reason
          ? state.terminal_reason
          : "the run stopped first")
        : null,
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
