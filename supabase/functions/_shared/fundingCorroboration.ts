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
}): CorroboratedFunding {
  const base = { version: FUNDING_CORROBORATION_VERSION, corroborated_rounds: 0, conflicts: [] as string[] };
  const sources: string[] = [];
  if (i.atomus) sources.push(ATOMUS_FUNDING_ACTOR_KEY);
  if (i.pvalyou) sources.push(PVALYOU_FUNDING_ACTOR_KEY);
  if (!i.atomus && !i.pvalyou) return { ...base, record: null, sources };
  // One provider alone: its record, as it is. atomus alone cites nothing, so a
  // PASS that must cite cannot happen; pvalyou alone carries no completeness.
  if (!i.atomus) return { ...base, record: { ...i.pvalyou!, reported_round_count: null, history_complete: null }, sources };
  if (!i.pvalyou) return { ...base, record: i.atomus, sources };

  const rounds: FundingRoundFact[] = i.atomus.rounds.map((r) => ({ ...r, source_urls: [...r.source_urls] }));
  const conflicts: string[] = [];
  let corroborated = 0;
  for (const p of i.pvalyou.rounds) {
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
      observed_at: i.pvalyou.observed_at ?? i.atomus.observed_at,
      source_url: i.atomus.source_url,
    },
  };
}

/** The funding-stage decision on corroborated evidence: PASS must cite the decisive round. */
export function decideCorroboratedFundingStage(i: {
  required_stage: string | null;
  atomus: FundingRecordFact | null;
  pvalyou: FundingRecordFact | null;
}): { decision: FundingStageDecision; corroboration: CorroboratedFunding } {
  const corroboration = corroborateFunding({ atomus: i.atomus, pvalyou: i.pvalyou });
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
