// The structured discovery specification: what the user asked for, as data.
//
// GPT reads the natural-language request and proposes a spec; this module is
// the gate between the model and everything that costs money:
//
//   * every HARD constraint must quote the user's own words (`grounding`); a hard
//     constraint whose quote is not in the request is demoted to a preference and
//     reported in `repairs` — the model cannot invent a gate
//   * quantity is clamped to the compiler's bounds; unknown providers, signal kinds
//     and roles are dropped, never guessed
//   * contact needs default to none: discovery never asks for phones
//
// The shared engine's criteria come from the REAL mission compiler
// (`specToRequirements`), fed a sentence that states only the grounded hard
// constraints — the same path the ICP walk uses (leadPipeline/icp.ts).

import { compileLeadMission, MAX_REQUESTED_OPPORTUNITIES, MIN_REQUESTED_OPPORTUNITIES } from "../leadMissionCompiler.ts";
import { requirementsFromMission } from "../discoveryProviders/requirements.ts";
import type { DiscoveryRequirements, ProviderId } from "../discoveryProviders/types.ts";
import { PROVIDER_IDS } from "../discoveryProviders/types.ts";

export const SPEC_VERSION = "discovery-spec-v1" as const;

export type SignalKind = "hiring" | "posts" | "funding" | "expansion" | "leadership_change";
export const SIGNAL_KINDS: readonly SignalKind[] = ["hiring", "posts", "funding", "expansion", "leadership_change"];

export type HardKey = "geography_hq" | "geography_person" | "employee_range" | "roles" | "industry" | `signal:${SignalKind}`;

export interface SignalRequirement {
  kind: SignalKind;
  /** Roles being hired for, or post topics. */
  roles?: string[];
  topics?: string[];
  /** Freshness the user asked for; null = not stated (never invented). */
  withinDays: number | null;
  /** Required (gates the request match) or preferred (ranking only). */
  required: boolean;
}

export interface DiscoverySpec {
  version: typeof SPEC_VERSION;
  query: string;
  target: "people" | "companies";
  quantity: number;
  roles: string[];
  company: { industries: string[]; descriptors: string[]; employees: { min: number | null; max: number | null } | null };
  geography: { hq: string[]; person: string[] };
  signals: SignalRequirement[];
  /** Which constraints are hard. Each one is grounded in `grounding`. */
  hard: HardKey[];
  /** Hard key → the exact words of the request it rests on. */
  grounding: Partial<Record<HardKey, string>>;
  preferences: string[];
  contact: { phone: "none" | "wanted"; email: "none" | "wanted" };
  verification: { headquarters: boolean; size: boolean; founderRelationship: boolean };
  budget: { leadoceanRecords: number | null; apifyUsd: number | null };
  providers: { requested: ProviderId[] | null; excluded: ProviderId[] };
}

export interface SpecResult { spec: DiscoverySpec | null; repairs: string[]; error: string | null }

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : []);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const norm = (s: string) => s.toLowerCase().replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim();

/** Validate a model proposal against the request it came from. Pure. */
export function validateSpec(raw: unknown, query: string): SpecResult {
  const repairs: string[] = [];
  if (!raw || typeof raw !== "object") return { spec: null, repairs, error: "the interpreter returned no object" };
  const r = raw as Record<string, unknown>;
  const q = norm(query);
  const target = r.target === "companies" ? "companies" : "people";
  let quantity = Math.round(num(r.quantity) ?? 25);
  if (quantity > MAX_REQUESTED_OPPORTUNITIES || quantity < MIN_REQUESTED_OPPORTUNITIES) {
    repairs.push(`quantity ${quantity} clamped to ${MIN_REQUESTED_OPPORTUNITIES}–${MAX_REQUESTED_OPPORTUNITIES}`);
    quantity = Math.max(MIN_REQUESTED_OPPORTUNITIES, Math.min(MAX_REQUESTED_OPPORTUNITIES, quantity));
  }
  const company = (r.company ?? {}) as Record<string, unknown>;
  const emp = (company.employees ?? null) as Record<string, unknown> | null;
  const employees = emp && (num(emp.min) != null || num(emp.max) != null) ? { min: num(emp.min), max: num(emp.max) } : null;
  const geo = (r.geography ?? {}) as Record<string, unknown>;
  const signals: SignalRequirement[] = (Array.isArray(r.signals) ? r.signals : []).flatMap((s): SignalRequirement[] => {
    const x = (s ?? {}) as Record<string, unknown>;
    if (!SIGNAL_KINDS.includes(x.kind as SignalKind)) { repairs.push(`unknown signal kind ${String(x.kind)} dropped`); return []; }
    const within = num(x.withinDays);
    return [{ kind: x.kind as SignalKind, roles: arr(x.roles), topics: arr(x.topics), withinDays: within && within > 0 ? Math.min(365, within) : null, required: x.required === true }];
  });

  // Hard constraints must be grounded in the user's words.
  const grounding: Partial<Record<HardKey, string>> = {};
  const g = (r.grounding ?? {}) as Record<string, unknown>;
  const hard: HardKey[] = [];
  for (const k of arr(r.hard) as HardKey[]) {
    const quote = typeof g[k] === "string" ? norm(g[k] as string) : "";
    if (quote.length >= 2 && q.includes(quote)) { hard.push(k); grounding[k] = g[k] as string; }
    else repairs.push(`hard constraint ${k} is not grounded in the request${quote ? ` ("${g[k]}" not found)` : ""}: kept as a preference`);
  }
  // A required signal is hard only when grounded too.
  for (const s of signals) {
    if (s.required && !hard.includes(`signal:${s.kind}`)) { s.required = false; repairs.push(`signal ${s.kind} marked required without grounding: preferred instead`); }
  }
  const prov = (r.providers ?? {}) as Record<string, unknown>;
  const requested = arr(prov.requested).filter((p) => (PROVIDER_IDS as readonly string[]).includes(p)) as ProviderId[];
  const dropped = arr(prov.requested).filter((p) => !(PROVIDER_IDS as readonly string[]).includes(p));
  if (dropped.length) repairs.push(`unknown provider(s) ${dropped.join(", ")} ignored`);
  const contact = (r.contact ?? {}) as Record<string, unknown>;
  const budget = (r.budget ?? {}) as Record<string, unknown>;
  const ver = (r.verification ?? {}) as Record<string, unknown>;
  const spec: DiscoverySpec = {
    version: SPEC_VERSION, query, target, quantity,
    roles: arr(r.roles),
    company: { industries: arr(company.industries), descriptors: arr(company.descriptors), employees },
    geography: { hq: arr(geo.hq), person: arr(geo.person) },
    signals, hard, grounding,
    preferences: [...arr(r.preferences), ...(arr(r.hard) as string[]).filter((k) => !hard.includes(k as HardKey))],
    contact: { phone: contact.phone === "wanted" ? "wanted" : "none", email: contact.email === "wanted" ? "wanted" : "none" },
    // Hard HQ / size are always verified; the model may only add checks, never remove them.
    verification: { headquarters: hard.includes("geography_hq") || ver.headquarters === true, size: hard.includes("employee_range") || ver.size === true, founderRelationship: ver.founderRelationship === true },
    budget: { leadoceanRecords: num(budget.leadoceanRecords), apifyUsd: num(budget.apifyUsd) },
    providers: { requested: requested.length ? requested : null, excluded: arr(prov.excluded).filter((p) => (PROVIDER_IDS as readonly string[]).includes(p)) as ProviderId[] },
  };
  if (spec.target === "people" && !spec.roles.length) repairs.push("people requested without roles: decision-maker roles left to ranking");
  return { spec, repairs, error: null };
}

export const INTERPRETER_SYSTEM_PROMPT = [
  "You turn a B2B lead request into a discovery specification (JSON only).",
  "Fields: target (people|companies), quantity, roles[], company{industries[], descriptors[], employees{min,max}},",
  "geography{hq[], person[]}, signals[{kind: hiring|posts|funding|expansion|leadership_change, roles[], topics[], withinDays, required}],",
  "hard[] (keys: geography_hq, geography_person, employee_range, roles, industry, signal:<kind>), grounding{key: exact words from the request},",
  "preferences[], contact{phone: none|wanted, email: none|wanted}, verification{headquarters, size, founderRelationship},",
  "budget{leadoceanRecords, apifyUsd}, providers{requested[], excluded[]}.",
  "Rules: a constraint is hard ONLY if the request states it; quote the words in grounding. Never invent a filter, a freshness window or a size.",
  "Words like 'about', 'ideally', 'prefer' make a preference, not a hard constraint. Do not request phone numbers unless the user asks.",
].join("\n");

/** The model call, injected: production wires aiProvider.generateJson; tests pass a fixture. */
export type InterpreterModel = (system: string, user: string) => Promise<unknown>;

export async function interpretQuery(query: string, model: InterpreterModel): Promise<SpecResult> {
  let raw: unknown;
  try { raw = await model(INTERPRETER_SYSTEM_PROMPT, query); }
  catch (e) { return { spec: null, repairs: [], error: `interpreter failed (${(e as Error)?.name ?? "error"})` }; }
  return validateSpec(raw, query);
}

/** The shared engine's requirements, from the REAL compiler, on grounded hard constraints only. */
export function specToRequirements(spec: DiscoverySpec): DiscoveryRequirements {
  const hq = spec.hard.includes("geography_hq") ? spec.geography.hq : [];
  const size = spec.hard.includes("employee_range") ? spec.company.employees : null;
  const roles = spec.hard.includes("roles") || spec.target === "people" ? spec.roles : [];
  const parts = [
    `Find ${hq.length ? `${hq.join(" or ")}-headquartered ` : ""}companies`,
    size ? ` with ${size.min ?? 1}-${size.max ?? "any"} employees` : "",
    roles.length ? ` and their ${roles.slice(0, 4).join(", ")}` : "",
  ];
  const proposal = {
    requested_contact_ready_count: null, company_types: [], soft_preferences: [], preferred_signals: [], adjacent_signals: [], excluded_signals: [],
    allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } },
    required_evidence: [], preferred_source_strategy: [], evaluation_instructions: "", founder_unlock_recommended: false, confidence: 0.8, unknowns: [],
    requested_opportunity_count: spec.quantity, geographies: hq,
    employee_range: { min: size?.min ?? null, max: size?.max ?? null },
    decision_maker_roles: roles,
    hard_constraints: hq.length ? [{ field: "geography", operator: "in", value: hq, reason: "stated by the user" }] : [],
    disallowed_broadening: [...(hq.length ? ["geography"] : []), ...(size ? ["employee_range"] : []), ...(roles.length ? ["role"] : [])],
    required_capabilities: ["general_company_discovery", "company_details_enrichment", "portfolio_ranking"],
  };
  const compiled = compileLeadMission({ originalUserQuery: parts.join("") + ".", proposal: proposal as never, requestedCount: spec.quantity });
  return { ...requirementsFromMission(compiled.final_mission as never), originalQuery: spec.query };
}
