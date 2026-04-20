import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");
const OUTPUT_DIR = path.join(ROOT_DIR, "hot-leads-studio", "output");
const OUT_JSON = path.join(OUTPUT_DIR, "linkedin_post_hot_leads.json");
const OUT_CSV = path.join(OUTPUT_DIR, "linkedin_post_hot_leads.csv");

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;

if (!APIFY_TOKEN) {
  throw new Error("Missing APIFY_API_TOKEN");
}

const POST_QUERIES = [
  "recruiting agency fees",
  "staffing agency fees",
  "agency commissions are expensive",
  "hiring engineers is hard",
  "can't find software engineers",
  "bad candidate quality",
  "recruiting takes too long",
  "we're growing our engineering team",
];

const DECISION_MAKER_RE = /\b(founder|co-founder|ceo|cto|vp|head|director|engineering manager|recruiting lead|talent|people)\b/i;
const RECRUITER_RE = /\b(recruiter|staffing|agency|headhunter|career coach|consultant)\b/i;
const BIG_COMPANY_RE = /\b(amazon|microsoft|google|meta|oracle|salesforce|ibm|accenture|infosys|cognizant|tcs|deloitte|capgemini)\b/i;
const GENERIC_COMMENT_RE = /\b(congrats|great post|thanks for sharing|so true|love this|interesting|good luck|amazing|well said)\b/i;

const compact = (value, max = 180) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const canonicalUrl = (url) => {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return String(url || "").trim().replace(/\/+$/, "").toLowerCase();
  }
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
      if (attempt < attempts) {
        await sleep(1500 * attempt);
      }
    }
  }

  throw lastError;
};

const runApifyActor = async (actorSlug, input) => {
  const base = "https://api.apify.com/v2";
  const actorId = encodeURIComponent(actorSlug);

  const runRes = await fetchWithRetries(`${base}/acts/${actorId}/runs?token=${encodeURIComponent(APIFY_TOKEN)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  const runJson = await asJson(runRes);
  const runId = runJson?.data?.id;
  let datasetId = runJson?.data?.defaultDatasetId;
  let status = runJson?.data?.status || "RUNNING";

  if (!runId) {
    throw new Error(`Apify actor ${actorSlug} did not return a run id`);
  }

  while (status === "RUNNING" || status === "READY") {
    await sleep(2500);
    const statusRes = await fetchWithRetries(`${base}/actor-runs/${runId}?token=${encodeURIComponent(APIFY_TOKEN)}`);
    const statusJson = await asJson(statusRes);
    status = statusJson?.data?.status || status;
    datasetId = statusJson?.data?.defaultDatasetId || datasetId;

    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
      throw new Error(`Apify actor ${actorSlug} ended with status ${status}`);
    }
  }

  if (!datasetId) return [];

  const datasetRes = await fetchWithRetries(
    `${base}/datasets/${datasetId}/items?clean=true&token=${encodeURIComponent(APIFY_TOKEN)}`,
  );
  return asJson(datasetRes);
};

const engagementScore = (post) => {
  const e = post?.engagement || {};
  return Number(e.likes || post.likesCount || 0) + Number(e.comments || post.commentsCount || 0) + Number(e.shares || post.sharesCount || 0);
};

const companyFromTitle = (title) => {
  const text = String(title || "");
  const at = text.match(/\bat\s+([^|,]+)/i);
  if (at) return at[1].trim();
  const pipe = text.match(/^([^|,]+)\s*[|,-]/);
  if (pipe) return pipe[1].trim();
  return "";
};

const likelyStartup = (company, text = "") => {
  const combined = `${company || ""} ${text || ""}`.toLowerCase();
  if (!combined.trim()) return false;
  if (BIG_COMPANY_RE.test(combined)) return false;
  if (RECRUITER_RE.test(combined)) return false;

  return /\b(startup|seed|series a|series b|yc|founding|small team|runway|venture|saas|ai|developer tools|infra|security|data)\b/i.test(combined);
};

const daysSinceIso = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 999;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000)));
};

const scoreCommenter = ({ title, comment, postText, company }) => {
  const lowerTitle = String(title || "").toLowerCase();
  const lowerComment = String(comment || "").toLowerCase();
  const lowerPost = String(postText || "").toLowerCase();
  const lowerCompany = String(company || "").toLowerCase();

  const decisionMaker = DECISION_MAKER_RE.test(lowerTitle);
  const feePain = /\b(agency|staffing|fee|fees|commission|markups?)\b/.test(lowerComment + " " + lowerPost);
  const hiringPain = /\b(hiring|hire|recruit|candidate|screening|talent|interview|time to hire)\b/.test(lowerComment + " " + lowerPost);
  const frustration = /\b(frustrated|painful|slow|nightmare|waste|broken|hard)\b/.test(lowerComment);
  const startupSignal = /\b(startup|seed|series a|series b|yc|small team|runway)\b/.test(lowerComment + " " + lowerTitle + " " + lowerCompany);

  let score = 0;
  if (decisionMaker) score += 4;
  if (feePain) score += 4;
  if (hiringPain) score += 3;
  if (frustration) score += 2;
  if (startupSignal) score += 2;

  return { score, decisionMaker, feePain, hiringPain, frustration, startupSignal };
};

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const passes = [
    { postedLimit: "week", sortBy: "date", maxPosts: 4 },
    { postedLimit: "month", sortBy: "relevance", maxPosts: 4 },
  ];

  const rawPosts = [];

  for (const pass of passes) {
    const rows = await runApifyActor("harvestapi/linkedin-post-search", {
      searchQueries: POST_QUERIES,
      postedLimit: pass.postedLimit,
      sortBy: pass.sortBy,
      maxPosts: pass.maxPosts,
      scrapeComments: false,
      scrapeReactions: false,
    });

    rawPosts.push(...(rows || []));
  }

  const postMap = new Map();

  for (const row of rawPosts) {
    const postUrl = canonicalUrl(row.linkedinUrl || row.post_url || row.url);
    if (!postUrl) continue;

    const postText = String(row.content || row.post_text || row.text || "");
    const ranked = {
      post_url: postUrl,
      post_author: row.author?.name || row.post_author || row.author || "",
      post_text: postText,
      engagement_count: engagementScore(row),
      priority_score:
        (/\b(agency|fee|staffing|hiring|candidate|recruit)\b/i.test(postText) ? 5 : 0) + engagementScore(row),
    };

    if (!postMap.has(postUrl) || postMap.get(postUrl).priority_score < ranked.priority_score) {
      postMap.set(postUrl, ranked);
    }
  }

  const topPosts = [...postMap.values()]
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 8);

  const leads = [];

  for (const post of topPosts) {
    const rows = await runApifyActor("harvestapi/linkedin-post-comments", {
      posts: [post.post_url],
      maxItems: 20,
      postedLimit: "month",
      profileScraperMode: "main",
      scrapeReplies: false,
    });

    for (const row of rows || []) {
      const title = row?.actor?.position || row?.headline || "";
      const name = row?.actor?.name || row?.authorName || "";
      const profileUrl = canonicalUrl(row?.actor?.linkedinUrl || row?.profileUrl || row?.authorUrl || "");
      const commentText = String(row?.commentary || row?.comment || row?.text || "");
      const companyGuess = companyFromTitle(title);
      const recencyDays = daysSinceIso(row?.createdAt || row?.postedAt || row?.time || "");

      if (!profileUrl) continue;
      if (!DECISION_MAKER_RE.test(title)) continue;
      if (RECRUITER_RE.test(title)) continue;
      if (GENERIC_COMMENT_RE.test(commentText) || compact(commentText).length < 30) continue;
      if (companyGuess && !likelyStartup(companyGuess, `${title} ${commentText}`)) continue;

      const scored = scoreCommenter({ title, comment: commentText, postText: post.post_text, company: companyGuess });
      if (scored.score < 8) continue;

      leads.push({
        source_channel: "linkedin",
        source_subtype: "post_comment",
        company_name: companyGuess || "",
        contact_name: name,
        contact_title: title,
        contact_linkedin_url: profileUrl,
        evidence_url: post.post_url,
        evidence_excerpt: compact(commentText, 220),
        signal_summary: scored.feePain
          ? "Commented on agency fee or staffing pain"
          : "Commented on hiring or screening pain",
        recency_days: recencyDays,
        score: scored.score,
        tier: "hot",
        post_author: post.post_author,
      });
    }
  }

  const unique = new Map();
  for (const lead of leads.sort((a, b) => b.score - a.score)) {
    const key = `${lead.contact_linkedin_url}::${lead.evidence_url}`;
    if (!unique.has(key)) unique.set(key, lead);
  }

  const finalLeads = [...unique.values()].slice(0, 25);

  const output = {
    generated_at: new Date().toISOString(),
    strategy: {
      source: "Apify LinkedIn post search + post comments",
      query_count: POST_QUERIES.length,
      post_passes: passes,
    },
    counts: {
      raw_posts: rawPosts.length,
      shortlisted_posts: topPosts.length,
      final_hot_leads: finalLeads.length,
    },
    leads: finalLeads,
  };

  const csvRows = [
    "rank,company_name,contact_name,contact_title,contact_linkedin_url,evidence_url,score,recency_days,signal_summary,evidence_excerpt,post_author",
  ];

  finalLeads.forEach((lead, index) => {
    csvRows.push(
      [
        index + 1,
        lead.company_name,
        lead.contact_name,
        lead.contact_title,
        lead.contact_linkedin_url,
        lead.evidence_url,
        lead.score,
        lead.recency_days,
        lead.signal_summary,
        lead.evidence_excerpt,
        lead.post_author,
      ]
        .map((value) => `"${String(value ?? "").replaceAll('"', '""').replace(/\n/g, " ")}"`)
        .join(","),
    );
  });

  await fs.writeFile(OUT_JSON, JSON.stringify(output, null, 2));
  await fs.writeFile(OUT_CSV, csvRows.join("\n"));

  console.log(`Shortlisted posts: ${topPosts.length}`);
  console.log(`Final hot leads: ${finalLeads.length}`);
  console.log(`JSON: ${OUT_JSON}`);
  console.log(`CSV: ${OUT_CSV}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
