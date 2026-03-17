import crypto from "node:crypto";
import type { Commenter, LinkedinPost, OutreachLead } from "../types/lead.js";
import type { PipelineEnv } from "../utils/env.js";
import { runApifyActor } from "../utils/apify.js";
import { toIsoNow } from "../utils/http.js";

const QUERIES = [
  "recruiting agency fees",
  "hiring engineers is hard",
  "we're growing our team",
  "just hired via agency"
];

function parsePost(raw: Record<string, unknown>): LinkedinPost {
  return {
    post_url: String(raw.post_url || raw.postUrl || raw.url || ""),
    post_author: String(raw.post_author || raw.author || raw.authorName || ""),
    post_text: String(raw.post_text || raw.text || raw.content || ""),
    engagement_count: Number(raw.engagement_count || raw.likesCount || 0) + Number(raw.commentsCount || 0)
  };
}

function parseCommenter(raw: Record<string, unknown>, sourcePostUrl: string): Commenter {
  return {
    commenter_name: String(raw.commenter_name || raw.authorName || raw.name || ""),
    commenter_title: String(raw.commenter_title || raw.headline || raw.title || ""),
    commenter_profile_url: String(raw.commenter_profile_url || raw.profileUrl || raw.authorUrl || ""),
    comment_text: String(raw.comment_text || raw.text || raw.comment || ""),
    commenter_company: String(raw.commenter_company || raw.company || ""),
    source_post_url: sourcePostUrl
  };
}

export function scoreCommenter(commenter: Commenter): number {
  let score = 0;
  const title = commenter.commenter_title.toLowerCase();
  const comment = commenter.comment_text.toLowerCase();

  const isDecisionMaker = /ceo|cto|founder|vp|head of|director/.test(title);
  const hasBuyingSignal = /cost|agency|fees|expensive|commission/.test(comment);
  const hasHiringSignal = /hiring|talent|recruit|team|candidate/.test(comment);
  const isFrustrated = /frustrated|painful|slow|nightmare|waste/.test(comment);
  const isRecruiter = /recruiter|talent acquisition|headhunter|staffing/.test(title);

  if (isDecisionMaker) score += 3;
  if (hasBuyingSignal) score += 3;
  if (hasHiringSignal) score += 2;
  if (isFrustrated) score += 1;
  if (isRecruiter) score -= 5;

  return score;
}

const tierFromScore = (score: number): "hot" | "warm" | "skip" => {
  if (score >= 4) return "hot";
  if (score >= 2) return "warm";
  return "skip";
};

export async function scrapeAndScoreLinkedInCommenters(env: PipelineEnv): Promise<OutreachLead[]> {
  console.log("[Stage 2] Scraping LinkedIn posts/comments via Apify...");
  if (!env.apifyPostSearchActorId) {
    console.warn("[Stage 2] APIFY_LINKEDIN_POST_SEARCH_ACTOR_ID missing; skipping LinkedIn scraping stage.");
    return [];
  }

  const posts: LinkedinPost[] = [];

  for (const query of QUERIES) {
    try {
      const rawPosts = await runApifyActor<Record<string, unknown>>({
        token: env.apifyToken,
        actorId: env.apifyPostSearchActorId,
        input: {
          query,
          sort: "engagement",
          limit: 10
        }
      });

      posts.push(...rawPosts.map(parsePost).filter(p => p.post_url));
    } catch (error) {
      console.error(`[Stage 2] Query failed (${query}):`, error);
    }
  }

  const topPosts = posts
    .sort((a, b) => b.engagement_count - a.engagement_count)
    .slice(0, 10);

  const leads: OutreachLead[] = [];

  for (const post of topPosts) {
    try {
      const rawComments = await runApifyActor<Record<string, unknown>>({
        token: env.apifyToken,
        actorId: env.apifyPostCommentsActorId,
        input: {
          postUrl: post.post_url
        }
      });

      for (const raw of rawComments) {
        const commenter = parseCommenter(raw, post.post_url);
        const score = scoreCommenter(commenter);
        const tier = tierFromScore(score);

        if (tier === "skip") continue;

        leads.push({
          id: crypto.randomUUID(),
          source: "linkedin_comment",
          company_name: commenter.commenter_company || "Unknown",
          contact_name: commenter.commenter_name,
          contact_title: commenter.commenter_title,
          contact_linkedin_url: commenter.commenter_profile_url,
          company_url: "",
          score,
          tier,
          pain_point: score >= 5 ? "agency cost frustration" : "hiring friction",
          buying_signal_summary: `Commented on recruiting pain post by ${post.post_author}`,
          original_comment: commenter.comment_text,
          source_post_url: commenter.source_post_url,
          enrichment_data: {},
          personalized_message: "",
          status: "pending",
          created_at: toIsoNow()
        });
      }
    } catch (error) {
      console.error(`[Stage 2] Comment scraping failed for post ${post.post_url}:`, error);
    }
  }

  console.log(`[Stage 2] Qualified LinkedIn leads: ${leads.length}`);
  return leads;
}
