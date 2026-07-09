// Apify LinkedIn Jobs scraper → Agentory normalized candidate.
//
// The jobs actor (curious_coder/linkedin-jobs-scraper) returns rich company + job
// data (companyWebsite, companyLinkedinUrl, link, title, descriptionText,
// companyDescription, industries, companyEmployeesCount, jobPoster*). Earlier
// normalization layers dropped all of it, producing "no website" /
// "proof_incomplete" Workbench rows. This pure module preserves the source data
// into clean normalized fields + a structured raw object + real source proof.
//
// Pure / import-free so it is fully unit-testable. Never fabricates URLs or proof.

export interface SourceProofItem {
  url: string;
  type: "job_posting" | "company_website" | "linkedin_company";
  title: string | null;
  snippet: string | null;
  confidence: number;
}
export interface PosterContactHint {
  name: string | null;
  profile_url: string | null;
  title: string | null;
  photo: string | null;
}
export interface CompanyAddress {
  country: string | null;
  region: string | null;
  locality: string | null;
  street: string | null;
}
export type SourceQuality = "verified" | "partial" | "incomplete";

export interface NormalizedJob {
  company: string | null;
  jobTitle: string | null;
  website: string | null;
  domain: string | null;
  linkedinUrl: string | null;   // company LinkedIn URL
  jobUrl: string | null;
  applyUrl: string | null;
  location: string | null;
  industries: string[];
  employeeCount: number | null;
  companyDescription: string | null;
  companyLogo: string | null;
  companySlogan: string | null;
  companyAddress: CompanyAddress;
  jobDescription: string | null;
  employmentType: string | null;
  seniorityLevel: string | null;
  jobFunction: string | null;
  salary: string | null;
  postedAt: string | null;
  applicantsCount: number | null;
  posterContactHint: PosterContactHint;
  // Provider/debug identifiers (never shown as evidence; useful for dedup + tracing).
  providerJobId: string | null;
  providerRefId: string | null;
  providerTrackingId: string | null;
  inputUrl: string | null;
  exactHiringSignal: string | null;
  signalSummary: string | null;
  sourceProof: SourceProofItem[];
  sourceQuality: SourceQuality;
  raw: Record<string, unknown>;
}

function str(v: unknown): string | null {
  if (typeof v === "number") return String(v);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function firstStr(...vs: unknown[]): string | null {
  for (const v of vs) { const s = str(v); if (s) return s; }
  return null;
}
function toArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter((x): x is string => !!x);
  const s = str(v);
  return s ? s.split(/[,;|]/).map((x) => x.trim()).filter(Boolean) : [];
}
function toInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  const s = String(v ?? "").replace(/[,\s]/g, "");
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

const JOB_BOARD_HOST = /(?:^|\.)(linkedin\.com|indeed\.com|wellfound\.com|ziprecruiter\.com|glassdoor\.com|lever\.co|greenhouse\.io|ashbyhq\.com|workable\.com)$/i;
// URL shorteners are NEVER a company website/domain (Part 5).
const SHORTENER_HOST = /(?:^|\.)(bit\.ly|tinyurl\.com|t\.co|lnkd\.in|goo\.gl|ow\.ly|rebrand\.ly|shorturl\.at|cutt\.ly|buff\.ly|is\.gd)$/i;

/** True if the URL/host is a known link shortener (not a real company site). */
export function isShortenerUrl(url: string | null | undefined): boolean {
  const u = str(url);
  if (!u) return false;
  try {
    const withProto = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    const host = new URL(withProto).hostname.replace(/^www\./i, "").toLowerCase();
    return SHORTENER_HOST.test(host);
  } catch {
    return false;
  }
}

/** Parse a safe company domain from a URL. Returns null for job-board hosts,
 *  link shorteners, or unparseable input. */
export function parseDomain(url: string | null | undefined): string | null {
  const u = str(url);
  if (!u) return null;
  try {
    const withProto = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    const host = new URL(withProto).hostname.replace(/^www\./i, "").toLowerCase();
    if (!host || !host.includes(".")) return null;
    if (JOB_BOARD_HOST.test(host)) return null;   // a job board is not a company domain
    if (SHORTENER_HOST.test(host)) return null;   // a shortener is not a company domain
    return host;
  } catch {
    return null;
  }
}

/** Evidence-based one-line signal summary (never claims ICP/SaaS/AI fit). */
export function buildSignalSummary(n: { jobTitle: string | null; company: string | null }): string {
  const role = n.jobTitle ?? "a role";
  return n.company
    ? `Hiring ${role} at ${n.company} — from a live LinkedIn job post.`
    : `Hiring ${role} — from a live LinkedIn job post.`;
}

/** Normalize one Apify jobs row. Accepts the actor's field names + common fallbacks. */
export function normalizeApifyJobRow(row: unknown): NormalizedJob {
  const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;

  const company = firstStr(r.companyName, r.company, r.company_name, r.organization, r.employer);
  const jobTitle = firstStr(r.title, r.jobTitle, r.positionName, r.position, r.name);
  // A shortener URL is never a real company website — drop it (the job/source URL
  // is preserved separately); company identity is weaker without a real site.
  const rawWebsite = firstStr(r.companyWebsite, r.company_website, r.website, r.companyUrl, r.companyLink);
  const websiteIsShortener = isShortenerUrl(rawWebsite);
  const website = websiteIsShortener ? null : rawWebsite;
  const linkedinUrl = firstStr(r.companyLinkedinUrl, r.company_linkedin_url, r.companyLinkedin, r.companyPageUrl);
  const jobUrl = firstStr(r.link, r.jobUrl, r.url, r.applyUrl, r.jobPostingUrl);
  const jobDescription = firstStr(r.descriptionText, r.description, r.jobDescription, r.snippet);
  const companyDescription = firstStr(r.companyDescription, r.company_description, r.aboutCompany);
  const industries = toArray(r.industries ?? r.industry ?? r.companyIndustry);
  const employeeCount = toInt(r.companyEmployeesCount ?? r.employeeCount ?? r.companySize ?? r.employees);
  const location = firstStr(r.location, r.formattedLocation, r.jobLocation, r.city, r.address, r.companyLocation);
  const applyUrl = firstStr(r.applyUrl, r.apply_url, r.applicationUrl);
  const companyLogo = firstStr(r.companyLogo, r.company_logo, r.logo);
  const companySlogan = firstStr(r.companySlogan, r.company_slogan, r.tagline);
  const employmentType = firstStr(r.employmentType, r.employment_type, r.jobType);
  const seniorityLevel = firstStr(r.seniorityLevel, r.seniority_level, r.seniority);
  const jobFunction = firstStr(r.jobFunction, r.job_function, r.function);
  const salary = firstStr(r.salary, r.salaryRange, r.compensation);
  const postedAt = firstStr(r.postedAt, r.posted_at, r.datePosted, r.listedAt);
  const applicantsCount = toInt(r.applicantsCount ?? r.applicants ?? r.numApplicants);
  const posterContactHint: PosterContactHint = {
    name: firstStr(r.jobPosterName, r.posterName, r.hiringManagerName),
    profile_url: firstStr(r.jobPosterProfileUrl, r.posterProfileUrl, r.jobPosterUrl),
    title: firstStr(r.jobPosterTitle, r.posterTitle, r.hiringManagerTitle),
    photo: firstStr(r.jobPosterPhoto, r.posterPhoto, r.jobPosterImage),
  };

  // companyAddress arrives nested ({ addressCountry, ... }) from the Apify API, or
  // flattened ("companyAddress/addressCountry") from a CSV round-trip — accept both.
  const addr = (r.companyAddress && typeof r.companyAddress === "object" ? r.companyAddress : {}) as Record<string, unknown>;
  const companyAddress: CompanyAddress = {
    country: firstStr(addr.addressCountry, r["companyAddress/addressCountry"], r.addressCountry),
    region: firstStr(addr.addressRegion, r["companyAddress/addressRegion"], r.addressRegion),
    locality: firstStr(addr.addressLocality, r["companyAddress/addressLocality"], r.addressLocality),
    street: firstStr(addr.streetAddress, r["companyAddress/streetAddress"], r.streetAddress),
  };

  const providerJobId = firstStr(r.id, r.jobId, r.job_id);
  const providerRefId = firstStr(r.refId, r.ref_id);
  const providerTrackingId = firstStr(r.trackingId, r.tracking_id);
  const inputUrl = firstStr(r.inputUrl, r.input_url);

  const domain = parseDomain(website);

  // Source proof — only from real URLs the scraper returned. Never fabricated.
  const sourceProof: SourceProofItem[] = [];
  if (jobUrl) sourceProof.push({ url: jobUrl, type: "job_posting", title: jobTitle, snippet: jobDescription?.slice(0, 300) ?? null, confidence: 90 });
  if (website) sourceProof.push({ url: website, type: "company_website", title: company, snippet: companyDescription?.slice(0, 300) ?? null, confidence: 80 });
  if (linkedinUrl) sourceProof.push({ url: linkedinUrl, type: "linkedin_company", title: company, snippet: null, confidence: 80 });

  const sourceQuality: SourceQuality = sourceProof.length === 0
    ? "incomplete"
    : (sourceProof.some((p) => p.type === "job_posting") && (website || linkedinUrl) ? "verified" : "partial");

  const exactHiringSignal = jobTitle ? `${jobTitle}${company ? ` @ ${company}` : ""}` : null;
  const signalSummary = buildSignalSummary({ jobTitle, company });

  return {
    company, jobTitle, website, domain, linkedinUrl, jobUrl, applyUrl, location,
    industries, employeeCount, companyDescription, companyLogo, companySlogan, companyAddress,
    jobDescription, employmentType, seniorityLevel, jobFunction, salary, postedAt, applicantsCount,
    posterContactHint, providerJobId, providerRefId, providerTrackingId, inputUrl,
    exactHiringSignal, signalSummary, sourceProof, sourceQuality,
    // Clean, clearly-named raw object (spec Phase 1) — preserves the source data.
    raw: {
      provider: "apify",
      source_type: "hiring",
      company_website: website,
      domain,
      // Preserve the dropped shortener as source-only + flag missing website.
      website_shortener_dropped: websiteIsShortener,
      ...(websiteIsShortener ? { shortener_url: rawWebsite, missing_evidence: ["verified company website"] } : {}),
      company_linkedin_url: linkedinUrl,
      company_logo: companyLogo,
      company_slogan: companySlogan,
      company_address: companyAddress,
      job_url: jobUrl,
      apply_url: applyUrl,
      job_title: jobTitle,
      job_description: jobDescription,
      company_description: companyDescription,
      industries,
      employee_count: employeeCount,
      employment_type: employmentType,
      seniority_level: seniorityLevel,
      job_function: jobFunction,
      salary,
      posted_at: postedAt,
      applicants_count: applicantsCount,
      location,
      exact_hiring_signal: exactHiringSignal,
      signal_summary: signalSummary,
      source_quality: sourceQuality,
      source_proof: sourceProof,
      poster_contact_hint: posterContactHint,
      provider_job_id: providerJobId,
      provider_ref_id: providerRefId,
      provider_tracking_id: providerTrackingId,
      input_url: inputUrl,
      provider_payload: r,
    },
  };
}
