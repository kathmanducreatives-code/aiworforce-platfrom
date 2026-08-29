// Apify LinkedIn Jobs scraper → Agentory normalized candidate.
//
// The jobs actor (curious_coder/linkedin-jobs-scraper) returns rich company + job
// data (companyWebsite, companyLinkedinUrl, link, title, descriptionText,
// companyDescription, industries, companyEmployeesCount, jobPoster*). Earlier
// normalization layers dropped all of it, producing "no website" /
// "proof_incomplete" Workbench rows. This pure module preserves the source data
// into clean normalized fields + a structured raw object + real source proof.
//
// ── AND MORE THAN ONE ACTOR REACHES IT ──────────────────────────────────────
//
// Everything above describes ONE provider's dialect: flat keys, `companyName`,
// `companyLinkedinUrl`, `link`. `harvestapi/linkedin-job-search` — the Actor
// every hiring verification in the lead pipeline actually runs — nests the same
// facts:
//
//     { id, title, linkedinUrl, postedDate,
//       location: { linkedinText, parsed: { text } },
//       company:  { id, name, linkedinUrl, website, employeeCount, industries } }
//
// `firstStr` rejects non-strings, so `firstStr(r.companyName, r.company, …)`
// returned NULL for every harvestapi row: no company name, no company LinkedIn
// URL, no website, no location, no job URL. Only the title survived. Task
// a76c7b4c is what that cost — 84 paid rows, five real companies, and a hiring
// stage that reported nobody was hiring.
//
// So the alias lists now read the nested sub-objects alongside the flat keys.
// A provider that sends neither still normalizes to null, exactly as before;
// no field is invented, and no flat reading changes.
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

  /**
   * The company sub-object, when the provider nests it.
   *
   * Empty for a flat provider, which makes every `co.*` read below inert and
   * leaves the flat aliases behaving exactly as they always have.
   */
  const co = (r.company && typeof r.company === "object" && !Array.isArray(r.company)
    ? r.company : {}) as Record<string, unknown>;
  /** The location sub-object, same rule. harvestapi: `{ linkedinText, parsed }`. */
  const loc = (r.location && typeof r.location === "object" && !Array.isArray(r.location)
    ? r.location : {}) as Record<string, unknown>;
  const locParsed = (loc.parsed && typeof loc.parsed === "object"
    ? loc.parsed : {}) as Record<string, unknown>;

  const company = firstStr(
    r.companyName, co.name, r.company, r.company_name, r.organization, r.employer);
  const jobTitle = firstStr(r.title, r.jobTitle, r.positionName, r.position, r.name);
  // A shortener URL is never a real company website — drop it (the job/source URL
  // is preserved separately); company identity is weaker without a real site.
  const rawWebsite = firstStr(
    r.companyWebsite, co.website, r.company_website, r.website, r.companyUrl, r.companyLink);
  const websiteIsShortener = isShortenerUrl(rawWebsite);
  const website = websiteIsShortener ? null : rawWebsite;
  // `companyUrl` is crawlworks/linkedin-jobs-scraper's company LinkedIn URL
  // (e.g. "https://ca.linkedin.com/company/gumloop") — verified against the stored
  // provider payload of production task 15c31f55. It is accepted LAST and only
  // when it is actually a linkedin.com/company URL, so a non-LinkedIn `companyUrl`
  // from another actor cannot be mistaken for a LinkedIn company identity.
  // `([a-z0-9-]+\.)?` — ANY subdomain, not a two-letter one. This read
  // `([a-z]{2}\.)?`, which matches `ca.linkedin.com` (the example it was written
  // from) and NOT `www.linkedin.com`, the form LinkedIn actually returns.
  const LINKEDIN_COMPANY_URL = /^https?:\/\/([a-z0-9-]+\.)?linkedin\.com\/company\//i;
  const LINKEDIN_JOB_URL = /^https?:\/\/([a-z0-9-]+\.)?linkedin\.com\/jobs\//i;
  const companyUrlIsLinkedIn = LINKEDIN_COMPANY_URL.test(String(r.companyUrl ?? "").trim());
  const linkedinUrl = firstStr(
    r.companyLinkedinUrl, co.linkedinUrl, r.company_linkedin_url, r.companyLinkedin,
    r.companyPageUrl, companyUrlIsLinkedIn ? r.companyUrl : null,
  );
  // harvestapi puts the JOB posting's own URL at the top level under
  // `linkedinUrl` — the same key the flat dialect uses for the COMPANY page. It
  // is accepted only when the path says `/jobs/`, so the two can never be
  // confused: a company URL arriving there is ignored here and read above.
  const topLevelIsJobUrl = LINKEDIN_JOB_URL.test(String(r.linkedinUrl ?? "").trim());
  const jobUrl = firstStr(
    r.link, r.jobUrl, r.url, topLevelIsJobUrl ? r.linkedinUrl : null,
    r.applyUrl, r.jobPostingUrl);
  const jobDescription = firstStr(r.descriptionText, r.description, r.jobDescription, r.snippet);
  const companyDescription = firstStr(
    r.companyDescription, co.description, r.company_description, r.aboutCompany);
  // harvestapi sends `[{ id, name, title, hierarchy }]`; the flat dialect sends
  // strings. `toArray` handles strings, so the objects are mapped to their name
  // first — never to a stringified object.
  const industriesRaw = r.industries ?? co.industries ?? r.industry ?? r.companyIndustry;
  const industries = toArray(
    Array.isArray(industriesRaw)
      ? industriesRaw.map((x) =>
        x && typeof x === "object" ? (x as Record<string, unknown>).name : x)
      : industriesRaw,
  );
  // `companyEmployeeCount` (SINGULAR "Employee") is what
  // crawlworks/linkedin-jobs-scraper emits — verified against the stored provider
  // payload of production task 15c31f55. This list previously held only
  // `companyEmployeesCount` (PLURAL), so every crawlworks row normalized to
  // `employeeCount: null`: Gumloop's payload carries `"companyEmployeeCount":50`
  // and still produced null. The Company Brain then failed `employee_count` on a
  // 50-person company against a 1–150 band, because it was handed nothing.
  //
  // Same transposition class as the `postedDate`/`datePosted` gap fixed in #125.
  const employeeCount = toInt(
    r.companyEmployeeCount ?? r.companyEmployeesCount ?? r.employeeCount ??
      co.employeeCount ?? r.companySize ?? r.employees,
  );
  const location = firstStr(
    r.location, loc.linkedinText, locParsed.text, r.formattedLocation, r.jobLocation,
    r.city, r.address, r.companyLocation);
  const applyUrl = firstStr(r.applyUrl, r.apply_url, r.applicationUrl);
  const companyLogo = firstStr(r.companyLogo, co.logo, r.company_logo, r.logo);
  const companySlogan = firstStr(r.companySlogan, co.tagline, r.company_slogan, r.tagline);
  const employmentType = firstStr(r.employmentType, r.employment_type, r.jobType);
  const seniorityLevel = firstStr(r.seniorityLevel, r.seniority_level, r.seniority);
  const jobFunction = firstStr(r.jobFunction, r.job_function, r.function);
  const salary = firstStr(r.salary, r.salaryRange, r.compensation);
  // `postedDate` is the crawlworks/linkedin-jobs-scraper posting date (YYYY-MM-DD)
  // — verified official:2026-07-30 against
  // apify.com/crawlworks/linkedin-jobs-scraper. It was absent from this alias list,
  // which reads `datePosted` (Indeed's key) but not `postedDate` (LinkedIn's), so
  // every crawlworks row normalized to `posted_at: null`. `jobRecordToSignalEvent`
  // then correctly refused to fabricate freshness and rejected the row
  // `missing_occurred_at`, upstream of any company judgment. Production task
  // c30fbc6d round 3: 25 crawlworks rows in, 21 rejected `missing_occurred_at`,
  // 0 signals produced — including a SolarWinds "Director, Revenue Operations"
  // posted 20 hours earlier.
  //
  // The actor's two other date fields are deliberately NOT accepted:
  //   postedTime   — localized human text ("Vor 2 Tagen"), not parseable
  //   validThrough — application deadline, not a posting date; using it would
  //                  fabricate freshness for an expired listing.
  const postedAt = firstStr(
    r.postedAt, r.posted_at, r.datePosted, r.postedDate, r.listedAt, r.publishedAt);
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
  // harvestapi carries the company's addresses as `company.locations[]`, with the
  // headquarters flagged. Same three facts, different names.
  const coLocs = Array.isArray(co.locations) ? co.locations as Record<string, unknown>[] : [];
  const hq = (coLocs.find((l) => l && l.headquarter === true) ?? coLocs[0] ?? {}) as
    Record<string, unknown>;
  const companyAddress: CompanyAddress = {
    country: firstStr(addr.addressCountry, r["companyAddress/addressCountry"], r.addressCountry,
      hq.country),
    region: firstStr(addr.addressRegion, r["companyAddress/addressRegion"], r.addressRegion,
      hq.geographicArea),
    locality: firstStr(addr.addressLocality, r["companyAddress/addressLocality"], r.addressLocality,
      hq.city),
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
