// ORION — EXECUTIVE INTELLIGENCE, V1: THE SYNTHESIS.
//
// Pure (no Deno, no DB, no network): takes the normalized context that
// `executiveBriefContext.ts` assembles from the workspace's own rows and turns
// it into one structured brief — what happened, what matters most, why, what
// to do, and the records that say so.
//
// ── THE RULES THIS FILE KEEPS ───────────────────────────────────────────────
//
//   1. EVERY PRIORITY AND EVERY RECOMMENDATION CARRIES EVIDENCE. Evidence is a
//      reference to a row that was actually read (table + id + route). A
//      candidate with no evidence is dropped, never shown "on trust".
//   2. RANKING IS DETERMINISTIC. The model never decides what matters; it may
//      only re-word the summary and the "why" lines (`applyModelWording`), and
//      that wording is rejected if it names a priority that does not exist or
//      quotes a number the facts do not contain.
//   3. NO DUPLICATES. One subject (an account, an approval, a draft) appears in
//      at most one priority; recommendations are keyed by subject.
//   4. MISSING DATA IS SAID, NOT FILLED. Empty sources produce empty sections
//      and an explicit confidence note.

import type { SharedBrainContext } from "./companyBrainContextLoader.ts";

export const EXECUTIVE_BRIEF_VERSION = "orion-brief-v1" as const;
export const EXECUTIVE_BRIEF_OUTPUT_TYPE = "executive_brief" as const;
export const MAX_PRIORITIES = 3;
const MAX_SECTION_ITEMS = 5;
const MAX_RECOMMENDATIONS = 5;

export type EvidenceKind = "signal" | "lead" | "content" | "approval" | "plan" | "task" | "brain";

/** A pointer to a row the brief was built from. Never invented. */
export interface EvidenceRef {
  kind: EvidenceKind;
  /** The source table, so a reader can verify it. */
  table: string;
  /** Primary key of the source row. */
  id: string;
  title: string;
  occurred_at: string | null;
  /** In-app route that shows the underlying record (or its list). */
  route: string;
}

/** One normalized source row, scored. */
export interface ExecItem extends EvidenceRef {
  detail: string | null;
  account_id: string | null;
  account_name: string | null;
  /** 0–100, deterministic. */
  score: number;
  /** Plain-language reasons the score is what it is. */
  reasons: string[];
  /** Source-native confidence where the row has one (signals). */
  source_confidence: "high" | "medium" | "low" | null;
  /** Category used for grouping (signal type, lead priority, draft status…). */
  category: string | null;
}

export interface BrainSnapshot {
  /** Onboarding complete and enough fields to personalize. */
  usable: boolean;
  company: string | null;
  description: string | null;
  icp: string | null;
  industries: string[];
  competitors: string[];
  goal: string | null;
  missing: string[];
  /** Every stated goal (profile + approved memory). Additive; absent on old callers. */
  goals?: string[];
  /** Domains of tracked competitors, for matching rows that carry no name. */
  competitor_domains?: string[];
  /** Whether Company Brain memory was read ("unavailable" where the tables are absent). */
  memory_status?: "used" | "unavailable";
}

/** One way the Company Brain's memory changed this brief — so ORION can say how. */
export interface MemoryInfluence {
  /** Plain-language fact: "Exclusion: industry Defense", "Goal: …", "You rejected this lead". */
  fact: string;
  /** Where it came from: "your preference", "decision", "Company Brain goals". */
  source: string;
  /** What it did: "ranked lower", "ranked higher", "left out of the brief". */
  effect: string;
  /** table:id of the rows it touched (at most 10). */
  items: string[];
}

export interface ExecutiveContext {
  workspace_id: string;
  generated_at: string;
  window_days: number;
  brain: BrainSnapshot;
  signals: ExecItem[];
  leads: ExecItem[];
  content: ExecItem[];
  approvals: ExecItem[];
  plans_in_flight: ExecItem[];
  failed_work: ExecItem[];
  /** Sources that could not be read; the brief says so instead of pretending they were empty. */
  unavailable_sources: string[];
  /** How memory changed ranking/selection. Additive. */
  memory_influences?: MemoryInfluence[];
  /** The loaded shared context, for the model-wording block. Never serialized into the brief. */
  shared_brain?: SharedBrainContext | null;
}

export type Confidence = "high" | "medium" | "low";

export type PriorityCategory = "decision" | "opportunity" | "market" | "risk" | "content" | "setup";

export interface Priority {
  id: string;
  rank: number;
  category: PriorityCategory;
  title: string;
  why: string;
  action: { label: string; route: string };
  confidence: Confidence;
  evidence: EvidenceRef[];
}

export interface BriefEntry {
  id: string;
  title: string;
  detail: string | null;
  confidence: Confidence;
  evidence: EvidenceRef[];
}

export interface Recommendation {
  id: string;
  action: string;
  why: string;
  route: string;
  confidence: Confidence;
  evidence: EvidenceRef[];
}

export interface ExecutiveBrief {
  version: typeof EXECUTIVE_BRIEF_VERSION;
  agent: "orion";
  workspace_id: string;
  generated_at: string;
  window_days: number;
  summary: string;
  priorities: Priority[];
  opportunities: BriefEntry[];
  market_changes: BriefEntry[];
  pending_decisions: BriefEntry[];
  recommended_actions: Recommendation[];
  sources: EvidenceRef[];
  counts: { signals: number; leads: number; content: number; approvals: number; plans_in_flight: number; failed_work: number };
  confidence: { overall: Confidence; notes: string[] };
  brain: {
    used: boolean; company: string | null; missing: string[];
    /** Goals ORION ranked against. Additive. */
    goals?: string[];
    /** How the Company Brain's memory shaped this brief. Additive. */
    influences?: MemoryInfluence[];
  };
  synthesis: { mode: "deterministic" | "model"; model: string | null; rejected_reason: string | null };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function ref(i: EvidenceRef): EvidenceRef {
  return { kind: i.kind, table: i.table, id: i.id, title: i.title, occurred_at: i.occurred_at, route: i.route };
}

function refKey(r: Pick<EvidenceRef, "table" | "id">): string {
  return `${r.table}:${r.id}`;
}

/** Reasons → one sentence: capitalized, ending in a full stop. */
function sentence(parts: string[], fallback: string): string {
  const t = (parts.join("; ") || fallback).trim();
  const c = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(c) ? c : `${c}.`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function byScore(a: ExecItem, b: ExecItem): number {
  if (b.score !== a.score) return b.score - a.score;
  // Newer first, then id, so equal scores still order the same way every run.
  const ta = a.occurred_at ?? "", tb = b.occurred_at ?? "";
  if (ta !== tb) return tb < ta ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The subject a row is "about": its account when it has one, else the row itself. */
function subjectKey(i: ExecItem): string {
  return i.account_id ? `account:${i.account_id}` : refKey(i);
}

/** Keep the best-scoring row per subject. Exported for tests. */
export function dedupeBySubject(items: ExecItem[]): ExecItem[] {
  const best = new Map<string, ExecItem>();
  for (const i of [...items].sort(byScore)) {
    const k = subjectKey(i);
    if (!best.has(k)) best.set(k, i);
  }
  return [...best.values()].sort(byScore);
}

function itemConfidence(i: ExecItem, corroborating = 0): Confidence {
  if (i.source_confidence === "high" || corroborating >= 1) return "high";
  if (i.source_confidence === "low") return "low";
  return "medium";
}

function label(i: ExecItem): string {
  return i.account_name ?? i.title;
}

// ── synthesis ───────────────────────────────────────────────────────────────

interface Candidate {
  category: PriorityCategory;
  score: number;
  title: string;
  why: string;
  action: { label: string; route: string };
  confidence: Confidence;
  evidence: EvidenceRef[];
  /** Subjects this candidate is about; a later candidate sharing one is dropped. */
  subjects: string[];
}

function brainRef(ctx: ExecutiveContext): EvidenceRef {
  return {
    kind: "brain", table: "company_brain", id: ctx.workspace_id,
    title: ctx.brain.company ? `${ctx.brain.company} Company Brain` : "Company Brain",
    occurred_at: null, route: "/company-brain",
  };
}

function icpPhrase(ctx: ExecutiveContext): string {
  if (!ctx.brain.usable) return "";
  if (ctx.brain.industries.length) return ` It fits your focus on ${ctx.brain.industries.slice(0, 2).join(" and ")}.`;
  if (ctx.brain.icp) return " It matches the ideal customer in your Company Brain.";
  return "";
}

function candidates(ctx: ExecutiveContext, signals: ExecItem[], leads: ExecItem[]): Candidate[] {
  const out: Candidate[] = [];

  // DECISIONS: work that is paused until the user chooses.
  if (ctx.approvals.length) {
    const ap = [...ctx.approvals].sort(byScore);
    const oldest = ap.reduce((m, a) => Math.max(m, a.score), 0);
    out.push({
      category: "decision",
      // Paused work outranks market news (signals cap near 80 before Brain
      // matches); only a very strong lead can come first.
      score: 82 + Math.min(10, Math.round(oldest / 10)),
      title: ap.length === 1 ? `Decide on “${ap[0].title}”` : `Decide on ${plural(ap.length, "pending approval")}`,
      why: `Work is paused until you decide. ${ap.length === 1 ? "This item" : `The oldest of ${ap.length} items`} has been waiting${ap[0].occurred_at ? ` since ${ap[0].occurred_at.slice(0, 10)}` : ""}.`,
      action: { label: "Review approvals", route: "/awaiting-you" },
      confidence: "high",
      evidence: ap.slice(0, MAX_SECTION_ITEMS).map(ref),
      subjects: ap.map((a) => refKey(a)),
    });
  }

  // OPPORTUNITY: the best lead, corroborated by any signal on the same account.
  const topLead = leads[0];
  if (topLead) {
    const backing = signals.filter((s) => s.account_id && s.account_id === topLead.account_id);
    out.push({
      category: "opportunity",
      score: topLead.score + (backing.length ? 8 : 0),
      title: `Act on ${label(topLead)}`,
      why: [
        sentence(topLead.reasons, "It is your highest-scoring lead."),
        backing.length ? ` A recent signal backs it: ${backing[0].title}.` : "",
        icpPhrase(ctx),
      ].join("").trim(),
      action: { label: topLead.detail?.startsWith("Next:") ? topLead.detail.slice(5).trim() : "Open lead", route: topLead.route },
      confidence: itemConfidence(topLead, backing.length),
      evidence: [ref(topLead), ...backing.slice(0, 2).map(ref)],
      subjects: [subjectKey(topLead)],
    });
  }

  // MARKET: the strongest change not already covered by the opportunity.
  for (const s of signals.slice(0, 3)) {
    out.push({
      category: "market",
      score: s.score,
      title: `${label(s)}: ${s.title}`,
      why: `${sentence(s.reasons, "A recent market change.")}${icpPhrase(ctx)}`.trim(),
      action: { label: "Open signals", route: s.route },
      confidence: itemConfidence(s),
      evidence: [ref(s)],
      subjects: [subjectKey(s)],
    });
  }

  // RISK: runs that failed and are not producing what was asked.
  if (ctx.failed_work.length) {
    const f = [...ctx.failed_work].sort(byScore);
    out.push({
      category: "risk",
      score: 62,
      title: f.length === 1 ? `Fix failed run: ${f[0].title}` : `Fix ${plural(f.length, "failed run")}`,
      why: f[0].detail ? `Latest failure: ${f[0].detail}` : "Requested work stopped before it finished.",
      action: { label: "Open run", route: f[0].route },
      confidence: "high",
      evidence: f.slice(0, MAX_SECTION_ITEMS).map(ref),
      subjects: f.map((x) => refKey(x)),
    });
  }

  // CONTENT: drafts waiting for review.
  if (ctx.content.length) {
    const c = [...ctx.content].sort(byScore);
    out.push({
      category: "content",
      score: 45 + Math.min(10, c.length * 2),
      title: c.length === 1 ? `Review draft “${c[0].title}”` : `Review ${plural(c.length, "content draft")}`,
      why: "Drafts are written and waiting; nothing publishes without you.",
      action: { label: "Open content", route: c[0].route },
      confidence: "high",
      evidence: c.slice(0, MAX_SECTION_ITEMS).map(ref),
      subjects: c.map((x) => refKey(x)),
    });
  }

  // SETUP: an unusable Brain makes every other answer weaker.
  if (!ctx.brain.usable) {
    out.push({
      category: "setup",
      score: 64,
      title: "Finish your Company Brain",
      why: ctx.brain.missing.length
        ? `Orion cannot judge relevance without: ${ctx.brain.missing.slice(0, 3).join(", ")}.`
        : "Onboarding is not complete, so priorities are not tailored to your business.",
      action: { label: "Open Company Brain", route: "/company-brain" },
      confidence: "high",
      evidence: [brainRef(ctx)],
      subjects: ["brain"],
    });
  }

  return out.filter((c) => c.evidence.length > 0);
}

function pickPriorities(cands: Candidate[]): Priority[] {
  const used = new Set<string>();
  const picked: Priority[] = [];
  const usedCategories = new Map<PriorityCategory, number>();
  for (const c of [...cands].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))) {
    if (picked.length >= MAX_PRIORITIES) break;
    if (c.subjects.some((s) => used.has(s))) continue;
    // At most two market items, so the top three are not all one kind of news.
    if (c.category === "market" && (usedCategories.get("market") ?? 0) >= 2) continue;
    c.subjects.forEach((s) => used.add(s));
    usedCategories.set(c.category, (usedCategories.get(c.category) ?? 0) + 1);
    picked.push({
      id: `P${picked.length + 1}`, rank: picked.length + 1, category: c.category,
      title: c.title, why: c.why, action: c.action, confidence: c.confidence, evidence: c.evidence,
    });
  }
  return picked;
}

function entry(i: ExecItem, extra: EvidenceRef[] = []): BriefEntry {
  return {
    id: refKey(i),
    title: i.account_name && !i.title.includes(i.account_name) ? `${i.account_name} — ${i.title}` : i.title,
    detail: i.detail ?? (i.reasons.length ? i.reasons.join("; ") : null),
    confidence: itemConfidence(i, extra.length),
    evidence: [ref(i), ...extra],
  };
}

function recommendations(ctx: ExecutiveContext, priorities: Priority[], leads: ExecItem[], signals: ExecItem[]): Recommendation[] {
  const recs: Recommendation[] = [];
  const seen = new Set<string>();
  const add = (r: Recommendation) => {
    const key = `${r.route}|${r.evidence.map(refKey).sort().join(",")}`;
    if (seen.has(key) || !r.evidence.length) return;
    seen.add(key);
    recs.push(r);
  };
  for (const p of priorities) {
    add({ id: `R-${p.id}`, action: p.action.label === "Open lead" || p.action.label === "Open signals" ? `${p.action.label}: ${p.title}` : p.action.label, why: p.why, route: p.action.route, confidence: p.confidence, evidence: p.evidence });
  }
  // Then the next-best leads not already covered by a priority.
  const covered = new Set(priorities.flatMap((p) => p.evidence.map(refKey)));
  for (const l of leads) {
    if (recs.length >= MAX_RECOMMENDATIONS) break;
    if (covered.has(refKey(l))) continue;
    const backing = signals.filter((s) => s.account_id && s.account_id === l.account_id).slice(0, 1);
    add({
      id: `R-${refKey(l)}`, action: `Review ${label(l)}`,
      why: l.reasons.join("; ") || "A qualified lead not yet acted on.",
      route: l.route, confidence: itemConfidence(l, backing.length), evidence: [ref(l), ...backing.map(ref)],
    });
  }
  return recs.slice(0, MAX_RECOMMENDATIONS);
}

function summaryLine(ctx: ExecutiveContext, priorities: Priority[]): string {
  const happened: string[] = [];
  if (ctx.signals.length) happened.push(plural(ctx.signals.length, "market signal"));
  if (ctx.leads.length) happened.push(plural(ctx.leads.length, "qualified lead"));
  if (ctx.content.length) happened.push(plural(ctx.content.length, "draft") + " to review");
  if (ctx.approvals.length) happened.push(plural(ctx.approvals.length, "pending approval"));
  if (ctx.failed_work.length) happened.push(plural(ctx.failed_work.length, "failed run"));
  const window = ctx.window_days === 1 ? "the last day" : `the last ${ctx.window_days} days`;
  if (!happened.length) {
    return ctx.brain.usable
      ? `Nothing new in ${window}. Start a lead search or a signal watch so Orion has something to brief you on.`
      : `Nothing new in ${window}, and your Company Brain is not finished — start there.`;
  }
  const top = priorities[0] ? ` Most important: ${priorities[0].title.replace(/[.]$/, "")}.` : "";
  return `In ${window}: ${happened.join(", ")}.${top}`;
}

function overallConfidence(ctx: ExecutiveContext, total: number): { overall: Confidence; notes: string[] } {
  const notes: string[] = [];
  if (!ctx.brain.usable) notes.push("Company Brain is incomplete, so relevance to your business is estimated, not known.");
  if (ctx.unavailable_sources.length) notes.push(`Could not read: ${ctx.unavailable_sources.join(", ")}. Those sections may be incomplete.`);
  if (total === 0) notes.push("No recent workspace activity to synthesise.");
  const influences = ctx.memory_influences ?? [];
  if (influences.length) {
    const dropped = influences.filter((i) => i.effect === "left out of the brief").reduce((a, i) => a + i.items.length, 0);
    const moved = influences.filter((i) => i.effect !== "left out of the brief").reduce((a, i) => a + i.items.length, 0);
    notes.push(`Company Brain memory shaped this brief: ${dropped ? `${plural(dropped, "item")} you decided against left out` : ""}${dropped && moved ? "; " : ""}${moved ? `${plural(moved, "item")} re-ranked by your goals or exclusions` : ""}.`);
  }
  const lowSignals = ctx.signals.filter((s) => s.source_confidence === "low").length;
  if (lowSignals) notes.push(`${plural(lowSignals, "signal")} rated low confidence by its source.`);
  const overall: Confidence = ctx.unavailable_sources.length || total === 0
    ? "low"
    : !ctx.brain.usable ? "medium" : "high";
  return { overall, notes };
}

/** Build the brief. Deterministic for a given context. */
export function synthesizeExecutiveBrief(ctx: ExecutiveContext): ExecutiveBrief {
  const signals = dedupeBySubject(ctx.signals);
  const leads = dedupeBySubject(ctx.leads);
  const priorities = pickPriorities(candidates(ctx, signals, leads));

  const opportunities = leads.slice(0, MAX_SECTION_ITEMS).map((l) =>
    entry(l, signals.filter((s) => s.account_id && s.account_id === l.account_id).slice(0, 2).map(ref)));
  const market_changes = signals.slice(0, MAX_SECTION_ITEMS).map((s) => entry(s));
  const pending_decisions = [
    ...[...ctx.approvals].sort(byScore).map((a) => entry(a)),
    ...[...ctx.content].sort(byScore).map((c) => entry(c)),
  ].slice(0, MAX_SECTION_ITEMS * 2);

  const recommended_actions = recommendations(ctx, priorities, leads, signals);

  const sourceMap = new Map<string, EvidenceRef>();
  for (const r of [
    ...priorities.flatMap((p) => p.evidence),
    ...opportunities.flatMap((e) => e.evidence),
    ...market_changes.flatMap((e) => e.evidence),
    ...pending_decisions.flatMap((e) => e.evidence),
    ...recommended_actions.flatMap((e) => e.evidence),
  ]) sourceMap.set(refKey(r), r);

  const counts = {
    signals: ctx.signals.length, leads: ctx.leads.length, content: ctx.content.length,
    approvals: ctx.approvals.length, plans_in_flight: ctx.plans_in_flight.length, failed_work: ctx.failed_work.length,
  };
  const total = counts.signals + counts.leads + counts.content + counts.approvals + counts.failed_work;

  return {
    version: EXECUTIVE_BRIEF_VERSION,
    agent: "orion",
    workspace_id: ctx.workspace_id,
    generated_at: ctx.generated_at,
    window_days: ctx.window_days,
    summary: summaryLine(ctx, priorities),
    priorities,
    opportunities,
    market_changes,
    pending_decisions,
    recommended_actions,
    sources: [...sourceMap.values()],
    counts,
    confidence: overallConfidence(ctx, total),
    brain: {
      used: ctx.brain.usable, company: ctx.brain.company, missing: ctx.brain.missing,
      goals: ctx.brain.goals ?? [],
      influences: ctx.memory_influences ?? [],
    },
    synthesis: { mode: "deterministic", model: null, rejected_reason: null },
  };
}

// ── model wording (optional, validated) ─────────────────────────────────────

/** What the model sees: the brief's own facts, nothing else. */
export function modelFacts(brief: ExecutiveBrief, brainBlock: string): string {
  return JSON.stringify({
    company_brain: brainBlock,
    summary: brief.summary,
    priorities: brief.priorities.map((p) => ({
      id: p.id, category: p.category, title: p.title, why: p.why,
      evidence: p.evidence.map((e) => ({ kind: e.kind, title: e.title, occurred_at: e.occurred_at })),
    })),
    counts: brief.counts,
    confidence_notes: brief.confidence.notes,
  });
}

export const MODEL_INSTRUCTIONS =
  "You are Orion, Agentory's Executive Intelligence. Re-word an executive brief for a busy founder. " +
  "Use ONLY the JSON facts given. Do not add companies, numbers, dates, events or recommendations that are not in the facts. " +
  "Do not change which priorities exist or their order. Keep each 'why' to at most two short sentences, and relate it to the " +
  "company brain when the facts allow. Return JSON only, shaped exactly: " +
  '{"summary": string, "priorities": [{"id": string, "why": string}]}';

/** Numbers the model may quote: those already present in the facts. */
function numbersIn(s: string): string[] {
  return s.match(/\d+(?:[.,]\d+)?/g) ?? [];
}

/**
 * Apply the model's wording if, and only if, it is grounded. Returns the brief
 * unchanged (deterministic) with a reason when it is not.
 */
export function applyModelWording(
  brief: ExecutiveBrief,
  modelJson: unknown,
  facts: string,
  model: string,
): ExecutiveBrief {
  const reject = (reason: string): ExecutiveBrief => ({ ...brief, synthesis: { mode: "deterministic", model: null, rejected_reason: reason } });
  if (!modelJson || typeof modelJson !== "object") return reject("not_an_object");
  const m = modelJson as { summary?: unknown; priorities?: unknown };
  if (typeof m.summary !== "string" || !m.summary.trim() || m.summary.length > 600) return reject("bad_summary");
  const allowedNumbers = new Set(numbersIn(facts));
  const ungrounded = (text: string) => numbersIn(text).some((n) => !allowedNumbers.has(n));
  if (ungrounded(m.summary)) return reject("summary_ungrounded_number");

  const whyById = new Map<string, string>();
  if (m.priorities !== undefined) {
    if (!Array.isArray(m.priorities)) return reject("bad_priorities");
    const known = new Set(brief.priorities.map((p) => p.id));
    for (const raw of m.priorities) {
      const p = raw as { id?: unknown; why?: unknown };
      if (typeof p?.id !== "string" || !known.has(p.id)) return reject("unknown_priority_id");
      if (typeof p.why !== "string" || !p.why.trim() || p.why.length > 400) return reject("bad_why");
      if (ungrounded(p.why)) return reject("why_ungrounded_number");
      whyById.set(p.id, p.why.trim());
    }
  }

  return {
    ...brief,
    summary: m.summary.trim(),
    priorities: brief.priorities.map((p) => ({ ...p, why: whyById.get(p.id) ?? p.why })),
    recommended_actions: brief.recommended_actions.map((r) => {
      const pid = r.id.startsWith("R-P") ? r.id.slice(2) : null;
      return pid && whyById.has(pid) ? { ...r, why: whyById.get(pid)! } : r;
    }),
    synthesis: { mode: "model", model, rejected_reason: null },
  };
}

// ── rendering for chat ──────────────────────────────────────────────────────

const CONF_LABEL: Record<Confidence, string> = { high: "high confidence", medium: "medium confidence", low: "low confidence" };

function evidenceLine(e: EvidenceRef[]): string {
  return e.slice(0, 3).map((r) => `[${r.title}](${r.route})`).join(" · ");
}

/** Markdown for the chat thread. The structured brief is the source of truth. */
export function renderExecutiveBriefMarkdown(b: ExecutiveBrief): string {
  const lines: string[] = [];
  lines.push("# Orion · Executive Brief");
  lines.push(`_Generated ${b.generated_at.replace("T", " ").slice(0, 16)} UTC · last ${b.window_days} days · ${CONF_LABEL[b.confidence.overall]}_`);
  lines.push("", "## Summary", b.summary);

  lines.push("", "## Top priorities");
  if (!b.priorities.length) lines.push("Nothing needs you right now.");
  for (const p of b.priorities) {
    lines.push(`${p.rank}. **${p.title}** (${CONF_LABEL[p.confidence]})`);
    lines.push(`   ${p.why}`);
    lines.push(`   → [${p.action.label}](${p.action.route}) · Evidence: ${evidenceLine(p.evidence)}`);
  }

  const section = (title: string, items: BriefEntry[], empty: string) => {
    lines.push("", `## ${title}`);
    if (!items.length) { lines.push(empty); return; }
    for (const e of items) lines.push(`- ${e.title}${e.detail ? ` — ${e.detail}` : ""} ([source](${e.evidence[0].route}))`);
  };
  section("Opportunities", b.opportunities, "No qualified leads in this window.");
  section("Market changes", b.market_changes, "No new market signals in this window.");
  section("Pending decisions", b.pending_decisions, "No approvals or drafts waiting.");

  lines.push("", "## Recommended actions");
  if (!b.recommended_actions.length) lines.push("No action needed.");
  b.recommended_actions.forEach((r, i) => lines.push(`${i + 1}. [${r.action}](${r.route}) — ${r.why}`));

  if (b.confidence.notes.length) {
    lines.push("", "## Confidence");
    for (const n of b.confidence.notes) lines.push(`- ${n}`);
  }
  return lines.join("\n");
}
