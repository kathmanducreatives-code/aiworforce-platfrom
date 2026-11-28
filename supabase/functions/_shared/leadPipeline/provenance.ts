// G2 — DISCOVERY REQUIREMENT PROVENANCE (ATLAS V5, 2026-11-28).
//
// Where each requirement of THIS plan came from, so the planning card can answer:
//   what did I ask for · what did my Company Brain add · what did approved memories add ·
//   what did GPT infer · which system rules apply · what will ATLAS actually search for.
//
// It is a VIEW over what the plan already is: it reads the criteria being planned (after any
// Flexible relaxation) and the Brain report, and never changes either. Not in the plan hash.
// Authority stays where it is (missionContract/brain.ts, leadMission.ts): the user's words
// outrank the Brain; Brain policy narrows; Brain preferences only rank.
// Pure.

import type { DiscoverySpec } from "./strategy.ts";

export type ProvenanceGroup = "request" | "brain_default" | "brain_memory" | "gpt_inferred" | "system";
export type ProvenanceNecessity = "mandatory" | "preferred" | "inferred";

export interface ProvenanceEntry {
  id: string;
  label: string;
  value: string;
  group: ProvenanceGroup;
  necessity: ProvenanceNecessity;
  /** Relaxed from required to a ranking preference by Flexible Discovery. */
  relaxed: boolean;
  /** Approved memories it came from (company_brain_memory.id). */
  memoryIds: string[];
  /** Every source that named it, when more than one did ("brain_profile", "brain_memory", "request"). */
  alsoFrom: string[];
}

export interface NotAppliedEntry { group: "brain_default" | "brain_memory"; dimension: string; values: string[]; reason: string }

export interface PlanProvenance {
  entries: ProvenanceEntry[];
  /** Brain values deliberately NOT applied, and why (the request outranks them, or a conflict). */
  notApplied: NotAppliedEntry[];
  /** Memory exclusions refused (pending, stale, expired, other scope…). */
  refusedMemory: { memory_id: string; value: string; reason: string }[];
  /** What the providers are actually asked for, after relaxation. */
  searchFor: { required: string[]; preferred: string[] };
}

type Crit = { id: string; kind: string; label?: string; dimension: string; value?: unknown; source?: string; memory_ids?: string[] };
type BrainReport = {
  applied?: unknown[]; rejected?: unknown[];
  merged?: { requirementId: string | null; value: string; sources: string[]; memoryIds: string[] }[];
  refusedMemory?: { memory_id: string; value: string; reason: string }[];
} | null | undefined;

const valueText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(valueText).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("value" in o) return valueText(o.value);
    if ("min" in o || "max" in o) return `${o.min ?? ""}–${o.max ?? ""}`;
  }
  return "";
};

function groupOf(c: Crit, policyOf: (id: string) => string | null): ProvenanceGroup {
  if (/^memory:/.test(c.id) || policyOf(c.id) === "company_brain_memory_exclusion") return "brain_memory";
  switch (c.source) {
    case "user_explicit": return "request";
    case "user_inferred": return "gpt_inferred";
    case "company_brain_policy": case "company_brain_preference": case "company_brain": return "brain_default";
    case "system_default": return "system";
    default: return /^brain:/.test(c.id) ? "brain_default" : "system";
  }
}

/**
 * The plan's provenance. `before` is the spec before Flexible relaxation (same as `spec` in
 * Strict); `memoryIdsOf` / `policyOf` read the contract's origins when there is a contract.
 */
export function planProvenance(i: {
  spec: DiscoverySpec; before: DiscoverySpec; brain: BrainReport;
  memoryIdsOf?: (id: string) => string[]; policyOf?: (id: string) => string | null;
  /** Named system defaults the contract assumed ("hiring: last 30 days"), shown as system rules. */
  assumptions?: { requirementId: string; policy: string; text: string }[];
}): PlanProvenance {
  const policyOf = i.policyOf ?? (() => null);
  const wasHard = new Map(i.before.requirements.criteria.map((c) => [c.id, c.kind === "hard"]));
  const merged = new Map((i.brain?.merged ?? []).filter((m) => m.requirementId).map((m) => [m.requirementId!, m]));
  const entries: ProvenanceEntry[] = (i.spec.requirements.criteria as unknown as Crit[]).map((c) => {
    const group = groupOf(c, policyOf);
    const hardBefore = wasHard.get(c.id) ?? c.kind === "hard";
    const m = merged.get(c.id);
    const memoryIds = [...new Set([...(i.memoryIdsOf?.(c.id) ?? []), ...(c.memory_ids ?? []), ...(m?.memoryIds ?? [])])].sort();
    return {
      id: c.id, label: String(c.label ?? c.dimension), value: valueText(c.value), group,
      necessity: group === "gpt_inferred" && !hardBefore ? "inferred" : hardBefore ? "mandatory" : "preferred",
      relaxed: hardBefore && c.kind !== "hard", memoryIds, alsoFrom: m && m.sources.length > 1 ? m.sources : [],
    };
  });
  for (const a of i.assumptions ?? []) {
    if (entries.some((e) => e.group === "system" && e.label === a.text)) continue;
    entries.push({ id: `assumption:${a.requirementId}:${a.policy}`, label: a.text, value: a.policy, group: "system", necessity: "mandatory", relaxed: false, memoryIds: [], alsoFrom: [] });
  }
  const notApplied: NotAppliedEntry[] = (i.brain?.rejected ?? []).flatMap((r) => {
    const o = r as { dimension?: unknown; field?: unknown; values?: unknown; reason?: unknown };
    const values = Array.isArray(o.values) ? o.values.map(String) : [];
    const reason = typeof o.reason === "string" ? o.reason : "";
    if (!values.length && !reason) return [];
    return [{ group: /approved memory/.test(reason) ? "brain_memory" as const : "brain_default" as const, dimension: String(o.dimension ?? o.field ?? ""), values, reason }];
  });
  // Requirements the request itself already stated that the Brain ALSO named: shown once, both sources.
  for (const m of i.brain?.merged ?? []) {
    if (m.requirementId) continue;
    const e = entries.find((x) => x.group === "request" && x.value.toLowerCase().includes(m.value.toLowerCase()));
    if (e) { e.alsoFrom = m.sources; e.memoryIds = [...new Set([...e.memoryIds, ...m.memoryIds])].sort(); }
  }
  return {
    entries, notApplied, refusedMemory: i.brain?.refusedMemory ?? [],
    searchFor: {
      required: i.spec.requirements.hard.map((h) => h.label),
      preferred: [...(i.spec.preferredEmployees ? [`Company size ${i.spec.preferredEmployees.min ?? ""}–${i.spec.preferredEmployees.max ?? ""}`] : []), ...i.spec.requirements.preferences.map((p) => p.label)],
    },
  };
}
