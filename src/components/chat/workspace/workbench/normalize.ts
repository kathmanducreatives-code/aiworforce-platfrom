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

export interface ApifyPeopleItem {
  full_name?: string;
  headline?: string;
  title?: string;
  location?: string;
  company?: string;
  profile_url?: string;
  summary?: string;
  source?: string;
  raw: any;
}

export function isPeopleOutput(output: any): boolean {
  if (!output) return false;
  if (output.normalized_source_type === 'people_profiles') return true;
  if (output.actor_output_type === 'people_profiles') return true;
  const list = Array.isArray(output.items) ? output.items : [];
  if (list.length === 0) return false;
  const first = list[0];
  return !!(first && (first.signal_type === 'people_profile' || first.profile_url || first.full_name));
}

export function normalizeApifyPeople(output: any): ApifyPeopleItem[] {
  if (!output) return [];
  const list = Array.isArray(output.items) ? output.items : [];
  return list.map((it: any) => ({
    full_name:   it.full_name ?? it.fullName ?? it.name ?? undefined,
    headline:    it.headline ?? undefined,
    title:       it.title ?? it.currentJobTitle ?? it.jobTitle ?? undefined,
    location:    it.location ?? it.geoLocation ?? undefined,
    company:     it.company ?? it.currentCompany ?? it.companyName ?? undefined,
    profile_url: it.profile_url ?? it.profileUrl ?? it.linkedinUrl ?? it.url ?? undefined,
    summary:     it.summary ?? it.about ?? undefined,
    source:      it.source ?? 'apify',
    raw:         it,
  }));
}



// Phase 3 — LinkedIn engagement results.
export interface LinkedinEngagementItem {
  post_url?: string;
  post_text?: string;
  post_author_name?: string;
  post_author_title?: string;
  post_author_company?: string;
  post_author_profile_url?: string;
  commenter_name?: string;
  commenter_profile_url?: string;
  engagement_type?: string;
  topic?: string;
  signal_reason?: string;
  raw: any;
}

export function isLinkedinEngagementOutput(output: any): boolean {
  if (!output) return false;
  if (output.normalized_source_type === 'linkedin_engagement') return true;
  if (output.actor_output_type === 'linkedin_posts') return true;
  if (output.selected_actor_key === 'apify_linkedin_posts' || output.actor_key === 'apify_linkedin_posts') return true;
  const list = Array.isArray(output.items) ? output.items : [];
  return list.length > 0 && list[0]?.type === 'linkedin_engagement';
}

export function normalizeLinkedinEngagement(output: any): LinkedinEngagementItem[] {
  if (!output) return [];
  const list = Array.isArray(output.items) ? output.items : [];
  return list.map((it: any) => ({
    post_url: it.post_url ?? it.postUrl ?? it.url ?? undefined,
    post_text: it.post_text ?? it.text ?? it.content ?? undefined,
    post_author_name: it.post_author_name ?? it.authorName ?? undefined,
    post_author_title: it.post_author_title ?? it.authorTitle ?? it.headline ?? undefined,
    post_author_company: it.post_author_company ?? it.company ?? undefined,
    post_author_profile_url: it.post_author_profile_url ?? it.profileUrl ?? undefined,
    commenter_name: it.commenter_name ?? undefined,
    commenter_profile_url: it.commenter_profile_url ?? undefined,
    engagement_type: it.engagement_type ?? undefined,
    topic: it.topic ?? undefined,
    signal_reason: it.signal_reason ?? undefined,
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
