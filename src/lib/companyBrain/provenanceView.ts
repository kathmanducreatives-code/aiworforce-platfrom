// Company Brain V2 · B2.2 — "Where this came from", as a person reads it.
//
// Pure view model over what the server recorded: the latest profile revision that
// touched a section (with its source), the research run an accepted suggestion
// came from, and the confirmed memory that also shapes the section. It states
// only what was recorded. A revision without a source says so; nothing is
// promoted to "verified" or given a confidence it was not stored with.
import {
  sectionProfileKeys, sectionProvenance, type ProvenanceRevision, type SectionProvenance,
} from '../../../supabase/functions/_shared/companyBrainProvenance.ts';
import type { AssessmentSectionKey } from '../../../supabase/functions/_shared/companyBrainAssessment.ts';
import type { StoredResearchRun } from '../../../supabase/functions/_shared/companyBrainCompletion.ts';
import { isServable, type MemoryItem } from '../../../supabase/functions/_shared/brainMemoryModel.ts';

export type ProvenanceTone = 'trusted' | 'review' | 'muted';

export interface ProvenanceLine {
  /** "Entered by you", "Accepted from website research by a teammate", … */
  headline: string;
  tone: ProvenanceTone;
  /** What the source means for trust, in a few words. */
  trust: string;
  at: string | null;
  reason: string | null;
  link: { href: string; text: string } | null;
  /** "3 recorded changes" — how much history the section has. */
  history: string | null;
  /** Confirmed memory items that also shape what agents read for this section. */
  memory: Array<{ id: string; title: string; detail: string }>;
}

const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

/** Which memory keys feed which section (the loader's fold rules, docs in companyBrainContextLoader). */
export function memorySection(m: Pick<MemoryItem, 'fact_key' | 'category' | 'kind'>): AssessmentSectionKey | null {
  const k = m.fact_key;
  if (k.startsWith('icp.')) return 'target_customer';
  if (k.startsWith('exclusion.')) return 'qualification';
  if (k.startsWith('competitor')) return 'competitors';
  if (k.startsWith('content.')) return 'brand_voice';
  if (k.startsWith('goal.') || k.startsWith('priority.') || m.category === 'goals' || m.category === 'sales_priority') return 'goals';
  if (k.startsWith('product.')) return 'company';
  return null;
}

const memoryTitle = (m: MemoryItem) => {
  const v = m.value;
  const text = typeof v === 'string' ? v
    : Array.isArray(v) ? v.join(', ')
    : v && typeof v === 'object' && ('min' in v || 'max' in v) ? `${(v as { min?: unknown }).min ?? '…'}–${(v as { max?: unknown }).max ?? '…'}`
    : v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string' ? String((v as { name: string }).name)
    : m.fact_key;
  return text;
};

const memorySource = (m: MemoryItem) =>
  m.created_by_kind === 'agent' && m.created_by_agent ? `suggested by ${m.created_by_agent.toUpperCase()}, approved by your team`
    : 'added by your team';

export function describeSectionProvenance(input: {
  section: AssessmentSectionKey;
  revisions: readonly ProvenanceRevision[];
  runs: readonly StoredResearchRun[];
  memory: readonly MemoryItem[];
  currentUserId: string | null;
  now?: Date;
}): ProvenanceLine | null {
  const p: SectionProvenance | null = sectionProvenance(input.revisions, sectionProfileKeys(input.section));
  const now = input.now ?? new Date();
  const memory = input.memory
    .filter((m) => m.scope === 'workspace' && isServable(m, now) && memorySection(m) === input.section)
    .slice(0, 5)
    .map((m) => ({ id: m.id, title: memoryTitle(m), detail: memorySource(m) }));
  if (!p && memory.length === 0) return null;
  const who = p?.actor_id ? (p.actor_id === input.currentUserId ? 'you' : 'a teammate') : null;
  let headline = '', tone: ProvenanceTone = 'muted', trust = '';
  let link: ProvenanceLine['link'] = null;
  switch (p?.kind) {
    case 'founder':
      headline = `Entered by ${who ?? 'your team'}`; tone = 'trusted'; trust = 'Your team’s own statement';
      break;
    case 'research': {
      headline = `Accepted from website research by ${who ?? 'your team'}`; tone = 'trusted';
      trust = 'Read from your website, then confirmed by a person';
      const run = input.runs.find((r) => r.id && r.id === p.research_run_id);
      const out = run && run.output && typeof run.output === 'object' ? run.output as Record<string, unknown> : null;
      const pages = out && Array.isArray(out.source_pages) ? out.source_pages.filter((x): x is string => typeof x === 'string' && /^https?:\/\//i.test(x)) : [];
      if (run) link = pages[0] ? { href: pages[0], text: `Research of ${day(run.created_at)} · ${pages.length} page${pages.length === 1 ? '' : 's'} read` } : null;
      if (run && !link) headline += ` (research of ${day(run.created_at)})`;
      break;
    }
    case 'ai_inference':
      headline = 'Drafted by AI'; tone = 'review'; trust = 'Not yet reviewed by a person. Check it before relying on it';
      break;
    case 'memory':
      headline = `Promoted from approved company memory by ${who ?? 'your team'}`; tone = 'trusted'; trust = 'Confirmed by your team';
      break;
    case 'system':
      headline = 'Changed by Agentory'; tone = 'muted'; trust = 'No person made this change';
      break;
    case 'backfill':
    case 'unrecorded':
      headline = 'Saved before sources were recorded'; tone = 'muted'; trust = 'Where it came from was not recorded';
      break;
    default:
      headline = 'No recorded change to this section yet'; tone = 'muted'; trust = '';
  }
  return {
    headline, tone, trust,
    at: p?.at ?? null,
    reason: p?.reason ?? null,
    link,
    history: p && p.changes > 1 ? `${p.changes} recorded changes` : null,
    memory,
  };
}
