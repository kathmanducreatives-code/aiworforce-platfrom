// Pure helper: compute Company Brain completeness from a profile snapshot.
// Returns a 0-100 percent and a list of human-readable missing items.

export interface CompletenessResult {
  percent: number;
  missing: string[];
  total: number;
  filled: number;
}

function hasText(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}
function hasArr(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

export interface CompletenessInput {
  company_name?: string;
  website_url?: string;
  short_description?: string;
  icp?: { buyer_roles?: string[]; industries?: string[]; pain_points?: string[]; company_size?: string; geography?: string };
  goals?: Record<string, string>;
  competitors?: { known?: string[]; adjacent?: string[]; unknown?: boolean };
  brand_voice?: { tone?: string; tags?: string[]; avoid?: string[] };
  approval_rules?: { draft_only?: boolean; email_requires_approval?: boolean; linkedin_manual_only?: boolean };
}

export function computeCompleteness(p: CompletenessInput | null | undefined): CompletenessResult {
  const checks: Array<{ ok: boolean; label: string }> = [
    { ok: hasText(p?.company_name), label: 'Company name' },
    { ok: hasText(p?.website_url) || hasText(p?.short_description), label: 'Website or description' },
    { ok: hasArr(p?.icp?.buyer_roles), label: 'Buyer roles' },
    { ok: hasArr(p?.icp?.industries) || hasText(p?.icp?.company_size), label: 'Industries or company size' },
    { ok: hasArr(p?.icp?.pain_points), label: 'Pain points' },
    { ok: Object.values(p?.goals ?? {}).some((v) => hasText(v as string)), label: 'Goals' },
    { ok: !!p?.competitors?.unknown || hasArr(p?.competitors?.known) || hasArr(p?.competitors?.adjacent), label: 'Competitors' },
    { ok: hasText(p?.brand_voice?.tone) || hasArr(p?.brand_voice?.tags), label: 'Brand voice' },
    { ok: !!p?.approval_rules, label: 'Approval rules' },
  ];
  const filled = checks.filter((c) => c.ok).length;
  return {
    total: checks.length,
    filled,
    percent: Math.round((filled / checks.length) * 100),
    missing: checks.filter((c) => !c.ok).map((c) => c.label),
  };
}
