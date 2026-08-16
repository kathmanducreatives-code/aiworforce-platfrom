// CANONICAL product-tour step configuration.
//
// This file is the SINGLE source of truth for the guide. Sidebar.tsx derives its
// `data-tour` anchor tags from `TOUR_TAG_BY_NAV_KEY` below rather than keeping a
// second hand-maintained map, so a renamed anchor can never drift out of sync
// with the step that spotlights it.
//
// `navKey` is the Sidebar navigation key a step highlights. `featureName` must
// match that nav item's visible label exactly — tourStepMapping.test.ts parses
// Sidebar.tsx and fails if the two ever disagree. Steps that are not a sidebar
// destination (Workbench is a results panel, not a nav item) carry navKey: null.

export type Placement = 'right' | 'left' | 'top' | 'bottom' | 'auto';

export interface ProductTourStep {
  /** Stable identifier. Persisted progress and tests key off this — never rename. */
  id: 'dashboard' | 'workflows' | 'conversations' | 'workbench' | 'awaiting' | 'company_brain';
  /** Sidebar nav key this step spotlights, or null when the step is not a nav item. */
  navKey: string | null;
  /** Current Agentory feature name. Must equal the sidebar label when navKey is set. */
  featureName: string;
  title: string;
  body: string;
  where: string;
  useItFor: string;
  tryFirst: string;
  /** CTA label used when the user is NOT already on `ctaRoute`. */
  ctaLabel: string;
  ctaRoute: string;
  /** Raw `data-tour` tag; `anchorSelector` is derived from it. */
  anchorTag: string;
  anchorSelector: string;
  fallbackSelector?: string;
  placement?: Placement;
}

type StepSpec = Omit<ProductTourStep, 'anchorSelector'>;

const STEP_SPECS: StepSpec[] = [
  {
    id: 'dashboard',
    navKey: 'dashboard',
    featureName: 'Dashboard',
    title: 'Dashboard',
    body: 'Your AI workforce overview — what changed, what needs approval, and what to do next.',
    where: 'Left sidebar → Dashboard',
    useItFor: 'Seeing what changed, what needs approval, and what your AI team recommends next.',
    tryFirst: 'Review the recommended next move from Pilot.',
    ctaLabel: 'Open Dashboard',
    ctaRoute: '/dashboard',
    anchorTag: 'sidebar-dashboard',
    fallbackSelector: '[data-tour="dashboard-main"]',
    placement: 'right',
  },
  {
    id: 'workflows',
    navKey: 'workflows',
    featureName: 'Workflows',
    title: 'Workflows',
    body: 'Repeatable business playbooks — pick one, fill the inputs, and Agentory runs it with the right AI employees.',
    where: 'Left sidebar → Workflows',
    useItFor: 'Running structured workflows like lead sourcing, research, outreach drafting, content, and audits.',
    tryFirst: 'Pick a Ready workflow recommended for your company.',
    ctaLabel: 'Open Workflows',
    ctaRoute: '/workflows',
    anchorTag: 'sidebar-workflows',
    fallbackSelector: '[data-tour="workflows-featured"]',
    placement: 'right',
  },
  {
    // The sidebar item is labelled "Pilot"; the guide used to call this step
    // "Conversations", which matched no visible UI and no route. The id stays
    // `conversations` because persisted tour progress keys off it.
    id: 'conversations',
    navKey: 'pilot',
    featureName: 'Pilot',
    title: 'Pilot',
    body: 'Your flexible command center. Ask Pilot anything, or mention an agent directly.',
    where: 'Left sidebar → Pilot, or the command dock at the bottom.',
    useItFor: 'Asking Pilot for custom work or giving direct tasks to Scout, Aria, Hawk, Penn, and Scribe.',
    tryFirst: 'Ask “What should I do next?”',
    ctaLabel: 'Open Pilot',
    ctaRoute: '/dashboard',
    anchorTag: 'sidebar-conversations',
    fallbackSelector: '[data-tour="command-dock"]',
    placement: 'right',
  },
  {
    // Workbench is a results panel, not a sidebar destination — hence navKey
    // null. It is reached through Workflows, so the CTA points there.
    id: 'workbench',
    navKey: null,
    featureName: 'Workbench',
    title: 'Workbench',
    body: 'Where results open after a workflow runs — leads, contacts, research, drafts, reports, and activity.',
    where: 'Opens automatically after a workflow, or from “View results”.',
    useItFor: 'Reviewing outputs from your AI workforce and deciding what to act on next.',
    tryFirst: 'Run a workflow, then inspect the output in Workbench.',
    ctaLabel: 'Open Workflows',
    ctaRoute: '/workflows',
    anchorTag: 'workflows-featured',
    fallbackSelector: '[data-tour="sidebar-workflows"]',
    placement: 'left',
  },
  {
    id: 'awaiting',
    navKey: 'awaiting',
    featureName: 'Awaiting You',
    title: 'Awaiting You',
    body: 'Your approval queue. Drafts and risky actions wait here — nothing is sent without your approval.',
    where: 'Left sidebar → Awaiting You',
    useItFor: 'Reviewing drafts and actions before anything risky happens.',
    tryFirst: 'Open the queue and approve or edit the first item.',
    ctaLabel: 'Open Awaiting You',
    ctaRoute: '/awaiting-you',
    anchorTag: 'sidebar-awaiting',
    fallbackSelector: '[data-tour="awaiting-queue"]',
    placement: 'right',
  },
  {
    id: 'company_brain',
    navKey: 'company-brain',
    featureName: 'Company Brain',
    title: 'Company Brain',
    body: 'The shared context your workforce uses — ICP, positioning, voice, workflows, competitors, and approval rules.',
    where: 'Left sidebar → Company Brain',
    useItFor: 'Updating the context that powers every agent and recommendation.',
    tryFirst: 'Update it when your offer, target customer, or GTM strategy changes.',
    ctaLabel: 'Open Company Brain',
    // The Company Brain PAGE. This previously pointed at
    // `/onboarding/company-brain`, which threw the user back into the setup
    // wizard from the final tour step.
    ctaRoute: '/company-brain',
    anchorTag: 'sidebar-company-brain',
    fallbackSelector: '[data-tour="company-brain-main"]',
    placement: 'right',
  },
];

export const TOUR_STEPS: ProductTourStep[] = STEP_SPECS.map((s) => ({
  ...s,
  anchorSelector: `[data-tour="${s.anchorTag}"]`,
}));

/**
 * Sidebar nav key → `data-tour` tag. Sidebar.tsx renders `data-tour` from this,
 * so the anchors the guide looks for and the anchors the sidebar emits are the
 * same list by construction.
 */
export const TOUR_TAG_BY_NAV_KEY: Record<string, string> = Object.fromEntries(
  TOUR_STEPS.filter((s) => s.navKey).map((s) => [s.navKey as string, s.anchorTag]),
);

/**
 * The label a step's CTA should show.
 *
 * When the user is already on the destination there is nothing to "open" — the
 * old config showed "Open Dashboard" while sitting on the dashboard. Advancing
 * is the only sensible action there, so the CTA becomes "Continue".
 */
export function ctaLabelFor(step: ProductTourStep, currentPath: string): string {
  return currentPath === step.ctaRoute ? 'Continue' : step.ctaLabel;
}
