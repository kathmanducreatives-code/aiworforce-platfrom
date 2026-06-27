// Adaptive broadening for sourcing-style workflows. Pure / import-free.
// When an attempt under-delivers, broaden deterministically: role aliases →
// industry synonyms → relax stage. Never broadens into a raw description.

const ROLE_ALIASES: Record<string, string[]> = {
  gtm: ["GTM", "go-to-market", "sales", "growth", "SDR", "account executive", "marketing"],
  sdr: ["SDR", "sales development representative", "BDR", "account executive"],
  growth: ["growth", "growth marketing", "demand generation", "marketing"],
  founder: ["founder", "co-founder", "CEO", "owner"],
  ceo: ["CEO", "founder", "co-founder"],
  marketing: ["marketing", "demand generation", "growth", "content"],
  engineer: ["engineer", "software engineer", "developer", "full stack engineer"],
  revops: ["RevOps", "revenue operations", "sales operations"],
};

const INDUSTRY_SYNONYMS: Record<string, string[]> = {
  healthcare: ["healthcare", "health tech", "digital health", "medical"],
  "b2b saas": ["B2B SaaS", "SaaS", "B2B software"],
  saas: ["SaaS", "B2B SaaS", "software"],
  fintech: ["fintech", "financial technology", "finance software"],
  "ai software": ["AI software", "AI tools", "AI products"],
};

// Assistant / founder-support / operations roles. Active hiring for one of these
// is a strong buying signal for any product that removes manual founder-ops
// workload. This list is the SINGLE SOURCE OF TRUTH — the workflow classifier
// (routing), the actor-input planner (role_keywords), and the lead-quality /
// source-quality acceptance layers all detect support roles via SUPPORT_ROLE_RE
// and expand to this alias set. Keep the regex and the list in sync.
export const SUPPORT_ROLE_ALIASES = [
  "Executive Assistant",
  "Founder Assistant",
  "Assistant to Founder",
  "Assistant to CEO",
  "Operations Assistant",
  "Admin Assistant",
  "Administrative Assistant",
  "Virtual Assistant",
  "Personal Assistant",
  "Founder's Office",
  "Founder Office",
  "Founder Associate",
  "Chief of Staff",
  "Operations Associate",
  "Business Operations Associate",
  "Office Manager",
  "EA to CEO",
  "EA to Founder",
];

// Matches any assistant / founder-support / operations role (incl. bare
// "assistant"/"admin") in a query, job title, or signal text. Tolerates plurals
// and the founder's/founders'/founder-office variants.
export const SUPPORT_ROLE_RE =
  /\b(executive assistants?|administrative assistants?|admin assistants?|operations assistants?|operations associates?|operations coordinators?|virtual assistants?|personal assistants?|founders?(?:['’]s)?\s+(?:office|associate|assistant)|founder office|assistant to (?:the )?(?:ceo|founder|cfo|coo|cto|president)|ea to (?:the )?(?:ceo|founder)|chief of staff|office managers?|business operations associates?|assistants?|admins?)\b/i;

/** True when the text mentions an assistant / founder-support / operations role. */
export function isSupportRoleText(s: string | null | undefined): boolean {
  return !!s && SUPPORT_ROLE_RE.test(String(s));
}

export function roleAliases(role: string | null | undefined): string[] {
  const key = (role ?? "").trim().toLowerCase();
  if (!key) return [];
  // Any assistant / founder-support role expands to the full alias set so the
  // jobs actor searches every support-role variant (EA, Chief of Staff, etc.).
  if (SUPPORT_ROLE_RE.test(role ?? "")) return [...SUPPORT_ROLE_ALIASES];
  return ROLE_ALIASES[key] ?? [role!.trim()];
}

export function industrySynonyms(industry: string | null | undefined): string[] {
  const key = (industry ?? "").trim().toLowerCase();
  if (!key) return [];
  return INDUSTRY_SYNONYMS[key] ?? [industry!.trim()];
}

export interface BroadenBase {
  role?: string | null;
  industry?: string | null;
  location?: string | null;
  stage?: string | null;
  category?: string | null;
}

export interface BroadenStep {
  attempt: number;
  strategy: string;
  role_keywords: string[];
  relax_stage: boolean;
  relax_location: boolean;
}

/**
 * Produce the broadening plan for attempt N (1-based):
 *   1: exact (role + industry + location + stage)
 *   2: role aliases + industry synonyms
 *   3: relax stage, then location
 */
export function broadenAttempt(attempt: number, base: BroadenBase): BroadenStep {
  const exactRole = (base.role ?? base.category ?? "").trim();
  if (attempt <= 1) {
    return { attempt: 1, strategy: `Exact search — ${[exactRole, base.industry, base.location, base.stage].filter(Boolean).join(", ") || "given criteria"}`, role_keywords: exactRole ? [exactRole] : [], relax_stage: false, relax_location: false };
  }
  if (attempt === 2) {
    const roles = Array.from(new Set([...roleAliases(base.role), ...industrySynonyms(base.industry)]));
    return { attempt: 2, strategy: `Broadened role aliases${base.industry ? " + industry synonyms" : ""}`, role_keywords: roles.length ? roles : (exactRole ? [exactRole] : []), relax_stage: false, relax_location: false };
  }
  // attempt >= 3
  return {
    attempt,
    strategy: base.stage ? "Relaxed stage filter" : "Relaxed location filter",
    role_keywords: Array.from(new Set([...roleAliases(base.role), ...industrySynonyms(base.industry)])),
    relax_stage: !!base.stage,
    relax_location: !base.stage,
  };
}

/** Competitor-search broadening: exact names → alternatives → category/pain. */
export function broadenCompetitorQueries(attempt: number, competitors: string[], category?: string | null): string[] {
  const names = competitors.filter(Boolean);
  if (attempt <= 1) return names.length ? names : (category ? [category] : []);
  if (attempt === 2) return [...names.map((n) => `${n} alternative`), ...names.map((n) => `${n} vs`)];
  // attempt >= 3 — category + pain/comparison terms
  const cat = category || "AI SDR tools";
  return [cat, `${cat} comparison`, `best ${cat}`, `switching from ${names[0] ?? cat}`].filter(Boolean);
}

/** Dedupe lead/result keys across attempts (by id or normalized name). */
export function dedupeByKey<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = (key(it) ?? "").trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}
