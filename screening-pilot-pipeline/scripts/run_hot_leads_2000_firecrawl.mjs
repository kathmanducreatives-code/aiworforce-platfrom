import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
if (!FIRECRAWL_API_KEY) throw new Error('Missing FIRECRAWL_API_KEY');

const CONFIG = {
  finalTarget: Number(process.env.HOT_LEADS_FINAL_TARGET || 2000),
  maxAgeDays: Number(process.env.HOT_LEADS_MAX_AGE_DAYS || 45),
  wellfoundMaxPages: Number(process.env.HOT_LEADS_WELLFOUND_MAX_PAGES || 95),
  fetchConcurrency: Number(process.env.HOT_LEADS_FETCH_CONCURRENCY || 4),
  searchConcurrency: Number(process.env.HOT_LEADS_SEARCH_CONCURRENCY || 1),
  searchThrottleMs: Number(process.env.HOT_LEADS_SEARCH_THROTTLE_MS || 700),
  enrichmentConcurrency: Number(process.env.HOT_LEADS_ENRICHMENT_CONCURRENCY || 2),
  companyEnrichmentLimit: Number(process.env.HOT_LEADS_COMPANY_ENRICHMENT_LIMIT || 40),
  publicSitePageLimit: Number(process.env.HOT_LEADS_COMPANY_PAGE_LIMIT || 4),
  outputJson: path.join(OUTPUT_DIR, 'hot_leads_2000_apify.json'),
  outputCsv: path.join(OUTPUT_DIR, 'hot_leads_2000_apify.csv')
};

const WELLFOUND_BASE_URL = 'https://wellfound.com/role/software-engineer';
const YC_JOBS_URL = 'https://www.ycombinator.com/jobs';
const WAAS_JOBS_URL = 'https://www.workatastartup.com/jobs';
const ATS_SEARCH_LIMIT = Number(process.env.HOT_LEADS_ATS_SEARCH_LIMIT || 10);

const ATS_SEARCH_SOURCES = [
  { domain: 'jobs.ashbyhq.com', label: 'ashby_search' },
  { domain: 'boards.greenhouse.io', label: 'greenhouse_search' },
  { domain: 'job-boards.greenhouse.io', label: 'greenhouse_search' },
  { domain: 'jobs.lever.co', label: 'lever_search' },
  { domain: 'jobs.workable.com', label: 'workable_search' }
];

const ATS_SEARCH_ROLES = [
  'Founding Engineer',
  'Software Engineer',
  'Backend Engineer',
  'Frontend Engineer',
  'Full Stack Engineer',
  'AI Engineer',
  'ML Engineer',
  'Data Engineer',
  'Platform Engineer',
  'Product Engineer',
  'Product Designer',
  'Engineering Manager'
];

const ATS_SEARCH_SIGNAL_GROUPS = [
  'startup',
  '"seed" OR "series a" OR "series b"',
  '"venture-backed" OR "yc" OR "founding team"'
];

const TECH_ROLE_RE =
  /\b(founding|software|backend|frontend|full[ -]?stack|platform|product engineer|ai|ml|machine learning|applied scientist|data|devops|sre|security|mobile|ios|android|infrastructure|product designer|designer|engineering manager)\b/i;
const STRONG_TECH_ROLE_RE =
  /\b(founding|software|backend|frontend|full[ -]?stack|platform|product engineer|ai|ml|machine learning|applied scientist|data|devops|sre|security|infrastructure)\b/i;
const RECRUITER_RE =
  /\b(recruiter|staffing|agency|headhunter|career coach|talent acquisition|outsourcing|search firm)\b/i;
const CONSULTING_RE =
  /\b(consulting|consultancy|managed services|it services|professional services|systems integrator)\b/i;
const BIG_COMPANY_RE =
  /\b(amazon|microsoft|google|meta|oracle|salesforce|ibm|accenture|infosys|cognizant|tcs|deloitte|capgemini|randstad|robert half|teksystems|walmart|nextdoor|astranis)\b/i;
const STARTUP_SUMMARY_RE =
  /\b(startup|seed|series a|series b|venture|saas|developer|ai|infra|security|automation|data|fintech|healthtech|api|platform|b2b|agentic)\b/i;
const NON_TARGET_ROLE_RE = /\b(consultant|contractor|intern|chief of staff|founder'?s office)\b/i;
const NOISY_COMPANY_RE =
  /(^jobs?$|^seed$|^career$|^usa$|jobs by|applyto|@|remote|head of engineering|senior\/staff|risk analyst|global finance teams|estonia|pear vc)/i;
const PHONE_HINT_RE = /(phone|tel|call|whatsapp|\+\d)/i;
const AGE_RE = /\b(?:about\s+)?\d+\s+(?:minute|hour|day|week|month)s?\s+ago\b|\btoday\b|\bjust now\b/i;
const WELLFOUND_COMPANY_LINE_RE = /^\[\*\*(.+?)\*\*\]\((https:\/\/wellfound\.com\/company\/[^)]+)\)$/i;
const WELLFOUND_JOB_LINE_RE = /^\[(.+?)\]\((https:\/\/wellfound\.com\/jobs\/[^)]+)\)\s+(.+)$/i;
const YC_JOB_LINE_RE = /^\[(.+?)\s*\(([A-Z]\d{2})\)•(.+?)\(([^)]+ago)\)\]\((https:\/\/www\.ycombinator\.com\/companies\/[^)]+)\)\s+\[(.+?)\]\((https:\/\/www\.ycombinator\.com\/companies\/[^)]+\/jobs\/[^)]+)\)$/i;
const WAAS_COMPANY_LINE_RE =
  /^\[(.+?)\s*\(([A-Z]\d{2})\)•(.+?)\]\((https:\/\/www\.workatastartup\.com\/companies\/[^)]+)\)(?:\(([^)]+ago)\))?$/i;
const WAAS_JOB_LINE_RE = /^\[(.+?)\]\((https:\/\/www\.workatastartup\.com\/jobs\/[^)]+)\)$/i;
const BLOCKED_SITE_RE =
  /wellfound\.com|ycombinator\.com|workatastartup\.com|linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|youtube\.com|crunchbase\.com|pitchbook\.com|glassdoor\.com|indeed\.com|ashbyhq\.com|greenhouse\.io|lever\.co|job-boards?|bookface-images|photos\.wellfound|cloudfront\.net|wikipedia\.org/i;
const US_STATE_RE =
  /\b(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV)\b/;
const US_CITY_RE =
  /\b(austin|atlanta|boston|brooklyn|chicago|columbus|denver|dallas|houston|los angeles|miami|mountain view|nashville|new york|palo alto|philadelphia|phoenix|portland|redwood city|san francisco|san jose|santa clara|santa monica|seattle|stamford|washington)\b/i;

const scrapeCache = new Map();
const searchCache = new Map();

const compact = (value, max = 220) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
};

const normalizeWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const canonicalUrl = (url) => {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '').toLowerCase();
  } catch {
    return String(url || '').trim().replace(/\/+$/, '').toLowerCase();
  }
};

const uniqueStrings = (values) => [...new Set(values.map((value) => normalizeWhitespace(value)).filter(Boolean))];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeName = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const escapeCsv = (value) => `"${String(value ?? '').replaceAll('"', '""').replace(/\n/g, ' ')}"`;

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const firstNonEmpty = (values) => {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return firstNonEmpty(value);
    const text = normalizeWhitespace(value);
    if (text) return text;
  }
  return '';
};

const parseDaysAgo = (raw) => {
  const text = String(raw || '').toLowerCase();
  if (!text) return 999;
  if (/minute|hour|today|just now/.test(text)) return 0;
  const day = text.match(/(\d+)\s*day/);
  if (day) return Number(day[1]);
  const week = text.match(/(\d+)\s*week/);
  if (week) return Number(week[1]) * 7;
  const month = text.match(/(\d+)\s*month/);
  if (month) return Number(month[1]) * 30;
  return 999;
};

const parseCompanySizeUpperBound = (label) => {
  const match = String(label || '').match(/(\d[\d,]*)\s*-\s*(\d[\d,]*)/);
  if (match) return Number(match[2].replaceAll(',', ''));
  const plusMatch = String(label || '').match(/(\d[\d,]*)\+/);
  if (plusMatch) return Number(plusMatch[1].replaceAll(',', ''));
  return 0;
};

const tierFromScore = (score) => {
  if (score >= 8) return 'hot';
  if (score >= 5) return 'warm';
  return 'skip';
};

const isUsLocation = (location) => {
  const value = String(location || '').trim();
  if (!value) return true;
  if (/remote only\s*•\s*everywhere/i.test(value)) return true;
  if (/remote/i.test(value) && !/\b(europe|singapore|india|uk|london|berlin|amsterdam|paris|tokyo|sydney)\b/i.test(value)) {
    return true;
  }
  if (/\b(united states|usa|us)\b/i.test(value)) return true;
  if (US_CITY_RE.test(value)) return true;
  return /,\s*[A-Z]{2}\b/.test(value) || US_STATE_RE.test(value);
};

const looksLikeStartup = ({
  companyName,
  company_name,
  summary,
  company_summary,
  sizeLabel,
  company_size_label,
  tags = [],
  company_tags = [],
  sourceSubtype,
  source_subtype
}) => {
  const resolvedTags = tags.length ? tags : company_tags;
  const resolvedSourceSubtype = sourceSubtype || source_subtype || '';
  const resolvedSummary = summary || company_summary || '';
  const resolvedSizeLabel = sizeLabel || company_size_label || '';
  const resolvedCompanyName = companyName || company_name || '';
  const combined = `${resolvedCompanyName} ${resolvedSummary} ${resolvedTags.join(' ')}`.toLowerCase();
  if (!combined.trim()) return false;
  if (RECRUITER_RE.test(combined)) return false;
  if (CONSULTING_RE.test(combined)) return false;
  if (BIG_COMPANY_RE.test(combined)) return false;
  if (resolvedTags.some((tag) => /public stage/i.test(tag))) return false;

  const sizeUpperBound = parseCompanySizeUpperBound(resolvedSizeLabel);
  if (sizeUpperBound > 200 && resolvedSourceSubtype === 'wellfound_role_page') return false;

  if (resolvedSourceSubtype === 'yc_jobs' || resolvedSourceSubtype === 'workatastartup_jobs') return true;

  const hasStrongStartupTag = resolvedTags.some((tag) =>
    /\b(early stage|growth stage|growing fast|top investors|startup_query_match|seed|series a|series b|yc|venture-backed)\b/i.test(tag)
  );

  if (!sizeUpperBound) {
    return STARTUP_SUMMARY_RE.test(combined) || hasStrongStartupTag;
  }

  return (
    sizeUpperBound > 0 &&
    sizeUpperBound <= 200 &&
    (STARTUP_SUMMARY_RE.test(combined) || hasStrongStartupTag)
  );
};

const makeCompanyKey = (lead) => {
  const site = canonicalUrl(lead.preferred_contact_company_website || lead.company_website || '');
  const companyPage = canonicalUrl(lead.company_url || '');
  return site || companyPage || normalizeName(lead.company_name);
};

const extractEmails = (text) => {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return uniqueStrings(
    matches
      .map((value) => value.toLowerCase())
      .filter((value) => !/example\.com|ycombinator\.com|wellfound\.com|linkedin\.com|wix\.com|sentry\.io/i.test(value))
  );
};

const extractPhones = (text) => {
  const lines = text.split('\n');
  const hits = [];

  const telMatches = [...text.matchAll(/tel:([+\d][\d().\-\s]{6,20})/gi)].map((match) => match[1]);
  hits.push(...telMatches);

  for (const line of lines) {
    if (!PHONE_HINT_RE.test(line)) continue;
    const candidates = line.match(/\+?\d[\d().\-\s]{8,}\d/g) || [];
    hits.push(...candidates);
  }

  return uniqueStrings(
    hits
      .map((value) => value.replace(/\s+/g, ' ').trim())
      .filter((value) => {
        const digits = value.replace(/\D/g, '');
        return digits.length >= 9 && digits.length <= 15;
      })
      .filter((value) => !/https?:\/\//i.test(value))
  );
};

const extractLinkedIns = (text) => {
  const matches = [...text.matchAll(/https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company)\/[^\s)]+/gi)].map((match) =>
    canonicalUrl(match[0])
  );
  return uniqueStrings(matches);
};

const extractFounderNames = (text) => {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const names = [];
  for (const line of lines) {
    if (!/founder|co-founder|ceo|cto/i.test(line)) continue;
    const matches = line.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/g) || [];
    names.push(...matches);
  }
  return uniqueStrings(names).slice(0, 5);
};

const extractMarkdownLinks = (text) =>
  uniqueStrings([...text.matchAll(/\((https?:\/\/[^)\s]+)\)/g)].map((match) => match[1]));

const isLikelyOfficialSite = (url) => /^https?:\/\//.test(url) && !BLOCKED_SITE_RE.test(url);

const chooseContactEmail = (emails) => {
  const filtered = uniqueStrings(emails);
  const preferred = filtered.find((email) =>
    /(founder|ceo|hello|team|contact|info|jobs|careers)/i.test(email.split('@')[0] || '')
  );
  return preferred || filtered[0] || '';
};

const asJson = async (res) => {
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
};

const fetchWithRetries = async (url, options = {}, attempts = 3) => {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(1200 * attempt);
    }
  }
  throw lastError;
};

async function firecrawlScrape(url) {
  const key = canonicalUrl(url);
  if (scrapeCache.has(key)) return scrapeCache.get(key);

  const promise = (async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const res = await fetchWithRetries('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${FIRECRAWL_API_KEY}`
        },
        body: JSON.stringify({
          url,
          formats: ['markdown'],
          onlyMainContent: true,
          blockAds: true,
          proxy: 'basic'
        })
      });

      const text = await res.text();
      if (res.ok) {
        const json = text ? JSON.parse(text) : null;
        if (!json?.success || !json?.data?.markdown) {
          throw new Error(`Firecrawl scrape failed for ${url}`);
        }
        return json.data.markdown;
      }

      if (res.status === 429 && attempt < 3) {
        const waitSeconds = Number((text.match(/retry after (\d+)s/i) || [])[1] || 30);
        await sleep((waitSeconds + 1) * 1000);
        continue;
      }

      throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    throw new Error(`Firecrawl scrape failed for ${url}`);
  })();

  scrapeCache.set(key, promise);
  return promise;
}

async function firecrawlSearch(query, limit = 5) {
  const key = `${query}::${limit}`;
  if (searchCache.has(key)) return searchCache.get(key);

  const promise = (async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const res = await fetchWithRetries('https://api.firecrawl.dev/v1/search', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${FIRECRAWL_API_KEY}`
        },
        body: JSON.stringify({
          query,
          limit,
          country: 'us',
          lang: 'en'
        })
      });

      const text = await res.text();
      if (res.ok) {
        const json = text ? JSON.parse(text) : null;
        if (!json?.success) return [];
        const rows = json.data || json.results || [];
        return Array.isArray(rows) ? rows : [];
      }

      if (res.status === 429 && attempt < 3) {
        const waitSeconds = Number((text.match(/retry after (\d+)s/i) || [])[1] || 30);
        await sleep((waitSeconds + 1) * 1000);
        continue;
      }

      throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    return [];
  })();

  searchCache.set(key, promise);
  return promise;
}

async function runWithConcurrency(items, limit, worker) {
  const output = [];
  let index = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      output[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
  return output;
}

function parseWellfoundRolePage(markdown, sourceUrl) {
  const lines = markdown.split('\n');
  const leads = [];
  const totalPagesMatch = markdown.match(/####\s+Page\s+\d+\s+of\s+(\d+)/i);
  const totalResultsMatch = markdown.match(/####\s+([\d,]+)\s+results total/i);
  const totalPages = totalPagesMatch ? Number(totalPagesMatch[1]) : 1;
  const totalResults = totalResultsMatch ? Number(totalResultsMatch[1].replaceAll(',', '')) : 0;

  const isCompanyLine = (line) => WELLFOUND_COMPANY_LINE_RE.test(line);
  const isJobLine = (line) => WELLFOUND_JOB_LINE_RE.test(line);

  for (let i = 0; i < lines.length; i += 1) {
    const companyLine = lines[i].trim();
    const companyMatch = companyLine.match(WELLFOUND_COMPANY_LINE_RE);
    if (!companyMatch) continue;

    const companyName = normalizeWhitespace(companyMatch[1]);
    const companyUrl = companyMatch[2].trim();
    const company = {
      company_name: companyName,
      company_url: companyUrl,
      company_summary: '',
      company_size_label: '',
      company_stage: '',
      company_tags: [],
      actively_hiring: false
    };

    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j].trim();
      if (!line) {
        j += 1;
        continue;
      }
      if (isCompanyLine(line)) break;

      const summaryMatch = line.match(/^(.*?)(1-10|11-50|51-200|201-500|501-1000|1001-5000)\s*Employees$/i);
      if (line === 'Actively Hiring') {
        company.actively_hiring = true;
        j += 1;
        continue;
      }
      if (summaryMatch && !company.company_size_label) {
        company.company_summary = normalizeWhitespace(summaryMatch[1]);
        company.company_size_label = summaryMatch[2];
        j += 1;
        continue;
      }
      if (line.startsWith('- ')) {
        company.company_tags.push(line.slice(2).trim());
        if (!company.company_stage && /\b(Early Stage|Growth Stage|Scale Stage|Public Stage)\b/i.test(line)) {
          company.company_stage = line.slice(2).trim();
        }
        j += 1;
        continue;
      }

      const jobMatch = line.match(WELLFOUND_JOB_LINE_RE);
      if (jobMatch) {
        const roleTitle = normalizeWhitespace(jobMatch[1]);
        const jobUrl = jobMatch[2].trim();
        const employmentType = normalizeWhitespace(jobMatch[3]).split(/\s+/)[0];
        const infoLines = [];
        let k = j + 1;

        while (k < lines.length) {
          const infoLine = lines[k].trim();
          if (!infoLine) {
            k += 1;
            continue;
          }
          if (isCompanyLine(infoLine) || isJobLine(infoLine)) break;
          infoLines.push(infoLine.replace(/Save$/i, '').trim());
          if (infoLine === 'Apply') {
            k += 1;
            break;
          }
          k += 1;
        }

        const compensation = firstNonEmpty(infoLines.filter((item) => /[$£€]|equity/i.test(item)));
        const experience = firstNonEmpty(infoLines.filter((item) => /years?\s+of\s+exp/i.test(item)));
        const ageRaw = firstNonEmpty(infoLines.filter((item) => AGE_RE.test(item)));
        const location = firstNonEmpty(
          infoLines.filter(
            (item) =>
              item !== compensation &&
              item !== experience &&
              item !== ageRaw &&
              !/^apply$/i.test(item) &&
              !/save$/i.test(item)
          )
        );

        leads.push({
          source_channel: 'job_board',
          source_subtype: 'wellfound_role_page',
          company_name: company.company_name,
          company_url: company.company_url,
          company_summary: company.company_summary,
          company_size_label: company.company_size_label,
          company_stage: company.company_stage,
          company_tags: uniqueStrings(company.company_tags),
          actively_hiring: company.actively_hiring,
          role_title: roleTitle,
          employment_type: employmentType,
          evidence_url: jobUrl,
          evidence_excerpt: compact(`${company.company_summary} ${location}`),
          location,
          compensation,
          experience,
          age_raw: ageRaw,
          recency_days: parseDaysAgo(ageRaw),
          source_page_url: sourceUrl
        });

        j = k;
        continue;
      }

      j += 1;
    }

    i = j - 1;
  }

  return { totalPages, totalResults, leads };
}

function parseYcJobs(markdown) {
  const leads = [];
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim();
    const match = line.match(YC_JOB_LINE_RE);
    if (!match) continue;

    const [, companyName, batch, summary, ageRaw, companyUrl, roleTitle, jobUrl] = match;
    leads.push({
      source_channel: 'job_board',
      source_subtype: 'yc_jobs',
      company_name: normalizeWhitespace(companyName),
      company_url: companyUrl.trim(),
      company_summary: normalizeWhitespace(summary),
      company_size_label: '',
      company_stage: batch,
      company_tags: [batch, 'yc'],
      actively_hiring: true,
      role_title: normalizeWhitespace(roleTitle),
      employment_type: 'Full-time',
      evidence_url: jobUrl.trim(),
      evidence_excerpt: compact(summary),
      location: '',
      compensation: '',
      experience: '',
      age_raw: ageRaw.trim(),
      recency_days: parseDaysAgo(ageRaw),
      source_page_url: YC_JOBS_URL
    });
  }
  return leads;
}

function parseWorkAtStartup(markdown) {
  const lines = markdown.split('\n');
  const leads = [];

  for (let i = 0; i < lines.length; i += 1) {
    const companyLine = lines[i].trim();
    const companyMatch = companyLine.match(WAAS_COMPANY_LINE_RE);
    if (!companyMatch) continue;

    const [, companyName, batch, summary, companyUrl, ageRaw = 'recently'] = companyMatch;
    let roleTitle = '';
    let jobUrl = '';
    let roleMeta = '';

    for (let j = i + 1; j <= Math.min(i + 6, lines.length - 1); j += 1) {
      const line = lines[j].trim();
      const jobMatch = line.match(WAAS_JOB_LINE_RE);
      if (jobMatch) {
        roleTitle = normalizeWhitespace(jobMatch[1]);
        jobUrl = jobMatch[2].trim();
        roleMeta = normalizeWhitespace(lines[j + 2] || '');
        i = j + 2;
        break;
      }
    }

    if (!roleTitle || !jobUrl) continue;

    leads.push({
      source_channel: 'job_board',
      source_subtype: 'workatastartup_jobs',
      company_name: normalizeWhitespace(companyName),
      company_url: companyUrl.trim(),
      company_summary: normalizeWhitespace(summary),
      company_size_label: '',
      company_stage: batch,
      company_tags: [batch, 'yc'],
      actively_hiring: true,
      role_title: roleTitle,
      employment_type: 'Full-time',
      evidence_url: jobUrl,
      evidence_excerpt: compact(summary),
      location: roleMeta,
      compensation: '',
      experience: '',
      age_raw: normalizeWhitespace(ageRaw) || 'recently',
      recency_days: parseDaysAgo(ageRaw),
      source_page_url: WAAS_JOBS_URL
    });
  }

  return leads;
}

const humanizeSlug = (value) =>
  String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();

function cleanSearchTitlePart(value) {
  return normalizeWhitespace(
    String(value || '')
      .replace(/\s+[-|–]\s+(Ashby|Greenhouse|Lever|Wellfound|Workable).*$/i, '')
      .replace(/\s+\|\s+(Ashby|Greenhouse|Lever|Wellfound|Workable).*$/i, '')
  );
}

function extractCompanySlugFromUrl(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (/ashbyhq\.com|lever\.co|workable\.com/i.test(parsed.hostname)) {
      return segments[0] || '';
    }
    if (/greenhouse\.io/i.test(parsed.hostname)) {
      return segments[0] || '';
    }
  } catch {
    return '';
  }
  return '';
}

function extractRoleFromSearchTitle(title, fallbackRole) {
  const cleaned = cleanSearchTitlePart(title);
  const atMatch = cleaned.match(/^(.+?)\s+at\s+.+$/i);
  if (atMatch && TECH_ROLE_RE.test(atMatch[1])) return normalizeWhitespace(atMatch[1]);

  const parts = cleaned.split(/\s+[|–-]\s+/).map((part) => normalizeWhitespace(part)).filter(Boolean);
  const matched = parts.find((part) => TECH_ROLE_RE.test(part));
  return matched || fallbackRole;
}

function extractCompanyFromSearchTitle(title, url, roleTitle) {
  const cleaned = cleanSearchTitlePart(title);
  const atMatch = cleaned.match(/^.+?\s+at\s+(.+)$/i);
  if (atMatch) return normalizeWhitespace(atMatch[1]);

  const parts = cleaned.split(/\s+[|–-]\s+/).map((part) => normalizeWhitespace(part)).filter(Boolean);
  const companyPart = parts.find((part) => part && part !== roleTitle && !TECH_ROLE_RE.test(part));
  if (companyPart) return companyPart;

  return humanizeSlug(extractCompanySlugFromUrl(url));
}

function extractLocationFromText(text) {
  const lines = String(text || '')
    .split(/[\n•|]/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  return firstNonEmpty(lines.filter((line) => isUsLocation(line)));
}

function extractStageTagsFromText(text) {
  const tags = [];
  if (/\bseed\b/i.test(text)) tags.push('seed');
  if (/\bseries a\b/i.test(text)) tags.push('series a');
  if (/\bseries b\b/i.test(text)) tags.push('series b');
  if (/\byc\b|y combinator/i.test(text)) tags.push('yc');
  if (/\bventure-backed\b/i.test(text)) tags.push('venture-backed');
  if (/\bremote\b/i.test(text)) tags.push('remote');
  tags.push('startup_query_match');
  return uniqueStrings(tags);
}

function parseAtsSearchLead(result, sourceLabel, roleTerm) {
  const url = canonicalUrl(result?.url || result?.link || '');
  const title = cleanSearchTitlePart(result?.title || '');
  const description = normalizeWhitespace(result?.description || result?.snippet || '');
  const combined = `${title} ${description}`;
  if (!url || !TECH_ROLE_RE.test(combined)) return null;

  const roleTitle = extractRoleFromSearchTitle(title, roleTerm);
  const companyName = extractCompanyFromSearchTitle(title, url, roleTitle);
  if (!companyName) return null;
  if (NOISY_COMPANY_RE.test(companyName)) return null;
  if (companyName.split(/\s+/).length > 4) return null;

  const ageRaw = firstNonEmpty((combined.match(new RegExp(AGE_RE, 'i')) || []).map((value) => value)) || '';
  const employmentType = /contract/i.test(combined) ? 'Contract' : /intern/i.test(combined) ? 'Internship' : 'Full-time';

  return {
    source_channel: 'job_board',
    source_subtype: sourceLabel,
    company_name: companyName,
    company_url: '',
    company_summary: description,
    company_size_label: '',
    company_stage: '',
    company_tags: extractStageTagsFromText(combined),
    actively_hiring: true,
    role_title: roleTitle,
    employment_type: employmentType,
    evidence_url: url,
    evidence_excerpt: compact(description || title),
    location: extractLocationFromText(description),
    compensation: '',
    experience: '',
    age_raw: ageRaw,
    recency_days: ageRaw ? parseDaysAgo(ageRaw) : 7,
    source_page_url: url
  };
}

async function buildAtsSearchLeads() {
  const queries = [];

  for (const source of ATS_SEARCH_SOURCES) {
    for (const role of ATS_SEARCH_ROLES) {
      for (const signalGroup of ATS_SEARCH_SIGNAL_GROUPS) {
        queries.push({
          label: source.label,
          role,
          query: `site:${source.domain} "${role}" (${signalGroup}) ("United States" OR remote) -recruiter -staffing -agency`
        });
      }
    }
  }

  console.log(`[ATS Search] Running ${queries.length} Firecrawl search queries for startup ATS backfill`);

  const payloads = await runWithConcurrency(queries, CONFIG.searchConcurrency, async ({ label, role, query }, index) => {
    try {
      if (index > 0 && CONFIG.searchThrottleMs > 0) {
        await sleep(CONFIG.searchThrottleMs);
      }
      const results = await firecrawlSearch(query, ATS_SEARCH_LIMIT);
      const rows = results.map((result) => parseAtsSearchLead(result, label, role)).filter(Boolean);
      if ((index + 1) % 20 === 0 || index === queries.length - 1) {
        console.log(`[ATS Search] ${index + 1}/${queries.length} queries complete; latest yielded ${rows.length} rows`);
      }
      return rows;
    } catch (error) {
      console.warn(`[ATS Search] Query failed for ${label}/${role}: ${error.message}`);
      return [];
    }
  });

  return payloads.flat();
}

function scoreLead(lead) {
  const conditions = [];
  let score = 0;

  if (lead.source_subtype === 'yc_jobs') {
    score += 5;
    conditions.push('yc_curated_company');
  } else if (lead.source_subtype === 'workatastartup_jobs') {
    score += 4;
    conditions.push('yc_founder_hiring_marketplace');
  } else if (lead.source_subtype === 'wellfound_role_page') {
    score += 2;
    conditions.push('wellfound_startup_hiring_page');
  }

  const sizeUpperBound = parseCompanySizeUpperBound(lead.company_size_label);
  if (sizeUpperBound > 0 && sizeUpperBound <= 10) {
    score += 4;
    conditions.push('team_size_1_10');
  } else if (sizeUpperBound > 0 && sizeUpperBound <= 50) {
    score += 3;
    conditions.push('team_size_11_50');
  } else if (sizeUpperBound > 0 && sizeUpperBound <= 200) {
    score += 2;
    conditions.push('team_size_51_200');
  } else if (sizeUpperBound > 200) {
    score -= 3;
    conditions.push('team_size_over_200');
  }

  const tags = lead.company_tags || [];
  if (tags.some((tag) => /\b(early stage|seed|s\d{2}|w\d{2}|f\d{2}|p\d{2})\b/i.test(tag))) {
    score += 3;
    conditions.push('seed_or_early_stage_signal');
  } else if (tags.some((tag) => /\bgrowth stage\b/i.test(tag))) {
    score += 1;
    conditions.push('growth_stage_signal');
  }
  if (tags.some((tag) => /\btop investors\b/i.test(tag))) {
    score += 1;
    conditions.push('top_investor_signal');
  }
  if (tags.some((tag) => /\bgrowing fast\b/i.test(tag))) {
    score += 2;
    conditions.push('hiring_growth_signal');
  }

  if (lead.actively_hiring) {
    score += 1;
    conditions.push('actively_hiring');
  }

  if (lead.recency_days <= 3) {
    score += 4;
    conditions.push('role_posted_within_3_days');
  } else if (lead.recency_days <= 7) {
    score += 3;
    conditions.push('role_posted_within_7_days');
  } else if (lead.recency_days <= 14) {
    score += 2;
    conditions.push('role_posted_within_14_days');
  } else if (lead.recency_days <= CONFIG.maxAgeDays) {
    score += 1;
    conditions.push('role_posted_within_target_window');
  }

  if (/\bfounding\b/i.test(lead.role_title)) {
    score += 3;
    conditions.push('founding_role');
  } else if (/\b(staff|principal|lead|senior)\b/i.test(lead.role_title)) {
    score += 2;
    conditions.push('senior_technical_role');
  } else if (STRONG_TECH_ROLE_RE.test(lead.role_title)) {
    score += 2;
    conditions.push('core_technical_role');
  } else if (TECH_ROLE_RE.test(lead.role_title)) {
    score += 1;
    conditions.push('technical_role');
  }

  if (/(ai|agentic|automation|data|developer|platform|api|security|infra|fintech|healthtech)/i.test(lead.company_summary)) {
    score += 1;
    conditions.push('target_software_category');
  }

  if (/equity/i.test(lead.compensation)) {
    score += 1;
    conditions.push('equity_listed');
  }

  if (isUsLocation(lead.location)) {
    score += 1;
    conditions.push('us_or_remote_friendly_location');
  }

  return {
    score,
    tier: tierFromScore(score),
    conditions_matched: conditions
  };
}

async function buildWellfoundLeads() {
  console.log(`[Wellfound] Scraping up to ${CONFIG.wellfoundMaxPages} pages from ${WELLFOUND_BASE_URL}`);
  const pageNumbers = Array.from({ length: CONFIG.wellfoundMaxPages }, (_, index) => index + 1);
  const pageUrls = pageNumbers.map((pageNumber) =>
    pageNumber === 1 ? WELLFOUND_BASE_URL : `${WELLFOUND_BASE_URL}?page=${pageNumber}`
  );

  let observedTotalPages = CONFIG.wellfoundMaxPages;
  let observedTotalResults = 0;

  const pagePayloads = await runWithConcurrency(pageUrls, CONFIG.fetchConcurrency, async (pageUrl, index) => {
    try {
      const markdown = await firecrawlScrape(pageUrl);
      const parsed = parseWellfoundRolePage(markdown, pageUrl);
      observedTotalPages = Math.max(observedTotalPages, parsed.totalPages || 0);
      observedTotalResults = Math.max(observedTotalResults, parsed.totalResults || 0);
      console.log(`[Wellfound] Page ${index + 1}: parsed ${parsed.leads.length} rows`);
      return parsed.leads;
    } catch (error) {
      console.warn(`[Wellfound] Failed ${pageUrl}: ${error.message}`);
      return [];
    }
  });

  const raw = pagePayloads.flat();
  console.log(`[Wellfound] Raw rows: ${raw.length} across ${Math.min(pageUrls.length, observedTotalPages)} pages`);

  return {
    totalPages: observedTotalPages,
    totalResults: observedTotalResults,
    leads: raw
  };
}

async function buildStartupBoardLeads() {
  const output = {
    yc: [],
    waas: []
  };

  try {
    const markdown = await firecrawlScrape(YC_JOBS_URL);
    output.yc = parseYcJobs(markdown);
    console.log(`[YC Jobs] Parsed ${output.yc.length} rows`);
  } catch (error) {
    console.warn(`[YC Jobs] Failed: ${error.message}`);
  }

  try {
    const markdown = await firecrawlScrape(WAAS_JOBS_URL);
    output.waas = parseWorkAtStartup(markdown);
    console.log(`[WorkAtAStartup] Parsed ${output.waas.length} rows`);
  } catch (error) {
    console.warn(`[WorkAtAStartup] Failed: ${error.message}`);
  }

  return output;
}

function normalizeLead(lead) {
  const scored = scoreLead(lead);
  return {
    ...lead,
    source_channel: lead.source_channel || 'job_board',
    source_subtype: lead.source_subtype || 'unknown',
    job_role_title: lead.role_title,
    recency_days: lead.recency_days,
    score: scored.score,
    tier: scored.tier,
    conditions_matched: scored.conditions_matched,
    signal_summary:
      lead.source_subtype === 'wellfound_role_page'
        ? `${lead.role_title} at ${lead.company_name}${lead.company_size_label ? ` (${lead.company_size_label} employees)` : ''} posted ${lead.age_raw || 'recently'}`
        : `${lead.role_title} posted ${lead.age_raw || 'recently'}${lead.company_stage ? ` (${lead.company_stage})` : ''}`,
    funding_signal: lead.company_stage || '',
    enrichment_summary: '',
    preferred_contact_name: '',
    preferred_contact_title: 'Founder / CEO / CTO (public-site inferred)',
    preferred_contact_phone: '',
    preferred_contact_email: '',
    preferred_contact_linkedin_url: '',
    preferred_contact_company_website: '',
    contact_strategy: '',
    contact_phone_source: '',
    contact_email_source: '',
    phone_verification_status: 'not_attempted',
    enrichment_status: 'pending',
    public_contact_sources: [],
    company_website: ''
  };
}

function filterLead(lead) {
  const combined = `${lead.company_name || ''} ${lead.company_summary || ''} ${lead.role_title || ''} ${(lead.company_tags || []).join(' ')}`;
  if (!TECH_ROLE_RE.test(lead.role_title || '')) return false;
  if (NON_TARGET_ROLE_RE.test(lead.role_title || '')) return false;
  if (RECRUITER_RE.test(combined)) return false;
  if (CONSULTING_RE.test(combined)) return false;
  if (BIG_COMPANY_RE.test(combined)) return false;
  if (!isUsLocation(lead.location)) return false;
  if (lead.recency_days > CONFIG.maxAgeDays) return false;
  if (!looksLikeStartup(lead)) return false;
  return true;
}

function dedupeAndRank(leads) {
  const deduped = new Map();

  for (const lead of leads) {
    const key = `${normalizeName(lead.company_name)}::${normalizeName(lead.role_title)}::${canonicalUrl(lead.evidence_url)}`;
    const existing = deduped.get(key);
    if (!existing || existing.score < lead.score) {
      deduped.set(key, lead);
    }
  }

  return [...deduped.values()].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (left.recency_days !== right.recency_days) return left.recency_days - right.recency_days;
    return left.company_name.localeCompare(right.company_name);
  });
}

function pickOfficialSiteResult(results) {
  for (const result of results || []) {
    const url = canonicalUrl(result?.url || result?.link || '');
    if (!url || !isLikelyOfficialSite(url)) continue;
    return {
      url,
      title: normalizeWhitespace(result?.title || ''),
      description: normalizeWhitespace(result?.description || result?.snippet || '')
    };
  }
  return null;
}

function extractLikelyWebsiteFromDirectoryPage(markdown) {
  return extractMarkdownLinks(markdown).find((url) => isLikelyOfficialSite(url)) || '';
}

async function discoverOfficialSite(lead) {
  if (lead.source_subtype === 'yc_jobs' || lead.source_subtype === 'workatastartup_jobs') {
    try {
      const markdown = await firecrawlScrape(lead.company_url);
      const website = extractLikelyWebsiteFromDirectoryPage(markdown);
      if (website) {
        return {
          siteUrl: website,
          discovery_note: `Resolved official site from ${lead.source_subtype} company page.`,
          supporting_sources: [lead.company_url]
        };
      }
    } catch {
      // fall back to search
    }
  }

  const query = `"${lead.company_name}" ${compact(lead.company_summary, 80)} official site`;
  const results = await firecrawlSearch(query, 5);
  const picked = pickOfficialSiteResult(results);
  if (!picked) {
    return {
      siteUrl: '',
      discovery_note: 'Official site not found via Firecrawl search.',
      supporting_sources: []
    };
  }

  return {
    siteUrl: picked.url,
    discovery_note: compact(`${picked.title} ${picked.description}`, 180),
    supporting_sources: [picked.url]
  };
}

function safeJoin(base, fragment) {
  try {
    return new URL(fragment, base).toString();
  } catch {
    return '';
  }
}

async function buildPublicSiteBundle(lead) {
  const discovered = await discoverOfficialSite(lead);
  if (!discovered.siteUrl) {
    return {
      siteUrl: '',
      discoveryNote: discovered.discovery_note,
      scrapedUrls: discovered.supporting_sources,
      emails: [],
      phones: [],
      linkedinUrls: [],
      founderNames: []
    };
  }

  const pages = uniqueStrings(
    [
      discovered.siteUrl,
      safeJoin(discovered.siteUrl, '/contact'),
      safeJoin(discovered.siteUrl, '/about'),
      safeJoin(discovered.siteUrl, '/team'),
      safeJoin(discovered.siteUrl, '/careers')
    ].filter(Boolean)
  ).slice(0, CONFIG.publicSitePageLimit);

  let aggregate = '';
  const scrapedUrls = [...discovered.supporting_sources];

  for (const page of pages) {
    try {
      const markdown = await firecrawlScrape(page);
      if (!markdown) continue;
      aggregate += `\n\n# SOURCE ${page}\n${markdown}`;
      scrapedUrls.push(page);
    } catch {
      // keep partial bundles resilient
    }
  }

  return {
    siteUrl: discovered.siteUrl,
    discoveryNote: discovered.discovery_note,
    scrapedUrls: uniqueStrings(scrapedUrls),
    emails: extractEmails(aggregate),
    phones: extractPhones(aggregate),
    linkedinUrls: extractLinkedIns(aggregate),
    founderNames: extractFounderNames(aggregate)
  };
}

function applyContactBundle(lead, bundle, attempted) {
  const chosenEmail = chooseContactEmail(bundle.emails || []);
  const chosenPhone = firstNonEmpty(bundle.phones || []);
  const chosenLinkedIn = firstNonEmpty((bundle.linkedinUrls || []).filter((url) => /linkedin\.com\/in\//i.test(url)));

  const hasContact = Boolean(chosenPhone || chosenEmail || chosenLinkedIn);

  return {
    ...lead,
    preferred_contact_name: lead.preferred_contact_name || '',
    preferred_contact_phone: chosenPhone || lead.preferred_contact_phone || '',
    preferred_contact_email: chosenEmail || lead.preferred_contact_email || '',
    preferred_contact_linkedin_url: chosenLinkedIn || lead.preferred_contact_linkedin_url || '',
    preferred_contact_company_website: bundle.siteUrl || lead.preferred_contact_company_website || '',
    company_website: bundle.siteUrl || lead.company_website || '',
    contact_strategy: bundle.siteUrl ? 'public_company_site_search_fallback' : lead.contact_strategy || '',
    contact_phone_source: chosenPhone ? 'public_company_site' : lead.contact_phone_source || '',
    contact_email_source: chosenEmail ? 'public_company_site' : lead.contact_email_source || '',
    phone_verification_status: chosenPhone
      ? 'public-company-site'
      : attempted
        ? 'not_found'
        : 'not_attempted_budget_cap',
    enrichment_status: hasContact
      ? 'site_fallback_contact'
      : attempted
        ? 'site_fallback_no_contact'
        : 'not_attempted_budget_cap',
    enrichment_summary: compact(
      uniqueStrings(
        [
          lead.enrichment_summary,
          bundle.discoveryNote,
          chosenPhone ? 'Public company site exposed a callable phone number.' : '',
          chosenEmail ? 'Public company site exposed a contact email.' : '',
          chosenLinkedIn ? 'Public company site linked to a LinkedIn profile.' : ''
        ].filter(Boolean)
      ).join(' | '),
      240
    ),
    public_contact_sources: uniqueStrings(bundle.scrapedUrls || [])
  };
}

async function enrichTopCompanies(leads) {
  const companyTargets = [];
  const seen = new Set();

  for (const lead of leads) {
    const key = makeCompanyKey(lead);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    companyTargets.push({ key, lead });
    if (companyTargets.length >= CONFIG.companyEnrichmentLimit) break;
  }

  console.log(`[Enrichment] Attempting official-site phone/email enrichment for ${companyTargets.length} companies`);

  const bundles = await runWithConcurrency(
    companyTargets,
    CONFIG.enrichmentConcurrency,
    async ({ key, lead }, index) => {
      try {
        const bundle = await buildPublicSiteBundle(lead);
        console.log(
          `[Enrichment] ${index + 1}/${companyTargets.length} ${lead.company_name}: phones=${bundle.phones.length} emails=${bundle.emails.length}`
        );
        return { key, bundle };
      } catch (error) {
        console.warn(`[Enrichment] Failed ${lead.company_name}: ${error.message}`);
        return {
          key,
          bundle: {
            siteUrl: '',
            discoveryNote: String(error.message || error),
            scrapedUrls: [],
            emails: [],
            phones: [],
            linkedinUrls: [],
            founderNames: []
          }
        };
      }
    }
  );

  const bundleMap = new Map(bundles.map((entry) => [entry.key, entry.bundle]));
  const targetedKeys = new Set(companyTargets.map((entry) => entry.key));

  return leads.map((lead) => {
    const key = makeCompanyKey(lead);
    const bundle = bundleMap.get(key);
    if (!bundle) return applyContactBundle(lead, { siteUrl: '', discoveryNote: '', scrapedUrls: [], emails: [], phones: [], linkedinUrls: [], founderNames: [] }, targetedKeys.has(key));
    return applyContactBundle(lead, bundle, true);
  });
}

function toCsv(rows) {
  if (!rows.length) return '';

  const preferred = [
    'rank',
    'company_name',
    'job_role_title',
    'score',
    'tier',
    'source_subtype',
    'recency_days',
    'preferred_contact_name',
    'preferred_contact_title',
    'preferred_contact_phone',
    'phone_verification_status',
    'preferred_contact_email',
    'preferred_contact_linkedin_url',
    'preferred_contact_company_website',
    'contact_strategy',
    'company_size_label',
    'company_stage',
    'location',
    'evidence_url',
    'signal_summary',
    'conditions_matched',
    'enrichment_status',
    'enrichment_summary'
  ];

  const seen = new Set();
  rows.forEach((row) => Object.keys(row).forEach((key) => seen.add(key)));
  const columns = preferred.filter((column) => seen.has(column)).concat([...seen].filter((column) => !preferred.includes(column)).sort());
  const lines = [columns.join(',')];

  for (const row of rows) {
    lines.push(
      columns
        .map((column) => {
          const value = Array.isArray(row[column]) ? row[column].join(' | ') : row[column];
          return escapeCsv(value);
        })
        .join(',')
    );
  }

  return lines.join('\n');
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const [startupBoards, wellfound] = await Promise.all([buildStartupBoardLeads(), buildWellfoundLeads()]);

  let atsSearchRows = [];
  let rawLeads = [...startupBoards.yc, ...startupBoards.waas, ...wellfound.leads];
  let filteredLeads = rawLeads.filter(filterLead).map(normalizeLead).filter((lead) => lead.tier !== 'skip');
  let rankedLeads = dedupeAndRank(filteredLeads);

  if (rankedLeads.length < CONFIG.finalTarget) {
    atsSearchRows = await buildAtsSearchLeads();
    rawLeads = rawLeads.concat(atsSearchRows);
    filteredLeads = rawLeads.filter(filterLead).map(normalizeLead).filter((lead) => lead.tier !== 'skip');
    rankedLeads = dedupeAndRank(filteredLeads);
  }

  const finalLeads = rankedLeads.slice(0, CONFIG.finalTarget);
  const enrichedLeads = await enrichTopCompanies(finalLeads);

  const finalized = enrichedLeads.map((lead, index) => ({
    rank: index + 1,
    ...lead,
    conditions_matched: uniqueStrings(lead.conditions_matched || []),
    has_phone: Boolean(lead.preferred_contact_phone),
    has_contact_info: Boolean(lead.preferred_contact_phone || lead.preferred_contact_email || lead.preferred_contact_linkedin_url),
    contact_readiness: lead.preferred_contact_phone
      ? 'cold-call-ready'
      : lead.preferred_contact_email || lead.preferred_contact_linkedin_url
        ? 'contact-found'
        : 'no-contact'
  }));

  const output = {
    generated_at: new Date().toISOString(),
    runner_variant: 'firecrawl_only',
    strategy: {
      geography: 'United States',
      market_stage: 'Seed to early Series B software startups',
      priority_signals: [
        'founder_or_small_team_hiring_now',
        'recent_technical_role_post',
        'seed_or_growth_stage_startup',
        'public_site_phone_or_email_when_available'
      ],
      primary_sources: ['wellfound_role_pages', 'ycombinator_jobs', 'workatastartup_jobs'],
      contact_enrichment: ['firecrawl_search_official_site', 'firecrawl_public_site_scrape'],
      notes: [
        'Legacy output filenames were preserved for compatibility with the existing handoff.',
        'Phone numbers labeled public-company-site came from public website scraping and are not independently verified.',
        'Company-site enrichment is intentionally capped to the top companies in the ranked set to control Firecrawl usage.'
      ],
      limits: {
        final_target: CONFIG.finalTarget,
        wellfound_max_pages: CONFIG.wellfoundMaxPages,
        company_enrichment_limit: CONFIG.companyEnrichmentLimit,
        public_site_page_limit: CONFIG.publicSitePageLimit
      }
    },
    counts: {
      yc_rows: startupBoards.yc.length,
      workatastartup_rows: startupBoards.waas.length,
      wellfound_rows: wellfound.leads.length,
      ats_search_rows: atsSearchRows.length,
      filtered_rows: filteredLeads.length,
      final_ranked_leads: finalized.length,
      unique_companies_in_final_set: new Set(finalized.map((lead) => makeCompanyKey(lead))).size,
      leads_with_contact_info: finalized.filter((lead) => lead.has_contact_info).length,
      leads_with_phone: finalized.filter((lead) => lead.has_phone).length
    },
    wellfound_observed: {
      total_results: wellfound.totalResults,
      total_pages: wellfound.totalPages
    },
    leads: finalized
  };

  await fs.writeFile(CONFIG.outputJson, JSON.stringify(output, null, 2));
  await fs.writeFile(CONFIG.outputCsv, toCsv(finalized));

  console.log(`YC rows: ${startupBoards.yc.length}`);
  console.log(`WorkAtAStartup rows: ${startupBoards.waas.length}`);
  console.log(`Wellfound rows: ${wellfound.leads.length}`);
  console.log(`Filtered rows: ${filteredLeads.length}`);
  console.log(`Final ranked leads: ${finalized.length}`);
  console.log(`Rows with contact info: ${output.counts.leads_with_contact_info}`);
  console.log(`Rows with phone numbers: ${output.counts.leads_with_phone}`);
  console.log(`Output JSON: ${CONFIG.outputJson}`);
  console.log(`Output CSV: ${CONFIG.outputCsv}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
