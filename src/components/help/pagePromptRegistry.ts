// Maps a route to a seeded "ask Pilot about this page" prompt.
// Used by AskPilotAboutPage to open chat with the right context.

export interface PagePrompt {
  label: string;
  prompt: string;
}

const ENTRIES: { match: (path: string) => boolean; value: PagePrompt }[] = [
  { match: (p) => p === '/' || p === '/dashboard',
    value: { label: 'Ask Pilot about this page', prompt: 'Explain the Dashboard and tell me what I should do first today, based on my Company Brain.' } },
  { match: (p) => p.startsWith('/workflows'),
    value: { label: 'Ask Pilot about this page', prompt: 'Explain the Workflows page and what I should do first. Reference my Company Brain and recommend a starting workflow.' } },
  { match: (p) => p.startsWith('/awaiting-you'),
    value: { label: 'Ask Pilot about this page', prompt: 'Explain the Awaiting You queue and how I should review and approve items safely.' } },
  { match: (p) => p.startsWith('/leads'),
    value: { label: 'Ask Pilot about this page', prompt: 'Explain the Workbench leads view: what the columns mean, what unlocks them, and what I should do next based on my Company Brain.' } },
  { match: (p) => p.startsWith('/outreach-engine') || p.startsWith('/email-sequences') || p.startsWith('/lead-crm'),
    value: { label: 'Ask Pilot about this page', prompt: 'Explain this outreach surface and how drafts, approvals, and sending work. Recommend a safe first action.' } },
  { match: (p) => p.startsWith('/agents'),
    value: { label: 'Ask Pilot about this page', prompt: 'Explain my AI workforce on this page — who each agent is and when to use them, based on my Company Brain.' } },
  { match: (p) => p.startsWith('/signals'),
    value: { label: 'Ask Pilot about this page', prompt: 'Explain the Signals page and what I should act on first, based on my ICP.' } },
  { match: (p) => p.startsWith('/competitors'),
    value: { label: 'Ask Pilot about this page', prompt: 'Explain Competitor intelligence and what I should track first, based on my Company Brain.' } },
  { match: (p) => p.startsWith('/onboarding/company-brain'),
    value: { label: 'Ask Pilot about this page', prompt: 'Explain Company Brain and which sections matter most to keep updated for my goals.' } },
];

const DEFAULT: PagePrompt = {
  label: 'Ask Pilot about this page',
  prompt: 'Explain what this page is for in Agentory and what I should do here first.',
};

export function getPagePrompt(pathname: string): PagePrompt {
  return ENTRIES.find((e) => e.match(pathname))?.value ?? DEFAULT;
}
