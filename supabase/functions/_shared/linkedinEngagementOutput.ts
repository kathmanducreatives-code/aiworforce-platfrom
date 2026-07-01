// Phase 3 — output normalizer for the LinkedIn Posts / Engagement actor.
// Maps raw actor items into Agentory's linkedin_engagement shape. Never invents
// missing fields (null instead) and never fabricates email/phone. Pure /
// import-free so it is unit-testable in Node + Deno.

import { matchCompetitors } from "./competitorRegistry.ts";
import { classifyConversationType } from "./competitorDiscovery.ts";

export interface LinkedinEngagementItem {
  type: "linkedin_engagement";
  post_url: string | null;
  post_text: string | null;
  post_author_name: string | null;
  post_author_title: string | null;
  post_author_company: string | null;
  post_author_profile_url: string | null;
  post_date: string | null;
  commenter_name: string | null;
  commenter_profile_url: string | null;
  engagement_type: string | null;
  topic: string | null;
  signal_reason: string | null;
  source: "apify_linkedin_posts";
  // Phase 4 — competitor tag (for Workbench + memory hint). null when none.
  competitor_key: string | null;
  competitor_name: string | null;
  competitor_category: string | null;
  matched_terms: string[];
  conversation_type: string | null;
  raw: unknown;
}

function pick(obj: any, keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    // support nested author/commenter objects, e.g. author.name
    if (v && typeof v === "object") {
      for (const nk of ["name", "fullName", "full_name", "title", "headline", "url", "profileUrl", "profile_url"]) {
        const nv = (v as any)[nk];
        if (typeof nv === "string" && nv.trim()) return nv.trim();
      }
    }
  }
  return null;
}

function truncRaw(v: unknown, max = 4000): unknown {
  try {
    const s = JSON.stringify(v);
    if (s.length <= max) return v;
    return { _truncated: true, preview: s.slice(0, max) };
  } catch {
    return { _unserializable: true };
  }
}

export function normalizeLinkedinEngagementItem(raw: any, topic?: string | null): LinkedinEngagementItem {
  const r = raw && typeof raw === "object" ? raw : {};
  const author = (r.author && typeof r.author === "object") ? r.author : r;
  const commenter = (r.commenter && typeof r.commenter === "object") ? r.commenter : null;

  const post_text = pick(r, ["postText", "text", "content", "post_text", "description", "snippet"]);
  const post_author_name = pick(author, ["authorName", "name", "fullName", "full_name", "author_name"]);
  // HarvestAPI post-search puts the author headline in `author.info`.
  const post_author_title = pick(author, ["authorTitle", "headline", "title", "occupation", "subtitle", "info"]);
  const post_author_company = pick(author, ["authorCompany", "company", "companyName", "organization", "employer"]);
  // Post date — HarvestAPI: postedAt.date ; others: date / postedAtISO / postedAt (string).
  const postedAtObj = (r.postedAt && typeof r.postedAt === "object") ? r.postedAt : null;
  const post_date = pick(postedAtObj ?? r, ["date", "postedAtISO", "postedAt", "postDate", "post_date", "publishedAt", "time", "timestamp"]);

  const engagement_type = pick(r, ["engagementType", "engagement_type", "reactionType", "type", "interaction"])
    ?? (commenter ? "comment" : "post");

  // Phase 4 — competitor tag from the post content.
  const comps = matchCompetitors(`${post_text ?? ""} ${topic ?? ""} ${post_author_name ?? ""} ${post_author_company ?? ""}`);
  const comp = comps[0] ?? null;

  return {
    type: "linkedin_engagement",
    competitor_key: comp?.key ?? null,
    competitor_name: comp?.name ?? null,
    competitor_category: comp?.category ?? null,
    matched_terms: comp?.matched_terms ?? [],
    conversation_type: post_text ? classifyConversationType(post_text) : null,
    // HarvestAPI post-search returns the post URL as `linkedinUrl` (top level).
    post_url: pick(r, ["postUrl", "url", "link", "post_url", "permalink", "sourceUrl", "linkedinUrl", "postLink"]),
    post_text,
    post_author_name,
    post_author_title,
    post_author_company,
    post_author_profile_url: pick(author, ["authorProfileUrl", "profileUrl", "profile_url", "authorUrl", "linkedinUrl", "url"]),
    post_date,
    // The api-empire comments actor returns each COMMENT as an item whose
    // `author` is the commenter and `postUrl` is the source post — so fall back
    // to author.* for the commenter when there's no explicit commenter object.
    commenter_name: commenter ? pick(commenter, ["name", "fullName", "full_name"]) : (pick(r, ["commenterName", "commenter_name"]) ?? (r.author && typeof r.author === "object" ? pick(r.author, ["name", "fullName", "full_name"]) : null)),
    commenter_profile_url: commenter ? pick(commenter, ["profileUrl", "profile_url", "url", "linkedinUrl"]) : (pick(r, ["commenterProfileUrl", "commenter_profile_url"]) ?? (r.author && typeof r.author === "object" ? pick(r.author, ["profile_url", "profileUrl", "url", "linkedinUrl"]) : null)),
    engagement_type,
    topic: (typeof topic === "string" && topic.trim()) ? topic.trim() : pick(r, ["topic", "keyword", "matchedTopic"]),
    signal_reason: pick(r, ["signalReason", "signal_reason", "reason"])
      ?? (post_text ? `Engaged on a post about ${topic?.trim() || "a relevant GTM topic"}` : null),
    source: "apify_linkedin_posts",
    raw: truncRaw(r),
  };
}

export function normalizeLinkedinEngagementItems(items: unknown, topic?: string | null): LinkedinEngagementItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((it) => normalizeLinkedinEngagementItem(it, topic));
}
