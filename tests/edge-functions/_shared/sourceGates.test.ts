import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  filterPeopleCandidates, filterCompanyCandidates, filterPostCandidates,
  filterCommentCandidates, filterWorkflowCandidates, tierFor, topRejectReasons,
  resolveGateKind, topicTokens, normalizeSerpCompanyItem,
} from "../../../supabase/functions/_shared/sourceGates.ts";

// ---- PEOPLE (founders of recruiting agencies) ----
const peopleOpts = { role_keywords: ["Founder", "Co-Founder", "CEO", "Managing Partner"], company_category: ["Recruiting", "Staffing", "Talent", "Executive search"], requireCompany: true };

Deno.test("people: valid founder of a recruiting agency accepted", () => {
  const r = filterPeopleCandidates([{ name: "Jane Doe", title: "Founder & CEO", profile_url: "https://linkedin.com/in/jane", company: "Acme Recruiting", location: "USA" }], peopleOpts);
  assertEquals(r.accepted.length, 1);
});
Deno.test("people: missing profile URL rejected", () => {
  const r = filterPeopleCandidates([{ name: "No URL", title: "Founder", company: "Acme Staffing", profile_url: null }], peopleOpts);
  assertEquals(r.accepted.length, 0);
  assert(r.rejected.some((x) => /profile URL/.test(x.reason)));
});
Deno.test("people: wrong role rejected", () => {
  const r = filterPeopleCandidates([{ name: "Eng", title: "Senior AI Engineer", profile_url: "https://linkedin.com/in/eng", company: "Acme Recruiting" }], peopleOpts);
  assertEquals(r.accepted.length, 0);
  assert(r.rejected.some((x) => /wrong role/.test(x.reason)));
});
Deno.test("people: wrong company category rejected", () => {
  const r = filterPeopleCandidates([{ name: "F", title: "Founder", profile_url: "https://linkedin.com/in/f", company: "Acme Fintech" }], peopleOpts);
  assertEquals(r.accepted.length, 0);
  assert(r.rejected.some((x) => /company category/.test(x.reason)));
});

// ---- COMPANY (recruiting agencies in USA) ----
const coOpts = { category: ["Recruiting", "Staffing", "Talent", "Executive search"] };
Deno.test("company: recruiting agency with website accepted", () => {
  const r = filterCompanyCandidates([{ company: "Acme Recruiting", website: "https://acme-recruiting.com", category: "Recruiting" }], coOpts);
  assertEquals(r.accepted.length, 1);
});
Deno.test("company: personal profile rejected", () => {
  const r = filterCompanyCandidates([{ company: "Jane Doe", profile_url: "https://linkedin.com/in/jane", website: null, source_url: null }], coOpts);
  assertEquals(r.accepted.length, 0);
});
Deno.test("company: no website/source rejected", () => {
  const r = filterCompanyCandidates([{ company: "NoSite Recruiting", website: null, source_url: null }], coOpts);
  assertEquals(r.accepted.length, 0);
  assert(r.rejected.some((x) => /website\/source/.test(x.reason)));
});
Deno.test("company: category mismatch rejected", () => {
  const r = filterCompanyCandidates([{ company: "Fintech Co", website: "https://fintech.com", category: "Fintech" }], coOpts);
  assertEquals(r.accepted.length, 0);
});

// ---- POSTS (Claude Code workflows) ----
const postOpts = { topics: ["Claude Code", "workflow"] };
Deno.test("posts: relevant post accepted", () => {
  const r = filterPostCandidates([{ post_url: "https://linkedin.com/posts/1", author_name: "Dev", snippet: "My Claude Code workflow for shipping faster…" }], postOpts);
  assertEquals(r.accepted.length, 1);
});
Deno.test("posts: no post URL rejected", () => {
  const r = filterPostCandidates([{ post_url: null, author_name: "Dev", snippet: "Claude Code workflow" }], postOpts);
  assertEquals(r.accepted.length, 0);
  assert(r.rejected.some((x) => /post URL/.test(x.reason)));
});
Deno.test("posts: generic AI hype rejected", () => {
  const r = filterPostCandidates([{ post_url: "https://linkedin.com/posts/2", author_name: "Hype", snippet: "AI is the future! 🚀 Excited to share thoughts?" }], postOpts);
  assertEquals(r.accepted.length, 0);
});
Deno.test("posts: topic mismatch rejected", () => {
  const r = filterPostCandidates([{ post_url: "https://linkedin.com/posts/3", author_name: "Off", snippet: "Best pizza recipes in NYC" }], postOpts);
  assertEquals(r.accepted.length, 0);
  assert(r.rejected.some((x) => /topic mismatch/.test(x.reason)));
});

// ---- COMMENTS / COMPETITOR (Clay alternatives) ----
const commentOpts = { competitors: ["Clay", "11x"], topics: ["alternative"] };
Deno.test("comments: relevant Clay-alternatives comment accepted", () => {
  const r = filterCommentCandidates([{ source_url: "https://linkedin.com/posts/x", comment_text: "Looking for a Clay alternative that's cheaper", commenter_name: "Sam", competitor_mentioned: "Clay" }], commentOpts);
  assertEquals(r.accepted.length, 1);
});
Deno.test("comments: no comment/source URL rejected", () => {
  const r = filterCommentCandidates([{ source_url: null, comment_text: "Clay alternative", commenter_name: "Sam" }], commentOpts);
  assertEquals(r.accepted.length, 0);
});
Deno.test("comments: irrelevant competitor rejected", () => {
  const r = filterCommentCandidates([{ source_url: "https://linkedin.com/posts/y", comment_text: "Nice weather today", commenter_name: "Bob" }], commentOpts);
  assertEquals(r.accepted.length, 0);
  assert(r.rejected.some((x) => /irrelevant/.test(x.reason)));
});

// ---- WORKFLOW TRENDS ----
const wfOpts = { topics: ["outbound", "Clay"], tools: ["Clay", "Smartlead"] };
Deno.test("workflow: requires a source URL", () => {
  const r = filterWorkflowCandidates([{ workflow_title: "Clay → Smartlead outbound", source_url: null, workflow_steps: ["enrich", "send"] }], wfOpts);
  assertEquals(r.accepted.length, 0);
  assert(r.rejected.some((x) => /source URL/.test(x.reason)));
});
Deno.test("workflow: requires actionable steps/tools", () => {
  const r = filterWorkflowCandidates([{ workflow_title: "Some idea", source_url: "https://x.com/post", workflow_steps: null, tools_mentioned: null }], wfOpts);
  assertEquals(r.accepted.length, 0);
  assert(r.rejected.some((x) => /steps\/tools/.test(x.reason)));
});
Deno.test("workflow: generic AI content rejected; concrete workflow accepted", () => {
  const generic = filterWorkflowCandidates([{ workflow_title: "AI is the future", source_url: "https://x.com/1", snippet: "game-changer 🚀", tools_mentioned: ["AI"] }], wfOpts);
  assertEquals(generic.accepted.length, 0);
  const good = filterWorkflowCandidates([{ workflow_title: "Clay → Smartlead outbound", source_url: "https://x.com/2", tools_mentioned: ["Clay", "Smartlead"], workflow_steps: ["enrich in Clay", "send via Smartlead"] }], wfOpts);
  assertEquals(good.accepted.length, 1);
});

// ---- GATE-KIND ROUTING (the crux: route the 6 QA prompts to the right gate
//      even though normalizeApifySourceType collapses people/company/comments to "jobs") ----
Deno.test("resolveGateKind: hiring wins on role family", () => {
  assertEquals(resolveGateKind({ has_role_family: true, raw_source_type: "people" }), "hiring");
  assertEquals(resolveGateKind({ workflow_type: "company_hiring_sourcing" }), "hiring");
});
Deno.test("resolveGateKind: founders of recruiting agencies → people", () => {
  assertEquals(resolveGateKind({ workflow_type: "people_sourcing", raw_source_type: "people" }), "people");
  // even when the runtime collapsed source_type to "jobs"
  assertEquals(resolveGateKind({ workflow_type: "people_sourcing", normalized_source_type: "jobs" }), "people");
});
Deno.test("resolveGateKind: recruiting agencies / companies selling to founders → company", () => {
  assertEquals(resolveGateKind({ workflow_type: "company_icp_sourcing", normalized_source_type: "jobs" }), "company");
  assertEquals(resolveGateKind({ raw_source_type: "company_search", normalized_source_type: "jobs" }), "company");
});
Deno.test("resolveGateKind: posts about Claude Code workflows → posts (LinkedIn posts have no structured steps)", () => {
  // LinkedIn post intent always uses the POST gate (topic match), even for a
  // workflow/how-to query — raw posts can't satisfy the workflow steps/tools gate.
  assertEquals(resolveGateKind({ workflow_type: "linkedin_intent_sourcing", query: "posts about Claude Code workflows" }), "posts");
  assertEquals(resolveGateKind({ workflow_type: "linkedin_intent_sourcing", query: "posts about GTM pain" }), "posts");
  // A workflow/how-to query over a STRUCTURED search source (serp) → workflow gate.
  assertEquals(resolveGateKind({ raw_source_type: "serp", query: "Claude Code workflow playbook" }), "workflow");
});
Deno.test("resolveGateKind: Clay alternatives comments / competitor convos → comments", () => {
  assertEquals(resolveGateKind({ workflow_type: "competitor_signal_sourcing", normalized_source_type: "jobs" }), "comments");
  assertEquals(resolveGateKind({ raw_source_type: "comments", normalized_source_type: "jobs" }), "comments");
});
Deno.test("resolveGateKind: unknown returns null (no false gate)", () => {
  assertEquals(resolveGateKind({ raw_source_type: "website_content" }), null);
});
Deno.test("topicTokens: drops stopwords, keeps real topic terms", () => {
  const t = topicTokens("Find posts about Claude Code workflows");
  assert(t.includes("claude") && t.includes("code") && t.includes("workflows"));
  assert(!t.includes("about") && !t.includes("posts"));
});

// ---- SERP → COMPANY normalizer (apify/google-search-scraper output shape) ----
Deno.test("serp→company: organic result → company_name + website/source_url; feeds company gate", () => {
  const c = normalizeSerpCompanyItem({ title: "Acme Recruiting | Executive Search Firm", url: "https://acme-recruiting.com/", displayedUrl: "acme-recruiting.com", description: "Top recruiting agency in the USA." });
  assert(c);
  assertEquals(c!.company, "Acme Recruiting");
  assertEquals(c!.website, "https://acme-recruiting.com/");
  assertEquals(c!.source_url, "https://acme-recruiting.com/");
  // and it passes the company proof gate (company + website/source)
  const r = filterCompanyCandidates([c!], { category: [] });
  assertEquals(r.accepted.length, 1);
});
Deno.test("serp→company: directory/aggregator hosts dropped (not a company site)", () => {
  assertEquals(normalizeSerpCompanyItem({ title: "Best Recruiting Agencies - LinkedIn", url: "https://www.linkedin.com/pulse/best" }), null);
  assertEquals(normalizeSerpCompanyItem({ title: "List of firms - Wikipedia", url: "https://en.wikipedia.org/wiki/x" }), null);
  assertEquals(normalizeSerpCompanyItem({ title: "no url" }), null);
});

// ---- shared ----
Deno.test("tierFor: A/B/C + no-proof caps at C", () => {
  assertEquals(tierFor(80, true), "A");
  assertEquals(tierFor(60, true), "B");
  assertEquals(tierFor(90, false), "C");
});
Deno.test("topRejectReasons aggregates the trace", () => {
  const r = filterPeopleCandidates([
    { name: "A", profile_url: null },
    { name: "B", title: "Engineer", profile_url: "https://linkedin.com/in/b", company: "X Recruiting" },
  ], peopleOpts);
  const top = topRejectReasons(r.trace);
  assert(top.length >= 1 && top[0].count >= 1);
});
