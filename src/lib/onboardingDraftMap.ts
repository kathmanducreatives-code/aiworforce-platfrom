// Pure helpers that map the `analyze` action's loose AI draft onto the
// structured Company Brain shape used by the onboarding review cards.
// Never invent values — empty in, empty out.

import { getBrainDefaults, type StructuredBrain } from './companyBrainSchema';

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === 'string') {
    return v.split(/[,\n;]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function asString(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v == null) return '';
  try { return String(v); } catch { return ''; }
}

export interface MappedBasics {
  short_description: string;
  category: string;
}

export function mapDraftToStructured(
  draft: Record<string, unknown> | null | undefined,
): StructuredBrain {
  const base = getBrainDefaults();
  if (!draft || typeof draft !== 'object') return base;

  // Positioning
  base.positioning.promise = asString((draft as any).offer_summary) || asString((draft as any).positioning);
  base.positioning.use_cases = asStringArray((draft as any).use_cases);
  base.positioning.differentiators = asStringArray((draft as any).differentiators);
  base.positioning.proof_points = asStringArray((draft as any).proof_points);

  // Brand voice
  const bv = (draft as any).brand_voice;
  if (typeof bv === 'string') base.brand_voice.tone = bv.trim();
  else if (bv && typeof bv === 'object') {
    base.brand_voice.tone = asString((bv as any).tone);
    base.brand_voice.tags = asStringArray((bv as any).tags);
    base.brand_voice.style_rules = asStringArray((bv as any).style_rules);
    base.brand_voice.avoid = asStringArray((bv as any).avoid);
  }

  // ICP
  const icp = (draft as any).icp;
  if (icp && typeof icp === 'object') {
    base.icp.buyer_roles = asStringArray((icp as any).buyer_roles);
    base.icp.industries = asStringArray((icp as any).industries);
    base.icp.pain_points = asStringArray((icp as any).pain_points);
    base.icp.company_size = asString((icp as any).company_size);
    base.icp.geography = asString((icp as any).geography);
  } else {
    const tcp = asString((draft as any).target_customer_profile);
    if (tcp) base.icp.pain_points = [tcp];
  }

  // Competitors
  const comps = (draft as any).competitors;
  base.competitors.known = asStringArray(comps);
  base.competitors.unknown = base.competitors.known.length === 0;

  // Goals (best-effort from `agent_instructions` is risky — leave empty)
  return base;
}

export function mapDraftToBasics(
  draft: Record<string, unknown> | null | undefined,
): MappedBasics {
  if (!draft || typeof draft !== 'object') return { short_description: '', category: '' };
  return {
    short_description: asString((draft as any).company_summary),
    category: asString((draft as any).category),
  };
}
