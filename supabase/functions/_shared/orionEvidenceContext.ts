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

export const ORION_EVIDENCE_CONTEXT_VERSION = "orion-evidence-context-v1" as const;
export const ORION_EVIDENCE_MAX_ITEMS = 8;

const DAY = 86_400_000;
const norm = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const host = (u: string | null) => { try { return u ? new URL(u).hostname.replace(/^www\./, "") : null; } catch { return null; } };

/**
 * Which evidence a question should see: items about companies the message
 * NAMES come first (comparisons, "why did we reject X"), then the strongest
 * current items. Company Brain workspace facts are excluded — the profile block
 * already carries them.
 */
export function selectEvidenceForQuestion(items: readonly EvidenceItem[], message: string, max = ORION_EVIDENCE_MAX_ITEMS): EvidenceItem[] {
  const m = ` ${norm(message)} `;
  const pool = items.filter((e) => e.source_type !== "company_brain" || !!e.subject.name);
  const named = pool.filter((e) => {
    const n = norm(e.subject.name);
    const d = norm(e.subject.domain).split(" ")[0];
    return (n.length > 2 && m.includes(` ${n} `)) || (n.split(" ")[0]?.length > 3 && m.includes(` ${n.split(" ")[0]} `)) ||
      (d.length > 3 && m.includes(d));
  });
  const rest = pool.filter((e) => !named.includes(e));
  return [...named, ...rest].slice(0, max);
}

function ageLabel(iso: string | null, now: Date): string {
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

export function buildOrionEvidenceDigest(i: {
  items: readonly EvidenceItem[];
  brain: SharedBrainContext | null;
  sources: Record<string, string>;
  now: Date;
}): OrionEvidenceDigest {
  const facts: GroundedFact[] = [];
  const subjects: OrionEvidenceDigest["subjects"] = [];
  const display: OrionEvidenceDisplayItem[] = [];
  i.items.forEach((e, n) => {
    const who = e.subject.name ?? e.subject.domain ?? "workspace";
    const ex = i.brain ? matchExclusion(i.brain.exclusions, { name: e.subject.name, domain: e.subject.domain, industry: e.content }) : null;
    const src = host(e.source_url) ?? e.provenance.table;
    facts.push(workspaceFact(
      `[E${n + 1}] ${who}: ${e.content.slice(0, 200)} — ${VERIFICATION_LABEL[e.verification]}; ` +
        `${ageLabel(e.published_at ?? e.retrieved_at, i.now)}; source ${src}` +
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
  facts.push(workspaceFact(
    i.items.length
      ? `Evidence above was read from stored workspace records at ${i.now.toISOString().slice(0, 16)}Z; no live web search was run.` +
        (gaps.length ? ` Could not read: ${gaps.join(", ")}.` : "")
      : "No stored leads, signals or research matched this question; the workspace may still hold records not retrieved here.",
    "evidence.meta",
  ));
  return { facts, cited_ids: i.items.map((e) => e.id), subjects, items: display };
}

/** The answer shape ORION uses for a business question (appended to the converse prompt). */
export const ORION_BUSINESS_ANSWER_SHAPE = [
  "ANSWER SHAPE for this business question (keep it under about 220 words):",
  "1. What happened / the answer — one or two sentences.",
  "2. Why it matters — tie it to the Company Brain (ICP, goals, exclusions).",
  "3. Evidence — cite the facts you used as [E1], [E2]…; say which are single-source, stale or contradicted.",
  "4. Recommended action — the next step and which department does it (ATLAS research, LISA monitoring, LYRA draft);",
  "   say when it needs the user's approval. Never recommend a company marked EXCLUDED.",
  "If the evidence does not answer the question, say exactly what is missing and how to get it. Do not fill gaps.",
].join("\n");

/**
 * Load the digest for one business question: membership-checked retrieval
 * (evidence/retrieve.ts — reads only, $0), question-aware selection, rendering.
 * Null when retrieval is refused or fails; the answer then proceeds without it.
 */
export async function loadOrionEvidenceDigest(db: EvidenceDb, i: {
  workspaceId: string; userId: string; message: string; now?: Date;
}): Promise<OrionEvidenceDigest | null> {
  try {
    const now = i.now ?? new Date();
    const t0 = Date.now();
    const got = await retrieveEvidence(db, { workspaceId: i.workspaceId, userId: i.userId, limit: 40, now });
    if (!got.ok) return null;
    const d = buildOrionEvidenceDigest({ items: selectEvidenceForQuestion(got.items, i.message), brain: got.brain, sources: got.sources, now });
    return { ...d, retrieval_ms: Date.now() - t0 };
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
  task: string; workspaceId: string; userId: string; message: string; now?: Date;
}, read: (k: string) => string | undefined = (k) => {
  try { return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k); } catch { return undefined; }
}): Promise<OrionEvidenceDigest | null> {
  if (i.task === "simple_chat" || !orionEvidenceEnabledFor(i.workspaceId, read)) return null;
  return await loadOrionEvidenceDigest(db, i);
}
