// Workflow Center registry — UI-facing playbooks the user can run from /workflows.
// Each workflow knows its agent sequence, structured fields, expected output, and
// which tool capabilities must be available to actually run. When a required
// capability is missing we surface "Setup Needed" instead of dispatching a broken run.

import type { ToolKey, ToolAvailabilityMap } from './tools';

export type WorkflowCategory =
  | 'growth'
  | 'research'
  | 'outreach'
  | 'content'
  | 'competitor'
  | 'operations';

export type AgentId = 'pilot' | 'scout' | 'aria' | 'hawk' | 'penn' | 'scribe';

export type WorkflowOutput =
  | 'lead_table'
  | 'contact_table'
  | 'enrichment_table'
  | 'draft_list'
  | 'content_doc'
  | 'audit_report'
  | 'briefing';

export type WorkflowStatus = 'ready' | 'setup_needed' | 'coming_soon';

export type WorkflowFieldType = 'text' | 'textarea' | 'select' | 'number' | 'multiselect';

export interface WorkflowField {
  id: string;
  label: string;
  type: WorkflowFieldType;
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  defaultValue?: string | number | string[];
  help?: string;
}

export interface WorkflowDefinition {
  id: string;
  title: string;
  category: WorkflowCategory;
  description: string;
  primaryAgent: AgentId;
  agents: AgentId[];
  outputType: WorkflowOutput;
  estimatedCredits: string;
  status: WorkflowStatus; // default declared status
  fields: WorkflowField[];
  /** Capabilities that must be configured/enabled to run. */
  requiredCapabilities?: ToolKey[];
  /** Safety note shown in the config panel. */
  safety: string;
  /** Build the natural-language prompt sent through pilotChat. */
  buildPrompt: (values: Record<string, string | number | string[]>) => string;
  /** Optional structured metadata sent with the chat request. */
  buildMetadata?: (values: Record<string, string | number | string[]>) => Record<string, unknown>;
  /** Marks recommended for empty/new workspaces. */
  recommended?: boolean;
}

const COUNT_OPTIONS = [
  { value: '5', label: '5' },
  { value: '10', label: '10' },
  { value: '25', label: '25' },
];

export const WORKFLOWS: WorkflowDefinition[] = [
  // ─────────── Growth ───────────
  {
    id: 'find_hiring_signal_accounts',
    title: 'Find hiring-signal accounts',
    category: 'growth',
    description: 'Lyra finds companies hiring roles that signal growth or pain. Atlas ranks accepted accounts.',
    primaryAgent: 'scout',
    agents: ['scout', 'aria'],
    outputType: 'lead_table',
    estimatedCredits: '~5 credits',
    status: 'ready',
    requiredCapabilities: ['apify_jobs'],
    safety: 'Nothing will be sent. Results open in Workbench.',
    recommended: true,
    fields: [
      { id: 'role', label: 'Role type', type: 'select', required: true, defaultValue: 'GTM',
        options: ['GTM', 'SDR', 'Growth', 'Marketing', 'Sales'].map((v) => ({ value: v, label: v })) },
      { id: 'industry', label: 'Industry', type: 'text', defaultValue: 'B2B SaaS', placeholder: 'B2B SaaS' },
      { id: 'location', label: 'Location', type: 'text', defaultValue: 'USA', placeholder: 'USA' },
      { id: 'stage', label: 'Company stage / size', type: 'select', defaultValue: 'early-stage 1–50',
        options: [
          { value: 'early-stage 1–50', label: 'Early-stage (1–50)' },
          { value: 'growth 51–250', label: 'Growth (51–250)' },
          { value: 'mid-market 251–1000', label: 'Mid-market (251–1000)' },
        ] },
      { id: 'count', label: 'Count', type: 'select', defaultValue: '5', options: COUNT_OPTIONS },
      { id: 'strictness', label: 'Strictness', type: 'select', defaultValue: 'flexible',
        options: [{ value: 'flexible', label: 'Flexible' }, { value: 'strict', label: 'Strict' }] },
    ],
    buildPrompt: (v) =>
      `Find ${v.count} companies hiring ${v.role} roles in ${v.industry} in ${v.location} (${v.stage}). Match strictness: ${v.strictness}.`,
    buildMetadata: (v) => ({ workflow_id: 'find_hiring_signal_accounts', workflow_inputs: v }),
  },
  {
    id: 'find_icp_accounts',
    title: 'Find ICP-matching accounts',
    category: 'growth',
    description: 'Find companies matching your ICP, category, persona, and location.',
    primaryAgent: 'scout',
    agents: ['scout', 'aria'],
    outputType: 'lead_table',
    estimatedCredits: '~5 credits',
    status: 'ready',
    // ICP/account search runs through the Apify jobs/account route (no Firecrawl
    // required to produce account opportunities). Firecrawl enrichment is an
    // optional downstream step, not a hard gate — READY when the jobs route is.
    requiredCapabilities: ['apify_jobs'],
    safety: 'Nothing will be sent. Results open in Workbench.',
    recommended: true,
    fields: [
      { id: 'category', label: 'Target category', type: 'text', required: true, placeholder: 'Recruiting agencies' },
      { id: 'persona', label: 'Target persona', type: 'text', required: true, placeholder: 'Founder, CEO' },
      { id: 'industry', label: 'Industry', type: 'text', defaultValue: 'B2B' },
      { id: 'location', label: 'Location', type: 'text', defaultValue: 'USA' },
      { id: 'size', label: 'Company size', type: 'text', defaultValue: '1–50' },
      { id: 'count', label: 'Count', type: 'select', defaultValue: '5', options: COUNT_OPTIONS },
    ],
    buildPrompt: (v) =>
      `Find ${v.count} ${v.category} companies matching our ICP — persona: ${v.persona}, industry: ${v.industry}, location: ${v.location}, size: ${v.size}. Use ICP search, not hiring signals.`,
    buildMetadata: (v) => ({ workflow_id: 'find_icp_accounts', workflow_inputs: v, force_source: 'icp_company_search' }),
  },
  {
    id: 'find_decision_makers',
    title: 'Find decision-makers',
    category: 'growth',
    description: 'Lyra finds the right people at selected account opportunities.',
    primaryAgent: 'scout',
    agents: ['scout'],
    outputType: 'contact_table',
    estimatedCredits: '~3 credits',
    status: 'ready',
    requiredCapabilities: ['apify_people'],
    safety: 'Nothing will be sent. Contacts appear in Workbench.',
    fields: [
      { id: 'source', label: 'Account source', type: 'select', defaultValue: 'workbench',
        options: [
          { value: 'workbench', label: 'Current Workbench accounts' },
          { value: 'saved', label: 'Saved list' },
        ] },
      { id: 'persona', label: 'Persona', type: 'select', defaultValue: 'Founder',
        options: ['Founder', 'CEO', 'Owner', 'VP Sales', 'Head of Growth', 'Head of People']
          .map((v) => ({ value: v, label: v })) },
      { id: 'perAccount', label: 'Contacts per account', type: 'number', defaultValue: 1 },
      { id: 'strict', label: 'Strict company match', type: 'select', defaultValue: 'yes',
        options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    ],
    buildPrompt: (v) =>
      `Find ${v.perAccount} ${v.persona} per account from ${v.source === 'workbench' ? 'the current Workbench accounts' : 'my saved list'}. Strict match: ${v.strict}.`,
    buildMetadata: (v) => ({ workflow_id: 'find_decision_makers', workflow_inputs: v }),
  },
  {
    id: 'rank_accounts',
    title: 'Rank accounts by fit',
    category: 'growth',
    description: 'Atlas scores the current account list against your ICP and prioritizes them.',
    primaryAgent: 'aria',
    agents: ['aria'],
    outputType: 'lead_table',
    estimatedCredits: '~2 credits',
    status: 'ready',
    safety: 'Re-ranks existing Workbench results. Nothing sent.',
    fields: [
      { id: 'depth', label: 'Depth', type: 'select', defaultValue: 'standard',
        options: [{ value: 'standard', label: 'Standard' }, { value: 'detailed', label: 'Detailed' }] },
    ],
    buildPrompt: (v) => `Aria, re-rank my current Workbench accounts by ICP fit (${v.depth}).`,
    buildMetadata: (v) => ({ workflow_id: 'rank_accounts', workflow_inputs: v }),
  },
  {
    id: 'export_call_list',
    title: 'Export call list',
    category: 'growth',
    description: 'Build a clean call-ready list from accepted accounts and contacts.',
    primaryAgent: 'pilot',
    agents: ['pilot'],
    outputType: 'contact_table',
    estimatedCredits: '~1 credit',
    status: 'coming_soon',
    safety: 'Export only. Nothing sent.',
    fields: [],
    buildPrompt: () => `Build a call-ready export of my accepted contacts.`,
  },

  // ─────────── Research ───────────
  {
    id: 'enrich_companies',
    title: 'Enrich companies',
    category: 'research',
    description: 'Atlas researches company websites and extracts useful personalization context.',
    primaryAgent: 'hawk',
    agents: ['hawk'],
    outputType: 'enrichment_table',
    estimatedCredits: '~4 credits',
    status: 'ready',
    requiredCapabilities: ['firecrawl'],
    safety: 'Uses existing Workbench accounts. Nothing sent.',
    fields: [
      { id: 'pages', label: 'Pages to research', type: 'select', defaultValue: 'homepage,about',
        options: [
          { value: 'homepage', label: 'Homepage' },
          { value: 'homepage,about', label: 'Homepage + About' },
          { value: 'homepage,about,pricing,careers', label: 'Homepage, About, Pricing, Careers' },
        ] },
      { id: 'depth', label: 'Depth', type: 'select', defaultValue: 'short',
        options: [{ value: 'short', label: 'Short' }, { value: 'detailed', label: 'Detailed' }] },
    ],
    buildPrompt: (v) => `Hawk, enrich my current Workbench accounts. Pages: ${v.pages}. Depth: ${v.depth}.`,
    buildMetadata: (v) => ({ workflow_id: 'enrich_companies', workflow_inputs: v }),
  },
  {
    id: 'research_company',
    title: 'Research a company',
    category: 'research',
    description: 'Deep-dive a single company: positioning, product, hiring signals, and recent news.',
    primaryAgent: 'hawk',
    agents: ['hawk'],
    outputType: 'enrichment_table',
    estimatedCredits: '~3 credits',
    status: 'ready',
    requiredCapabilities: ['firecrawl'],
    safety: 'Read-only research. Nothing sent.',
    fields: [
      { id: 'domain', label: 'Company website', type: 'text', required: true, placeholder: 'company.com' },
      { id: 'focus', label: 'Focus', type: 'select', defaultValue: 'positioning',
        options: [
          { value: 'positioning', label: 'Positioning' },
          { value: 'product', label: 'Product' },
          { value: 'hiring', label: 'Hiring signals' },
          { value: 'news', label: 'Recent news' },
        ] },
    ],
    buildPrompt: (v) => `Hawk, research ${v.domain}. Focus: ${v.focus}.`,
    buildMetadata: (v) => ({ workflow_id: 'research_company', workflow_inputs: v }),
  },
  {
    id: 'website_audit',
    title: 'Website / landing-page audit',
    category: 'research',
    description: 'Atlas researches, scores issues, and summarizes recommendations.',
    primaryAgent: 'hawk',
    agents: ['hawk', 'aria', 'scribe'],
    outputType: 'audit_report',
    estimatedCredits: '~6 credits',
    status: 'ready',
    requiredCapabilities: ['firecrawl'],
    safety: 'Read-only audit. Nothing sent.',
    fields: [
      { id: 'url', label: 'Website URL', type: 'text', required: true, placeholder: 'https://example.com' },
      { id: 'type', label: 'Audit type', type: 'select', defaultValue: 'conversion',
        options: ['conversion', 'positioning', 'onboarding', 'pricing'].map((v) => ({ value: v, label: v })) },
      { id: 'depth', label: 'Depth', type: 'select', defaultValue: 'quick',
        options: [{ value: 'quick', label: 'Quick' }, { value: 'detailed', label: 'Detailed' }] },
    ],
    buildPrompt: (v) => `Audit ${v.url} for ${v.type}. Depth: ${v.depth}. Hawk researches, Aria scores issues, Scribe writes recommendations.`,
    buildMetadata: (v) => ({ workflow_id: 'website_audit', workflow_inputs: v }),
  },
  {
    id: 'competitor_snapshot',
    title: 'Competitor snapshot',
    category: 'research',
    description: 'Quick read on a competitor: positioning, pricing, hiring, recent moves.',
    primaryAgent: 'hawk',
    agents: ['hawk'],
    outputType: 'enrichment_table',
    estimatedCredits: '~3 credits',
    status: 'ready',
    requiredCapabilities: ['firecrawl'],
    safety: 'Read-only. Nothing sent.',
    fields: [
      { id: 'domain', label: 'Competitor website', type: 'text', required: true, placeholder: 'competitor.com' },
    ],
    buildPrompt: (v) => `Hawk, build a competitor snapshot for ${v.domain}.`,
    buildMetadata: (v) => ({ workflow_id: 'competitor_snapshot', workflow_inputs: v }),
  },
  {
    id: 'market_signal_brief',
    title: 'Market signal brief',
    category: 'research',
    description: 'Aggregate recent market and signal activity into a short brief.',
    primaryAgent: 'pilot',
    agents: ['pilot', 'hawk'],
    outputType: 'briefing',
    estimatedCredits: '~3 credits',
    status: 'ready',
    safety: 'Read-only brief. Nothing sent.',
    fields: [
      { id: 'topic', label: 'Topic', type: 'text', required: true, placeholder: 'AI sales tooling' },
    ],
    buildPrompt: (v) => `Build a market signal brief on ${v.topic}.`,
    buildMetadata: (v) => ({ workflow_id: 'market_signal_brief', workflow_inputs: v }),
  },

  // ─────────── Outreach (draft-only) ───────────
  {
    id: 'draft_outreach',
    title: 'Draft personalized outreach',
    category: 'outreach',
    description: 'Mira writes approval-ready personalized drafts. Nothing is sent automatically.',
    primaryAgent: 'penn',
    agents: ['penn'],
    outputType: 'draft_list',
    estimatedCredits: '~4 credits',
    status: 'ready',
    requiredCapabilities: ['resend_draft'],
    safety: 'Draft only. Approval required before anything is sent.',
    fields: [
      { id: 'source', label: 'Contacts source', type: 'select', defaultValue: 'workbench',
        options: [
          { value: 'workbench', label: 'Current contacts' },
          { value: 'saved', label: 'Selected list' },
        ] },
      { id: 'channel', label: 'Channel', type: 'select', defaultValue: 'email',
        options: [
          { value: 'email', label: 'Email' },
          { value: 'linkedin', label: 'LinkedIn' },
          { value: 'cold_call', label: 'Cold-call opener' },
        ] },
      { id: 'tone', label: 'Tone', type: 'select', defaultValue: 'direct',
        options: ['direct', 'warm', 'founder-led'].map((v) => ({ value: v, label: v })) },
      { id: 'goal', label: 'Goal', type: 'select', defaultValue: 'book demo',
        options: [{ value: 'book demo', label: 'Book demo' }, { value: 'start conversation', label: 'Start conversation' }] },
    ],
    buildPrompt: (v) =>
      `Penn, draft ${v.channel} outreach for ${v.source === 'workbench' ? 'my current contacts' : 'my selected list'}. Tone: ${v.tone}. Goal: ${v.goal}. Draft only — do not send.`,
    buildMetadata: (v) => ({ workflow_id: 'draft_outreach', workflow_inputs: v, draft_only: true }),
  },
  {
    id: 'cold_call_openers',
    title: 'Generate cold-call openers',
    category: 'outreach',
    description: 'Mira writes 3 cold-call openers per contact, ready for review.',
    primaryAgent: 'penn',
    agents: ['penn'],
    outputType: 'draft_list',
    estimatedCredits: '~2 credits',
    status: 'ready',
    safety: 'Draft only.',
    fields: [
      { id: 'tone', label: 'Tone', type: 'select', defaultValue: 'direct',
        options: ['direct', 'warm', 'founder-led'].map((v) => ({ value: v, label: v })) },
    ],
    buildPrompt: (v) => `Penn, generate cold-call openers for my current contacts. Tone: ${v.tone}.`,
    buildMetadata: (v) => ({ workflow_id: 'cold_call_openers', workflow_inputs: v, draft_only: true }),
  },
  {
    id: 'followup_messages',
    title: 'Create follow-up messages',
    category: 'outreach',
    description: 'Mira writes step-2 / step-3 follow-ups based on the original draft.',
    primaryAgent: 'penn',
    agents: ['penn'],
    outputType: 'draft_list',
    estimatedCredits: '~2 credits',
    status: 'ready',
    safety: 'Draft only.',
    fields: [
      { id: 'step', label: 'Follow-up step', type: 'select', defaultValue: '2',
        options: [{ value: '2', label: 'Step 2' }, { value: '3', label: 'Step 3' }] },
    ],
    buildPrompt: (v) => `Penn, write follow-up step ${v.step} messages for my current sequence.`,
    buildMetadata: (v) => ({ workflow_id: 'followup_messages', workflow_inputs: v, draft_only: true }),
  },
  {
    id: 'objection_handling',
    title: 'Build objection-handling notes',
    category: 'outreach',
    description: 'Mira writes short objection-handling notes for the rep to use live.',
    primaryAgent: 'penn',
    agents: ['penn'],
    outputType: 'draft_list',
    estimatedCredits: '~2 credits',
    status: 'coming_soon',
    safety: 'Internal notes only.',
    fields: [],
    buildPrompt: () => `Penn, build objection-handling notes for our offer.`,
  },

  // ─────────── Content ───────────
  {
    id: 'linkedin_post_from_signals',
    title: 'Create LinkedIn post from signals',
    category: 'content',
    description: 'Agentory turns market or lead signals into a founder-style LinkedIn post.',
    primaryAgent: 'scribe',
    agents: ['scribe'],
    outputType: 'content_doc',
    estimatedCredits: '~2 credits',
    status: 'ready',
    safety: 'Draft only. Nothing is published automatically.',
    recommended: true,
    fields: [
      { id: 'topic', label: 'Topic / signal', type: 'text', placeholder: 'Use current Workbench signals' },
      { id: 'style', label: 'Style', type: 'select', defaultValue: 'founder story',
        options: ['founder story', 'tactical insight', 'contrarian', 'build-in-public'].map((v) => ({ value: v, label: v })) },
      { id: 'length', label: 'Length', type: 'select', defaultValue: 'short',
        options: [{ value: 'short', label: 'Short' }, { value: 'medium', label: 'Medium' }] },
    ],
    buildPrompt: (v) => `Scribe, write a ${v.length} LinkedIn post in ${v.style} style${v.topic ? ` about ${v.topic}` : ' from my current Workbench signals'}.`,
    buildMetadata: (v) => ({ workflow_id: 'linkedin_post_from_signals', workflow_inputs: v }),
  },
  {
    id: 'content_ideas',
    title: 'Generate content ideas',
    category: 'content',
    description: 'Agentory brainstorms 10 content angles aligned to your positioning.',
    primaryAgent: 'scribe',
    agents: ['scribe'],
    outputType: 'content_doc',
    estimatedCredits: '~1 credit',
    status: 'ready',
    safety: 'Ideas only. Nothing published.',
    fields: [
      { id: 'angle', label: 'Angle', type: 'text', placeholder: 'Founder-led GTM, AI agents…' },
    ],
    buildPrompt: (v) => `Scribe, generate 10 content ideas${v.angle ? ` around ${v.angle}` : ''}.`,
    buildMetadata: (v) => ({ workflow_id: 'content_ideas', workflow_inputs: v }),
  },
  {
    id: 'founder_weekly_update',
    title: 'Write weekly founder update',
    category: 'content',
    description: 'Agentory drafts a founder-style weekly update from workforce activity.',
    primaryAgent: 'scribe',
    agents: ['scribe'],
    outputType: 'content_doc',
    estimatedCredits: '~2 credits',
    status: 'ready',
    safety: 'Internal draft. Nothing sent.',
    fields: [
      { id: 'tone', label: 'Tone', type: 'select', defaultValue: 'transparent',
        options: ['transparent', 'celebratory', 'analytical'].map((v) => ({ value: v, label: v })) },
    ],
    buildPrompt: (v) => `Scribe, write this week's founder update in a ${v.tone} tone.`,
    buildMetadata: (v) => ({ workflow_id: 'founder_weekly_update', workflow_inputs: v }),
  },
  {
    id: 'competitor_signal_post',
    title: 'Turn competitor signals into content',
    category: 'content',
    description: 'Agentory converts competitor moves into a sharp positioning post.',
    primaryAgent: 'scribe',
    agents: ['hawk', 'scribe'],
    outputType: 'content_doc',
    estimatedCredits: '~2 credits',
    status: 'ready',
    safety: 'Draft only.',
    fields: [
      { id: 'competitor', label: 'Competitor', type: 'text', placeholder: 'competitor.com' },
    ],
    buildPrompt: (v) => `Hawk surfaces recent moves by ${v.competitor || 'tracked competitors'}, Scribe turns them into a positioning post.`,
    buildMetadata: (v) => ({ workflow_id: 'competitor_signal_post', workflow_inputs: v }),
  },

  // ─────────── Competitor ───────────
  {
    id: 'competitor_engagement',
    title: 'Find competitor engagement',
    category: 'competitor',
    description: 'Surface engaged commenters on competitor posts.',
    primaryAgent: 'hawk',
    agents: ['hawk'],
    outputType: 'contact_table',
    estimatedCredits: '~3 credits',
    status: 'setup_needed',
    requiredCapabilities: ['apify_comments'],
    safety: 'Read-only. Nothing sent.',
    fields: [
      { id: 'post_url', label: 'Post URL', type: 'text', required: true, placeholder: 'https://www.linkedin.com/posts/…' },
    ],
    buildPrompt: (v) => `Hawk, surface engaged commenters on ${v.post_url}.`,
    buildMetadata: (v) => ({ workflow_id: 'competitor_engagement', workflow_inputs: v }),
  },
  {
    id: 'competitor_website_analysis',
    title: 'Analyze competitor website',
    category: 'competitor',
    description: 'Atlas audits a competitor site for positioning and ICP cues.',
    primaryAgent: 'hawk',
    agents: ['hawk', 'aria'],
    outputType: 'audit_report',
    estimatedCredits: '~4 credits',
    status: 'ready',
    requiredCapabilities: ['firecrawl'],
    safety: 'Read-only.',
    fields: [
      { id: 'domain', label: 'Competitor website', type: 'text', required: true, placeholder: 'competitor.com' },
    ],
    buildPrompt: (v) => `Hawk, analyze ${v.domain} for positioning and ICP cues. Aria prioritizes findings.`,
    buildMetadata: (v) => ({ workflow_id: 'competitor_website_analysis', workflow_inputs: v }),
  },
  {
    id: 'competitor_changes',
    title: 'Track pricing / message changes',
    category: 'competitor',
    description: 'Detect changes in competitor pricing or homepage messaging.',
    primaryAgent: 'hawk',
    agents: ['hawk'],
    outputType: 'briefing',
    estimatedCredits: '~2 credits',
    status: 'coming_soon',
    safety: 'Read-only.',
    fields: [],
    buildPrompt: () => `Hawk, summarize recent competitor pricing and messaging changes.`,
  },
  {
    id: 'comparison_angle',
    title: 'Build comparison angle',
    category: 'competitor',
    description: 'Agentory builds a "vs. competitor" angle from research.',
    primaryAgent: 'scribe',
    agents: ['hawk', 'scribe'],
    outputType: 'content_doc',
    estimatedCredits: '~2 credits',
    status: 'ready',
    safety: 'Draft only.',
    fields: [
      { id: 'competitor', label: 'Competitor', type: 'text', required: true, placeholder: 'competitor.com' },
    ],
    buildPrompt: (v) => `Build a comparison angle vs ${v.competitor}.`,
    buildMetadata: (v) => ({ workflow_id: 'comparison_angle', workflow_inputs: v }),
  },

  // ─────────── Operations ───────────
  {
    id: 'daily_workforce_briefing',
    title: 'Daily workforce briefing',
    category: 'operations',
    description: 'Pilot summarizes what your AI workforce found, drafted, blocked, and needs approval on.',
    primaryAgent: 'pilot',
    agents: ['pilot'],
    outputType: 'briefing',
    estimatedCredits: '~1 credit',
    status: 'ready',
    safety: 'Summary only. Nothing sent.',
    recommended: true,
    fields: [
      { id: 'range', label: 'Time range', type: 'select', defaultValue: 'today',
        options: [
          { value: 'today', label: 'Today' },
          { value: 'yesterday', label: 'Yesterday' },
          { value: 'this week', label: 'This week' },
        ] },
    ],
    buildPrompt: (v) => `Pilot, give me the workforce briefing for ${v.range}. Include signals, drafts, approvals, and recent workflow runs.`,
    buildMetadata: (v) => ({ workflow_id: 'daily_workforce_briefing', workflow_inputs: v }),
  },
  {
    id: 'review_approvals',
    title: 'Review approvals',
    category: 'operations',
    description: 'Pilot lists items awaiting your approval and recommends next actions.',
    primaryAgent: 'pilot',
    agents: ['pilot'],
    outputType: 'briefing',
    estimatedCredits: '~1 credit',
    status: 'ready',
    safety: 'Read-only.',
    fields: [],
    buildPrompt: () => `Pilot, list everything currently awaiting my approval and recommend next actions.`,
    buildMetadata: () => ({ workflow_id: 'review_approvals' }),
  },
  {
    id: 'summarize_pending_work',
    title: 'Summarize pending work',
    category: 'operations',
    description: 'Quick summary of running, blocked, and stalled tasks.',
    primaryAgent: 'pilot',
    agents: ['pilot'],
    outputType: 'briefing',
    estimatedCredits: '~1 credit',
    status: 'ready',
    safety: 'Read-only.',
    fields: [],
    buildPrompt: () => `Pilot, summarize all pending and blocked work across the workforce.`,
    buildMetadata: () => ({ workflow_id: 'summarize_pending_work' }),
  },
  {
    id: 'weekly_report',
    title: 'Generate weekly report',
    category: 'operations',
    description: 'Agentory writes the weekly performance report from workforce activity.',
    primaryAgent: 'scribe',
    agents: ['pilot', 'scribe'],
    outputType: 'content_doc',
    estimatedCredits: '~2 credits',
    status: 'ready',
    safety: 'Internal report. Nothing sent.',
    fields: [],
    buildPrompt: () => `Scribe, write this week's workforce performance report.`,
    buildMetadata: () => ({ workflow_id: 'weekly_report' }),
  },
];

export const CATEGORY_LABEL: Record<WorkflowCategory, string> = {
  growth: 'Growth',
  research: 'Research',
  outreach: 'Outreach',
  content: 'Content',
  competitor: 'Competitor',
  operations: 'Operations',
};

export const CATEGORY_ORDER: WorkflowCategory[] = [
  'growth', 'research', 'outreach', 'content', 'competitor', 'operations',
];

export function resolveStatus(def: WorkflowDefinition, tools: ToolAvailabilityMap): WorkflowStatus {
  if (def.status === 'coming_soon') return 'coming_soon';
  if (def.requiredCapabilities?.length) {
    const missing = def.requiredCapabilities.some((k) => {
      const t = tools[k];
      return !t || !t.enabled || !t.configured;
    });
    if (missing) return 'setup_needed';
  }
  return 'ready';
}

export function missingCapabilities(def: WorkflowDefinition, tools: ToolAvailabilityMap): string[] {
  if (!def.requiredCapabilities) return [];
  return def.requiredCapabilities
    .filter((k) => {
      const t = tools[k];
      return !t || !t.enabled || !t.configured;
    });
}
