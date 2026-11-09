// Company Brain memory — what the page shows (pure; deno-tested).
//
// Groups the rows the page read into the sections a person reviews, labels
// every value with its provenance and state, turns history rows into
// sentences, and builds the exact payload each "add" form sends. No React, no
// network: tests/frontend/companyBrainMemoryView.test.ts pins all of it.
import {
  effectiveStatus, isServable, needsReview, provenanceLabel, valueMatchesType,
  type EffectiveStatus, type MemoryItem,
} from '../../../supabase/functions/_shared/brainMemoryModel.ts';
import type { MemoryHistoryRow, MemoryProposal, MemorySnapshot, RevisionRow } from './memoryApi';

export type MemoryTab = 'review' | 'preferences' | 'decisions' | 'facts' | 'history' | 'agents';

export interface MemoryCard {
  id: string;
  kind: MemoryItem['kind'];
  title: string;
  value: string;
  provenance: string;
  status: EffectiveStatus;
  statusLabel: string | null;
  version: number;
  updatedAt: string;
  sourceUrl: string | null;
  scopeLabel: string | null;
  /** Can a person act on it (edit/retract/dispute)? Retracted/redacted history is read-only. */
  actionable: boolean;
  item: MemoryItem;
}

const STATUS_LABEL: Partial<Record<EffectiveStatus, string>> = {
  stale: 'Needs review — may be out of date',
  disputed: 'Disputed',
  retracted: 'Retracted',
  superseded: 'Superseded',
  expired: 'Expired',
  redacted: 'Redacted',
  rejected: 'Rejected',
};

const KEY_TITLE: Record<string, string> = {
  'icp.company_size': 'Target company size',
  'icp.industries': 'Target industries',
  'icp.geography': 'Target geography',
  'content.tone': 'Content tone',
  'content.avoid': 'Words and claims to avoid',
  'content.restrictions': 'Content restrictions',
};
const PREFIX_TITLE: Array<[RegExp, string]> = [[/^content\.restrictions:/, 'Content restriction'], [/^content\.avoid:/, 'Avoid in content'], [/^priority\./, 'Sales priority'], [/^goal\./, 'Business goal'], [/^product\./, 'Product or service']];

const DECISION_TITLE: Record<string, string> = {
  lead_rejected: 'Lead rejected',
  signal_dismissed: 'Signal dismissed',
  recommendation_decided: 'Recommendation decision',
  icp_changed: 'ICP changed',
  strategy_selected: 'Strategy selected',
  brand_preference: 'Brand preference',
  exclusion_added: 'Exclusion added',
  correction: 'Correction',
};

function title(i: Pick<MemoryItem, 'kind' | 'category' | 'fact_key'>): string {
  if (i.kind === 'decision') return DECISION_TITLE[i.category] ?? i.category.replace(/_/g, ' ');
  if (KEY_TITLE[i.fact_key]) return KEY_TITLE[i.fact_key];
  for (const [re, t] of PREFIX_TITLE) if (re.test(i.fact_key)) return t;
  const m = i.fact_key.match(/^exclusion\.([a-z]+):/);
  if (m) return `Exclude ${m[1]}`;
  if (i.fact_key.startsWith('competitor:')) return 'Competitor';
  if (i.fact_key.startsWith('content.proven_angle:')) return 'Proven content angle';
  const tail = i.fact_key.split(/[.:]/).slice(1).join(' ').replace(/_/g, ' ');
  const cat = i.category.replace(/_/g, ' ');
  return tail ? `${cat.charAt(0).toUpperCase()}${cat.slice(1)}: ${tail}` : cat;
}

/** A value as a person reads it. Never JSON for the known shapes. */
export function formatValue(valueType: string, value: unknown): string {
  if (valueType === 'redacted' || value === null) return '[redacted]';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
  if (valueType === 'number_range' && value && typeof value === 'object') {
    const v = value as { min?: number | null; max?: number | null };
    if (v.min != null && v.max != null) return `${v.min}–${v.max} employees`;
    if (v.min != null) return `${v.min}+ employees`;
    if (v.max != null) return `up to ${v.max} employees`;
  }
  const o = (value ?? {}) as Record<string, unknown>;
  if (typeof o.outcome === 'string') {
    const subj = (o.subject ?? {}) as Record<string, unknown>;
    const label = typeof subj.label === 'string' ? ` — ${subj.label}` : '';
    const note = typeof o.note === 'string' ? ` (“${o.note}”)` : '';
    return `${o.outcome.charAt(0).toUpperCase()}${o.outcome.slice(1)}${label}${note}`;
  }
  if (typeof o.name === 'string') return typeof o.domain === 'string' ? `${o.name} (${o.domain})` : o.name;
  if (typeof o.value === 'string') return o.value;
  return Object.entries(o).map(([k, v]) => `${k}: ${String(v)}`).join(', ');
}

export function toCard(i: MemoryItem, now: Date = new Date()): MemoryCard {
  const status = effectiveStatus(i, now);
  return {
    id: i.id, kind: i.kind, title: title(i), value: formatValue(i.value_type, i.value),
    provenance: provenanceLabel(i), status, statusLabel: STATUS_LABEL[status] ?? null,
    version: i.version, updatedAt: i.updated_at, sourceUrl: i.source_url,
    scopeLabel: i.scope === 'workspace' ? null : `Applies to this ${i.scope} only`,
    actionable: ['active', 'stale', 'disputed'].includes(status),
    item: i,
  };
}

export interface MemorySections {
  pendingProposals: MemoryProposal[];
  needsReview: MemoryCard[];
  preferences: MemoryCard[];
  decisions: MemoryCard[];
  facts: MemoryCard[];
  /** Retracted, superseded, redacted — kept for the record. */
  archived: MemoryCard[];
  /** How many items agents actually receive now. */
  servedCount: number;
}

const byUpdated = (a: MemoryCard, b: MemoryCard) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);

export function buildSections(s: MemorySnapshot, now: Date = new Date()): MemorySections {
  const cards = s.items.map((i) => toCard(i, now));
  const live = (c: MemoryCard) => c.status === 'active';
  return {
    pendingProposals: s.proposals.filter((p) => p.status === 'pending'),
    needsReview: cards.filter((c) => needsReview(c.item, now)).sort(byUpdated),
    preferences: cards.filter((c) => c.kind === 'preference' && live(c)).sort(byUpdated),
    decisions: cards.filter((c) => c.kind === 'decision' && live(c)).sort(byUpdated),
    facts: cards.filter((c) => c.kind === 'fact' && live(c)).sort(byUpdated),
    archived: cards.filter((c) => !c.actionable).sort(byUpdated),
    servedCount: s.items.filter((i) => isServable(i, now)).length,
  };
}

export function proposalSummary(p: MemoryProposal): { title: string; value: string; provenance: string; evidenceCount: number } {
  const agent = p.proposed_by_agent.charAt(0).toUpperCase() + p.proposed_by_agent.slice(1);
  const what = p.source_type === 'provider_returned' ? 'from a data provider' : p.source_type === 'model_inference' ? 'inferred by AI' : 'suggestion';
  return {
    title: title({ kind: p.kind, category: p.category, fact_key: p.fact_key }),
    value: formatValue(p.value_type, p.value),
    provenance: `${agent} · ${what} · ${p.confidence} confidence · not yet trusted`,
    evidenceCount: p.evidence?.length ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────── history ────

export interface TimelineEntry {
  id: string;
  at: string;
  text: string;
  detail: string | null;
  who: string;
}

const CHANGE_TEXT: Record<string, string> = {
  created: 'added', updated: 'changed', corrected: 'corrected', retracted: 'retracted', disputed: 'marked disputed',
  marked_stale: 'marked out of date', reactivated: 'confirmed again', superseded: 'superseded',
  approved_from_proposal: 'approved', corrected_from_proposal: 'approved with a correction', proposal_rejected: 'rejected a suggestion:',
  redacted: 'redacted',
};

export function buildTimeline(s: MemorySnapshot, currentUserId: string | null): TimelineEntry[] {
  const itemById = new Map(s.items.map((i) => [i.id, i]));
  const propById = new Map(s.proposals.map((p) => [p.id, p]));
  const who = (kind: string, id: string | null, agent: string | null) =>
    kind === 'user' ? (id && id === currentUserId ? 'You' : 'A teammate') : kind === 'agent' && agent ? agent : 'System';
  const memory: TimelineEntry[] = s.history.map((h: MemoryHistoryRow) => {
    const item = h.memory_id ? itemById.get(h.memory_id) : undefined;
    const prop = h.proposal_id ? propById.get(h.proposal_id) : undefined;
    const subject = item ? title(item) : prop ? title({ kind: prop.kind, category: prop.category, fact_key: prop.fact_key }) : 'a memory item';
    const prev = h.previous && 'value' in h.previous ? formatValue(String(h.previous.value_type ?? ''), h.previous.value) : null;
    const cur = h.current && 'value' in h.current ? formatValue(String(h.current.value_type ?? ''), h.current.value) : null;
    const agentNote = h.actor_agent && h.change_kind.endsWith('_from_proposal') ? ` (suggested by ${h.actor_agent})` : '';
    const detail = h.change_kind === 'proposal_rejected'
      ? prev
      : prev && cur && prev !== cur ? `${prev} → ${cur}` : cur ?? prev;
    return {
      id: `h:${h.id}`, at: h.created_at,
      text: `${CHANGE_TEXT[h.change_kind] ?? h.change_kind} ${subject}${agentNote}`,
      detail: h.reason ? `${detail ?? ''}${detail ? ' — ' : ''}${h.reason}` : detail,
      who: who(h.actor_kind, h.actor_id, h.actor_agent),
    };
  });
  const profile: TimelineEntry[] = s.revisions
    .filter((r: RevisionRow) => r.changed_sections.some((c) => !c.startsWith('_')) || r.actor_kind === 'backfill')
    .map((r) => ({
      id: `r:${r.id}`, at: r.written_at,
      text: r.actor_kind === 'backfill' ? 'history starts here (existing profile saved)'
        : `edited the profile: ${r.changed_sections.filter((c) => !c.startsWith('_')).map((c) => c.replace(/_/g, ' ')).join(', ')}`,
      detail: r.redacted_at ? 'This version was redacted.' : null,
      who: who(r.actor_kind === 'backfill' ? 'system' : r.actor_kind, r.actor_id, null),
    }));
  return [...memory, ...profile].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

// ─────────────────────────────────────────────────────────── add forms ────

export type AddKind =
  | 'exclude_industry' | 'exclude_company' | 'exclude_geography' | 'exclude_keyword'
  | 'company_size' | 'content_tone' | 'content_restriction' | 'sales_priority' | 'goal' | 'product';

export const ADD_OPTIONS: Array<{ kind: AddKind; label: string; hint: string }> = [
  { kind: 'exclude_industry', label: 'Exclude an industry', hint: 'e.g. Gambling' },
  { kind: 'exclude_company', label: 'Exclude a company', hint: 'its domain, e.g. rivalco.com' },
  { kind: 'exclude_geography', label: 'Exclude a region', hint: 'e.g. Russia' },
  { kind: 'exclude_keyword', label: 'Exclude a keyword', hint: 'e.g. crypto' },
  { kind: 'company_size', label: 'Target company size', hint: 'e.g. 50-200' },
  { kind: 'content_tone', label: 'Content tone', hint: 'e.g. plain, technical, no hype' },
  { kind: 'content_restriction', label: 'Content restriction', hint: 'e.g. Never mention pricing' },
  { kind: 'sales_priority', label: 'Sales priority', hint: 'e.g. Nordic manufacturers this quarter' },
  { kind: 'goal', label: 'Business goal', hint: 'e.g. 10 new manufacturing customers by March' },
  { kind: 'product', label: 'Product or service', hint: 'e.g. PickBot 3 shelf-picking robot' },
];

const slug = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

/** Form input → the exact `write` payload. Returns an error string when the input is unusable. */
export function buildAddPayload(kind: AddKind, raw: string, opts: { temporaryUntil?: string | null } = {}):
  { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } {
  const text = raw.trim();
  if (!text) return { ok: false, error: 'Enter a value.' };
  if (text.length > 500) return { ok: false, error: 'Keep it under 500 characters.' };
  const temp = opts.temporaryUntil ? { persistence: 'temporary', expires_at: opts.temporaryUntil } : {};
  const exclusion = (type: string, value: string) => ({
    kind: 'preference', category: 'exclusions', fact_key: `exclusion.${type}:${slug(value)}`,
    value_type: 'object', value: { type, value }, ...temp,
  });
  let payload: Record<string, unknown>;
  switch (kind) {
    case 'exclude_industry': payload = exclusion('industry', text); break;
    case 'exclude_geography': payload = exclusion('geography', text); break;
    case 'exclude_keyword': payload = exclusion('keyword', text); break;
    case 'exclude_company': {
      const d = slug(text);
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return { ok: false, error: 'Enter the company’s domain, e.g. rivalco.com.' };
      payload = exclusion('company', d); break;
    }
    case 'company_size': {
      const m = text.match(/^(\d+)\s*(?:-|–|to)\s*(\d+)$/) ?? text.match(/^(\d+)\s*\+$/);
      if (!m) return { ok: false, error: 'Use a range like 50-200, or 50+.' };
      const value = m[2] ? { min: Number(m[1]), max: Number(m[2]) } : { min: Number(m[1]), max: null };
      if (!valueMatchesType('number_range', value)) return { ok: false, error: 'The smaller number goes first.' };
      payload = { kind: 'preference', category: 'icp', fact_key: 'icp.company_size', value_type: 'number_range', value, ...temp };
      break;
    }
    case 'content_tone': payload = { kind: 'preference', category: 'content', fact_key: 'content.tone', value_type: 'text', value: text, ...temp }; break;
    case 'content_restriction': payload = { kind: 'preference', category: 'content', fact_key: `content.restrictions:${slug(text).slice(0, 60)}`, value_type: 'list', value: [text], ...temp }; break;
    case 'sales_priority': payload = { kind: 'preference', category: 'sales_priority', fact_key: `priority.${slug(text).slice(0, 40)}`, value_type: 'text', value: text, ...temp }; break;
    case 'goal': payload = { kind: 'fact', category: 'goals', fact_key: `goal.${slug(text).slice(0, 40)}`, value_type: 'text', value: text, ...temp }; break;
    case 'product': payload = { kind: 'fact', category: 'products', fact_key: `product.${slug(text).slice(0, 40)}`, value_type: 'text', value: text }; break;
  }
  return { ok: true, payload };
}

/** The payload that edits an existing item to a new text/list/range value (CAS on its version). */
export function buildEditPayload(card: MemoryCard, raw: string): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } {
  const i = card.item;
  const text = raw.trim();
  let value: unknown;
  if (i.value_type === 'number_range') {
    const m = text.match(/^(\d+)\s*(?:-|–|to)\s*(\d+)$/);
    if (!m) return { ok: false, error: 'Use a range like 50-200.' };
    value = { min: Number(m[1]), max: Number(m[2]) };
  } else if (i.value_type === 'list') {
    value = text.split(',').map((x) => x.trim()).filter(Boolean);
  } else if (i.value_type === 'object') {
    const o = (i.value ?? {}) as Record<string, unknown>;
    value = 'value' in o ? { ...o, value: text } : 'name' in o ? { ...o, name: text } : null;
    if (!value) return { ok: false, error: 'This item cannot be edited here.' };
  } else {
    value = text;
  }
  if (!valueMatchesType(i.value_type, value)) return { ok: false, error: 'That value is not valid for this item.' };
  return { ok: true, payload: {
    kind: i.kind, category: i.category, fact_key: i.fact_key, scope: i.scope, scope_ref: i.scope_ref,
    value_type: i.value_type, value, expected_version: i.version,
    ...(i.persistence === 'temporary' && i.expires_at ? { persistence: 'temporary', expires_at: i.expires_at } : {}),
  } };
}

/** The agents and what each takes from the Brain, for the "How agents use it" tab. */
export const AGENT_USE: Array<{ id: 'orion' | 'atlas' | 'lyra' | 'lisa'; name: string; uses: string }> = [
  { id: 'orion', name: 'Orion', uses: 'Ranks your executive brief against your goals, leaves out what you rejected or dismissed, and lowers anything matching an exclusion.' },
  { id: 'atlas', name: 'Atlas', uses: 'Finds leads within your target industries, size and geography, and skips your exclusions and rejected leads.' },
  { id: 'lyra', name: 'Lyra', uses: 'Writes in your tone, respects your content restrictions, and only states company facts you have confirmed.' },
  { id: 'lisa', name: 'Lisa', uses: 'Watches your competitors and markets, judges relevance against your priorities, and suggests new knowledge for you to approve.' },
];
