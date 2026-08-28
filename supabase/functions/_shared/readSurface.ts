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
import type { ResolvedReferentBinding } from "./referentBinding.ts";
import {
  type Outcome, satisfied, partiallySatisfied, unsupported, failed,
} from "./outcomeContract.ts";
import { canonicalLinkedinCompanyUrl } from "./companyIdentity.ts";
import { canonicalSubjectKey } from "./signalSubject.ts";
import type { DeclaredGap } from "./outcomeContract.ts";

export const READ_SURFACE_VERSION = "read-surface-v1" as const;

/** What a read looks at. Derived from the request's entity, never its wording. */
export type ReadTarget =
  | "signals" | "companies" | "runs" | "company_detail"
  /**
   * THE WHOLE WORKSPACE, AS PROSE.
   *
   * "Brief me on today", "what needs my attention", "how are things looking?" —
   * a read whose answer is a summary rather than a list. It is served by the
   * existing `daily-brief` function, which is why this target carries no query
   * of its own: `executeRead` returns null for it and the caller delegates.
   */
  | "brief"
  /**
   * DRAFTS WAITING ON A PERSON.
   *
   * Read from `approvals`, falling back to `tasks.status = 'awaiting_approval'`
   * for flows that predate that table. Zero-spend like every other read.
   */
  | "approvals";

/**
 * ONE company, identified — the scope a resolved referent creates.
 *
 * Built only from a `ResolvedReferentBinding`, never from the request. The
 * model can say a reference exists; it cannot say which company it is, and this
 * is the field that would let it if it could reach it.
 */
export interface ReadSubject {
  /** `CompanyIdentity.dedupeKey`. The internal key, for provenance. */
  entity_key: string;
  /** What to call it in the answer. Never an identifier. */
  label: string;
  domain: string | null;
  /** The FULL canonical URL, not the schemeless comparison key. */
  linkedin_url: string | null;
  /**
   * The `signal_events.subject_key` values this company's evidence is stored
   * under — derived exactly as the writers derive them.
   *
   * STRONG IDENTIFIERS ONLY. A key built from the company NAME is deliberately
   * absent: `run-agent` refuses to write one for the stated reason that two
   * companies share a word, and a READ that matched on a name would show one
   * company's evidence under another's. That is a wrong answer rather than a
   * missing one, and a missing one is recoverable.
   */
  subject_keys: string[];
}

export interface ReadPlan {
  version: typeof READ_SURFACE_VERSION;
  target: ReadTarget | null;
  /** Bounded on purpose — a chat answer is a summary, not an export. */
  limit: number;
  /** Only when the request stated one. */
  since_days: number | null;
  /**
   * The one company this read is scoped to, when a referent resolved to one.
   *
   * Null is the ordinary case and means exactly what it always meant: a
   * workspace-wide read. The scoping is additive — an unbound request reaches
   * the identical queries it reached before this field existed.
   */
  subject: ReadSubject | null;
  /**
   * EVERY COMPANY THIS READ IS SCOPED TO.
   *
   * `subject` is the single-company case and is exactly `subjects[0]` when
   * there is one and `null` otherwise — both are derived here, in one place,
   * so they cannot disagree. A read scoped to several companies ("which of
   * those look strongest?" after five were listed) is a different query from a
   * read scoped to one, and pretending it was the first of them would answer a
   * question the user did not ask.
   */
  subjects: ReadSubject[];
  /**
   * Did the REQUEST set this limit, or is it the default page?
   *
   * The renderer needs the difference. A default page shows a short sample
   * because a chat answer listing ten companies is worse than one listing
   * five; a limit the user asked for must be shown in full, or asking was
   * pointless. Deriving it from `limit !== DEFAULT_LIMIT` would be wrong the
   * moment someone asks for exactly ten.
   */
  explicit_limit: boolean;
  /** Why no target could be chosen. Null when one was. */
  unsupported: string | null;
}

/**
 * The read scope a binding creates, or null.
 *
 * Deterministic and total. A binding always carries a strong identifier — the
 * resolver refuses to bind anything weaker — so the only null case is no
 * binding at all.
 */
export function readSubjectFor(
  binding: ResolvedReferentBinding | null | undefined,
): ReadSubject | null {
  if (!binding || binding.entity_type !== "company") return null;
  const linkedin = canonicalLinkedinCompanyUrl(binding.identity);
  const domain = binding.identity.canonicalDomain;
  // THE SAME DERIVATION THE WRITERS USE: `canonicalSubjectKey(domain ?? li)`.
  // Both are offered because which one a given event was written under depends
  // on what the company had been resolved to at the time, and a read that
  // guessed one would report a real history as an empty one.
  const subject_keys = [...new Set(
    [domain, linkedin]
      .map((v) => canonicalSubjectKey(v))
      .filter((k): k is string => !!k),
  )];
  return {
    entity_key: binding.entity_key,
    label: binding.label,
    domain,
    linkedin_url: linkedin,
    subject_keys,
  };
}

const DEFAULT_LIMIT = 10;

/**
 * The most rows any single read returns.
 *
 * Named because the renderer needs it too: an answer that has hit the ceiling
 * must not offer to show more, and an answer that has not must offer honestly.
 */
export const MAX_READ_ROWS = 50;

/**
 * What would this request read?
 *
 * Pure and total: an entity with no read surface yields `target: null` and a
 * reason, never a nearest-match.
 */
export function planRead(
  request: RequestV1,
  /**
   * The bindings the RESOLVER produced, if any.
   *
   * Supplied, a company binding scopes the read to that company. Omitted — the
   * ordinary case, and every caller that predates this — the plan is exactly
   * what it was: workspace-wide.
   */
  bindings: readonly ResolvedReferentBinding[] = [],
): ReadPlan {
  const part: RequestPart | undefined =
    request.parts.find((p) => p.objective === "read") ?? request.parts[0];
  const base = {
    version: READ_SURFACE_VERSION, limit: DEFAULT_LIMIT,
    since_days: null as number | null, unsupported: null as string | null,
    subject: null as ReadSubject | null,
    subjects: [] as ReadSubject[],
    explicit_limit: false,
  };
  if (!part) return { ...base, target: null, unsupported: "no_part" };

  // ── A RESOLVED REFERENT SCOPES THE READ ─────────────────────────────────
  //
  // "What about the second company?" resolved to one real company, and
  // answering it with a workspace-wide count is answering a different question
  // — the failure this whole migration exists to end. The scope is taken from
  // the BINDING for this part, so nothing the model returned can widen or
  // redirect it.
  //
  // This changes what is READ, never what may be spent. There is still no
  // provider on this path to reach.
  //
  // EVERY binding for this part, not the first one. `bindings.find(...)` read
  // exactly one company, so a set reference that resolved to five would have
  // silently answered about whichever happened to be first — the same class of
  // error as answering a scoped question with a workspace-wide count, and
  // harder to notice because the answer looks right.
  const subjects = bindings
    .filter((b) => b.part_id === part.id && b.entity_type === "company")
    .map((b) => readSubjectFor(b))
    .filter((x): x is ReadSubject => x !== null);
  // `subject` means ONE company and keeps meaning that. Derived here so the
  // two fields cannot drift.
  const subject = subjects.length === 1 ? subjects[0] : null;
  const scoped = subjects.length > 0;

  // A stated recency is the only filter a read honours today. Everything else
  // the request carries is reported by the caller rather than silently ignored.
  const recency = (part.requirements ?? [])
    .map((r) => r.recency_days).find((d) => typeof d === "number" && d > 0) ?? null;

  // ── A STATED NUMBER, THEN "ALL", THEN THE DEFAULT PAGE ──────────────────
  //
  // `completeness: "all"` is the user asking for the whole list, and the read
  // now honours it up to the same 50-row ceiling a stated count is capped at.
  // Before this, "show me the full list" was indistinguishable from the
  // question that preceded it and returned the identical page — the surface
  // offered more and then had no way to give it.
  const askedFor = (part.output.count && part.output.count > 0)
    || part.output.completeness === "all";
  const limit = part.output.count && part.output.count > 0
    ? Math.min(part.output.count, MAX_READ_ROWS)
    : part.output.completeness === "all"
    ? MAX_READ_ROWS
    : DEFAULT_LIMIT;
  base.explicit_limit = askedFor;

  // ── A READ THAT ASKS FOR PROSE IS A BRIEF ────────────────────────────────
  //
  // WHAT THIS REPLACES: a regex gate that ran BEFORE Chat Brain and matched an
  // anchored list of nine exact phrasings — "brief me", "plan my day", "what
  // needs my attention". Anything outside the list was not a brief however
  // plainly it asked for one, and the gate decided meaning before the semantic
  // layer was consulted at all.
  //
  // `output.shape` already carries this distinction and the model already sets
  // it: `records` asks for a list of entities, `answer` asks for prose. A read
  // wanting prose about the workspace IS the brief, and that is derived from
  // the request rather than matched against it.
  //
  // A SCOPED read is excluded deliberately — once a referent has fixed one
  // company, "how are they looking?" is a question about that company, not a
  // workspace summary.
  //
  // AND THE ENTITY MUST BE THE WORKSPACE ITSELF. Prose alone was too wide:
  // "what is my current ICP" is a read wanting prose, and it was answered with
  // an operational brief about eight failed Scout tasks — byte-identical to the
  // one "how are things looking" got. `conversation` is the entity that means
  // the session and the workspace as a whole; every other entity is a question
  // about a specific thing, and the router sends those to the grounded
  // conversational surface instead.
  if (part.output.shape === "answer" && !scoped
      && part.subject.entity === "conversation") {
    return { ...base, target: "brief", limit, since_days: recency };
  }

  // ONE COMPANY IS A DETAIL VIEW; SEVERAL ARE A LIST. Both are scoped, and the
  // difference is not cosmetic: a detail view reads one company's evidence,
  // and a scoped list reads the members the user pointed at.
  switch (part.subject.entity) {
    case "signal":
      // A scoped signal question is still about those companies' evidence.
      if (subject) {
        return { ...base, target: "company_detail", limit, since_days: recency,
          subject, subjects };
      }
      return scoped
        ? { ...base, target: "companies", limit, since_days: recency, subjects }
        : { ...base, target: "signals", limit, since_days: recency };
    case "company":
    case "person":
      if (subject) {
        return { ...base, target: "company_detail", limit, since_days: recency,
          subject, subjects };
      }
      return { ...base, target: "companies", limit, since_days: recency, subjects };
    case "conversation":
      return { ...base, target: "runs", limit, since_days: recency };
    case "approval":
      return { ...base, target: "approvals", limit, since_days: recency };
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
  /**
   * WHAT THIS ANSWER COULD NOT ESTABLISH.
   *
   * Declared by the query that noticed it, not inferred later from the user's
   * wording. "Which of those look strongest?" and "list my leads" hit the same
   * rows and the same absence of scores; only one of them sounds like a ranking
   * request, and both deserve to be told that nothing is ranked.
   *
   * Detecting superlatives in the sentence would be a keyword rule, and would
   * still be silent for the phrasings it did not anticipate.
   */
  gaps: DeclaredGap[];
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
  // THE BRIEF IS NOT A QUERY. `daily-brief` already assembles it from approvals,
  // signals and runs; duplicating that here would be a second answer to the
  // same question, free to drift from the one the dashboard shows.
  if (plan.target === "brief") return null;
  const sinceIso = plan.since_days
    ? new Date(Date.now() - plan.since_days * 86_400_000).toISOString() : null;

  try {
    // ── ONE COMPANY, FROM HELD EVIDENCE ONLY ────────────────────────────
    //
    // Two queries, both filtered to this company by a STRONG identifier: the
    // evidence stored about it, and whether it is being watched. No provider
    // is reachable from here — this module imports none — so a scoped read is
    // zero-spend for exactly the reason a workspace-wide one is.
    if (plan.target === "company_detail") {
      const subj = plan.subject;
      if (!subj) {
        return { target: "company_detail", counts: {}, items: [], empty: true, gaps: [] };
      }

      // EVIDENCE. Matched on the subject keys the writers actually use; an
      // empty key list means this company has no strong identifier we could
      // have written under, so it correctly holds nothing rather than
      // matching everything.
      let events: Array<Record<string, unknown>> = [];
      if (subj.subject_keys.length > 0) {
        let q = db.from("signal_events")
          .select("signal_type, subject_key, occurred_at, confidence, freshness, origin, source_url")
          .eq("workspace_id", workspaceId)
          .in("subject_key", subj.subject_keys)
          .order("occurred_at", { ascending: false })
          .limit(plan.limit);
        if (sinceIso) q = q.gte("occurred_at", sinceIso);
        const { data } = await q;
        events = (data ?? []) as Array<Record<string, unknown>>;
      }

      // WATCH STATUS. `identifier` holds a domain or a LinkedIn company URL,
      // so both forms are offered rather than guessing which one was stored.
      const identifiers = [subj.domain, subj.linkedin_url]
        .filter((v): v is string => !!v);
      let watched: Array<Record<string, unknown>> = [];
      if (identifiers.length > 0) {
        const { data } = await db.from("monitoring_subjects")
          .select("label, identifier, signals, enabled, last_run_at")
          .eq("workspace_id", workspaceId)
          .in("identifier", identifiers)
          .limit(5);
        watched = (data ?? []) as Array<Record<string, unknown>>;
      }

      const byType: Record<string, number> = {};
      for (const r of events) {
        const t = String(r.signal_type ?? "unknown");
        byType[t] = (byType[t] ?? 0) + 1;
      }
      return {
        target: "company_detail",
        counts: { total: events.length, watched: watched.length, ...byType },
        items: [...events.map((e) => ({ kind: "signal", ...e })),
                ...watched.map((w) => ({ kind: "watched", ...w }))],
        empty: events.length === 0 && watched.length === 0,
        // Same absence as the workspace-wide signal read: held evidence, no
        // relevance score against the ICP.
        gaps: events.length > 0
          ? [{ code: "signals_unscored",
               detail: "this company's signals aren't scored against your ICP" }]
          : [],
      };
    }

    if (plan.target === "signals") {
      let q = db.from("signal_events")
        .select("signal_type, subject_key, occurred_at, confidence, freshness, origin, source_url",
          { count: "exact" })
        .eq("workspace_id", workspaceId)
        .order("occurred_at", { ascending: false })
        .limit(plan.limit);
      if (sinceIso) q = q.gte("occurred_at", sinceIso);
      const { data, count: signalCount } = await q;
      const items = (data ?? []) as Array<Record<string, unknown>>;
      const byType: Record<string, number> = {};
      for (const r of items) {
        const t = String(r.signal_type ?? "unknown");
        byType[t] = (byType[t] ?? 0) + 1;
      }
      // THE TOTAL IS COUNTED; the per-type breakdown is of the PAGE, and is
      // reported as such by the renderer rather than implying a full census.
      return {
        target: "signals",
        counts: {
          total: typeof signalCount === "number" ? signalCount : items.length,
          shown: items.length,
          ...byType,
        },
        items, empty: items.length === 0,
        // A SIGNAL LIST IS NOT A RANKING. There is no relevance score against
        // the workspace's ICP, and `occurred_at` is null on every row here, so
        // even "most recent" is not something this answer can claim.
        gaps: items.length > 0
          ? [{
            code: "signals_unscored",
            detail: "these aren't scored against your ICP, so I can't say which is strongest",
          }]
          : [],
      };
    }

    if (plan.target === "companies") {
      // BOTH HALVES — see the header. "What companies do I have" means the
      // leads held and the subjects watched, and the entity does not separate
      // them.
      // ── AN EXACT COUNT, NOT THE SIZE OF THE PAGE ──────────────────────
      //
      // This reported `l.length` — the length of the rows the limit returned —
      // as the number of leads the workspace holds. Live, that produced "10
      // leads saved." against a table holding 32. The query was right for a
      // preview; the renderer treated a truncated page as a census, and stated
      // a number nothing had counted.
      //
      // `count: "exact"` asks Postgres. The page is still bounded, so the list
      // stays a preview and only the TOTAL is claimed.
      // ── THE LEADS ARE NAMED, SO A FOLLOW-UP CAN POINT AT THEM ─────────
      //
      // This selected ids and scores and no company name, so the answer could
      // only ever be a count — and "Which of those look strongest?" had nothing
      // to resolve against, because a referent set is built from what was
      // DISPLAYED and nothing was.
      //
      // The embed carries the identity `resolveCompanyIdentity` needs: name,
      // domain and LinkedIn URL. Naming them makes the answer better and makes
      // the next turn answerable.
      // ── SCOPED TO WHAT THE USER POINTED AT, WHEN THEY POINTED ────────
      //
      // "Which of those look strongest?" is a question about the five
      // companies that were just listed, not about all 32. The scope comes
      // from the BINDINGS, so it is exactly the set that was displayed and
      // nothing the model could widen.
      //
      // Filtering happens in memory rather than in the query on purpose: the
      // rows are matched on `accounts.domain` and `accounts.linkedin_url`
      // through an embed, which PostgREST cannot filter with an `or` across
      // two embedded columns without changing the join semantics. The page is
      // bounded either way.
      const scopeKeys = new Set(
        plan.subjects.flatMap((sub) => [
          sub.domain ? canonicalSubjectKey(sub.domain) : null,
          sub.linkedin_url ? canonicalSubjectKey(sub.linkedin_url) : null,
        ]).filter((k): k is string => !!k));
      const scoped = scopeKeys.size > 0;

      let lq = db.from("lead_candidates")
        .select(
          "id, status, fit_score, priority, reason, created_at, " +
          "accounts(name, domain, linkedin_url)",
          { count: "exact" })
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        // A SCOPED READ MUST SEE FAR ENOUGH BACK TO FIND ITS MEMBERS. The
        // companies pointed at are not necessarily the newest rows, so the
        // page is widened before the in-memory filter narrows it.
        .limit(scoped ? 200 : plan.limit);
      if (sinceIso) lq = lq.gte("created_at", sinceIso);
      const { data: leads, count: leadCount } = await lq;
      const { data: watched, count: watchedCount } = await db
        .from("monitoring_subjects")
        .select("label, identifier, signals, enabled, last_run_at", { count: "exact" })
        .eq("workspace_id", workspaceId).eq("enabled", true).limit(plan.limit);
      let l = (leads ?? []) as Array<Record<string, unknown>>;
      let w = (watched ?? []) as Array<Record<string, unknown>>;
      if (scoped) {
        const keyOf = (row: Record<string, unknown>) => {
          const a = (row.accounts ?? {}) as Record<string, unknown>;
          return [a.domain, a.linkedin_url]
            .map((v) => (typeof v === "string" ? canonicalSubjectKey(v) : null))
            .filter((k): k is string => !!k);
        };
        l = l.filter((row) => keyOf(row).some((k) => scopeKeys.has(k)));
        w = w.filter((row) => {
          const id = row.identifier;
          const k = typeof id === "string" ? canonicalSubjectKey(id) : null;
          return !!k && scopeKeys.has(k);
        });
      }
      return {
        target: "companies",
        // THE TOTAL WHERE POSTGRES GAVE ONE, the page length only as a
        // fallback — a null count means the driver did not return one, and
        // under-reporting is better than inventing a bigger number.
        //
        // A SCOPED READ COUNTS ITS OWN SET. Reporting the workspace total
        // beside five companies the user pointed at would answer "how many
        // leads do I have" to someone who asked about those five.
        counts: {
          leads: scoped
            ? l.length
            : typeof leadCount === "number" ? leadCount : l.length,
          watched: scoped
            ? w.length
            : typeof watchedCount === "number" ? watchedCount : w.length,
          shown: l.length,
          ...(scoped ? { scoped: plan.subjects.length } : {}),
        },
        // NOTHING IS SCORED, SO NOTHING CAN BE RANKED. Every lead in this
        // workspace carries `fit_score: null`; the column exists and no scorer
        // populates it. Saying so here is what stops a superlative being
        // answered with whatever the sort happened to return.
        gaps: l.length > 0 && l.every((x) => x.fit_score == null)
          ? [{
            code: "leads_unscored",
            detail: "none of these leads carry a fit score yet, so they can't be ranked reliably",
          }]
          : [],
        items: [...l.map((x) => ({ kind: "lead", ...x })),
                ...w.map((x) => ({ kind: "watched", ...x }))],
        empty: l.length === 0 && w.length === 0,
      };
    }

    if (plan.target === "approvals") {
      // ── THE TABLE FIRST, THE OLD SHAPE SECOND ────────────────────────
      //
      // Penn writes to `approvals`. Flows that predate it only ever set
      // `tasks.status = 'awaiting_approval'`, and those rows are still real
      // work waiting on a person — so an empty `approvals` result is not
      // evidence that nothing is pending.
      const { data: rows, error } = await db.from("approvals")
        .select("id, agent_slug, title, summary, description, created_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(plan.limit);
      let items = (!error && rows ? rows : []) as Array<Record<string, unknown>>;
      let source = "approvals";
      if (items.length === 0) {
        source = "tasks";
        const { data: taskRows } = await db.from("tasks")
          .select("id, agent_slug, description, created_at")
          .eq("workspace_id", workspaceId)
          .eq("status", "awaiting_approval")
          .order("created_at", { ascending: false })
          .limit(plan.limit);
        items = (taskRows ?? []) as Array<Record<string, unknown>>;
      }
      return {
        target: "approvals",
        counts: { total: items.length },
        items: items.map((i) => ({ kind: "approval", source, ...i })),
        empty: items.length === 0,
        gaps: [],
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
      empty: items.length === 0, gaps: [] };
  } catch (e) {
    console.warn("[read-surface] query failed", String(e));
    // A QUERY THAT FAILED IS NOT AN EMPTY WORKSPACE. The gap says which, so
    // the renderer does not report a database problem as "you have nothing".
    return {
      target: plan.target, counts: {}, items: [], empty: true,
      gaps: [{ code: "read_failed", detail: "I couldn't reach your saved data just now" }],
    };
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
 * How many this answer lists, given the plan.
 *
 * `READ_DISPLAY_LIMIT` is the SAMPLE size, not a ceiling. A read that asked
 * for everything, or for a specific number, must be allowed to show it — the
 * cap was applied unconditionally, so "show me the full list" produced the
 * same five names as the question before it, under a line offering more.
 */
export function displayLimitFor(
  plan: Pick<ReadPlan, "limit" | "explicit_limit">,
): number {
  return plan.explicit_limit
    ? Math.max(READ_DISPLAY_LIMIT, plan.limit)
    : READ_DISPLAY_LIMIT;
}

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
  /** How many to list. Defaults to the sample size every caller used before. */
  displayLimit: number = READ_DISPLAY_LIMIT,
): Array<{
  display: string; label: string | null; identifier: string | null;
  domain: string | null; linkedin_url: string | null;
}> {
  if (!result || result.target !== "companies") return [];
  const acct = (i: Record<string, unknown>) =>
    (i.accounts ?? {}) as Record<string, unknown>;

  // ORDER IS THE ANSWER'S ORDER. Leads first, then watched, each capped — the
  // same walk the renderer performs, so "the second company" indexes what was
  // actually on screen.
  const leads = result.items
    .filter((i) => i.kind === "lead" && typeof acct(i).name === "string")
    .slice(0, displayLimit)
    .map((i) => {
      const a = acct(i);
      return {
        display: String(a.name),
        label: String(a.name),
        identifier: typeof a.domain === "string" ? a.domain : null,
        domain: typeof a.domain === "string" ? a.domain : null,
        linkedin_url: typeof a.linkedin_url === "string" ? a.linkedin_url : null,
      };
    });

  const watched = result.items
    .filter((i) => i.kind === "watched")
    .slice(0, displayLimit)
    .map((i) => ({
      display: String(i.label ?? i.identifier),
      label: typeof i.label === "string" ? i.label : null,
      identifier: typeof i.identifier === "string" ? i.identifier : null,
      domain: null as string | null,
      linkedin_url: null as string | null,
    }));

  return [...leads, ...watched];
}

/**
 * THE READ'S OWN CAPABILITY VERDICT.
 *
 * ── WHY THE SURFACE DECIDES AND NOT THE CALLER ─────────────────────────────
 *
 * The read already knows more than anyone downstream: whether a target
 * existed, whether the query reached the database, and which gaps its own rows
 * declared. A caller inferring the verdict from the rendered sentence would be
 * reading English to decide whether a capability was satisfied — which is the
 * failure the outcome contract exists to prevent.
 *
 * There is no SATISFIED-with-gaps state on purpose. A read that could not rank
 * what it listed did not fully answer "which look strongest", and the honest
 * report of that is PARTIALLY_SATISFIED with the reason attached.
 */
export function readOutcome(
  plan: ReadPlan, result: ReadResult | null,
  /** Labels from a set reference that carried no strong identifier. */
  unidentified: readonly string[] = [],
): Outcome {
  if (!plan.target) {
    return unsupported(plan.unsupported ?? "no_read_surface");
  }
  const gaps: DeclaredGap[] = [
    ...(result?.gaps ?? []),
    ...(unidentified.length > 0
      ? [{
        code: "referents_unidentified",
        detail: `I couldn't pin down ${unidentified.join(", ")} exactly, so ${
          unidentified.length === 1 ? "it isn't" : "they aren't"} included`,
      }]
      : []),
  ];
  if (gaps.some((g) => g.code === "read_failed")) {
    return failed("read_failed", "provider_failure");
  }
  if (gaps.length > 0) return partiallySatisfied(`read:${plan.target}`, gaps);
  return satisfied(`read:${plan.target}`);
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
/**
 * Append what the answer could not establish.
 *
 * ── WHY THE GAP IS PART OF THE ANSWER, NOT A FOOTNOTE ──────────────────────
 *
 * A list of leads with no scores reads as a ranked list, because lists imply
 * order. The sentence that says otherwise has to travel with the list, every
 * time, or the implication stands.
 *
 * This is the read surface's half of the product rule: never claim a result
 * without a proof path. The rows are proved; the ordering is not; the answer
 * says which is which.
 */
/** What "nothing here" sounds like, per surface. Shared by both empty paths. */
function emptyStateFor(plan: ReadPlan, window: string): string {
  if (plan.target === "signals") {
    return `I don't have any signals recorded${window} yet. Once a workflow or a monitor runs, they'll show up here.`;
  }
  if (plan.target === "companies") {
    return "You don't have any leads saved or companies being watched yet.";
  }
  return `I don't have any runs recorded${window}.`;
}

function withGaps(body: string, result: ReadResult | null): string {
  // OPTIONAL AT RUNTIME EVEN THOUGH IT IS REQUIRED IN THE TYPE. A caller
  // constructing a `ReadResult` from an older shape — or a test — has no gaps
  // field, and the renderer must not throw on the path whose whole job is to
  // answer honestly when something is missing.
  const gaps = result?.gaps ?? [];
  if (gaps.length === 0) return body;
  return `${body}\n\n${gaps.map((g) => g.detail).join(" ")}`;
}

export function renderReadAnswer(plan: ReadPlan, result: ReadResult | null): string {
  if (!plan.target) {
    return "I understood that as a question about what I already know, but I don't have a way to look that up yet.";
  }
  const window = plan.since_days ? ` in the last ${plan.since_days} days` : "";

  // ── THE SCOPED ANSWER NAMES THE COMPANY IT IS ABOUT ─────────────────────
  //
  // Said explicitly, because a scoped answer and a workspace-wide one are
  // otherwise indistinguishable in the chat — and a user who cannot tell which
  // question was answered cannot tell that the wrong one was.
  if (plan.target === "company_detail" && plan.subject) {
    const who = plan.subject.label || plan.subject.domain || "that company";
    if (!result || result.empty) {
      return `I don't have anything recorded about ${who}${window} yet — no signals, and it isn't being watched. I haven't gone looking; say the word and I'll run a check.`;
    }
    const { total = 0, watched = 0, ...byType } = result.counts;
    const kinds = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ");
    const recent = result.items.filter((i) => i.kind === "signal")
      .slice(0, 5)
      .map((r) => `• ${String(r.signal_type ?? "signal").replace(/_/g, " ")}` +
        `${r.occurred_at ? ` — ${String(r.occurred_at).slice(0, 10)}` : ""}`)
      .join("\n");
    const head = total > 0
      ? `${total} signal${total === 1 ? "" : "s"} recorded for ${who}${window}${kinds ? ` (${kinds})` : ""}.`
      : `I have nothing recorded for ${who}${window}.`;
    const watch = watched > 0 ? `\n\nIt's on your watch list.` : "";
    return `${head}${recent ? `\n\n${recent}` : ""}${watch}`;
  }

  // The brief is served by `daily-brief`; reaching the renderer means that call
  // did not succeed. Say so plainly rather than reporting an empty workspace —
  // "you have nothing" and "I could not look" are different answers, and only
  // one of them is true.
  if (plan.target === "brief") {
    return "I couldn't pull your workspace summary just now. Nothing is wrong with your data — the brief itself didn't come back. Try again in a moment, or ask me about your signals, leads or recent runs directly.";
  }

  if (plan.target === "approvals") {
    const total = result?.counts.total ?? 0;
    if (!result || result.empty) {
      return "No drafts are waiting for approval right now. When Penn drafts outreach, it will appear here for you to review.";
    }
    const lines = result.items.slice(0, 10)
      .map((t) => `• ${String(t.agent_slug ?? "agent")}: ${
        String(t.title ?? t.description ?? t.summary ?? t.id)}`)
      .join("\n");
    return `You have ${total} pending approval${total === 1 ? "" : "s"}:\n${lines}\n\nOpen the Workbench to approve or edit each draft.`;
  }

  // ── AN EMPTY RESULT IS NOT AUTOMATICALLY AN EMPTY WORKSPACE ─────────────
  //
  // A query that FAILED also arrives here with `empty: true`, and the canned
  // "I don't have any signals recorded yet" would report a database problem as
  // a fact about the user's data. The gap says which, so it must be declared
  // before the empty-state wording, not after it.
  if ((!result || result.empty) && (result?.gaps?.length ?? 0) > 0) {
    return withGaps(emptyStateFor(plan, window), result);
  }

  if (!result || result.empty) {
    return emptyStateFor(plan, window);
  }

  if (result.target === "signals") {
    // `shown` is bookkeeping, not a signal type. Destructuring it into the
    // breakdown rendered "10 signals (of the 10 I looked at: 10 shown, 6 market
    // problem discussion…)" — a count presented as a kind of evidence.
    const { total, shown: _shown, ...byType } = result.counts;
    const kinds = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ");
    const listed = result.items.slice(0, 5);
    const recent = listed
      .map((r) => `• ${String(r.subject_key ?? "unknown")} — ${String(r.signal_type ?? "signal").replace(/_/g, " ")}`)
      .join("\n");
    // THE BREAKDOWN DESCRIBES THE PAGE, NOT THE TOTAL, and the list is a
    // sample. Saying "(6 market problem discussion, …)" beside a counted total
    // implies a census of all of them, which the query never performed.
    const shown = typeof result.counts.shown === "number" ? result.counts.shown : listed.length;
    const sampled = shown < total;
    const head = `You have ${total} signal${total === 1 ? "" : "s"}${window}`
      + (kinds ? ` (of the ${shown} I looked at: ${kinds})` : "") + ".";
    const lead = sampled ? `\n\nA sample:\n` : `\n\n`;
    return withGaps(`${head}${lead}${recent}`, result);
  }

  if (result.target === "companies") {
    const { leads = 0, watched = 0 } = result.counts;
    // RENDERED FROM THE SAME LIST THAT IS PERSISTED AS REFERENTS. Two walks of
    // `result.items` with the same filter and the same slice would be two
    // orderings that can drift, and "the second company" indexes this one.
    const shown = presentedCompanies(result, displayLimitFor(plan));
    const names = shown.map((e) => `• ${e.display}`).join("\n");

    // ── A SCOPED LIST IS ABOUT THOSE COMPANIES, AND SAYS SO ───────────────
    //
    // "Which of those look strongest?" reaches here with the five companies
    // the previous turn displayed. Reporting the workspace total instead would
    // answer a question about the whole workspace, and the user could not tell
    // which of the two they had been given.
    if (plan.subjects.length > 0) {
      const n = shown.length;
      if (n === 0) {
        return withGaps(
          `I couldn't find those companies among your saved leads — they may have been listed from somewhere else.`,
          result);
      }
      const asked = plan.subjects.length;
      const missing = asked > n
        ? ` (${asked - n} of the ${asked} you pointed at aren't in your saved leads)`
        : "";
      return withGaps(
        `Those ${n === 1 ? "one" : n}${missing}:\n\n${names}`, result);
    }

    const bits: string[] = [];
    if (leads) bits.push(`${leads} lead${leads === 1 ? "" : "s"} saved`);
    if (watched) bits.push(`${watched} compan${watched === 1 ? "y" : "ies"} being watched`);

    // ── SAY WHAT WAS SHOWN. PROMISE NOTHING THAT CANNOT BE DELIVERED ──────
    //
    // This ended with "(showing the most recent — ask for more if you need the
    // full list)". The user said "yes show the full list" and received a
    // byte-identical reply, because nothing downstream could represent the
    // request — the offer was an affordance the surface did not have. The
    // count is now stated plainly, and the offer is made only up to the
    // ceiling a read will actually honour.
    const listed = shown.length;
    const remaining = Math.max(0, leads - listed);
    const trailer = remaining > 0
      ? listed >= MAX_READ_ROWS
        ? `\n\n(showing the ${listed} most recent of ${leads} — ask for a specific set if you need further back)`
        : `\n\n(showing the ${listed} most recent of ${leads} — say "show the full list" for the rest)`
      : "";
    return withGaps(
      `${bits.join(" and ")}${window}.`
      + (names ? `\n\n${names}` : "")
      + (names ? trailer : ""),
      result);
  }

  const total = result.counts.total ?? 0;
  const rows = result.items.slice(0, 5)
    .map((r) => `• ${String(r.status ?? "?")} — ${String(r.created_at ?? "").slice(0, 16).replace("T", " ")}`)
    .join("\n");
  return `${total} run${total === 1 ? "" : "s"}${window}.\n\n${rows}`;
}
