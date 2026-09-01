/**
 * THE CAST. One source of truth for how the AI employees are presented on the
 * landing page.
 *
 * Identity (id, name, accent) is DERIVED from `@/config/agentRegistry` so the
 * marketing page can never drift from the product's canonical roster. What is
 * added here is landing-only: the business function a visitor recognises, a
 * one-line specialty, and who each employee hands work to. The registry's
 * internal titles ("AI Signal Scout", "AI Account Analyst") describe the
 * engine, not the job a business hands over, so they are not rendered.
 *
 * `@/config/agentRegistry` is NOT modified by this module.
 *
 * PORTRAITS. Resolved through `import.meta.glob` rather than static imports.
 * Lyra's registry asset is a remote Lovable URL that 404s to index.html in a
 * normal build — she renders as broken alt text today. Globbing means the
 * moment a real `lyra.webp` lands in the assets folder it is picked up with no
 * code change, and until then `EmployeePortrait` falls back to a styled
 * monogram instead of a broken image.
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

export interface Employee {
  id: EmployeeId;
  /** Public name — from the canonical registry. */
  name: string;
  /** The business function, in words a founder recognises. */
  function: string;
  /** Short uppercase tag used in tight spaces. */
  tag: string;
  /** One line: what this employee actually does. */
  specialty: string;
  /** Used in-context inside product sections — present tense, active. */
  inContext: string;
  /** Who this employee typically hands work to. */
  handsOffTo: EmployeeId | 'you';
  /** Accent hex — from the canonical registry. */
  accent: string;
  /** Portrait URL, or null when the asset is not on disk yet. */
  portrait: string | null;
  /** Single letter drawn when the portrait is missing. */
  initial: string;
}

/**
 * Order matters: it is the order work flows through the team, and every
 * section that lists employees renders them this way so the cast stays
 * recognisable from section to section.
 */
export const EMPLOYEES: Employee[] = [
  {
    id: 'lyra',
    name: PUBLIC_AGENTS.lyra.name,
    function: 'Signals & Monitoring',
    tag: 'SIGNALS',
    specialty: 'Watches hiring, funding, growth and competitor moves, and tells you what changed.',
    inContext: 'Lyra watches the market and flags what actually changed.',
    handsOffTo: 'atlas',
    accent: PUBLIC_AGENTS.lyra.accentHex,
    portrait: portraitFor('lyra'),
    initial: 'L',
  },
  {
    id: 'atlas',
    name: PUBLIC_AGENTS.atlas.name,
    function: 'Research & Company Intelligence',
    tag: 'RESEARCH',
    specialty: 'Researches companies, markets and candidates, checks the facts, and ranks what is worth your time.',
    inContext: 'Atlas researches each company and checks the evidence.',
    handsOffTo: 'mira',
    accent: PUBLIC_AGENTS.atlas.accentHex,
    portrait: portraitFor('atlas'),
    initial: 'A',
  },
  {
    id: 'mira',
    name: PUBLIC_AGENTS.mira.name,
    function: 'Content & Outreach',
    tag: 'CONTENT',
    specialty: 'Writes in your voice — posts, messages and outreach — and brings every draft to you for approval.',
    inContext: 'Mira writes it in your voice and brings you the draft.',
    handsOffTo: 'you',
    accent: PUBLIC_AGENTS.mira.accentHex,
    portrait: portraitFor('mira'),
    initial: 'M',
  },
  {
    id: 'orion',
    name: PUBLIC_AGENTS.orion.name,
    function: 'Pipeline & Review',
    tag: 'REVIEW',
    specialty: 'Tracks what is waiting on you, and what to approve, contact, watch or skip next.',
    inContext: 'Orion keeps track of what is waiting on your decision.',
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

/** Resolve by name too, so existing sections that carry a name string can look one up. */
export function employeeByName(name: string): Employee | undefined {
  return EMPLOYEES.find((e) => e.name.toLowerCase() === name.toLowerCase());
}
