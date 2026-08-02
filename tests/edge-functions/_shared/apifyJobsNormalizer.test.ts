import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeApifyJobRow, parseDomain, buildSignalSummary, isShortenerUrl } from "../../../supabase/functions/_shared/apifyJobsNormalizer.ts";

// Representative Apify LinkedIn Jobs row.
const row = {
  companyName: "Acme Robotics",
  title: "Revenue Operations Manager",
  link: "https://www.linkedin.com/jobs/view/123456",
  descriptionText: "We are hiring a Revenue Operations Manager to own our GTM systems and reporting.",
  companyWebsite: "https://www.acmerobotics.com/careers",
  companyLinkedinUrl: "https://www.linkedin.com/company/acme-robotics",
  companyDescription: "Acme Robotics builds warehouse automation.",
  industries: ["Robotics", "Automation"],
  companyEmployeesCount: 62,
  location: "San Francisco, CA",
  jobPosterName: "Jane Doe",
  jobPosterProfileUrl: "https://www.linkedin.com/in/janedoe",
  jobPosterTitle: "Head of Talent",
};

// Test 1 — companyWebsite → website + raw.company_website; no "no website".
Deno.test("Test 1: companyWebsite → normalized.website + raw.company_website + domain", () => {
  const n = normalizeApifyJobRow(row);
  assertEquals(n.website, "https://www.acmerobotics.com/careers");
  assertEquals(n.raw.company_website, "https://www.acmerobotics.com/careers");
  assertEquals(n.domain, "acmerobotics.com");
  assert(n.website && n.website !== "no website");
});

// Test 2 — companyLinkedinUrl → linkedinUrl + raw + LinkedIn company proof.
Deno.test("Test 2: companyLinkedinUrl → linkedinUrl + raw + sourceProof(linkedin_company)", () => {
  const n = normalizeApifyJobRow(row);
  assertEquals(n.linkedinUrl, "https://www.linkedin.com/company/acme-robotics");
  assertEquals(n.raw.company_linkedin_url, "https://www.linkedin.com/company/acme-robotics");
  assert(n.sourceProof.some((p) => p.type === "linkedin_company" && p.url === n.linkedinUrl));
});

// Test 3 — link → jobUrl + job posting proof; source URL never proof_incomplete.
Deno.test("Test 3: link → jobUrl + job_posting proof; no proof_incomplete", () => {
  const n = normalizeApifyJobRow(row);
  assertEquals(n.jobUrl, "https://www.linkedin.com/jobs/view/123456");
  assert(n.sourceProof.some((p) => p.type === "job_posting" && p.confidence === 90));
  assert(n.sourceProof.every((p) => p.url !== "proof_incomplete"));
  assertEquals(n.sourceQuality, "verified");
});

// Test 4 — title → jobTitle + exactHiringSignal shows the exact role.
Deno.test("Test 4: title → jobTitle + exact hiring signal + evidence-based summary", () => {
  const n = normalizeApifyJobRow(row);
  assertEquals(n.jobTitle, "Revenue Operations Manager");
  assertEquals(n.exactHiringSignal, "Revenue Operations Manager @ Acme Robotics");
  assert(n.signalSummary?.includes("Revenue Operations Manager"));
  assert(!/b2b|saas|\bai\b|icp fit/i.test(n.signalSummary ?? ""), "no unsupported ICP/SaaS/AI claims");
});

// Test 5 — jobPoster* preserved as a contact hint (no people scraper needed).
Deno.test("Test 5: jobPoster* → posterContactHint preserved without a people scrape", () => {
  const n = normalizeApifyJobRow(row);
  assertEquals(n.posterContactHint.name, "Jane Doe");
  assertEquals(n.posterContactHint.profile_url, "https://www.linkedin.com/in/janedoe");
  assertEquals(n.posterContactHint.title, "Head of Talent");
  assertEquals((n.raw.poster_contact_hint as any).name, "Jane Doe");
});

// Test 6 — no source URLs → empty proof + incomplete; NO fake proof_incomplete URL.
Deno.test("Test 6: no URLs → sourceProof empty, sourceQuality incomplete, no fake URL", () => {
  const n = normalizeApifyJobRow({ companyName: "Ghost Co", title: "Ops Lead" });
  assertEquals(n.sourceProof.length, 0);
  assertEquals(n.sourceQuality, "incomplete");
  assertEquals(n.website, null);
  assertEquals(n.jobUrl, null);
  assert(!JSON.stringify(n).includes("proof_incomplete"));
});

// helpers + resilience
Deno.test("parseDomain: real site parsed, job boards rejected, garbage → null", () => {
  assertEquals(parseDomain("https://www.acme.com/careers"), "acme.com");
  assertEquals(parseDomain("acme.io"), "acme.io");
  assertEquals(parseDomain("https://www.linkedin.com/company/x"), null);
  assertEquals(parseDomain("not a url"), null);
  assertEquals(parseDomain(null), null);
});
Deno.test("industries/employees accept strings + numbers; older rows don't crash", () => {
  const n = normalizeApifyJobRow({ title: "X", industries: "Fintech, SaaS", companyEmployeesCount: "1,200 employees" });
  assertEquals(n.industries, ["Fintech", "SaaS"]);
  assertEquals(n.employeeCount, 1200);
  // empty input
  const e = normalizeApifyJobRow({});
  assertEquals(e.company, null);
  assertEquals(e.industries.length, 0);
});
Deno.test("buildSignalSummary is evidence-based", () => {
  assert(buildSignalSummary({ jobTitle: "Growth Ops Lead", company: "Foo" }).includes("Growth Ops Lead"));
});

// ---- Full 33-field Apify LinkedIn-Jobs row (the uploaded dataset shape) ----
const fullRow = {
  applicantsCount: 25,
  applyUrl: "https://boards.greenhouse.io/acme/jobs/999/apply",
  companyAddress: {
    addressCountry: "United States",
    addressLocality: "San Francisco",
    addressRegion: "CA",
    postalCode: "94107",
    streetAddress: "500 Howard St",
    type: "PostalAddress",
  },
  companyDescription: "Acme Robotics builds warehouse automation.",
  companyEmployeesCount: 62,
  companyLinkedinUrl: "https://www.linkedin.com/company/acme-robotics",
  companyLogo: "https://media.licdn.com/acme-logo.png",
  companyName: "Acme Robotics",
  companySlogan: "Automate the warehouse.",
  companyWebsite: "https://www.acmerobotics.com",
  descriptionHtml: "<p>We are hiring a RevOps lead.</p>",
  descriptionText: "We are hiring a Revenue Operations Manager to own our GTM systems.",
  employmentType: "Full-time",
  id: "4372091994",
  industries: ["Robotics", "Automation"],
  inputUrl: "https://www.linkedin.com/jobs/search?keywords=RevOps",
  jobFunction: "Sales",
  jobPosterName: "Jane Doe",
  jobPosterPhoto: "https://media.licdn.com/jane.png",
  jobPosterProfileUrl: "https://www.linkedin.com/in/janedoe",
  link: "https://www.linkedin.com/jobs/view/4372091994",
  location: "San Francisco, CA",
  postedAt: "2026-06-30",
  refId: "xBMEgX7aZ",
  salary: "$120k–$160k",
  seniorityLevel: "Mid-Senior level",
  title: "Revenue Operations Manager",
  trackingId: "a8KcoXKkq8",
};

Deno.test("Test 7: extended company identity — logo, slogan, address all mapped", () => {
  const n = normalizeApifyJobRow(fullRow);
  assertEquals(n.companyLogo, "https://media.licdn.com/acme-logo.png");
  assertEquals(n.companySlogan, "Automate the warehouse.");
  assertEquals(n.companyAddress.country, "United States");
  assertEquals(n.companyAddress.region, "CA");
  assertEquals(n.companyAddress.locality, "San Francisco");
  assertEquals(n.companyAddress.street, "500 Howard St");
});

Deno.test("Test 8: job context — apply/employment/seniority/function/salary/posted/applicants", () => {
  const n = normalizeApifyJobRow(fullRow);
  assertEquals(n.applyUrl, "https://boards.greenhouse.io/acme/jobs/999/apply");
  assertEquals(n.employmentType, "Full-time");
  assertEquals(n.seniorityLevel, "Mid-Senior level");
  assertEquals(n.jobFunction, "Sales");
  assertEquals(n.salary, "$120k–$160k");
  assertEquals(n.postedAt, "2026-06-30");
  assertEquals(n.applicantsCount, 25);
});

Deno.test("Test 9: poster photo + provider ids preserved", () => {
  const n = normalizeApifyJobRow(fullRow);
  assertEquals(n.posterContactHint.photo, "https://media.licdn.com/jane.png");
  assertEquals(n.providerJobId, "4372091994");
  assertEquals(n.providerRefId, "xBMEgX7aZ");
  assertEquals(n.providerTrackingId, "a8KcoXKkq8");
  assertEquals(n.inputUrl, "https://www.linkedin.com/jobs/search?keywords=RevOps");
});

Deno.test("Test 10: raw preserves clean names + full provider_payload for debugging", () => {
  const n = normalizeApifyJobRow(fullRow);
  assertEquals(n.raw.company_logo, "https://media.licdn.com/acme-logo.png");
  assertEquals(n.raw.employment_type, "Full-time");
  assertEquals(n.raw.applicants_count, 25);
  assertEquals((n.raw.company_address as any).region, "CA");
  // Full original row is retained under provider_payload.
  assertEquals((n.raw.provider_payload as any).descriptionHtml, "<p>We are hiring a RevOps lead.</p>");
});

Deno.test("Test 11: flattened companyAddress/* keys (CSV round-trip) also map", () => {
  const n = normalizeApifyJobRow({
    title: "Ops Lead",
    "companyAddress/addressCountry": "Canada",
    "companyAddress/addressRegion": "ON",
    "companyAddress/addressLocality": "Toronto",
    "companyAddress/streetAddress": "1 King St",
  });
  assertEquals(n.companyAddress.country, "Canada");
  assertEquals(n.companyAddress.region, "ON");
  assertEquals(n.companyAddress.locality, "Toronto");
  assertEquals(n.companyAddress.street, "1 King St");
});

Deno.test("Test 12: legacy row missing all extended fields → nulls, never crashes", () => {
  const n = normalizeApifyJobRow({ companyName: "Old Co", title: "Ops" });
  assertEquals(n.companyLogo, null);
  assertEquals(n.applyUrl, null);
  assertEquals(n.salary, null);
  assertEquals(n.applicantsCount, null);
  assertEquals(n.companyAddress.country, null);
  assertEquals(n.posterContactHint.photo, null);
  assertEquals(n.providerJobId, null);
});

// Part 5 — link shorteners are never a real company website/domain.
Deno.test("Part5: isShortenerUrl detects known shorteners, ignores real sites", () => {
  for (const u of ["https://bit.ly/abc", "lnkd.in/xyz", "http://t.co/q", "tinyurl.com/z", "https://ow.ly/aa"]) {
    assert(isShortenerUrl(u), `${u} should be a shortener`);
  }
  for (const u of ["https://ajax.com", "https://pilot.com/careers", "acme.io", "", null, undefined]) {
    assert(!isShortenerUrl(u as string), `${u} should NOT be a shortener`);
  }
});

Deno.test("Part5: parseDomain rejects shortener hosts", () => {
  assertEquals(parseDomain("https://bit.ly/xyz"), null);
  assertEquals(parseDomain("lnkd.in/abc"), null);
  assertEquals(parseDomain("https://ajax.com/careers"), "ajax.com");
});

Deno.test("Part5: Ajax/Pilot shortener website is dropped + missing-evidence flagged", () => {
  const ajax = normalizeApifyJobRow({ companyName: "Ajax", title: "SDR", link: "https://linkedin.com/jobs/view/ajax", companyWebsite: "https://bit.ly/ajax-co" });
  assertEquals(ajax.website, null);                       // shortener never kept as website
  assertEquals(ajax.domain, null);
  assertEquals(ajax.raw.website_shortener_dropped, true);
  assertEquals(ajax.raw.shortener_url, "https://bit.ly/ajax-co");
  assert((ajax.raw.missing_evidence as string[]).includes("verified company website"));
  // real source proof (the job posting) still survives.
  assert(ajax.sourceProof.some((p) => p.type === "job_posting"));

  const pilot = normalizeApifyJobRow({ companyName: "Pilot.com", title: "Business Developer", link: "https://linkedin.com/jobs/view/pilot", companyWebsite: "lnkd.in/pilot" });
  assertEquals(pilot.website, null);
  assertEquals(pilot.raw.website_shortener_dropped, true);
  assert((pilot.raw.missing_evidence as string[]).includes("verified company website"));
});

Deno.test("Part5: a real company website is preserved (not treated as shortener)", () => {
  const n = normalizeApifyJobRow({ companyName: "JustAI", title: "SDR", link: "https://linkedin.com/jobs/view/justai", companyWebsite: "https://justai.com" });
  assertEquals(n.website, "https://justai.com");
  assertEquals(n.domain, "justai.com");
  assertEquals(n.raw.website_shortener_dropped, false);
});

// ---------------------------------------------------------------------------
// crawlworks/linkedin-jobs-scraper posting date (`postedDate`).
//
// Field names verified official:2026-07-30 against
// apify.com/crawlworks/linkedin-jobs-scraper. The row below is the shape this
// actor actually returned in production task c30fbc6d.
// ---------------------------------------------------------------------------

// Trimmed from the real crawlworks payload for that task (SolarWinds row).
const crawlworksRow = {
  jobUrl: "https://www.linkedin.com/jobs/view/4429558301",
  jobTitle: "Director, Revenue Operations",
  companyName: "SolarWinds",
  companyUrl: "https://www.linkedin.com/company/solarwinds",
  companyWebsite: "http://www.solarwinds.com",
  companyIndustry: "Software Development",
  companyEmployeeCount: 2856,
  location: "Austin, TX, US",
  employmentType: "Full-time",
  seniorityLevel: "Director",
  postedDate: "2026-07-29",
  postedTime: "20 hours ago",
  validThrough: "2027-02-11",
};

Deno.test("crawlworks `postedDate` becomes posted_at (was dropped → missing_occurred_at)", () => {
  const n = normalizeApifyJobRow(crawlworksRow);
  assertEquals(n.postedAt, "2026-07-29");
  assertEquals(n.raw.posted_at, "2026-07-29");
  // The value must be a real instant, since jobRecordToSignalEvent gates on Date.parse.
  assert(isFinite(Date.parse(n.postedAt as string)));
});

Deno.test("`postedTime` alone never yields a posting date (localized text, unparseable)", () => {
  // apify.com serves this field localized — the published sample reads "Vor 2 Tagen".
  const n = normalizeApifyJobRow({ ...crawlworksRow, postedDate: undefined, postedTime: "Vor 2 Tagen" });
  assertEquals(n.postedAt, null);
});

Deno.test("`validThrough` alone never yields a posting date (deadline, not a posting)", () => {
  // Accepting this would fabricate freshness for a long-expired listing.
  const n = normalizeApifyJobRow({ ...crawlworksRow, postedDate: undefined, postedTime: undefined });
  assertEquals(n.postedAt, null);
});

Deno.test("explicit posting keys still outrank `postedDate`", () => {
  assertEquals(normalizeApifyJobRow({ ...crawlworksRow, postedAt: "2026-07-01" }).postedAt, "2026-07-01");
  assertEquals(normalizeApifyJobRow({ ...crawlworksRow, datePosted: "2026-07-02" }).postedAt, "2026-07-02");
});

Deno.test("a row with no date at all still normalizes to null (no fabrication)", () => {
  const n = normalizeApifyJobRow({ companyName: "Acme", title: "RevOps Lead" });
  assertEquals(n.postedAt, null);
});
