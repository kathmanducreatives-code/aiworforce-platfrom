import fs from 'node:fs/promises';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
if (!FIRECRAWL_API_KEY) throw new Error('Missing FIRECRAWL_API_KEY');

const OUT_JSON = 'screening-pilot-pipeline/output/live_board_shortlist.json';
const OUT_CSV = 'screening-pilot-pipeline/output/live_board_shortlist.csv';

const TECH_ROLE_RE = /\b(founding|software|backend|frontend|full stack|full-stack|ai|ml|machine learning|product engineer|product designer|designer|data)\b/i;
const BIG_COMPANY_RE = /\b(amazon|microsoft|google|meta|oracle|salesforce|ibm|accenture|infosys|cognizant|tcs|deloitte|capgemini)\b/i;

const compact = (value, max = 180) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
};

const asJson = async (res) => {
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
};

const firecrawlScrape = async (url) => {
  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
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

const parseDaysAgo = (raw) => {
  const text = String(raw || '').toLowerCase();
  if (/hour|minute|today/.test(text)) return 0;
  const day = text.match(/(\d+)\s*day/);
  if (day) return Number(day[1]);
  const week = text.match(/(\d+)\s*week/);
  if (week) return Number(week[1]) * 7;
  const month = text.match(/(\d+)\s*month/);
  if (month) return Number(month[1]) * 30;
  return 999;
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
    const match = line.match(/^\[(.+?)\s*\(([SWF]\d{2})\)•(.+?)\(([^)]+ago)\)\]\((https:\/\/www\.ycombinator\.com\/companies\/[^)]+)\)\s+\[(.+?)\]\((https:\/\/www\.ycombinator\.com\/companies\/[^)]+\/jobs\/[^)]+)\)$/i);
    if (!match) continue;

    const [, companyName, batch, companySummary, ageRaw, companyUrl, roleTitle, jobUrl] = match;
    leads.push({
      board: 'yc-jobs',
      company_name: companyName.trim(),
      batch,
      company_summary: companySummary.trim(),
      age_raw: ageRaw.trim(),
      days_ago: parseDaysAgo(ageRaw),
      company_url: companyUrl.trim(),
      role_title: roleTitle.trim(),
      job_url: jobUrl.trim()
    });
  }

  return leads;
};

const scoreBoardLead = (lead) => {
  let score = 0;
  if (/yc|workatastartup/i.test(lead.board)) score += 3;
  if (lead.days_ago <= 14) score += 3;
  if (/founding|staff|senior|lead|principal/i.test(lead.role_title) || TECH_ROLE_RE.test(lead.role_title)) score += 2;
  if (/\b(S|W|F)\d{2}\b/i.test(lead.batch)) score += 2;
  return score;
};

async function main() {
  const [waasMd, ycMd] = await Promise.all([
    firecrawlScrape('https://www.workatastartup.com/jobs'),
    firecrawlScrape('https://www.ycombinator.com/jobs')
  ]);

  const rows = [...parseWorkAtStartup(waasMd), ...parseYCJobs(ycMd)];
  const unique = new Map();

  for (const row of rows) {
    if (row.days_ago > 30) continue;
    if (!TECH_ROLE_RE.test(row.role_title)) continue;
    if (BIG_COMPANY_RE.test(`${row.company_name} ${row.company_summary}`)) continue;

    const score = scoreBoardLead(row);
    if (score < 8) continue;

    const key = `${row.company_name.toLowerCase()}::${row.role_title.toLowerCase()}`;
    if (!unique.has(key)) {
      unique.set(key, {
        ...row,
        score,
        source_channel: 'job_board',
        signal_summary: `${row.role_title} posted ${row.age_raw} (${row.batch})`
      });
    }
  }

  const leads = [...unique.values()]
    .sort((a, b) => a.days_ago - b.days_ago || b.score - a.score)
    .slice(0, 15);

  const out = {
    generated_at: new Date().toISOString(),
    source: ['ycombinator_jobs', 'workatastartup_jobs'],
    count: leads.length,
    leads
  };

  const csvRows = [
    'rank,company_name,role_title,batch,days_ago,company_url,job_url,score,signal_summary'
  ];

  leads.forEach((lead, index) => {
    csvRows.push([
      index + 1,
      (lead.company_name || '').replaceAll(',', ' '),
      (lead.role_title || '').replaceAll(',', ' '),
      (lead.batch || '').replaceAll(',', ' '),
      lead.days_ago,
      (lead.company_url || '').replaceAll(',', ' '),
      (lead.job_url || '').replaceAll(',', ' '),
      lead.score,
      (compact(lead.signal_summary, 120) || '').replaceAll(',', ' ')
    ].join(','));
  });

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2));
  await fs.writeFile(OUT_CSV, csvRows.join('\n'));

  console.log(`Live board leads: ${leads.length}`);
  console.log(`Output JSON: ${OUT_JSON}`);
  console.log(`Output CSV: ${OUT_CSV}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
