// Job adapter: real apify_jobs actor rows → the pipeline's CompoundJob shape.
//
// Reuses the REAL normalizer (normalizeApifyJobRow → NormalizedJob) so the runtime
// and the pipeline see identical job fields. Pure + deterministic; malformed rows
// are dropped with a recorded reason rather than crashing the run.

import { normalizeApifyJobRow, type NormalizedJob } from "./apifyJobsNormalizer.ts";
import type { CompoundJob } from "./compoundSourcingPipeline.ts";

export interface JobAdapterResult {
  jobs: CompoundJob[];
  dropped: Array<{ reason: string; index: number }>;
}

/** Map ONE already-normalized job into the pipeline shape (or null if unusable). */
export function normalizedJobToCompoundJob(n: NormalizedJob): CompoundJob | null {
  // A usable hiring signal needs at least a title AND a company identity.
  if (!n.jobTitle && !n.company) return null;
  return {
    title: n.jobTitle,
    company: n.company,
    companyDomain: n.domain,
    companyWebsite: n.website,
    companyLinkedinUrl: n.linkedinUrl,
    companyDescription: n.companyDescription,
    industries: n.industries ?? null,
    location: n.location,
    url: n.jobUrl ?? n.applyUrl ?? null,
    postedDate: n.postedAt,
    descriptionExcerpt: (n.jobDescription ?? n.signalSummary ?? "").slice(0, 800) || null,
    open: true,

    // COMPANY EVIDENCE FOR THE BRAIN GATE.
    //
    // `CompoundJob` declares these four fields specifically so the Company Brain
    // can evaluate a company, and this mapping omitted ALL of them. The pipeline
    // reads `j0.companyEmployeeCount`, which was therefore `undefined` for every
    // company from every source, and the Brain failed `employee_count` on all ten
    // companies of production task 15c31f55 — including Gumloop, whose provider
    // payload carries `companyEmployeeCount: 50` against a 1–150 band.
    //
    // Only `employeeCount` is carried, because it is the only one of the four the
    // normalizer actually has. Stage, business model and founder-led are NOT
    // synthesised: the LinkedIn actor supplies `companyType` ("Privately Held"),
    // which is an ownership type and not a business model, and inferring one from
    // the other would be fabricated evidence. They stay absent, which the Brain
    // reads as UNKNOWN rather than as a negative.
    companyEmployeeCount: n.employeeCount,
  };
}

/** Normalize + map a batch of RAW apify_jobs rows. Malformed rows are recorded,
 *  never thrown. `max` bounds the output (provider-limit enforcement). */
export function compoundJobsFromRawRows(rows: unknown[], max: number): JobAdapterResult {
  const jobs: CompoundJob[] = [];
  const dropped: JobAdapterResult["dropped"] = [];
  for (let i = 0; i < rows.length && jobs.length < max; i++) {
    let mapped: CompoundJob | null = null;
    try {
      const n = normalizeApifyJobRow(rows[i]);
      mapped = normalizedJobToCompoundJob(n);
    } catch (e) {
      dropped.push({ reason: `normalize_error:${(e as Error).message}`, index: i });
      continue;
    }
    if (!mapped) { dropped.push({ reason: "missing_title_and_company", index: i }); continue; }
    if (!mapped.url) { dropped.push({ reason: "missing_job_url", index: i }); continue; }
    jobs.push(mapped);
  }
  return { jobs, dropped };
}
