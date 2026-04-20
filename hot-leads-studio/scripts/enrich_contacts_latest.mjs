import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const INPUT_JSON = process.env.HOT_LEADS_INPUT_JSON;
const OUTPUT_JSON =
  process.env.HOT_LEADS_OUTPUT_JSON ||
  path.join(__dirname, "..", "output", "contact_enriched_leads.json");
const OUTPUT_CSV =
  process.env.HOT_LEADS_OUTPUT_CSV ||
  path.join(__dirname, "..", "output", "contact_enriched_leads.csv");
const TARGET_LABEL = process.env.HOT_LEADS_TARGET_LABEL || "Active dataset";
const TARGET_SOURCE_ID = process.env.HOT_LEADS_TARGET_SOURCE_ID || "active";

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || "";

if (!INPUT_JSON) throw new Error("Missing HOT_LEADS_INPUT_JSON");
if (!APIFY_TOKEN) throw new Error("Missing APIFY_API_TOKEN");

const PROFILE_LIMIT = 18;
const COMPANY_LIMIT = 10;
const FIRECRAWL_COMPANY_LIMIT = 6;
const FIRECRAWL_PAGE_LIMIT = 4;

const CONTACT_TITLE_FILTERS = [
  "Founder",
  "Co-Founder",
  "CEO",
  "CTO",
  "Head of Talent",
  "VP People",
  "Recruiting Lead",
  "Head of Engineering",
  "Engineering Manager",
];

const PROFILE_URL_FIELDS = [
  "preferred_contact_linkedin_url",
  "contact_linkedin_url",
  "linkedin_url",
  "commenter_profile_url",
  "decision_maker_linkedin_url",
];

const COMPANY_URL_FIELDS = [
  "company_linkedin_url",
  "company_url",
  "decision_maker_company_website",
  "preferred_contact_company_website",
  "inferred_company_site",
];

const CONTACT_PHONE_FIELDS = [
  "preferred_contact_phone",
  "decision_maker_phone",
  "founder_phone",
  "contact_phone",
  "mobileNumber",
  "phone",
];

const CONTACT_EMAIL_FIELDS = [
  "preferred_contact_email",
  "decision_maker_email",
  "founder_email",
  "contact_email",
  "email",
];

const CONTACT_LINKEDIN_FIELDS = [
  "preferred_contact_linkedin_url",
  "contact_linkedin_url",
  "decision_maker_linkedin_url",
  "linkedin_url",
];

const PREFERRED_COLUMNS = [
  "company_name",
  "role_title",
  "contact_name",
  "contact_title",
  "score",
  "tier",
  "contact_readiness",
  "preferred_contact_name",
  "preferred_contact_title",
  "preferred_contact_phone",
  "phone_verification_status",
  "preferred_contact_email",
  "preferred_contact_linkedin_url",
  "contact_strategy",
  "contact_phone_source",
  "contact_email_source",
  "company_url",
  "evidence_url",
  "signal_summary",
  "enrichment_status",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function firstNonEmpty(values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value[0];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }

  return "";
}

function compact(value, max = 220) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function canonicalUrl(url) {
  if (!url) return "";

  try {
    const parsed = new URL(String(url).trim());
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return String(url || "").trim().replace(/\/+$/, "").toLowerCase();
  }
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function pickRows(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];

  for (const key of [
    "leads",
    "rows",
    "items",
    "data",
    "linkedin_hot_leads",
    "firecrawl_hiring_leads",
  ]) {
    if (Array.isArray(raw[key])) return raw[key];
  }

  return [];
}

function stringifyCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((entry) => stringifyCell(entry)).filter(Boolean).join(" | ");
  return JSON.stringify(value);
}

function escapeCsv(value) {
  return `"${String(value ?? "").replaceAll('"', '""').replace(/\n/g, " ")}"`;
}

function buildColumns(rows) {
  const seen = new Set();
  rows.forEach((row) => Object.keys(row || {}).forEach((key) => seen.add(key)));
  const rest = [...seen].filter((key) => !PREFERRED_COLUMNS.includes(key)).sort();
  return PREFERRED_COLUMNS.filter((key) => seen.has(key)).concat(rest);
}

function asLinkedInProfileUrl(url) {
  const normalized = canonicalUrl(url);
  if (!normalized) return "";
  return /linkedin\.com\/(?:in|pub)\//.test(normalized) ? normalized : "";
}

function asLinkedInCompanyUrl(url) {
  const normalized = canonicalUrl(url);
  if (!normalized) return "";
  return normalized.includes("linkedin.com/company/") ? normalized : "";
}

function asWebUrl(url) {
  const normalized = canonicalUrl(url);
  if (!normalized) return "";
  if (!/^https?:\/\//.test(normalized)) return "";
  if (normalized.includes("linkedin.com/")) return "";
  return normalized;
}

function getProfileUrl(row) {
  return firstNonEmpty(PROFILE_URL_FIELDS.map((field) => asLinkedInProfileUrl(row?.[field])));
}

function getCompanyLinkedInUrl(row) {
  return firstNonEmpty(COMPANY_URL_FIELDS.map((field) => asLinkedInCompanyUrl(row?.[field])));
}

function getCompanySiteUrl(row) {
  return firstNonEmpty(COMPANY_URL_FIELDS.map((field) => asWebUrl(row?.[field])));
}

function getCompanyName(row) {
  return firstNonEmpty([row.company_name, row.company, row.organization, row.account_name]);
}

function getContactName(row) {
  return firstNonEmpty([row.preferred_contact_name, row.contact_name, row.commenter_name]);
}

function getRowScore(row) {
  const tierBoost = String(row?.tier || "").toLowerCase() === "hot" ? 100 : 0;
  return tierBoost + toNumber(row?.score);
}

function hasPhone(row) {
  return Boolean(firstNonEmpty(CONTACT_PHONE_FIELDS.map((field) => row?.[field])));
}

function hasEmail(row) {
  return Boolean(firstNonEmpty(CONTACT_EMAIL_FIELDS.map((field) => row?.[field])));
}

function hasLinkedIn(row) {
  return Boolean(firstNonEmpty(CONTACT_LINKEDIN_FIELDS.map((field) => row?.[field])));
}

function chooseContactEmail(emails) {
  const filtered = uniqueStrings(emails).filter(
    (email) => !/example\.com|linkedin\.com|ycombinator\.com|wix\.com|sentry\.io/i.test(email),
  );

  const preferred = filtered.find((email) =>
    /(founder|ceo|hello|team|talent|careers|jobs|contact)/i.test(email.split("@")[0] || ""),
  );

  return preferred || filtered[0] || "";
}

function titleRank(title) {
  const value = String(title || "").toLowerCase();
  if (/\bfounder\b|\bco-founder\b|\bceo\b/.test(value)) return 110;
  if (/\bcto\b|\bhead of engineering\b/.test(value)) return 104;
  if (/\bvp people\b|\bhead of talent\b/.test(value)) return 100;
  if (/\brecruiting lead\b/.test(value)) return 96;
  if (/\bengineering manager\b/.test(value)) return 92;
  if (/\bhead\b|\bdirector\b|\bvp\b/.test(value)) return 88;
  return 40;
}

function buildCompanyKey({ companyLinkedInUrl, companyName }) {
  return asLinkedInCompanyUrl(companyLinkedInUrl) || normalizeName(companyName);
}

function buildRowCompanyKey(row) {
  return buildCompanyKey({
    companyLinkedInUrl: getCompanyLinkedInUrl(row),
    companyName: getCompanyName(row),
  });
}

function enrichSummary(parts) {
  return uniqueStrings(parts.map((part) => compact(part, 160))).join(" | ");
}

async function asJson(response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`);
  }

  return text ? JSON.parse(text) : null;
}

async function fetchWithRetries(url, options = {}, attempts = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(1400 * attempt);
    }
  }

  throw lastError;
}

async function runApifyActor(actorSlug, input) {
  const base = "https://api.apify.com/v2";
  const runRes = await fetchWithRetries(
    `${base}/acts/${encodeURIComponent(actorSlug)}/runs?token=${encodeURIComponent(APIFY_TOKEN)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );

  const runJson = await asJson(runRes);
  const runId = runJson?.data?.id;
  let datasetId = runJson?.data?.defaultDatasetId;
  let status = runJson?.data?.status || "RUNNING";

  if (!runId) throw new Error(`Apify actor ${actorSlug} did not return a run id.`);

  while (status === "RUNNING" || status === "READY") {
    await sleep(2500);
    const statusRes = await fetchWithRetries(`${base}/actor-runs/${runId}?token=${encodeURIComponent(APIFY_TOKEN)}`);
    const statusJson = await asJson(statusRes);
    status = statusJson?.data?.status || status;
    datasetId = statusJson?.data?.defaultDatasetId || datasetId;

    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
      throw new Error(`Apify actor ${actorSlug} ended with status ${status}.`);
    }
  }

  if (!datasetId) return [];

  const datasetRes = await fetchWithRetries(
    `${base}/datasets/${datasetId}/items?clean=true&token=${encodeURIComponent(APIFY_TOKEN)}`,
  );

  return asJson(datasetRes);
}

async function runCompanyDiscovery(companyUrls) {
  const variants = [
    {
      companies: companyUrls,
      jobTitles: CONTACT_TITLE_FILTERS,
      profileScraperMode: "short",
      maxItems: Math.min(companyUrls.length * 5, 50),
    },
    {
      companyUrls,
      jobTitles: CONTACT_TITLE_FILTERS,
      profileScraperMode: "short",
      maxItems: Math.min(companyUrls.length * 5, 50),
    },
    {
      companies: companyUrls.map((url) => ({ url })),
      jobTitles: CONTACT_TITLE_FILTERS,
      profileScraperMode: "short",
      maxItems: Math.min(companyUrls.length * 5, 50),
    },
  ];

  let lastError = null;

  for (const input of variants) {
    try {
      const rows = await runApifyActor("harvestapi/linkedin-company-employees", input);
      if (Array.isArray(rows)) return rows;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to discover company contacts.");
}

async function runProfileEnrichment(profileUrls) {
  if (!profileUrls.length) return [];

  return runApifyActor("dev_fusion/linkedin-profile-scraper", {
    profileUrls,
    maxItems: profileUrls.length,
  });
}

async function firecrawlScrape(url) {
  if (!FIRECRAWL_API_KEY) return "";

  const response = await fetchWithRetries("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
    }),
  });

  const json = await asJson(response);
  return json?.data?.markdown || "";
}

function extractEmails(text) {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return uniqueStrings(matches.map((value) => value.toLowerCase()));
}

function extractPhones(text) {
  const lines = text.split("\n");
  const hits = [];

  const telMatches = [...text.matchAll(/tel:([+\d][\d().\-\s]{6,20})/gi)].map((match) => match[1]);
  hits.push(...telMatches);

  for (const line of lines) {
    if (!/(phone|tel|call|whatsapp|\+\d)/i.test(line)) continue;
    const candidates = line.match(/\+?\d[\d().\-\s]{8,}\d/g) || [];
    hits.push(...candidates);
  }

  return uniqueStrings(
    hits
      .map((value) => value.replace(/\s+/g, " ").trim())
      .filter((value) => {
        const digits = value.replace(/\D/g, "");
        return digits.length >= 9 && digits.length <= 15;
      }),
  );
}

function extractLinkedIns(text) {
  const matches = [...text.matchAll(/https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company)\/[^\s)]+/gi)].map(
    (match) => canonicalUrl(match[0]),
  );

  return uniqueStrings(matches);
}

function extractFounderNames(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const names = [];

  for (const line of lines) {
    if (!/founder|co-founder|ceo/i.test(line)) continue;
    const matches = line.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/g) || [];
    names.push(...matches);
  }

  return uniqueStrings(names).slice(0, 5);
}

function extractLikelyWebsiteFromYcPage(markdown) {
  const links = [...markdown.matchAll(/\((https?:\/\/[^)\s]+)\)/g)].map((match) => match[1]);
  const filtered = links.filter((url) => {
    const value = url.toLowerCase();
    return !(
      value.includes("ycombinator.com") ||
      value.includes("workatastartup.com") ||
      value.includes("bookface-images") ||
      value.includes("linkedin.com") ||
      value.includes("twitter.com") ||
      value.includes("x.com")
    );
  });

  return filtered[0] || "";
}

function safeJoin(base, fragment) {
  try {
    return new URL(fragment, base).toString();
  } catch {
    return "";
  }
}

async function discoverPublicSiteBundle(row, siteHint) {
  if (!FIRECRAWL_API_KEY) return null;

  let primaryUrl = siteHint || getCompanySiteUrl(row);
  let aggregate = "";
  const scrapedUrls = [];
  let founderNames = [];

  if (!primaryUrl && /ycombinator\.com/.test(String(row?.company_url || ""))) {
    const ycMarkdown = await firecrawlScrape(row.company_url);
    if (ycMarkdown) {
      aggregate += `\n${ycMarkdown}`;
      scrapedUrls.push(row.company_url);
      founderNames = extractFounderNames(ycMarkdown);
      primaryUrl = extractLikelyWebsiteFromYcPage(ycMarkdown);
    }
  }

  if (!primaryUrl) return null;

  const pages = uniqueStrings([
    primaryUrl,
    safeJoin(primaryUrl, "/contact"),
    safeJoin(primaryUrl, "/about"),
    safeJoin(primaryUrl, "/team"),
    safeJoin(primaryUrl, "/careers"),
  ]).slice(0, FIRECRAWL_PAGE_LIMIT);

  for (const page of pages) {
    try {
      const markdown = await firecrawlScrape(page);
      if (!markdown) continue;
      aggregate += `\n${markdown}`;
      scrapedUrls.push(page);
    } catch {}
  }

  if (!aggregate.trim()) return null;

  const founderHits = extractFounderNames(aggregate);
  return {
    siteUrl: primaryUrl,
    emails: extractEmails(aggregate),
    phones: extractPhones(aggregate),
    linkedinUrls: extractLinkedIns(aggregate),
    founderNames: uniqueStrings([...founderNames, ...founderHits]),
    scrapedUrls,
  };
}

function buildProfileMap(profileRows) {
  const profileMap = new Map();

  for (const row of profileRows || []) {
    const keys = [row?.linkedinUrl, row?.linkedinPublicUrl].map(canonicalUrl).filter(Boolean);
    for (const key of keys) {
      profileMap.set(key, row);
    }
  }

  return profileMap;
}

function employeeProfileUrl(employee) {
  return firstNonEmpty([
    asLinkedInProfileUrl(employee?.linkedinUrl),
    asLinkedInProfileUrl(employee?.linkedinPublicUrl),
    asLinkedInProfileUrl(employee?.profileUrl),
    asLinkedInProfileUrl(employee?.actor?.linkedinUrl),
  ]);
}

function employeeCompanyKey(employee) {
  return buildCompanyKey({
    companyLinkedInUrl: firstNonEmpty([
      asLinkedInCompanyUrl(employee?.companyLinkedinUrl),
      asLinkedInCompanyUrl(employee?.companyUrl),
      asLinkedInCompanyUrl(employee?.company?.linkedinUrl),
      asLinkedInCompanyUrl(employee?.currentCompany?.linkedinUrl),
    ]),
    companyName: firstNonEmpty([
      employee?.companyName,
      employee?.company,
      employee?.company?.name,
      employee?.currentCompany?.name,
    ]),
  });
}

function employeeName(employee) {
  return firstNonEmpty([
    employee?.fullName,
    [employee?.firstName, employee?.lastName].filter(Boolean).join(" "),
    employee?.name,
    employee?.actor?.name,
  ]);
}

function employeeTitle(employee) {
  return firstNonEmpty([
    employee?.headline,
    employee?.jobTitle,
    employee?.title,
    employee?.position,
    employee?.actor?.position,
  ]);
}

function chooseBestEmployee(employees) {
  return [...employees].sort((left, right) => {
    const leftScore =
      titleRank(employeeTitle(left)) +
      (employeeProfileUrl(left) ? 8 : 0) +
      (left?.email ? 3 : 0) +
      (left?.companyWebsite ? 2 : 0);
    const rightScore =
      titleRank(employeeTitle(right)) +
      (employeeProfileUrl(right) ? 8 : 0) +
      (right?.email ? 3 : 0) +
      (right?.companyWebsite ? 2 : 0);

    return rightScore - leftScore;
  })[0];
}

function baseEnrichedRow(row) {
  return {
    ...row,
    preferred_contact_name: firstNonEmpty([row.preferred_contact_name, getContactName(row)]),
    preferred_contact_title: firstNonEmpty([row.preferred_contact_title, row.contact_title]),
    preferred_contact_linkedin_url: firstNonEmpty([
      row.preferred_contact_linkedin_url,
      row.contact_linkedin_url,
      row.linkedin_url,
    ]),
    preferred_contact_phone: firstNonEmpty([row.preferred_contact_phone, row.decision_maker_phone, row.founder_phone]),
    preferred_contact_email: firstNonEmpty([row.preferred_contact_email, row.decision_maker_email, row.founder_email]),
    preferred_contact_company_website: firstNonEmpty([
      row.preferred_contact_company_website,
      row.decision_maker_company_website,
      row.inferred_company_site,
    ]),
    enrichment_status: row.enrichment_status || (hasPhone(row) || hasEmail(row) || hasLinkedIn(row) ? "existing_contact_info" : "pending"),
  };
}

function finalizeRow(row) {
  const preferredLinkedIn = firstNonEmpty(CONTACT_LINKEDIN_FIELDS.map((field) => row?.[field]));
  const preferredPhone = firstNonEmpty(CONTACT_PHONE_FIELDS.map((field) => row?.[field]));
  const preferredEmail = firstNonEmpty(CONTACT_EMAIL_FIELDS.map((field) => row?.[field]));

  const output = {
    ...row,
    preferred_contact_linkedin_url: preferredLinkedIn,
    preferred_contact_phone: preferredPhone,
    preferred_contact_email: preferredEmail,
  };

  output.has_phone = Boolean(preferredPhone);
  output.has_contact_info = Boolean(preferredPhone || preferredEmail || preferredLinkedIn);
  output.contact_readiness = output.has_phone
    ? "cold-call-ready"
    : output.has_contact_info
      ? "contact-found"
      : "no-contact";
  output.phone_verification_status =
    output.phone_verification_status ||
    (output.preferred_contact_phone
      ? output.contact_phone_source === "linkedin_profile_mobile_lookup"
        ? "actor-returned"
        : output.contact_phone_source === "public_company_site"
          ? "public-company-site"
          : "available"
      : "not_found");

  if (!output.enrichment_status || output.enrichment_status === "pending") {
    output.enrichment_status = output.has_contact_info ? "contact_found" : "not_found";
  }

  return output;
}

async function main() {
  const raw = JSON.parse(await fs.readFile(INPUT_JSON, "utf8"));
  const inputRows = pickRows(raw).map((row) => baseEnrichedRow(row || {}));
  const rankedIndices = inputRows
    .map((row, index) => ({ index, score: getRowScore(row) }))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.index);

  const rows = inputRows.map((row) => ({ ...row }));
  const profileTargets = [];
  const seenProfiles = new Set();

  for (const index of rankedIndices) {
    const profileUrl = getProfileUrl(rows[index]);
    if (!profileUrl || seenProfiles.has(profileUrl)) continue;
    seenProfiles.add(profileUrl);
    profileTargets.push({ index, profileUrl });
    if (profileTargets.length >= PROFILE_LIMIT) break;
  }

  const directProfiles = await runProfileEnrichment(profileTargets.map((target) => target.profileUrl));
  const directProfileMap = buildProfileMap(directProfiles);

  for (const target of profileTargets) {
    const profile = directProfileMap.get(target.profileUrl);
    if (!profile) continue;

    rows[target.index] = {
      ...rows[target.index],
      preferred_contact_name: firstNonEmpty([profile.fullName, rows[target.index].preferred_contact_name]),
      preferred_contact_title: firstNonEmpty([profile.headline, rows[target.index].preferred_contact_title]),
      preferred_contact_linkedin_url: firstNonEmpty([
        profile.linkedinUrl,
        profile.linkedinPublicUrl,
        rows[target.index].preferred_contact_linkedin_url,
      ]),
      preferred_contact_phone: firstNonEmpty([profile.mobileNumber, rows[target.index].preferred_contact_phone]),
      preferred_contact_email: firstNonEmpty([profile.email, rows[target.index].preferred_contact_email]),
      preferred_contact_company_website: firstNonEmpty([
        profile.companyWebsite,
        rows[target.index].preferred_contact_company_website,
      ]),
      contact_strategy: "direct_profile_enrichment",
      contact_phone_source: profile.mobileNumber
        ? "linkedin_profile_mobile_lookup"
        : rows[target.index].contact_phone_source || "",
      contact_email_source: profile.email ? "linkedin_profile_lookup" : rows[target.index].contact_email_source || "",
      enrichment_status: profile.mobileNumber || profile.email ? "profile_enriched" : "profile_no_contact",
      enrichment_summary: enrichSummary([
        rows[target.index].enrichment_summary,
        profile.mobileNumber ? "Direct profile mobile number returned by Apify." : "",
        profile.email ? "Direct profile email returned by Apify." : "",
      ]),
    };
  }

  const companyCandidates = [];
  const seenCompanies = new Set();

  for (const index of rankedIndices) {
    const row = rows[index];
    if (row.preferred_contact_phone && row.preferred_contact_linkedin_url) continue;

    const companyLinkedInUrl = getCompanyLinkedInUrl(row);
    const companyName = getCompanyName(row);
    const companyKey = buildCompanyKey({ companyLinkedInUrl, companyName });

    if (!companyLinkedInUrl || !companyKey || seenCompanies.has(companyKey)) continue;

    seenCompanies.add(companyKey);
    companyCandidates.push({ index, companyKey, companyLinkedInUrl });
    if (companyCandidates.length >= COMPANY_LIMIT) break;
  }

  const companyEmployees = companyCandidates.length
    ? await runCompanyDiscovery(companyCandidates.map((candidate) => candidate.companyLinkedInUrl))
    : [];

  const employeesByCompany = new Map();
  for (const employee of companyEmployees || []) {
    const companyKey = employeeCompanyKey(employee);
    if (!companyKey) continue;
    const bucket = employeesByCompany.get(companyKey) || [];
    bucket.push(employee);
    employeesByCompany.set(companyKey, bucket);
  }

  const selectedEmployees = [];
  const employeeTargetsByCompany = new Map();

  for (const candidate of companyCandidates) {
    const employees = employeesByCompany.get(candidate.companyKey) || [];
    if (!employees.length) continue;
    const best = chooseBestEmployee(employees);
    const profileUrl = employeeProfileUrl(best);
    if (!profileUrl) continue;

    if (!employeeTargetsByCompany.has(candidate.companyKey)) {
      employeeTargetsByCompany.set(candidate.companyKey, {
        employee: best,
        profileUrl,
      });
      selectedEmployees.push(profileUrl);
    }
  }

  const companyProfiles = await runProfileEnrichment(uniqueStrings(selectedEmployees));
  const companyProfileMap = buildProfileMap(companyProfiles);

  for (const [companyKey, target] of employeeTargetsByCompany.entries()) {
    const employee = target.employee;
    const profile = companyProfileMap.get(canonicalUrl(target.profileUrl));

    for (const index of rankedIndices) {
      if (buildRowCompanyKey(rows[index]) !== companyKey) continue;

      rows[index] = {
        ...rows[index],
        preferred_contact_name: firstNonEmpty([
          profile?.fullName,
          employeeName(employee),
          rows[index].preferred_contact_name,
        ]),
        preferred_contact_title: firstNonEmpty([
          profile?.headline,
          employeeTitle(employee),
          rows[index].preferred_contact_title,
        ]),
        preferred_contact_linkedin_url: firstNonEmpty([
          profile?.linkedinUrl,
          profile?.linkedinPublicUrl,
          target.profileUrl,
          rows[index].preferred_contact_linkedin_url,
        ]),
        preferred_contact_phone: firstNonEmpty([profile?.mobileNumber, rows[index].preferred_contact_phone]),
        preferred_contact_email: firstNonEmpty([
          profile?.email,
          employee?.email,
          rows[index].preferred_contact_email,
        ]),
        preferred_contact_company_website: firstNonEmpty([
          profile?.companyWebsite,
          employee?.companyWebsite,
          rows[index].preferred_contact_company_website,
        ]),
        contact_strategy: "company_employee_discovery",
        contact_phone_source: profile?.mobileNumber
          ? "linkedin_profile_mobile_lookup"
          : rows[index].contact_phone_source || "",
        contact_email_source:
          profile?.email || employee?.email
            ? profile?.email
              ? "linkedin_profile_lookup"
              : "company_employee_discovery"
            : rows[index].contact_email_source || "",
        enrichment_status:
          profile?.mobileNumber || profile?.email || employee?.email
            ? "company_contact_enriched"
            : rows[index].enrichment_status,
        enrichment_summary: enrichSummary([
          rows[index].enrichment_summary,
          `Picked ${employeeName(employee) || "a likely decision-maker"} from company employees.`,
          profile?.mobileNumber ? "Returned a mobile number from direct profile enrichment." : "",
        ]),
      };
    }
  }

  const firecrawlCompanyTargets = [];
  const seenFirecrawlCompanies = new Set();

  for (const index of rankedIndices) {
    const row = rows[index];
    const companyKey = buildRowCompanyKey(row);
    if (!companyKey || seenFirecrawlCompanies.has(companyKey) || row.preferred_contact_phone) continue;

    const siteHint = firstNonEmpty([
      row.preferred_contact_company_website,
      getCompanySiteUrl(row),
      /ycombinator\.com/.test(String(row.company_url || "")) ? row.company_url : "",
    ]);

    if (!siteHint) continue;
    seenFirecrawlCompanies.add(companyKey);
    firecrawlCompanyTargets.push({ index, companyKey, siteHint });
    if (firecrawlCompanyTargets.length >= FIRECRAWL_COMPANY_LIMIT) break;
  }

  for (const target of firecrawlCompanyTargets) {
    const bundle = await discoverPublicSiteBundle(rows[target.index], target.siteHint).catch(() => null);
    if (!bundle) continue;

    for (const index of rankedIndices) {
      if (buildRowCompanyKey(rows[index]) !== target.companyKey) continue;

      const chosenEmail = chooseContactEmail(bundle.emails);

      rows[index] = {
        ...rows[index],
        preferred_contact_name: firstNonEmpty([rows[index].preferred_contact_name, bundle.founderNames[0]]),
        preferred_contact_linkedin_url: firstNonEmpty([
          rows[index].preferred_contact_linkedin_url,
          bundle.linkedinUrls.find((url) => url.includes("/in/")),
          bundle.linkedinUrls[0],
        ]),
        preferred_contact_phone: firstNonEmpty([rows[index].preferred_contact_phone, bundle.phones[0]]),
        preferred_contact_email: firstNonEmpty([rows[index].preferred_contact_email, chosenEmail]),
        preferred_contact_company_website: firstNonEmpty([
          rows[index].preferred_contact_company_website,
          bundle.siteUrl,
        ]),
        contact_strategy: rows[index].contact_strategy || "company_site_public_contact",
        contact_phone_source: rows[index].preferred_contact_phone
          ? rows[index].contact_phone_source || "public_company_site"
          : bundle.phones[0]
            ? "public_company_site"
            : rows[index].contact_phone_source || "",
        contact_email_source: rows[index].preferred_contact_email
          ? rows[index].contact_email_source || "public_company_site"
          : chosenEmail
            ? "public_company_site"
            : rows[index].contact_email_source || "",
        enrichment_status:
          bundle.phones.length || bundle.emails.length || bundle.linkedinUrls.length
            ? "site_fallback_contact"
            : rows[index].enrichment_status,
        enrichment_summary: enrichSummary([
          rows[index].enrichment_summary,
          bundle.phones.length ? "Public company site exposed a callable phone number." : "",
          bundle.emails.length ? "Public company site exposed contact email(s)." : "",
          bundle.linkedinUrls.length ? "Public site linked to a LinkedIn profile or company page." : "",
        ]),
        public_contact_sources: bundle.scrapedUrls,
      };
    }
  }

  const finalizedRows = rows.map((row, index) => {
    const output = finalizeRow(row);

    if (!output.enrichment_status || output.enrichment_status === "pending") {
      output.enrichment_status =
        rankedIndices.indexOf(index) > PROFILE_LIMIT + COMPANY_LIMIT
          ? "not_attempted_budget_cap"
          : output.has_contact_info
            ? "contact_found"
            : "not_found";
    }

    return output;
  });

  const outputPayload = {
    generated_at: new Date().toISOString(),
    target_label: TARGET_LABEL,
    target_source_id: TARGET_SOURCE_ID,
    strategy: {
      apify_stack: [
        "harvestapi/linkedin-company-employees",
        "dev_fusion/linkedin-profile-scraper",
      ],
      firecrawl_fallback_enabled: Boolean(FIRECRAWL_API_KEY),
      limits: {
        profile_limit: PROFILE_LIMIT,
        company_limit: COMPANY_LIMIT,
        firecrawl_company_limit: FIRECRAWL_COMPANY_LIMIT,
      },
      notes: [
        "Phone numbers marked actor-returned came from direct LinkedIn profile enrichment.",
        "Phone numbers marked public-company-site came from public website scraping and are not independently verified.",
      ],
    },
    counts: {
      input_rows: finalizedRows.length,
      leads_with_contact_info: finalizedRows.filter((row) => row.has_contact_info).length,
      leads_with_phone: finalizedRows.filter((row) => row.has_phone).length,
      direct_profile_targets: profileTargets.length,
      company_discovery_targets: companyCandidates.length,
      firecrawl_targets: firecrawlCompanyTargets.length,
    },
    leads: finalizedRows,
  };

  const columns = buildColumns(finalizedRows);
  const csvLines = [columns.map((column) => escapeCsv(column)).join(",")];

  for (const row of finalizedRows) {
    csvLines.push(columns.map((column) => escapeCsv(stringifyCell(row[column]))).join(","));
  }

  await fs.mkdir(path.dirname(OUTPUT_JSON), { recursive: true });
  await fs.writeFile(OUTPUT_JSON, JSON.stringify(outputPayload, null, 2));
  await fs.writeFile(OUTPUT_CSV, csvLines.join("\n"));

  console.log(`Enriched contacts for: ${TARGET_LABEL}`);
  console.log(`Rows with contact info: ${outputPayload.counts.leads_with_contact_info}`);
  console.log(`Rows with phone numbers: ${outputPayload.counts.leads_with_phone}`);
  console.log(`JSON: ${OUTPUT_JSON}`);
  console.log(`CSV: ${OUTPUT_CSV}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
