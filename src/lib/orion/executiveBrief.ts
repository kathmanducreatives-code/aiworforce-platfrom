// ORION — Executive Intelligence: the browser side of the executive brief.
//
// The brief is built server-side by `daily-brief` and stored in
// `saved_outputs` (type `executive_brief`, structured brief in `raw`). This
// module reads that history (RLS: members read their workspace's rows), asks
// for a new brief, and turns a stored row into something safe to render.
//
// Nothing here trusts the stored JSON's shape: `parseExecutiveBrief` rebuilds
// every field it uses and drops evidence whose route is not an in-app path, so
// a malformed or tampered row renders as less, never as a broken page or an
// off-site link.

import type {
  BriefEntry, Confidence, EvidenceRef, ExecutiveBrief, Priority, Recommendation,
} from '../../../supabase/functions/_shared/executiveBrief.ts';

export type { BriefEntry, Confidence, EvidenceRef, ExecutiveBrief, Priority, Recommendation };

export const EXECUTIVE_BRIEF_TYPE = 'executive_brief';
export const BRIEF_HISTORY_LIMIT = 10;
/** A brief older than this is shown as history, not as today's picture. */
export const CURRENT_BRIEF_MAX_AGE_HOURS = 20;

export interface StoredBrief {
  id: string;
  created_at: string;
  brief: ExecutiveBrief;
}

type Row = Record<string, unknown>;

const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {});
const str = (v: unknown, max = 600): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const conf = (v: unknown): Confidence => (v === 'high' || v === 'low' ? v : 'medium');

const KINDS = new Set(['signal', 'lead', 'content', 'approval', 'plan', 'task', 'brain']);

/** In-app path only: "/x…", never "//host" or a scheme. */
export function safeRoute(v: unknown, fallback = '/dashboard'): string {
  const r = str(v, 300);
  if (!r || !r.startsWith('/') || r.startsWith('//') || r.includes('\\')) return fallback;
  return r;
}

function parseEvidence(v: unknown): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  for (const x of arr(v)) {
    const e = obj(x);
    const id = str(e.id, 120);
    const kind = str(e.kind, 20);
    if (!id || !kind || !KINDS.has(kind)) continue;
    out.push({
      kind: kind as EvidenceRef['kind'],
      table: str(e.table, 60) ?? kind,
      id,
      title: str(e.title, 160) ?? 'Source',
      occurred_at: str(e.occurred_at, 40),
      route: safeRoute(e.route),
    });
  }
  return out;
}

function parseEntries(v: unknown): BriefEntry[] {
  return arr(v).map((x) => {
    const e = obj(x);
    return {
      id: str(e.id, 160) ?? '',
      title: str(e.title, 200) ?? '',
      detail: str(e.detail, 300),
      confidence: conf(e.confidence),
      evidence: parseEvidence(e.evidence),
    };
  }).filter((e) => e.id && e.title && e.evidence.length > 0);
}

/** Rebuild a brief from stored JSON. Returns null when it is not an Orion brief. */
export function parseExecutiveBrief(raw: unknown): ExecutiveBrief | null {
  const b = obj(raw);
  if (b.version !== 'orion-brief-v1') return null;
  const generated = str(b.generated_at, 40);
  if (!generated || Number.isNaN(Date.parse(generated))) return null;

  const priorities: Priority[] = arr(b.priorities).map((x, i) => {
    const p = obj(x);
    const action = obj(p.action);
    return {
      id: str(p.id, 10) ?? `P${i + 1}`,
      rank: i + 1,
      category: (str(p.category, 20) ?? 'decision') as Priority['category'],
      title: str(p.title, 200) ?? '',
      why: str(p.why, 400) ?? '',
      action: { label: str(action.label, 60) ?? 'Open', route: safeRoute(action.route) },
      confidence: conf(p.confidence),
      evidence: parseEvidence(p.evidence),
    };
  }).filter((p) => p.title && p.evidence.length > 0).slice(0, 3);

  const recommended_actions: Recommendation[] = arr(b.recommended_actions).map((x) => {
    const r = obj(x);
    return {
      id: str(r.id, 160) ?? '',
      action: str(r.action, 200) ?? '',
      why: str(r.why, 400) ?? '',
      route: safeRoute(r.route),
      confidence: conf(r.confidence),
      evidence: parseEvidence(r.evidence),
    };
  }).filter((r) => r.id && r.action && r.evidence.length > 0).slice(0, 5);

  const counts = obj(b.counts);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const confidence = obj(b.confidence);
  const brain = obj(b.brain);
  const synthesis = obj(b.synthesis);

  return {
    version: 'orion-brief-v1',
    agent: 'orion',
    workspace_id: str(b.workspace_id, 60) ?? '',
    generated_at: generated,
    window_days: num(b.window_days) || 7,
    summary: str(b.summary, 600) ?? '',
    priorities,
    opportunities: parseEntries(b.opportunities).slice(0, 5),
    market_changes: parseEntries(b.market_changes).slice(0, 5),
    pending_decisions: parseEntries(b.pending_decisions).slice(0, 10),
    recommended_actions,
    sources: parseEvidence(b.sources),
    counts: {
      signals: num(counts.signals), leads: num(counts.leads), content: num(counts.content),
      approvals: num(counts.approvals), plans_in_flight: num(counts.plans_in_flight), failed_work: num(counts.failed_work),
    },
    confidence: {
      overall: conf(confidence.overall),
      notes: arr(confidence.notes).map((n) => str(n, 300)).filter((n): n is string => !!n).slice(0, 5),
    },
    brain: {
      used: brain.used === true,
      company: str(brain.company, 120),
      missing: arr(brain.missing).map((m) => str(m, 60)).filter((m): m is string => !!m),
    },
    synthesis: {
      mode: synthesis.mode === 'model' ? 'model' : 'deterministic',
      model: str(synthesis.model, 80),
      rejected_reason: str(synthesis.rejected_reason, 80),
    },
  };
}

/** Stored rows → briefs, newest first, foreign or malformed rows dropped. */
export function parseBriefHistory(rows: unknown, workspaceId: string): StoredBrief[] {
  const out: StoredBrief[] = [];
  for (const x of arr(rows)) {
    const r = obj(x);
    const id = str(r.id, 60);
    if (!id || r.type !== EXECUTIVE_BRIEF_TYPE) continue;
    if (r.workspace_id !== undefined && r.workspace_id !== workspaceId) continue;
    const brief = parseExecutiveBrief(r.raw);
    if (!brief) continue;
    if (brief.workspace_id && brief.workspace_id !== workspaceId) continue;
    out.push({ id, created_at: str(r.created_at, 40) ?? brief.generated_at, brief });
  }
  return out.sort((a, b) => (a.brief.generated_at < b.brief.generated_at ? 1 : -1));
}

export type Freshness = { current: boolean; label: string };

/** Is this today's picture, or history? */
export function briefFreshness(generatedAt: string, now: Date = new Date()): Freshness {
  const t = Date.parse(generatedAt);
  if (Number.isNaN(t)) return { current: false, label: 'Unknown time' };
  const hours = (now.getTime() - t) / 3_600_000;
  const when = new Date(t);
  const time = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (hours < 1) return { current: true, label: `Generated ${Math.max(1, Math.round(hours * 60))} min ago` };
  if (hours < CURRENT_BRIEF_MAX_AGE_HOURS) return { current: true, label: `Generated today, ${time}` };
  const day = when.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return { current: false, label: `From ${day}, ${time} — may be out of date` };
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence',
};

// ── data access (thin; the panel's hooks call these) ────────────────────────

interface HistoryQuery {
  select(columns: string): HistoryQuery;
  eq(column: string, value: string): HistoryQuery;
  order(column: string, opts: { ascending: boolean }): HistoryQuery;
  limit(n: number): PromiseLike<{ data: unknown; error: unknown }>;
}
type SupabaseLike = { from(table: string): HistoryQuery };
type Invoke = (name: string, body: unknown) => Promise<{ data: unknown; error: unknown }>;

export async function fetchBriefHistory(db: SupabaseLike, workspaceId: string): Promise<StoredBrief[]> {
  const { data, error } = await db.from('saved_outputs')
    .select('id, workspace_id, type, created_at, raw')
    .eq('workspace_id', workspaceId)
    .eq('type', EXECUTIVE_BRIEF_TYPE)
    .order('created_at', { ascending: false })
    .limit(BRIEF_HISTORY_LIMIT);
  if (error) throw new Error((error as { message?: string }).message ?? 'Could not load briefs');
  return parseBriefHistory(data, workspaceId);
}

export async function requestExecutiveBrief(invoke: Invoke, workspaceId: string): Promise<ExecutiveBrief> {
  const { data, error } = await invoke('daily-brief', { workspace_id: workspaceId, surface: 'dashboard' });
  if (error) throw new Error((error as { message?: string }).message ?? 'Orion could not build the brief');
  const brief = parseExecutiveBrief(obj(data).brief);
  if (!brief) throw new Error('Orion returned an unreadable brief');
  return brief;
}
