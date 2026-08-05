// SHOW THE WORK, WITHOUT CALLING IT A LEAD.
//
// TEST task 42e39fb1 discovered 25 companies, read 85 embedded YC roles, found
// six with genuine commercial-expansion signals inside the size range — and
// showed the user an empty Workbench, because persistence writes rows only for
// companies that pass the Company Brain.
//
// That rule is correct and must stay. An earlier run published 20 raw
// discoveries as "qualified companies", and the fail-closed fix is what stopped
// it. The problem is not that unqualified companies are excluded from the LEAD
// table; it is that there was nowhere else for them to appear.
//
// So there are TWO projections, and they are different kinds of thing:
//
//   * QUALIFIED rows   → `lead_candidates`. Real leads. Actionable. Counted
//                        against the quota. Written only on an explicit Brain
//                        pass, by the existing persistence path.
//   * EVALUATION rows  → `tasks.result.workbench_evaluation_rows`. Evidence of
//                        work done. NEVER actionable, never counted, and
//                        structurally incapable of being actioned because they
//                        carry no `lead_candidate_id` — every action path in the
//                        product requires one.
//
// The separation is the safety property. A progress row cannot leak into a quota
// or a people search by accident, because it is not the same shape and does not
// live in the same table.
//
// PURE. No network, no provider, no database.

export const WORKBENCH_PROJECTION_VERSION = "workbench-evaluation-projection-v1" as const;

/**
 * How far one company got. Ordered from least to most progressed.
 *
 * `not_qualified` and `qualified` are the only two that represent a DECISION.
 * Everything else records where the pipeline stopped, which is what makes an
 * empty result explainable instead of merely disappointing.
 */
export type WorkbenchLifecycle =
  | "discovered"
  | "evaluated"
  | "shortlisted"
  | "identity_unresolved"
  | "verifying"
  | "qualified"
  | "not_qualified"
  | "contact_ready";

export const LIFECYCLE_ORDER: readonly WorkbenchLifecycle[] = [
  "discovered", "evaluated", "shortlisted", "identity_unresolved",
  "verifying", "not_qualified", "qualified", "contact_ready",
];

/** Human-readable reason, shown verbatim in the Workbench. */
export const LIFECYCLE_EXPLANATION: Readonly<Record<WorkbenchLifecycle, string>> = Object.freeze({
  discovered: "Found by company discovery; not yet evaluated.",
  evaluated: "Evaluated against the mission's hiring signals and size range.",
  shortlisted: "Strong commercial hiring signal — queued for identity resolution.",
  identity_unresolved: "LinkedIn company identity could not be resolved, so verification could not run.",
  verifying: "Identity resolved; evidence collection in progress.",
  qualified: "Passed the Company Brain.",
  not_qualified: "Evaluated and did not meet the Company Brain's criteria.",
  contact_ready: "Verified decision-maker with a contact method.",
});

/** The minimum an engine company must expose to be projected. */
export interface ProjectableCompany {
  key: string;
  shortlisted: boolean;
  prequalified: {
    name: string;
    canonical_domain: string | null;
    team_size: number | null;
    best_tier: "A" | "B" | "C" | null;
    score: number;
    strongest_signal: string | null;
    exclusion: string | null;
    eligible: boolean;
    jobs: ReadonlyArray<{ title: string; tier: string }>;
    reasons: readonly string[];
    yc_url?: string | null;
  } | null;
  identityResolved: boolean;
  identityAttempted: boolean;
  enriched: boolean;
  hiringVerified: boolean;
  verdict: "pass" | "reject" | "unknown" | null;
  contactCount: number;
}

/**
 * Where did this company actually stop?
 *
 * Read from the FURTHEST point reached, working backwards, so a company is
 * never described as less progressed than it is. `qualified` requires an
 * explicit `pass` — an absent verdict is never a pass.
 */
export function deriveLifecycle(c: ProjectableCompany): WorkbenchLifecycle {
  if (c.verdict === "pass") return c.contactCount > 0 ? "contact_ready" : "qualified";
  if (c.verdict === "reject") return "not_qualified";
  // UNKNOWN IS NOT A REJECTION. It means the Brain could not decide, which is a
  // held state, so the company is reported at the stage it actually reached.
  if (c.enriched || c.hiringVerified) return "verifying";
  if (c.identityAttempted && !c.identityResolved) return "identity_unresolved";
  if (c.identityResolved) return "verifying";
  if (c.shortlisted) return "shortlisted";
  if (c.prequalified) return "evaluated";
  return "discovered";
}

/** One non-actionable row. Deliberately has no lead_candidate_id. */
export interface WorkbenchEvaluationRow {
  company_key: string;
  company_name: string;
  domain: string | null;
  employee_count: number | null;
  strongest_signal: string | null;
  signal_tier: "A" | "B" | "C" | null;
  /** The role that earned the shortlist, with its source URL when YC gave one. */
  supporting_job_title: string | null;
  supporting_job_url: string | null;
  prequalification_score: number;
  status: WorkbenchLifecycle;
  explanation: string;
  /** Why it was shortlisted, or why it was not. Factual, from the free pass. */
  reasons: string[];
  exclusion: string | null;
  /** ALWAYS FALSE. Present so a consumer must state the claim to break it. */
  actionable: false;
  counts_as_qualified: false;
}

export interface EvaluationProjection {
  version: typeof WORKBENCH_PROJECTION_VERSION;
  rows: WorkbenchEvaluationRow[];
  counts: {
    accounts_found: number;
    evaluated: number;
    shortlisted: number;
    identity_unresolved: number;
    qualified: number;
    contact_ready: number;
  };
}

/**
 * Project the engine's working set into non-actionable evaluation rows.
 *
 * QUALIFIED COMPANIES ARE EXCLUDED. They get real `lead_candidates` rows through
 * the existing persistence path; emitting them here too would show the same
 * company twice and invite a consumer to treat the non-actionable copy as a
 * lead.
 */
export function projectEvaluationRows(
  companies: readonly ProjectableCompany[],
): EvaluationProjection {
  const rows: WorkbenchEvaluationRow[] = [];
  let qualified = 0, contactReady = 0, shortlisted = 0, evaluated = 0, unresolved = 0;

  for (const c of companies) {
    const state = deriveLifecycle(c);
    if (state === "qualified") qualified++;
    if (state === "contact_ready") { qualified++; contactReady++; }
    if (c.shortlisted) shortlisted++;
    if (c.prequalified) evaluated++;
    if (state === "identity_unresolved") unresolved++;
    if (state === "qualified" || state === "contact_ready") continue;

    const pq = c.prequalified;
    const supporting = pq?.jobs.find((j) => j.title === pq.strongest_signal) ?? null;
    rows.push({
      company_key: c.key,
      company_name: pq?.name ?? c.key,
      domain: pq?.canonical_domain ?? null,
      employee_count: pq?.team_size ?? null,
      strongest_signal: pq?.strongest_signal ?? null,
      signal_tier: pq?.best_tier ?? null,
      supporting_job_title: supporting?.title ?? pq?.strongest_signal ?? null,
      supporting_job_url: (supporting as { url?: string } | null)?.url ?? pq?.yc_url ?? null,
      prequalification_score: pq?.score ?? 0,
      status: state,
      explanation: LIFECYCLE_EXPLANATION[state],
      reasons: [...(pq?.reasons ?? [])],
      exclusion: pq?.exclusion ?? null,
      actionable: false,
      counts_as_qualified: false,
    });
  }

  // ORDERED BY HOW FAR THEY GOT, then by score. The six companies that nearly
  // made it belong at the top; the technical-only rejects belong at the bottom.
  rows.sort((a, b) =>
    LIFECYCLE_ORDER.indexOf(b.status) - LIFECYCLE_ORDER.indexOf(a.status) ||
    b.prequalification_score - a.prequalification_score ||
    a.company_name.localeCompare(b.company_name));

  return {
    version: WORKBENCH_PROJECTION_VERSION,
    rows,
    counts: {
      accounts_found: companies.length,
      evaluated,
      shortlisted,
      identity_unresolved: unresolved,
      qualified,
      contact_ready: contactReady,
    },
  };
}

/**
 * Can this row be acted on? Always no.
 *
 * Exists so the rule is a function a test can call, rather than a convention
 * every call site is trusted to remember.
 */
export function evaluationRowIsActionable(_row: WorkbenchEvaluationRow): boolean {
  return false;
}

/** Rows eligible for a paid people search. Structurally always empty. */
export function peopleSearchEligible(
  rows: readonly WorkbenchEvaluationRow[],
): WorkbenchEvaluationRow[] {
  return rows.filter((r) => r.counts_as_qualified as boolean);
}
