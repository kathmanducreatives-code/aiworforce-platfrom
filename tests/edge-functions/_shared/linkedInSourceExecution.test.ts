import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileCompanyBrainContext } from "../../../supabase/functions/_shared/companyBrainCompiler.ts";
import { buildRadarIntelligenceProfile } from "../../../supabase/functions/_shared/radarIntel/radarIntelligenceProfile.ts";
import { postsToSignalRows, commentsToSignalRows, peopleToDecisionMakerRows } from "../../../supabase/functions/_shared/radarIntel/linkedInSourceExecution.ts";
import type { NormalizedPost, NormalizedComment, NormalizedPerson } from "../../../supabase/functions/_shared/radarIntel/radarProviderAdapters.ts";

function intel() {
  return buildRadarIntelligenceProfile(compileCompanyBrainContext({
    workspace_id: "wsA",
    profile: { company: { category: "AI SaaS", description: "signal-based pipeline for B2B SaaS founders" }, icp: { industries: ["B2B SaaS"], buyer_roles: ["Founder", "RevOps"], disqualifiers: ["staffing agency"] }, competitors: { known: ["Alta"] } },
    signal_preferences: { linkedin_topics: ["AI GTM agents", "signal-based prospecting"] },
  }));
}

Deno.test("posts: relevant post kept; engagement null without metrics (never viral)", () => {
  const posts: NormalizedPost[] = [
    { author: "Jane", author_role: "Founder", author_company: "Acme", text: "my AI GTM agent playbook", post_url: "https://li/1", published_at: null, reactions: null, comments: null, reposts: null, provider: "apify" },
    { author: "Bob", author_role: null, author_company: "RandomCo", text: "happy friday everyone", post_url: "https://li/2", published_at: null, reactions: null, comments: null, reposts: null, provider: "apify" },
  ];
  const out = postsToSignalRows(posts, intel(), "u1");
  assertEquals(out.accepted, 1);
  assertEquals(out.rows[0].raw["engagement_class"], null); // no metrics → not viral
  assertEquals(out.rejection_reasons["off_topic"], 1);
});

Deno.test("comments: generic rejected, no-parent rejected, implementation+parent kept", () => {
  const comments: NormalizedComment[] = [
    { commenter: "A", commenter_role: null, commenter_company: "B2B SaaS Co", commenter_profile_url: "https://p/a", comment_text: "Great post!", comment_url: "https://c/1", parent_post_text: "x", parent_post_url: "https://li/1", parent_author: "Jane", published_at: null, provider: "apify" },
    { commenter: "B", commenter_role: null, commenter_company: "B2B SaaS Co", commenter_profile_url: "https://p/b", comment_text: "How did you set this up? what tools?", comment_url: "https://c/2", parent_post_text: "x", parent_post_url: "https://li/1", parent_author: "Jane", published_at: null, provider: "apify" },
    { commenter: "C", commenter_role: null, commenter_company: "B2B SaaS Co", commenter_profile_url: "https://p/c", comment_text: "How do you implement this?", comment_url: "https://c/3", parent_post_text: "", parent_post_url: "", parent_author: "", published_at: null, provider: "apify" },
  ];
  const out = commentsToSignalRows(comments, intel(), "u1");
  assertEquals(out.accepted, 1); // only the one with intent + parent evidence
  assertEquals(out.rows[0].raw["intent"], "implementation");
  assert((out.rejection_reasons["generic_reaction"] ?? 0) >= 1);
  assert((out.rejection_reasons["missing_parent_evidence"] ?? 0) >= 1);
});

Deno.test("people: attach to verified account; standalone marked person-only", () => {
  const people: NormalizedPerson[] = [{ name: "Dana", role: "RevOps", company: "Acme", profile_url: "https://p/d", provider: "apify" }];
  const attached = peopleToDecisionMakerRows(people, { kind: "hiring", account_verified: true }, "u1");
  assertEquals(attached.rows[0].raw["is_person_only"], false);
  assertEquals(attached.rows[0].raw["decision_maker_present"], true);
  const standalone = peopleToDecisionMakerRows(people, { kind: "hiring", account_verified: false }, "u1");
  assertEquals(standalone.rows[0].raw["is_person_only"], true);
});
