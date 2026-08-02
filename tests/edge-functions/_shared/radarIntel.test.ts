// Scout Radar high-value signal intelligence — deterministic tests for the 28
// required scenarios. Pure: brain → intelligence profile → classifiers. NO
// provider calls anywhere (replay-safe).

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileCompanyBrainContext } from "../../supabase/functions/companyBrainCompiler.ts";
import { buildRadarIntelligenceProfile } from "../../supabase/functions/_shared/radarIntelligenceProfile.ts";
import { classifyRoleFamily, classifyCompanyExclusion, buildHiringSignalView } from "../../supabase/functions/_shared/hiringRoleFamily.ts";
import { classifyPost, classifyEngagement, classifyCommentIntent, buildCommentSignal } from "../../supabase/functions/_shared/linkedInIntelligence.ts";
import { classifyCompetitor } from "../../supabase/functions/_shared/competitorIntelligence.ts";
import { evaluateWorkflowTrend, evaluateFunding } from "../../supabase/functions/_shared/marketIntelligence.ts";
import { allowedAction, classifyPerson, dedupeTags, cleanLabel } from "../../supabase/functions/_shared/radarDecision.ts";
import { buildSourceDiagnostics, explainDiagnostics, resolveReadiness } from "../../supabase/functions/_shared/radarDiagnostics.ts";

// ---- fixtures: two workspaces ---------------------------------------------
// A — Agentory-like B2B SaaS; competitor seeds Alta / Gojiberry AI (workspace-only).
function profileA() {
  return buildRadarIntelligenceProfile(compileCompanyBrainContext({
    workspace_id: "wsA",
    profile: {
      company: { category: "AI SaaS", description: "AI workforce OS: signal-based pipeline for B2B SaaS founders" },
      icp: {
        industries: ["B2B SaaS", "AI SaaS"], buyer_roles: ["Founder", "RevOps", "Head of Growth", "VP Sales"],
        company_size: "10-150 employees", geography: "United States",
        disqualifiers: ["staffing agency", "recruiting agency", "nonprofit"], pain_points: ["pipeline before payroll", "lead quality"],
      },
      competitors: { known: ["Alta", "Gojiberry AI"], adjacent: ["Clay"] },
    },
    signal_preferences: { linkedin_topics: ["AI GTM agents", "signal-based prospecting"], workflow_topics: ["Claude Code GTM workflow", "founder-led outbound"] },
  }));
}
// B — different workspace (recruitment agency): no Alta/Gojiberry, different topics.
function profileB() {
  return buildRadarIntelligenceProfile(compileCompanyBrainContext({
    workspace_id: "wsB",
    profile: {
      company: { category: "Recruitment Agency", description: "We reduce time-to-hire for scaling teams" },
      icp: { industries: ["staffing", "recruiting"], buyer_roles: ["Head of Talent"], company_size: "50-500", geography: "Europe", pain_points: ["time-to-hire"] },
      competitors: { known: ["Bullhorn"] },
    },
    signal_preferences: { linkedin_topics: ["talent quality", "hiring outcomes"] },
  }));
}

// 1. Hiring card outputs company + exact role -------------------------------
Deno.test("1. hiring card headline is '{Company} is hiring a {Role}'", () => {
  const p = profileA();
  const rc = classifyRoleFamily("Revenue Operations Lead", p);
  const view = buildHiringSignalView({ company: "Acme", role: "Revenue Operations Lead", profile: p, roleClass: rc, exclusion: { excluded: false, reason: null, matched_term: null } });
  assertEquals(view.headline, "Acme is hiring a Revenue Operations Lead.");
  assert(view.why_it_matters.startsWith("This matters because"));
});

// 2. Unrelated roles rejected ------------------------------------------------
Deno.test("2. unrelated roles are unrelated", () => {
  const p = profileA();
  assertEquals(classifyRoleFamily("Product Manager Intern", p).family, "unrelated");
  assertEquals(classifyRoleFamily("Director of Commercial Analytics", p).family, "unrelated");
  assertEquals(classifyRoleFamily("Backend Software Engineer", p).family, "unrelated");
});

// 3. Adjacent roles are watch, not exact ------------------------------------
Deno.test("3. generic AE/SDR are adjacent, leadership/ops are exact", () => {
  const p = profileA();
  assertEquals(classifyRoleFamily("Account Executive", p).family, "adjacent");
  assertEquals(classifyRoleFamily("RevOps Manager", p).family, "exact");
  assertEquals(classifyRoleFamily("VP Sales", p).family, "exact");
  assertEquals(classifyRoleFamily("Founding Account Executive", p).family, "exact");
});

// 4 & 5. Agency + nonprofit rejected when brain excludes them ----------------
Deno.test("4/5. excluded company types (agency, nonprofit) are rejected", () => {
  const p = profileA();
  assert(classifyCompanyExclusion({ text: "a staffing agency placing contractors" }, p).excluded);
  assert(classifyCompanyExclusion({ text: "a nonprofit charity" }, p).excluded);
  assert(!classifyCompanyExclusion({ text: "a B2B SaaS revenue platform" }, p).excluded);
});

// 6 & 9. Different brains → different profiles; seeds are workspace-specific --
Deno.test("6/9. workspaces differ; Alta/Gojiberry are workspace-only, not global", () => {
  const a = profileA(), b = profileB();
  assert(a.competitors.seeds.some((s) => /alta/i.test(s)));
  assert(a.competitors.seeds.some((s) => /gojiberry/i.test(s)));
  assert(!b.competitors.seeds.some((s) => /alta|gojiberry/i.test(s)), "seeds must not leak across workspaces");
  assert(JSON.stringify(a.buyers.exact_role_terms) !== JSON.stringify(b.buyers.exact_role_terms));
});

// 7 & 10. Post classification uses brain topics -----------------------------
Deno.test("7/10. agent-playbook / GTM posts classify as category_leader", () => {
  const p = profileA();
  const c = classifyPost({ text: "Here's my AI GTM agent playbook for signal-based prospecting" }, p);
  assertEquals(c.group, "category_leader");
  assert(c.relevant);
});

// 8. Competitor seed → direct competitor ------------------------------------
Deno.test("8. a Company Brain competitor seed classifies as direct", () => {
  assertEquals(classifyCompetitor({ name: "Alta", description: "AI GTM agent" }, profileA()).class, "direct");
});

// 11. No viral without engagement metrics -----------------------------------
Deno.test("11. a post is never 'viral' without metrics", () => {
  assertEquals(classifyEngagement(null).class, "relevant_post");
  assertEquals(classifyEngagement({}).class, "relevant_post");
  assertEquals(classifyEngagement({ reactions: 1200, comments: 300, reposts: 90 }).class, "viral");
});

// 12. Generic compliment is not intent --------------------------------------
Deno.test("12. 'Great post!' is not a buying signal", () => {
  assertEquals(classifyCommentIntent("Great post!").is_buying_signal, false);
  assertEquals(classifyCommentIntent("congrats 🔥").is_buying_signal, false);
});

// 13 & 14. Implementation question from ICP buyer + parent evidence ---------
Deno.test("13/14. implementation-intent comment with parent post is a valid signal", () => {
  const p = profileA();
  const ok = buildCommentSignal({ commentText: "How did you set up this workflow? What tools?", parentPostUrl: "https://linkedin.com/posts/x", commenterCompanyText: "B2B SaaS startup", profile: p });
  assert(ok.valid);
  assertEquals(ok.intent, "implementation");
  const noParent = buildCommentSignal({ commentText: "How did you set this up?", profile: p });
  assert(!noParent.valid);
  assert(noParent.missing_evidence.includes("Parent post URL"));
});

// 15. Person-only is not a signal -------------------------------------------
Deno.test("15. a person profile alone is not a market signal", () => {
  assert(classifyPerson({}).is_standalone_signal);
  assert(!classifyPerson({ attached_to: "hiring", account_verified: true }).is_standalone_signal);
});

// 16. Competitor requires real overlap --------------------------------------
Deno.test("16. generic 'AI'/'sales' overlap alone is not a competitor", () => {
  assertEquals(classifyCompetitor({ name: "RandomCo", description: "an AI sales tool" }, profileA()).class, "not_competitor");
});

// 17. Funding never fabricated ----------------------------------------------
Deno.test("17. funding passes through only provided fields; watch not contact", () => {
  const f = evaluateFunding({ company_name: "Acme", source_url: "https://news.example.com/acme" });
  assertEquals(f.amount, null);
  assertEquals(f.round, null);
  assertEquals(f.announced_date, null);
  assertEquals(f.decision, "watch");
  assert(!evaluateFunding({ company_name: "Acme" }).valid); // no source → invalid
});

// 18. Workflow trend requires evidence --------------------------------------
Deno.test("18. workflow trend needs a topic + credible source", () => {
  const p = profileA();
  assert(!evaluateWorkflowTrend({ text: "Claude Code GTM workflow", sourceUrls: [], profile: p }).valid);
  const ok = evaluateWorkflowTrend({ text: "founder-led outbound with Claude Code GTM workflow", sourceUrls: ["https://a.com", "https://b.com"], profile: p });
  assert(ok.valid);
  assertEquals(ok.maturity, "established");
});

// 19. Unusable brain prevents provider execution ----------------------------
Deno.test("19. an unusable (setup_required) brain marks the profile not usable", () => {
  const empty = buildRadarIntelligenceProfile(compileCompanyBrainContext({ workspace_id: "ws", profile: {} }));
  assertEquals(empty.usable, false);
  assertEquals(profileA().usable, true);
});

// 20 & 21. Diagnostics are meaningful; zero-accept explains rejections -------
Deno.test("20/21. diagnostics explain outcomes incl. rejection reasons", () => {
  const notConfigured = buildSourceDiagnostics({ source: "linkedin_comments", configured: false });
  assertEquals(notConfigured.readiness, "not_configured");
  assert(explainDiagnostics(notConfigured).includes("not configured"));
  const rejected = buildSourceDiagnostics({ source: "linkedin_comments", configured: true, execution_status: "ran", raw_count: 21, accepted_count: 0, rejected_count: 21, rejection_reasons: { generic_reaction: 19, icp_mismatch: 2 } });
  assertEquals(rejected.readiness, "matches_rejected");
  assert(explainDiagnostics(rejected).includes("21"));
  assert(explainDiagnostics(rejected).toLowerCase().includes("generic_reaction"));
});

// 24. Draft outreach unavailable for needs_review ---------------------------
Deno.test("24. draft outreach is blocked for needs_review / person-only / no-evidence", () => {
  assert(!allowedAction({ decision: "needs_review", is_person_only: false, has_evidence_url: true, verified_company: true, decision_maker_present: true }).can_draft_outreach);
  assert(!allowedAction({ decision: "contact", is_person_only: true, has_evidence_url: true, verified_company: true, decision_maker_present: true }).can_draft_outreach);
  assert(allowedAction({ decision: "contact", is_person_only: false, has_evidence_url: true, verified_company: true, decision_maker_present: true }).can_draft_outreach);
});

// 25. Duplicate tags removed ------------------------------------------------
Deno.test("25. duplicate tags/labels are collapsed", () => {
  assertEquals(cleanLabel("Active hiring: Active hiring"), "Active hiring");
  assertEquals(dedupeTags(["Hiring", "hiring", "Active hiring: Active hiring", "Active hiring"]), ["Hiring", "Active hiring"]);
});

// 27. Scoped by workspace_id ------------------------------------------------
Deno.test("27. intelligence profile is workspace-scoped", () => {
  assertEquals(profileA().workspace_id, "wsA");
  assertEquals(profileB().workspace_id, "wsB");
});

// 28. No provider calls (structural) ----------------------------------------
Deno.test("28. replay-safe: modules are pure (no fetch/provider imports)", async () => {
  const files = ["radarIntelligenceProfile", "hiringRoleFamily", "linkedInIntelligence", "competitorIntelligence", "marketIntelligence", "radarDecision", "radarDiagnostics"];
  for (const f of files) {
    const src = await Deno.readTextFile(new URL(`./${f}.ts`, import.meta.url));
    assert(!/\bfetch\s*\(/.test(src), `${f} must not call fetch`);
    assert(!/api\.(anthropic|apify|firecrawl)\.com/.test(src), `${f} must not reference a provider host`);
  }
});
