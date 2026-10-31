// Which connected provider runs which search, and what it may cost.
//
// For every hard requirement and every candidate provider, the requirement is
// one of:
//   native       the provider filters on it;
//   post_verify  the provider's rows carry the field, Agentory checks it;
//   verify_via   a separate signal-verification step (Apify) can check it;
//   unsupported  none of the above.
// A provider with any unsupported hard requirement is REFUSED for the mission
// (fail closed) — it is never run with the requirement dropped. An `unmappable`
// requirement refuses every provider and blocks the plan.
//
// The plan is what the user approves. Its hash binds the approval
// (`budget.ts`): a different plan needs a new approval.
//
// Pure.

import { PROVIDERS, type SearchKind } from "./providers.ts";
import { translate } from "./vocabulary.ts";
import { BROADENING_FILTER_KEYS, type BroadeningDimension } from "./requirements.ts";
import type { DiscoveryRequirements, FilterKey, HardRequirement, ProviderId } from "./types.ts";

export type Selection = "auto" | ProviderId[];

export interface ProviderConnectionState {
  provider: ProviderId;
  /** A verified, stored credential for THIS workspace. */
  connected: boolean;
  /** The provider's feature flag (server-side; off by default). */
  enabled: boolean;
  /** Commercial use confirmed for providers that require it. */
  commercialTermsConfirmed: boolean;
  /** Credits left this period, if the provider reports it. */
  remainingCredits: number | null;
  /** Consecutive recent failures (auth, outage). */
  recentFailures: number;
}

export interface PlanLimits {
  maxCreditsPerMission: number;
  maxCreditsPerProvider: Partial<Record<ProviderId, number>>;
  /** Rows one step may read, however many pages. */
  maxRecordsPerStep: number;
  /** How many rows to read per lead owed (yield allowance). */
  overfetch: number;
  /** Candidates the verification step may check. */
  maxVerifications: number;
}

export const DEFAULT_LIMITS: PlanLimits = {
  maxCreditsPerMission: 150,
  maxCreditsPerProvider: {},
  maxRecordsPerStep: 150,
  overfetch: 3,
  maxVerifications: 40,
};

export type RequirementHandling = "native" | "post_verify" | "verify_via" | "unsupported";

export interface RequirementRoute {
  criterionId: string;
  key: FilterKey;
  label: string;
  handling: RequirementHandling;
  via?: ProviderId;
  /** Why a requirement is unsupported, when a filter exists but the value does not translate. */
  note?: string;
}

export interface PlanStep {
  provider: ProviderId;
  kind: SearchKind;
  role: "primary" | "fallback";
  requirements: RequirementRoute[];
  pageSize: number;
  maxPages: number;
  maxRecords: number;
  estimatedCredits: number;
  costUnit: string;
  allowanceLimited: boolean;
}

export interface VerificationStep {
  provider: ProviderId;
  keys: FilterKey[];
  maxRuns: number;
  estimatedCredits: number;
}

export interface RefusedProvider {
  provider: ProviderId;
  reason: string;
  unsupported: { criterionId: string; label: string; key: FilterKey }[];
}

export interface DiscoveryPlan {
  status: "ready" | "blocked";
  blockedReason: string | null;
  selection: Selection;
  steps: PlanStep[];
  verification: VerificationStep | null;
  refused: RefusedProvider[];
  /** Hard requirements no eligible provider can satisfy (shown to the user). */
  unsupportedRequirements: { criterionId: string; label: string; key: FilterKey }[];
  estimatedCredits: Partial<Record<ProviderId, number>>;
  requiresApproval: boolean;
  limits: PlanLimits;
  planHash: string;
}

function eligibility(c: ProviderConnectionState | undefined): string | null {
  if (!c) return "not connected";
  if (!c.enabled) return "disabled";
  if (!c.connected) return "not connected";
  if (PROVIDERS[c.provider].requiresCommercialTermsFlag && !c.commercialTermsConfirmed) return "commercial terms not confirmed";
  if (c.remainingCredits !== null && c.remainingCredits <= 0) return "allowance exhausted";
  return null;
}

function searchKindFor(req: DiscoveryRequirements, p: ProviderId): SearchKind | null {
  const caps = PROVIDERS[p].capabilities;
  const wantsPeople = req.targetEntity === "person" || req.roles.length > 0;
  if (wantsPeople && caps.includes("people_search")) return "people_search";
  if (caps.includes("company_search") && req.targetEntity === "company") return "company_search";
  return null;
}

function relevant(h: HardRequirement, kind: SearchKind): boolean {
  // Roles describe the people, not the company: a company search does not owe them.
  return !(h.key === "roles" && kind === "company_search");
}

function routeRequirement(h: HardRequirement, p: ProviderId, kind: SearchKind, verifier: ProviderId | null): RequirementRoute {
  const base = { criterionId: h.criterionId, key: h.key, label: h.label };
  if (h.key === "unmappable") return { ...base, handling: "unsupported" };
  const d = PROVIDERS[p];
  if (d.native[kind]?.includes(h.key)) {
    // A native filter counts only when the values translate EXACTLY into the
    // provider's vocabulary. Otherwise the provider would ignore or reject it
    // and the search would run wider than asked — refused, never post-verified.
    const t = translate(p, kind, h);
    return t.ok ? { ...base, handling: "native" } : { ...base, handling: "unsupported", note: t.reason };
  }
  if (d.returnsFields[kind]?.includes(h.key)) return { ...base, handling: "post_verify" };
  if (verifier && verifier !== p) {
    const v = PROVIDERS[verifier];
    if (h.key === "signal" || v.returnsFields.company_search?.includes(h.key)) return { ...base, handling: "verify_via", via: verifier };
  }
  if (verifier === p && h.key === "signal") return { ...base, handling: "verify_via", via: p };
  return { ...base, handling: "unsupported" };
}

function score(step: PlanStep, conn: ProviderConnectionState, contactsWanted: boolean): number {
  let s = 0;
  for (const r of step.requirements) s += r.handling === "native" ? 3 : r.handling === "post_verify" ? 2 : 1;
  if (contactsWanted && PROVIDERS[step.provider].searchReturnsContactValues) s += 1;
  s -= step.estimatedCredits / 50;
  s -= conn.recentFailures * 5;
  if (step.allowanceLimited) s -= 2;
  return s;
}

/** FNV-1a over a stable JSON — enough to bind an approval to exactly this plan. */
export function stableHash(v: unknown): string {
  const json = JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1)))
      : val);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) { h ^= json.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

export function planDiscovery(input: {
  requirements: DiscoveryRequirements;
  connections: ProviderConnectionState[];
  selection: Selection;
  limits?: Partial<PlanLimits>;
}): DiscoveryPlan {
  const req = input.requirements;
  const limits: PlanLimits = { ...DEFAULT_LIMITS, ...input.limits, maxCreditsPerProvider: { ...DEFAULT_LIMITS.maxCreditsPerProvider, ...input.limits?.maxCreditsPerProvider } };
  const conns = new Map(input.connections.map((c) => [c.provider, c]));
  const candidates: ProviderId[] = input.selection === "auto" ? ["leadocean", "apollo", "apify"] : [...new Set(input.selection)];
  const refused: RefusedProvider[] = [];
  const unmappable = req.hard.filter((h) => h.key === "unmappable");

  // The verifier: Apify, when eligible and (for an explicit selection) chosen.
  const apifyChosen = input.selection === "auto" || input.selection.includes("apify");
  const verifier: ProviderId | null = apifyChosen && !eligibility(conns.get("apify")) ? "apify" : null;

  const built: { step: PlanStep; conn: ProviderConnectionState }[] = [];
  for (const p of candidates) {
    const why = eligibility(conns.get(p));
    if (why) { refused.push({ provider: p, reason: why, unsupported: [] }); continue; }
    const kind = searchKindFor(req, p);
    // Apify without a search of the right kind is still the verifier, not a refusal.
    if (!kind && p === verifier) continue;
    if (!kind) { refused.push({ provider: p, reason: `no ${req.targetEntity === "person" ? "people" : "company"} search`, unsupported: [] }); continue; }
    // Apify discovery is web research: only when it is the only choice left.
    if (p === "apify" && input.selection === "auto" && built.length > 0) continue;
    const routes = req.hard.filter((h) => relevant(h, kind)).map((h) => routeRequirement(h, p, kind, verifier));
    const unsupported = routes.filter((r) => r.handling === "unsupported");
    if (unsupported.length) {
      const forbidden = unsupported.filter((u) => req.forbidBroadening.some((f) =>
        (BROADENING_FILTER_KEYS[f as BroadeningDimension] ?? []).includes(u.key)));
      refused.push({
        provider: p,
        reason: forbidden.length
          ? `cannot filter or verify ${unsupported.map((u) => u.label + (u.note ? ` (${u.note})` : "")).join(", ")} and broadening is forbidden`
          : `cannot filter or verify ${unsupported.map((u) => u.label + (u.note ? ` (${u.note})` : "")).join(", ")}`,
        unsupported: unsupported.map(({ criterionId, label, key }) => ({ criterionId, label, key })),
      });
      continue;
    }
    const d = PROVIDERS[p];
    const cost = d.cost[kind] ?? { unit: "free" as const, creditsPerUnit: 0 };
    const pageSize = Math.min(d.limits.maxPageSize, Math.max(10, req.requestedCount));
    let maxRecords = Math.min(limits.maxRecordsPerStep, req.requestedCount * limits.overfetch);
    const creditsFor = (records: number) =>
      cost.unit === "record" ? records * cost.creditsPerUnit
        : cost.unit === "page" ? Math.ceil(records / pageSize) * cost.creditsPerUnit
        : cost.unit === "run" ? cost.creditsPerUnit
        : 0;
    const conn = conns.get(p)!;
    let allowanceLimited = false;
    const caps = [conn.remainingCredits, limits.maxCreditsPerProvider[p] ?? null, limits.maxCreditsPerMission].filter((x): x is number => x !== null);
    const cap = caps.length ? Math.min(...caps) : Infinity;
    while (maxRecords > 0 && creditsFor(maxRecords) > cap) { maxRecords -= cost.unit === "page" ? pageSize : 1; allowanceLimited = true; }
    if (maxRecords <= 0) { refused.push({ provider: p, reason: "allowance or limit too small for one page", unsupported: [] }); continue; }
    built.push({
      conn,
      step: {
        provider: p, kind, role: "primary", requirements: routes, pageSize,
        maxPages: Math.min(d.limits.maxPages, Math.ceil(maxRecords / pageSize)),
        maxRecords, estimatedCredits: creditsFor(maxRecords), costUnit: cost.unit, allowanceLimited,
      },
    });
  }

  const contactsWanted = req.roles.length > 0;
  const ordered = input.selection === "auto"
    ? [...built].sort((a, b) => score(b.step, b.conn, contactsWanted) - score(a.step, a.conn, contactsWanted))
    : built;
  // Auto: one primary and at most one fallback, used only if the primary fails.
  const steps = (input.selection === "auto" ? ordered.slice(0, 2) : ordered).map((b, i) => ({ ...b.step, role: (i === 0 || input.selection !== "auto" ? "primary" : "fallback") as PlanStep["role"] }));

  const needsVerifier = steps.flatMap((s) => s.requirements).filter((r) => r.handling === "verify_via");
  const verification: VerificationStep | null = needsVerifier.length && verifier
    ? { provider: verifier, keys: [...new Set(needsVerifier.map((r) => r.key))], maxRuns: Math.min(limits.maxVerifications, req.requestedCount * 2), estimatedCredits: Math.min(limits.maxVerifications, req.requestedCount * 2) }
    : null;

  const estimatedCredits: Partial<Record<ProviderId, number>> = {};
  for (const s of steps) estimatedCredits[s.provider] = (estimatedCredits[s.provider] ?? 0) + s.estimatedCredits;
  if (verification) estimatedCredits[verification.provider] = (estimatedCredits[verification.provider] ?? 0) + verification.estimatedCredits;

  const unsupportedRequirements = steps.length
    ? []
    : dedupeBy(refused.flatMap((r) => r.unsupported), (u) => u.criterionId);
  let blockedReason: string | null = null;
  if (unmappable.length) blockedReason = `requirement not expressible to any provider: ${unmappable.map((u) => u.label).join(", ")}`;
  else if (!steps.length) blockedReason = refused.length ? "no selected provider can satisfy every hard requirement" : "no provider selected";

  const planBody = { selection: input.selection, steps, verification, limits };
  return {
    status: blockedReason ? "blocked" : "ready",
    blockedReason,
    selection: input.selection,
    steps: blockedReason ? [] : steps,
    verification: blockedReason ? null : verification,
    refused,
    unsupportedRequirements: unmappable.length ? unmappable.map(({ criterionId, label, key }) => ({ criterionId, label, key })) : unsupportedRequirements,
    estimatedCredits: blockedReason ? {} : estimatedCredits,
    requiresApproval: !blockedReason && (Object.values(estimatedCredits).some((c) => (c ?? 0) > 0)),
    limits,
    planHash: stableHash(planBody),
  };
}

function dedupeBy<T>(xs: T[], k: (x: T) => string): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(k(x)) ? false : (seen.add(k(x)), true)));
}
