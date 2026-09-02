/**
 * THE CAST. One source of truth for how the AI employees are presented on the
 * landing page.
 *
 * ROSTER (2026-09 repositioning):
 *
 *     LISA   signals    watches the outside world
 *     ATLAS  leads      finds the companies worth talking to
 *     LYRA   content    turns intelligence into content
 *     ORION  executive  synthesises everything and tells you what matters
 *
 * That order is the order work flows, and every section renders them this way
 * so the cast stays recognisable from section to section.
 *
 * NAME DIVERGENCE — READ THIS BEFORE CHANGING IT. The canonical product
 * registry calls the content/outreach employee **Mira** (`AI Message
 * Strategist`), and the whole product surface — dock, chat, workbench — renders
 * that name. Marketing now calls the signals employee **Lisa**. To avoid
 * touching product identity, `id` stays `mira` (which is what keeps the
 * registry linkage and the portrait glob working) while `name` is the public
 * one. If the product adopts Lisa too, rename in `@/config/agentRegistry` and
 * delete the `name` override here.
 *
 * PORTRAITS resolve through `import.meta.glob` keyed on `id`, so the files on
 * disk keep their existing names.
 */

import { PUBLIC_AGENTS, type PublicAgentId } from '@/config/agentRegistry';

const portraitFiles = import.meta.glob('../../assets/agents/public/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function portraitFor(id: string): string | null {
  const hit = Object.entries(portraitFiles).find(([path]) =>
    path.toLowerCase().endsWith(`/${id}.webp`),
  );
  return hit ? hit[1] : null;
}

export type EmployeeId = Extract<PublicAgentId, 'lyra' | 'atlas' | 'mira' | 'orion'>;

/** The kind of work an employee owns. Drives accent colour and grouping. */
export type EmployeeDiscipline = 'signals' | 'leads' | 'content' | 'executive';

export interface Employee {
  id: EmployeeId;
  /** Public name. */
  name: string;
  discipline: EmployeeDiscipline;
  /** The business function, in words a founder recognises. */
  function: string;
  /** Short uppercase tag used in tight spaces. */
  tag: string;
  /** One line: what this employee actually does. */
  specialty: string;
  /** Present-tense live status, e.g. "Monitoring market". */
  status: string;
  /** A sharper one-liner for headline slots: "Lisa found 4 changes worth knowing." */
  headlineClaim: string;
  /** Capability chips shown in the agent sequence. */
  capabilities: readonly string[];
  /** Who this employee typically hands work to. */
  handsOffTo: EmployeeId | 'you';
  /** Accent hex. */
  accent: string;
  /** Portrait URL, or null when the asset is not on disk yet. */
  portrait: string | null;
  /** Single letter drawn when the portrait is missing. */
  initial: string;
}

export const EMPLOYEES: Employee[] = [
  {
    id: 'mira',
    name: 'Lisa',
    discipline: 'signals',
    function: 'Signal Intelligence',
    tag: 'SIGNALS',
    specialty: 'Watches the companies and markets that matter to you, and surfaces what actually changed.',
    status: 'Monitoring market',
    headlineClaim: 'Lisa found 4 changes worth knowing.',
    capabilities: ['PRICING', 'HIRING', 'FUNDING', 'PRODUCT', 'REVIEWS', 'WEBSITE CHANGES', 'MARKET MOVEMENT', 'BUYING SIGNALS'],
    handsOffTo: 'atlas',
    accent: PUBLIC_AGENTS.mira.accentHex,
    portrait: portraitFor('mira'),
    initial: 'L',
  },
  {
    id: 'atlas',
    name: PUBLIC_AGENTS.atlas.name,
    discipline: 'leads',
    function: 'Lead Intelligence',
    tag: 'LEADS',
    specialty: 'Searches the market, matches companies to your ICP, enriches them and ranks who is worth your time.',
    status: 'Finding opportunities',
    headlineClaim: 'Atlas found 12 accounts worth your time.',
    capabilities: ['DISCOVERY', 'ICP MATCHING', 'ENRICHMENT', 'LEAD SCORING', 'ACCOUNT RESEARCH', 'INTENT', 'CONTACT DISCOVERY', 'PRIORITIZATION'],
    handsOffTo: 'lyra',
    accent: PUBLIC_AGENTS.atlas.accentHex,
    portrait: portraitFor('atlas'),
    initial: 'A',
  },
  {
    id: 'lyra',
    name: PUBLIC_AGENTS.lyra.name,
    discipline: 'content',
    function: 'Content Intelligence',
    tag: 'CONTENT',
    specialty: 'Turns company knowledge, market intelligence and customer insight into content worth publishing.',
    status: 'Drafting',
    headlineClaim: 'Lyra turned one signal into 4 pieces of content.',
    capabilities: ['RESEARCH', 'IDEATION', 'LINKEDIN', 'BLOGS', 'CAROUSELS', 'REPURPOSING', 'CONTENT CALENDAR', 'PERFORMANCE'],
    handsOffTo: 'orion',
    accent: PUBLIC_AGENTS.lyra.accentHex,
    portrait: portraitFor('lyra'),
    initial: 'L',
  },
  {
    id: 'orion',
    name: PUBLIC_AGENTS.orion.name,
    discipline: 'executive',
    function: 'Executive Intelligence',
    tag: 'EXECUTIVE',
    specialty: 'Combines what the team found into one short briefing: what happened, why it matters, what to do next.',
    status: 'Synthesizing',
    headlineClaim: 'Orion decided what deserves your attention.',
    capabilities: ['SYNTHESIS', 'PRIORITISATION', 'DAILY BRIEF', 'RECOMMENDATIONS', 'IMPACT ANALYSIS', 'APPROVAL QUEUE'],
    handsOffTo: 'you',
    accent: PUBLIC_AGENTS.orion.accentHex,
    portrait: portraitFor('orion'),
    initial: 'O',
  },
];

export const EMPLOYEE_BY_ID: Record<EmployeeId, Employee> = EMPLOYEES.reduce(
  (acc, e) => ({ ...acc, [e.id]: e }),
  {} as Record<EmployeeId, Employee>,
);

/** The three specialists that report into Orion. */
export const SPECIALISTS = EMPLOYEES.filter((e) => e.discipline !== 'executive');
export const ORION = EMPLOYEE_BY_ID.orion;

/** Resolve by public name, for sections that carry a name string. */
export function employeeByName(name: string): Employee | undefined {
  return EMPLOYEES.find((e) => e.name.toLowerCase() === name.toLowerCase());
}
