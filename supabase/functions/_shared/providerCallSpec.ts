// LEAD V2 P2 — THE PROVIDER CALL SPEC. WHAT IS COMPILED IS WHAT IS SENT.
//
// Before P2 a provider input passed through up to six layers after the planner
// wrote it, and several rewrote semantic fields silently: `compileActorInput`
// overwrote `maxItems` with the execution quota; `buildIdentitySearchInput`
// replaced the planner's identity input (maxItems 5 → 15); memo23's size clamp
// turned a Company Brain preference into a hard `maxEmployeeSize` filter; the
// amendment replaced the discovery question each pass. The planner's JSON and
// the executed JSON disagreed and nothing recorded why.
//
// The spec compiler is the one place an input is finalised. It takes the
// planner's actor-native proposal (from the current RetrievalPlan version) and
// the engine's builder output, and resolves EVERY field with a recorded
// decision — proposed value, final value, who changed it, and why:
//
//   template binding      {{step_1.name}} → the candidate's value
//   registered engine     platform policy (people data, email enrichment), the
//                         identity strategy, evidence bindings — each with a reason
//   criteria policy       a filter field (geography, industry, size, stage,
//                         exclusions) survives only with a HARD criterion;
//                         target / preference / inferred criteria never filter
//   mission hard          hard geography fills or corrects the company geography field
//   provider contract     fields and enum values the live schema lacks are dropped
//   budget policy         the count field is clamped to what the call ceiling affords
//
// A protected field (query, titles, locations, size, stage, count, mode,
// exclusions) that the ENGINE changed without a registered reason is not
// applied: the planner's value stands and the attempted rewrite is recorded in
// `engine_rewrites_rejected`. The finished spec is deep-frozen; the engine sends
// `serialized_input` and nothing else.
//
// Pure.

import type { CallPurpose, Ceilings, CostModelLike } from "./budgetPolicy.ts";
import { affordableRows, callCeilingFor, estimateCallUsd } from "./budgetPolicy.ts";
import {
  hardLocations, hardSizeBound, mayFilter, type CriteriaExecutionPolicy, type ExecutionDimension,
} from "./criteriaExecutionPolicy.ts";
import {
  COUNT_FIELD, CRITERIA_FILTER_ROLES, PRIMARY_GEOGRAPHY_FIELD, PROTECTED_ROLES, roleOf, type FieldRole,
} from "./actorFieldRoles.ts";
import { canonicalJson, sha256Hex } from "./providerInputFingerprint.ts";

export const PROVIDER_CALL_SPEC_VERSION = "provider-call-spec-v1" as const;

export type ChangedBy =
  | "retrieval_planner"
  | "template_binding"
  | "identity_strategy"
  | "evidence_policy"
  | "people_policy"
  | "operational_requirement"
  | "mission_hard_constraint"
  | "criteria_policy"
  | "provider_contract"
  | "budget_policy"
  | "evidence_planner"
  | "engine";

export interface SpecFieldProvenance {
  field: string;
  role: FieldRole;
  proposed_value: unknown;
  final_value: unknown;
  changed_by: ChangedBy;
  reason: string;
  changed: boolean;
}

export interface EngineRewriteRejected {
  field: string;
  role: FieldRole;
  engine_value: unknown;
  kept_value: unknown;
}

export interface ProviderCallSpec {
  version: typeof PROVIDER_CALL_SPEC_VERSION;
  provider_call_id: string;
  idempotency_key: string;
  mission_hash: string;
  plan_id: string | null;
  plan_version: number | null;
  route_id: string | null;
  candidate_keys: string[];
  purpose: CallPurpose;
  provider: "apify" | "firecrawl";
  actor: string;
  capability: string;
  proposed_input: Record<string, unknown> | null;
  /** The exact JSON sent. Frozen. */
  serialized_input: Readonly<Record<string, unknown>>;
  provenance: SpecFieldProvenance[];
  engine_rewrites_rejected: EngineRewriteRejected[];
  cost: { estimate_usd: number; ceiling_usd: number };
  status: "intended" | "refused_policy" | "refused_budget";
  refusal: { code: string; detail: string } | null;
}

/** A value the engine sets with a reason code accepts. */
export interface RegisteredEngineField { changed_by: ChangedBy; reason: string }

export interface SpecCompileInput {
  actorKey: string;
  capability: string;
  purpose: CallPurpose;
  /** The planner's actor-native input for this call, from the current plan version. */
  proposed: Record<string, unknown> | null;
  /** What the engine's builder produced. */
  engine: Record<string, unknown>;
  policy: CriteriaExecutionPolicy;
  plan: { plan_id: string | null; version: number | null; route_id: string | null;
    route_anchor: string | null; route_refused: string | null };
  candidate_keys?: readonly string[];
  scope: { workspace_id: string; lineage_id: string };
  mission_hash: string;
  ceilings: Ceilings;
  cost_model: CostModelLike | null;
  /** Live schema fields (name + enum), from `ACTOR_INPUT_CONTRACTS`. */
  contract_fields: ReadonlyArray<{ name: string; enum?: readonly string[] }> | null;
  /** Card enums and numeric limits, from the catalog. */
  card_enums?: Readonly<Record<string, readonly string[]>>;
  card_limits?: Readonly<Record<string, number | string>>;
  /** Extra count bounds the engine asserts (e.g. discovery pool size), each recorded. */
  count_bounds?: ReadonlyArray<{ value: number; changed_by: ChangedBy; reason: string }>;
  /** memo23 size enum ceiling for a hard bound. Injected (lives in the engine). */
  size_ceiling?: (max: number | null) => string | null;
  page?: number;
}

const isTemplate = (v: unknown): boolean =>
  (typeof v === "string" && v.includes("{{")) ||
  (Array.isArray(v) && v.some((x) => typeof x === "string" && x.includes("{{")));

const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

/**
 * Engine values accepted without a planner proposal, per actor and purpose.
 * Anything protected and absent here is not applied.
 */
export function registeredEngineFields(actorKey: string, purpose: CallPurpose): Record<string, RegisteredEngineField> {
  const people: RegisteredEngineField = { changed_by: "people_policy", reason: "people data is unlock-gated and never fetched automatically" };
  switch (actorKey) {
    case "apify_yc_companies_memo23": return {
      enrichEmails: { changed_by: "people_policy", reason: "paid email enrichment is never automatic" },
      scrapeFounderDetails: people,
      scrapeOpenJobs: { changed_by: "evidence_policy", reason: "hiring evidence is read from each company's open jobs" },
      mode: { changed_by: "operational_requirement", reason: "the discovery stage consumes company rows" },
    };
    case "apify_yc_companies_solidcode": return {
      includeFounders: people,
      includeJobs: { changed_by: "evidence_policy", reason: "hiring evidence is read from each company's jobs" },
    };
    case "apify_linkedin_company_search":
      return purpose === "identity" ? {
        searchQuery: { changed_by: "identity_strategy", reason: "guarded name search for a candidate without a source LinkedIn URL" },
        scraperMode: { changed_by: "operational_requirement", reason: "domain confirmation needs each row's website; short rows omit it" },
        startPage: { changed_by: "operational_requirement", reason: "identity reads the first page only" },
      } : {};
    case "apify_linkedin_company_details": return {
      companies: { changed_by: "template_binding", reason: "the resolved LinkedIn URLs of this batch" },
      searches: { changed_by: "template_binding", reason: "the resolved identities of this batch" },
    };
    case "apify_linkedin_job_search": return {
      company: { changed_by: "template_binding", reason: "the identity-resolved LinkedIn URLs of this batch" },
      jobTitles: { changed_by: "evidence_policy", reason: "titles from the mission's role vocabulary" },
      postedLimit: { changed_by: "evidence_policy", reason: "posting window from the mission" },
    };
    case "apify_google_news": return {
      keywords: { changed_by: "template_binding", reason: "the named company this evidence is about" },
    };
    case "apify_linkedin_company_employees": return {
      companies: { changed_by: "template_binding", reason: "the company whose people were unlocked" },
      profileScraperMode: people, jobTitles: people, maxItemsPerCompany: people,
    };
    case "apify_people_search": return {
      currentCompanies: { changed_by: "template_binding", reason: "the company whose people were unlocked" },
      profileScraperMode: people, currentJobTitles: people,
    };
    default: return {};
  }
}

const ROLE_DIMENSION: Partial<Record<FieldRole, ExecutionDimension>> = {
  geography: "geography", industry: "industry", company_size: "company_size",
  company_stage: "company_stage", exclusion: "exclusion",
};

const US = new Set(["us", "usa", "u.s.", "u.s.a.", "united states", "united states of america", "america"]);
const normPlace = (s: string) => {
  const t = s.trim().toLowerCase();
  return US.has(t) ? "united states" : t;
};
function geographyValue(actorKey: string, field: string, hard: string[]): unknown {
  const mapped = hard.map((h) => {
    if (normPlace(h) === "united states") {
      return actorKey === "apify_yc_companies_memo23" && field === "regions" ? "United States of America"
        : actorKey === "apify_funding_rounds_datahyena" ? "US" : "United States";
    }
    return h;
  });
  return [...new Set(mapped)];
}
function geographyConsistent(value: unknown, hard: string[]): boolean {
  const vals = (Array.isArray(value) ? value : [value]).map((v) => normPlace(String(v ?? ""))).filter(Boolean);
  if (vals.length === 0) return true;
  const h = hard.map(normPlace);
  return vals.every((v) => h.some((x) => x === v || v.includes(x) || x.includes(v) || (x === "united states" && v === "us")));
}

const UNRESTRICTED = new Set(["all batches", "all industries", "all"]);
const isUnrestricted = (v: unknown) =>
  (Array.isArray(v) ? v : [v]).every((x) => UNRESTRICTED.has(String(x ?? "").trim().toLowerCase()) || x === "" || x == null);

export function compileProviderCallSpec(i: SpecCompileInput): ProviderCallSpec {
  const prov: SpecFieldProvenance[] = [];
  const rejected: EngineRewriteRejected[] = [];
  const final: Record<string, unknown> = {};
  const registered = registeredEngineFields(i.actorKey, i.purpose);
  const proposed = i.proposed;
  const record = (field: string, proposedValue: unknown, finalValue: unknown, by: ChangedBy, reason: string) => {
    const existing = prov.findIndex((p) => p.field === field);
    const entry: SpecFieldProvenance = {
      field, role: roleOf(i.actorKey, field), proposed_value: proposedValue ?? null,
      final_value: finalValue ?? null, changed_by: by, reason,
      changed: !same(proposedValue, finalValue),
    };
    if (existing >= 0) {
      // Keep the planner's original proposal; the later decision wins.
      entry.proposed_value = prov[existing].proposed_value;
      entry.changed = !same(entry.proposed_value, finalValue);
      prov[existing] = entry;
    } else prov.push(entry);
  };
  const set = (field: string, value: unknown) => {
    if (value === undefined) delete final[field];
    else final[field] = value;
  };

  // 1. Resolve every field the planner or the engine named.
  const fields = new Set([...Object.keys(proposed ?? {}), ...Object.keys(i.engine ?? {})]);
  for (const field of fields) {
    const role = roleOf(i.actorKey, field);
    const hasP = !!proposed && proposed[field] !== undefined;
    const hasE = i.engine?.[field] !== undefined;
    const p = hasP ? proposed![field] : undefined;
    const e = hasE ? i.engine[field] : undefined;
    const reg = registered[field];

    if (hasP && isTemplate(p)) {
      if (hasE) { set(field, e); record(field, p, e, "template_binding", `template ${JSON.stringify(p)} bound to this call's values`); }
      else record(field, p, undefined, "template_binding", "template had no bound value; omitted");
      continue;
    }
    if (hasP && hasE && !same(p, e)) {
      if (role === "count") { set(field, p); record(field, p, p, "retrieval_planner", "proposed count; bounds applied below"); continue; }
      if (reg) { set(field, e); record(field, p, e, reg.changed_by, reg.reason); continue; }
      if (!PROTECTED_ROLES.has(role)) { set(field, e); record(field, p, e, "engine", "operational field set by the engine"); continue; }
      set(field, p);
      record(field, p, p, "retrieval_planner", "the planner's value stands; the engine's rewrite was not applied");
      rejected.push({ field, role, engine_value: e, kept_value: p });
      continue;
    }
    if (hasP) { set(field, p); record(field, p, p, "retrieval_planner", "proposed by the retrieval planner"); continue; }
    // Engine-only field.
    if (reg) { set(field, e); record(field, undefined, e, reg.changed_by, reg.reason); continue; }
    if (role === "count") continue; // bounds below decide the count
    if (!PROTECTED_ROLES.has(role)) { set(field, e); record(field, undefined, e, "engine", "operational default"); continue; }
    if (proposed === null) {
      set(field, e);
      record(field, undefined, e, "engine", "no planner proposal exists for this call; the engine's value is recorded");
      continue;
    }
    rejected.push({ field, role, engine_value: e, kept_value: undefined });
    record(field, undefined, undefined, "retrieval_planner",
      "the plan did not set this field; the engine's addition was not applied");
  }

  // 1b. Forbidden fields: credentials and external data sinks never leave.
  for (const field of Object.keys(final)) {
    if (roleOf(i.actorKey, field) !== "forbidden") continue;
    const before = final[field];
    delete final[field];
    record(field, proposed?.[field] ?? before, undefined, "provider_contract",
      "the platform never sends credentials or external data-sink settings to a provider");
  }

  // 2. Criteria: filter fields need a HARD criterion.
  const hardGeo = hardLocations(i.policy);
  for (const field of Object.keys(final)) {
    const role = roleOf(i.actorKey, field);
    if (!CRITERIA_FILTER_ROLES.has(role)) continue;
    const dim = ROLE_DIMENSION[role]!;
    if (registered[field]) continue;
    if (!mayFilter(i.policy, dim)) {
      if (isUnrestricted(final[field])) continue;
      const before = final[field];
      delete final[field];
      record(field, before, undefined, "criteria_policy",
        `no hard ${dim} criterion — target, preference and inferred criteria guide ranking but never filter retrieval`);
      continue;
    }
    if (dim === "geography" && hardGeo.length && !geographyConsistent(final[field], hardGeo)) {
      const value = geographyValue(i.actorKey, field, hardGeo);
      const before = final[field];
      set(field, value);
      record(field, before, value, "mission_hard_constraint", `must match the hard geography: ${hardGeo.join(", ")}`);
    }
  }
  const geoField = PRIMARY_GEOGRAPHY_FIELD[i.actorKey];
  const geoApplies = i.purpose === "discovery" || i.purpose === "identity";
  if (geoApplies && geoField && hardGeo.length && final[geoField] === undefined) {
    const value = geographyValue(i.actorKey, geoField, hardGeo);
    set(geoField, value);
    record(geoField, proposed?.[geoField], value, "mission_hard_constraint", `filled from the hard geography: ${hardGeo.join(", ")}`);
  }
  const hardSize = hardSizeBound(i.policy);
  if (i.actorKey === "apify_yc_companies_memo23" && hardSize?.max != null && i.size_ceiling) {
    const ceiling = i.size_ceiling(hardSize.max);
    if (ceiling && final.maxEmployeeSize !== ceiling) {
      const before = final.maxEmployeeSize;
      set("maxEmployeeSize", ceiling);
      record("maxEmployeeSize", proposed?.maxEmployeeSize, ceiling, "provider_contract",
        `smallest enum band covering the hard maximum of ${hardSize.max} employees (was ${JSON.stringify(before ?? null)})`);
    }
  }

  // 3. Provider contract: fields and enum values the live schema lacks.
  if (i.contract_fields) {
    const byName = new Map(i.contract_fields.map((f) => [f.name, f]));
    for (const field of Object.keys(final)) {
      const f = byName.get(field);
      if (!f) {
        const before = final[field];
        delete final[field];
        record(field, proposed?.[field] ?? before, undefined, "provider_contract", `${i.actorKey}'s live schema has no field "${field}"`);
        continue;
      }
      const allowed = f.enum ?? i.card_enums?.[field];
      if (allowed && allowed.length) {
        const vals = Array.isArray(final[field]) ? final[field] as unknown[] : [final[field]];
        const kept = vals.filter((v) => allowed.includes(String(v)));
        if (kept.length !== vals.length) {
          const before = final[field];
          if (kept.length === 0) delete final[field];
          else final[field] = Array.isArray(before) ? kept : kept[0];
          record(field, proposed?.[field] ?? before, final[field], "provider_contract",
            `value(s) not in the live enum for ${field}: ${vals.filter((v) => !allowed.includes(String(v))).map(String).join(", ")}`);
        }
      }
      const limit = i.card_limits?.[field];
      if (typeof limit === "number" && Array.isArray(final[field]) && (final[field] as unknown[]).length > limit) {
        const before = final[field];
        final[field] = (before as unknown[]).slice(0, limit);
        record(field, proposed?.[field] ?? before, final[field], "provider_contract", `published limit of ${limit} values`);
      }
    }
  }

  // 4. Count: the smallest of proposal, contract, engine bounds and the call ceiling.
  const ceiling = callCeilingFor(i.ceilings, i.purpose, i.plan.route_anchor);
  const countField = COUNT_FIELD[i.actorKey];
  if (countField) {
    type Bound = { value: number; by: ChangedBy; reason: string };
    const bounds: Bound[] = [];
    const current = typeof final[countField] === "number" ? final[countField] as number : null;
    const engineCount = typeof i.engine?.[countField] === "number" ? i.engine[countField] as number : null;
    if (current != null && current > 0) bounds.push({ value: current, by: "retrieval_planner", reason: "proposed count" });
    else if (engineCount != null && engineCount > 0 && proposed === null) {
      bounds.push({ value: engineCount, by: "engine", reason: "no planner proposal; engine count recorded" });
    }
    const limit = i.card_limits?.[countField];
    if (typeof limit === "number") bounds.push({ value: limit, by: "provider_contract", reason: `published limit ${limit}` });
    for (const b of i.count_bounds ?? []) bounds.push({ value: b.value, by: b.changed_by, reason: b.reason });
    if (i.cost_model) {
      const units = i.actorKey === "apify_linkedin_job_search"
        ? Math.max(1, (final.jobTitles as unknown[] | undefined)?.length ?? 1) * Math.max(1, (final.locations as unknown[] | undefined)?.length ?? 1)
        : i.actorKey === "apify_google_news"
        ? Math.max(1, ((final.keywords as unknown[] | undefined)?.length ?? 0) + ((final.topics as unknown[] | undefined)?.length ?? 0))
        : 1;
      const rows = Math.floor(affordableRows(i.actorKey, i.cost_model, { ...final, [countField]: 1 }, ceiling) / units);
      bounds.push({ value: rows, by: "budget_policy", reason: `the $${ceiling} ${i.purpose} call ceiling affords ${rows}` });
    }
    const positive = bounds.filter((b) => Number.isFinite(b.value) && b.value > 0);
    if (positive.length) {
      const win = positive.reduce((a, b) => (b.value < a.value ? b : a));
      if (current !== win.value) {
        set(countField, win.value);
        record(countField, proposed?.[countField], win.value, win.by, win.reason);
      }
    }
  }

  // 5. Cost, identity, refusal.
  const serialized = JSON.parse(JSON.stringify(final)) as Record<string, unknown>;
  const estimate = i.cost_model ? estimateCallUsd(i.actorKey, i.cost_model, serialized) : 0;
  const page = i.page ?? 0;
  const pageless = { ...serialized };
  for (const k of Object.keys(pageless)) if (roleOf(i.actorKey, k) === "page") delete pageless[k];
  const idempotency_key = sha256Hex(
    `${i.scope.workspace_id}:${i.scope.lineage_id}:apify:${i.actorKey}:${i.purpose}:${canonicalJson(pageless)}:${page}`);
  let status: ProviderCallSpec["status"] = "intended";
  let refusal: ProviderCallSpec["refusal"] = null;
  if (i.plan.route_refused) {
    status = "refused_policy";
    refusal = { code: "route_refused", detail: i.plan.route_refused };
  } else if (estimate > ceiling + 1e-9) {
    status = "refused_budget";
    refusal = { code: "call_ceiling", detail: `estimate $${estimate} exceeds the $${ceiling} ${i.purpose} call ceiling` };
  }

  return deepFreeze({
    version: PROVIDER_CALL_SPEC_VERSION,
    provider_call_id: `pc_${idempotency_key.slice(0, 26)}`,
    idempotency_key,
    mission_hash: i.mission_hash,
    plan_id: i.plan.plan_id, plan_version: i.plan.version, route_id: i.plan.route_id,
    candidate_keys: [...(i.candidate_keys ?? [])],
    purpose: i.purpose, provider: "apify", actor: i.actorKey, capability: i.capability,
    proposed_input: proposed ? JSON.parse(JSON.stringify(proposed)) : null,
    serialized_input: serialized,
    provenance: prov,
    engine_rewrites_rejected: rejected,
    cost: { estimate_usd: estimate, ceiling_usd: ceiling },
    status, refusal,
  });
}

/** Compact form for the checkpoint and trace. */
export function specSummary(s: ProviderCallSpec) {
  return {
    provider_call_id: s.provider_call_id, idempotency_key: s.idempotency_key, actor: s.actor,
    capability: s.capability, purpose: s.purpose, plan_version: s.plan_version, route_id: s.route_id,
    status: s.status, estimate_usd: s.cost.estimate_usd, ceiling_usd: s.cost.ceiling_usd,
    changes: s.provenance.filter((p) => p.changed).map((p) => ({
      field: p.field, proposed_value: p.proposed_value, final_value: p.final_value,
      changed_by: p.changed_by, reason: p.reason,
    })),
    engine_rewrites_rejected: s.engine_rewrites_rejected,
  };
}
