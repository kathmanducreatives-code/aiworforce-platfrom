import fs from 'node:fs/promises';

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
if (!APIFY_TOKEN) throw new Error('Missing APIFY_API_TOKEN');

const CONFIG = {
  finalTarget: 2000,
  maxContactsPerCompany: 3,
  topCommentPosts: 120,
  commentPostChunkSize: 10,
  companyChunkSize: 100,
  profileChunkSize: 150,
  maxCommentProfilesToEnrich: 1400,
  maxJobProfilesToEnrich: 2600,
  outputJson: 'screening-pilot-pipeline/output/hot_leads_2000_apify.json',
  outputCsv: 'screening-pilot-pipeline/output/hot_leads_2000_apify.csv',
  sourceMix: {
    commentLeads: 700,
    jobCompanyContacts: 1300
  },
  actors: {
    postSearch: {
      actorSlug: 'harvestapi/linkedin-post-search',
      queries: [
        'recruiting agency fees startup',
        'staffing agency fees startup',
        'agency commissions are expensive startup',
        'hiring engineers is hard startup',
        "can't find software engineers founder",
        'bad candidate quality hiring startup',
        'recruiting takes too long startup',
        "we're growing our engineering team",
        'hiring our first engineer',
        'founding engineer hiring',
        '400 applications how do you screen',
        'there has to be a better way to hire engineers',
        'how do you screen 500 applicants',
        'need to hire engineers fast startup'
      ],
      passes: [
        {
          postedLimit: 'week',
          sortBy: 'date',
          maxPosts: 18,
          profileScraperMode: 'main',
          scrapeComments: false,
          scrapeReactions: false
        },
        {
          postedLimit: 'month',
          sortBy: 'relevance',
          maxPosts: 20,
          profileScraperMode: 'main',
          scrapeComments: false,
          scrapeReactions: false
        }
      ]
    },
    comments: {
      actorSlug: 'harvestapi/linkedin-post-comments',
      maxItems: 30,
      postedLimit: 'month',
      scrapeReplies: false,
      profileScraperMode: 'main'
    },
    jobs: {
      actorSlug: 'harvestapi/linkedin-job-search',
      runs: [
        {
          label: 'core_engineering',
          jobTitles: [
            'Founding Engineer',
            'Software Engineer',
            'Backend Engineer',
            'Frontend Engineer',
            'Full Stack Engineer',
            'Platform Engineer',
            'Product Engineer'
          ],
          locations: ['United States'],
          employmentType: ['full-time'],
          workplaceType: ['remote', 'hybrid', 'on-site'],
          postedLimit: 'week',
          sortBy: 'date',
          industryIds: ['4'],
          maxItems: 120
        },
        {
          label: 'ai_data',
          jobTitles: [
            'AI Engineer',
            'ML Engineer',
            'Data Engineer',
            'Applied Scientist',
            'Machine Learning Engineer'
          ],
          locations: ['United States'],
          employmentType: ['full-time'],
          workplaceType: ['remote', 'hybrid', 'on-site'],
          postedLimit: 'week',
          sortBy: 'date',
          industryIds: ['4'],
          maxItems: 120
        },
        {
          label: 'senior_product_design',
          jobTitles: [
            'Staff Software Engineer',
            'Principal Software Engineer',
            'Lead Software Engineer',
            'Product Designer',
            'Senior Product Designer'
          ],
          locations: ['United States'],
          employmentType: ['full-time'],
          workplaceType: ['remote', 'hybrid', 'on-site'],
          postedLimit: 'week',
          sortBy: 'date',
          industryIds: ['4'],
          maxItems: 90
        }
      ]
    },
    companyEmployees: {
      actorSlug: 'harvestapi/linkedin-company-employees',
      profileScraperMode: 'Short ($4 per 1k)',
      companyBatchMode: 'all_at_once',
      locations: ['United States'],
      jobTitles: [
        'Founder',
        'Co-Founder',
        'CEO',
        'CTO',
        'Head of Engineering',
        'VP Engineering',
        'Head of Talent',
        'VP People',
        'Recruiting Lead',
        'Engineering Manager'
      ],
      companyHeadcount: ['A', 'B', 'C', 'D'],
      seniorityLevelIds: ['220', '300', '310', '320'],
      functionIds: ['8', '9', '12', '18', '19'],
      industryIds: ['4'],
      maxItemsPerChunk: 400
    },
    profileEnrichment: {
      actorSlug: 'dev_fusion/Linkedin-Profile-Scraper'
    }
  }
};

const DECISION_MAKER_RE = /\b(founder|co-founder|ceo|cto|vp|head|director|engineering manager|recruiting lead|talent|people)\b/i;
const TARGET_CONTACT_TITLE_RE = /\b(founder|co-founder|ceo|cto|head of engineering|vp engineering|head of talent|vp people|recruiting lead|engineering manager)\b/i;
const RECRUITER_RE = /\b(recruiter|staffing|agency|headhunter|career coach|consultant)\b/i;
const BIG_COMPANY_RE = /\b(amazon|microsoft|google|meta|oracle|salesforce|ibm|accenture|infosys|cognizant|tcs|deloitte|capgemini|adp|randstad|robert half|teksystems)\b/i;
const GENERIC_COMMENT_RE = /\b(congrats|great post|thanks for sharing|so true|love this|interesting|good luck|amazing|well said)\b/i;
const TECH_ROLE_RE = /\b(founding|software|backend|frontend|full stack|full-stack|platform|product engineer|ai|ml|machine learning|applied scientist|data|designer)\b/i;
const PAIN_RE = /\b(agency|staffing|fee|fees|commission|markups?|hiring|hire|recruit|candidate|screening|talent|interview|time to hire|applicants?)\b/i;

const compact = (value, max = 220) => {
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

const chunk = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
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

const asJson = async (res) => {
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
};

const runApifyActor = async (actorSlug, input) => {
  const base = 'https://api.apify.com/v2';
  const actorId = encodeURIComponent(actorSlug.replace('/', '~'));
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
  return /\b(startup|seed|series a|series b|yc|founding|small team|runway|venture|saas|ai|developer tools|infra|security|data|healthtech|fintech)\b/i.test(combined);
};

const titleRank = (title) => {
  const value = String(title || '').toLowerCase();
  if (/\bfounder\b|\bco-founder\b|\bceo\b/.test(value)) return 4;
  if (/\bcto\b|\bhead of engineering\b|\bvp engineering\b/.test(value)) return 3;
  if (/\bhead of talent\b|\bvp people\b|\brecruiting lead\b/.test(value)) return 2;
  if (/\bengineering manager\b/.test(value)) return 1;
  return 0;
};

const extractPhone = (row) => {
  const fields = [
    row?.mobileNumber,
    row?.phone,
    row?.phoneNumber,
    row?.personalPhone,
    row?.workPhone
  ];
  for (const field of fields) {
    const value = String(field || '').trim();
    if (!value) continue;
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 9 && digits.length <= 15) {
      return value;
    }
  }
  return '';
};

const extractEmail = (row) => {
  const fields = [row?.email, row?.workEmail, row?.personalEmail];
  return fields.find((value) => String(value || '').trim()) || '';
};

const extractProfileUrl = (row) => {
  return canonicalUrl(
    row?.linkedinUrl ||
    row?.linkedinPublicUrl ||
    row?.profileUrl ||
    row?.actor?.linkedinUrl ||
    row?.authorUrl ||
    ''
  );
};

const extractContactName = (row) => {
  return row?.name || row?.fullName || row?.actor?.name || row?.authorName || '';
};

const extractContactTitle = (row) => {
  return row?.position || row?.headline || row?.jobTitle || row?.actor?.position || '';
};

const scoreCommentLead = ({ title, comment, postText, company }) => {
  const decisionMaker = DECISION_MAKER_RE.test(title);
  const feePain = /\b(agency|staffing|fee|fees|commission|markups?)\b/i.test(`${comment} ${postText}`);
  const hiringPain = /\b(hiring|hire|recruit|candidate|screening|talent|interview|time to hire|applicants?)\b/i.test(`${comment} ${postText}`);
  const frustration = /\b(frustrated|painful|slow|nightmare|waste|broken|hard|overwhelmed)\b/i.test(comment);
  const startupSignal = /\b(startup|seed|series a|series b|yc|small team|runway|founder)\b/i.test(`${comment} ${title} ${company}`);

  let score = 0;
  if (decisionMaker) score += 4;
  if (feePain) score += 4;
  if (hiringPain) score += 3;
  if (frustration) score += 2;
  if (startupSignal) score += 2;

  return { score, feePain, hiringPain };
};

const scoreJobLead = (job, roleCount = 1) => {
  const role = String(job.title || '');
  const companyName = String(job.company?.name || '');
  const companyDescription = String(job.company?.description || '');
  const companySize = Number(job.company?.employeeCountRange?.end || 0);
  const recencyDays = daysSinceIso(job.postedDate);
  const applicantCount = Number(job.applicants || 0);
  const startupFit = likelyStartup(companyName, companyDescription);

  let score = 0;
  if (/founding|staff|principal|lead|senior/i.test(role) || TECH_ROLE_RE.test(role)) score += 3;
  if (recencyDays <= 7) score += 3;
  if (applicantCount > 0 && applicantCount < 10) score += 2;
  if ((companySize > 0 && companySize <= 200) || startupFit) score += 2;
  if (roleCount > 1) score += 2;
  if (startupFit) score += 1;

  return {
    score,
    recencyDays,
    companySize,
    applicantCount,
    startupFit
  };
};

const toCsv = (rows) => {
  if (!rows.length) return '';
  const preferred = [
    'rank',
    'company_name',
    'contact_name',
    'contact_title',
    'contact_phone',
    'phone_verification_status',
    'contact_email',
    'contact_linkedin_url',
    'source_channel',
    'source_subtype',
    'job_role_title',
    'evidence_url',
    'signal_summary',
    'score',
    'tier',
    'conditions_matched',
    'company_linkedin_url',
    'company_size',
    'applicant_count',
    'recency_days'
  ];
  const seen = new Set();
  rows.forEach((row) => Object.keys(row).forEach((key) => seen.add(key)));
  const columns = preferred.filter((column) => seen.has(column)).concat([...seen].filter((column) => !preferred.includes(column)).sort());
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""').replace(/\n/g, ' ')}"`;
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => {
      const value = Array.isArray(row[column]) ? row[column].join(' | ') : row[column];
      return escape(value);
    }).join(','));
  }
  return lines.join('\n');
};

async function buildCommentContactCandidates() {
  const rawPosts = [];
  for (const pass of CONFIG.actors.postSearch.passes) {
    const rows = await runApifyActor(CONFIG.actors.postSearch.actorSlug, {
      searchQueries: CONFIG.actors.postSearch.queries,
      postedLimit: pass.postedLimit,
      sortBy: pass.sortBy,
      maxPosts: pass.maxPosts,
      profileScraperMode: pass.profileScraperMode,
      scrapeComments: pass.scrapeComments,
      scrapeReactions: pass.scrapeReactions
    });
    rawPosts.push(...(rows || []));
  }

  const postMap = new Map();
  for (const row of rawPosts) {
    const postUrl = canonicalUrl(row.linkedinUrl || row.post_url || row.url);
    if (!postUrl) continue;
    const postText = String(row.content || row.post_text || row.text || '');
    const authorTitle = row.author?.headline || row.author?.position || row.authorTitle || '';
    const priority = (PAIN_RE.test(postText) ? 10 : 0) + engagementScore(row) + (DECISION_MAKER_RE.test(authorTitle) ? 5 : 0);
    const next = {
      post_url: postUrl,
      post_text: postText,
      post_author: row.author?.name || row.post_author || row.author || '',
      post_author_title: authorTitle,
      priority_score: priority
    };

    if (!postMap.has(postUrl) || postMap.get(postUrl).priority_score < priority) {
      postMap.set(postUrl, next);
    }
  }

  const shortlistedPosts = [...postMap.values()]
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, CONFIG.topCommentPosts);

  const commentCandidates = [];
  for (const postChunk of chunk(shortlistedPosts, CONFIG.commentPostChunkSize)) {
    const rows = await runApifyActor(CONFIG.actors.comments.actorSlug, {
      posts: postChunk.map((post) => post.post_url),
      maxItems: CONFIG.actors.comments.maxItems,
      postedLimit: CONFIG.actors.comments.postedLimit,
      scrapeReplies: CONFIG.actors.comments.scrapeReplies,
      profileScraperMode: CONFIG.actors.comments.profileScraperMode
    });

    const postLookup = new Map(postChunk.map((post) => [post.post_url, post]));
    for (const row of rows || []) {
      const profileUrl = extractProfileUrl(row);
      const title = extractContactTitle(row);
      const commentText = String(row?.commentary || row?.comment || row?.text || '');
      const evidenceUrl = canonicalUrl(row?.postUrl || row?.linkedinPostUrl || row?.url || '') || postChunk[0]?.post_url || '';
      const post = postLookup.get(evidenceUrl) || postLookup.get(canonicalUrl(row?.postUrl || '')) || null;
      const companyName = companyFromTitle(title);
      const name = extractContactName(row);

      if (!profileUrl) continue;
      if (!DECISION_MAKER_RE.test(title)) continue;
      if (RECRUITER_RE.test(title)) continue;
      if (GENERIC_COMMENT_RE.test(commentText) || compact(commentText).length < 30) continue;
      if (companyName && !likelyStartup(companyName, `${title} ${commentText}`)) continue;

      const scored = scoreCommentLead({
        title,
        comment: commentText,
        postText: post?.post_text || '',
        company: companyName
      });
      if (scored.score < 8) continue;

      const conditions = [];
      if (scored.feePain) conditions.push('agency_fee_pain');
      if (scored.hiringPain) conditions.push('hiring_or_screening_pain');
      if (DECISION_MAKER_RE.test(title)) conditions.push('decision_maker_commenter');

      commentCandidates.push({
        source_channel: 'linkedin',
        source_subtype: 'post_comment',
        company_name: companyName,
        company_linkedin_url: '',
        contact_name: name,
        contact_title: title,
        contact_linkedin_url: profileUrl,
        evidence_url: post?.post_url || evidenceUrl,
        evidence_excerpt: compact(commentText),
        signal_summary: scored.feePain ? 'Commented on agency fee pain' : 'Commented on hiring pain',
        recency_days: daysSinceIso(row?.createdAt || row?.postedAt || row?.time || ''),
        score: scored.score,
        tier: 'hot',
        conditions_matched: conditions
      });
    }
  }

  const unique = new Map();
  for (const candidate of commentCandidates.sort((a, b) => b.score - a.score || a.recency_days - b.recency_days)) {
    const key = candidate.contact_linkedin_url;
    if (!unique.has(key)) unique.set(key, candidate);
  }

  return [...unique.values()];
}

async function buildJobCompanyCandidates() {
  const rawJobs = [];
  for (const run of CONFIG.actors.jobs.runs) {
    const rows = await runApifyActor(CONFIG.actors.jobs.actorSlug, run);
    rawJobs.push(...(rows || []));
  }

  const roleCountByCompany = new Map();
  for (const row of rawJobs) {
    const companyKey = canonicalUrl(row?.company?.linkedinUrl || '') || String(row?.company?.name || '').trim().toLowerCase();
    if (!companyKey) continue;
    roleCountByCompany.set(companyKey, (roleCountByCompany.get(companyKey) || 0) + 1);
  }

  const companyCandidates = [];
  for (const row of rawJobs) {
    const title = row?.title || '';
    const companyName = row?.company?.name || '';
    const companyUrl = row?.company?.linkedinUrl || '';
    const companyDescription = row?.company?.description || '';
    const evidenceUrl = row?.linkedinUrl || row?.applyMethod?.companyApplyUrl || '';
    const companyKey = canonicalUrl(companyUrl) || companyName.trim().toLowerCase();

    if (!title || !companyName || !evidenceUrl) continue;
    if (!TECH_ROLE_RE.test(title)) continue;
    if (RECRUITER_RE.test(`${companyName} ${companyDescription}`)) continue;

    const scored = scoreJobLead(row, roleCountByCompany.get(companyKey) || 1);
    if (!(scored.companySize > 0 && scored.companySize <= 200) && !scored.startupFit) continue;
    if (scored.score < 8) continue;

    const conditions = ['technical_role', 'recent_job_post'];
    if (scored.applicantCount > 0 && scored.applicantCount < 10) conditions.push('low_applicant_count');
    if ((roleCountByCompany.get(companyKey) || 1) > 1) conditions.push('multiple_open_roles');
    if (scored.startupFit) conditions.push('startup_fit');

    companyCandidates.push({
      company_name: companyName,
      company_linkedin_url: companyUrl,
      evidence_url: evidenceUrl,
      evidence_excerpt: compact(row?.descriptionText || row?.description || ''),
      signal_summary: `${title} posted ${scored.recencyDays}d ago${scored.applicantCount > 0 ? `, ${scored.applicantCount} applicants` : ''}`,
      recency_days: scored.recencyDays,
      score: scored.score,
      tier: 'hot',
      job_role_title: title,
      company_size: scored.companySize,
      applicant_count: scored.applicantCount,
      conditions_matched: conditions
    });
  }

  const uniqueCompanies = new Map();
  for (const candidate of companyCandidates.sort((a, b) => b.score - a.score || a.recency_days - b.recency_days)) {
    const key = canonicalUrl(candidate.company_linkedin_url) || candidate.company_name.toLowerCase();
    const existing = uniqueCompanies.get(key);
    if (!existing || existing.score < candidate.score) {
      uniqueCompanies.set(key, {
        ...candidate,
        open_role_count: roleCountByCompany.get(key) || 1
      });
    }
  }

  return [...uniqueCompanies.values()];
}

async function buildCompanyEmployeeCandidates(companyCandidates) {
  const companies = companyCandidates
    .map((candidate) => canonicalUrl(candidate.company_linkedin_url))
    .filter(Boolean);
  const uniqueCompanies = [...new Set(companies)];
  const rows = [];

  for (const companyChunk of chunk(uniqueCompanies, CONFIG.companyChunkSize)) {
    const chunkRows = await runApifyActor(CONFIG.actors.companyEmployees.actorSlug, {
      companies: companyChunk,
      profileScraperMode: CONFIG.actors.companyEmployees.profileScraperMode,
      companyBatchMode: CONFIG.actors.companyEmployees.companyBatchMode,
      locations: CONFIG.actors.companyEmployees.locations,
      jobTitles: CONFIG.actors.companyEmployees.jobTitles,
      companyHeadcount: CONFIG.actors.companyEmployees.companyHeadcount,
      seniorityLevelIds: CONFIG.actors.companyEmployees.seniorityLevelIds,
      functionIds: CONFIG.actors.companyEmployees.functionIds,
      industryIds: CONFIG.actors.companyEmployees.industryIds,
      maxItems: CONFIG.actors.companyEmployees.maxItemsPerChunk
    });
    rows.push(...(chunkRows || []));
  }

  const companyLookup = new Map(
    companyCandidates.map((candidate) => [canonicalUrl(candidate.company_linkedin_url) || candidate.company_name.toLowerCase(), candidate])
  );

  const contactCandidates = [];
  for (const row of rows) {
    const profileUrl = extractProfileUrl(row);
    const title = extractContactTitle(row);
    const name = extractContactName(row);
    const companyUrl = canonicalUrl(
      row?.companyLinkedinUrl ||
      row?.company?.linkedinUrl ||
      row?.currentCompanyLinkedinUrl ||
      row?.companyUrl ||
      ''
    );
    const companyName = row?.companyName || row?.company?.name || row?.currentCompanyName || '';
    const companyKey = companyUrl || companyName.toLowerCase();
    const companyLead = companyLookup.get(companyKey);

    if (!companyLead) continue;
    if (!profileUrl || !name || !title) continue;
    if (!TARGET_CONTACT_TITLE_RE.test(title)) continue;
    if (RECRUITER_RE.test(`${companyName} ${row?.companyDescription || ''}`)) continue;

    const conditions = [...(companyLead.conditions_matched || []), 'matched_target_contact_title'];
    const contactScore = companyLead.score + titleRank(title);

    contactCandidates.push({
      source_channel: 'linkedin',
      source_subtype: 'job_company_contact',
      company_name: companyLead.company_name,
      company_linkedin_url: companyLead.company_linkedin_url,
      contact_name: name,
      contact_title: title,
      contact_linkedin_url: profileUrl,
      evidence_url: companyLead.evidence_url,
      evidence_excerpt: companyLead.evidence_excerpt,
      signal_summary: `${companyLead.signal_summary}; matched ${title}`,
      recency_days: companyLead.recency_days,
      score: contactScore,
      tier: contactScore >= 8 ? 'hot' : 'warm',
      job_role_title: companyLead.job_role_title,
      company_size: companyLead.company_size,
      applicant_count: companyLead.applicant_count,
      conditions_matched: conditions
    });
  }

  const byContact = new Map();
  for (const candidate of contactCandidates.sort((a, b) => b.score - a.score)) {
    const key = `${candidate.company_name.toLowerCase()}::${candidate.contact_linkedin_url}`;
    if (!byContact.has(key)) byContact.set(key, candidate);
  }

  const countsByCompany = new Map();
  const limited = [];
  for (const candidate of byContact.values()) {
    const companyKey = canonicalUrl(candidate.company_linkedin_url) || candidate.company_name.toLowerCase();
    const count = countsByCompany.get(companyKey) || 0;
    if (count >= CONFIG.maxContactsPerCompany) continue;
    countsByCompany.set(companyKey, count + 1);
    limited.push(candidate);
  }

  return limited;
}

async function enrichProfilesWithPhone(contactCandidates) {
  const rankedCandidates = [...contactCandidates].sort((a, b) => b.score - a.score || a.recency_days - b.recency_days);
  const profileUrls = [...new Set(rankedCandidates.map((candidate) => canonicalUrl(candidate.contact_linkedin_url)).filter(Boolean))];
  const rows = [];

  for (const profileChunk of chunk(profileUrls, CONFIG.profileChunkSize)) {
    const chunkRows = await runApifyActor(CONFIG.actors.profileEnrichment.actorSlug, {
      profileUrls: profileChunk,
      maxItems: profileChunk.length
    });
    rows.push(...(chunkRows || []));
  }

  const profileLookup = new Map();
  for (const row of rows) {
    const key = extractProfileUrl(row);
    if (key) profileLookup.set(key, row);
  }

  return contactCandidates.map((candidate) => {
    const hit = profileLookup.get(canonicalUrl(candidate.contact_linkedin_url)) || null;
    const phone = extractPhone(hit || {});
    const email = extractEmail(hit || {});
    const companyWebsite = hit?.companyWebsite || hit?.company?.website || '';

    return {
      ...candidate,
      contact_phone: phone,
      contact_email: email,
      phone_verification_status: phone ? 'actor_returned_mobile' : 'missing',
      company_website: companyWebsite,
      enrichment_status: hit ? 'profile_enriched' : 'profile_missing'
    };
  });
}

function mergeAndFinalize(commentContacts, jobContacts) {
  const all = [...commentContacts, ...jobContacts]
    .filter((candidate) => candidate.contact_phone)
    .map((candidate) => ({
      ...candidate,
      score: candidate.score + 1,
      tier: candidate.score + 1 >= 8 ? 'hot' : 'warm'
    }));

  const unique = new Map();
  for (const candidate of all.sort((a, b) => b.score - a.score || a.recency_days - b.recency_days)) {
    const key = candidate.contact_linkedin_url || `${candidate.company_name.toLowerCase()}::${candidate.contact_name.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }

  const ranked = [...unique.values()];
  const commentQuota = Math.min(CONFIG.sourceMix.commentLeads, commentContacts.filter((candidate) => candidate.contact_phone).length);
  const jobQuota = Math.min(CONFIG.sourceMix.jobCompanyContacts, jobContacts.filter((candidate) => candidate.contact_phone).length);

  const commentPicked = ranked
    .filter((lead) => lead.source_subtype === 'post_comment')
    .slice(0, commentQuota);

  const seen = new Set(commentPicked.map((lead) => lead.contact_linkedin_url || `${lead.company_name.toLowerCase()}::${lead.contact_name.toLowerCase()}`));

  const jobPicked = ranked
    .filter((lead) => lead.source_subtype !== 'post_comment')
    .filter((lead) => !seen.has(lead.contact_linkedin_url || `${lead.company_name.toLowerCase()}::${lead.contact_name.toLowerCase()}`))
    .slice(0, jobQuota);

  const seeded = [...commentPicked, ...jobPicked];
  const seededKeys = new Set(seeded.map((lead) => lead.contact_linkedin_url || `${lead.company_name.toLowerCase()}::${lead.contact_name.toLowerCase()}`));
  const filler = ranked.filter((lead) => !seededKeys.has(lead.contact_linkedin_url || `${lead.company_name.toLowerCase()}::${lead.contact_name.toLowerCase()}`));

  const finalLeads = [...seeded, ...filler].slice(0, CONFIG.finalTarget).map((lead, index) => ({
    rank: index + 1,
    ...lead
  }));

  return finalLeads;
}

async function main() {
  const commentCandidates = await buildCommentContactCandidates();
  const jobCompanyCandidates = await buildJobCompanyCandidates();
  const jobContactCandidates = await buildCompanyEmployeeCandidates(jobCompanyCandidates);

  const commentEnrichmentPool = [...commentCandidates]
    .sort((a, b) => b.score - a.score || a.recency_days - b.recency_days)
    .slice(0, CONFIG.maxCommentProfilesToEnrich);
  const jobEnrichmentPool = [...jobContactCandidates]
    .sort((a, b) => b.score - a.score || a.recency_days - b.recency_days)
    .slice(0, CONFIG.maxJobProfilesToEnrich);

  const commentPhoneLeads = await enrichProfilesWithPhone(commentEnrichmentPool);
  const jobPhoneLeads = await enrichProfilesWithPhone(jobEnrichmentPool);

  const finalLeads = mergeAndFinalize(commentPhoneLeads, jobPhoneLeads);

  await fs.mkdir('screening-pilot-pipeline/output', { recursive: true });

  const output = {
    generated_at: new Date().toISOString(),
    final_count: finalLeads.length,
    phone_ready_count: finalLeads.filter((lead) => lead.contact_phone).length,
    comment_candidate_count: commentCandidates.length,
    comment_phone_ready_count: commentPhoneLeads.filter((lead) => lead.contact_phone).length,
    job_company_candidate_count: jobCompanyCandidates.length,
    job_contact_candidate_count: jobContactCandidates.length,
    job_phone_ready_count: jobPhoneLeads.filter((lead) => lead.contact_phone).length,
    config_used: CONFIG,
    conditions: {
      geography: 'United States',
      target_companies: 'Seed to early Series B software startups',
      decision_maker_titles: [
        'Founder',
        'Co-Founder',
        'CEO',
        'CTO',
        'Head of Engineering',
        'VP Engineering',
        'Head of Talent',
        'VP People',
        'Recruiting Lead',
        'Engineering Manager'
      ],
      hot_threshold: 'score >= 8 before phone bonus',
      final_filter: 'require phone number from profile enrichment actor'
    },
    actor_parameters: {
      post_search: CONFIG.actors.postSearch,
      comments: CONFIG.actors.comments,
      jobs: CONFIG.actors.jobs,
      company_employees: CONFIG.actors.companyEmployees,
      profile_enrichment: {
        actorSlug: CONFIG.actors.profileEnrichment.actorSlug,
        profileChunkSize: CONFIG.profileChunkSize
      }
    },
    leads: finalLeads
  };

  await fs.writeFile(CONFIG.outputJson, JSON.stringify(output, null, 2));
  await fs.writeFile(CONFIG.outputCsv, toCsv(finalLeads));

  console.log(`Hot phone-ready leads written: ${finalLeads.length}`);
  console.log(`Output JSON: ${CONFIG.outputJson}`);
  console.log(`Output CSV: ${CONFIG.outputCsv}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
