import fs from 'node:fs/promises';

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

if (!APIFY_TOKEN) throw new Error('Missing APIFY_API_TOKEN');
if (!FIRECRAWL_API_KEY) throw new Error('Missing FIRECRAWL_API_KEY');

const OUT_JSON = 'screening-pilot-pipeline/output/hot_leads_budgeted.json';
const OUT_CSV = 'screening-pilot-pipeline/output/hot_leads_budgeted.csv';

const POST_QUERIES = [
  'recruiting agency fees',
  'staffing agency fees',
  'agency commissions are expensive',
  'hiring engineers is hard',
  "can't find software engineers",
  'bad candidate quality',
  'recruiting takes too long',
  "we're growing our engineering team"
];

const JOB_TITLES = [
  'Founding Engineer',
  'Software Engineer',
  'Backend Engineer',
  'Full Stack Engineer',
  'AI Engineer',
  'ML Engineer',
  'Product Engineer',
  'Product Designer'
];

const DECISION_MAKER_RE = /\b(founder|co-founder|ceo|cto|vp|head|director|engineering manager|recruiting lead|talent|people)\b/i;
const RECRUITER_RE = /\b(recruiter|staffing|agency|headhunter|career coach|consultant)\b/i;
const BIG_COMPANY_RE = /\b(amazon|microsoft|google|meta|oracle|salesforce|ibm|accenture|infosys|cognizant|tcs|deloitte|capgemini)\b/i;
const TECH_ROLE_RE = /\b(founding|software|backend|frontend|full stack|full-stack|ai|ml|machine learning|data|product engineer|product designer|designer)\b/i;
const GENERIC_COMMENT_RE = /\b(congrats|great post|thanks for sharing|so true|love this|interesting|good luck|amazing|well said)\b/i;

const compact = (value, max = 180) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
};

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

const asJson = async (res) => {
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithRetries = async (url, options = {}, attempts = 3) => {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(1500 * attempt);
    }
  }
  throw lastError;
};

const runApifySync = async (actorSlug, input) => {
  const base = 'https://api.apify.com/v2';
  const actorId = encodeURIComponent(actorSlug);

  const runRes = await fetchWithRetries(`${base}/acts/${actorId}/runs?token=${encodeURIComponent(APIFY_TOKEN)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
  const runJson = await asJson(runRes);
  const runId = runJson?.data?.id;
  let datasetId = runJson?.data?.defaultDatasetId;
  let status = runJson?.data?.status || 'RUNNING';

  if (!runId) {
    throw new Error(`Apify actor ${actorSlug} did not return a run id`);
  }

  while (status === 'RUNNING' || status === 'READY') {
    await sleep(2500);
    const statusRes = await fetchWithRetries(`${base}/actor-runs/${runId}?token=${encodeURIComponent(APIFY_TOKEN)}`);
    const statusJson = await asJson(statusRes);
    status = statusJson?.data?.status || status;
    datasetId = statusJson?.data?.defaultDatasetId || datasetId;

    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
      throw new Error(`Apify actor ${actorSlug} ended with status ${status}`);
    }
  }

  if (!datasetId) return [];

  const datasetRes = await fetchWithRetries(`${base}/datasets/${datasetId}/items?clean=true&token=${encodeURIComponent(APIFY_TOKEN)}`);
  return asJson(datasetRes);
};

const firecrawlScrape = async (url) => {
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
  const json = await asJson(res);
  if (!json?.success || !json?.data?.markdown) throw new Error(`Firecrawl scrape failed for ${url}`);
  return json.data.markdown;
};

const firecrawlSearch = async (query, limit = 3) => {
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
  const json = await asJson(res);
  if (!json?.success) return [];
  const rows = json.data || json.results || [];
  return Array.isArray(rows) ? rows : [];
};

const parseDaysAgoFromText = (raw) => {
  const text = String(raw || '').toLowerCase();
  if (!text) return 999;
  if (/hour|minute|today|just now/.test(text)) return 0;
  const day = text.match(/(\d+)\s*day/);
  if (day) return Number(day[1]);
  const week = text.match(/(\d+)\s*week/);
  if (week) return Number(week[1]) * 7;
  const month = text.match(/(\d+)\s*month/);
  if (month) return Number(month[1]) * 30;
  return 999;
};

const daysSinceIso = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 999;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000)));
};

const engagementScore = (post) => {
  const e = post?.engagement || {};
  return Number(e.likes || post.likesCount || 0) + Number(e.comments || post.commentsCount || 0) + Number(e.shares || post.sharesCount || 0);
};

const companyFromTitle = (title) => {
  const text = String(title || '');
  const at = text.match(/\bat\s+([^|,]+)/i);
  if (at) return at[1].trim();
  const pipe = text.match(/^([^|,]+)\s*[|,-]/);
  if (pipe) return pipe[1].trim();
  return '';
};

const likelyStartup = (company, text = '') => {
  const combined = `${company || ''} ${text || ''}`.toLowerCase();
  if (!combined.trim()) return false;
  if (BIG_COMPANY_RE.test(combined)) return false;
  if (RECRUITER_RE.test(combined)) return false;
  return /\b(startup|seed|series a|series b|yc|founding|small team|runway|venture|saas|ai|developer tools|infra|security|data)\b/i.test(combined);
};

const scoreCommenter = ({ title, comment, postText, company }) => {
  const lowerTitle = String(title || '').toLowerCase();
  const lowerComment = String(comment || '').toLowerCase();
  const lowerPost = String(postText || '').toLowerCase();
  const lowerCompany = String(company || '').toLowerCase();

  const decisionMaker = DECISION_MAKER_RE.test(lowerTitle);
  const feePain = /\b(agency|staffing|fee|fees|commission|markups?)\b/.test(lowerComment + ' ' + lowerPost);
  const hiringPain = /\b(hiring|hire|recruit|candidate|screening|talent|interview|time to hire)\b/.test(lowerComment + ' ' + lowerPost);
  const frustration = /\b(frustrated|painful|slow|nightmare|waste|broken|cooked|hard)\b/.test(lowerComment);
  const startupSignal = /\b(startup|seed|series a|series b|yc|small team|runway)\b/.test(lowerComment + ' ' + lowerTitle + ' ' + lowerCompany);

  let score = 0;
  if (decisionMaker) score += 4;
  if (feePain) score += 4;
  if (hiringPain) score += 3;
  if (frustration) score += 2;
  if (startupSignal) score += 2;

  return {
    score,
    decisionMaker,
    feePain,
    hiringPain,
    frustration,
    startupSignal
  };
};

const scoreJobLead = (job) => {
  let score = 0;
  const role = String(job.title || '');
  const companyName = String(job.company?.name || '');
  const companyDescription = String(job.company?.description || '');
  const applicantCount = Number(job.applicants || 0);
  const companySize = Number(job.company?.employeeCountRange?.end || 0);
  const recencyDays = daysSinceIso(job.postedDate);
  const startupFit = likelyStartup(companyName, companyDescription);

  if (/founding|staff|principal|lead|senior/i.test(role) || TECH_ROLE_RE.test(role)) score += 3;
  if (recencyDays <= 7) score += 3;
  if (applicantCount > 0 && applicantCount < 10) score += 2;
  if (companySize > 0 && companySize <= 200) score += 2;
  if (startupFit) score += 2;

  return { score, recencyDays, companySize, applicantCount, startupFit };
};

const parseWorkAtStartup = (markdown) => {
  const lines = markdown.split('\n');
  const leads = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const match = line.match(/^\[(.+?)\s*\(([SWF]\d{2})\)\s*•\s*(.+?)\(([^)]+ago)\)\]\((https:\/\/www\.workatastartup\.com\/companies\/[^)]+)\)$/i);
    if (!match) continue;

    const [, companyName, batch, companySummary, ageRaw, companyUrl] = match;
    let roleTitle = '';
    let jobUrl = '';
    for (let j = i + 1; j <= Math.min(i + 8, lines.length - 1); j += 1) {
      const jobMatch = lines[j].trim().match(/^\[(.+?)\]\((https:\/\/www\.ycombinator\.com\/companies\/[^)]+\/jobs\/[^)]+)\)$/i);
      if (jobMatch) {
        roleTitle = jobMatch[1].trim();
        jobUrl = jobMatch[2].trim();
        break;
      }
    }

    if (!roleTitle || !jobUrl) continue;

    leads.push({
      board: 'workatastartup',
      company_name: companyName.trim(),
      batch,
      company_summary: companySummary.trim(),
      age_raw: ageRaw.trim(),
      days_ago: parseDaysAgoFromText(ageRaw),
      company_url: companyUrl,
      role_title: roleTitle,
      job_url: jobUrl
    });
  }

  return leads;
};

const parseYCJobs = (markdown) => {
  const lines = markdown.split('\n');
  const leads = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(/^\[(.+?)\s*\(([SWF]\d{2})\)•(.+?)\(([^)]+ago)\)\]\((https:\/\/www\.ycombinator\.com\/companies\/[^)]+)\)\s+\[(.+?)\]\((https:\/\/www\.ycombinator\.com\/companies\/[^)]+\/jobs\/[^)]+)\)$/i);
    if (!match) continue;

    const [, companyName, batch, companySummary, ageRaw, companyUrl, roleTitle, jobUrl] = match;
    leads.push({
      board: 'yc-jobs',
      company_name: companyName.trim(),
      batch,
      company_summary: companySummary.trim(),
      age_raw: ageRaw.trim(),
      days_ago: parseDaysAgoFromText(ageRaw),
      company_url: companyUrl.trim(),
      role_title: roleTitle.trim(),
      job_url: jobUrl.trim()
    });
  }

  return leads;
};

async function buildCommentLeads() {
  const passes = [
    { postedLimit: 'week', sortBy: 'date', maxPosts: 6 },
    { postedLimit: 'month', sortBy: 'relevance', maxPosts: 6 }
  ];

  const rawPosts = [];
  for (const pass of passes) {
    const rows = await runApifySync('harvestapi/linkedin-post-search', {
      searchQueries: POST_QUERIES,
      postedLimit: pass.postedLimit,
      sortBy: pass.sortBy,
      maxPosts: pass.maxPosts,
      scrapeComments: false,
      scrapeReactions: false
    });
    rawPosts.push(...(rows || []));
  }

  const postMap = new Map();
  for (const row of rawPosts) {
    const postUrl = canonicalUrl(row.linkedinUrl || row.post_url || row.url);
    if (!postUrl) continue;
    const postText = String(row.content || row.post_text || row.text || '');
    const ranked = {
      post_url: postUrl,
      post_author: row.author?.name || row.post_author || row.author || '',
      post_text: postText,
      engagement_count: engagementScore(row),
      priority_score: (/\b(agency|fee|staffing|hiring|candidate|recruit)\b/i.test(postText) ? 5 : 0) + engagementScore(row)
    };
    if (!postMap.has(postUrl) || postMap.get(postUrl).priority_score < ranked.priority_score) {
      postMap.set(postUrl, ranked);
    }
  }

  const topPosts = [...postMap.values()]
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 10);

  const leads = [];
  for (const post of topPosts) {
    const rows = await runApifySync('harvestapi/linkedin-post-comments', {
      posts: [post.post_url],
      maxItems: 25,
      postedLimit: 'month',
      profileScraperMode: 'main',
      scrapeReplies: false
    });

    for (const row of rows || []) {
      const title = row?.actor?.position || row?.headline || '';
      const name = row?.actor?.name || row?.authorName || '';
      const profileUrl = canonicalUrl(row?.actor?.linkedinUrl || row?.profileUrl || row?.authorUrl || '');
      const commentText = String(row?.commentary || row?.comment || row?.text || '');
      const companyGuess = companyFromTitle(title);
      const recencyDays = daysSinceIso(row?.createdAt || row?.postedAt || row?.time || '');

      if (!profileUrl) continue;
      if (!DECISION_MAKER_RE.test(title)) continue;
      if (RECRUITER_RE.test(title)) continue;
      if (GENERIC_COMMENT_RE.test(commentText) || compact(commentText).length < 30) continue;
    if (companyGuess && !likelyStartup(companyGuess, `${title} ${commentText}`)) continue;

      const scored = scoreCommenter({ title, comment: commentText, postText: post.post_text, company: companyGuess });
      if (scored.score < 8) continue;

      leads.push({
        source_channel: 'linkedin',
        source_subtype: 'post_comment',
        company_name: companyGuess || '',
        company_url: '',
        contact_name: name,
        contact_title: title,
        contact_linkedin_url: profileUrl,
        evidence_url: post.post_url,
        evidence_excerpt: compact(commentText, 220),
        signal_summary: scored.feePain
          ? 'Commented on agency fee or staffing pain'
          : 'Commented on hiring or screening pain',
        recency_days: recencyDays,
        score: scored.score,
        tier: 'hot',
        preferred_contact: {
          name,
          title,
          linkedin_url: profileUrl
        },
        fallback_contacts: [],
        funding_signal: '',
        enrichment_summary: '',
        ranking_source: scored.feePain ? 'comment_fee_pain' : 'comment_hiring_pain'
      });
    }
  }

  const unique = new Map();
  for (const lead of leads.sort((a, b) => b.score - a.score)) {
    const key = lead.contact_linkedin_url;
    if (!unique.has(key)) unique.set(key, lead);
  }

  return [...unique.values()].slice(0, 20);
}

async function buildLinkedinJobLeads() {
  let rows = [];
  try {
    rows = await runApifySync('harvestapi/linkedin-job-search', {
      jobTitles: JOB_TITLES,
      locations: ['United States'],
      sortBy: 'date',
      employmentType: ['full-time'],
      postedLimit: 'week',
      maxItems: 96
    });
  } catch (error) {
    console.warn('LinkedIn job search actor failed:', error.message);
    return [];
  }

  const leads = [];
  for (const row of rows || []) {
    const title = row?.title || '';
    const companyName = row?.company?.name || '';
    const companyUrl = row?.company?.linkedinUrl || '';
    const companyDescription = row?.company?.description || '';
    const applyUrl = row?.linkedinUrl || row?.applyMethod?.companyApplyUrl || '';

    if (!title || !companyName || !applyUrl) continue;
    if (!TECH_ROLE_RE.test(title)) continue;
    if (RECRUITER_RE.test(`${companyName} ${companyDescription}`)) continue;
    const scored = scoreJobLead(row);
    if (!(scored.companySize > 0 && scored.companySize <= 200) && !scored.startupFit) continue;
    if (scored.score < 8) continue;

    leads.push({
      source_channel: 'linkedin',
      source_subtype: 'job_post',
      company_name: companyName,
      company_url: companyUrl,
      contact_name: '',
      contact_title: '',
      contact_linkedin_url: '',
      evidence_url: applyUrl,
      evidence_excerpt: compact(row.descriptionText || '', 220),
      signal_summary: `${title} posted ${scored.recencyDays}d ago${Number.isFinite(scored.applicantCount) && scored.applicantCount > 0 ? `, ${scored.applicantCount} applicants` : ''}`,
      recency_days: scored.recencyDays,
      score: scored.score,
      tier: 'hot',
      preferred_contact: null,
      fallback_contacts: [],
      funding_signal: '',
      enrichment_summary: '',
      ranking_source: 'linkedin_job'
    });
  }

  const unique = new Map();
  for (const lead of leads.sort((a, b) => b.score - a.score)) {
    const key = `${lead.company_name.toLowerCase()}::${lead.evidence_url.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, lead);
  }

  return [...unique.values()].slice(0, 18);
}

async function buildBoardLeads() {
  const [waasMd, ycMd] = await Promise.all([
    firecrawlScrape('https://www.workatastartup.com/jobs'),
    firecrawlScrape('https://www.ycombinator.com/jobs')
  ]);

  const rows = [...parseWorkAtStartup(waasMd), ...parseYCJobs(ycMd)];
  const leads = [];

  for (const row of rows) {
    if (row.days_ago > 30) continue;
    if (!TECH_ROLE_RE.test(row.role_title)) continue;
    if (RECRUITER_RE.test(`${row.company_name} ${row.company_summary}`)) continue;
    if (!likelyStartup(row.company_name, `${row.company_summary} ${row.batch}`)) continue;

    let score = 0;
    if (/yc|workatastartup/i.test(row.board)) score += 3;
    if (row.days_ago <= 14) score += 3;
    if (/founding|senior|staff|lead|principal/i.test(row.role_title) || TECH_ROLE_RE.test(row.role_title)) score += 2;
    if (/\b(S|W|F)\d{2}\b/i.test(row.batch)) score += 2;

    if (score < 8) continue;

    leads.push({
      source_channel: 'job_board',
      source_subtype: row.board,
      company_name: row.company_name,
      company_url: row.company_url,
      contact_name: '',
      contact_title: '',
      contact_linkedin_url: '',
      evidence_url: row.job_url,
      evidence_excerpt: compact(row.company_summary, 200),
      signal_summary: `${row.role_title} posted ${row.age_raw} (${row.batch})`,
      recency_days: row.days_ago,
      score,
      tier: 'hot',
      preferred_contact: null,
      fallback_contacts: [],
      funding_signal: '',
      enrichment_summary: '',
      ranking_source: row.board
    });
  }

  const unique = new Map();
  for (const lead of leads.sort((a, b) => a.recency_days - b.recency_days || b.score - a.score)) {
    const key = `${lead.company_name.toLowerCase()}::${lead.evidence_url.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, lead);
  }

  return [...unique.values()].slice(0, 12);
}

async function enrichWithSearchSignals(leads) {
  const deduped = [];
  const seen = new Set();

  for (const lead of leads) {
    const key = lead.company_name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(lead);
    if (deduped.length >= 10) break;
  }

  const byCompany = new Map();
  for (const lead of deduped) {
    const fundingResults = await firecrawlSearch(`"${lead.company_name}" (raised seed OR raised "series a" OR raised "series b")`, 3);
    const hiringResults = await firecrawlSearch(`"${lead.company_name}" (careers OR jobs OR hiring)`, 3);

    const fundingSignal = fundingResults.find((item) => /\b(raised|funding|series a|series b|seed)\b/i.test(`${item.title || ''} ${item.description || ''}`));
    const hiringSignal = hiringResults.find((item) => /\b(careers|jobs|hiring|join our team)\b/i.test(`${item.title || ''} ${item.description || ''}`));

    byCompany.set(lead.company_name.toLowerCase(), {
      fundingSignal: fundingSignal ? compact(`${fundingSignal.title || ''} ${fundingSignal.description || ''}`, 160) : '',
      hiringSignal: hiringSignal ? compact(`${hiringSignal.title || ''} ${hiringSignal.description || ''}`, 160) : ''
    });
  }

  return leads.map((lead) => {
    const enrichment = byCompany.get(lead.company_name.toLowerCase());
    if (!enrichment) return lead;

    let score = lead.score;
    if (enrichment.fundingSignal) score += 2;
    if (enrichment.hiringSignal) score += 1;

    return {
      ...lead,
      score,
      funding_signal: enrichment.fundingSignal,
      enrichment_summary: [enrichment.fundingSignal, enrichment.hiringSignal].filter(Boolean).join(' | ')
    };
  });
}

async function main() {
  let commentLeads = [];
  let linkedinJobs = [];
  let boardLeads = [];

  try {
    commentLeads = await buildCommentLeads();
  } catch (error) {
    console.warn('Comment lead stage failed:', error.message);
  }

  try {
    linkedinJobs = await buildLinkedinJobLeads();
  } catch (error) {
    console.warn('LinkedIn jobs stage failed:', error.message);
  }

  try {
    boardLeads = await buildBoardLeads();
  } catch (error) {
    console.warn('Job board stage failed:', error.message);
  }

  const combined = [...commentLeads, ...linkedinJobs, ...boardLeads];
  if (!combined.length) {
    throw new Error('All lead sources returned zero results');
  }
  const enriched = await enrichWithSearchSignals(combined);

  const sorted = enriched.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.recency_days !== b.recency_days) return a.recency_days - b.recency_days;
    return a.company_name.localeCompare(b.company_name);
  });

  const topLeads = sorted.slice(0, 30);

  const output = {
    generated_at: new Date().toISOString(),
    strategy: {
      geography: 'United States',
      intent_mode: 'high_intent',
      source_order: [
        'linkedin_post_commenters',
        'linkedin_job_posts',
        'yc_and_workatastartup_job_boards',
        'firecrawl_funding_and_hiring_search_enrichment'
      ],
      budget_caps: {
        apify_usd_max: 5,
        firecrawl_credits_max: 500
      }
    },
    estimated_usage: {
      apify_usd_estimate: 2.4,
      firecrawl_credits_estimate: 50
    },
    counts: {
      linkedin_comment_leads: commentLeads.length,
      linkedin_job_leads: linkedinJobs.length,
      board_leads: boardLeads.length,
      final_ranked_leads: topLeads.length
    },
    leads: topLeads
  };

  const csvRows = [
    'rank,source_channel,source_subtype,company_name,contact_name,contact_title,contact_linkedin_url,evidence_url,score,recency_days,signal_summary,funding_signal,enrichment_summary'
  ];

  topLeads.forEach((lead, index) => {
    csvRows.push([
      index + 1,
      lead.source_channel,
      lead.source_subtype,
      (lead.company_name || '').replaceAll(',', ' '),
      (lead.contact_name || '').replaceAll(',', ' '),
      (lead.contact_title || '').replaceAll(',', ' '),
      (lead.contact_linkedin_url || '').replaceAll(',', ' '),
      (lead.evidence_url || '').replaceAll(',', ' '),
      lead.score,
      lead.recency_days,
      (lead.signal_summary || '').replaceAll(',', ' '),
      (lead.funding_signal || '').replaceAll(',', ' '),
      (lead.enrichment_summary || '').replaceAll(',', ' ')
    ].join(','));
  });

  await fs.writeFile(OUT_JSON, JSON.stringify(output, null, 2));
  await fs.writeFile(OUT_CSV, csvRows.join('\n'));

  console.log(`Comment leads: ${commentLeads.length}`);
  console.log(`LinkedIn job leads: ${linkedinJobs.length}`);
  console.log(`Board leads: ${boardLeads.length}`);
  console.log(`Final ranked leads: ${topLeads.length}`);
  console.log(`Output JSON: ${OUT_JSON}`);
  console.log(`Output CSV: ${OUT_CSV}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
