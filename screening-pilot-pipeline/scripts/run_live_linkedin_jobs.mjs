import fs from 'node:fs/promises';

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
if (!APIFY_TOKEN) throw new Error('Missing APIFY_API_TOKEN');

const OUT_JSON = 'screening-pilot-pipeline/output/live_linkedin_jobs.json';
const OUT_CSV = 'screening-pilot-pipeline/output/live_linkedin_jobs.csv';

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

const TECH_ROLE_RE = /\b(founding|software|backend|frontend|full stack|full-stack|ai|ml|machine learning|product engineer|product designer|designer|data)\b/i;
const RECRUITER_RE = /\b(recruiter|staffing|agency|headhunter|career coach|consultant)\b/i;
const BIG_COMPANY_RE = /\b(amazon|microsoft|google|meta|oracle|salesforce|ibm|accenture|infosys|cognizant|tcs|deloitte|capgemini)\b/i;

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

  if (!runId) throw new Error('Apify actor did not return a run id');

  while (status === 'RUNNING' || status === 'READY') {
    await sleep(2500);
    const statusRes = await fetchWithRetries(`${base}/actor-runs/${runId}?token=${encodeURIComponent(APIFY_TOKEN)}`);
    const statusJson = await asJson(statusRes);
    status = statusJson?.data?.status || status;
    datasetId = statusJson?.data?.defaultDatasetId || datasetId;
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
      throw new Error(`Apify actor ended with status ${status}`);
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

const likelyStartup = (company, text = '') => {
  const combined = `${company || ''} ${text || ''}`.toLowerCase();
  if (!combined.trim()) return false;
  if (BIG_COMPANY_RE.test(combined)) return false;
  if (RECRUITER_RE.test(combined)) return false;
  return /\b(startup|seed|series a|series b|yc|founding|small team|runway|venture|saas|ai|developer tools|infra|security|data)\b/i.test(combined);
};

const scoreJobLead = (job) => {
  const role = String(job.title || '');
  const companyName = String(job.company?.name || '');
  const companyDescription = String(job.company?.description || '');
  const recencyDays = daysSinceIso(job.postedDate);
  const companySize = Number(job.company?.employeeCountRange?.end || 0);
  const applicants = Number(job.applicants || 0);

  let score = 0;
  if (/founding|staff|principal|lead|senior/i.test(role) || TECH_ROLE_RE.test(role)) score += 3;
  if (recencyDays <= 7) score += 3;
  if (applicants > 0 && applicants < 10) score += 2;
  if (companySize > 0 && companySize <= 200) score += 2;
  if (likelyStartup(companyName, companyDescription)) score += 2;

  return { score, recencyDays, companySize, applicants };
};

async function main() {
  const rows = await runApifyActor('harvestapi/linkedin-job-search', {
    jobTitles: JOB_TITLES,
    locations: ['United States'],
    sortBy: 'date',
    employmentType: ['full-time'],
    postedLimit: 'week',
    maxItems: 96
  });

  const leads = [];
  for (const row of rows || []) {
    const title = row?.title || '';
    const companyName = row?.company?.name || '';
    const companyDescription = row?.company?.description || '';
    const evidenceUrl = row?.linkedinUrl || row?.applyMethod?.companyApplyUrl || '';

    if (!title || !companyName || !evidenceUrl) continue;
    if (!TECH_ROLE_RE.test(title)) continue;
    if (RECRUITER_RE.test(`${companyName} ${companyDescription}`)) continue;

    const scored = scoreJobLead(row);
    if (!(scored.companySize > 0 && scored.companySize <= 200) && !likelyStartup(companyName, companyDescription)) continue;
    if (scored.score < 8) continue;

    leads.push({
      company_name: companyName,
      role_title: title,
      company_url: row?.company?.linkedinUrl || '',
      evidence_url: evidenceUrl,
      recency_days: scored.recencyDays,
      applicants: scored.applicants,
      score: scored.score,
      signal_summary: `${title} posted ${scored.recencyDays}d ago${scored.applicants > 0 ? `, ${scored.applicants} applicants` : ''}`
    });
  }

  const unique = new Map();
  for (const lead of leads.sort((a, b) => b.score - a.score || a.recency_days - b.recency_days)) {
    const key = `${lead.company_name.toLowerCase()}::${lead.role_title.toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, lead);
  }

  const ranked = [...unique.values()].slice(0, 15);
  const out = {
    generated_at: new Date().toISOString(),
    count: ranked.length,
    leads: ranked
  };

  const csvRows = ['rank,company_name,role_title,recency_days,applicants,company_url,evidence_url,score,signal_summary'];
  ranked.forEach((lead, index) => {
    csvRows.push([
      index + 1,
      (lead.company_name || '').replaceAll(',', ' '),
      (lead.role_title || '').replaceAll(',', ' '),
      lead.recency_days,
      lead.applicants,
      (lead.company_url || '').replaceAll(',', ' '),
      (lead.evidence_url || '').replaceAll(',', ' '),
      lead.score,
      (lead.signal_summary || '').replaceAll(',', ' ')
    ].join(','));
  });

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2));
  await fs.writeFile(OUT_CSV, csvRows.join('\n'));

  console.log(`Live LinkedIn job leads: ${ranked.length}`);
  console.log(`Output JSON: ${OUT_JSON}`);
  console.log(`Output CSV: ${OUT_CSV}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
