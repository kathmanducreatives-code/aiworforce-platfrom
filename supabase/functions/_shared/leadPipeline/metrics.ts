// Yield metrics and the "how many candidates for N usable numbers" estimate.
//
// The funnel is counted per stage from a pipeline run, never assumed:
//
//   discovered → unique (after dedupe) → new (not already in Agentory)
//   → eligible (shared engine) → decision-maker → has_phone (provider flag)
//   → looked up → person-associated number → independently verified direct
//   → outreach-ready (no hold, no CRM block)
//
// The estimate uses each stage's observed rate and its Wilson 95% LOWER bound,
// so a small sample gives a conservative (larger) candidate count, and a stage
// with no observations is reported as unknown instead of guessed.

export interface FunnelCounts {
  discovered: number;
  unique: number;
  newToAgentory: number;
  eligible: number;
  pending: number;
  ineligible: number;
  decisionMaker: number;
  hasPhoneFlag: number;
  lookedUp: number;
  personAssociated: number;
  verifiedDirect: number;
  switchboard: number;
  invalidOrMismatched: number;
  noNumber: number;
  outreachReady: number;
}

export const EMPTY_FUNNEL: FunnelCounts = Object.freeze({
  discovered: 0, unique: 0, newToAgentory: 0, eligible: 0, pending: 0, ineligible: 0, decisionMaker: 0, hasPhoneFlag: 0, lookedUp: 0,
  personAssociated: 0, verifiedDirect: 0, switchboard: 0, invalidOrMismatched: 0, noNumber: 0, outreachReady: 0,
});

export interface StageRate { stage: string; from: string; numerator: number; denominator: number; rate: number | null; lower95: number | null }

/** Wilson score interval lower bound (z = 1.96). Null with no observations. */
export function wilsonLower(k: number, n: number, z = 1.96): number | null {
  if (n <= 0) return null;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, (centre - margin) / d);
}

const STAGES: [keyof FunnelCounts, keyof FunnelCounts][] = [
  ["unique", "discovered"],
  ["newToAgentory", "unique"],
  ["eligible", "newToAgentory"],
  ["decisionMaker", "eligible"],
  ["hasPhoneFlag", "decisionMaker"],
  ["lookedUp", "hasPhoneFlag"],
  ["personAssociated", "lookedUp"],
  ["outreachReady", "personAssociated"],
];

export function stageRates(f: FunnelCounts): StageRate[] {
  return STAGES.map(([stage, from]) => {
    const n = f[from], k = f[stage];
    return { stage, from, numerator: k, denominator: n, rate: n ? k / n : null, lower95: wilsonLower(k, n) };
  });
}

export interface CandidateEstimate {
  target: number;
  /** "person_associated" = a provider-associated mobile/direct number; "verified_direct" needs independent evidence. */
  usable: "person_associated" | "verified_direct";
  /** Discovered records needed at the observed rates; null when a stage has no observations. */
  expected: number | null;
  /** Discovered records needed at the Wilson lower bounds (conservative). */
  conservative: number | null;
  /** Phone lookups (LeadOcean records) the conservative path spends. */
  lookupsConservative: number | null;
  unknownStages: string[];
  basis: string;
}

/**
 * Discovered records needed for `target` usable numbers. Lookups are charged
 * per looked-up person, so the record cost is discovered + lookups.
 */
export function estimateCandidates(f: FunnelCounts, target: number, usable: CandidateEstimate["usable"] = "person_associated"): CandidateEstimate {
  const rates = stageRates(f);
  const chain = rates.slice(0, usable === "person_associated" ? 7 : 6);
  const unknown = chain.filter((r) => r.rate == null || r.rate === 0).map((r) => r.stage);
  let extra: StageRate | null = null;
  if (usable === "verified_direct") {
    const n = f.lookedUp, k = f.verifiedDirect;
    extra = { stage: "verifiedDirect", from: "lookedUp", numerator: k, denominator: n, rate: n ? k / n : null, lower95: wilsonLower(k, n) };
    if (!extra.rate) unknown.push("verifiedDirect");
  }
  const all = extra ? [...chain, extra] : chain;
  const product = (pick: (r: StageRate) => number | null) => all.reduce<number | null>((a, r) => (a == null || !pick(r) ? null : a * pick(r)!), 1);
  const exp = product((r) => r.rate);
  const lo = product((r) => r.lower95);
  // Lookups = discovered × P(reaching the lookup stage).
  const toLookup = (pick: (r: StageRate) => number | null) => rates.slice(0, 6).reduce<number | null>((a, r) => (a == null || !pick(r) ? null : a * pick(r)!), 1);
  const loToLookup = toLookup((r) => r.lower95);
  const conservative = lo ? Math.ceil(target / lo) : null;
  return {
    target, usable,
    expected: exp ? Math.ceil(target / exp) : null,
    conservative,
    lookupsConservative: conservative != null && loToLookup ? Math.ceil(conservative * loToLookup) : null,
    unknownStages: unknown,
    basis: unknown.length
      ? `cannot estimate: no observed yield at ${unknown.join(", ")} — a live sample must measure it`
      : `observed rates over ${f.discovered} discovered records; conservative uses the Wilson 95% lower bound of every stage`,
  };
}

/** A planning estimate from ASSUMED rates (stated as assumptions), for the live-test proposal before any data exists. */
export function plannedFunnel(discovered: number, assumed: Record<string, number>): FunnelCounts {
  const r = (k: string) => assumed[k] ?? 0;
  const unique = Math.round(discovered * r("unique"));
  const newTo = Math.round(unique * r("newToAgentory"));
  const eligible = Math.round(newTo * r("eligible"));
  const dm = Math.round(eligible * r("decisionMaker"));
  const hp = Math.round(dm * r("hasPhoneFlag"));
  const lu = Math.round(hp * r("lookedUp"));
  const pa = Math.round(lu * r("personAssociated"));
  return { ...EMPTY_FUNNEL, discovered, unique, newToAgentory: newTo, eligible, decisionMaker: dm, hasPhoneFlag: hp, lookedUp: lu, personAssociated: pa, verifiedDirect: 0, outreachReady: Math.round(pa * r("outreachReady")) };
}

export interface YieldReport {
  candidatesDiscovered: number;
  candidatesUnique: number;
  candidatesEligible: number;
  enrichmentAttempts: number;
  /** Lookups that returned any number / lookups. */
  phoneMatchRate: number | null;
  /** Lookups that returned a person-associated (mobile/direct) number / lookups. */
  personDirectCandidateRate: number | null;
  /** Lookups that ended independently verified person-direct / lookups. */
  verifiedDirectRate: number | null;
  /** Rows bought that were already seen in this walk or already in Agentory. */
  duplicateRate: number | null;
  cost: {
    leadoceanRecords: number; apifyUsd: number;
    /** USD when a per-record price is known (LeadOcean Free plan: $0 monetary, records only). */
    totalUsd: number | null;
    perCandidateUsd: number | null; perCandidateRecords: number | null;
    perPersonAssociatedNumberUsd: number | null;
    perVerifiedDirectNumberUsd: number | null;
  };
  rejectionReasons: Record<string, number>;
  enrichmentSkipReasons: Record<string, number>;
}

const ratio = (k: number, n: number) => (n > 0 ? Math.round((k / n) * 1000) / 1000 : null);

export function yieldReport(input: {
  funnel: FunnelCounts; leadoceanRecords: number; apifyUsd: number; usdPerLeadOceanRecord: number | null;
  rejections: string[]; enrichmentSkips: string[];
}): YieldReport {
  const f = input.funnel;
  const numbers = f.personAssociated + f.switchboard + f.invalidOrMismatched;
  const totalUsd = input.usdPerLeadOceanRecord == null ? null : Math.round((input.leadoceanRecords * input.usdPerLeadOceanRecord + input.apifyUsd) * 1e6) / 1e6;
  const per = (n: number) => (totalUsd == null || n === 0 ? null : Math.round((totalUsd / n) * 1e4) / 1e4);
  const count = (xs: string[]) => xs.reduce<Record<string, number>>((a, x) => ({ ...a, [x]: (a[x] ?? 0) + 1 }), {});
  return {
    candidatesDiscovered: f.discovered, candidatesUnique: f.unique, candidatesEligible: f.eligible, enrichmentAttempts: f.lookedUp,
    phoneMatchRate: ratio(numbers, f.lookedUp),
    personDirectCandidateRate: ratio(f.personAssociated, f.lookedUp),
    verifiedDirectRate: ratio(f.verifiedDirect, f.lookedUp),
    duplicateRate: ratio(f.discovered - f.newToAgentory, f.discovered),
    cost: {
      leadoceanRecords: input.leadoceanRecords, apifyUsd: input.apifyUsd, totalUsd,
      perCandidateUsd: per(f.unique), perCandidateRecords: f.unique ? Math.round((input.leadoceanRecords / f.unique) * 100) / 100 : null,
      perPersonAssociatedNumberUsd: per(f.personAssociated), perVerifiedDirectNumberUsd: per(f.verifiedDirect),
    },
    rejectionReasons: count(input.rejections), enrichmentSkipReasons: count(input.enrichmentSkips),
  };
}
