// Turn normalized LinkedIn provider rows into scored `signals` insert rows, using
// the tested intelligence contracts (post grouping, engagement class, comment
// intent, company fit). PURE / Deno-testable — the edge function fetches + normalizes
// (only when the actor is configured) and calls these builders. Never fabricates:
// engagement stays absent unless the provider supplied it; a comment with no parent
// post or a generic compliment does not become a signal.

import type { RadarIntelligenceProfile } from "./radarIntelligenceProfile.ts";
import { classifyPost, classifyEngagement, buildCommentSignal, classifyCommentIntent } from "./linkedInIntelligence.ts";
import type { NormalizedPost, NormalizedComment, NormalizedPerson } from "./radarProviderAdapters.ts";
import type { EnrichableRow } from "./radarSignalEnrichment.ts";

export interface BuildResult {
  rows: EnrichableRow[];
  considered: number;
  accepted: number;
  rejected: number;
  rejection_reasons: Record<string, number>;
}
function bump(m: Record<string, number>, k: string) { m[k] = (m[k] ?? 0) + 1; }

export function postsToSignalRows(posts: NormalizedPost[], intel: RadarIntelligenceProfile, userId: string): BuildResult {
  const rows: EnrichableRow[] = []; const rejection_reasons: Record<string, number> = {}; let rejected = 0;
  for (const p of posts) {
    const cls = classifyPost({ text: p.text ?? "", author_company: p.author_company ?? "", author_role: p.author_role ?? "" }, intel);
    if (!cls.relevant) { rejected++; bump(rejection_reasons, "off_topic"); continue; }
    const eng = classifyEngagement({ reactions: p.reactions, comments: p.comments, reposts: p.reposts, follower_count: null });
    rows.push({
      signal_type: "linkedin_post", title: (p.text ?? "").slice(0, 200), source_url: p.post_url,
      raw: {
        created_by: userId, verification_status: p.post_url ? "needs_verification" : "needs_verification",
        source_details: { author: p.author, author_company: p.author_company, post_url: p.post_url },
        topic: cls.topic, engagement_class: eng.has_metrics ? eng.class : null, // never "viral" without metrics
        matched_icp: cls.matched_terms, why_it_matters: cls.why, source_provider: p.provider,
      },
    });
  }
  return { rows, considered: posts.length, accepted: rows.length, rejected, rejection_reasons };
}

export function commentsToSignalRows(comments: NormalizedComment[], intel: RadarIntelligenceProfile, userId: string): BuildResult {
  const rows: EnrichableRow[] = []; const rejection_reasons: Record<string, number> = {}; let rejected = 0;
  for (const c of comments) {
    const signal = buildCommentSignal({
      commentText: c.comment_text ?? "", parentPostUrl: c.parent_post_url ?? "", parentPostExcerpt: c.parent_post_text ?? "",
      commenterCompanyText: c.commenter_company ?? "", profile: intel,
    });
    const intent = classifyCommentIntent(c.comment_text ?? "");
    if (!intent.is_buying_signal) { rejected++; bump(rejection_reasons, "generic_reaction"); continue; }
    if (!signal.valid) { rejected++; bump(rejection_reasons, "missing_parent_evidence"); continue; }
    if (!signal.company_fit) { rejected++; bump(rejection_reasons, "icp_mismatch"); continue; }
    rows.push({
      signal_type: "linkedin_comment", title: (c.comment_text ?? "").slice(0, 200), source_url: c.comment_url ?? c.parent_post_url,
      raw: {
        created_by: userId, verification_status: "needs_verification",
        source_details: { commenter: c.commenter, commenter_company: c.commenter_company, comment_text: c.comment_text, parent_post_url: c.parent_post_url, parent_post_text: c.parent_post_text, profile_url: c.commenter_profile_url },
        intent: signal.intent, why_now: "Active buyer intent in a relevant conversation.", source_provider: c.provider,
      },
    });
  }
  return { rows, considered: comments.length, accepted: rows.length, rejected, rejection_reasons };
}

/** Decision makers attach to an existing verified company signal — they are never
 * standalone market signals. Returns rows tagged with the parent signal. */
export function peopleToDecisionMakerRows(
  people: NormalizedPerson[],
  attachTo: { kind: string; account_verified: boolean },
  userId: string,
): BuildResult {
  const rows: EnrichableRow[] = [];
  for (const p of people) {
    rows.push({
      signal_type: "decision_maker", title: p.name ?? "Decision maker", source_url: p.profile_url,
      raw: {
        created_by: userId,
        source_details: { name: p.name, role: p.role, company: p.company, profile_url: p.profile_url },
        attached_to: attachTo.account_verified ? attachTo.kind : null,
        is_person_only: !attachTo.account_verified,
        decision_maker_present: attachTo.account_verified,
        verification_status: attachTo.account_verified ? "verified" : "needs_verification",
        source_provider: p.provider,
      },
    });
  }
  return { rows, considered: people.length, accepted: rows.length, rejected: 0, rejection_reasons: {} };
}
