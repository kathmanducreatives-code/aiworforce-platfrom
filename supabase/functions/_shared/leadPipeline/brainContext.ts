// Company Brain → ATLAS discovery planning.
//
// The Company Brain is the workspace's own context (who it is, what it sells,
// whom it targets, what it refuses). ATLAS stores what discovery FOUND. They stay
// separate: the Brain is READ here as planning context and never written, and no
// lead is ever stored in it.
//
// Same path the chat agent uses (pilot-chat `companyBrainContextForCompiler` →
// `compileLeadMission({ companyBrain })` → `mergeCompanyBrainIntoMission`), so a
// request means the same thing in chat and in ATLAS:
//   * the user's own words outrank the Brain; the Brain only FILLS a field the
//     user left open, and what it fills is a TARGET (ranks, never rejects)
//   * the one Brain rule that is hard is an explicitly enforced size policy
//     (`employee_policy`), exactly as for every other mission in the workspace
//   * a Brain that is not usable (not onboarded, or empty) is no context at all
//   * the row is read by workspace id with the service client AFTER the caller's
//     membership was checked: one workspace's Brain never informs another's plan

import { compileCompanyBrainContext } from "../companyBrainCompiler.ts";
import { hasUsableBrain } from "../companyBrainContext.ts";
import { compileLeadMission } from "../leadMissionCompiler.ts";
import type { BrainMergeInput } from "../leadMission.ts";
import type { ContractBrainInput } from "../missionContract/brain.ts";

export interface BrainPlanningContext {
  /** The compiler's view of the Brain ICP; null when there is no usable Brain. */
  context: BrainMergeInput | null;
  /** Why the Brain was or was not used, for the plan response. */
  status: "used" | "absent" | "not_onboarded" | "empty" | "unreadable";
  /** Which Brain fields were offered as context (never values beyond the ICP lists). */
  fields: string[];
  /** Mission Contract mode only: the same context plus the workspace's industry exclusions. */
  contractInput?: ContractBrainInput | null;
}

/** The Brain input a Mission Contract reads (missionContract/brain.ts): v1 context + exclusions. */
export function contractBrainInput(profile: Record<string, unknown> | null): ContractBrainInput | null {
  if (!profile || typeof profile !== "object") return null;
  const d = compileCompanyBrainContext({ workspace_id: "", profile }).disqualifiers;
  return {
    ...compilerBrainContext(profile),
    excluded_industries_explicit: [...(d.industries_explicit ?? [])],
    excluded_industries_generic: [...(d.industries_generic ?? [])],
  };
}

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean)
  : (typeof v === "string" && v.trim() ? [v.trim()] : []);

/** pilot-chat's mapping, shared: the Brain ICP the compiler may use. */
export function compilerBrainContext(profile: Record<string, unknown> | null): BrainMergeInput {
  const icp = ((profile?.icp ?? {}) as Record<string, unknown>);
  const out: BrainMergeInput = {
    industries: arr(icp.industries ?? icp.industry ?? icp.target_industry),
    stages: arr(icp.company_stage ?? icp.stages ?? icp.funding_stage),
    locations: arr(icp.geography ?? icp.locations ?? icp.location),
  };
  if (profile && typeof profile === "object") {
    const { company_size_min: min, company_size_max: max } = compileCompanyBrainContext({ workspace_id: "", profile }).icp;
    if (min != null || max != null) Object.assign(out, { employee_min: min ?? null, employee_max: max ?? null, employee_policy: true });
  }
  return out;
}

export function brainPlanningContext(row: { profile?: unknown; onboarding_completed?: boolean | null } | null): BrainPlanningContext {
  if (!row || !row.profile || typeof row.profile !== "object") return { context: null, status: "absent", fields: [] };
  const profile = row.profile as Record<string, unknown>;
  if (row.onboarding_completed !== true) return { context: null, status: "not_onboarded", fields: [] };
  if (!hasUsableBrain(profile as never, true)) return { context: null, status: "empty", fields: [] };
  const context = compilerBrainContext(profile);
  const fields = [
    ...(context.industries?.length ? ["industries"] : []), ...(context.stages?.length ? ["stages"] : []),
    ...(context.locations?.length ? ["locations"] : []), ...(context.employee_policy ? ["size_policy"] : []),
  ];
  return { context, status: "used", fields, contractInput: contractBrainInput(profile) };
}

/** Read ONE workspace's Brain (service client, after the membership check). Never throws. */
export async function loadBrainPlanningContext(
  admin: { from(t: string): { select(c: string): { eq(c: string, v: string): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> } } } },
  workspaceId: string,
): Promise<BrainPlanningContext> {
  try {
    const { data, error } = await admin.from("company_brain").select("profile, onboarding_completed").eq("workspace_id", workspaceId).maybeSingle();
    if (error) return { context: null, status: "unreadable", fields: [] };
    return brainPlanningContext(data as never);
  } catch {
    return { context: null, status: "unreadable", fields: [] };
  }
}

/**
 * Compile the model's proposal with the Brain as context (the compiler merges the
 * Brain's fill-ins itself — `mergeCompanyBrainIntoMission` — so it is not merged twice).
 *
 * USER SIZE OUTRANKS THE BRAIN'S SIZE RULE HERE. The shared merge lets a Brain size
 * rule TIGHTEN a range the user stated ("prefer 20–500" became 20–200 under a Brain
 * 11–200 label). In ATLAS the user's explicit words win: when the request states a
 * size, the Brain's bounds are not offered, and that is reported, never silent. The
 * Brain still fills an open size, industries, stages and locations as before.
 */
export function compileWithBrain(input: { query: string; proposal: unknown; requestedCount: number | null; brain: BrainPlanningContext }): {
  mission: unknown; brainApplied: unknown[]; brainRejected: unknown[];
} {
  const base = { originalUserQuery: input.query, proposal: input.proposal, requestedCount: input.requestedCount };
  if (!input.brain.context) return { mission: compileLeadMission(base).final_mission, brainApplied: [], brainRejected: [] };
  const userSize = (compileLeadMission(base).final_mission as { company_profile?: { employee_range?: unknown } }).company_profile?.employee_range ?? null;
  const ctx: BrainMergeInput = { ...input.brain.context };
  const rejected: unknown[] = [];
  if (userSize && (ctx.employee_min != null || ctx.employee_max != null)) {
    rejected.push({ field: "company_profile.employee_range", values: [`${ctx.employee_min ?? ""}-${ctx.employee_max ?? ""}`], reason: "the request states its own size, which outranks the Company Brain's size rule" });
    delete ctx.employee_min; delete ctx.employee_max; delete ctx.employee_policy;
  }
  const compiled = compileLeadMission({ ...base, companyBrain: ctx });
  const ws = (compiled as { workspace_context?: { categories_applied?: unknown[] } }).workspace_context;
  return { mission: compiled.final_mission, brainApplied: ws?.categories_applied ?? [], brainRejected: rejected };
}
