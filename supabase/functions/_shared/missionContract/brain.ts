// COMPANY BRAIN → MISSION CONTRACT, with an explicit authority model.
//
// The Brain supplies context; it never silently changes what the user asked for. Before
// approval, each Brain value either becomes a contract requirement with a Brain origin
// (shown on the card, part of the approved hash), or is reported as not applied. Nothing
// Brain-derived is added after approval.
//
// PRECEDENCE (strongest first):
//   1. The user's request (user_explicit / user_inferred). Always wins.
//   2. An approved organization POLICY (`company_brain_policy`): today the Brain's enforced
//      numeric size rule (`employee_policy`). Hard — but only for a dimension the user left
//      open. When the user stated that dimension, the policy is NOT applied and the conflict
//      is reported (the newer, explicit instruction outranks stored memory).
//   3. A Brain PREFERENCE (`company_brain_preference`): ICP industries, stages, locations.
//      Fills only a dimension the user left open, and only as `preferred` — it ranks, it can
//      never reject a candidate.
//      The workspace's industry exclusions are policy too: an EXPLICIT one that conflicts
//      with what the request asks for blocks approval as a question (neither side wins
//      silently); a GENERIC, inferred one yields to the request, as at run time.
//   4. Historical context (outreach history, previously contacted companies): NOT a
//      requirement. Out of scope here; it may rank or deduplicate results, never gate them.
//   5. System defaults (`system_default`): named policies, listed as assumptions.
//
// Same semantics as the v1 merge (`mergeCompanyBrainIntoMission` + lead-pipeline
// `compileWithBrain`): Brain fill-ins are targets; the size policy is hard unless the user
// stated a size. Pure.

import type { BrainMergeInput } from "../leadMission.ts";
import { namesSameCategory } from "../industryPrecedence.ts";
import { mergeExclusions, normalizePhrase, phrasesOverlap, type ExclusionSource } from "../exclusionPhrase.ts";

/**
 * The Brain input a contract reads: the v1 merge input, plus the workspace's industry
 * exclusions. `explicit` exclusions are the workspace's own rule; `generic` ones (agencies,
 * staffing…) yield to an industry the request itself asks for — the run-time rule
 * (`resolveIndustryExclusions`), applied here, before approval, against the contract.
 */
export type ContractBrainInput = BrainMergeInput & {
  excluded_industries_explicit?: string[];
  excluded_industries_generic?: string[];
  /**
   * SHARED INTERFACE (ATLAS ⇄ Company Brain, 2026-11-28): industries the team excluded through
   * APPROVED Company Brain memory, each with the memory it came from. Kept apart from the
   * profile's own exclusions so the plan can say which source said what. Authority: the same
   * as an explicit workspace exclusion (policy) — it narrows, never targets; a request that asks
   * for the excluded industry becomes a question, never a silent winner. Only entries that are
   * approved, active, unexpired and for this workspace are applied (`servableMemoryExclusions`).
   */
  excluded_industries_memory?: MemoryIndustryExclusion[];
};

/** One approved memory's industry exclusion, as the Company Brain loader serves it. */
export interface MemoryIndustryExclusion {
  /** The industry, as approved ("crypto", "oil and gas"). */
  value: string;
  /** company_brain_memory.id — the provenance the plan shows and the requirement carries. */
  memory_id: string;
  /** Must be "approved". Anything else (pending, rejected…) is never applied. */
  approval_status: string;
  /** Must be "active". stale, disputed, retracted or redacted memory is never applied. */
  lifecycle_status: string;
  /** "workspace" (or absent). A memory scoped to one lead or client is not a workspace rule. */
  scope?: string | null;
  /** When present, must be the workspace being planned. */
  workspace_id?: string | null;
  /** When present and past, the memory has expired. */
  expires_at?: string | null;
}

/** Why a memory exclusion was not applied (shown, never silently dropped). */
export interface RefusedMemoryExclusion { memory_id: string; value: string; reason: string }

/**
 * The memory exclusions that may act: approved, active, workspace-wide, this workspace,
 * unexpired. The loader already filters; this is the contract's own check, so a mistake
 * upstream can only drop an exclusion with a visible reason, never activate one.
 */
export function servableMemoryExclusions(items: readonly MemoryIndustryExclusion[] | undefined, o: { workspaceId?: string | null; now?: Date } = {}): { accepted: MemoryIndustryExclusion[]; refused: RefusedMemoryExclusion[] } {
  const accepted: MemoryIndustryExclusion[] = [], refused: RefusedMemoryExclusion[] = [];
  const now = (o.now ?? new Date()).getTime();
  for (const m of items ?? []) {
    const value = String(m?.value ?? "").trim(), id = String(m?.memory_id ?? "").trim();
    const why = !value || !id ? "missing value or memory id"
      : m.approval_status !== "approved" ? `memory is ${m.approval_status || "not approved"}`
      : m.lifecycle_status !== "active" ? `memory is ${m.lifecycle_status || "not active"}`
      : m.scope && m.scope !== "workspace" ? `memory is scoped to one ${m.scope}, not the workspace`
      : o.workspaceId && m.workspace_id && m.workspace_id !== o.workspaceId ? "memory belongs to another workspace"
      : m.expires_at && Number.isFinite(Date.parse(m.expires_at)) && Date.parse(m.expires_at) <= now ? "memory has expired"
      : null;
    if (why) refused.push({ memory_id: id, value, reason: why });
    else accepted.push({ ...m, value, memory_id: id });
  }
  return { accepted, refused };
}
import { assumptionsOf, type MissionContract, type Requirement } from "./contract.ts";

export const BRAIN_SIZE_POLICY = "company_brain_size_rule" as const;

export interface ContractBrainReport {
  status: "applied" | "nothing_to_apply" | "absent";
  /** Exclusions several sources named, applied ONCE with every source kept (provenance). */
  merged?: { requirementId: string | null; value: string; sources: ExclusionSource[]; memoryIds: string[] }[];
  /** Memory exclusions that were not approved/active/in scope, with why. */
  refusedMemory?: RefusedMemoryExclusion[];
  /** Requirements the Brain added, with their authority. */
  applied: { requirementId: string; authority: "policy" | "preference"; dimension: string }[];
  /** Brain values deliberately not applied, and why (the user's words outrank them). */
  notApplied: { dimension: string; values: string[]; authority: "policy" | "preference"; reason: string }[];
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const fromUser = (r: Requirement) => r.origin.source === "user_explicit" || r.origin.source === "user_inferred";

/**
 * The contract with the Brain applied, and the report the card shows. A contract that
 * already carries Brain requirements is returned unchanged (never applied twice).
 */
export function applyCompanyBrain(contract: MissionContract, brain: ContractBrainInput | null, o: { workspaceId?: string | null; now?: Date } = {}): { contract: MissionContract; report: ContractBrainReport } {
  if (!brain) return { contract, report: { status: "absent", applied: [], notApplied: [] } };
  if (contract.requirements.some((r) => r.origin.source === "company_brain_policy" || r.origin.source === "company_brain_preference")) {
    return { contract, report: { status: "nothing_to_apply", applied: [], notApplied: [] } };
  }
  const reqs = [...contract.requirements];
  const report: ContractBrainReport = { status: "nothing_to_apply", applied: [], notApplied: [] };
  const userStates = (pred: (r: Requirement) => boolean) => contract.requirements.some((r) => fromUser(r) && pred(r));
  const ids = new Set(reqs.map((r) => r.id));
  const add = (r: Requirement, authority: "policy" | "preference") => {
    if (ids.has(r.id)) return;
    ids.add(r.id);
    reqs.push(r);
    report.applied.push({ requirementId: r.id, authority, dimension: r.dimension });
  };
  const base = (id: string, necessity: "required" | "preferred", source: "company_brain_policy" | "company_brain_preference", policy: string | null, label: string, rationale: string) => ({
    id, necessity, evaluability: "ok" as const, alternatives: null,
    origin: { source, span: "", policy },
    display: { label, rationale },
  });

  // 2. Policy: the enforced size rule.
  if (brain.employee_policy && (brain.employee_min != null || brain.employee_max != null)) {
    const min = brain.employee_min ?? null, max = brain.employee_max ?? null;
    const range = `${min ?? ""}–${max ?? ""}`;
    if (userStates((r) => r.dimension === "company_size")) {
      report.notApplied.push({ dimension: "company_size", values: [range], authority: "policy", reason: "the request states its own size, which outranks the Company Brain's size rule" });
    } else if (min !== null && max !== null && min > max) {
      report.notApplied.push({ dimension: "company_size", values: [range], authority: "policy", reason: "the Company Brain's size rule is contradictory (min above max)" });
    } else {
      add({ ...base("brain:company_size", "required", "company_brain_policy", BRAIN_SIZE_POLICY, `Company size: ${range} employees (workspace rule)`,
        "your Company Brain's size rule, applied because the request states no size"), dimension: "company_size", min, max }, "policy");
    }
  }
  // 3. Preferences: fill only what the user left open, never required.
  const prefer = (dimension: "geography" | "industry" | "company_stage", values: readonly string[] | undefined, closed: boolean, make: (v: string) => Requirement) => {
    const vs = [...new Set((values ?? []).map((v) => v.trim()).filter(Boolean))];
    if (!vs.length) return;
    if (closed) {
      report.notApplied.push({ dimension, values: vs, authority: "preference", reason: "the request already states this; the Company Brain does not add to or narrow it" });
      return;
    }
    for (const v of vs) add(make(v), "preference");
  };
  prefer("geography", brain.locations, userStates((r) => r.dimension === "geography" && r.polarity === "include"), (v) => ({
    ...base(`brain:geography:${slug(v)}`, "preferred", "company_brain_preference", null, `Geography preference: ${v}`, "from your Company Brain; ranks, never rejects"),
    dimension: "geography", polarity: "include", place: v, scope: null,
  }));
  prefer("industry", brain.industries, userStates((r) => r.dimension === "industry" && r.facet === "industry" && r.polarity === "include"), (v) => ({
    ...base(`brain:industry:${slug(v)}`, "preferred", "company_brain_preference", null, `Industry preference: ${v}`, "from your Company Brain; ranks, never rejects"),
    dimension: "industry", facet: "industry", polarity: "include", value: v,
  }));
  prefer("company_stage", brain.stages, userStates((r) => r.dimension === "company_stage"), (v) => ({
    ...base(`brain:company_stage:${slug(v)}`, "preferred", "company_brain_preference", null, `Stage preference: ${v}`, "from your Company Brain; ranks, never rejects"),
    dimension: "company_stage", stage: v,
  }));

  // 2b. Policy: the workspace's industry exclusions (hard, attributed, visible) — one resolver
  // for contract mode and the legacy path (resolveWorkspaceExclusions).
  const asked = contract.requirements.filter((r): r is Extract<Requirement, { dimension: "industry" }> =>
    r.dimension === "industry" && r.polarity === "include" && fromUser(r)).map((r) => r.value);
  const requestExcludes = contract.requirements.filter((r) => r.dimension === "exclusion" && fromUser(r)
    && (r as { field?: string }).field === "excluded_company_types").flatMap((r) => (r as { values?: string[] }).values ?? []);
  const ex = resolveWorkspaceExclusions({ asked, requestExcludes, brain, ...o });
  const conflicts: MissionContract["ambiguities"] = ex.conflicts.map((c) => ({ span: c.span, question: c.question }));
  report.notApplied.push(...ex.notApplied);
  if (ex.merged.length) report.merged = ex.merged;
  if (ex.refusedMemory.length) report.refusedMemory = ex.refusedMemory;
  for (const a of ex.apply) {
    const r = { ...base(a.id, "required", "company_brain_policy", a.policy, a.label, a.rationale),
      dimension: "exclusion", field: "excluded_company_types", values: [a.value] } as Requirement;
    if (a.memoryIds.length) r.origin = { ...r.origin, memoryIds: a.memoryIds };
    add(r, "policy");
  }

  if (report.applied.length || report.notApplied.length) report.status = "applied";
  return { contract: { ...contract, requirements: reqs, assumptions: assumptionsOf(reqs), ambiguities: [...contract.ambiguities, ...conflicts] }, report };
}

// ── WORKSPACE EXCLUSIONS: one resolver, every discovery mode ──────────────────

export interface WorkspaceExclusion {
  /** brain:exclusion:industry:<slug> (the profile's rule, alone or with memory) or memory:exclusion:industry:<slug>. */
  id: string;
  value: string;
  policy: "company_brain_excluded_industry" | "company_brain_memory_exclusion" | "company_brain_generic_exclusion";
  label: string;
  rationale: string;
  sources: ExclusionSource[];
  memoryIds: string[];
}

export interface WorkspaceExclusionResolution {
  /** Exclusions to apply as REQUIRED, workspace-authority criteria. */
  apply: WorkspaceExclusion[];
  /** The workspace's own rule (profile or approved memory) against what the request asks for: a question. */
  conflicts: { span: string; value: string; question: string }[];
  notApplied: ContractBrainReport["notApplied"];
  merged: NonNullable<ContractBrainReport["merged"]>;
  refusedMemory: RefusedMemoryExclusion[];
}

/**
 * The workspace's industry exclusions against one request (pure). The SAME rule in contract
 * mode (applyCompanyBrain) and in the legacy path (lead-pipeline without the contract), so a
 * workspace exclusion can never apply in one and be ignored in the other.
 *
 *   * the profile's explicit exclusions and approved memory exclusions are one authority
 *     (policy): applied once per industry (normalizePhrase), every source and memory id kept;
 *   * a request that asks for an excluded industry → a question; neither side wins silently;
 *   * a request that already excludes it → nothing added, the shared provenance recorded;
 *   * a GENERIC exclusion (agencies, staffing…) yields to an industry the request asks for;
 *   * matching is whole-word (exclusionPhrase.ts), never substring.
 */
export function resolveWorkspaceExclusions(i: {
  asked: readonly string[]; requestExcludes: readonly string[]; brain: ContractBrainInput | null;
  workspaceId?: string | null; now?: Date;
}): WorkspaceExclusionResolution {
  const out: WorkspaceExclusionResolution = { apply: [], conflicts: [], notApplied: [], merged: [], refusedMemory: [] };
  if (!i.brain) return out;
  const claimOf = (v: string) => i.asked.find((a) => namesSameCategory(v, a) || phrasesOverlap(a, v));
  const memory = servableMemoryExclusions(i.brain.excluded_industries_memory, { workspaceId: i.workspaceId, now: i.now });
  out.refusedMemory = memory.refused;
  const explicit = mergeExclusions([
    ...i.requestExcludes.map((value) => ({ value, source: "request" as const })),
    ...(i.brain.excluded_industries_explicit ?? []).map((value) => ({ value, source: "brain_profile" as const })),
    ...memory.accepted.map((m) => ({ value: m.value, source: "brain_memory" as const, memoryId: m.memory_id })),
  ]);
  for (const x of explicit) {
    if (!x.sources.some((src) => src !== "request")) continue; // the request's own exclusion: already a requirement
    const memoryOnly = !x.sources.includes("brain_profile") && !x.sources.includes("request");
    const id = `${memoryOnly ? "memory" : "brain"}:exclusion:industry:${slug(x.value)}`;
    if (x.sources.length > 1) out.merged.push({ requirementId: x.sources.includes("request") ? null : id, value: x.value, sources: x.sources, memoryIds: x.memoryIds });
    if (x.sources.includes("request")) continue; // the user already excludes it; provenance recorded above
    const who = memoryOnly ? "approved memory" : x.memoryIds.length ? "workspace rule and approved memory" : "workspace rule";
    const claimed = claimOf(x.value);
    if (claimed) {
      out.conflicts.push({ span: claimed, value: x.value, question: `Your Company Brain (${who}) excludes "${x.value}", but this request asks for "${claimed}". Should this search include them anyway?` });
      out.notApplied.push({ dimension: "exclusion", values: [x.value], authority: "policy", reason: `conflicts with the request ("${claimed}"); approval needs your decision` });
      continue;
    }
    out.apply.push({ id, value: x.value, policy: memoryOnly ? "company_brain_memory_exclusion" : "company_brain_excluded_industry",
      label: `Excluding: ${x.value} (${who})`, rationale: memoryOnly ? "an approved Company Brain memory excludes this industry" : "your Company Brain excludes this industry",
      sources: x.sources, memoryIds: x.memoryIds });
  }
  for (const v of [...new Set((i.brain.excluded_industries_generic ?? []).map((x) => x.trim()).filter(Boolean))]) {
    if (explicit.some((x) => x.key === normalizePhrase(v))) continue;
    const claimed = claimOf(v);
    if (claimed) {
      out.notApplied.push({ dimension: "exclusion", values: [v], authority: "policy", reason: `the request asks for "${claimed}", which outranks the Company Brain's generic exclusion` });
      continue;
    }
    out.apply.push({ id: `brain:exclusion:industry:${slug(v)}`, value: v, policy: "company_brain_generic_exclusion", label: `Excluding: ${v} (workspace rule)`,
      rationale: "your Company Brain excludes this industry", sources: ["brain_profile_generic"], memoryIds: [] });
  }
  return out;
}

/** Only the exclusion fields of a Brain input (what the legacy path signs and replays); null when there are none. */
export function workspaceExclusionsOf(b: ContractBrainInput | null | undefined): ContractBrainInput | null {
  if (!b) return null;
  const pick = (xs: unknown) => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
  const explicit = pick(b.excluded_industries_explicit), generic = pick(b.excluded_industries_generic);
  const memory = Array.isArray(b.excluded_industries_memory) ? b.excluded_industries_memory.filter((m) => m && typeof m === "object") : [];
  if (!explicit.length && !generic.length && !memory.length) return null;
  return {
    ...(explicit.length ? { excluded_industries_explicit: explicit } : {}),
    ...(generic.length ? { excluded_industries_generic: generic } : {}),
    ...(memory.length ? { excluded_industries_memory: memory } : {}),
  };
}

/**
 * G4 — WHAT THE APPROVAL ASSUMED ABOUT THE WORKSPACE. A fingerprint of everything in the Company
 * Brain input that can change a plan's requirements: ICP fill-ins, the size rule, the profile's
 * exclusions and the approved memory exclusions that may act (servable only — a pending memory
 * changes nothing, so it does not change the fingerprint). Signed into the approval; a run whose
 * workspace now fingerprints differently is refused (lead-pipeline service, code brain_changed).
 */
export async function workspaceRulesFingerprint(b: ContractBrainInput | null | undefined, o: { workspaceId?: string | null; now?: Date } = {}): Promise<string> {
  const list = (xs: unknown) => [...new Set((Array.isArray(xs) ? xs : []).map((x) => normalizePhrase(x)).filter(Boolean))].sort();
  // EFFECTIVE rules only: no Brain and a Brain whose only change is a pending memory fingerprint alike.
  const x = b ?? {};
  const view = {
    industries: list(x.industries), business_models: list(x.business_models), stages: list(x.stages), locations: list(x.locations),
    employee: x.employee_policy ? [x.employee_min ?? null, x.employee_max ?? null] : null,
    excluded_explicit: list(x.excluded_industries_explicit), excluded_generic: list(x.excluded_industries_generic),
    excluded_memory: servableMemoryExclusions(x.excluded_industries_memory, o).accepted.map((m) => `${normalizePhrase(m.value)}#${m.memory_id}`).sort(),
  };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(view)));
  return `wr1:${[...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
}
