// Plain-English micro-help registry. Used by <InfoHint topic="..." />.
// Keep each entry short — one tight paragraph at most.

export type HelpTopic =
  | 'company_brain'
  | 'workflows'
  | 'workbench'
  | 'awaiting_you'
  | 'setup_needed'
  | 'draft_only'
  | 'locked_columns'
  | 'credits'
  | 'agent_role';

export const HELP_CONTENT: Record<HelpTopic, { label: string; text: string }> = {
  company_brain: {
    label: 'Company Brain',
    text: 'The shared context your AI workforce uses — ICP, positioning, voice, goals, and integrations. Update it whenever your business shifts.',
  },
  workflows: {
    label: 'Workflows',
    text: 'Repeatable business playbooks. Pick one, fill the inputs, and the right AI employees run it for you. No prompt-writing needed.',
  },
  workbench: {
    label: 'Workbench',
    text: 'Where results land — leads, contacts, drafts, reports. Each run opens its outputs and recommended next actions here.',
  },
  awaiting_you: {
    label: 'Awaiting You',
    text: 'Your approval queue. Outreach drafts and risky actions wait here until you approve. Nothing is sent automatically.',
  },
  setup_needed: {
    label: 'Setup needed',
    text: 'This workflow needs a provider or integration before it can run. Open it to see what to connect.',
  },
  draft_only: {
    label: 'Draft-only',
    text: 'Agentory will prepare results without sending anything externally. You review and approve every action.',
  },
  locked_columns: {
    label: 'Locked columns',
    text: 'These unlock after the right workflow runs — for example, contacts appear once Scout finds decision-makers, and emails appear after enrichment.',
  },
  credits: {
    label: 'Credits',
    text: 'Each AI action uses a small number of credits depending on the model and tools used. Heavy work (research, enrichment) costs more than drafting.',
  },
  agent_role: {
    label: 'Agent role',
    text: 'Each AI employee has one job: Scout sources, Aria ranks, Hawk researches, Penn writes outreach, Scribe writes content, and Pilot coordinates.',
  },
};
