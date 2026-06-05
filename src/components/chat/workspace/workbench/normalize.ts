// Safe normalization helpers for Workbench rendering.

export interface ApifyJobItem {
  company?: string;
  title?: string;
  location?: string;
  url?: string;
  companyUrl?: string;
  description?: string;
  postedAt?: string;
  source?: string;
  raw: any;
}

export function normalizeApifyItems(output: any): ApifyJobItem[] {
  if (!output) return [];
  const root = output;
  const raw =
    (Array.isArray(root.items) && root.items) ||
    (Array.isArray(root.results) && root.results) ||
    (Array.isArray(root.data) && root.data) ||
    (Array.isArray(root.normalized_items) && root.normalized_items) ||
    [];

  return raw.map((it: any) => ({
    company:
      it.companyName ?? it.company ?? it.company_name ?? it.companyTitle ?? it.organization ?? undefined,
    title: it.title ?? it.jobTitle ?? it.position ?? it.name ?? undefined,
    location:
      it.location ?? it.jobLocation ?? it.formattedLocation ?? it.city ?? it.place ?? undefined,
    url: it.url ?? it.jobUrl ?? it.link ?? it.applyUrl ?? undefined,
    companyUrl: it.companyUrl ?? it.companyLink ?? it.company_website ?? undefined,
    description: it.description ?? it.snippet ?? it.summary ?? undefined,
    postedAt: it.postedAt ?? it.posted_at ?? it.postedTime ?? it.datePosted ?? undefined,
    source: it.source ?? it.platform ?? undefined,
    raw: it,
  }));
}

export interface FirecrawlResult {
  url?: string;
  title?: string;
  markdown?: string;
  summary?: string;
  citations?: string[];
}

export function normalizeFirecrawl(output: any): FirecrawlResult {
  if (!output) return {};
  const d = output.data ?? output;
  return {
    url: d.url ?? d.source_url ?? output.url,
    title: d.title ?? d.metadata?.title ?? d.metadata?.ogTitle,
    markdown: d.markdown ?? d.content ?? d.text,
    summary: d.summary ?? output.summary,
    citations: Array.isArray(d.citations)
      ? d.citations
      : Array.isArray(output.citations)
      ? output.citations
      : undefined,
  };
}

export interface AriaRanking {
  name?: string;
  company?: string;
  score?: number;
  tier?: 'Hot' | 'Warm' | 'Maybe' | 'Ignore' | string;
  fit?: string;
  risk?: string;
  next?: string;
  raw: any;
}

export function normalizeAriaRankings(output: any): AriaRanking[] {
  if (!output) return [];
  const list =
    (Array.isArray(output.rankings) && output.rankings) ||
    (Array.isArray(output.ranked) && output.ranked) ||
    (Array.isArray(output.candidates) && output.candidates) ||
    (Array.isArray(output) && output) ||
    [];
  return list.map((r: any) => ({
    name: r.name ?? r.candidate ?? r.lead ?? r.title,
    company: r.company ?? r.organization,
    score: typeof r.score === 'number' ? r.score : typeof r.fit_score === 'number' ? r.fit_score : undefined,
    tier: r.tier ?? r.classification ?? r.label,
    fit: r.fit ?? r.fit_reason ?? r.why,
    risk: r.risk ?? r.risk_notes ?? r.concerns,
    next: r.next ?? r.next_action ?? r.recommendation,
    raw: r,
  }));
}

export interface PennDraft {
  subject?: string;
  body?: string;
  linkedin?: string;
  personalization?: string;
}

export function normalizePennDrafts(output: any): PennDraft[] {
  if (!output) return [];
  const list =
    (Array.isArray(output.drafts) && output.drafts) ||
    (Array.isArray(output.emails) && output.emails) ||
    (Array.isArray(output) && output) ||
    [output];
  return list
    .filter((d: any) => d && typeof d === 'object')
    .map((d: any) => ({
      subject: d.subject ?? d.title,
      body: d.body ?? d.email ?? d.text ?? d.html,
      linkedin: d.linkedin ?? d.linkedin_note ?? d.dm,
      personalization: d.personalization ?? d.notes,
    }));
}
