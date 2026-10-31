// The provider benchmark: one fixed cohort, identical criteria, ten measures.
//
// The cohort (benchmarks/provider-discovery/cohort.json) holds three groups:
//   A  known companies       — exact identity matching against held identifiers
//   B  known decision-makers — person identity + current employment + role
//   C  new discovery targets — one fixed mission, judged by the SHARED engine
// Every provider is scored by the same functions on the same cohort. A slot
// carrying an outreach hold, a CRM relationship or an existing Lead ID is
// never sent to a provider (`sendable`) and a discovery result matching one is
// counted as already known, never as new.
//
// Pure: results come in, numbers come out. No network, no clock.

import { normDomain } from "./normalize.ts";
import type { ProviderCompany, ProviderId, ProviderPerson } from "./types.ts";
import type { VerifiedLead } from "./verify.ts";

export const BENCHMARK_VERSION = "provider-benchmark-v1" as const;

// ── Cohort ──────────────────────────────────────────────────────────────────

export interface Suppression {
  existing_lead_id: string | null;
  outreach_hold: boolean;
  crm_relationship: string | null;
}

export interface CompanySlot {
  slot: string;
  status: "selected" | "unfilled";
  name?: string | null;
  domain?: string | null;
  linkedin_url?: string | null;
  /** Headquarters country only when a canonical record PROVED it; otherwise null. */
  truth_hq_country?: string | null;
  truth_source?: string | null;
  suppression?: Suppression;
  unfilled_reason?: string;
}

export interface PersonSlot {
  slot: string;
  status: "selected" | "unfilled";
  full_name?: string | null;
  linkedin_url?: string | null;
  employer_domain?: string | null;
  role?: string | null;
  suppression?: Suppression;
  unfilled_reason?: string;
}

export interface Cohort {
  version: string;
  known_companies: CompanySlot[];
  known_decision_makers: PersonSlot[];
  discovery: { mission_query: string; requested_count: number };
}

/** May this slot be sent to a provider at all? */
export function sendable(s: { status: string; suppression?: Suppression }): boolean {
  const h = s.suppression;
  return s.status === "selected" && !(h && (h.outreach_hold || h.existing_lead_id || h.crm_relationship));
}

// ── Results one provider produced ───────────────────────────────────────────

export interface CallTiming { op: string; ms: number }

export interface ProviderBenchmarkResult {
  provider: ProviderId;
  companyMatches: Record<string, ProviderCompany | null>;
  personMatches: Record<string, ProviderPerson | null>;
  /** Every company row discovery returned, before merging (for the duplicate rate). */
  discoveryRows: ProviderCompany[];
  /** The discovery run's leads after the shared engine. */
  discoveryLeads: VerifiedLead[];
  timings: CallTiming[];
  /** What the provider itself reported as consumed (credits or records). */
  unitsConsumed: number;
  unit: "credits" | "records";
  /** Money attributable to this test, from the approved budget's rate. Null when not priced. */
  costUsd: number | null;
}

// ── Identity ────────────────────────────────────────────────────────────────

const liCompany = (u: unknown) => /linkedin\.com\/company\/([^/?#\s]+)/i.exec(String(u ?? ""))?.[1].toLowerCase().replace(/\/+$/, "") ?? null;
const liPerson = (u: unknown) => /linkedin\.com\/in\/([^/?#\s]+)/i.exec(String(u ?? ""))?.[1].toLowerCase().replace(/\/+$/, "") ?? null;

/** One key per company: the LinkedIn slug when known, else the registrable domain. */
export function companyIdentity(c: { domain?: string | null; linkedinUrl?: string | null; linkedin_url?: string | null }): string | null {
  const li = liCompany(c.linkedinUrl ?? c.linkedin_url);
  if (li) return `li:${li}`;
  const d = normDomain(c.domain ?? null);
  return d ? `d:${d}` : null;
}

/** Every identifier a company carries. Two records are one company when any is shared. */
export function identityKeys(c: { domain?: string | null; linkedinUrl?: string | null; linkedin_url?: string | null }): string[] {
  const li = liCompany(c.linkedinUrl ?? c.linkedin_url);
  const d = normDomain(c.domain ?? null);
  return [...(li ? [`li:${li}`] : []), ...(d ? [`d:${d}`] : [])];
}

/** Group records into companies: records sharing any identifier are one company. */
function companies(records: string[][]): string[][] {
  const groups: Set<string>[] = [];
  for (const keys of records) {
    if (!keys.length) continue;
    const hit = groups.filter((g) => keys.some((k) => g.has(k)));
    const merged = new Set<string>(keys);
    for (const g of hit) { for (const k of g) merged.add(k); groups.splice(groups.indexOf(g), 1); }
    groups.push(merged);
  }
  return groups.map((g) => [...g]);
}
const intersects = (a: readonly string[], b: ReadonlySet<string>) => a.some((k) => b.has(k));

export type IdentityOutcome = "match" | "mismatch" | "conflicting" | "unconfirmed";

/**
 * Is the returned record the cohort's company? Decided ONLY on an identifier
 * both sides carry. A shared identifier that agrees is a match; one that
 * disagrees is a mismatch. When the two sides carry no identifier of the same
 * kind (the cohort holds only a LinkedIn URL, the row only a domain) nothing
 * can be compared: that is UNCONFIRMED, never a wrong match.
 */
export function companyIdentityOutcome(a: { domain?: string | null; linkedin_url?: string | null }, b: ProviderCompany): IdentityOutcome {
  const la = liCompany(a.linkedin_url), lb = liCompany(b.linkedinUrl);
  const da = normDomain(a.domain ?? null), db = normDomain(b.domain ?? null);
  const li = la && lb ? la === lb : null;
  const dom = da && db ? da === db : null;
  // One identifier agrees and another contradicts (same LinkedIn page, another
  // domain): a domain alias or a different company — the scorer cannot tell, so
  // it is neither right nor wrong.
  if ((li === true && dom === false) || (li === false && dom === true)) return "conflicting";
  if (li === false || dom === false) return "mismatch";
  if (li === true || dom === true) return "match";
  return "unconfirmed";
}

const normName = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(inc|llc|ltd|corp|co|the)\b/g, "").trim();

const COUNTRY: Record<string, string> = { us: "united states", usa: "united states", "united states of america": "united states", uk: "united kingdom" };
const country = (v: unknown) => { const t = String(v ?? "").trim().toLowerCase(); return t ? COUNTRY[t] ?? t : null; };

// ── Measures ────────────────────────────────────────────────────────────────

export interface Ratio { numerator: number; denominator: number; value: number | null }
const ratio = (n: number, d: number): Ratio => ({ numerator: n, denominator: d, value: d > 0 ? n / d : null });

export interface BenchmarkScore {
  version: typeof BENCHMARK_VERSION;
  provider: ProviderId;
  /**
   * 1 — numerator/denominator: confirmed matches over slots sent. `unconfirmed`
   * are returned records no shared identifier can confirm or refute (with how
   * many of them at least agree on name); `wrong` only a contradicting identifier.
   */
  companyMatching: Ratio & { wrong: number; missed: number; conflicting: number; unconfirmed: number; unconfirmedNameAgrees: number; accuracyWhereComparable: number | null };
  /** 2 */ decisionMakerAccuracy: Ratio & { wrongPerson: number; wrongEmployer: number; wrongRole: number; missed: number };
  /** 3 */ headquartersVerification: Ratio & { disagree: number; absent: number; noTruth: number };
  /** 4 */ uniqueQualified: { qualified: number; uniqueToProvider: number; alreadyKnown: number; providerChecksOnly: number };
  /** 5 */ duplicateRate: Ratio;
  /** 6 */ overlap: { with: ProviderId; shared: number; union: number; jaccard: number | null } | null;
  /** 7 */ phoneCandidateCoverage: Ratio;
  /** 8 */ verifiedDirectNumberCoverage: Ratio;
  /** 9 */ latencyMs: { count: number; p50: number | null; p95: number | null; max: number | null };
  /** 10 */ costPerQualified: { usd: number | null; units: number | null; unit: string; qualified: number };
  /**
   * Evidence quality: of the hard checks on discovered companies, how many a
   * RETURNED value answered (matched or contradicted) versus a filter the
   * provider only says it applied, versus nothing at all.
   */
  evidenceQuality: { returnedValue: number; filterOnly: number; nothing: number; share: number | null };
  /** Freshness: age in days of the provider's own update stamp, where it gives one. */
  freshnessDays: { stamped: number; unstamped: number; median: number | null };
  skippedForSuppression: string[];
}

function pct(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function roleMatches(title: string | null | undefined, role: string | null | undefined): boolean {
  if (!title || !role) return false;
  const t = title.toLowerCase(), r = role.toLowerCase().trim();
  return new RegExp(`(^|[^a-z])${r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(t);
}

const leadKeys = (l: VerifiedLead) => [
  ...l.company.domain.flatMap((d) => identityKeys({ domain: d.value })),
  ...l.company.linkedinUrl.flatMap((u) => identityKeys({ linkedinUrl: u.value })),
];

/** Companies a provider's run QUALIFIED (shared engine) that Agentory does not already hold. */
function qualifiedNew(r: ProviderBenchmarkResult, known: Set<string>): string[][] {
  return companies(r.discoveryLeads.filter((l) => l.status === "qualified").map(leadKeys).filter((k) => !intersects(k, known)));
}

/** `asOf`: the instant freshness is measured from (the run's own clock; never "now" implicitly in tests). */
export function scoreProvider(cohort: Cohort, r: ProviderBenchmarkResult, other: ProviderBenchmarkResult | null = null, asOf: string = new Date().toISOString()): BenchmarkScore {
  const skipped: string[] = [];
  // Every identity Agentory already holds: a discovery hit on one is not new.
  const known = new Set<string>();
  for (const s of cohort.known_companies) if (s.status === "selected") for (const k of identityKeys(s)) known.add(k);

  // 1 + 3 — known companies
  let unconfirmed = 0, unconfirmedNameAgrees = 0, conflicting = 0;
  let correct = 0, wrong = 0, missed = 0, hqOk = 0, hqBad = 0, hqAbsent = 0, hqNoTruth = 0, cDen = 0;
  for (const s of cohort.known_companies) {
    if (s.status !== "selected") continue;
    if (!sendable(s)) { skipped.push(s.slot); continue; }
    cDen++;
    const m = r.companyMatches[s.slot] ?? null;
    if (!m) { missed++; continue; }
    const outcome = companyIdentityOutcome(s, m);
    if (outcome === "mismatch") { wrong++; continue; }
    if (outcome === "conflicting") { conflicting++; continue; }
    if (outcome === "unconfirmed") { unconfirmed++; if (normName(s.name) && normName(s.name) === normName(m.name)) unconfirmedNameAgrees++; continue; }
    correct++;
    const truth = country(s.truth_hq_country);
    if (!truth) { hqNoTruth++; continue; }
    const got = country(m.hqCountry);
    if (!got) hqAbsent++;
    else if (got === truth) hqOk++;
    else hqBad++;
  }

  // 2 — known decision-makers: same person, current employer, role
  let pOk = 0, wPerson = 0, wEmp = 0, wRole = 0, pMiss = 0, pDen = 0;
  for (const s of cohort.known_decision_makers) {
    if (s.status !== "selected") continue;
    if (!sendable(s)) { skipped.push(s.slot); continue; }
    pDen++;
    const m = r.personMatches[s.slot] ?? null;
    if (!m) { pMiss++; continue; }
    const lp = liPerson(s.linkedin_url), lm = liPerson(m.linkedinUrl);
    if (!lp || !lm || lp !== lm) { wPerson++; continue; }
    if (normDomain(s.employer_domain ?? null) !== normDomain(m.company?.domain ?? null)) { wEmp++; continue; }
    if (!roleMatches(m.title, s.role)) { wRole++; continue; }
    pOk++;
  }

  // 4 — qualified by the shared engine, new to Agentory, unique to this provider
  const mine = qualifiedNew(r, known);
  const theirs = new Set((other ? qualifiedNew(other, known) : []).flat());
  const qualifiedAll = r.discoveryLeads.filter((l) => l.status === "qualified");
  const alreadyKnown = companies(qualifiedAll.map(leadKeys).filter((k) => intersects(k, known))).length;

  // 5 — duplicates within this provider's own discovery rows (a row with no identifier is its own company)
  const rowKeys = r.discoveryRows.map((c) => { const k = identityKeys(c); return k.length ? k : [`rec:${c.provider}:${c.recordId}`]; });
  const dupes = rowKeys.length - companies(rowKeys).length;

  // 6 — overlap with the other provider's discovered companies (all, not only qualified)
  let overlap: BenchmarkScore["overlap"] = null;
  if (other) {
    const a = companies(r.discoveryRows.map((c) => identityKeys(c)));
    const b = companies(other.discoveryRows.map((c) => identityKeys(c)));
    const bKeys = new Set(b.flat());
    const shared = a.filter((g) => intersects(g, bKeys)).length;
    const union = companies([...a, ...b]).length;
    overlap = { with: other.provider, shared, union, jaccard: union ? shared / union : null };
  }

  // 7 + 8 — phones on the decision-makers this provider returned (flags and statuses, never values)
  const people = [
    ...Object.values(r.personMatches).filter((p): p is ProviderPerson => !!p),
    ...r.discoveryLeads.flatMap((l) => l.contacts.map((c) => ({ hasPhone: c.person.hasPhone.some((x) => x.value), contactPoints: c.person.contactPoints } as Pick<ProviderPerson, "hasPhone" | "contactPoints">))),
  ];
  const withPhone = people.filter((p) => p.hasPhone === true || (p.contactPoints ?? []).some((cp) => cp.kind === "phone")).length;
  const verifiedDirect = people.filter((p) => (p.contactPoints ?? []).some((cp) =>
    cp.kind === "phone" && cp.verification === "independently_verified" && /direct|mobile/i.test(cp.type ?? ""))).length;

  // 9 — latency
  const ms = r.timings.map((t) => t.ms).sort((x, y) => x - y);

  // 10 — cost per qualified result (the shared engine's qualified only)
  const q = qualifiedAll.length;

  // Evidence quality and freshness, over the discovered companies.
  const checks = r.discoveryLeads.flatMap((l) => l.checks.filter((c) => c.criterionId !== "identity"));
  const returned = checks.filter((c) => c.outcome === "matched" || c.outcome === "contradicted" || c.outcome === "conflicting").length;
  const filterOnly = checks.filter((c) => c.outcome === "provider_filter").length;
  const at = Date.parse(asOf);
  const ages = r.discoveryLeads.flatMap((l) => l.company.sources.map((s) => s.providerUpdatedAt))
    .map((d) => (d ? (at - Date.parse(d)) / 86_400_000 : NaN));
  const stamped = ages.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  return {
    version: BENCHMARK_VERSION,
    provider: r.provider,
    companyMatching: { ...ratio(correct, cDen), wrong, missed, conflicting, unconfirmed, unconfirmedNameAgrees,
      accuracyWhereComparable: correct + wrong > 0 ? correct / (correct + wrong) : null },
    decisionMakerAccuracy: { ...ratio(pOk, pDen), wrongPerson: wPerson, wrongEmployer: wEmp, wrongRole: wRole, missed: pMiss },
    headquartersVerification: { ...ratio(hqOk, hqOk + hqBad + hqAbsent), disagree: hqBad, absent: hqAbsent, noTruth: hqNoTruth },
    uniqueQualified: {
      qualified: q, uniqueToProvider: mine.filter((g) => !intersects(g, theirs)).length, alreadyKnown,
      providerChecksOnly: r.discoveryLeads.filter((l) => l.providerStatus === "qualified" && l.status !== "qualified").length,
    },
    duplicateRate: ratio(dupes, rowKeys.length),
    overlap,
    phoneCandidateCoverage: ratio(withPhone, people.length),
    verifiedDirectNumberCoverage: ratio(verifiedDirect, people.length),
    latencyMs: { count: ms.length, p50: pct(ms, 50), p95: pct(ms, 95), max: ms.length ? ms[ms.length - 1] : null },
    costPerQualified: {
      usd: r.costUsd !== null && q > 0 ? r.costUsd / q : null,
      units: q > 0 ? r.unitsConsumed / q : null, unit: r.unit, qualified: q,
    },
    evidenceQuality: { returnedValue: returned, filterOnly, nothing: checks.length - returned - filterOnly, share: checks.length ? returned / checks.length : null },
    freshnessDays: { stamped: stamped.length, unstamped: ages.length - stamped.length, median: stamped.length ? Math.round(stamped[Math.floor((stamped.length - 1) / 2)]) : null },
    skippedForSuppression: [...new Set(skipped)],
  };
}
