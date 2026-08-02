// Find Leads query-quality audit — deterministic fixture tests.
//
// Proves the intent → query → tier chain produces PRECISE, ICP-shaped searches
// (not generic scraping) for the audit's fixture prompts, and that the specific
// gaps fixed here hold:
//   G1 an explicitly-named geography is a HARD filter (no silent relaxation)
//   G2 a prompt that explicitly targets recruiting/agencies drops that disqualifier
//   G3 non-SaaS categories (ecommerce, recruitment agency) are detected
//   G4 role expansion (Sales Operations → RevOps/Revenue Operations/GTM Ops)
// No providers, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractLeadSearchIntent } from "../../supabase/functions/_shared/leadSearchIntent.ts";
import { buildProviderQueries } from "../../supabase/functions/_shared/leadProviderQueryBuilder.ts";
import { classifyLeadTier, type CandidateForTier } from "../../supabase/functions/_shared/leadMatchTier.ts";
import { parseStrictConstraints, buildAttemptStrategy } from "../../supabase/functions/_shared/sourcingRetry.ts";
import { isShortenerUrl } from "../../supabase/functions/_shared/apifyJobsNormalizer.ts";

const kwText = (qs: ReturnType<typeof buildProviderQueries>) => qs.map((q) => q.keywords).join(" | ").toLowerCase();

// ---------------------------------------------------------------- TC1 --------

Deno.test("TC1. 'founders of B2B SaaS hiring sales operations in the US' — precise, ICP-shaped", () => {
  const brain = {
    industries: ["B2B SaaS"], buyer_roles: ["Founder", "CEO", "Head of Growth", "Head of Sales"],
    disqualifiers: ["staffing agency", "recruiting agency", "large enterprise", "non-B2B"],
  };
  const intent = extractLeadSearchIntent({ message: "Find founders of B2B SaaS companies hiring sales operations in the United States", brain });

  assert(intent.must_have_categories.includes("B2B SaaS"), "category B2B SaaS");
  // G4: Sales Operations expands to the GTM-ops family.
  for (const r of ["Sales Operations", "RevOps", "Revenue Operations", "GTM Operations"]) {
    assert(intent.role_terms.includes(r), `role expansion missing ${r}`);
  }
  assertEquals(intent.location_groups, ["US"]);
  assert(intent.location_explicit, "US is explicit → hard filter");
  assertEquals(intent.relaxation_allowed.location, false, "named geography must not be relaxable");
  assert(intent.hard_disqualifiers.some((d) => /staffing|recruit/i.test(d)), "brain disqualifiers carried");

  const qs = buildProviderQueries(intent);
  const kw = kwText(qs);
  assert(/b2b saas/.test(kw), "query shaped by category");
  assert(/sales operations|revops|revenue operations|gtm operations/.test(kw), "query shaped by role");
  assert(qs.every((q) => /united states|remote united states/i.test(q.location)), "queries locked to US");
  assert(qs.some((q) => q.intent_tier === "strict"), "a strict tier exists");

  // A staffing agency candidate is hard-rejected.
  const staffing: CandidateForTier = { company: "TalentBridge Staffing", industries: ["Staffing and Recruiting"], job_title: "Sales Operations Manager", source_url: "https://jobs.example/1" };
  const t = classifyLeadTier(staffing, intent);
  assertEquals(t.match_tier, "reject");
  assert(t.disqualified || t.recruiter_proxy, "staffing agency rejected");

  // A real B2B SaaS company hiring the exact role → strict.
  const good: CandidateForTier = { company: "Acme Cloud", company_description: "B2B SaaS platform for outbound revenue teams", industries: ["Software"], job_title: "Sales Operations Lead", source_url: "https://jobs.example/2" };
  assertEquals(classifyLeadTier(good, intent).match_tier, "strict");
});

// ---------------------------------------------------------------- TC2 --------

Deno.test("TC2. 'recently funded AI startups hiring account executives'", () => {
  const intent = extractLeadSearchIntent({ message: "Find recently funded AI startups hiring account executives" });
  assert(intent.must_have_categories.includes("AI SaaS"), "AI → AI SaaS category");
  assert(intent.role_terms.includes("Account Executive") && intent.role_terms.includes("Sales Executive"), "AE expands to Sales Executive");
  assertEquals(intent.funding_required, true, "recently funded → funding required");
  const kw = kwText(buildProviderQueries(intent));
  assert(/ai saas|b2b saas/.test(kw) && /account executive/.test(kw), "query includes AI SaaS + AE");

  // Funding required but only a job post (no separate funding proof) → downgraded,
  // never claimed as recently funded.
  const c: CandidateForTier = { company: "NeuralGo", company_description: "AI software platform", job_title: "Account Executive", source_url: "https://jobs.example/3" };
  const t = classifyLeadTier(c, intent);
  assertEquals(t.match_tier, "secondary");
  assert(t.missing_evidence.includes("recent funding proof"), "no funding fabrication");
});

// ---------------------------------------------------------------- TC3 --------

Deno.test("TC3. 'companies hiring SDRs but without a large sales team' — negative not mistaken for target", () => {
  const intent = extractLeadSearchIntent({ message: "Find companies hiring SDRs but without a large sales team" });
  assert(intent.role_terms.includes("SDR"), "SDR is a positive hiring signal");
  assert(intent.trigger_terms.includes("hiring"), "hiring trigger detected");
  // "large sales team" must NOT become a target category or a must-have role.
  assert(!intent.company_categories.some((c) => /large|sales team/i.test(c)), "'large sales team' is not a target category");
  assert(!intent.must_have_roles.some((r) => /large|team/i.test(r)), "'large sales team' is not a target role");
});

// ---------------------------------------------------------------- TC4 --------

Deno.test("TC4. 'recruitment agencies hiring engineering recruiters' — explicit target keeps the category", () => {
  const intent = extractLeadSearchIntent({ message: "Find recruitment agencies hiring engineering recruiters" });
  // G3: recruitment agency is a real detected category.
  assert(intent.company_categories.includes("recruitment agency"), "recruitment agency category detected");
  // G4: engineering recruiter role.
  assert(intent.role_terms.some((r) => /engineering recruiter|technical recruiter/i.test(r)), "engineering recruiter role");
  // G2: because the user explicitly targets recruiting, recruiting/staffing are
  // NOT auto-added as disqualifiers (would sabotage the exact search).
  assert(!intent.hard_disqualifiers.some((d) => /recruit|staffing/i.test(d)), "recruiting not disqualified when it IS the target");

  // A recruitment-agency candidate is NOT rejected here (it is the ICP).
  const agency: CandidateForTier = { company: "HireForge", company_description: "recruitment agency placing engineering talent", industries: ["Staffing and Recruiting"], job_title: "Engineering Recruiter", source_url: "https://jobs.example/4" };
  const t = classifyLeadTier(agency, intent);
  // recruiter-proxy still fires on "our client" language, but a plain agency
  // hiring its OWN recruiter with a source url is not proxy-rejected by disqualifier.
  assert(!t.disqualified || t.recruiter_proxy, "not disqualified via the recruiting industry term");
});

// ---------------------------------------------------------------- TC5 --------

Deno.test("TC5. bad-data fixtures are rejected / not fillable", () => {
  const intent = extractLeadSearchIntent({ message: "Find founders of B2B SaaS companies hiring sales operations in the United States", brain: { industries: ["B2B SaaS"] } });

  // recruiter proxy person
  const proxy: CandidateForTier = { company: "Confidential", company_description: "We are partnering with our client, a leading company", job_title: "Sales Operations", source_url: "https://jobs.example/5" };
  assertEquals(classifyLeadTier(proxy, intent).match_tier, "reject");

  // no source proof
  const noProof: CandidateForTier = { company: "Ghost Co", job_title: "Sales Operations", source_url: "" };
  assertEquals(classifyLeadTier(noProof, intent).match_tier, "reject");

  // shortener-only evidence is recognised as a non-verifiable website
  assert(isShortenerUrl("https://bit.ly/xyz"), "shortener detected");
  assert(!isShortenerUrl("https://acme.com"), "real domain not flagged");

  // non-SaaS company when SaaS is required → off-ICP reject
  const nonSaas: CandidateForTier = { company: "Local Diner", company_description: "family restaurant", job_title: "Sales Operations", source_url: "https://jobs.example/6" };
  assertEquals(classifyLeadTier(nonSaas, intent).match_tier, "reject");
});

// -------------------------------------------------------- G1 relaxation -------

Deno.test("G1. a plainly-named geography is a HARD filter (no silent relaxation)", () => {
  const strict = parseStrictConstraints("Find founders of B2B SaaS hiring sales operations in the United States");
  assertEquals(strict.location, true, "named US → location strict");
  // Even at the last attempt, location is not relaxed.
  const late = buildAttemptStrategy(5, { role: "Sales Operations", location: "United States", requested: 5 }, strict);
  assertEquals(late.relax_location, false, "location never silently relaxed");

  // Opt-out phrasing restores relaxability.
  const anywhere = parseStrictConstraints("Find B2B SaaS founders hiring sales operations anywhere");
  assertEquals(anywhere.location, false, "'anywhere' opts out of the hard geo filter");
});
