// WRITING AND READING THE LINKEDIN ASSOCIATED-MEMBER SERIES.
//
// ── WHAT THE SERIES MEASURES (corrected 2026-09-24) ─────────────────────────
//
// The reading is LinkedIn's `employeeCount`: the number of members who list the
// company as a current position — NOT staff headcount (companySize.ts). The
// table and its `employee_count` column keep the names the migration gave them;
// what they hold is the associated-member count, and growth read from it is
// growth in LinkedIn presence, a proxy — never a staff delta.
//
// ── WHAT THIS OWNS ──────────────────────────────────────────────────────────
//
// The three decisions that must exist in exactly one place, or a growth series
// quietly stops being comparable:
//
//   WHICH READINGS QUALIFY   the associated-member count from the one source
//                            that reports it on a company record, never a
//                            declared band or a self-reported team size;
//   WHAT GROUPS A SERIES     the company key, derived from identity rather
//                            than from a name;
//   WHEN A READING WAS TAKEN the provider's observation time, not the write
//                            time.
//
// Every one of those is a rule the SQL cannot enforce on its own. The migration
// refuses a non-positive count and a same-day duplicate; it cannot know that
// `teamSize` from a YC scraper is advisory, or that two companies sharing a
// name are not one series.
//
// ── PURE, AND DELIBERATELY SO ───────────────────────────────────────────────
//
// No database client is imported. `buildSnapshotRow` returns a row and
// `readSeries` takes rows it is given, so every rule here is unit-tested
// without a database — the same reason `founderUnlockContract` is pure.
// Persistence is the caller's, and the caller is the enrichment stage.

import type { HeadcountSnapshot } from "./headcountGrowth.ts";
import { normalizeCompanyLinkedInUrl } from "./structuredCompanyEnrichment.ts";

export const HEADCOUNT_SNAPSHOT_STORE_VERSION = "headcount-snapshot-store-v1" as const;

/** The table the rows belong to. Named once. */
export const HEADCOUNT_SNAPSHOT_TABLE = "company_headcount_snapshots" as const;

/**
 * Sources whose LinkedIn associated-member count may enter a series.
 *
 * ── WHY THIS IS AN ALLOWLIST AND NOT A FIELD CHECK ─────────────────────────
 *
 * Several actors return something called a headcount and none of them is a
 * staff measurement. `apify_linkedin_company_details` returns `employeeCount`
 * — LinkedIn associated members, one consistent definition on the company
 * record, so its deltas are comparable. The YC scraper's `teamSize` is
 * self-reported and was observed stale (ShipBob returned 1); a declared band
 * and the funding source's `employeeCountBucket` are bands, not counts.
 *
 * A number is not a measurement because it is a number. Admitting any of the
 * others would produce a series whose deltas are provider disagreement rather
 * than hiring, and growth would be reported from noise.
 */
export const MEMBER_COUNT_SERIES_SOURCES: readonly string[] = Object.freeze([
  "apify_linkedin_company_details",
]);

export function isMemberCountSeriesSource(actorKey: string): boolean {
  return MEMBER_COUNT_SERIES_SOURCES.includes(actorKey);
}

/** A row ready for insert. Mirrors the migration's columns exactly. */
export interface HeadcountSnapshotRow {
  workspace_id: string;
  company_key: string;
  linkedin_company_url: string | null;
  canonical_domain: string | null;
  company_name: string | null;
  /** DB column name (migration). Holds LinkedIn ASSOCIATED MEMBERS, not staff. */
  employee_count: number;
  observed_at: string;
  source: string;
  task_id: string | null;
  provider_run_id: string | null;
}

export interface SnapshotInput {
  workspace_id: string;
  linkedin_company_url?: string | null;
  canonical_domain?: string | null;
  company_name?: string | null;
  /** LinkedIn associated members. A band or a team size must never be coerced into this. */
  linkedin_associated_member_count?: number | null;
  /** When the provider's reading was taken. Defaults to now. */
  observed_at?: string | null;
  /** Repo actor key of the source. */
  source: string;
  task_id?: string | null;
  provider_run_id?: string | null;
}

export type SnapshotRejection =
  | "no_workspace"
  | "no_identity"
  | "no_member_count"
  | "source_not_member_count"
  | "observed_at_invalid";

export interface SnapshotBuildResult {
  row: HeadcountSnapshotRow | null;
  /** Populated when no row was produced. One reason, never a list of maybes. */
  rejected: SnapshotRejection | null;
  reason: string;
}

/**
 * The value a series is grouped by.
 *
 * ── NEVER A COMPANY NAME ────────────────────────────────────────────────────
 *
 * Two companies share a name — the funding validation run attached an
 * Australian fintech's round to a Montreal music ensemble called Constantinople
 * — and a series keyed on a name would difference readings from two different
 * companies and report the gap between them as growth.
 *
 * LinkedIn URL first because it is the identity this system resolves to and the
 * one that survives a rebrand; canonical domain second. Normalised so that
 * `/company/stripe`, `/company/stripe/`, and the `/company/stripe/posts` form
 * the post actor returns all reduce to one key.
 */
export function companyKeyFor(
  linkedinUrl: string | null | undefined,
  domain: string | null | undefined,
): string | null {
  const li = normalizeCompanyLinkedInUrl(linkedinUrl ?? null);
  if (li) {
    const slug = li.replace(/^https?:\/\/(www\.)?linkedin\.com\/company\//i, "")
      .split(/[/?#]/)[0]
      .toLowerCase()
      .trim();
    if (slug) return `li:${slug}`;
  }
  const d = (domain ?? "").toString().trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return d ? `dom:${d}` : null;
}

/**
 * Turn an enrichment observation into a row, or refuse it with a reason.
 *
 * REFUSAL IS THE COMMON CASE and is not an error. Most enrichment results carry
 * no exact count, and writing a row anyway — with a band, or with a guess — is
 * how a growth capability starts reporting provider disagreement as hiring.
 */
export function buildSnapshotRow(i: SnapshotInput): SnapshotBuildResult {
  const reject = (rejected: SnapshotRejection, reason: string): SnapshotBuildResult =>
    ({ row: null, rejected, reason });

  if (!i.workspace_id) {
    return reject("no_workspace", "a snapshot is workspace-scoped and this has no workspace");
  }
  if (!isMemberCountSeriesSource(i.source)) {
    return reject("source_not_member_count",
      `${i.source} does not report a LinkedIn associated-member count on a company ` +
      `record. Only ${MEMBER_COUNT_SERIES_SOURCES.join(", ")} does; every other source ` +
      `reports a band or a self-declared figure, and differencing those measures ` +
      `provider disagreement rather than change.`);
  }
  const count = i.linkedin_associated_member_count;
  if (typeof count !== "number" || !Number.isFinite(count) ||
      !Number.isInteger(count) || count <= 0) {
    return reject("no_member_count",
      "no associated-member count on this observation. A series needs a measured " +
      "integer; a missing count is not a zero.");
  }
  const company_key = companyKeyFor(i.linkedin_company_url, i.canonical_domain);
  if (!company_key) {
    return reject("no_identity",
      "no LinkedIn company URL and no canonical domain. A series keyed on a " +
      "company NAME would difference two companies that share one.");
  }
  const observed = i.observed_at ?? new Date().toISOString();
  const t = new Date(observed).getTime();
  if (Number.isNaN(t)) {
    return reject("observed_at_invalid", `observed_at "${observed}" is not a date`);
  }

  return {
    row: {
      workspace_id: i.workspace_id,
      company_key,
      linkedin_company_url: normalizeCompanyLinkedInUrl(i.linkedin_company_url ?? null),
      canonical_domain: (i.canonical_domain ?? null)?.toString().toLowerCase() ?? null,
      company_name: i.company_name ?? null,
      employee_count: count,
      observed_at: new Date(t).toISOString(),
      source: i.source,
      task_id: i.task_id ?? null,
      provider_run_id: i.provider_run_id ?? null,
    },
    rejected: null,
    reason: "",
  };
}

/**
 * Turn stored rows into the series `evaluateHeadcountGrowth` consumes.
 *
 * Filters to ONE company key, because a series spanning two companies is not a
 * series. Sorted oldest-first, which is the order the evaluator documents it
 * expects rather than an order it happens to tolerate.
 */
export function readSeries(
  rows: readonly HeadcountSnapshotRow[], companyKey: string,
): HeadcountSnapshot[] {
  return rows
    .filter((r) => r.company_key === companyKey)
    .map((r) => ({
      observed_at: r.observed_at,
      employee_count: r.employee_count,
      source: r.source,
    }))
    .sort((a, b) =>
      new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime());
}

/**
 * Would this row be refused by the table's same-day uniqueness index?
 *
 * The index is the authority; this exists so a caller can skip a redundant
 * insert rather than issue one and swallow a conflict. Same company, same
 * source, same DAY — the figure does not change hourly, so a second reading in
 * a day is a repeat rather than an observation.
 */
export function isSameDayDuplicate(
  row: HeadcountSnapshotRow, existing: readonly HeadcountSnapshotRow[],
): boolean {
  const day = row.observed_at.slice(0, 10);
  return existing.some((e) =>
    e.workspace_id === row.workspace_id &&
    e.company_key === row.company_key &&
    e.source === row.source &&
    e.observed_at.slice(0, 10) === day);
}

/**
 * What a workspace can currently answer about growth, and what it cannot.
 *
 * Read by the coverage layer. A growth mission on a workspace with no history
 * is not a failure and not a capability gap in the provider sense — it is a
 * capability that will become available once a second reading exists, and the
 * user is owed that difference rather than a flat "unsupported".
 */
export interface SeriesReadiness {
  company_key: string;
  reading_count: number;
  /** True when two readings exist at all — not that they pass the growth rules. */
  differenceable: boolean;
  earliest_observed_at: string | null;
  latest_observed_at: string | null;
  reason: string;
}

export function seriesReadiness(
  rows: readonly HeadcountSnapshotRow[], companyKey: string,
): SeriesReadiness {
  const series = readSeries(rows, companyKey);
  const differenceable = series.length >= 2;
  return {
    company_key: companyKey,
    reading_count: series.length,
    differenceable,
    earliest_observed_at: series[0]?.observed_at ?? null,
    latest_observed_at: series[series.length - 1]?.observed_at ?? null,
    reason: differenceable
      ? `${series.length} readings on record; growth can be evaluated.`
      : series.length === 1
      ? "one reading on record. Growth is a difference between two dated " +
        "readings, so this becomes answerable after the next enrichment of " +
        "this company — not by asking a provider."
      : "no readings on record for this company yet.",
  };
}
