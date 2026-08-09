// THE EXECUTION LEDGER — one row per external provider call, written before the
// call returns.
//
// WHAT EXISTS TODAY, AND WHY IT IS NOT THIS.
//
// `tool_calls` already records every `runTool` invocation: workspace, plan, task,
// tool name, provider, input, output, status, error. It is genuinely useful and
// `durableIdempotency` depends on it. But it cannot answer the operational
// questions, because:
//
//   * There is no cost column at all — not estimated, not actual. Spend is
//     tracked in an abstract "Agentory credit" elsewhere and never reconciled
//     against a provider.
//   * Duration is not stored, only derivable by subtracting two timestamps — and
//     on the tool-forbidden path `logToolCall` assigns `started_at` and
//     `completed_at` the same instant, so that subtraction is zero by
//     construction there.
//   * The Apify run id and dataset id exist only inside `output_json`, so
//     "which run produced these rows" is a JSON dig rather than a column.
//   * There are no funnel counts. "100 rows arrived, 82 normalized, 13 passed the
//     gate" is the shape of every real question and none of it is recorded.
//   * There is no reason. A row says a tool ran, never why it was allowed to.
//   * A retry overwrites nothing but is indistinguishable from a first attempt.
//
// This ledger adds those, and leaves `tool_calls` and its idempotency contract
// exactly as they are. Two tables with different jobs, not a migration of one
// into the other.
//
// WHAT THIS MODULE IS NOT. It observes. It never decides a provider, a budget, a
// retry, a broadening, a quota or a qualification — every one of those stays
// where it already lives. A ledger that can change what runs is not a ledger.
//
// PURE, except through the injected writer. No network, no Supabase import, no
// provider access. `LedgerWriter` is the only seam, which is what makes the whole
// lifecycle testable offline.

export const EXECUTION_LEDGER_VERSION = "lead-execution-ledger-v1" as const;

// ── VOCABULARY ──────────────────────────────────────────────────────────────
//
// Deliberately the CURRENT vocabulary, not a canonical one. Canonical signals,
// capabilities and playbooks are later phases; this phase must not pre-empt their
// naming. Structuring these as columns is what lets those phases replace the
// VALUES without rewriting the table.

/** Where in the funnel a call sits. */
export type ExecutionStage =
  | "company_discovery"
  | "company_enrichment"
  | "hiring_evidence"
  | "person_resolution"
  | "contact_enrichment"
  | "generic_sourcing"
  | "other";

/** Why this call was allowed to happen. Machine-readable, never free prose. */
export type ExecutionReason =
  | "initial_discovery"
  | "fill_required_evidence"
  | "qualified_decision_maker"
  | "quota_shortfall_round"
  | "broadened_retry"
  | "resumed_run"
  | "unspecified";

export type ExecutionStatus =
  /** The row exists and the call is in flight. Never a final state. */
  | "started"
  | "succeeded"
  | "failed"
  | "timed_out"
  /** An already-paid provider run was adopted instead of starting a new one. */
  | "reused";

/** How much a cost figure can be trusted. An estimate is never stored as actual. */
export type CostSource = "provider_reported" | "estimated" | "unknown";

/**
 * Funnel counts.
 *
 * EVERY FIELD IS NULLABLE AND NULL MEANS UNKNOWN. This is not pedantry: the UI
 * has previously rendered "not searched" as zero evidence, which reads as "we
 * checked and found nothing" when the truth was "we never looked". A call site
 * that cannot know a count must leave it null rather than write 0.
 */
export interface ExecutionCounts {
  /** Rows the provider returned. */
  raw?: number | null;
  /** Rows that survived shape normalization. */
  normalized?: number | null;
  /** Rows left after de-duplication. */
  unique?: number | null;
  /** Rows that passed this stage's gate. */
  accepted?: number | null;
  /** Rows this stage rejected. */
  rejected?: number | null;
}

export interface ExecutionCost {
  actual_usd?: number | null;
  estimated_usd?: number | null;
  source: CostSource;
}

/** What is known before the call is made. */
/**
 * A provider call, or a task-level stage outcome.
 *
 * Kept in one table because they answer one question together, and kept
 * DISTINGUISHABLE because they are not the same event. An Actor returning 100
 * rows does not entitle anyone to record "13 evidence-satisfied" against that
 * Actor: several calls may have contributed to those 13, and attributing them to
 * one row makes the ledger untrustworthy exactly where it must be trusted.
 */
export type RecordKind = "provider_call" | "stage_result";

export interface ExecutionCallSpec {
  record_kind?: RecordKind;
  workspace_id: string;
  task_id?: string | null;
  plan_id?: string | null;

  /** From the ownership ledger, so a row says which engine spent this money. */
  execution_owner?: string | null;
  /** From the plan artifact's provenance, so a row says which planner chose it. */
  planner_owner?: string | null;
  /**
   * The rest of the planner provenance triple.
   *
   * `planner_owner` alone says which adapter was SELECTED and nothing about
   * whether it worked. Without the outcome, "the ladder planned by design" and
   * "a model adapter ran and degraded" are the same row again — the exact
   * ambiguity the ownership phase removed.
   */
  planner_adapter?: "gpt" | "claude" | "none" | null;
  planner_outcome?: "selected_directly" | "model_validated" | "deterministic_fallback" | null;
  planner_fallback_reason?: string | null;

  stage: ExecutionStage;
  capability?: string | null;
  reason: ExecutionReason;

  provider_id: string;
  actor_id?: string | null;

  /** The provider-facing input, pre-redaction. Redacted by `beginExecution`. */
  request_input?: unknown;

  /**
   * Stable identity for the LOGICAL call — same question, same key.
   *
   * Two attempts at one logical call share this and differ by `attempt_number`,
   * which is what makes "did this retry, or is this a different call?" a query
   * rather than an inference.
   */
  logical_call_key: string;
  attempt_number?: number;
}

/** What is known once the call has finished. */
export interface ExecutionOutcome {
  status: Exclude<ExecutionStatus, "started">;
  provider_run_id?: string | null;
  dataset_id?: string | null;
  failure_code?: string | null;
  failure_message?: string | null;
  counts?: ExecutionCounts;
  cost?: ExecutionCost;
  /** What the runtime did next. Recorded, never decided here. */
  next_decision?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ExecutionLedgerRow extends Omit<ExecutionCallSpec, "request_input"> {
  id: string;
  version: typeof EXECUTION_LEDGER_VERSION;
  record_kind: RecordKind;
  attempt_number: number;
  status: ExecutionStatus;
  request_input: Record<string, unknown> | null;
  provider_run_id: string | null;
  dataset_id: string | null;
  failure_code: string | null;
  failure_message: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  raw_count: number | null;
  normalized_count: number | null;
  unique_count: number | null;
  accepted_count: number | null;
  rejected_count: number | null;
  actual_cost_usd: number | null;
  estimated_cost_usd: number | null;
  cost_source: CostSource;
  next_decision: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * The only seam. Two operations, both fire-and-forget from the caller's view.
 *
 * `insert` must not throw in production — a ledger that can fail a run is worse
 * than a missing row — but the wrapper below defends against it anyway.
 */
export interface LedgerWriter {
  insert(row: ExecutionLedgerRow): Promise<void>;
  finalize(id: string, patch: Partial<ExecutionLedgerRow>): Promise<void>;
}

// ── REDACTION ───────────────────────────────────────────────────────────────

/**
 * Keys whose VALUES are never persisted, at any depth.
 *
 * Matched case-insensitively on a normalized key (non-alphanumerics stripped), so
 * `api-key`, `API_KEY` and `apiKey` are one rule rather than three. The provider
 * input has to be reproducible — many past failures were malformed Actor inputs —
 * and reproducible must not mean "contains the token".
 */
const SECRET_KEY_PATTERNS: readonly RegExp[] = [
  // ANY key ending in "token". The exact-match list missed `idToken`,
  // `sessionToken` and `supabaseAccessToken` — three of the most likely names
  // for a live Supabase credential. A suffix rule covers the whole family
  // without guessing at prefixes, and matches nothing benign in a provider
  // input: `dataset_id`, `run_id` and `identity` all normalize away from it.
  /token$/i,
  /^(api)?token$/i,
  /^jwt$/i,
  // Plural too: `cookies` slipped past a `^cookie$` rule.
  /^cookies?$/i,
  /^(api|access|secret|private|client)?key$/i,
  /^authorization$/i,
  /^auth$/i,
  /^password$/i,
  /^secret$/i,
  /^credentials?$/i,
  /^cookie$/i,
  /^sessionid$/i,
  /^bearer$/i,
  /^refreshtoken$/i,
  /^accesstoken$/i,
];

export const REDACTED = "[redacted]" as const;

function isSecretKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return SECRET_KEY_PATTERNS.some((re) => re.test(normalized));
}

/**
 * A token embedded in a URL query string, which is how Apify authenticates.
 *
 * Redacting only object keys would miss `…/runs?token=apify_api_xxx` entirely —
 * the single most likely place for a live credential to reach the ledger.
 */
function redactUrlSecrets(value: string): string {
  return value.replace(
    /([?&](?:token|api_?key|access_?token|auth)=)[^&\s]+/gi,
    `$1${REDACTED}`,
  );
}

/** Bare provider tokens appearing as a whole value. */
const BARE_TOKEN = /^(apify_api_[A-Za-z0-9]+|sk-[A-Za-z0-9-_]{10,}|Bearer\s+\S+)$/;

/**
 * A JWT as a whole value, under any key name at all.
 *
 * Key-based redaction cannot help when the key is `auth_context` or `ctx`, and a
 * Supabase JWT is a live credential carrying workspace scope — precisely what
 * must never land in a column designed to be read.
 *
 * DELIBERATELY STRICT. Requiring the header segment to begin `eyJ` — the
 * base64url of `{"`, which every JWT header starts with — is what keeps
 * `example.com`, `version.1.2`, `1.2.3` and `some.nested.path` legible. A looser
 * "three dotted segments" rule would redact ordinary provider inputs and destroy
 * the reproducibility this column exists for, which is a worse failure than the
 * rare non-standard token it would additionally catch.
 */
const JWT_VALUE = /^eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}$/;

/**
 * Deep-copy an input with every secret removed.
 *
 * Depth- and size-bounded: a provider input is a request payload, not a dataset,
 * and an unbounded structure would put a dataset in the ledger by accident.
 */
export function redactProviderInput(
  input: unknown,
  depth = 0,
): unknown {
  if (depth > 8) return "[truncated:depth]";
  if (input === null || input === undefined) return null;

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (BARE_TOKEN.test(trimmed) || JWT_VALUE.test(trimmed)) return REDACTED;
    const cleaned = redactUrlSecrets(input);
    return cleaned.length > 2000 ? `${cleaned.slice(0, 2000)}…[truncated]` : cleaned;
  }
  if (typeof input === "number" || typeof input === "boolean") return input;

  if (Array.isArray(input)) {
    return input.slice(0, 200).map((v) => redactProviderInput(v, depth + 1));
  }
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? REDACTED : redactProviderInput(v, depth + 1);
    }
    return out;
  }
  // Functions, symbols and anything else are not request data.
  return null;
}

// ── LIFECYCLE ───────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

/** Null unless a real number. Guards against `0` standing in for "unknown". */
function num(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function buildStartedRow(spec: ExecutionCallSpec): ExecutionLedgerRow {
  return {
    id: newId(),
    version: EXECUTION_LEDGER_VERSION,
    record_kind: spec.record_kind ?? "provider_call",
    workspace_id: spec.workspace_id,
    task_id: spec.task_id ?? null,
    plan_id: spec.plan_id ?? null,
    execution_owner: spec.execution_owner ?? null,
    planner_owner: spec.planner_owner ?? null,
    planner_adapter: spec.planner_adapter ?? null,
    planner_outcome: spec.planner_outcome ?? null,
    planner_fallback_reason: spec.planner_fallback_reason ?? null,
    stage: spec.stage,
    capability: spec.capability ?? null,
    reason: spec.reason,
    provider_id: spec.provider_id,
    actor_id: spec.actor_id ?? null,
    logical_call_key: spec.logical_call_key,
    attempt_number: spec.attempt_number ?? 1,
    status: "started",
    request_input: redactProviderInput(spec.request_input ?? null) as Record<string, unknown> | null,
    provider_run_id: null,
    dataset_id: null,
    failure_code: null,
    failure_message: null,
    started_at: nowIso(),
    finished_at: null,
    duration_ms: null,
    raw_count: null,
    normalized_count: null,
    unique_count: null,
    accepted_count: null,
    rejected_count: null,
    actual_cost_usd: null,
    estimated_cost_usd: null,
    cost_source: "unknown",
    next_decision: null,
    metadata: null,
  };
}

/**
 * The finalization patch.
 *
 * COST SEMANTICS. `actual_cost_usd` is only ever written when the provider
 * reported it. An estimate lands in `estimated_cost_usd` with
 * `cost_source: "estimated"`, and the two columns are never merged — the previous
 * audit found spend recorded in an abstract unit documented as "not dollars", and
 * the fix is not to guess harder but to say which kind of number this is.
 */
export function buildFinalPatch(
  row: Pick<ExecutionLedgerRow, "started_at">,
  outcome: ExecutionOutcome,
): Partial<ExecutionLedgerRow> {
  const finished = nowIso();
  const duration = Math.max(0, Date.parse(finished) - Date.parse(row.started_at));
  const cost = outcome.cost;

  return {
    status: outcome.status,
    provider_run_id: outcome.provider_run_id ?? null,
    dataset_id: outcome.dataset_id ?? null,
    failure_code: outcome.failure_code ?? null,
    failure_message: outcome.failure_message
      ? String(outcome.failure_message).slice(0, 500)
      : null,
    finished_at: finished,
    duration_ms: Number.isFinite(duration) ? duration : null,
    raw_count: num(outcome.counts?.raw),
    normalized_count: num(outcome.counts?.normalized),
    unique_count: num(outcome.counts?.unique),
    accepted_count: num(outcome.counts?.accepted),
    rejected_count: num(outcome.counts?.rejected),
    // An estimate never becomes an actual, whatever the caller passes.
    actual_cost_usd: cost?.source === "provider_reported" ? num(cost.actual_usd) : null,
    estimated_cost_usd: num(cost?.estimated_usd),
    cost_source: cost?.source ?? "unknown",
    next_decision: outcome.next_decision ?? null,
    metadata: outcome.metadata ?? null,
  };
}

export interface AuditedResult<T> {
  result: T;
  ledger_id: string;
}

/**
 * Run `fn` with a ledger row opened before it and closed after it, always.
 *
 * THE GUARANTEE. A provider call must never disappear because execution threw.
 * The row is inserted before `fn` runs and finalized in a `finally`, so a throw,
 * a rejection and a timeout all leave a terminal row behind. `fn` decides the
 * outcome for the success path by returning it alongside its own result; a throw
 * is recorded as `failed` with the error's message.
 *
 * The ledger never changes what `fn` returns and never swallows its exception.
 * Writer failures are logged and dropped — observability must not be able to fail
 * a run it is only watching.
 */
export async function withExecutionAudit<T>(
  writer: LedgerWriter | null | undefined,
  spec: ExecutionCallSpec,
  fn: () => Promise<{ result: T; outcome: ExecutionOutcome }>,
): Promise<T> {
  // A null writer is a supported no-op: it is how the "auditing disabled behaves
  // identically" property is tested, and how a context without a database runs.
  if (!writer) return (await fn()).result;

  const row = buildStartedRow(spec);
  try {
    await writer.insert(row);
  } catch (e) {
    console.error("[execution-ledger] insert failed", String(e));
  }

  let outcome: ExecutionOutcome = {
    status: "failed",
    failure_code: "unfinished",
    failure_message: "execution did not report an outcome",
  };
  try {
    const r = await fn();
    outcome = r.outcome;
    return r.result;
  } catch (e) {
    const message = String((e as Error)?.message ?? e);
    outcome = {
      status: /timeout|timed[ _-]?out|deadline/i.test(message) ? "timed_out" : "failed",
      failure_code: (e as { code?: string })?.code ?? "exception",
      failure_message: message,
    };
    throw e;
  } finally {
    try {
      await writer.finalize(row.id, buildFinalPatch(row, outcome));
    } catch (e) {
      console.error("[execution-ledger] finalize failed", String(e));
    }
  }
}

// ── TASK SUMMARY ────────────────────────────────────────────────────────────

export interface StageSummary {
  stage: ExecutionStage;
  calls: number;
  raw: number | null;
  normalized: number | null;
  accepted: number | null;
  rejected: number | null;
}

export interface TaskLedgerSummary {
  task_id: string | null;

  /** The planner story, read from whichever row recorded it. */
  planner: {
    owner: string | null;
    adapter: string | null;
    outcome: string | null;
    fallback_reason: string | null;
  };
  execution_owner: string | null;

  /** PROVIDER CALLS ONLY. Stage results are not calls and never inflate this. */
  calls: number;
  attempts_beyond_first: number;
  succeeded: number;
  failed: number;
  timed_out: number;
  reused: number;
  /** Only provider-reported figures. */
  actual_cost_usd: number;
  /** Only estimates. Kept apart so the two are never added together by accident. */
  estimated_cost_usd: number;
  /** True when any cost in this task is an estimate rather than a reported figure. */
  cost_is_partly_estimated: boolean;
  total_duration_ms: number;
  by_stage: StageSummary[];
  /** Task-level funnel outcomes no single provider call could know. */
  stage_results: StageSummary[];
  /** The last recorded `next_decision`, which is why the workflow stopped. */
  stop_reason: string | null;
}

/** Sum, treating null as unknown rather than zero. Null when nothing was known. */
function sumKnown(values: Array<number | null>): number | null {
  const known = values.filter((v): v is number => typeof v === "number");
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}

/**
 * Reconstruct one task's execution from ledger rows alone.
 *
 * Pure: give it rows, get the story. This is the function that has to make
 * "diagnosable in minutes, by someone who was not present" true, so it is
 * deliberately readable rather than clever.
 */
export function summarizeTaskLedger(rows: ExecutionLedgerRow[]): TaskLedgerSummary {
  const ordered = [...rows].sort((a, b) => a.started_at.localeCompare(b.started_at));

  // THE TWO KINDS ARE NEVER MIXED. Summing a stage result into "provider calls"
  // would double-count the funnel and overstate how many times money was spent.
  const calls = ordered.filter((r) => (r.record_kind ?? "provider_call") === "provider_call");
  const stageRows = ordered.filter((r) => r.record_kind === "stage_result");

  const group = (rs: ExecutionLedgerRow[]): StageSummary[] => {
    const m = new Map<ExecutionStage, ExecutionLedgerRow[]>();
    for (const r of rs) m.set(r.stage, [...(m.get(r.stage) ?? []), r]);
    return [...m.entries()].map(([stage, list]) => ({
      stage,
      calls: list.length,
      raw: sumKnown(list.map((r) => r.raw_count)),
      normalized: sumKnown(list.map((r) => r.normalized_count)),
      accepted: sumKnown(list.map((r) => r.accepted_count)),
      rejected: sumKnown(list.map((r) => r.rejected_count)),
    }));
  };

  // Provenance is stamped on every row of a run, so the first row that carries it
  // is authoritative; a task with no rows reports nulls rather than guessing.
  const provenanced = ordered.find((r) => r.planner_owner || r.planner_outcome);
  const withDecision = [...ordered].reverse().find((r) => r.next_decision);

  return {
    task_id: ordered[0]?.task_id ?? null,
    planner: {
      owner: provenanced?.planner_owner ?? null,
      adapter: provenanced?.planner_adapter ?? null,
      outcome: provenanced?.planner_outcome ?? null,
      fallback_reason: provenanced?.planner_fallback_reason ?? null,
    },
    execution_owner: ordered.find((r) => r.execution_owner)?.execution_owner ?? null,
    calls: calls.length,
    attempts_beyond_first: calls.filter((r) => r.attempt_number > 1).length,
    succeeded: calls.filter((r) => r.status === "succeeded").length,
    failed: calls.filter((r) => r.status === "failed").length,
    timed_out: calls.filter((r) => r.status === "timed_out").length,
    reused: calls.filter((r) => r.status === "reused").length,
    actual_cost_usd: Number(calls.reduce((a, r) => a + (r.actual_cost_usd ?? 0), 0).toFixed(4)),
    estimated_cost_usd: Number(calls.reduce((a, r) => a + (r.estimated_cost_usd ?? 0), 0).toFixed(4)),
    cost_is_partly_estimated: calls.some((r) => r.cost_source === "estimated"),
    total_duration_ms: calls.reduce((a, r) => a + (r.duration_ms ?? 0), 0),
    by_stage: group(calls),
    stage_results: group(stageRows),
    stop_reason: withDecision?.next_decision ?? null,
  };
}

/** A compact, human-readable rendering of the summary. Diagnostics only. */
export function renderTaskLedger(s: TaskLedgerSummary): string {
  const fmt = (n: number | null) => (n === null ? "unknown" : String(n));
  const lines: string[] = [];
  lines.push(`Task ${s.task_id ?? "(unknown)"}`);

  lines.push("");
  lines.push("planner:");
  if (!s.planner.owner && !s.planner.outcome) {
    lines.push("  unknown");
  } else if (s.planner.outcome === "deterministic_fallback") {
    // The degraded case names what degraded it — that reason is the only
    // interesting field in this state.
    lines.push(`  ${s.planner.adapter ?? "?"} → deterministic fallback (${s.planner.fallback_reason ?? "no reason recorded"})`);
  } else if (s.planner.outcome === "selected_directly") {
    lines.push("  deterministic (selected directly — no adapter enabled)");
  } else {
    lines.push(`  ${s.planner.adapter ?? s.planner.owner} (plan accepted)`);
  }

  lines.push("");
  lines.push("execution:");
  lines.push(`  ${s.execution_owner ?? "unknown"}`);

  lines.push("");
  lines.push(`provider calls:`);
  lines.push(`  ${s.calls}` + (s.attempts_beyond_first ? ` (${s.attempts_beyond_first} retried)` : ""));
  if (s.failed || s.timed_out) lines.push(`  ${s.failed} failed, ${s.timed_out} timed out`);
  if (s.reused) lines.push(`  ${s.reused} reused an already-paid run`);

  lines.push("");
  lines.push("spend:");
  lines.push(`  $${s.actual_cost_usd.toFixed(2)} actual`);
  lines.push(`  $${s.estimated_cost_usd.toFixed(2)} estimated`);

  for (const st of s.by_stage) {
    lines.push("");
    lines.push(`${st.stage}:`);
    // "unknown" is printed rather than 0, because the difference between "we
    // checked and found none" and "we never looked" is the whole point.
    lines.push(`  ${fmt(st.raw)} raw`);
    lines.push(`  ${fmt(st.normalized)} normalized`);
    lines.push(`  ${fmt(st.accepted)} accepted`);
  }

  // Task-level outcomes, printed apart from provider calls so nobody reads a
  // funnel number as something one Actor produced.
  for (const st of s.stage_results) {
    lines.push("");
    lines.push(`${st.stage} (stage result):`);
    lines.push(`  ${fmt(st.accepted)} passed`);
    if (st.rejected !== null) lines.push(`  ${fmt(st.rejected)} rejected`);
  }

  lines.push("");
  lines.push("stop:");
  lines.push(`  ${s.stop_reason ?? "unknown"}`);
  return lines.join("\n");
}

/**
 * Record a task-level stage outcome — a funnel number no single provider call
 * could truthfully claim.
 *
 * Written as its own row with `record_kind: "stage_result"` and no provider run
 * id, so summing never confuses it with a paid call. `status` is always
 * `succeeded` because a stage result is an observation, not an attempt.
 */
export async function recordStageResult(
  writer: LedgerWriter | null | undefined,
  spec: Omit<ExecutionCallSpec, "record_kind" | "provider_id"> & { counts: ExecutionCounts; next_decision?: string | null },
): Promise<void> {
  if (!writer) return;
  const row = buildStartedRow({
    ...spec,
    record_kind: "stage_result",
    // A stage result is produced by Agentory's own gates, not by a vendor. Naming
    // a provider here would make it look like a purchase.
    provider_id: "agentory_internal",
  });
  try {
    await writer.insert(row);
    await writer.finalize(row.id, buildFinalPatch(row, {
      status: "succeeded",
      counts: spec.counts,
      next_decision: spec.next_decision ?? null,
    }));
  } catch (e) {
    console.error("[execution-ledger] stage result failed", String(e));
  }
}

// ── SUPABASE-BACKED WRITER ──────────────────────────────────────────────────

/** The narrow slice of a Supabase client this module uses. */
export interface LedgerDb {
  from(table: string): {
    insert(values: unknown): Promise<{ error: unknown }>;
    update(values: unknown): { eq(col: string, val: string): Promise<{ error: unknown }> };
  };
}

export const LEAD_EXECUTION_CALLS_TABLE = "lead_execution_calls" as const;

/**
 * A writer backed by the real table.
 *
 * Every failure is swallowed after logging. This is deliberate and is the one
 * place where swallowing is correct: the ledger watches execution and must never
 * be able to fail it. A missing audit row is a gap in evidence; a thrown audit
 * write is a lost lead run.
 */
export function createLedgerWriter(db: LedgerDb): LedgerWriter {
  return {
    async insert(row) {
      const { error } = await db.from(LEAD_EXECUTION_CALLS_TABLE).insert(row);
      if (error) console.error("[execution-ledger] insert error", String(error));
    },
    async finalize(id, patch) {
      const { error } = await db.from(LEAD_EXECUTION_CALLS_TABLE).update(patch).eq("id", id);
      if (error) console.error("[execution-ledger] finalize error", String(error));
    },
  };
}

// ── STAGE INFERENCE ─────────────────────────────────────────────────────────
//
// Derived from the vocabulary the call sites ALREADY pass — `capability_key` and
// `source_type` — rather than requiring every caller to be edited. A caller that
// knows better may still pass `stage` and `reason` explicitly, and when canonical
// capabilities arrive this function is the single place that changes.

export function inferStage(
  capabilityKey: string | null | undefined,
  sourceType: string | null | undefined,
): ExecutionStage {
  const k = `${capabilityKey ?? ""} ${sourceType ?? ""}`.toLowerCase();
  if (/contact|email|phone/.test(k)) return "contact_enrichment";
  if (/people|person|founder|decision/.test(k)) return "person_resolution";
  if (/job|hiring/.test(k)) return "hiring_evidence";
  if (/company_details|company_enrich|enrich/.test(k)) return "company_enrichment";
  if (/company|discover|yc|search/.test(k)) return "company_discovery";
  return "other";
}

/**
 * A stable identity for the logical call.
 *
 * Same workspace, task, capability and input hash ⇒ same key, so a genuine retry
 * of one question shares it and a different question does not. Falls back to the
 * stage when no input hash is available, which is weaker but never collides
 * across stages.
 */
export function logicalCallKey(args: {
  task_id?: string | null;
  capability?: string | null;
  stage: ExecutionStage;
  input_hash?: string | null;
}): string {
  return [
    args.task_id ?? "no-task",
    args.capability ?? args.stage,
    args.input_hash ?? "no-hash",
  ].join(":");
}
