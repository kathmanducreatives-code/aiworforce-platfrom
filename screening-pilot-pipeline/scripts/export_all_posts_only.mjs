import fs from 'node:fs/promises';

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
if (!APIFY_TOKEN) throw new Error('Missing APIFY_API_TOKEN');

const START = '2026-03-09T00:00:00Z';
const OUT = 'screening-pilot-pipeline/output/post_search_raw_full.csv';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const jsonReq = async (url, retries = 4) => {
  let lastErr = null;
  for (let i = 0; i <= retries; i += 1) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0,200)}`);
      return text ? JSON.parse(text) : null;
    } catch (err) {
      lastErr = err;
      if (i < retries) await sleep(500 * (i + 1));
    }
  }
  throw lastErr;
};

const listRuns = async (actor) => {
  const url = `https://api.apify.com/v2/acts/${actor.replace('/', '~')}/runs?token=${encodeURIComponent(APIFY_TOKEN)}&desc=1&limit=200`;
  const data = await jsonReq(url);
  return (data?.data?.items || []).filter(r => r.status === 'SUCCEEDED' && r.startedAt >= START);
};

const getDatasetItems = async (datasetId) => {
  const out = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${encodeURIComponent(APIFY_TOKEN)}&clean=true&limit=${limit}&offset=${offset}`;
    const page = await jsonReq(url, 4);
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return out;
};

const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();

const engagementOfPost = (p) => {
  const e = p?.engagement || {};
  return Number(e.likes || 0) + Number(e.comments || 0) + Number(e.shares || 0);
};

async function main() {
  const runs = await listRuns('harvestapi/linkedin-post-search');
  const posts = [];
  for (const run of runs) {
    if (!run.defaultDatasetId) continue;
    const items = await getDatasetItems(run.defaultDatasetId);
    for (const p of items || []) {
      posts.push({
        post_url: p.linkedinUrl || '',
        post_id: p.postId || '',
        post_author: p?.author?.name || '',
        post_text: normalize(p.content || ''),
        post_engagement: engagementOfPost(p),
        run_id: run.id,
        run_started_at: run.startedAt,
      });
    }
  }

  const esc = (v) => `"${String(v ?? '').replaceAll('"','""').replace(/\n/g,' ')}"`;
  const header = ['post_url','post_id','post_author','post_engagement','post_text','run_id','run_started_at'];
  const lines = [header.join(',')];
  for (const p of posts) {
    lines.push([esc(p.post_url), esc(p.post_id), esc(p.post_author), esc(p.post_engagement), esc(p.post_text), esc(p.run_id), esc(p.run_started_at)].join(','));
  }
  await fs.writeFile(OUT, lines.join('\n'));
  console.log(`wrote ${posts.length} posts to ${OUT}`);
}

main().catch(err => { console.error(err); process.exit(1); });
