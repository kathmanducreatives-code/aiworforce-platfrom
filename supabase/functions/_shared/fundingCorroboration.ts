// LEAD V2 P6 — ONE FUNDING-STAGE ANSWER FROM TWO PROVIDERS THAT EACH HOLD HALF.
//
// Probed live 2026-09-19 (Wordware, Stripe, Cal.com, Dioptra, 37signals):
//
//   atomus/linkedin-company-scraper   input: LinkedIn URL or slug
//     round types + announced dates, and `num_funding_rounds` that is a TRUE
//     total (Stripe: 23 reported, 10 returned) — so COMPLETENESS is checkable.
//     No per-round source URL. Data ~4 weeks stale.
//
//   pvalyou/company-record            input: domain / URL / LinkedIn / name
//     per-round `source_urls` — the company's own announcement among them — and
//     date precision. `rounds_count` is only what it holds (Stripe: 7 vs ~23),
//     so completeness can NEVER be read from it.
//
// Neither alone can PASS a Seed claim: atomus proves "no later round" but cites
// nothing; pvalyou cites but cannot prove "no later round". Together they can:
//
//   atomus says a VERIFIED later round           → FAIL (one cheap call)
//   atomus complete, latest = Seed, and pvalyou
//     cites that same Seed round                  → PASS
//   pvalyou cites a later round atomus lacks
//     (atomus is weeks stale)                     → FAIL
//   anything unmatched, conflicting or missing    → PENDING
//
// The decision itself is `decideFundingStage` with `pass_requires_source_url`;
// this module only builds the ONE record it decides on, and never guesses: a
// round is matched only on the same rung within a date window, completeness is
// taken only from atomus and only when nothing contradicts it, and a provider
// that returned nothing is absence, never evidence.
//
// Pure. No provider, no clock beyond what the caller passes.

import {
  decideFundingStage, normalizeRoundType, stageRank,
  type FundingRecordFact, type FundingRoundFact, type FundingStageDecision,
} from "./fundingStageClaim.ts";
import type { EvidenceItem } from "./candidateObservation.ts";
import type { CompanyEvidenceGraph } from "./evidenceGraph.ts";

export const FUNDING_CORROBORATION_VERSION = "funding-corroboration-v1" as const;

export const ATOMUS_FUNDING_ACTOR_KEY = "apify_funding_atomus" as const;
export const PVALYOU_FUNDING_ACTOR_KEY = "apify_funding_pvalyou" as const;
export const FUNDING_CORROBORATION_ACTOR = "funding_corroboration" as const;

/** Two readings of one round agree on its date within this window (a month-precision date is its 1st). */
export const ROUND_MATCH_WINDOW_DAYS = 62;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> =>
  (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});

// ─────────────────────────────────────────────────────────────── atomus ──

export interface ProviderFundingRead {
  /** The input the row answers, exactly as sent — how a row finds its company. */
  input: string | null;
  found: boolean;
  record: FundingRecordFact | null;
  linkedin_url: string | null;
  domain: string | null;
}

/** One atomus row. `not_found` (not charged) is absence: no record at all. */
export function normalizeAtomusFunding(row: Record<string, unknown>): ProviderFundingRead {
  const input = str(row.input);
  const summary = obj(row.summary);
  const company = obj(row.company);
  const found = row.status === "success" && Object.keys(company).length > 0;
  const base = { input, found, linkedin_url: str(summary.linkedin_url), domain: str(summary.domain) };
  if (!found) return { ...base, record: null };
  const funding = obj(obj(company.financial).funding);
  const rounds: FundingRoundFact[] = arr(funding.rounds).map((r) => {
    const x = obj(r);
    return {
      round_type: str(x.type),
      announced_date: str(x.announced_at),
      amount_usd: num(x.raised_amount),
      investors: arr(x.investors).map((i) => String(i)),
      source_urls: [],
      method: "provider_field" as const,
    };
  });
  return {
    ...base,
    record: {
      provider: "apify", actor: ATOMUS_FUNDING_ACTOR_KEY, rounds,
      // THE TRUE TOTAL. Absent (no funding block) means the provider holds no
      // rounds — which is absence of evidence, and decides nothing.
      reported_round_count: num(funding.num_funding_rounds),
      history_complete: null,
      observed_at: str(summary.last_updated) ?? str(company.last_updated),
      source_url: str(summary.linkedin_url),
    },
  };
}

// ────────────────────────────────────────────────────────────── pvalyou ──

/** One pvalyou row. Its `rounds_count` is what it holds, so completeness is never taken from it. */
export function normalizePvalyouFunding(row: Record<string, unknown>): ProviderFundingRead {
  const input = str(row.query);
  const record = obj(row.record);
  const funding = obj(record.funding);
  const found = Object.keys(record).length > 0 && row.status !== "not_found";
  const base = { input, found, linkedin_url: null, domain: str(row.domain) };
  if (!found) return { ...base, record: null };
  const rounds: FundingRoundFact[] = arr(funding.rounds).map((r) => {
    const x = obj(r);
    const precision = str(x.round_date_precision);
    const m = num(x.round_amount_m_usd);
    return {
      round_type: str(x.round_type),
      // A date of unknown precision is not a date.
      announced_date: precision === "unknown" ? null : str(x.round_date),
      amount_usd: m === null ? null : Math.round(m * 1_000_000),
      investors: arr(x.investors).map((i) => str(obj(i).name) ?? "").filter(Boolean),
      source_urls: arr(x.source_urls).map((u) => str(u)).filter((u): u is string => !!u),
      method: "provider_field" as const,
    };
  });
  return {
    ...base,
    record: {
      provider: "apify", actor: PVALYOU_FUNDING_ACTOR_KEY, rounds,
      reported_round_count: null, history_complete: null,
      observed_at: str(row.record_as_of) ?? str(record.record_as_of),
      source_url: null,
    },
  };
}

// ─────────────────────────────────────────────────── funding discovery ──
//
// A funding-event feed (datahyena) returns ROUNDS: a company, a stage, a date,
// an amount, investors and the articles that reported it. That row is funding
// evidence the mission already paid for, and it must reach the funding-stage
// claim instead of being re-bought:
//
//   a dated LATER round        → contradicts an earlier stage at once (FAIL)
//   the stage the mission asked → supports it, never proves it: a feed shows
//                                 events, not a company's whole history, so
//                                 `history_complete: false` keeps it PENDING
//                                 until atomus supplies completeness
//   its article URLs           → cite the round, so a matching atomus Seed
//                                 needs no pvalyou purchase to PASS
//
// "Discovered by a Seed feed" is never "Seed PASS".

/** The round a funding-event feed reported, as the engine normalized it. */
export interface DiscoveredFundingRound {
  company_name: string | null;
  canonical_domain: string | null;
  linkedin_company_url: string | null;
  round_stage: string | null;
  announced_date: string | null;
  amount_usd: number | null;
  investors: readonly string[];
  source_articles: readonly string[];
}

/** One discovered round → the funding record the stage claim reads. Never complete. */
export function fundingRecordFromDiscoveredRound(
  r: DiscoveredFundingRound, i: { actor: string; provider_call_id: string | null; observed_at: string | null },
): FundingRecordFact {
  return {
    provider: "apify", actor: i.actor,
    rounds: [{
      round_type: r.round_stage, announced_date: r.announced_date, amount_usd: r.amount_usd,
      investors: [...r.investors], source_urls: [...r.source_articles], method: "provider_field",
    }],
    // A FEED OF EVENTS IS NOT A HISTORY. It says this round happened; it cannot
    // say no later round did.
    reported_round_count: null,
    history_complete: false,
    observed_at: i.observed_at,
    source_url: r.source_articles[0] ?? null,
    provider_call_id: i.provider_call_id,
    company: { name: r.company_name, domain: r.canonical_domain, linkedin_url: r.linkedin_company_url },
  };
}

/** The value a `funding` EvidenceItem carries when it IS a funding record. */
export interface FundingRecordEvidenceValue {
  claim: "funding_record";
  round_type: string | null;
  announced_date: string | null;
  amount_usd: number | null;
  record: FundingRecordFact;
}

/** The funding EVENT as evidence: proven when dated (the feed admits no undated row). */
export function fundingRecordEvidenceItem(i: {
  company_key: string; record: FundingRecordFact; mission_id: string | null; observed_at: string;
}): EvidenceItem {
  const r = i.record.rounds[0] ?? null;
  const value: FundingRecordEvidenceValue = {
    claim: "funding_record", round_type: normalizeRoundType(r?.round_type ?? null),
    announced_date: r?.announced_date ?? null, amount_usd: r?.amount_usd ?? null, record: i.record,
  };
  const cited = (r?.source_urls.length ?? 0) > 0;
  return {
    evidence_id: `fdr_${i.company_key}_${i.record.actor}_${r?.announced_date ?? "undated"}_${value.round_type ?? "x"}`.slice(0, 64),
    company_key: i.company_key, dimension: "funding", value,
    status: r?.announced_date ? "proven" : "plausible",
    source: {
      provider: i.record.provider, actor: i.record.actor, provider_call_id: i.record.provider_call_id ?? null,
      url: i.record.source_url, excerpt: null,
    },
    method: "provider_field", observed_at: i.observed_at, valid_until: null,
    confidence: cited ? "high" : "medium", derived_from: [], mission_id: i.mission_id, origin: "lead_mission",
  };
}

/** Every funding record the company's evidence already carries — reused, never re-bought. */
export function fundingRecordsInGraph(graph: CompanyEvidenceGraph): FundingRecordFact[] {
  const out: FundingRecordFact[] = [];
  const seen = new Set<string>();
  for (const claim of graph.claims) {
    if (claim.dimension !== "funding") continue;
    const items = [claim.current, ...claim.supporting, ...claim.conflicting, ...claim.stale]
      .filter((x): x is EvidenceItem => !!x);
    for (const it of items) {
      const v = it.value as Partial<FundingRecordEvidenceValue> | null;
      if (!v || typeof v !== "object" || v.claim !== "funding_record" || !v.record) continue;
      if (seen.has(it.evidence_id)) continue;
      seen.add(it.evidence_id);
      out.push(v.record);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────── the merge ──

export interface CorroboratedFunding {
  version: typeof FUNDING_CORROBORATION_VERSION;
  record: FundingRecordFact | null;
  /** atomus rounds that a pvalyou round with source URLs confirmed. */
  corroborated_rounds: number;
  /** Why completeness was withdrawn, when it was. Empty ⇒ atomus's count stands. */
  conflicts: string[];
  sources: string[];
}

function days(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const x = Date.parse(a), y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) / 86_400_000 : null;
}

/**
 * The ONE record the funding-stage decision reads.
 *
 * atomus supplies the rounds and the completeness count; pvalyou supplies the
 * citations. A pvalyou round on a rung is matched to an atomus round on the SAME
 * rung within {@link ROUND_MATCH_WINDOW_DAYS}; a match lends it its source URLs.
 * An unmatched rung, or a rung that disagrees on the same date, is a conflict:
 * the round is kept (a cited later round can still FAIL the claim) and the
 * completeness count is withdrawn, so PASS becomes impossible.
 */
export function corroborateFunding(i: {
  atomus: FundingRecordFact | null;
  pvalyou: FundingRecordFact | null;
  /**
   * Records the mission already holds — funding discovery's rounds. They CITE
   * (their article URLs) exactly as pvalyou's do, and like pvalyou they never
   * supply completeness.
   */
  discovered?: readonly FundingRecordFact[];
}): CorroboratedFunding {
  const base = { version: FUNDING_CORROBORATION_VERSION, corroborated_rounds: 0, conflicts: [] as string[] };
  const citing = [i.pvalyou, ...(i.discovered ?? [])].filter((x): x is FundingRecordFact => !!x);
  const sources: string[] = [];
  if (i.atomus) sources.push(ATOMUS_FUNDING_ACTOR_KEY);
  for (const c of citing) if (!sources.includes(c.actor)) sources.push(c.actor);
  if (!i.atomus && citing.length === 0) return { ...base, record: null, sources };
  // Citing records alone: their rounds, and NO completeness — none of them can
  // say no later round exists. atomus alone cites nothing, so a PASS that must
  // cite cannot happen.
  if (!i.atomus) {
    return { ...base, sources, record: {
      ...citing[0], actor: citing.length > 1 ? FUNDING_CORROBORATION_ACTOR : citing[0].actor,
      rounds: citing.flatMap((c) => c.rounds.map((r) => ({ ...r, source_urls: [...r.source_urls] }))),
      reported_round_count: null, history_complete: null,
    } };
  }
  if (citing.length === 0) return { ...base, record: i.atomus, sources };

  const rounds: FundingRoundFact[] = i.atomus.rounds.map((r) => ({ ...r, source_urls: [...r.source_urls] }));
  const conflicts: string[] = [];
  let corroborated = 0;
  for (const p of citing.flatMap((c) => c.rounds)) {
    const pType = normalizeRoundType(p.round_type);
    const pRank = stageRank(pType);
    if (pRank === null) continue; // accelerator, grant, debt, "Other": no rung to confirm or contradict
    const sameRung = rounds.find((a) => normalizeRoundType(a.round_type) === pType &&
      (days(a.announced_date, p.announced_date) ?? Infinity) <= ROUND_MATCH_WINDOW_DAYS);
    if (sameRung) {
      const before = sameRung.source_urls.length;
      sameRung.source_urls = [...new Set([...sameRung.source_urls, ...p.source_urls])];
      if (before === 0 && sameRung.source_urls.length > 0) corroborated++;
      continue;
    }
    const sameDate = rounds.find((a) => stageRank(normalizeRoundType(a.round_type)) !== null &&
      (days(a.announced_date, p.announced_date) ?? Infinity) <= ROUND_MATCH_WINDOW_DAYS);
    conflicts.push(sameDate
      ? `rung_mismatch:${normalizeRoundType(sameDate.round_type)}_vs_${pType}@${p.announced_date ?? "undated"}`
      : `round_not_in_atomus:${pType}@${p.announced_date ?? "undated"}`);
    rounds.push({ ...p, source_urls: [...p.source_urls] });
  }
  return {
    ...base,
    corroborated_rounds: corroborated,
    conflicts,
    sources,
    record: {
      provider: "apify", actor: FUNDING_CORROBORATION_ACTOR, rounds,
      // Completeness is atomus's TRUE count — withdrawn the moment the two disagree.
      reported_round_count: conflicts.length === 0 ? i.atomus.reported_round_count : null,
      history_complete: null,
      observed_at: citing[0].observed_at ?? i.atomus.observed_at,
      source_url: i.atomus.source_url,
    },
  };
}

/** The funding-stage decision on corroborated evidence: PASS must cite the decisive round. */
export function decideCorroboratedFundingStage(i: {
  required_stage: string | null;
  atomus: FundingRecordFact | null;
  pvalyou: FundingRecordFact | null;
  discovered?: readonly FundingRecordFact[];
}): { decision: FundingStageDecision; corroboration: CorroboratedFunding } {
  const corroboration = corroborateFunding({ atomus: i.atomus, pvalyou: i.pvalyou, discovered: i.discovered });
  return {
    corroboration,
    decision: decideFundingStage({
      required_stage: i.required_stage, record: corroboration.record, pass_requires_source_url: true,
    }),
  };
}

/**
 * Does atomus ALONE already settle the claim? Only a FAIL can be settled
 * without a citation: one dated later round is a later round. Anything else
 * needs pvalyou.
 */
export function atomusSettles(required_stage: string | null, atomus: FundingRecordFact | null): FundingStageDecision | null {
  if (!atomus) return null;
  const d = decideFundingStage({ required_stage, record: atomus, pass_requires_source_url: true });
  return d.verdict === "fail" ? d : null;
}
