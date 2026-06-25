// Product tour step definitions — copy comes from the product brief.
// Pure data: rendered by ProductTour.tsx and tested in tourSteps.test.ts.

export type Placement = 'right' | 'left' | 'top' | 'bottom' | 'auto';

export interface ProductTourStep {
  id: 'dashboard' | 'workflows' | 'conversations' | 'workbench' | 'awaiting' | 'company_brain';
  title: string;
  body: string;
  where: string;
  useItFor: string;
  tryFirst: string;
  ctaLabel: string;
  ctaRoute: string;
  anchorSelector: string;
  fallbackSelector?: string;
  placement?: Placement;
}

export const TOUR_STEPS: ProductTourStep[] = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    body: 'Your AI workforce overview — what changed, what needs approval, and what to do next.',
    where: 'Left sidebar → Dashboard',
    useItFor: 'Seeing what changed, what needs approval, and what your AI team recommends next.',
    tryFirst: 'Review the recommended next move from Pilot.',
    ctaLabel: 'Open Dashboard',
    ctaRoute: '/dashboard',
    anchorSelector: '[data-tour="sidebar-dashboard"]',
    fallbackSelector: '[data-tour="dashboard-main"]',
    placement: 'right',
  },
  {
    id: 'workflows',
    title: 'Workflows',
    body: 'Repeatable business playbooks — pick one, fill the inputs, and Agentory runs it with the right AI employees.',
    where: 'Left sidebar → Workflows',
    useItFor: 'Running structured workflows like lead sourcing, research, outreach drafting, content, and audits.',
    tryFirst: 'Pick a Ready workflow recommended for your company.',
    ctaLabel: 'Open Workflows',
    ctaRoute: '/workflows',
    anchorSelector: '[data-tour="sidebar-workflows"]',
    fallbackSelector: '[data-tour="workflows-featured"]',
    placement: 'right',
  },
  {
    id: 'conversations',
    title: 'Conversations',
    body: 'Your flexible command center. Ask Pilot anything, or mention an agent directly.',
    where: 'Left sidebar → Conversations, or the command dock at the bottom.',
    useItFor: 'Asking Pilot for custom work or giving direct tasks to Scout, Aria, Hawk, Penn, and Scribe.',
    tryFirst: 'Ask “What should I do next?”',
    ctaLabel: 'Open Conversations',
    ctaRoute: '/dashboard',
    anchorSelector: '[data-tour="sidebar-conversations"]',
    fallbackSelector: '[data-tour="command-dock"]',
    placement: 'right',
  },
  {
    id: 'workbench',
    title: 'Workbench',
    body: 'Where results open after a workflow runs — leads, contacts, research, drafts, reports, and activity.',
    where: 'Opens automatically after a workflow, or from “View results”.',
    useItFor: 'Reviewing outputs from your AI workforce and deciding what to act on next.',
    tryFirst: 'Run a workflow, then inspect the output in Workbench.',
    ctaLabel: 'Open Workflows',
    ctaRoute: '/workflows',
    anchorSelector: '[data-tour="workflows-featured"]',
    fallbackSelector: '[data-tour="sidebar-workflows"]',
    placement: 'left',
  },
  {
    id: 'awaiting',
    title: 'Awaiting You',
    body: 'Your approval queue. Drafts and risky actions wait here — nothing is sent without your approval.',
    where: 'Left sidebar → Awaiting You',
    useItFor: 'Reviewing drafts and actions before anything risky happens.',
    tryFirst: 'Open the queue and approve or edit the first item.',
    ctaLabel: 'Open Awaiting You',
    ctaRoute: '/awaiting-you',
    anchorSelector: '[data-tour="sidebar-awaiting"]',
    fallbackSelector: '[data-tour="awaiting-queue"]',
    placement: 'right',
  },
  {
    id: 'company_brain',
    title: 'Company Brain',
    body: 'The shared context your workforce uses — ICP, positioning, voice, workflows, competitors, and approval rules.',
    where: 'Left sidebar → Company Brain',
    useItFor: 'Updating the context that powers every agent and recommendation.',
    tryFirst: 'Update it when your offer, target customer, or GTM strategy changes.',
    ctaLabel: 'Open Company Brain',
    ctaRoute: '/onboarding/company-brain',
    anchorSelector: '[data-tour="sidebar-company-brain"]',
    fallbackSelector: '[data-tour="company-brain-main"]',
    placement: 'right',
  },
];
