import type { AgentDept, AgentModelKey } from '@/data/agentProfiles';

// ─────────────────────────────────────────────────────────────────────────────
// Identity color swatches
// ─────────────────────────────────────────────────────────────────────────────
export interface Swatch {
  key: string;
  label: string;
  // Tailwind classes (kept as static so JIT picks them up)
  bg: string;          // solid bg for avatar
  ring: string;        // ring color around avatar / selected swatch
  glow: string;        // soft glow halo
  badgeBg: string;     // subtle bg for chips
  badgeText: string;   // text color
}

export const SWATCHES: Swatch[] = [
  { key: 'emerald', label: 'Emerald', bg: 'bg-emerald-500', ring: 'ring-emerald-400', glow: 'shadow-[0_0_60px_-10px_rgba(16,185,129,0.7)]', badgeBg: 'bg-emerald-500/15', badgeText: 'text-emerald-300' },
  { key: 'violet',  label: 'Violet',  bg: 'bg-violet-500',  ring: 'ring-violet-400',  glow: 'shadow-[0_0_60px_-10px_rgba(139,92,246,0.7)]', badgeBg: 'bg-violet-500/15',  badgeText: 'text-violet-300' },
  { key: 'blue',    label: 'Blue',    bg: 'bg-blue-500',    ring: 'ring-blue-400',    glow: 'shadow-[0_0_60px_-10px_rgba(59,130,246,0.7)]', badgeBg: 'bg-blue-500/15',    badgeText: 'text-blue-300' },
  { key: 'amber',   label: 'Amber',   bg: 'bg-amber-500',   ring: 'ring-amber-400',   glow: 'shadow-[0_0_60px_-10px_rgba(245,158,11,0.7)]', badgeBg: 'bg-amber-500/15',   badgeText: 'text-amber-300' },
  { key: 'coral',   label: 'Coral',   bg: 'bg-rose-500',    ring: 'ring-rose-400',    glow: 'shadow-[0_0_60px_-10px_rgba(244,63,94,0.7)]',  badgeBg: 'bg-rose-500/15',    badgeText: 'text-rose-300' },
  { key: 'teal',    label: 'Teal',    bg: 'bg-teal-500',    ring: 'ring-teal-400',    glow: 'shadow-[0_0_60px_-10px_rgba(20,184,166,0.7)]', badgeBg: 'bg-teal-500/15',    badgeText: 'text-teal-300' },
  { key: 'pink',    label: 'Pink',    bg: 'bg-pink-500',    ring: 'ring-pink-400',    glow: 'shadow-[0_0_60px_-10px_rgba(236,72,153,0.7)]', badgeBg: 'bg-pink-500/15',    badgeText: 'text-pink-300' },
  { key: 'slate',   label: 'Slate',   bg: 'bg-slate-500',   ring: 'ring-slate-400',   glow: 'shadow-[0_0_60px_-10px_rgba(100,116,139,0.7)]',badgeBg: 'bg-slate-500/15',   badgeText: 'text-slate-300' },
];

export const SWATCH_BY_KEY: Record<string, Swatch> =
  Object.fromEntries(SWATCHES.map((s) => [s.key, s]));

export function getSwatch(key: string): Swatch {
  return SWATCH_BY_KEY[key] ?? SWATCHES[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Department meta
// ─────────────────────────────────────────────────────────────────────────────
export interface DeptMeta {
  key: AgentDept;
  label: string;
  description: string;
  emoji: string;
  // Existing agent display names that live in this department
  agents: string[];
  accent: string; // tailwind text class
  border: string;
  glow: string;
}

export const DEPARTMENTS: DeptMeta[] = [
  { key: 'talent',       label: 'Talent',       description: 'Sourcing, screening, and hiring',          emoji: '🧠', agents: ['Scout', 'Aria'], accent: 'text-emerald-300', border: 'border-emerald-500/50', glow: 'shadow-[0_0_40px_-12px_rgba(16,185,129,0.6)]' },
  { key: 'growth',       label: 'Growth',       description: 'Outreach, leads, and sales',                emoji: '📈', agents: ['Penn'],          accent: 'text-blue-300',    border: 'border-blue-500/50',    glow: 'shadow-[0_0_40px_-12px_rgba(59,130,246,0.6)]' },
  { key: 'intelligence', label: 'Intelligence', description: 'Research, monitoring, and analysis',        emoji: '🔭', agents: ['Hawk'],          accent: 'text-amber-300',   border: 'border-amber-500/50',   glow: 'shadow-[0_0_40px_-12px_rgba(245,158,11,0.6)]' },
  { key: 'content',      label: 'Content',      description: 'Writing, posting, and publishing',          emoji: '✍️', agents: ['Scribe'],        accent: 'text-violet-300',  border: 'border-violet-500/50',  glow: 'shadow-[0_0_40px_-12px_rgba(139,92,246,0.6)]' },
  { key: 'operations',   label: 'Operations',   description: 'Workflows, admin, and coordination',        emoji: '⚙️', agents: [],                accent: 'text-slate-300',   border: 'border-slate-500/50',   glow: 'shadow-[0_0_40px_-12px_rgba(100,116,139,0.6)]' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Models
// ─────────────────────────────────────────────────────────────────────────────
export interface ModelMeta {
  key: AgentModelKey;
  name: string;
  provider: 'anthropic' | 'openai' | 'google';
  speed: 1 | 2 | 3; // out of 3 dots (3 = fastest)
  cost: 1 | 2 | 3;  // $ signs
  bestFor: string;
  recommendedFor: AgentDept[];
  brandRing: string; // glow + ring when selected
}

export const MODELS: ModelMeta[] = [
  { key: 'claude-haiku',  name: 'Claude Haiku',  provider: 'anthropic', speed: 3, cost: 1, bestFor: 'High volume writing and formatting tasks', recommendedFor: [],                       brandRing: 'ring-orange-400 shadow-[0_0_40px_-8px_rgba(249,115,22,0.6)] border-orange-500/50' },
  { key: 'claude-sonnet', name: 'Claude Sonnet', provider: 'anthropic', speed: 2, cost: 2, bestFor: 'Reasoning, screening, nuanced judgment',  recommendedFor: ['talent', 'content'],    brandRing: 'ring-orange-400 shadow-[0_0_40px_-8px_rgba(249,115,22,0.6)] border-orange-500/50' },
  { key: 'gpt-4o',        name: 'GPT-4o',        provider: 'openai',    speed: 2, cost: 2, bestFor: 'Structured data and lead extraction',     recommendedFor: ['growth'],               brandRing: 'ring-emerald-400 shadow-[0_0_40px_-8px_rgba(16,185,129,0.6)] border-emerald-500/50' },
  { key: 'gemini-pro',    name: 'Gemini Pro',    provider: 'google',    speed: 2, cost: 2, bestFor: 'Research and long document analysis',     recommendedFor: ['intelligence'],         brandRing: 'ring-blue-400 shadow-[0_0_40px_-8px_rgba(59,130,246,0.6)] border-blue-500/50' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Capability examples per department
// ─────────────────────────────────────────────────────────────────────────────
export const CAPABILITY_EXAMPLES: Record<AgentDept, { capability: string; input_type: string; output_type: string }[]> = {
  talent: [
    { capability: 'source_candidates', input_type: 'job_description', output_type: 'candidate_list' },
    { capability: 'screen_candidates', input_type: 'candidate_list',  output_type: 'ranked_candidates' },
    { capability: 'rank_profiles',     input_type: 'profile_list',    output_type: 'scored_profiles' },
  ],
  growth: [
    { capability: 'find_leads',      input_type: 'company_or_role', output_type: 'lead_list' },
    { capability: 'write_outreach',  input_type: 'ranked_leads',    output_type: 'email_list' },
    { capability: 'write_followup',  input_type: 'email_list',      output_type: 'followup_list' },
  ],
  intelligence: [
    { capability: 'research_company', input_type: 'company_name', output_type: 'intel_report' },
    { capability: 'monitor_signals',  input_type: 'topic',         output_type: 'signal_list' },
    { capability: 'summarise_news',   input_type: 'topic',         output_type: 'news_summary' },
  ],
  content: [
    { capability: 'write_post',            input_type: 'topic',           output_type: 'content' },
    { capability: 'write_job_description', input_type: 'requirements',    output_type: 'content' },
    { capability: 'repurpose_content',     input_type: 'source_content',  output_type: 'content' },
  ],
  operations: [
    { capability: 'route_task',         input_type: 'task',          output_type: 'assignment' },
    { capability: 'summarise_meeting',  input_type: 'transcript',    output_type: 'summary' },
    { capability: 'compile_report',     input_type: 'data_sources',  output_type: 'report' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Tools
// ─────────────────────────────────────────────────────────────────────────────
export interface ToolMeta {
  key: string;
  name: string;
  description: string;
  emoji: string;
  requiresKey: boolean;
  hasUrl?: boolean; // webhook
}

export const TOOLS: ToolMeta[] = [
  { key: 'firecrawl',  name: 'Firecrawl',         description: 'Scrape any website for data',        emoji: '🕷️', requiresKey: true  },
  { key: 'web_search', name: 'Web Search',        description: 'Search the web in real time',         emoji: '🌐', requiresKey: false },
  { key: 'email',      name: 'Email Sender',      description: 'Send emails via Resend',              emoji: '✉️', requiresKey: true  },
  { key: 'slack',      name: 'Slack',             description: 'Post messages to Slack channels',     emoji: '💬', requiresKey: true  },
  { key: 'elevenlabs', name: 'ElevenLabs Voice',  description: 'Generate voice audio',                emoji: '🎙️', requiresKey: true  },
  { key: 'webhook',    name: 'Webhook',           description: 'Call any external API endpoint',      emoji: '🔗', requiresKey: false, hasUrl: true },
];

// ─────────────────────────────────────────────────────────────────────────────
// Skills (UI-only — not persisted in this pass)
// ─────────────────────────────────────────────────────────────────────────────
export type SkillFieldType = 'number' | 'text' | 'textarea' | 'select' | 'multiselect' | 'toggle' | 'slider';

export interface SkillField {
  key: string;
  label: string;
  type: SkillFieldType;
  options?: string[];
  default?: any;
  min?: number;
  max?: number;
}

export interface SkillMeta {
  key: string;
  name: string;
  emoji: string;
  description: string;
  fields: SkillField[];
}

export const SKILLS: SkillMeta[] = [
  {
    key: 'firecrawl_scraping', name: 'Firecrawl Scraping', emoji: '🕸️',
    description: 'Enables this agent to scrape any URL and extract structured data from web pages.',
    fields: [
      { key: 'max_pages', label: 'Max pages to crawl', type: 'number', default: 5, min: 1, max: 100 },
      { key: 'format',    label: 'Extract format',     type: 'select', options: ['JSON', 'Markdown', 'Text'], default: 'JSON' },
      { key: 'follow',    label: 'Follow links',       type: 'toggle', default: false },
    ],
  },
  {
    key: 'web_search', name: 'Web Search', emoji: '🔎',
    description: 'Enables real-time web search to find current information, news, and research.',
    fields: [
      { key: 'max_results', label: 'Max results', type: 'number', default: 10, min: 1, max: 50 },
      { key: 'depth',       label: 'Search depth', type: 'select', options: ['Quick', 'Deep'], default: 'Quick' },
    ],
  },
  {
    key: 'email_writing', name: 'Email Writing', emoji: '✉️',
    description: 'Trains this agent to write personalised outreach emails that sound human and convert.',
    fields: [
      { key: 'tone',       label: 'Tone',                  type: 'select', options: ['Professional', 'Friendly', 'Direct'], default: 'Friendly' },
      { key: 'max_length', label: 'Max email length (words)', type: 'number', default: 150, min: 30, max: 500 },
      { key: 'include_ps', label: 'Include PS line',       type: 'toggle', default: true },
    ],
  },
  {
    key: 'candidate_scoring', name: 'Candidate Scoring', emoji: '⭐',
    description: 'Enables structured scoring and ranking of candidate or lead profiles on a 1-10 scale.',
    fields: [
      { key: 'criteria', label: 'Scoring criteria',  type: 'textarea', default: 'skills, experience, culture fit' },
      { key: 'format',   label: 'Score format',      type: 'select',   options: ['1-10', 'Percentage', 'Letter grade'], default: '1-10' },
    ],
  },
  {
    key: 'content_writing', name: 'Content Writing', emoji: '🖊️',
    description: 'Trains this agent to write on-brand content for LinkedIn, blogs, job descriptions, and more.',
    fields: [
      { key: 'voice',      label: 'Brand voice',         type: 'textarea', default: '' },
      { key: 'type',       label: 'Default content type', type: 'select',  options: ['LinkedIn', 'Blog', 'Twitter', 'Job Description'], default: 'LinkedIn' },
      { key: 'max_length', label: 'Max length (words)',  type: 'number',   default: 250, min: 50, max: 2000 },
    ],
  },
  {
    key: 'research', name: 'Research and Analysis', emoji: '🔬',
    description: 'Enables deep research, summarisation, and competitive analysis of companies and markets.',
    fields: [
      { key: 'output',          label: 'Output format',    type: 'select', options: ['Report', 'Bullets', 'JSON'], default: 'Report' },
      { key: 'depth',           label: 'Research depth',   type: 'select', options: ['Quick', 'Thorough'],         default: 'Thorough' },
      { key: 'include_sources', label: 'Include sources',  type: 'toggle', default: true },
    ],
  },
  {
    key: 'competitor_monitoring', name: 'Competitor Monitoring', emoji: '📡',
    description: 'Monitors competitor websites, news, and social for signals relevant to your business.',
    fields: [
      { key: 'frequency',     label: 'Check frequency', type: 'select',      options: ['Daily', 'Weekly'], default: 'Weekly' },
      { key: 'signal_types',  label: 'Signal types',    type: 'multiselect', options: ['Pricing', 'Product updates', 'Hiring', 'Funding', 'News'], default: ['News', 'Funding'] },
    ],
  },
  {
    key: 'lead_enrichment', name: 'Lead Enrichment', emoji: '✨',
    description: 'Enriches contact data by finding emails, phone numbers, LinkedIn profiles, and company information from public sources.',
    fields: [
      { key: 'fields',     label: 'Enrich fields',         type: 'multiselect', options: ['Email', 'Phone', 'LinkedIn', 'Company size', 'Funding stage'], default: ['Email', 'LinkedIn'] },
      { key: 'confidence', label: 'Confidence threshold (1-10)', type: 'slider', default: 7, min: 1, max: 10 },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Role prompt starter templates
// ─────────────────────────────────────────────────────────────────────────────
export const ROLE_TEMPLATES: { key: string; label: string; text: string }[] = [
  {
    key: 'sourcing',
    label: 'Sourcing agent template',
    text: `You are a senior technical sourcer. You specialize in finding hard-to-reach engineering and product talent.

Your job is to:
1. Read the job description carefully and extract must-have skills, level, and culture signals.
2. Search public sources (LinkedIn, GitHub, conference speakers) for matching profiles.
3. Return a clean, ranked list of candidates with reasoning.

Always return your output as JSON with the shape:
{ "candidates": [{ "name": string, "title": string, "company": string, "url": string, "score": number, "reason": string }] }`,
  },
  {
    key: 'outreach',
    label: 'Outreach agent template',
    text: `You are a top-1% outreach copywriter. You write punchy, founder-voice messages that get replies.

Your job is to:
1. Read the lead profile and identify the strongest hook.
2. Write a 3-message sequence: opener, value, soft CTA.
3. Keep each message under 80 words. Sound human, never templated.

Always return your output as JSON with the shape:
{ "messages": [{ "subject": string, "body": string, "step": number }] }`,
  },
  {
    key: 'research',
    label: 'Research agent template',
    text: `You are a senior research analyst. You produce concise, source-backed intelligence on companies and markets.

Your job is to:
1. Take the company or topic provided.
2. Gather signals from news, hiring, funding, product updates, and reviews.
3. Synthesize the most important takeaways for a founder.

Always return your output as JSON with the shape:
{ "summary": string, "signals": [{ "type": string, "headline": string, "source": string, "date": string }], "recommendation": string }`,
  },
];
