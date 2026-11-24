// Read-only derivations for the Company Brain page: the ICP written as a
// sentence, the next improvements worth making, and the sources the brain was
// built from.
//
// Pure helper over the normalized CompanyBrainV2. Nothing here invents data —
// every phrase, step and source comes from a field the brain already holds, and
// every editable slot names the drawer section + field that owns it, so an
// inline edit goes through the drawer's own patch builder.

import type { CompanyBrainV2 } from './normalizeCompanyBrain';
import { deriveHealth, type SectionKey } from './companyBrainHealth';

/** Where a value lives in the drawer's edit contract (`initialFor` state keys). */
export interface FieldRef {
  section: SectionKey;
  field: string;
}

export type IcpPhrase =
  | { kind: 'text'; text: string }
  | {
      kind: 'slot';
      /** Field name shown in the editor and in an empty slot ("+ industries"). */
      label: string;
      values: string[];
      /** How the values read inside the sentence ("B2B SaaS or Fintech"). */
      joiner: 'or' | 'and';
      /** null = not a list; editing opens the section drawer instead. */
      ref: FieldRef | null;
      section: SectionKey;
    };

const uniq = (values: string[]) => [...new Set(values.map((v) => v.trim()).filter(Boolean))];

export function companySizeLabel(b: CompanyBrainV2): string {
  // An explicit range wins over the label: normalizeCompanyBrain falls back to
  // the seller's own `company.team_size` for a missing label, which is not the
  // size of the companies they target.
  const s = b.target_customer.company_size;
  if (s.min != null && s.max != null) return `${s.min}–${s.max} employees`;
  if (s.min != null) return `${s.min}+ employees`;
  if (s.max != null) return `up to ${s.max} employees`;
  return s.label;
}

/** "A", "A or B", "A, B or C". */
export function joinValues(values: string[], joiner: 'or' | 'and'): string {
  if (values.length <= 1) return values[0] ?? '';
  return `${values.slice(0, -1).join(', ')} ${joiner} ${values[values.length - 1]}`;
}

const slot = (
  label: string, values: string[], joiner: 'or' | 'and', section: SectionKey, field: string | null,
): IcpPhrase => ({ kind: 'slot', label, values: uniq(values), joiner, section, ref: field ? { section, field } : null });
const text = (t: string): IcpPhrase => ({ kind: 'text', text: t });

/**
 * The ICP as three sentences: who, when they fit best, who to skip. Slots are
 * always present — an empty one renders as an invitation to fill it. `subject`
 * names whose ICP this is when it is not the reader's own company (a client
 * Brain, Phase 3c): "Acme sells to … / Acme skips …" instead of "We".
 */
export function buildIcpSentences(b: CompanyBrainV2, subject?: string | null): IcpPhrase[][] {
  const t = b.target_customer;
  const size = companySizeLabel(b);
  return [
    [
      text(subject ? `${subject} sells to` : 'We sell to'), slot('business models', t.business_models, 'or', 'targeting', 'business_models'),
      text('companies in'), slot('industries', t.industries, 'or', 'targeting', 'industries'),
      text('with'), slot('company size', size ? [size] : [], 'or', 'targeting', null),
      text('based in'), slot('regions', t.geography, 'or', 'targeting', 'geography'),
      text('at'), slot('funding stages', t.funding_stage, 'or', 'targeting', 'funding_stage'),
      text('.'),
    ],
    [
      text('They fit best when'), slot('must-haves', t.must_have, 'and', 'targeting', 'must_have'),
      text('— and even better if'), slot('nice-to-haves', t.nice_to_have, 'and', 'targeting', 'nice_to_have'),
      text('.'),
    ],
    [
      text(subject ? `${subject} skips` : 'We skip'), slot('excluded industries', t.disqualifiers.industries, 'and', 'disqualifiers', 'disq_industries'),
      text('and'), slot('excluded company types', t.disqualifiers.company_types, 'and', 'disqualifiers', 'disq_company_types'),
      text('.'),
    ],
  ];
}

export type TabKey = 'overview' | 'market' | 'moments' | 'rules' | 'voice';

/** Which tab presents each drawer section. */
export const SECTION_TAB: Record<SectionKey, TabKey> = {
  company: 'overview',
  targeting: 'market',
  buyers: 'market',
  signals: 'moments',
  disqualifiers: 'rules',
  messaging: 'voice',
};

export interface NextStep {
  section: SectionKey;
  title: string;
  detail: string;
  /** 'gap' = the section is not configured; 'polish' = configured, could be stronger. */
  kind: 'gap' | 'polish';
}

/** Ordered improvements: real gaps first (in the order agents use the brain), then polish. */
export function deriveNextSteps(b: CompanyBrainV2, subject?: string | null): NextStep[] {
  // Whose Brain: the reader's own company ("your", "you"), or a client's (Phase 3c).
  const s = subject?.trim() || null;
  const their = s ? `${s}'s` : 'your';
  const them = s ?? 'you';
  const h = deriveHealth(b);
  const t = b.target_customer;
  const gaps: NextStep[] = [];
  const polish: NextStep[] = [];
  const missing = (pairs: [boolean, string][]) => pairs.filter(([has]) => !has).map(([, name]) => name);

  if (h.company !== 'configured') {
    const m = missing([[!!b.company.name, 'name'], [!!b.company.description, 'description'], [!!b.company.category, 'category']]);
    gaps.push({ section: 'company', kind: 'gap', title: `Complete ${their} company profile`, detail: `Add ${s ? 'its' : 'your'} ${joinValues(m, 'and')} so every agent describes ${s ? 'it' : 'you'} the same way.` });
  }
  if (h.targeting !== 'configured') {
    gaps.push(!t.industries.length
      ? { section: 'targeting', kind: 'gap', title: 'Choose target industries', detail: 'Industries decide which companies are worth researching at all.' }
      : { section: 'targeting', kind: 'gap', title: `Sharpen ${their} target market`, detail: `Add ${joinValues(missing([[!!t.business_models.length, 'business models'], [!!t.geography.length, 'regions']]), 'and')} to narrow the search.` });
  }
  if (h.buyers !== 'configured') {
    gaps.push(!b.buyer_personas.length
      ? { section: 'buyers', kind: 'gap', title: s ? `Add the roles ${s} sells to` : 'Add the roles you sell to', detail: 'Buyer roles decide who inside an account is worth contacting.' }
      : { section: 'buyers', kind: 'gap', title: `Add the pains ${their} buyers feel`, detail: 'Pain points give outreach a reason to exist.' });
  }
  if (h.signals !== 'configured') {
    gaps.push(!b.triggers.length && !b.jobs_to_watch.length
      ? { section: 'signals', kind: 'gap', title: 'Add buying moments to watch', detail: 'Trigger events and hiring roles tell your AI team when to reach out.' }
      : !b.triggers.length
        ? { section: 'signals', kind: 'gap', title: 'Add trigger events', detail: 'Events like a new hire or a funding round make outreach timely.' }
        : { section: 'signals', kind: 'gap', title: 'Add roles to watch for', detail: 'Open roles are one of the clearest signs a company is investing.' });
  }
  if (h.disqualifiers !== 'configured') {
    gaps.push({ section: 'disqualifiers', kind: 'gap', title: `Set ${their} guardrails`, detail: 'Add at least one rule or exclusion so weak fits are filtered out early.' });
  }
  if (h.messaging !== 'configured') {
    const m = missing([[!!b.positioning.promise, 'a core promise'], [!!b.content_angles.length, 'content angles'], [!!b.brand_voice.tone, 'a tone of voice']]);
    gaps.push({ section: 'messaging', kind: 'gap', title: `Finish ${their} messaging`, detail: `Add ${joinValues(m, 'and')} so drafts sound like ${them}.` });
  }

  if (h.messaging === 'configured' && !b.positioning.proof_points.length) {
    polish.push({ section: 'messaging', kind: 'polish', title: 'Add proof points', detail: 'A customer result or metric makes every message more credible.' });
  }
  if (h.messaging === 'configured' && !b.positioning.differentiators.length) {
    polish.push({ section: 'messaging', kind: 'polish', title: s ? `Name what makes ${s} different` : 'Name what makes you different', detail: 'Differentiators keep messages from sounding like every competitor.' });
  }
  if (h.buyers === 'configured' && b.buyer_personas.length === 1) {
    polish.push({ section: 'buyers', kind: 'polish', title: 'Add a second buyer role', detail: 'Most deals involve more than one person — name who else signs off.' });
  }
  if (h.disqualifiers === 'configured' && !b.qualification_rules.reject_if.length) {
    polish.push({ section: 'disqualifiers', kind: 'polish', title: 'Add a hard reject rule', detail: `A clear reject rule saves research on companies ${s ? `${s} would` : 'you would'} never close.` });
  }
  return [...gaps, ...polish];
}

export interface BrainSource {
  label: string;
  /** Only http(s) URLs become links. */
  href: string | null;
  kind: 'website' | 'linkedin';
}

/** A readable label for a URL; `href` only for http(s). */
export function formatSource(value: string, kind: BrainSource['kind'] = 'website'): BrainSource {
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { label: value, href: null, kind };
    const path = u.pathname.replace(/\/$/, '');
    return { label: `${u.hostname.replace(/^www\./, '')}${path}`, href: u.href, kind };
  } catch {
    return { label: value, href: null, kind };
  }
}

export function brainSources(b: CompanyBrainV2): BrainSource[] {
  const seen = new Set<string>();
  const out: BrainSource[] = [];
  for (const [list, kind] of [[b.evidence.source_pages, 'website'], [b.evidence.linkedin_sources, 'linkedin']] as const) {
    for (const v of uniq(list)) {
      const s = formatSource(v, kind);
      if (seen.has(s.label)) continue;
      seen.add(s.label);
      out.push(s);
    }
  }
  return out;
}

export const CONFIDENCE_LABEL: Record<CompanyBrainV2['brain_confidence'], string> = {
  weak: 'Light evidence',
  partial: 'Partial evidence',
  strong: 'Strong evidence',
};

/** Two-letter monogram for the company card. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '·';
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return letters.toUpperCase();
}

/**
 * A Brain nobody has started: not activated and holding nothing at all — no
 * company identity, no targeting, buyers, signals, exclusions or messaging. The
 * page greets it with a setup prompt instead of a grid of empty fields and
 * identity warnings. One filled value means someone started: no prompt.
 */
export function isEmptyBrain(brain: CompanyBrainV2, active: boolean): boolean {
  if (active) return false;
  const c = brain.company, t = brain.target_customer, d = t.disqualifiers;
  const text = [c.name, c.description, c.website_url, c.business_model, brain.positioning.promise];
  const lists = [t.industries, t.business_models, t.geography, t.must_have, t.nice_to_have, t.funding_stage,
    d.industries, d.company_types, d.keywords, d.titles, d.domains,
    brain.buyer_personas, brain.pain_points, brain.triggers, brain.jobs_to_watch, brain.competitors, brain.content_angles];
  return text.every((v) => !v?.trim()) && lists.every((l) => !l?.length);
}
