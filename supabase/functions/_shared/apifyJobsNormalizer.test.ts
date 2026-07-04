import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeApifyJobRow, parseDomain, buildSignalSummary } from "./apifyJobsNormalizer.ts";

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
