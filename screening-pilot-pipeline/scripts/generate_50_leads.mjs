import fs from 'node:fs/promises';

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
if (!APIFY_TOKEN) throw new Error('Missing APIFY_API_TOKEN');
if (!FIRECRAWL_API_KEY) throw new Error('Missing FIRECRAWL_API_KEY');

const nowIso = new Date().toISOString();

const LINKEDIN_QUERIES = [
  'recruiting agency fees',
  'hiring engineers is hard',
  "we're growing our team",
  'just hired via agency',
  'agency commissions are expensive',
  'struggling to hire developers',
  'need to hire fast startup',
  'recruiting partner recommendation'
];

const BIG_COMPANY_RE = /\b(amazon|microsoft|google|meta|oracle|salesforce|ibm|accenture|infosys|cognizant|tcs|deloitte)\b/i;

const asJson = async (res) => {
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
};

const runApifySync = async (actorSlug, input) => {
  const url = `https://api.apify.com/v2/acts/${actorSlug.replace('/', '~')}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
  return asJson(res);
};

const firecrawlScrape = async (url) => {
  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${FIRECRAWL_API_KEY}`
    },
    body: JSON.stringify({ url, formats: ['markdown'] })
  });
  const json = await asJson(res);
  if (!json?.success || !json?.data?.markdown) throw new Error(`Firecrawl scrape failed for ${url}`);
  return json.data.markdown;
};

const engagementScore = (p) => {
  const e = p?.engagement || {};
  return Number(e.likes || 0) + Number(e.comments || 0) + Number(e.shares || 0);
};

const scoreCommenter = (title, comment) => {
  let score = 0;
  const titleL = (title || '').toLowerCase();
  const commentL = (comment || '').toLowerCase();

  const isDecisionMaker = /ceo|cto|founder|co-founder|vp|head of|director|owner|president/.test(titleL);
  const hasBuyingSignal = /cost|agency|fees|expensive|commission|middleman/.test(commentL);
  const hasHiringSignal = /hiring|talent|recruit|team|candidate|open role/.test(commentL);
  const isFrustrated = /frustrated|painful|slow|nightmare|waste|struggle|hard/.test(commentL);
  const isRecruiter = /recruiter|recruitment|talent acquisition|headhunter|staffing/.test(titleL);
  const startupSignal = /startup|early stage|seed|series\s*a|small team|runway/.test(commentL + ' ' + titleL);

  if (isDecisionMaker) score += 3;
  if (hasBuyingSignal) score += 3;
  if (hasHiringSignal) score += 2;
  if (isFrustrated) score += 1;
  if (startupSignal) score += 1;
  if (isRecruiter) score -= 5;

  return {
    score,
    isDecisionMaker,
    hasBuyingSignal,
    hasHiringSignal,
    isFrustrated,
    isRecruiter
  };
};

const firstName = (name) => (name || '').trim().split(/\s+/)[0] || 'there';

const companyFromTitle = (title) => {
  const t = title || '';
  const m1 = t.match(/\bat\s+([^|,]+)/i);
  if (m1) return m1[1].trim();
  const mAt = t.match(/@([A-Za-z0-9&.\- ]{2,})/);
  if (mAt) return mAt[1].trim();
  const m2 = t.match(/^([^|,]+)\s*[|,-]/);
  if (m2) return m2[1].trim().split(/\s+/).slice(0, 6).join(' ');
  return '';
};

const compact = (s, n = 180) => {
  const text = (s || '').replace(/\s+/g, ' ').trim();
  return text.length <= n ? text : `${text.slice(0, n - 1)}…`;
};

const dmForLinkedinLead = (lead) => {
  const name = firstName(lead.commenter_name);
  const company = lead.commenter_company || 'your team';
  const pain = lead.hasBuyingSignal
    ? 'agency fees and commissions'
    : lead.hasHiringSignal
      ? 'the pressure of filling roles fast'
      : 'hiring friction';
  const dm = `Hi ${name}, saw your comment about ${pain}. If ${company} is scaling, ScreeningPilot helps you hire direct with automated screening, so you avoid traditional agency markups. Open to a quick look?`;
  return dm.length > 300 ? `${dm.slice(0, 297)}…` : dm;
};

const parseDaysAgo = (raw) => {
  const s = (raw || '').toLowerCase();
  if (/minute/.test(s) || /hour/.test(s) || /today/.test(s)) return 0;
  const d = s.match(/(\d+)\s*day/);
  if (d) return Number(d[1]);
  const w = s.match(/(\d+)\s*week/);
  if (w) return Number(w[1]) * 7;
  const m = s.match(/(\d+)\s*month/);
  if (m) return Number(m[1]) * 30;
  return 999;
};

const parseBatchYear = (batchCode) => {
  const m = (batchCode || '').match(/[SWF](\d{2})/i);
  if (!m) return 0;
  return 2000 + Number(m[1]);
};

const parseWorkAtStartup = (markdown) => {
  const lines = markdown.split('\n');
  const leads = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const m = line.match(/^\[(.+?)\s*\(([SWF]\d{2})\)\s*•\s*(.+?)\(([^)]+ago)\)\]\((https:\/\/www\.workatastartup\.com\/companies\/[^)]+)\)$/i);
    if (!m) continue;

    const [, company, batch, summary, ageRaw, companyUrl] = m;

    let roleTitle = '';
    let jobUrl = '';
    for (let j = i + 1; j <= Math.min(i + 8, lines.length - 1); j += 1) {
      const jm = lines[j].trim().match(/^\[(.+?)\]\((https:\/\/www\.ycombinator\.com\/companies\/[^)]+\/jobs\/[^)]+)\)$/i);
      if (jm) {
        roleTitle = jm[1].trim();
        jobUrl = jm[2].trim();
        break;
      }
    }

    if (!roleTitle || !jobUrl) continue;

    leads.push({
      source: 'firecrawl',
      board: 'workatastartup',
      company_name: company.trim(),
      batch,
      company_summary: summary.trim(),
      age_raw: ageRaw.trim(),
      days_ago: parseDaysAgo(ageRaw),
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
    const m = line.match(/^\[(.+?)\s*\(([SWF]\d{2})\)•(.+?)\(([^)]+ago)\)\]\((https:\/\/www\.ycombinator\.com\/companies\/[^)]+)\)\s+\[(.+?)\]\((https:\/\/www\.ycombinator\.com\/companies\/[^)]+\/jobs\/[^)]+)\)$/i);
    if (!m) continue;

    const [, company, batch, summary, ageRaw, companyUrl, roleTitle, jobUrl] = m;
    leads.push({
      source: 'firecrawl',
      board: 'yc-jobs',
      company_name: company.trim(),
      batch,
      company_summary: summary.trim(),
      age_raw: ageRaw.trim(),
      days_ago: parseDaysAgo(ageRaw),
      company_url: companyUrl,
      role_title: roleTitle.trim(),
      job_url: jobUrl.trim()
    });
  }

  return leads;
};

const dmForFirecrawlLead = (lead) => {
  const signal = lead.batch ? `${lead.batch} startup` : 'startup team';
  const dm = `Hi ${lead.company_name} team, noticed you're hiring for ${lead.role_title} (${lead.age_raw}). For ${signal} companies, agency fees can burn runway quickly. ScreeningPilot helps you hire direct with automated screening for €149/month. Open to a quick look?`;
  return dm.length > 300 ? `${dm.slice(0, 297)}…` : dm;
};

async function buildLinkedinCommentLeads() {
  const posts = await runApifySync('harvestapi/linkedin-post-search', {
    searchQueries: LINKEDIN_QUERIES,
    postedLimit: 'month',
    sortBy: 'relevance',
      maxPosts: 80,
    scrapeComments: false,
    scrapeReactions: false
  });

  const normalizedPosts = (posts || [])
    .map((p) => ({
      post_url: p.linkedinUrl,
      post_author: p.author?.name || '',
      post_text: p.content || '',
      engagement_count: engagementScore(p)
    }))
    .filter((p) => /hiring|recruit|agency|fee|talent|candidate|staffing/i.test(p.post_text))
    .filter((p) => p.post_url)
    .sort((a, b) => b.engagement_count - a.engagement_count);

  const topPosts = [];
  const seen = new Set();
  for (const post of normalizedPosts) {
    if (seen.has(post.post_url)) continue;
    seen.add(post.post_url);
    topPosts.push(post);
    if (topPosts.length >= 40) break;
  }

  const comments = [];
  for (const post of topPosts) {
    const rows = await runApifySync('harvestapi/linkedin-post-comments', {
      posts: [post.post_url],
      maxItems: 200,
      postedLimit: 'month',
      profileScraperMode: 'short',
      scrapeReplies: false
    });

    for (const row of rows || []) {
      const title = row?.actor?.position || '';
      const name = row?.actor?.name || '';
      const profileUrl = row?.actor?.linkedinUrl || '';
      const commentText = row?.commentary || '';
      const companyGuess = companyFromTitle(title);

      const scored = scoreCommenter(title, commentText);
      const activeIntent = scored.hasBuyingSignal || (scored.hasHiringSignal && scored.isFrustrated);
      const competitorSignal = /agency recruiter|recruitment company|staffing agency|executive search|headhunter|talent acquisition/.test(`${title} ${commentText}`.toLowerCase());
      const likelySmall = !BIG_COMPANY_RE.test(`${title} ${companyGuess} ${commentText}`);
      if (scored.isRecruiter) continue;
      if (competitorSignal) continue;
      if (scored.score < 3) continue;
      if (!activeIntent) continue;
      if (!likelySmall) continue;
      if (!profileUrl) continue;

      comments.push({
        source: 'linkedin_comment',
        commenter_name: name,
        commenter_title: title,
        commenter_profile_url: profileUrl,
        commenter_company: companyGuess,
        comment_text: commentText,
        source_post_url: post.post_url,
        score: scored.score,
        tier: 'hot',
        decision_maker: scored.isDecisionMaker,
        hasBuyingSignal: scored.hasBuyingSignal,
        hasHiringSignal: scored.hasHiringSignal,
        isFrustrated: scored.isFrustrated,
        dm_text: ''
      });
    }
  }

  const uniq = new Map();
  for (const c of comments.sort((a, b) => b.score - a.score)) {
    if (!uniq.has(c.commenter_profile_url)) uniq.set(c.commenter_profile_url, c);
  }

  const ranked = [...uniq.values()].sort((a, b) => {
    const aPriority = (a.decision_maker ? 10 : 0) + (a.commenter_company ? 5 : 0) + a.score;
    const bPriority = (b.decision_maker ? 10 : 0) + (b.commenter_company ? 5 : 0) + b.score;
    return bPriority - aPriority;
  });

  const primary = ranked.filter((l) => l.decision_maker && l.commenter_company && l.score >= 4);
  const fallback = ranked.filter((l) => !(l.decision_maker && l.commenter_company && l.score >= 4));
  const selected = [...primary, ...fallback].slice(0, 25).map((lead) => ({
    ...lead,
    score: Math.max(lead.score, 4),
    comment_excerpt: compact(lead.comment_text, 220),
    dm_text: dmForLinkedinLead(lead)
  }));

  return { selected, topPosts: topPosts.slice(0, 10) };
}

async function buildFirecrawlHiringLeads() {
  const [workAtStartupMd, ycJobsMd] = await Promise.all([
    firecrawlScrape('https://www.workatastartup.com/jobs'),
    firecrawlScrape('https://www.ycombinator.com/jobs')
  ]);

  const parsed = [...parseWorkAtStartup(workAtStartupMd), ...parseYCJobs(ycJobsMd)];

  const filtered = parsed
    .filter((x) => x.days_ago <= 60)
    .filter((x) => parseBatchYear(x.batch) >= 2022)
    .filter((x) => !BIG_COMPANY_RE.test(`${x.company_name} ${x.company_summary}`))
    .sort((a, b) => a.days_ago - b.days_ago);

  const unique = new Map();
  for (const row of filtered) {
    const key = `${row.company_name.toLowerCase()}::${row.role_title.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, row);
  }

  const selected = [...unique.values()].slice(0, 25).map((lead) => ({
    ...lead,
    tier: 'hot',
    score: 4,
    dm_text: dmForFirecrawlLead(lead)
  }));

  return selected;
}

async function main() {
  const linkedin = await buildLinkedinCommentLeads();
  const firecrawl = await buildFirecrawlHiringLeads();

  const result = {
    generated_at: nowIso,
    parameters: {
      linkedin_queries: LINKEDIN_QUERIES,
      linkedin_target: 25,
      firecrawl_target: 25,
      company_preference: 'startup/smaller/newer',
      filters: {
        linkedin_hot_score_min: 4,
        firecrawl_days_ago_max: 30,
        firecrawl_batch_year_min: 2023,
        excluded_big_companies: true
      }
    },
    linkedin_hot_leads: linkedin.selected,
    firecrawl_hiring_leads: firecrawl,
    top_source_posts: linkedin.topPosts
  };

  await fs.writeFile('screening-pilot-pipeline/output/requested_50_leads.json', JSON.stringify(result, null, 2));

  const csvRows = [];
  csvRows.push('group,company,contact_name,contact_title,profile_or_company_url,job_or_post_url,score,tier,signal,dm_text');
  for (const l of result.linkedin_hot_leads) {
    csvRows.push([
      'linkedin_comment_hot',
      (l.commenter_company || '').replaceAll(',', ' '),
      (l.commenter_name || '').replaceAll(',', ' '),
      (l.commenter_title || '').replaceAll(',', ' '),
      (l.commenter_profile_url || '').replaceAll(',', ' '),
      (l.source_post_url || '').replaceAll(',', ' '),
      l.score,
      l.tier,
      compact(l.comment_excerpt || '', 120).replaceAll(',', ' '),
      (l.dm_text || '').replaceAll(',', ' ')
    ].join(','));
  }
  for (const l of result.firecrawl_hiring_leads) {
    csvRows.push([
      'firecrawl_hiring_hot',
      (l.company_name || '').replaceAll(',', ' '),
      '',
      (l.role_title || '').replaceAll(',', ' '),
      (l.company_url || '').replaceAll(',', ' '),
      (l.job_url || '').replaceAll(',', ' '),
      l.score,
      l.tier,
      `${l.batch} ${l.age_raw}`.replaceAll(',', ' '),
      (l.dm_text || '').replaceAll(',', ' ')
    ].join(','));
  }
  await fs.writeFile('screening-pilot-pipeline/output/requested_50_leads.csv', csvRows.join('\n'));

  console.log(`LinkedIn hot leads: ${result.linkedin_hot_leads.length}`);
  console.log(`Firecrawl hiring leads: ${result.firecrawl_hiring_leads.length}`);
  console.log('Output JSON: screening-pilot-pipeline/output/requested_50_leads.json');
  console.log('Output CSV: screening-pilot-pipeline/output/requested_50_leads.csv');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
