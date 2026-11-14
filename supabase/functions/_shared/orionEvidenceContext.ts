// ORION'S EVIDENCE DIGEST FOR A BUSINESS QUESTION. PURE.
//
// ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
//
// ORION's conversational answer was given the Company Brain profile and three
// counters — nothing about the workspace's actual leads, signals or decisions.
// So "which opportunities best match our ICP?" could only be answered with
// "I'd have to look", on ANY model: the limit was retrieval, not reasoning.
// A stronger model (GPT-6.1 Terra) cannot reason over records it never sees.
//
// This turns the stored-evidence retrieval (evidence/retrieve.ts — membership
// checked, workspace isolated, reads only, $0) into a short list of facts the
// model may cite as [E1]…[En], each with its verification class, its date, its
// age, and a Company Brain exclusion warning where one applies. Nothing here
// fetches or spends; the caller supplies the retrieved items.
//
// Feature-flagged by the caller (AGENTORY_ORION_EVIDENCE_CONTEXT); off by default.

import type { SharedBrainContext } from "./companyBrainContextLoader.ts";
import { matchExclusion } from "./brainMemoryModel.ts";
import { VERIFICATION_LABEL, type EvidenceItem } from "./evidence/model.ts";
import { workspaceFact, type GroundedFact } from "./groundedFacts.ts";
import { retrieveEvidence, type EvidenceDb } from "./evidence/retrieve.ts";
import { brainWarningFact, HIRING_RE, loadWorkspaceFacts, type WorkspaceFacts } from "./orionWorkspaceFacts.ts";

export const ORION_EVIDENCE_CONTEXT_VERSION = "orion-evidence-context-v1" as const;
export const ORION_EVIDENCE_MAX_ITEMS = 8;
/** Upper bound when the question asks for more ("list ten…", "latest 12 signals"). */
export const ORION_EVIDENCE_MAX_ITEMS_ASKED = 12;

const WORD_NUMBERS: Record<string, number> = { three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
/** How many records the question asks to see, capped; null when it does not say. */
export function requestedItemCount(message: string): number | null {
  const m = String(message ?? "").toLowerCase().match(/\b(?:list|show|latest|top|give me|recommend|identify)\s+(?:the\s+)?(?:latest\s+|top\s+|most recent\s+)?(\d{1,2}|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORD_NUMBERS[m[1]];
  return n ? Math.min(n, ORION_EVIDENCE_MAX_ITEMS_ASKED) : null;
}

/** "older than 30 days" → 30. */
function olderThanDays(message: string): number | null {
  const m = String(message ?? "").match(/\bolder than (\d{1,3}) days?\b|\bmore than (\d{1,3}) days? old\b/i);
  return m ? Number(m[1] ?? m[2]) : null;
}
const itemTime = (e: EvidenceItem) => { const t = Date.parse(e.published_at ?? e.retrieved_at); return Number.isFinite(t) ? t : null; };
const isHiring = (e: EvidenceItem) => HIRING_RE.test(e.content);

const DAY = 86_400_000;
const norm = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const host = (u: string | null) => { try { return u ? new URL(u).hostname.replace(/^www\./, "") : null; } catch { return null; } };

/**
 * Which evidence a question should see: items about companies the message
 * NAMES come first (comparisons, "why did we reject X"), then the strongest
 * current items. Company Brain workspace facts are excluded — the profile block
 * already carries them.
 */
export function selectEvidenceForQuestion(items: readonly EvidenceItem[], message: string, max = ORION_EVIDENCE_MAX_ITEMS, now: Date = new Date()): EvidenceItem[] {
  const m = ` ${norm(message)} `;
  max = Math.max(max, requestedItemCount(message) ?? 0);
  let pool = items.filter((e) => e.source_type !== "company_brain" || !!e.subject.name);
  // WHAT THE QUESTION IS ABOUT CHOOSES THE SOURCE. "List the latest ten
  // signals" answered from eight lead records is not an answer about signals.
  const aboutSignals = /\bsignals?\b/.test(m);
  const aboutLeads = /\b(?:leads?|accounts?|atlas)\b/.test(m);
  if (aboutSignals && !aboutLeads) {
    const sig = pool.filter((e) => e.source_type === "lisa_signal");
    if (sig.length) pool = [...sig.sort((a, b) => (itemTime(b) ?? 0) - (itemTime(a) ?? 0)), ...pool.filter((e) => e.source_type !== "lisa_signal")];
  } else if (aboutLeads && !aboutSignals) {
    pool = [...pool.filter((e) => e.source_type === "lead"), ...pool.filter((e) => e.source_type !== "lead")];
  } else {
    // BOTH OR NEITHER: every source is represented, in rank order within each,
    // so ranking (single-source signals above lead inferences) cannot crowd a
    // whole source out of a question that spans them.
    const bySource = new Map<string, EvidenceItem[]>();
    for (const e of pool) bySource.set(e.source_type, [...(bySource.get(e.source_type) ?? []), e]);
    const lanes = [...bySource.values()];
    const mixed: EvidenceItem[] = [];
    for (let k = 0; mixed.length < pool.length; k++) for (const lane of lanes) if (lane[k]) mixed.push(lane[k]);
    pool = mixed;
  }
  if (/\bhir(?:e|es|ing)\b/.test(m)) pool = [...pool.filter(isHiring), ...pool.filter((e) => !isHiring(e))];
  const older = olderThanDays(message);
  if (older != null) {
    const cutoff = now.getTime() - older * DAY;
    const match = pool.filter((e) => { const t = itemTime(e); return t != null && t < cutoff; });
    pool = [...match, ...pool.filter((e) => !match.includes(e))];
  }
  const named = pool.filter((e) => {
    const n = norm(e.subject.name);
    const d = norm(e.subject.domain).split(" ")[0];
    return (n.length > 2 && m.includes(` ${n} `)) || (n.split(" ")[0]?.length > 3 && m.includes(` ${n.split(" ")[0]} `)) ||
      (d.length > 3 && m.includes(d));
  });
  const rest = pool.filter((e) => !named.includes(e));
  return [...named, ...rest].slice(0, max);
}

export function ageLabel(iso: string | null, now: Date): string {
  if (!iso) return "undated";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "undated";
  const days = Math.max(0, Math.floor((now.getTime() - t) / DAY));
  return `${iso.slice(0, 10)}, ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}`;
}

export interface OrionEvidenceDigest {
  facts: GroundedFact[];
  /** Evidence ids in [E#] order, for reply provenance. */
  cited_ids: string[];
  /** Companies the digest named, in order — persisted so "the second one" / "it" resolve. */
  subjects: Array<{ name: string; domain: string | null }>;
  /** Wall-clock time spent retrieving and building the digest (pilot speed criterion). */
  retrieval_ms?: number;
  /** The same evidence as display rows for the chat UI's Evidence panel, [E#] order. */
  items: OrionEvidenceDisplayItem[];
  /** R1.1: authoritative totals and named-account lookup (rendered BEFORE the evidence). */
  workspace?: WorkspaceFacts | null;
}

/** Every fact the prompt gets, in order: totals and named companies first, then [E#] evidence. */
export function digestFacts(d: OrionEvidenceDigest): GroundedFact[] {
  return [...(d.workspace?.facts ?? []), ...d.facts];
}

/** One row of the chat Evidence panel. Display only — never fed back to a model. */
export interface OrionEvidenceDisplayItem {
  ref: string;
  subject: string;
  content: string;
  verification: string;
  verification_label: string;
  date: string | null;
  age_days: number | null;
  source_type: string;
  source_host: string | null;
  source_url: string | null;
  excluded_by: string | null;
}

const HIRING_CURRENT_DAYS = 30;
const SOURCE_KIND: Record<string, string> = {
  lead: "ATLAS lead record", lisa_signal: "LISA signal", web_page: "cached company page", company_brain: "Company Brain memory",
};
/** What kind of claim each verification class is — observed fact, agent inference, or unverified. */
const EVIDENCE_CLASS: Record<string, string> = {
  verified: "observed fact, verified by 2+ independent sources",
  single_source: "observed fact from a single source (not independently verified)",
  inference: "agent inference (ATLAS's judgement, no quotable source)",
  contradicted: "contradicted (sources disagree)",
  stale: "stale (past its freshness window; may no longer be true)",
  unknown: "unverified (verification missing)",
};
function ageInDays(iso: string | null, now: Date): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / DAY)) : null;
}
/** The date a record carries, named for what it is: an event date, an observed date, or a record date. */
function dateLabel(e: EvidenceItem, now: Date): string {
  if (e.source_type === "lisa_signal") {
    return e.published_at
      ? `event date ${ageLabel(e.published_at, now)}; observed ${e.retrieved_at.slice(0, 10)}`
      : `observed ${ageLabel(e.retrieved_at, now)} (event date not recorded)`;
  }
  if (e.source_type === "lead") return `lead record created ${ageLabel(e.retrieved_at, now)}`;
  return ageLabel(e.published_at ?? e.retrieved_at, now);
}

export function buildOrionEvidenceDigest(i: {
  items: readonly EvidenceItem[];
  brain: SharedBrainContext | null;
  sources: Record<string, string>;
  now: Date;
  /** How many records the retrieval returned before selection (for the sample notice). */
  retrieved?: number;
}): OrionEvidenceDigest {
  const facts: GroundedFact[] = [];
  const subjects: OrionEvidenceDigest["subjects"] = [];
  const display: OrionEvidenceDisplayItem[] = [];
  i.items.forEach((e, n) => {
    const who = e.subject.name ?? e.subject.domain ?? "workspace";
    const ex = i.brain ? matchExclusion(i.brain.exclusions, { name: e.subject.name, domain: e.subject.domain, industry: e.content }) : null;
    const src = host(e.source_url) ?? e.provenance.table;
    const ageDays = ageInDays(e.published_at ?? e.retrieved_at, i.now);
    const historical = isHiring(e) && ageDays != null && ageDays > HIRING_CURRENT_DAYS;
    facts.push(workspaceFact(
      `[E${n + 1}] ${who} (${SOURCE_KIND[e.source_type] ?? e.source_type}): ${e.content.slice(0, 200)} — ${EVIDENCE_CLASS[e.verification]}; ` +
        `${dateLabel(e, i.now)}; source ${src}` +
        (historical ? `. HISTORICAL hiring evidence (${ageDays} days old): not proof the role is open today; re-check before treating it as active` : "") +
        (ex ? `. EXCLUDED by the Company Brain (${ex}): do not recommend pursuing it.` : ""),
      `evidence.${e.id}`,
    ));
    const when = e.published_at ?? e.retrieved_at;
    const t = when ? Date.parse(when) : NaN;
    display.push({
      ref: `E${n + 1}`, subject: who, content: e.content.slice(0, 200), verification: e.verification,
      verification_label: VERIFICATION_LABEL[e.verification], date: when ? when.slice(0, 10) : null,
      age_days: Number.isFinite(t) ? Math.max(0, Math.floor((i.now.getTime() - t) / DAY)) : null,
      source_type: e.source_type, source_host: host(e.source_url),
      source_url: e.source_url && /^https?:\/\//.test(e.source_url) ? e.source_url : null, excluded_by: ex,
    });
    if (e.subject.name && !subjects.some((s) => norm(s.name) === norm(e.subject.name))) {
      subjects.push({ name: e.subject.name, domain: e.subject.domain });
    }
  });
  const gaps = Object.entries(i.sources).filter(([, s]) => s === "unavailable").map(([k]) => k);
  const pool = i.retrieved ?? i.items.length;
  facts.push(workspaceFact(
    i.items.length
      ? `Evidence above was read from stored workspace records at ${i.now.toISOString().slice(0, 16)}Z; no live web search was run. ` +
        `The [E#] items are ${i.items.length} records SELECTED for this question from ${pool} retrieved — a sample, not a census: ` +
        "never report their number as a total (use WORKSPACE TOTALS). They are records about OTHER companies (leads, signals), " +
        "not facts about the user's own company — those are in the Company Brain profile. Cite an [E#] only for a claim that record itself supports." +
        (gaps.length ? ` Could not read (retrieval failed, not empty): ${gaps.join(", ")}.` : "")
      : "No stored leads, signals or research matched this question; the workspace may still hold records not retrieved here." +
        (gaps.length ? ` Could not read (retrieval failed, not empty): ${gaps.join(", ")}.` : ""),
    "evidence.meta",
  ));
  return { facts, cited_ids: i.items.map((e) => e.id), subjects, items: display };
}

/** The answer shape ORION uses for a business question (appended to the converse prompt). */
export const ORION_BUSINESS_ANSWER_SHAPE = [
  "ANSWER SHAPE for this business question (as long as the question needs, normally under about 350 words; tables are fine for lists and comparisons):",
  "1. What happened / the answer — lead with it.",
  "2. Why it matters — tie it to the Company Brain (ICP, goals, exclusions).",
  "3. Evidence — cite the facts you used as [E1], [E2]…; say which are single-source, agent inferences, stale, historical or contradicted.",
  "4. Recommended action — the next step and which department does it (ATLAS research, LISA monitoring, LYRA draft);",
  "   say when it needs the user's approval. Never recommend a company marked EXCLUDED.",
  "If the evidence does not answer the question, say exactly what is missing and how to get it. Do not fill gaps.",
  "",
  "COUNTS AND ABSENCES:",
  "- Every count comes from WORKSPACE TOTALS. Never count the [E#] items and call that a total.",
  "- Accounts and lead candidates are different things: say which one a number refers to.",
  "- Keep three answers apart: a count that is 0 ('0 saved contacts'), data that is not recorded ('no fit score is stored on any lead'), and data that could not be read ('could not be read — retrieval failed'). Never turn a failed read into a zero.",
  "- A company listed under COMPANIES NAMED IN THE QUESTION exists in this workspace; report what is and is not stored about it. Never say a named company has 'no record' when it is listed there.",
  "",
  "CITATIONS: cite an [E#] only next to a claim that record itself supports. Give a signal's date as recorded (event date, or observed date when no event date is recorded).",
].join("\n");

/**
 * The answer shape for one question: the business shape plus, when the
 * question has several parts, an instruction to answer each under its own
 * label — so no part is silently dropped.
 */
export function orionAnswerShapeFor(subQuestions: readonly string[]): string {
  if (subQuestions.length < 2) return ORION_BUSINESS_ANSWER_SHAPE;
  return [
    ORION_BUSINESS_ANSWER_SHAPE,
    "",
    `THIS QUESTION HAS ${subQuestions.length} PARTS. Answer every one, in order, each under its own short label; if a part cannot be answered, say so under its label rather than leaving it out:`,
    ...subQuestions.map((q, n) => `  ${n + 1}. ${q}`),
  ].join("\n");
}

/**
 * Load the digest for one business question: membership-checked retrieval
 * (evidence/retrieve.ts — reads only, $0), question-aware selection, rendering.
 * Null when retrieval is refused or fails; the answer then proceeds without it.
 */
export async function loadOrionEvidenceDigest(db: EvidenceDb, i: {
  workspaceId: string; userId: string; message: string; now?: Date; withWorkspaceFacts?: boolean;
}): Promise<OrionEvidenceDigest | null> {
  try {
    const now = i.now ?? new Date();
    const t0 = Date.now();
    const got = await retrieveEvidence(db, { workspaceId: i.workspaceId, userId: i.userId, limit: 50, now });
    // A REFUSED MEMBERSHIP READS NOTHING — not evidence, not totals.
    if (!got.ok) return null;
    // Membership verified by the retrieval above; totals are read for the same workspace only.
    const loaded = i.withWorkspaceFacts === false ? null
      : await loadWorkspaceFacts(db as unknown as Parameters<typeof loadWorkspaceFacts>[0], { workspaceId: i.workspaceId, message: i.message, now });
    const workspace = loaded ? { ...loaded, facts: [...loaded.facts, ...brainWarningFact(got.brain?.profile)] } : null;
    const d = buildOrionEvidenceDigest({
      items: selectEvidenceForQuestion(got.items, i.message, ORION_EVIDENCE_MAX_ITEMS, now), brain: got.brain, sources: got.sources, now,
      retrieved: got.items.length,
    });
    return { ...d, workspace, retrieval_ms: Date.now() - t0 };
  } catch (e) {
    console.warn("[orion-evidence] unavailable", e instanceof Error ? e.message : String(e));
    return null;
  }
}

export const ORION_EVIDENCE_FLAG = "AGENTORY_ORION_EVIDENCE_CONTEXT";
/** Optional pilot scope: when set, only these workspace ids get the evidence context. */
export const ORION_EVIDENCE_WORKSPACES = "AGENTORY_ORION_EVIDENCE_WORKSPACES";

/** Is the evidence context on for this workspace? (flag on, and in scope when a scope is set) */
export function orionEvidenceEnabledFor(workspaceId: string, read: (k: string) => string | undefined = (k) => {
  try { return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k); } catch { return undefined; }
}): boolean {
  if (read(ORION_EVIDENCE_FLAG) !== "true") return false;
  const scope = String(read(ORION_EVIDENCE_WORKSPACES) ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return !scope.length || scope.includes(String(workspaceId).toLowerCase());
}

/**
 * The turn-level entry point pilot-chat calls: only a BUSINESS question
 * (not small talk), only with AGENTORY_ORION_EVIDENCE_CONTEXT=true, and — when
 * AGENTORY_ORION_EVIDENCE_WORKSPACES is set — only for the listed workspaces.
 */
export async function orionEvidenceForTurn(db: EvidenceDb, i: {
  task: string; workspaceId: string; userId: string; message: string; now?: Date; withWorkspaceFacts?: boolean;
}, read: (k: string) => string | undefined = (k) => {
  try { return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k); } catch { return undefined; }
}): Promise<OrionEvidenceDigest | null> {
  if (i.task === "simple_chat" || !orionEvidenceEnabledFor(i.workspaceId, read)) return null;
  return await loadOrionEvidenceDigest(db, i);
}
