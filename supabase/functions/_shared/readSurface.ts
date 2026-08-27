// ANSWERING FROM WHAT IS ALREADY KNOWN.
//
// ── THE GUARANTEE, AND HOW IT IS MADE ──────────────────────────────────────
//
// A `read` must reach no provider. Not "should not" — CANNOT. This module
// imports the database client type and nothing else: no tool registry, no
// capability engine, no Apify surface, no credit path. There is nothing here to
// invoke even by mistake, which is a stronger guarantee than a flag someone can
// forget to check, and it is asserted structurally by
// `readSurface.test.ts`.
//
// The same reasoning that made `read` a separate objective in the first place:
// asking what we already know must never become a purchase.
//
// ── WHY THE PLAN AND THE EXECUTION ARE SEPARATE ────────────────────────────
//
// `planRead` is pure, so every routing decision can be exercised without a
// database. `executeRead` does nothing but run the plan's queries. A caller
// that wants to know what a request WOULD read — a preview, a test, an audit —
// asks for the plan and never touches the data.
//
// ── WHY `company` READS TWO TABLES ─────────────────────────────────────────
//
// Measured, not assumed. Chat Brain returns `entity: company` for both
// "how many leads do I have?" and "which companies am I already watching?" —
// the entity is genuinely the same and the wording does not separate them.
// Rather than guess a table from phrasing, which is the keyword matching this
// migration exists to remove, a company read answers with BOTH: the leads held
// and the subjects watched. That is the honest answer to "what companies do I
// have", and it is never wrong in the way a guess would be.

import type { RequestV1, RequestPart } from "./requestV1.ts";

export const READ_SURFACE_VERSION = "read-surface-v1" as const;

/** What a read looks at. Derived from the request's entity, never its wording. */
export type ReadTarget = "signals" | "companies" | "runs";

export interface ReadPlan {
  version: typeof READ_SURFACE_VERSION;
  target: ReadTarget | null;
  /** Bounded on purpose — a chat answer is a summary, not an export. */
  limit: number;
  /** Only when the request stated one. */
  since_days: number | null;
  /** Why no target could be chosen. Null when one was. */
  unsupported: string | null;
}

const DEFAULT_LIMIT = 10;

/**
 * What would this request read?
 *
 * Pure and total: an entity with no read surface yields `target: null` and a
 * reason, never a nearest-match.
 */
export function planRead(request: RequestV1): ReadPlan {
  const part: RequestPart | undefined =
    request.parts.find((p) => p.objective === "read") ?? request.parts[0];
  const base = {
    version: READ_SURFACE_VERSION, limit: DEFAULT_LIMIT,
    since_days: null as number | null, unsupported: null as string | null,
  };
  if (!part) return { ...base, target: null, unsupported: "no_part" };

  // A stated recency is the only filter a read honours today. Everything else
  // the request carries is reported by the caller rather than silently ignored.
  const recency = (part.requirements ?? [])
    .map((r) => r.recency_days).find((d) => typeof d === "number" && d > 0) ?? null;

  const limit = part.output.count && part.output.count > 0
    ? Math.min(part.output.count, 50) : DEFAULT_LIMIT;

  switch (part.subject.entity) {
    case "signal":
      return { ...base, target: "signals", limit, since_days: recency };
    case "company":
    case "person":
      return { ...base, target: "companies", limit, since_days: recency };
    case "conversation":
      return { ...base, target: "runs", limit, since_days: recency };
    default:
      return {
        ...base, target: null,
        unsupported: `no_read_surface_for_entity:${part.subject.entity}`,
      };
  }
}

/** Rows a read may return. Shaped for rendering, not for further work. */
export interface ReadResult {
  target: ReadTarget;
  /** Headline counts, so an answer can be given even when nothing is listed. */
  counts: Record<string, number>;
  items: Array<Record<string, unknown>>;
  /** True when the workspace genuinely holds nothing of this kind. */
  empty: boolean;
}

/** The narrow client surface this module is allowed to use. */
export interface ReadDb {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
}

/**
 * Run a read plan.
 *
 * DATABASE ONLY. Every failure yields an empty result rather than throwing: a
 * question about held evidence should degrade to "I could not find anything"
 * rather than an error, and there is no spend to protect on this path.
 */
export async function executeRead(
  db: ReadDb, plan: ReadPlan, workspaceId: string,
): Promise<ReadResult | null> {
  if (!plan.target) return null;
  const sinceIso = plan.since_days
    ? new Date(Date.now() - plan.since_days * 86_400_000).toISOString() : null;

  try {
    if (plan.target === "signals") {
      let q = db.from("signal_events")
        .select("signal_type, subject_key, occurred_at, confidence, freshness, origin, source_url")
        .eq("workspace_id", workspaceId)
        .order("occurred_at", { ascending: false })
        .limit(plan.limit);
      if (sinceIso) q = q.gte("occurred_at", sinceIso);
      const { data } = await q;
      const items = (data ?? []) as Array<Record<string, unknown>>;
      const byType: Record<string, number> = {};
      for (const r of items) {
        const t = String(r.signal_type ?? "unknown");
        byType[t] = (byType[t] ?? 0) + 1;
      }
      return { target: "signals", counts: { total: items.length, ...byType },
        items, empty: items.length === 0 };
    }

    if (plan.target === "companies") {
      // BOTH HALVES — see the header. "What companies do I have" means the
      // leads held and the subjects watched, and the entity does not separate
      // them.
      let lq = db.from("lead_candidates")
        .select("id, status, fit_score, priority, reason, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(plan.limit);
      if (sinceIso) lq = lq.gte("created_at", sinceIso);
      const { data: leads } = await lq;
      const { data: watched } = await db.from("monitoring_subjects")
        .select("label, identifier, signals, enabled, last_run_at")
        .eq("workspace_id", workspaceId).eq("enabled", true).limit(plan.limit);
      const l = (leads ?? []) as Array<Record<string, unknown>>;
      const w = (watched ?? []) as Array<Record<string, unknown>>;
      return {
        target: "companies",
        counts: { leads: l.length, watched: w.length },
        items: [...l.map((x) => ({ kind: "lead", ...x })),
                ...w.map((x) => ({ kind: "watched", ...x }))],
        empty: l.length === 0 && w.length === 0,
      };
    }

    // runs
    let rq = db.from("tasks")
      .select("id, status, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(plan.limit);
    if (sinceIso) rq = rq.gte("created_at", sinceIso);
    const { data } = await rq;
    const items = (data ?? []) as Array<Record<string, unknown>>;
    return { target: "runs", counts: { total: items.length }, items,
      empty: items.length === 0 };
  } catch (e) {
    console.warn("[read-surface] query failed", String(e));
    return { target: plan.target, counts: {}, items: [], empty: true };
  }
}

/**
 * How many entities the answer actually lists.
 *
 * The renderer's own slice, named. `presentedCompanies` and the prose below
 * must agree on it, and a literal repeated in two places is how they stop
 * agreeing.
 */
export const READ_DISPLAY_LIMIT = 5;

/**
 * The companies this answer PUTS ON SCREEN, in the order it puts them there.
 *
 * ── WHY THIS IS AN EXPORT AND NOT AN INLINE MAP ────────────────────────────
 *
 * "The second company" is a position in what was displayed. The read answer
 * lists only the WATCHED half — leads are counted, not named — and only the
 * first few of those, so the displayed order is neither the query order nor the
 * full result set. Anything persisting referents for this message has to apply
 * exactly that filter and exactly that slice, and the only way to guarantee it
 * does is for the renderer to call the same function.
 */
export function presentedCompanies(
  result: ReadResult | null,
): Array<{ display: string; label: string | null; identifier: string | null }> {
  if (!result || result.target !== "companies") return [];
  return result.items
    .filter((i) => i.kind === "watched")
    .slice(0, READ_DISPLAY_LIMIT)
    .map((i) => ({
      display: String(i.label ?? i.identifier),
      label: typeof i.label === "string" ? i.label : null,
      identifier: typeof i.identifier === "string" ? i.identifier : null,
    }));
}

/**
 * Say what was found, in the user's terms.
 *
 * ── WHY THE RENDERER IS DETERMINISTIC ──────────────────────────────────────
 *
 * The whole point of `read` is that the answer comes from held evidence. Handing
 * these rows to a model to phrase would reintroduce the risk the objective
 * exists to remove: a fluent sentence about signals that are not in the table.
 * So the numbers are counted here and stated plainly, and nothing in the answer
 * can be true of a workspace that does not hold it.
 *
 * An empty result says so. "I found nothing" is a real answer to a question
 * about held evidence, and dressing it up as a failure would send the user
 * looking for a bug instead of running a search.
 */
export function renderReadAnswer(plan: ReadPlan, result: ReadResult | null): string {
  if (!plan.target) {
    return "I understood that as a question about what I already know, but I don't have a way to look that up yet.";
  }
  const window = plan.since_days ? ` in the last ${plan.since_days} days` : "";
  if (!result || result.empty) {
    if (plan.target === "signals") {
      return `I don't have any signals recorded${window} yet. Once a workflow or a monitor runs, they'll show up here.`;
    }
    if (plan.target === "companies") {
      return "You don't have any leads saved or companies being watched yet.";
    }
    return `I don't have any runs recorded${window}.`;
  }

  if (result.target === "signals") {
    const { total, ...byType } = result.counts;
    const kinds = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ");
    const recent = result.items.slice(0, 5)
      .map((r) => `• ${String(r.subject_key ?? "unknown")} — ${String(r.signal_type ?? "signal").replace(/_/g, " ")}`)
      .join("\n");
    return `You have ${total} signal${total === 1 ? "" : "s"}${window}${kinds ? ` (${kinds})` : ""}.\n\n${recent}`;
  }

  if (result.target === "companies") {
    const { leads = 0, watched = 0 } = result.counts;
    const bits: string[] = [];
    if (leads) bits.push(`${leads} lead${leads === 1 ? "" : "s"} saved`);
    if (watched) bits.push(`${watched} compan${watched === 1 ? "y" : "ies"} being watched`);
    // RENDERED FROM THE SAME LIST THAT IS PERSISTED AS REFERENTS. Two walks of
    // `result.items` with the same filter and the same slice would be two
    // orderings that can drift, and "the second company" indexes this one.
    const names = presentedCompanies(result)
      .map((e) => `• ${e.display}`).join("\n");
    return `${bits.join(" and ")}${window}.${names ? `\n\nWatching:\n${names}` : ""}`;
  }

  const total = result.counts.total ?? 0;
  const rows = result.items.slice(0, 5)
    .map((r) => `• ${String(r.status ?? "?")} — ${String(r.created_at ?? "").slice(0, 16).replace("T", " ")}`)
    .join("\n");
  return `${total} run${total === 1 ? "" : "s"}${window}.\n\n${rows}`;
}
