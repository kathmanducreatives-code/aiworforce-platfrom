import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
if (!APIFY_TOKEN) throw new Error('Missing APIFY_API_TOKEN');

const START = '2026-03-09T00:00:00Z';
const OUT = 'screening-pilot-pipeline/output/post_comments_raw_full.csv';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const jsonReq = async (url, retries = 4) => {
  let lastErr = null;
  for (let i = 0; i <= retries; i += 1) {
    const controller = new AbortController();
    const timeout = delay(15000).then(() => controller.abort());
    try {
      const res = await fetch(url, { signal: controller.signal });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : null;
    } catch (err) {
      lastErr = err;
      if (i < retries) await sleep(500 * (i + 1));
    } finally {
      controller.abort();
    }
  }
  throw lastErr;
};

const listRuns = async (actor) => {
  const url = `https://api.apify.com/v2/acts/${actor.replace('/', '~')}/runs?token=${encodeURIComponent(APIFY_TOKEN)}&desc=1&limit=200`;
  const data = await jsonReq(url);
  return (data?.data?.items || []).filter(r => r.status === 'SUCCEEDED' && r.startedAt >= START);
};

const getDatasetItems = async (datasetId, label) => {
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
  console.log(`  fetched ${out.length} items from dataset ${datasetId} (${label})`);
  return out;
};

const getInput = async (kvsId) => {
  if (!kvsId) return {};
  const url = `https://api.apify.com/v2/key-value-stores/${kvsId}/records/INPUT?token=${encodeURIComponent(APIFY_TOKEN)}`;
  try { return await jsonReq(url); } catch { return {}; }
};

const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();

const getPostId = (postUrl='') => {
  const m1 = postUrl.match(/activity:(\d+)/i);
  if (m1) return m1[1];
  const m2 = postUrl.match(/-(\d{10,})-/);
  if (m2) return m2[1];
  return '';
};

const engagementOfPost = (p) => {
  const e = p?.engagement || {};
  return Number(e.likes || 0) + Number(e.comments || 0) + Number(e.shares || 0);
};

const commentEngagement = (c) => {
  const rtc = Array.isArray(c.reactionTypeCounts) ? c.reactionTypeCounts.reduce((a, x) => a + Number(x?.count || 0), 0) : 0;
  return rtc + Number(c.numComments || 0);
};

async function main() {
  console.log('Listing post-search runs...');
  const postRuns = await listRuns('harvestapi/linkedin-post-search');
  console.log(`  found ${postRuns.length} runs`);
  const postById = new Map();
  const postByUrl = new Map();

  for (const run of postRuns) {
    if (!run.defaultDatasetId) continue;
    const items = await getDatasetItems(run.defaultDatasetId, `post-search run ${run.id}`);
    for (const p of items || []) {
      const url = p.linkedinUrl || '';
      const pid = p.postId || getPostId(url);
      const record = {
        run_id: run.id,
        post_url: url,
        post_id: pid,
        post_author: p?.author?.name || '',
        post_text: normalize(p.content || ''),
        post_engagement: engagementOfPost(p),
        run_started_at: run.startedAt,
      };
      if (url && !postByUrl.has(url)) postByUrl.set(url, record);
      if (pid && !postById.has(pid)) postById.set(pid, record);
    }
  }

  console.log('Listing comment runs...');
  const commentRuns = await listRuns('harvestapi/linkedin-post-comments');
  console.log(`  found ${commentRuns.length} runs`);
  const rows = [];

  for (const run of commentRuns) {
    if (!run.defaultDatasetId) continue;
    const input = await getInput(run.defaultKeyValueStoreId);
    const inputPosts = Array.isArray(input?.posts) ? input.posts : [];
    const sourcePostUrl = inputPosts[0] || '';
    const sourcePostId = getPostId(sourcePostUrl);

    const comments = await getDatasetItems(run.defaultDatasetId, `comments run ${run.id}`);
    for (const c of comments || []) {
      const pid = c.postId || sourcePostId || '';
      let post = postByUrl.get(sourcePostUrl) || (pid ? postById.get(String(pid)) : null);

      rows.push({
        post_url: post?.post_url || sourcePostUrl || '',
        post_id: post?.post_id || pid || '',
        post_author: post?.post_author || '',
        post_engagement: post?.post_engagement ?? '',
        post_text: post?.post_text || '',
        post_run_id: post?.run_id || '',
        post_run_started_at: post?.run_started_at || '',
        comment_run_id: run.id,
        comment_run_started_at: run.startedAt,
        comment_text: normalize(c.commentary || c.text || ''),
        commenter_name: c?.actor?.name || '',
        commenter_title: normalize(c?.actor?.position || ''),
        commenter_linkedin: c?.actor?.linkedinUrl || '',
        comment_url: c.linkedinUrl || '',
        comment_engagement: commentEngagement(c),
        comment_created_at: c.createdAt || '',
      });
    }
  }

  console.log(`Writing ${rows.length} rows...`);
  const esc = (v) => `"${String(v ?? '').replaceAll('"','""').replace(/\n/g, ' ')}"`;
  const header = [
    'post_url','post_id','post_author','post_engagement','post_text','post_run_id','post_run_started_at',
    'comment_text','commenter_name','commenter_title','commenter_linkedin','comment_url','comment_engagement','comment_created_at','comment_run_id','comment_run_started_at'
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      esc(r.post_url), esc(r.post_id), esc(r.post_author), esc(r.post_engagement), esc(r.post_text), esc(r.post_run_id), esc(r.post_run_started_at),
      esc(r.comment_text), esc(r.commenter_name), esc(r.commenter_title), esc(r.commenter_linkedin), esc(r.comment_url), esc(r.comment_engagement), esc(r.comment_created_at), esc(r.comment_run_id), esc(r.comment_run_started_at)
    ].join(','));
  }

  await fs.writeFile(OUT, lines.join('\n'));
  console.log(`wrote ${rows.length} rows to ${OUT}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
