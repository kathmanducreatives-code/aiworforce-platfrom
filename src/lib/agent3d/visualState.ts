// WHAT AN AGENT'S PORTRAIT — AND, LATER, ITS 3D MODEL — IS ALLOWED TO CLAIM.
//
//   agent backend state  →  visual state  →  animation / gesture
//
// This file is the middle arrow, and the only place where "what is true"
// becomes "what is shown". Everything downstream (the AgentVisual component,
// the renderer, a future rigged model) consumes an `AgentVisualState` and never
// looks at raw data itself.
//
// ── THE RULE ───────────────────────────────────────────────────────────────
//
// An agent is `working` only while one of its tasks is actually `running`, and
// `thinking` only while a reply or a plan is actually being produced. Counts
// are not state: "Lyra has 40 signals" says she worked once, not that she is
// working now. The dashboard's legacy `AgentState.status` derives `working`
// from exactly such counts, which is why nothing here reads it.
//
// When the evidence is missing, stale or ambiguous, the answer is `idle` — an
// agent that under-claims looks calm; one that over-claims is lying.
//
// PURE. No network, no React, no clock of its own: `now` is an input, so every
// rule below is testable at an exact instant.

// ── identities ─────────────────────────────────────────────────────────────

/** Public identities, the only ones a visual is keyed by. */
export type VisualAgentKey = 'pilot' | 'lyra' | 'atlas' | 'mira' | 'orion';
export const VISUAL_AGENT_KEYS: readonly VisualAgentKey[] = ['pilot', 'lyra', 'atlas', 'mira', 'orion'];

/**
 * Backend slug → public identity. MIRRORS `LEGACY_TO_PUBLIC` in
 * src/config/agentRegistry.ts, which cannot be imported here because it pulls
 * in image assets; a test reads that file and fails if the two drift.
 */
export const LEGACY_SLUG_TO_VISUAL: Readonly<Record<string, VisualAgentKey>> = {
  pilot: 'pilot',
  scout: 'lyra',
  aria: 'atlas',
  hawk: 'atlas',
  penn: 'mira',
  scribe: 'orion',
};

/** Unknown slugs resolve to null — work is never attributed by guesswork. */
export function visualAgentKey(slug?: string | null): VisualAgentKey | null {
  const key = String(slug ?? '').trim().toLowerCase();
  if (!key) return null;
  if ((VISUAL_AGENT_KEYS as readonly string[]).includes(key)) return key as VisualAgentKey;
  return LEGACY_SLUG_TO_VISUAL[key] ?? null;
}

// ── the model ──────────────────────────────────────────────────────────────

/** The continuous state a visual settles into. */
export type VisualBase = 'idle' | 'thinking' | 'working' | 'awaiting' | 'blocked';

/**
 * Something that just happened, acknowledged ONCE per `key` and then gone.
 * `failed` and `declined` (a guard refused before any paid work) are told apart
 * for the record; a renderer plays both as the same neutral beat — nothing
 * about a stopped task is celebrated or dramatised.
 */
export type VisualEventKind = 'completed' | 'failed' | 'declined';
export interface VisualEvent { kind: VisualEventKind; key: string; at: number }

export type VisualSource = 'task' | 'approval' | 'chat' | 'plan' | 'setup' | 'none';

export interface AgentVisualState {
  base: VisualBase;
  event: VisualEvent | null;
  /** Which kind of record the base state rests on. */
  source: VisualSource;
  /** Plain-language reason — for screen readers, tooltips and debugging. */
  reason: string;
}

export const IDLE_VISUAL: AgentVisualState = Object.freeze({ base: 'idle', event: null, source: 'none', reason: 'No live work' }) as AgentVisualState;

// ── live inputs (already fetched; shapes are deliberately minimal) ─────────

export interface LiveTask {
  id: string;
  agentSlug: string | null;
  status: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
}

/** A PENDING approval, already attributed (see `attributeApprovals`). */
export interface LiveApproval { id: string; agentSlug: string | null }

/** The chat the user is looking at, and whether a reply is being produced. */
export interface LiveChat { agentSlug: string | null; awaitingReply: boolean }

export interface LivePlan { id: string; status: string | null; createdAt?: string | null }

export interface LiveSnapshot {
  now: number;
  tasks: readonly LiveTask[];
  approvals: readonly LiveApproval[];
  chat: LiveChat | null;
  plans: readonly LivePlan[];
  /** Real configuration gates (e.g. Company Brain incomplete) — key → reason. */
  setupBlocked?: Partial<Record<VisualAgentKey, string>>;
}

// ── timing ─────────────────────────────────────────────────────────────────

/**
 * A `running` row counts only if it was touched this recently. Nothing bumps
 * `tasks.updated_at` on a heartbeat, so a worker that died mid-run leaves a
 * row that says `running` forever; past this window it is treated as stale.
 * A genuinely long run may therefore settle to idle early — the safe error.
 */
export const RUNNING_FRESH_MS = 15 * 60_000;
/** A finish is acknowledged only while it is news. */
export const EVENT_WINDOW_MS = 2 * 60_000;
/** A plan sitting in `planning` longer than this is not "thinking" any more. */
export const PLANNING_FRESH_MS = 5 * 60_000;
/** Tolerated clock skew between the database and this browser. */
const SKEW_MS = 60_000;

// ── task lifecycle ─────────────────────────────────────────────────────────

export type TaskPhase = 'active' | 'queued' | 'awaiting' | 'succeeded' | 'failed' | 'declined' | 'checkpoint' | 'ignored';

/**
 * Database lifecycle → what it means for a visual. `ready` and `partial` are
 * CHECKPOINTS — the run did real work and will continue — so they are neither
 * `working` (nothing is executing) nor `completed` (the work is not done).
 */
export function taskPhase(status: string | null | undefined): TaskPhase {
  switch ((status ?? '').toLowerCase()) {
    case 'running': return 'active';
    case 'pending': return 'queued';
    case 'awaiting_approval': return 'awaiting';
    case 'complete': case 'completed': case 'done': return 'succeeded';
    case 'failed': return 'failed';
    case 'blocked': return 'declined';
    case 'ready': case 'partial': return 'checkpoint';
    default: return 'ignored';
  }
}

function ms(iso?: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function latest(...values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? Math.max(...present) : null;
}

/** When a running task last showed life, or null if it never said. */
function lastSign(task: LiveTask): number | null {
  return latest(ms(task.updatedAt), ms(task.startedAt), ms(task.createdAt));
}

function finishedAt(task: LiveTask): number | null {
  return latest(ms(task.finishedAt), ms(task.completedAt)) ?? ms(task.updatedAt);
}

function within(at: number | null, now: number, window: number): at is number {
  return at !== null && at <= now + SKEW_MS && now - at <= window;
}

// ── approvals ──────────────────────────────────────────────────────────────

export interface RawApproval { id: string; agent_id?: string | null; task_id?: string | null; title?: string | null }

/**
 * Who an approval belongs to — from its `agent_id`, else its task's slug, else
 * nobody. NEVER from its title: "Draft outreach email" is not evidence that
 * Mira is waiting, and an unattributed approval is shown in the review queue,
 * not pinned on whichever face its wording resembles.
 */
export function attributeApprovals(
  approvals: readonly RawApproval[],
  agentSlugById: Readonly<Record<string, string>>,
  taskSlugById: Readonly<Record<string, string | null>>,
): LiveApproval[] {
  return approvals.map((a) => ({
    id: a.id,
    agentSlug: (a.agent_id && agentSlugById[a.agent_id]) || (a.task_id && taskSlugById[a.task_id]) || null,
  }));
}

// ── derivation ─────────────────────────────────────────────────────────────

interface Candidate { base: VisualBase; source: VisualSource; reason: string; rank: number }

const RANK: Record<VisualBase, number> = { working: 4, thinking: 3, awaiting: 2, blocked: 1, idle: 0 };

/**
 * Every agent's visual state at `snapshot.now`.
 *
 * Priority when several are true: working > thinking > awaiting > blocked.
 * What is happening beats what is waiting, and a setup gate yields to a task
 * that is demonstrably running despite it.
 */
export function deriveAgentVisualStates(snapshot: LiveSnapshot): Record<VisualAgentKey, AgentVisualState> {
  const { now } = snapshot;
  const best = new Map<VisualAgentKey, Candidate>();
  const events = new Map<VisualAgentKey, VisualEvent>();
  const quiet = new Map<VisualAgentKey, string>();

  const offer = (key: VisualAgentKey | null, c: Omit<Candidate, 'rank'>) => {
    if (!key) return;
    const rank = RANK[c.base];
    const held = best.get(key);
    if (!held || rank > held.rank) best.set(key, { ...c, rank });
  };

  for (const task of snapshot.tasks) {
    const key = visualAgentKey(task.agentSlug);
    if (!key) continue;
    const phase = taskPhase(task.status);
    if (phase === 'active') {
      if (within(lastSign(task), now, RUNNING_FRESH_MS)) offer(key, { base: 'working', source: 'task', reason: 'Running a task' });
      else quiet.set(key, 'Last run went quiet');
    } else if (phase === 'queued') {
      quiet.set(key, quiet.get(key) ?? 'Task queued');
    } else if (phase === 'checkpoint') {
      quiet.set(key, quiet.get(key) ?? 'Paused at a checkpoint');
    } else if (phase === 'succeeded' || phase === 'failed' || phase === 'declined') {
      const at = finishedAt(task);
      if (!within(at, now, EVENT_WINDOW_MS)) continue;
      const kind: VisualEventKind = phase === 'succeeded' ? 'completed' : phase;
      const held = events.get(key);
      if (!held || at > held.at) events.set(key, { kind, key: `${kind}:${task.id}`, at });
    }
  }

  for (const approval of snapshot.approvals) {
    offer(visualAgentKey(approval.agentSlug), { base: 'awaiting', source: 'approval', reason: 'Waiting for your approval' });
  }

  if (snapshot.chat?.awaitingReply) {
    offer(visualAgentKey(snapshot.chat.agentSlug), { base: 'thinking', source: 'chat', reason: 'Replying to you' });
  }

  for (const plan of snapshot.plans) {
    if ((plan.status ?? '').toLowerCase() === 'planning' && within(ms(plan.createdAt), now, PLANNING_FRESH_MS)) {
      offer('pilot', { base: 'thinking', source: 'plan', reason: 'Planning the work' });
    }
  }

  for (const [key, reason] of Object.entries(snapshot.setupBlocked ?? {}) as [VisualAgentKey, string | undefined][]) {
    if (reason) offer(key, { base: 'blocked', source: 'setup', reason });
  }

  const out = {} as Record<VisualAgentKey, AgentVisualState>;
  for (const key of VISUAL_AGENT_KEYS) {
    const c = best.get(key);
    out[key] = c
      ? { base: c.base, source: c.source, reason: c.reason, event: events.get(key) ?? null }
      : { base: 'idle', source: 'none', reason: quiet.get(key) ?? IDLE_VISUAL.reason, event: events.get(key) ?? null };
  }
  return out;
}

/**
 * The next instant at which the SAME data would derive a different state —
 * a running row going stale, an event leaving its window, a plan outgrowing
 * `planning`. The caller sets one timer for it instead of polling; null means
 * nothing changes until the data does.
 */
export function nextVisualExpiry(snapshot: LiveSnapshot): number | null {
  const { now } = snapshot;
  const edges: number[] = [];
  for (const task of snapshot.tasks) {
    if (!visualAgentKey(task.agentSlug)) continue;
    const phase = taskPhase(task.status);
    if (phase === 'active') {
      const sign = lastSign(task);
      if (within(sign, now, RUNNING_FRESH_MS)) edges.push(sign + RUNNING_FRESH_MS);
    } else if (phase === 'succeeded' || phase === 'failed' || phase === 'declined') {
      const at = finishedAt(task);
      if (within(at, now, EVENT_WINDOW_MS)) edges.push(at + EVENT_WINDOW_MS);
    }
  }
  for (const plan of snapshot.plans) {
    const at = ms(plan.createdAt);
    if ((plan.status ?? '').toLowerCase() === 'planning' && within(at, now, PLANNING_FRESH_MS)) edges.push(at + PLANNING_FRESH_MS);
  }
  const future = edges.filter((t) => t > now);
  return future.length ? Math.min(...future) + 1 : null;
}

/** True while some agent is demonstrably running — the only time a heartbeat is worth its reads. */
export function anyAgentWorking(states: Readonly<Record<VisualAgentKey, AgentVisualState>>): boolean {
  return VISUAL_AGENT_KEYS.some((k) => states[k].base === 'working');
}
