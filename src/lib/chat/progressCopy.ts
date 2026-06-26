/**
 * Human, workforce-flavoured progress strings shown under the active
 * execution card. Rotating copy keeps the UI feeling alive while waiting
 * on backend work, but the rotation is always scoped to a known workflow
 * stage — never invented progress.
 */

export type WorkflowStageKey =
  | 'general'
  | 'lead_sourcing'
  | 'decision_makers'
  | 'enrichment'
  | 'outreach'
  | 'content'
  | 'long_running';

export const PROGRESS_COPY: Record<WorkflowStageKey, string[]> = {
  general: [
    'Pilot is preparing the workflow…',
    'Pilot is assigning the right agents…',
    'Checking your Company Brain…',
    'Building the execution plan…',
  ],
  lead_sourcing: [
    'Scout is turning your request into a search strategy…',
    'Scout is preparing the Apify input…',
    'Scout is checking hiring signals…',
    'Scout is reviewing raw results…',
    'Scout is rejecting weak matches…',
    'Aria is ranking accepted accounts…',
    'Pilot is preparing the Workbench view…',
  ],
  decision_makers: [
    'Scout is checking company context…',
    'Scout is searching for verified decision-makers…',
    'Scout is matching contacts back to accounts…',
    'Scout is rejecting low-confidence contacts…',
    'Pilot is updating contact status…',
  ],
  enrichment: [
    'Hawk is checking available company domains…',
    'Hawk is reading company websites…',
    'Hawk is extracting positioning and pain points…',
    'Aria is prioritizing useful context…',
    'Scribe is preparing the summary…',
  ],
  outreach: [
    'Penn is preparing draft-only outreach…',
    'Penn is matching the message to your brand voice…',
    'Penn is checking approval rules…',
    'Pilot is sending drafts to Awaiting You…',
  ],
  content: [
    'Scribe is shaping the first draft…',
    'Scribe is matching your founder voice…',
    'Scribe is turning signals into a post angle…',
    'Pilot is preparing the draft for review…',
  ],
  long_running: [
    'Still working — this can take a little longer when external tools are involved.',
  ],
};

/** Infer the workflow stage from a task description and/or agent slug. */
export function inferStage(input: {
  agentSlug?: string | null;
  description?: string | null;
  toolName?: string | null;
}): WorkflowStageKey {
  const desc = (input.description ?? '').toLowerCase();
  const tool = (input.toolName ?? '').toLowerCase();
  const slug = (input.agentSlug ?? '').toLowerCase();

  if (slug === 'penn' || /outreach|draft|email/.test(desc)) return 'outreach';
  if (slug === 'scribe' || /post|content|article/.test(desc)) return 'content';
  if (slug === 'hawk' || /enrich|website|firecrawl|scrape/.test(desc) || /firecrawl|scrape/.test(tool)) return 'enrichment';
  if (/decision[- ]?maker|contact/.test(desc)) return 'decision_makers';
  if (slug === 'scout' || /lead|account|company|apify/.test(desc) || /apify|search/.test(tool)) return 'lead_sourcing';
  if (slug === 'aria' || /rank|score/.test(desc)) return 'lead_sourcing';
  return 'general';
}

/** Pick the rotating line for a given stage and rotation tick. */
export function pickProgressLine(stage: WorkflowStageKey, tick: number): string {
  const lines = PROGRESS_COPY[stage] ?? PROGRESS_COPY.general;
  if (lines.length === 0) return PROGRESS_COPY.general[0];
  const i = ((tick % lines.length) + lines.length) % lines.length;
  return lines[i];
}
