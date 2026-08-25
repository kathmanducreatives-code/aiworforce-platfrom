// PHASE 5 — INDEPENDENT EVENTS BECOME SITUATIONS.
//
// ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
//
// "Acme raised, and is hiring SDRs, and its founder is posting" cannot be said
// today. Each event is scored alone, so three facts about one company read as
// three rows instead of one situation — and the situation is the thing a person
// acts on.
//
// ── THE PLAN SAID GROUP BY `account_id` OVER `occurred_at`. NEITHER EXISTS. ──
//
// Both columns are in the schema, which is what made them look available. Read
// from the store on 2026-08-25: all thirteen events carry `account_id: NULL`
// and all thirteen carry `occurred_at: NULL` with basis `unknown`. Grouping by
// account would produce one cluster of nulls; a window over `occurred_at` would
// select nothing.
//
// That is not an oversight in the data. It is Phase 2's rule holding: a
// market or competitor signal must use a REAL SUBJECT MODEL rather than a
// borrowed account identity, and no source time may be invented. So the key is
// the identity the events actually carry, and the window is over the best time
// each event actually has — with the cluster stating which.
//
// ── ORIGIN-AGNOSTIC, DELIBERATELY ───────────────────────────────────────────
//
// Nothing here reads `origin` except to COUNT it. A cluster mixing lead-origin
// and monitor-origin events forms exactly as one of a single origin does, and
// its priority is identical. Content consumes this same structure in Phase 9,
// so a Signals-shaped output here would buy a refactor later.
//
// PURE. No network, provider, model or database access.

export const SIGNAL_CLUSTER_VERSION = "signal-cluster-v1" as const;

/** The fields a cluster reads. A superset row is fine; extras are ignored. */
export interface ClusterableEvent {
  id?: string | null;
  workspace_id: string;
  signal_type: string;
  signal_category?: string | null;
  origin?: string | null;
  subject_type?: string | null;
  subject_key?: string | null;
  account_id?: string | null;
  occurred_at?: string | null;
  occurred_at_basis?: "source_reported" | "unknown" | null;
  observed_at: string;
  verification_status?: string | null;
  confidence?: string | null;
  lifecycle_status?: string | null;
}

/**
 * WHICH TIME AN EVENT ACTUALLY HAS, and which one this is.
 *
 * "Three things happened this week" and "we noticed three things this week" are
 * different claims, and only one of them is about the company. An event whose
 * basis is `source_reported` has a real event time; every other event has only
 * the moment we looked. Both are usable for a window — neither may be presented
 * as the other, so the kind travels with the value.
 */
export type TimeBasis = "occurred" | "observed";

export function eventTime(e: ClusterableEvent): { at: string; basis: TimeBasis } {
  if (e.occurred_at_basis === "source_reported" && e.occurred_at) {
    return { at: e.occurred_at, basis: "occurred" };
  }
  return { at: e.observed_at, basis: "observed" };
}

/**
 * The identity a cluster groups on.
 *
 * `account_id` FIRST, when an event has one: a lead-origin event is about a
 * real account, and that is the strongest identity in the system. The subject
 * pair otherwise, which is what every event written so far actually carries.
 *
 * ── THE FRAGMENTATION RISK, STATED RATHER THAN HIDDEN ─────────────────────
 *
 * These two namespaces do not currently meet. A company watched by LinkedIn URL
 * is keyed `linkedin-com-company-vercel`; the same company discovered by a
 * funding round is keyed by its domain. Nothing here reconciles them, and
 * pretending otherwise would merge two companies or split one silently.
 *
 * `clusterKeyKind` is reported on every cluster so a consumer can see which
 * namespace it was built in, and `identityFragmentationRisk` names the pairs a
 * reconciliation would have to resolve.
 */
export type ClusterKeyKind = "account" | "subject";

export function clusterKey(e: ClusterableEvent): { key: string; kind: ClusterKeyKind } | null {
  if (e.account_id) return { key: `account:${e.account_id}`, kind: "account" };
  if (e.subject_type && e.subject_key) {
    return { key: `subject:${e.subject_type}:${e.subject_key}`, kind: "subject" };
  }
  // An event that names neither cannot be correlated. Dropped, and counted by
  // the caller — never folded into somebody else's situation.
  return null;
}

export interface SignalCluster {
  version: typeof SIGNAL_CLUSTER_VERSION;
  workspace_id: string;
  /** The grouping identity, and which namespace it came from. */
  key: string;
  key_kind: ClusterKeyKind;
  subject_type: string | null;
  subject_key: string | null;
  account_id: string | null;
  /** Every contributing event, newest first by its own best time. */
  events: ClusterableEvent[];
  /** Distinct signal types, sorted. What the situation is MADE of. */
  signal_types: string[];
  /** Distinct categories, sorted. Breadth is what makes a situation. */
  categories: string[];
  /** Distinct origins and their counts. Reported, never scored. */
  origins: Record<string, number>;
  /**
   * HOW MUCH OF THIS IS DATED, and how much is only observed.
   *
   * A cluster of three events none of which carries a source time is a cluster
   * of three things we noticed, and a reader deserves to know that before
   * acting on it.
   */
  timing: { occurred: number; observed_only: number };
  /** The span the contributing events cover, by their own best times. */
  window: { from: string; to: string };
  priority: number;
  /** Why the priority is what it is. Deterministic and inspectable. */
  priority_reasons: string[];
}

export interface ClusterOptions {
  /** Events older than this many days are not part of the situation. */
  window_days?: number;
  /** Evaluation clock, injectable so tests need no sleeping. */
  now?: number;
  /** Lifecycle states a cluster may be built from. Default: active only. */
  lifecycle?: readonly string[];
}

const DEFAULT_WINDOW_DAYS = 90;

/**
 * Score a situation, deterministically.
 *
 * ── WHAT IT REWARDS, AND WHY EACH ───────────────────────────────────────────
 *
 * BREADTH over volume. Three funding rows about one company is one fact
 * reported three times; funding AND hiring AND a launch is a company doing
 * something. So distinct CATEGORIES weigh most, distinct TYPES next, and raw
 * event count least — it is the weakest of the three and is capped, because
 * otherwise a chatty provider outranks a real situation.
 *
 * PROVEN over asserted. An event a provider verified counts more than one
 * nobody checked.
 *
 * DATED over noticed. An event that knows when it happened is worth more than
 * one that only knows when we looked.
 *
 * NOT ORIGIN. `origin` is counted and never scored — the same three facts must
 * rank identically whether a Lead mission or a monitor found them.
 */
export function scoreCluster(
  events: readonly ClusterableEvent[],
): { priority: number; reasons: string[] } {
  const reasons: string[] = [];
  const types = new Set(events.map((e) => e.signal_type));
  const categories = new Set(
    events.map((e) => e.signal_category).filter((c): c is string => !!c),
  );

  let score = 0;
  if (categories.size > 1) {
    score += categories.size * 20;
    reasons.push(`${categories.size} distinct signal categories`);
  } else if (categories.size === 1) {
    score += 10;
    reasons.push("one signal category");
  }
  if (types.size > 1) {
    score += types.size * 10;
    reasons.push(`${types.size} distinct signal types`);
  }
  // CAPPED. Volume is the weakest evidence of a situation and the easiest for a
  // provider to inflate.
  const volume = Math.min(events.length, 5);
  score += volume;
  reasons.push(`${events.length} event(s)`);

  const verified = events.filter((e) =>
    e.verification_status === "provider_verified").length;
  if (verified > 0) {
    score += verified * 5;
    reasons.push(`${verified} provider-verified`);
  }
  const dated = events.filter((e) => eventTime(e).basis === "occurred").length;
  if (dated > 0) {
    score += dated * 3;
    reasons.push(`${dated} with a reported date`);
  } else {
    reasons.push("no event carries a source date — every time here is an observation");
  }
  return { priority: score, reasons };
}

export interface ClusterResult {
  clusters: SignalCluster[];
  /** Events excluded, with the reason. Never silently dropped. */
  excluded: { uncorrelatable: number; out_of_window: number; wrong_lifecycle: number };
}

/**
 * Group events into situations.
 *
 * Clusters are returned highest-priority first, then by key so the order is
 * stable for equal scores — a feed that reshuffles between reloads is a feed
 * nobody trusts.
 */
export function clusterSignalEvents(
  events: readonly ClusterableEvent[],
  opts: ClusterOptions = {},
): ClusterResult {
  const now = opts.now ?? Date.now();
  const windowDays = opts.window_days ?? DEFAULT_WINDOW_DAYS;
  const cutoff = now - windowDays * 86_400_000;
  const lifecycle = new Set(opts.lifecycle ?? ["active"]);

  const excluded = { uncorrelatable: 0, out_of_window: 0, wrong_lifecycle: 0 };
  const groups = new Map<string, { kind: ClusterKeyKind; events: ClusterableEvent[] }>();

  for (const e of events) {
    if (e.lifecycle_status && !lifecycle.has(e.lifecycle_status)) {
      excluded.wrong_lifecycle++;
      continue;
    }
    const t = Date.parse(eventTime(e).at);
    if (!Number.isFinite(t) || t < cutoff) {
      excluded.out_of_window++;
      continue;
    }
    const k = clusterKey(e);
    if (!k) {
      excluded.uncorrelatable++;
      continue;
    }
    // SCOPED TO THE WORKSPACE. Two workspaces watching the same competitor have
    // two situations, not one — the evidence, the ICP and the action all differ.
    const id = `${e.workspace_id}|${k.key}`;
    const g = groups.get(id) ?? { kind: k.kind, events: [] };
    g.events.push(e);
    groups.set(id, g);
  }

  const clusters: SignalCluster[] = [];
  for (const [id, g] of groups) {
    const sorted = [...g.events].sort((a, b) =>
      Date.parse(eventTime(b).at) - Date.parse(eventTime(a).at));
    const first = sorted[0];
    const times = sorted.map((e) => eventTime(e));
    const { priority, reasons } = scoreCluster(sorted);
    const origins: Record<string, number> = {};
    for (const e of sorted) {
      const o = e.origin ?? "unknown";
      origins[o] = (origins[o] ?? 0) + 1;
    }
    clusters.push({
      version: SIGNAL_CLUSTER_VERSION,
      workspace_id: first.workspace_id,
      key: id.slice(id.indexOf("|") + 1),
      key_kind: g.kind,
      subject_type: first.subject_type ?? null,
      subject_key: first.subject_key ?? null,
      account_id: first.account_id ?? null,
      events: sorted,
      signal_types: [...new Set(sorted.map((e) => e.signal_type))].sort(),
      categories: [...new Set(
        sorted.map((e) => e.signal_category).filter((c): c is string => !!c),
      )].sort(),
      origins,
      timing: {
        occurred: times.filter((t) => t.basis === "occurred").length,
        observed_only: times.filter((t) => t.basis === "observed").length,
      },
      window: {
        from: times[times.length - 1].at,
        to: times[0].at,
      },
      priority,
      priority_reasons: reasons,
    });
  }

  clusters.sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
  return { clusters, excluded };
}

/**
 * Subject keys that may name the same company in different namespaces.
 *
 * ── WHY THIS REPORTS RATHER THAN MERGES ─────────────────────────────────────
 *
 * "Correlation is only as good as the join key" is the whole risk of this
 * phase. A company watched by LinkedIn URL and the same company discovered by a
 * funding round land under different keys, and their situations split without
 * anything saying so.
 *
 * Merging them requires resolving both to one canonical identity, which is
 * `company_identity_resolution`'s job and needs a provider call. Guessing from
 * string shape would merge two companies that share a word — the exact mistake
 * `acceptLinkedInMatch` exists to prevent.
 *
 * So this NAMES the candidates and merges nothing. A caller that wants them
 * joined must resolve them properly.
 */
export function identityFragmentationRisk(
  clusters: readonly SignalCluster[],
): Array<{ workspace_id: string; token: string; keys: string[] }> {
  const byToken = new Map<string, Set<string>>();
  for (const c of clusters) {
    if (c.key_kind !== "subject" || !c.subject_key) continue;
    // The longest alphanumeric run in the key — `vercel` from both
    // `linkedin-com-company-vercel` and `vercel-com`. A weak signal, which is
    // exactly why it reports instead of acting.
    const token = c.subject_key.split("-")
      .filter((p) => p.length > 3 && !["linkedin", "com", "company", "www"].includes(p))
      .sort((a, b) => b.length - a.length)[0];
    if (!token) continue;
    const id = `${c.workspace_id}|${token}`;
    const set = byToken.get(id) ?? new Set<string>();
    set.add(c.subject_key);
    byToken.set(id, set);
  }
  const out: Array<{ workspace_id: string; token: string; keys: string[] }> = [];
  for (const [id, keys] of byToken) {
    if (keys.size < 2) continue;
    const [workspace_id, token] = id.split("|");
    out.push({ workspace_id, token, keys: [...keys].sort() });
  }
  return out.sort((a, b) => a.token.localeCompare(b.token));
}
