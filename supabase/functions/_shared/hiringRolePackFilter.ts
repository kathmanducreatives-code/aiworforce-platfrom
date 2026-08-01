// DETERMINISTIC TITLE POST-FILTER — because the Actor's matching is fuzzy.
//
// harvestapi/linkedin-job-search treats `jobTitles` as a loose search. Live
// evidence from 2026-08-01: querying the four Sales-Operations titles returned
// "Enterprise Account Manager (Aviation)" at SpaceX, "Operation Manager Trainee"
// and "Account Manager, Small and Medium Business". Across packs A and B, ZERO
// returned titles were an exact pack match.
//
// So the Actor decides what to FETCH; this module decides what COUNTS.
//
// ── PACKS STAY SEPARATE ──────────────────────────────────────────────────────
// Sales Ops, Revenue Ops and GTM Ops are different buying centres. Merging them
// into one "ops" bucket would let a Sales-Ops posting satisfy a Revenue-Ops
// mission, which is the kind of quiet substitution that makes a lead look
// qualified and read as irrelevant to the recipient.
//
// Pure. No I/O.

export type TitleDisposition =
  | "exact_match"           // exactly a pack title
  | "approved_family_match" // the pack's discipline + an approved seniority
  | "adjacent_role"         // the discipline, but a seniority we did not ask for
  | "irrelevant"            // a different job
  | "ambiguous";            // discipline words present but the role is unclear

export interface RolePack {
  pack_id: string;
  label: string;
  /** Exact titles as requested. Compared case-insensitively, trimmed. */
  titles: readonly string[];
  /** Phrases that identify the DISCIPLINE. All must be ops-discipline specific. */
  discipline_markers: readonly string[];
}

export const SALES_OPS_PACK: RolePack = {
  pack_id: "sales_operations", label: "Sales Operations",
  titles: ["Sales Operations Manager", "Sales Operations Lead",
    "Head of Sales Operations", "Director of Sales Operations"],
  discipline_markers: ["sales operations", "sales ops"],
};

export const REVENUE_OPS_PACK: RolePack = {
  pack_id: "revenue_operations", label: "Revenue Operations",
  titles: ["Revenue Operations Manager", "Revenue Operations Lead",
    "Head of Revenue Operations", "Director of Revenue Operations"],
  discipline_markers: ["revenue operations", "revenue ops", "revops"],
};

export const GTM_OPS_PACK: RolePack = {
  pack_id: "gtm_operations", label: "GTM Operations",
  titles: ["GTM Operations Manager", "GTM Operations Lead",
    "Head of GTM Operations", "Director of GTM Operations"],
  discipline_markers: ["gtm operations", "gtm ops", "go-to-market operations",
    "go to market operations"],
};

export const DEFAULT_ROLE_PACKS: readonly RolePack[] =
  [SALES_OPS_PACK, REVENUE_OPS_PACK, GTM_OPS_PACK];

/** Seniorities the packs ask for. Present => family match rather than adjacent. */
const APPROVED_SENIORITY = [
  "manager", "lead", "head of", "director", "vp", "vice president", "senior manager",
];

/**
 * Titles that contain a discipline word but are a DIFFERENT job.
 *
 * Every entry here was a real false positive in the benchmark, or is the
 * generic-operations case the brief calls out. `head of operations` is the
 * subtle one: it is a real senior ops role, but it is company operations, not
 * sales/revenue/GTM operations.
 */
const KNOWN_FALSE_POSITIVES: readonly string[] = [
  "account manager", "account executive", "operations manager trainee",
  "operation manager trainee", "sales development representative",
  "customer success", "inside sales campaign specialist",
];

/** Generic ops titles that must never satisfy a specific ops pack. */
const GENERIC_OPS_TITLES: readonly string[] = [
  "head of operations", "operations manager", "operations specialist",
  "business operations", "strategic operations", "service operations",
  "support operations", "program manager", "chief of staff",
  "ai operations associate", "founding ops", "deployment operations",
];

const norm = (t: string | null | undefined): string =>
  (t ?? "").toLowerCase().replace(/\s+/g, " ").replace(/[–—]/g, "-").trim();

export interface TitleJudgement {
  disposition: TitleDisposition;
  pack_id: string | null;
  matched_title: string | null;
  reason: string;
}

/**
 * Judge ONE title against ONE pack.
 *
 * Order matters: exact first, then explicit false positives, then discipline.
 * A title is never promoted by a later rule — every step can only narrow.
 */
export function judgeTitleForPack(title: string | null | undefined, pack: RolePack): TitleJudgement {
  const t = norm(title);
  if (!t) return { disposition: "irrelevant", pack_id: pack.pack_id, matched_title: null, reason: "empty_title" };

  // 1. EXACT.
  for (const want of pack.titles) {
    if (t === norm(want)) {
      return { disposition: "exact_match", pack_id: pack.pack_id, matched_title: want, reason: "exact_title" };
    }
  }

  const hasDiscipline = pack.discipline_markers.some((m) => t.includes(m));

  // 2. KNOWN FALSE POSITIVES — rejected even if a discipline word appears.
  const fp = KNOWN_FALSE_POSITIVES.find((x) => t.includes(x));
  if (fp && !hasDiscipline) {
    return { disposition: "irrelevant", pack_id: pack.pack_id, matched_title: null,
      reason: `known_false_positive:${fp}` };
  }

  // 3. NO DISCIPLINE => not this pack. Generic ops is called out explicitly so
  //    the reason is readable in a diagnostic rather than a bare "irrelevant".
  if (!hasDiscipline) {
    const generic = GENERIC_OPS_TITLES.find((x) => t.includes(x));
    return { disposition: "irrelevant", pack_id: pack.pack_id, matched_title: null,
      reason: generic ? `generic_operations_not_pack_discipline:${generic}` : "different_discipline" };
  }

  // 4. DISCIPLINE PRESENT — seniority decides family vs adjacent.
  const seniority = APPROVED_SENIORITY.find((sx) => t.includes(sx));
  if (seniority) {
    return { disposition: "approved_family_match", pack_id: pack.pack_id, matched_title: null,
      reason: `discipline+approved_seniority:${seniority}` };
  }
  // Discipline with a junior/IC seniority we did not request.
  if (/\b(analyst|associate|coordinator|specialist|intern|trainee)\b/.test(t)) {
    return { disposition: "adjacent_role", pack_id: pack.pack_id, matched_title: null,
      reason: "discipline+unrequested_seniority" };
  }
  return { disposition: "ambiguous", pack_id: pack.pack_id, matched_title: null,
    reason: "discipline_present_seniority_unclear" };
}

const RANK: Record<TitleDisposition, number> = {
  exact_match: 4, approved_family_match: 3, ambiguous: 2, adjacent_role: 1, irrelevant: 0,
};

/**
 * Judge a title against several packs, returning the STRONGEST disposition.
 *
 * Packs stay separate in the result: the winning `pack_id` says which buying
 * centre matched, so a Revenue-Ops mission can reject a Sales-Ops hit rather
 * than silently absorbing it.
 */
export function judgeTitle(
  title: string | null | undefined,
  packs: readonly RolePack[] = DEFAULT_ROLE_PACKS,
): TitleJudgement {
  let best: TitleJudgement = {
    disposition: "irrelevant", pack_id: null, matched_title: null, reason: "no_pack_matched",
  };
  for (const p of packs) {
    const j = judgeTitleForPack(title, p);
    if (RANK[j.disposition] > RANK[best.disposition]) best = j;
  }
  return best;
}

export interface PackFilterResult<T> {
  pack_id: string;
  kept: Array<T & { title_judgement: TitleJudgement }>;
  rejected: Array<T & { title_judgement: TitleJudgement }>;
  counts: Record<TitleDisposition, number>;
}

/**
 * Filter jobs for ONE pack. Only exact and approved-family matches are kept —
 * adjacent and ambiguous are retained in `rejected` with their reason so a
 * diagnostic can show what was discarded and why.
 */
export function filterJobsForPack<T extends { title?: string | null }>(
  jobs: readonly T[], pack: RolePack,
): PackFilterResult<T> {
  const counts: Record<TitleDisposition, number> = {
    exact_match: 0, approved_family_match: 0, adjacent_role: 0, irrelevant: 0, ambiguous: 0,
  };
  const kept: Array<T & { title_judgement: TitleJudgement }> = [];
  const rejected: Array<T & { title_judgement: TitleJudgement }> = [];
  for (const j of jobs) {
    const judgement = judgeTitleForPack(j.title, pack);
    counts[judgement.disposition] += 1;
    const row = { ...j, title_judgement: judgement };
    if (judgement.disposition === "exact_match" || judgement.disposition === "approved_family_match") {
      kept.push(row);
    } else {
      rejected.push(row);
    }
  }
  return { pack_id: pack.pack_id, kept, rejected, counts };
}

/** Run every pack SEPARATELY. Never merged — see the header. */
export function filterJobsByPacks<T extends { title?: string | null }>(
  jobs: readonly T[], packs: readonly RolePack[] = DEFAULT_ROLE_PACKS,
): PackFilterResult<T>[] {
  return packs.map((p) => filterJobsForPack(jobs, p));
}
