import fs from 'node:fs/promises';

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
if (!APIFY_TOKEN) throw new Error('Missing APIFY_API_TOKEN');

const OUT_CSV = 'screening-pilot-pipeline/output/post_comments_pain_only.csv';
const OUT_JSON = 'screening-pilot-pipeline/output/post_comments_pain_only.json';
const START = '2026-03-09T00:00:00Z';

const painRules = [
  { tag: 'agency_fee_cost', re: /\bagency\b|\bfees?\b|commission|expensive|cost\s+per\s+hire|markup/i },
  { tag: 'hiring_difficulty', re: /\bhiring\b|hire|talent|candidate|recruit(ing|ment)?|no\s+hires|can\'?t\s+find/i },
  { tag: 'process_breakdown', re: /slow|painful|frustrat|nightmare|waste|broken\s+process|posting\s+and\s+praying/i },
  { tag: 'quality_mismatch', re: /bad\s+hire|wrong\s+fit|alignment|role\s+clarity|decision\s+ownership/i }
];

const praiseOnlyRe = /^(great post|great share|love this|well said|spot on|so true|agree|100%|thanks for sharing|amazing|excellent|nice post|brilliant|👏+|🔥+|💯|🙌|🙏|❤️|👍)\W*$/i;
const praiseGeneralRe = /\b(great post|thanks for sharing|well said|love this|nice post|excellent|brilliant|awesome|agree)\b/i;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const jsonReq = async (url, retries = 3) => {
  let lastErr = null;
  for (let i = 0; i <= retries; i += 1) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 300)}`);
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

const getInput = async (kvsId) => {
  if (!kvsId) return {};
  const url = `https://api.apify.com/v2/key-value-stores/${kvsId}/records/INPUT?token=${encodeURIComponent(APIFY_TOKEN)}`;
  try { return await jsonReq(url); } catch { return {}; }
};

const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();

const detectPainTags = (text) => {
  const tags = painRules.filter(r => r.re.test(text)).map(r => r.tag);
  return [...new Set(tags)];
};

const isPraiseOnly = (text) => {
  const t = normalize(text);
  if (!t) return true;
  if (praiseOnlyRe.test(t)) return true;

  const tags = detectPainTags(t);
  if (tags.length > 0) return false;

  // If mostly praise language and no pain keywords, skip
  if (praiseGeneralRe.test(t)) return true;
  if (t.length <= 30 && /^(yes|true|agreed|exactly|facts)[!. ]*$/i.test(t)) return true;
  return false;
};

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
  // Build post metadata from today's post-search runs
  const postRuns = await listRuns('harvestapi/linkedin-post-search');
  const postByUrl = new Map();
  for (const run of postRuns) {
    if (!run.defaultDatasetId) continue;
    const items = await getDatasetItems(run.defaultDatasetId);
    for (const p of items || []) {
      const url = p.linkedinUrl || '';
      if (!url) continue;
      if (!postByUrl.has(url)) {
        postByUrl.set(url, {
          post_url: url,
          post_id: getPostId(url),
          post_author: p?.author?.name || '',
          post_text: normalize(p.content || ''),
          post_engagement: engagementOfPost(p)
        });
      }
    }
  }

  // Parse comments with run input mapping to source post URL
  const commentRuns = await listRuns('harvestapi/linkedin-post-comments');
  const rows = [];

  for (const run of commentRuns) {
    if (!run.defaultDatasetId) continue;
    const input = await getInput(run.defaultKeyValueStoreId);
    const inputPosts = Array.isArray(input?.posts) ? input.posts : [];
    const sourcePostUrl = inputPosts[0] || '';
    const sourcePostId = getPostId(sourcePostUrl);

    const comments = await getDatasetItems(run.defaultDatasetId);
    for (const c of comments || []) {
      const commentText = normalize(c.commentary || c.text || '');
      if (!commentText) continue;
      if (isPraiseOnly(commentText)) continue;

      const painTags = detectPainTags(commentText);
      if (painTags.length === 0) continue;

      const commentUrl = c.linkedinUrl || '';
      const actorName = c?.actor?.name || '';
      const actorTitle = normalize(c?.actor?.position || '');
      const actorLinkedIn = c?.actor?.linkedinUrl || '';
      const pId = String(c.postId || sourcePostId || '');

      // Try matching post url by id fallback
      let post = postByUrl.get(sourcePostUrl);
      if (!post && pId) {
        for (const p of postByUrl.values()) {
          if (p.post_id && p.post_id === pId) { post = p; break; }
        }
      }

      rows.push({
        post_url: post?.post_url || sourcePostUrl || '',
        post_author: post?.post_author || '',
        post_engagement: post?.post_engagement ?? '',
        post_content_excerpt: (post?.post_text || '').slice(0, 600),
        commenter_name: actorName,
        commenter_title: actorTitle,
        commenter_linkedin: actorLinkedIn,
        comment_url: commentUrl,
        comment_text: commentText,
        comment_engagement: commentEngagement(c),
        pain_tags: painTags.join('|'),
        created_at: c.createdAt || ''
      });
    }
  }

  // Deduplicate strict
  const uniq = new Map();
  for (const r of rows) {
    const key = `${r.post_url}::${r.commenter_name.toLowerCase()}::${r.comment_text.toLowerCase()}`;
    if (!uniq.has(key)) uniq.set(key, r);
  }

  // Keep "main" comments: top 4 pain comments per post by engagement then length
  const grouped = new Map();
  for (const r of uniq.values()) {
    const k = r.post_url || 'unknown';
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(r);
  }

  const finalRows = [];
  for (const [_, arr] of grouped) {
    arr.sort((a, b) => {
      if (b.comment_engagement !== a.comment_engagement) return b.comment_engagement - a.comment_engagement;
      return b.comment_text.length - a.comment_text.length;
    });
    finalRows.push(...arr.slice(0, 4));
  }

  // sort posts by post engagement desc then comment engagement
  finalRows.sort((a, b) => {
    const peA = Number(a.post_engagement || 0);
    const peB = Number(b.post_engagement || 0);
    if (peB !== peA) return peB - peA;
    return b.comment_engagement - a.comment_engagement;
  });

  // Write outputs
  await fs.writeFile(OUT_JSON, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: 'Apify post-search + post-comments only',
    notes: 'Pain-point comments only, praise-only excluded, deduped, top 4 comments per post',
    total_rows: finalRows.length,
    unique_posts: [...new Set(finalRows.map(r => r.post_url))].length,
    rows: finalRows
  }, null, 2));

  const esc = (v) => `"${String(v ?? '').replaceAll('"','""').replace(/\n/g, ' ')}"`;
  const csv = [
    'post_url,post_author,post_engagement,post_content_excerpt,commenter_name,commenter_title,commenter_linkedin,comment_url,comment_engagement,pain_tags,comment_text,created_at'
  ];
  for (const r of finalRows) {
    csv.push([
      esc(r.post_url),
      esc(r.post_author),
      esc(r.post_engagement),
      esc(r.post_content_excerpt),
      esc(r.commenter_name),
      esc(r.commenter_title),
      esc(r.commenter_linkedin),
      esc(r.comment_url),
      esc(r.comment_engagement),
      esc(r.pain_tags),
      esc(r.comment_text),
      esc(r.created_at)
    ].join(','));
  }
  await fs.writeFile(OUT_CSV, csv.join('\n'));

  console.log(`post runs analyzed: ${postRuns.length}`);
  console.log(`comment runs analyzed: ${commentRuns.length}`);
  console.log(`final rows: ${finalRows.length}`);
  console.log(`unique posts: ${[...new Set(finalRows.map(r => r.post_url))].length}`);
  console.log(`csv: ${OUT_CSV}`);
}

main().catch(err => { console.error(err); process.exit(1); });
