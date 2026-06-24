// Product tour step definitions — copy comes from the product brief.
// Pure data: rendered by ProductTour.tsx and tested in tourSteps.test.ts.

export interface ProductTourStep {
  id: 'dashboard' | 'workflows' | 'conversations' | 'workbench' | 'awaiting' | 'company_brain';
  title: string;
  body: string;
  bullets: string[];
  ctaLabel: string;
  ctaRoute: string;
}

export const TOUR_STEPS: ProductTourStep[] = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    body: 'Dashboard is your AI workforce overview. Pilot shows what changed, what needs approval, and what your team should do next.',
    bullets: [
      'Workforce updates at a glance',
      'Approval count and pending drafts',
      'Live agent status',
      'Recommended next move from Pilot',
    ],
    ctaLabel: 'Take me there',
    ctaRoute: '/dashboard',
  },
  {
    id: 'workflows',
    title: 'Workflows',
    body: 'Workflows are repeatable business playbooks. Pick a workflow, fill the inputs, and Agentory runs it with the right AI employees.',
    bullets: [
      'Workflow Center with every playbook',
      'Recommended for your company',
      'Ready / Setup-needed badges',
      'One-click Run workflow',
    ],
    ctaLabel: 'Open Workflows',
    ctaRoute: '/workflows',
  },
  {
    id: 'conversations',
    title: 'Conversations',
    body: 'Conversations are your flexible command center. Ask Pilot anything, or let Scout, Aria, Hawk, Penn, and Scribe handle specific work.',
    bullets: [
      'Chat input always available',
      'Mention an agent by name',
      'Result and action pills appear inline',
    ],
    ctaLabel: 'Open chat',
    ctaRoute: '/dashboard',
  },
  {
    id: 'workbench',
    title: 'Workbench',
    body: 'Workbench is where outputs appear — leads, contacts, enrichment, drafts, reports, and activity. It shows what happened and what to do next.',
    bullets: [
      'Tables, panels, and live activity timeline',
      'Insights from Aria and Hawk',
      'Locked columns unlock as workflows run',
    ],
    ctaLabel: 'See your workbench',
    ctaRoute: '/leads',
  },
  {
    id: 'awaiting',
    title: 'Awaiting You',
    body: 'Awaiting You is your approval queue. Outreach, drafts, and risky actions wait here until you approve them.',
    bullets: [
      'Approval queue, ordered by urgency',
      'Draft-only safety by default',
      'Nothing is sent automatically',
    ],
    ctaLabel: 'Open Awaiting You',
    ctaRoute: '/awaiting-you',
  },
  {
    id: 'company_brain',
    title: 'Company Brain',
    body: 'Company Brain is the context your AI workforce uses. Update it anytime as your ICP, positioning, or goals change.',
    bullets: [
      'Edit ICP, positioning, voice, and goals',
      'Refreshes recommendations across the app',
      'Stays private to your workspace',
    ],
    ctaLabel: 'Open Company Brain',
    ctaRoute: '/onboarding/company-brain',
  },
];
