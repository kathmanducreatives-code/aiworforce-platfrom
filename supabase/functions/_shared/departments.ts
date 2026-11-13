// THE FOUR DEPARTMENTS — the one identity map for prompts, routes and labels.
//
// Product naming:  ORION Executive · ATLAS Sales & Leads · LISA Signals · LYRA Content.
// Execution still runs on the legacy backend slugs (task rows, agents table,
// approvals); this map is how every server-side surface NAMES them. It mirrors
// src/config/agentRegistry.ts (LEGACY_TO_PUBLIC + PUBLIC_ALIASES), pinned by
// tests/edge-functions/_shared/workforce/identity.test.ts.
//
// PURE.

export const DEPARTMENTS = ["orion", "atlas", "lisa", "lyra"] as const;
export type Department = typeof DEPARTMENTS[number];

export interface DepartmentProfile {
  id: Department;
  name: "ORION" | "ATLAS" | "LISA" | "LYRA";
  title: string;
  /** One line for prompts: what this department does and never does. */
  remit: string;
  legacySlugs: readonly string[];
}

export const DEPARTMENT_PROFILES: Readonly<Record<Department, DepartmentProfile>> = Object.freeze({
  orion: { id: "orion", name: "ORION", title: "Executive Intelligence",
    remit: "chief of staff and primary interface: answers business questions, briefs, prioritises, plans and delegates to ATLAS, LISA and LYRA, and asks for approval before anything consequential",
    legacySlugs: ["pilot"] },
  atlas: { id: "atlas", name: "ATLAS", title: "Sales & Lead Intelligence",
    remit: "discovers and researches companies and decision-makers, qualifies them against the ICP and exclusions, explains every verdict; never contacts anyone",
    legacySlugs: ["scout", "aria", "hawk"] },
  lisa: { id: "lisa", name: "LISA", title: "Signals & Market Intelligence",
    remit: "monitors competitors and markets for expansion, hiring, funding and launch signals, verifies sources, dates and contradictions; never presents an unverified report as fact",
    legacySlugs: [] },
  lyra: { id: "lyra", name: "LYRA", title: "Content & Marketing",
    remit: "writes LinkedIn content, campaign ideas and personalised outreach drafts in the brand voice from approved evidence; nothing is published or sent without approval",
    legacySlugs: ["scribe", "penn"] },
});

/** Backend slug (or public id, or hidden alias) → department. Unknown → null. */
export function departmentOf(slug: string | null | undefined): Department | null {
  const k = String(slug ?? "").trim().toLowerCase();
  if (!k) return null;
  if ((DEPARTMENTS as readonly string[]).includes(k)) return k as Department;
  if (k === "mira") return "lyra";
  for (const d of DEPARTMENTS) if (DEPARTMENT_PROFILES[d].legacySlugs.includes(k)) return d;
  return null;
}

export function departmentName(slug: string | null | undefined): string {
  const d = departmentOf(slug);
  return d ? DEPARTMENT_PROFILES[d].name : "ORION";
}

/** The TEAM block every model prompt uses. */
export function renderTeamForPrompt(): string {
  return DEPARTMENTS.map((d) => `- ${DEPARTMENT_PROFILES[d].name} (${DEPARTMENT_PROFILES[d].title}) — ${DEPARTMENT_PROFILES[d].remit}.`).join("\n");
}
