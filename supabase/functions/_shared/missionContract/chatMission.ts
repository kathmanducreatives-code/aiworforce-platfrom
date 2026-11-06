// THE PRODUCTION-CHAT BRIDGE: Mission Contract ⇄ the `lead-mission-v1` object that
// pilot-chat → orchestrate → run-agent carry.
//
// Production chat stores, approves and executes a LeadMissionV1. This module lets that path
// speak the contract WITHOUT a second interpreter:
//
//   * `missionFromContract` — an approved contract → the LeadMissionV1 the engine runs. Its
//     criteria are the contract's compiled criteria, FROZEN (criteria-v1), so every reader
//     (`criteriaOf`) acts on exactly the approved requirements. The legacy carrier fields
//     (`company_profile`, `required_signals`, `hard_constraints`, …) are written FROM the
//     contract, never from the sentence, and `carrierDivergence` proves a legacy re-derivation
//     of those carriers would not add, drop, weaken or strengthen a hard requirement.
//   * `contractBindingOf` — any mission (v1 history included) → its contract hash, through the
//     one compatibility boundary. Zero model calls. This is the approval identity the card
//     stores and a Start must reproduce (`verifyApprovalBinding`).
//   * `compareContracts` — the shadow comparison (baseline reading vs v4 reading): added,
//     removed, strengthened, weakened requirements, and the approval, plan and qualification
//     differences they cause.
//
// Pure: no I/O, no model call.

import type { LeadMissionV1, MissionSignal } from "../leadMission.ts";
import { deriveMissionCriteria } from "../missionCriteria.ts";
import { freezeCriteria } from "../missionCriteriaReader.ts";
import { contractFromMission } from "./boundary.ts";
import { compileContract } from "./compile.ts";
import { checkCompiled } from "./invariants.ts";
import {
  approvability, canonicalJson, contractHash, contractProblems, hardRequirementSet, isExecutable, type MissionContract, MISSION_CONTRACT_VERSION,
  type Requirement,
} from "./contract.ts";

// ── Flags ────────────────────────────────────────────────────────────────────
//
// Three independent, versioned switches. Every one is OFF unless set to exactly "enabled"
// (or "enforce"): an unset, empty or misspelt value is off, so production stays on v1.

export interface ChatContractFlags {
  /** Shadow: interpret with v4 BESIDE v1 and record the comparison. One extra model call; never executed. */
  shadow: boolean;
  /** The approval card and the run come from the v4 contract (TEST / canary only until authorised). */
  v4: boolean;
  /** A Start whose mission does not reproduce the card's contract hash is refused (otherwise logged). */
  enforceBinding: boolean;
}

/**
 * `AGENTORY_CHAT_CONTRACT_V4_WORKSPACES` (comma-separated workspace ids), when set, scopes
 * shadow and v4 to exactly those workspaces (canary). Binding enforcement is never scoped:
 * it only ever refuses a Start that differs from its own card.
 */
export function chatContractFlags(readEnv: (k: string) => string | undefined, workspaceId?: string | null): ChatContractFlags {
  const on = (k: string, v = "enabled") => (readEnv(k) ?? "").trim() === v;
  const list = (readEnv("AGENTORY_CHAT_CONTRACT_V4_WORKSPACES") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const inScope = !list.length || (!!workspaceId && list.includes(workspaceId));
  return {
    shadow: on("AGENTORY_CHAT_CONTRACT_V4_SHADOW") && inScope,
    v4: on("AGENTORY_CHAT_CONTRACT_V4") && inScope,
    enforceBinding: on("AGENTORY_CHAT_CONTRACT_BINDING", "enforce"),
  };
}

// ── Approval binding ─────────────────────────────────────────────────────────

export const CHAT_CONTRACT_BINDING_VERSION = "chat-contract-binding-v1" as const;

export type ContractBinding =
  | { version: typeof CHAT_CONTRACT_BINDING_VERSION; contract_version: typeof MISSION_CONTRACT_VERSION; hash: string }
  | { version: typeof CHAT_CONTRACT_BINDING_VERSION; contract_version: null; hash: null; unconvertible: string[] };

/**
 * The contract identity of a mission: what the card binds.
 *
 *   * A v4 mission carries the contract it was compiled from. Its identity is THAT contract's
 *     hash — but only if the mission's effective criteria are exactly that contract's (I1):
 *     a mission whose criteria were edited beside an untouched contract is unconvertible.
 *   * Any other mission (v1, v3, stored history) is converted by the one compatibility
 *     boundary, losslessly or not at all.
 */
export async function contractBindingOf(mission: unknown): Promise<ContractBinding> {
  const m = (mission ?? {}) as { mission_contract?: MissionContract };
  if (m.mission_contract && typeof m.mission_contract === "object") {
    const problems = [...contractProblems(m.mission_contract).map((p) => p.detail), ...checkCompiled(m.mission_contract, m).map((v) => v.detail)];
    if (problems.length) return { version: CHAT_CONTRACT_BINDING_VERSION, contract_version: null, hash: null, unconvertible: problems.slice(0, 10) };
    return { version: CHAT_CONTRACT_BINDING_VERSION, contract_version: MISSION_CONTRACT_VERSION, hash: await contractHash(m.mission_contract) };
  }
  const b = contractFromMission(m as never);
  if (!b.ok) return { version: CHAT_CONTRACT_BINDING_VERSION, contract_version: null, hash: null, unconvertible: b.lossy.slice(0, 10) };
  return { version: CHAT_CONTRACT_BINDING_VERSION, contract_version: MISSION_CONTRACT_VERSION, hash: await contractHash(b.contract) };
}

export type BindingVerdict =
  /** The started mission means exactly what the card showed. */
  | { status: "match"; hash: string }
  /** The started mission differs from the card: approval does not cover it. */
  | { status: "mismatch"; approved: string; started: string | null }
  /** A card stored before binding existed (or a client that sends no card id): historical behaviour. */
  | { status: "unbound" }
  /** The card's mission could not be converted losslessly when it was shown: nothing to compare. */
  | { status: "unconvertible" };

/**
 * Does the mission a Start sends reproduce the contract the card showed?
 * `stored` is the binding read from the card's own message row (server-side), never from
 * the client's request.
 */
export async function verifyApprovalBinding(started: unknown, stored: unknown): Promise<BindingVerdict> {
  const s = stored as Partial<ContractBinding> | null | undefined;
  if (!s || s.version !== CHAT_CONTRACT_BINDING_VERSION) return { status: "unbound" };
  if (!s.hash) return { status: "unconvertible" };
  const now = await contractBindingOf(started);
  return now.hash === s.hash ? { status: "match", hash: s.hash } : { status: "mismatch", approved: s.hash, started: now.hash };
}

/** What a Start does with a verdict. Only an ENFORCED mismatch refuses; history is never refused. */
export function bindingDecision(v: BindingVerdict, flags: Pick<ChatContractFlags, "enforceBinding">): "run" | "refuse" {
  return v.status === "mismatch" && flags.enforceBinding ? "refuse" : "run";
}

export const BINDING_REFUSAL_REPLY =
  "This Start doesn't match the plan you approved — its requirements changed after the card was shown. " +
  "Nothing was run and nothing was spent. Please review the updated card and approve it again.";

// ── Contract → LeadMissionV1 ─────────────────────────────────────────────────

const OUTPUT_FOR_ENTITY: Record<string, Pick<LeadMissionV1, "target_entity" | "requested_output" | "mission_type">> = {
  person: { target_entity: "person", requested_output: "contact_ready_leads", mission_type: "qualified_lead_sourcing" },
  company: { target_entity: "company", requested_output: "qualified_companies", mission_type: "company_research" },
};

type Sig = Extract<Requirement, { dimension: "signal" }>;

function stagesOf(stage: unknown): string[] {
  if (typeof stage === "string") return [stage];
  if (Array.isArray(stage)) return stage.filter((s): s is string => typeof s === "string");
  return [];
}

function signalOf(r: Sig): MissionSignal {
  const qualifier: Record<string, unknown> = { ...r.qualifiers };
  if (r.roleTerms) qualifier.role_terms = [...r.roleTerms];
  if (r.roleFamilies) qualifier.role_families = [...r.roleFamilies];
  if (r.excludedRoleTerms) qualifier.excluded_role_terms = [...r.excludedRoleTerms];
  if (r.roleMatch !== null) qualifier.role_match = r.roleMatch;
  return {
    type: r.kind,
    ...(r.roleFamilies ? { role_families: [...r.roleFamilies] } : {}),
    ...(r.window ? { timeframe_days: r.window.days } : {}),
    event: r.event as never, subject: r.subject as never, qualifier: qualifier as never, phrase: r.origin.span,
  };
}

export class ContractNotExecutableError extends Error {
  constructor(readonly reasons: string[]) {
    super(`the mission contract cannot be executed: ${reasons.join("; ")}`);
    this.name = "ContractNotExecutableError";
  }
}

/**
 * An APPROVABLE contract → the frozen LeadMissionV1 production chat carries.
 *
 * Carriers hold only REQUIRED include requirements (a preference never narrows a provider
 * query); preferences go to `soft_preferences`, exclusions to `hard_constraints` under the
 * field the engine already checks. The frozen criteria are authoritative regardless.
 * Capability fields are filled by the caller's capability graph, exactly as for v1.
 */
export async function missionFromContract(contract: MissionContract): Promise<LeadMissionV1 & {
  mission_contract: MissionContract; mission_contract_hash: string;
}> {
  const ok = approvability(contract);
  if (!ok.ok) throw new ContractNotExecutableError(ok.reasons);
  const compiled = await compileContract(contract);
  const req = contract.requirements.filter(isExecutable);
  const hard = (r: Requirement) => r.necessity === "required";
  const profile: LeadMissionV1["company_profile"] = { business_models: [], verticals: [], stages: [], locations: [] };
  const soft: Record<string, unknown> = {};
  const hardC: Record<string, unknown> = {};
  const pushSoft = (k: string, v: unknown) => { soft[k] = [...((soft[k] as unknown[]) ?? []), v]; };
  for (const r of req) {
    switch (r.dimension) {
      case "geography":
        if (r.polarity !== "include") break;
        if (hard(r)) { profile.locations.push(r.place); if (r.scope) profile.geography_scope = r.scope; } else pushSoft("locations", r.place);
        break;
      case "industry":
        if (r.polarity !== "include") break;
        if (hard(r)) (r.facet === "business_model" ? profile.business_models : profile.verticals).push(r.value);
        else pushSoft(r.facet === "business_model" ? "business_models" : "verticals", r.value);
        break;
      case "company_size": {
        const range = { ...(r.min !== null ? { min: r.min } : {}), ...(r.max !== null ? { max: r.max } : {}) };
        if (hard(r)) profile.employee_range = range; else soft.employee_range = range;
        break;
      }
      case "company_stage":
        if (hard(r)) profile.stages.push(...stagesOf(r.stage)); else for (const s of stagesOf(r.stage)) pushSoft("stages", s);
        break;
      case "known_companies":
        profile.known_companies = [...(profile.known_companies ?? []), ...r.companies];
        break;
      case "exclusion":
        hardC[r.field] = [...((hardC[r.field] as unknown[]) ?? []), ...(Array.isArray(r.values) ? r.values : [r.values])];
        break;
    }
  }
  const signals = req.filter((r): r is Sig => r.dimension === "signal");
  const shape = OUTPUT_FOR_ENTITY[contract.deliverable.entity] ?? OUTPUT_FOR_ENTITY.company;
  const roles = [...contract.deliverable.personRoles];
  const mission = {
    version: "lead-mission-v1" as const,
    original_user_query: contract.objective,
    ...shape,
    requested_count: contract.deliverable.count,
    company_profile: profile,
    required_signals: signals.filter(hard).map(signalOf),
    required_signal_terms: compiled.required_signal_terms,
    decision_makers: { roles, current_employment_required: roles.length > 0 },
    directives: { disallowed_broadening: [...contract.forbidBroadening] },
    hard_constraints: hardC,
    soft_preferences: soft,
    required_capabilities: [],
    prohibited_capabilities: [],
    field_provenance: provenanceOf(req),
    confidence: 1,
    mission_parser_source: "mission_contract_v4",
    criteria: compiled.criteria,
    mission_contract: contract,
    mission_contract_hash: compiled.mission_contract_hash,
  };
  return freezeCriteria(mission) as never;
}

const PROVENANCE: Record<string, string> = {
  user_explicit: "explicit_user_request", user_inferred: "gpt_inference", company_brain_policy: "company_brain_policy",
  company_brain_preference: "company_brain", system_default: "system_default",
};
const CARRIER_FIELD: Partial<Record<Requirement["dimension"], (r: Requirement) => string>> = {
  geography: () => "company_profile.locations",
  industry: (r) => (r as Extract<Requirement, { dimension: "industry" }>).facet === "business_model" ? "company_profile.business_models" : "company_profile.verticals",
  company_size: () => "company_profile.employee_range",
  company_stage: () => "company_profile.stages",
  known_companies: () => "company_profile.known_companies",
  signal: () => "required_signals",
};
/** Each carrier field's provenance, from the requirements written into it (the strongest wins). */
function provenanceOf(req: readonly Requirement[]): Record<string, string> {
  const out: Record<string, string> = {};
  const order = Object.keys(PROVENANCE);
  for (const r of req) {
    const field = CARRIER_FIELD[r.dimension]?.(r);
    if (!field) continue;
    const prev = out[field];
    const next = PROVENANCE[r.origin.source];
    if (!prev || order.indexOf(r.origin.source) < Object.values(PROVENANCE).indexOf(prev)) out[field] = next;
  }
  return out;
}

/**
 * Would a LEGACY reader (one that re-derives criteria from the carriers instead of reading
 * the frozen ones) see different HARD requirements? Each entry names one. Empty ⇒ the
 * carriers and the approved contract agree on everything that can reject a candidate.
 */
export function carrierDivergence(mission: LeadMissionV1 & { criteria?: unknown }): { added: string[]; removed: string[] } {
  const { criteria: frozen, criteria_contract_version: _v, criteria_fingerprint: _f, ...carriers } = mission as unknown as Record<string, unknown>;
  const key = (c: Record<string, unknown>) => canonicalJson({ d: c.dimension, v: c.value });
  const hardKeys = (cs: unknown) => new Set(((cs ?? []) as Record<string, unknown>[]).filter((c) => c.kind === "hard").map(key));
  const approved = hardKeys(frozen);
  const legacy = hardKeys(deriveMissionCriteria(carriers as unknown as LeadMissionV1));
  return { added: [...legacy].filter((k) => !approved.has(k)), removed: [...approved].filter((k) => !legacy.has(k)) };
}

// ── Shadow comparison ────────────────────────────────────────────────────────

/** A requirement's identity independent of ids, wording and provenance. */
export function meaningKey(r: Requirement): string {
  const l = (s: string) => s.trim().toLowerCase();
  switch (r.dimension) {
    case "geography": return `geography:${r.polarity}:${l(r.place)}`;
    case "industry": return `${r.facet}:${r.polarity}:${l(r.value)}`;
    case "company_size": return "company_size";
    case "company_stage": return `company_stage:${canonicalJson(r.stage)}`;
    case "known_companies": return `known_companies:${r.companies.map(l).sort().join("|")}`;
    case "signal": return `signal:${r.kind}`;
    case "exclusion": return `exclusion:${r.field}:${canonicalJson(r.values)}`;
    case "unsupported": return `unsupported:${canonicalJson(r.value)}`;
  }
}

/** What execution acts on for one requirement (no id, card text or provenance). */
function actedOn(r: Requirement): string {
  const { id: _i, display: _d, origin: _o, ...rest } = r as unknown as Record<string, unknown>;
  if (rest.dimension === "signal" && rest.window) {
    const w = rest.window as { days: number; basis: string };
    rest.window = { days: w.days, basis: w.basis };
  }
  return canonicalJson(rest);
}

export interface ContractComparison {
  version: "contract-shadow-v1";
  baseline_hash: string | null;
  candidate_hash: string;
  identical_meaning: boolean;
  added: string[];
  removed: string[];
  /** A preference that became required. */
  strengthened: string[];
  /** A requirement that became a preference. */
  weakened: string[];
  /** Same requirement, different detail the engine acts on (bounds, window, roles…). */
  changed: string[];
  approval: { baseline: boolean; candidate: boolean; candidate_reasons: string[] };
  plan_hard: { added: string[]; removed: string[] };
  qualification: { added: string[]; removed: string[] };
}

/**
 * Baseline (the v1 reading, through the boundary) vs candidate (the v4 contract). Pure and
 * deterministic; it stores meaning keys only, never the user's sentence.
 */
export async function compareContracts(baseline: MissionContract | null, candidate: MissionContract): Promise<ContractComparison> {
  const index = (c: MissionContract | null) => new Map((c?.requirements ?? []).filter(isExecutable).map((r) => [meaningKey(r), r]));
  const a = index(baseline), b = index(candidate);
  const added = [...b.keys()].filter((k) => !a.has(k)).sort();
  const removed = [...a.keys()].filter((k) => !b.has(k)).sort();
  const strengthened: string[] = [], weakened: string[] = [], changed: string[] = [];
  for (const [k, rb] of b) {
    const ra = a.get(k);
    if (!ra) continue;
    if (ra.necessity === "preferred" && rb.necessity === "required") strengthened.push(k);
    else if (ra.necessity === "required" && rb.necessity === "preferred") weakened.push(k);
    else if (actedOn({ ...ra, necessity: rb.necessity } as Requirement) !== actedOn(rb)) changed.push(k);
  }
  const hardKeys = (c: MissionContract | null) => {
    if (!c) return new Set<string>();
    const ids = hardRequirementSet(c);
    return new Set(c.requirements.filter((r) => ids.has(r.id)).map(meaningKey));
  };
  const ha = hardKeys(baseline), hb = hardKeys(candidate);
  const crit = async (c: MissionContract | null) => {
    if (!c) return new Set<string>();
    try {
      // What the evaluator CHECKS: necessity, dimension, value, scope, window length and
      // whether it is one of alternatives. Ids, wording and provenance are not checks.
      return new Set((await compileContract(c)).criteria.map((x) => {
        const k = x as unknown as Record<string, unknown>;
        const w = k.time_window as { days?: unknown } | undefined;
        return canonicalJson({ kind: k.kind, dimension: k.dimension, value: k.value, scope: k.geography_scope ?? null,
          days: w?.days ?? null, alternatives: Array.isArray(k.any_of) ? k.any_of.length : 0, status: k.status ?? "ok" });
      }));
    } catch { return new Set<string>(); }
  };
  const qa = await crit(baseline), qb = await crit(candidate);
  const ap = (c: MissionContract | null) => (c ? approvability(c) : { ok: false as const, reasons: ["no baseline contract"] });
  const apb = ap(candidate);
  const sorted = (s: string[]) => s.sort();
  const result: ContractComparison = {
    version: "contract-shadow-v1",
    baseline_hash: baseline ? await contractHash(baseline) : null,
    candidate_hash: await contractHash(candidate),
    identical_meaning: false,
    added, removed, strengthened: sorted(strengthened), weakened: sorted(weakened), changed: sorted(changed),
    approval: { baseline: ap(baseline).ok, candidate: apb.ok, candidate_reasons: apb.ok ? [] : apb.reasons.slice(0, 5) },
    plan_hard: { added: [...hb].filter((k) => !ha.has(k)).sort(), removed: [...ha].filter((k) => !hb.has(k)).sort() },
    qualification: { added: [...qb].filter((k) => !qa.has(k)), removed: [...qa].filter((k) => !qb.has(k)) },
  };
  result.identical_meaning = !added.length && !removed.length && !strengthened.length && !weakened.length && !changed.length &&
    !result.plan_hard.added.length && !result.plan_hard.removed.length;
  return result;
}

// ── Execution-side integrity ─────────────────────────────────────────────────

export type ContractIntegrity =
  | { status: "not_contract" }
  | { status: "valid"; hash: string }
  | { status: "invalid"; detail: string[] };

/**
 * Before any work on a mission: a v4 mission (one carrying `mission_contract`) must still
 * be exactly its contract — the criteria every reader acts on equal the contract's (I1),
 * and the contract equals the hash it was approved under. A v1 mission is untouched.
 */
export async function contractMissionIntegrity(mission: unknown): Promise<ContractIntegrity> {
  const m = (mission ?? {}) as { mission_contract?: unknown; mission_contract_hash?: unknown };
  if (m.mission_contract === undefined && m.mission_contract_hash === undefined) return { status: "not_contract" };
  try {
    const b = await contractBindingOf(mission);
    if (!b.hash) return { status: "invalid", detail: "unconvertible" in b ? b.unconvertible : ["no contract"] };
    if (b.hash !== m.mission_contract_hash) return { status: "invalid", detail: ["the contract does not match the hash it was approved under"] };
    return { status: "valid", hash: b.hash };
  } catch (e) {
    return { status: "invalid", detail: [(e as Error).message.slice(0, 200)] };
  }
}
