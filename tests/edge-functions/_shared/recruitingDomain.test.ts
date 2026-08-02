// Domain-aware ICP regression tests, seeded by the live Staffr QA
// (wearestaffr.com — a "SaaS recruitment agency"). Guards against the class of
// bug where a recruiting AGENCY got lead-gen pains, "SaaS" business model, a
// blank category, and software-seller disqualifiers. Pure — no providers.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractFromPages } from "../../../supabase/functions/_shared/companyBrainResearch/companyWebsite.ts";
import { mapDraftToV2, type DraftInput } from "../../../supabase/functions/_shared/companyBrainResearch/generateBrainDraft.ts";
import {
  detectProductDomain, suggestTargetCustomer, suggestTriggers, suggestVoiceAndAngles, suggestDisqualifiers,
} from "../../../supabase/functions/_shared/companyBrainResearch/draftQuality.ts";
import { normalizeFounderProfile, isSparseFounderResearch } from "../../../supabase/functions/_shared/companyBrainResearch/founderLinkedIn.ts";
import type { FirecrawlPage } from "../../../supabase/functions/_shared/companyBrainResearch/types.ts";

const HOME = "https://www.wearestaffr.com";
const page = (url: string, title: string, description: string, markdown: string): FirecrawlPage => ({ url, title, description, markdown });

// Condensed real Staffr copy (fetched from the live site during QA).
const STAFFR_PAGES: FirecrawlPage[] = [
  page(HOME, "Staffr | SaaS Recruitment Agency in EMEA and North America",
    "Staffr specialises in curating high-impact teams for the world's most cutting-edge tech companies.",
    "We help startups and scale-ups find the best talent. Staffr hires experts globally for the world's best tech companies. We are a specialist software recruitment agency fuelling your IPO journey across EMEA and North America, hiring elite GTM, Product, and Engineering talent. Our track record: Staffr helped teams reach a 95% success rate, 85% repeat business and 35 days average time to hire."),
  page(`${HOME}/solutions`, "Solutions - Staffr", "",
    "We've tailored our solutions to support early-stage founders. Reach: need talent fast, our flexible solution has you covered, high-speed hiring, finding the best active talent. Focus: our fully-retained service offering where we work exclusively for you, reduced time-to-hire, great for hard-to-find and strategic hires. Scale: for when you're ready to ramp up your go-to-market function, dedicated full-resource team, high volume low cost per hire, fully-embedded talent partner."),
  page(`${HOME}/about`, "About - Staffr", "",
    "A recruitment agency connecting experts with disruptive software. We've set out to build a new type of recruitment business where the focus is on the people. Finding the best talent in Europe and North America. What makes Staffr different: market knowledge, candidate talent pools, direct headhunting. Reduce time-to-hire even at scale."),
  page(`${HOME}/testimonials`, "Testimonials - Staffr", "",
    "Trusted by top-tier SaaS companies worldwide. They're able to source the top percentile of GTM talent across Europe and the US. Staffr helped scope out the founding GTM rep for our early stage start-up."),
];

const USER_DESC = "We're a specialist software recruitment agency hiring elite GTM, product and engineering talent for tech startups and scale-ups across EMEA and North America.";

function staffrDraft() {
  const web = extractFromPages(STAFFR_PAGES, { websiteUrl: HOME, nameHint: "Staffr", descriptionHint: USER_DESC });
  const founder = normalizeFounderProfile({
    full_name: "Sophie Kay", headline: "Founder & Director at Staffr | Software Recruitment",
    current_company: "Staffr", current_role: "Founder & Director",
    experience: [{ title: "Founder & Director", company: "Staffr" }],
    skills: ["Recruitment", "GTM Hiring", "Talent Acquisition"],
  }, "https://www.linkedin.com/in/sophie-kay-49a299180/");
  const input: DraftInput = {
    founder_input: { name: "Sophie Kay", role: "Founder & Director" },
    founder_research: founder,
    company_input: { name: "Staffr", website_url: HOME, description: USER_DESC },
    company_research: web, company_linkedin: null,
  };
  return { web, founder, draft: mapDraftToV2({}, input) };
}

Deno.test("staffr-1. a recruitment agency is understood as staffing services, not SaaS", () => {
  const { web } = staffrDraft();
  const u = web.understanding;
  assertEquals(u.product_category, "staffing services");
  assertEquals(u.business_model, "agency / services");
  assert(!/\bsaas\b/i.test(u.business_model), "business model must not be SaaS for an agency");
  assertEquals(u.ambiguous, false);
});

Deno.test("staffr-2. domain classifier reads recruiting from the vetted category", () => {
  const { web } = staffrDraft();
  assertEquals(detectProductDomain({
    product_category: web.understanding.product_category, one_line_summary: web.understanding.one_line_summary,
    primary_users: web.understanding.primary_users, key_features: web.understanding.key_features, user_description: USER_DESC,
  }), "recruiting");
});

Deno.test("staffr-3. draft threads the category through (never blank)", () => {
  const { draft } = staffrDraft();
  assertEquals((draft.company as Record<string, string>).category, "staffing services");
  assertEquals((draft.company as Record<string, string>).business_model, "agency / services");
});

Deno.test("staffr-4. ICP targets who the agency hires FOR — not the recruiting market", () => {
  const { draft } = staffrDraft();
  const tc = draft.target_customer as Record<string, string[]>;
  assert(tc.industries.some((i) => /startup|scale|tech|saas/i.test(i)), `got ${JSON.stringify(tc.industries)}`);
  assert(!tc.industries.some((i) => /staffing and recruiting/i.test(i)), "must NOT target the staffing market itself");
  assert(tc.must_have.some((m) => /hiring|headcount/i.test(m)), "must-have reflects hiring intent");
});

Deno.test("staffr-5. recruiting pains + content angles, not lead-gen", () => {
  const { draft } = staffrDraft();
  assert(draft.pain_points.some((p) => /talent|hire|time[- ]to[- ]hire/i.test(p)), `pains: ${JSON.stringify(draft.pain_points)}`);
  assert(!draft.pain_points.some((p) => /lead list|pipeline is inconsistent/i.test(p)), "no lead-gen pains for a recruiter");
  assert(draft.content_angles.some((a) => /hir\w+|talent|team/i.test(a)), `angles: ${JSON.stringify(draft.content_angles)}`);
  assert(!draft.content_angles.some((a) => /lead list|pipeline before payroll/i.test(a)), "no lead-gen angles for a recruiter");
});

Deno.test("staffr-6. buyer personas include the economic buyer + a hiring manager", () => {
  const { draft } = staffrDraft();
  assert(draft.buyer_personas.length >= 2);
  assert(draft.buyer_personas.some((p) => /founder|ceo/i.test(p)), "economic buyer present");
  assert(draft.buyer_personas.some((p) => /talent|recruit|sales|gtm|engineering/i.test(p)), "a hiring-side buyer present");
});

Deno.test("staffr-7. disqualifiers are recruiting-appropriate, not software-seller", () => {
  const { draft } = staffrDraft();
  const d = (draft.target_customer as Record<string, Record<string, string[]>>).disqualifiers;
  const flat = [...d.industries, ...d.company_types, ...d.keywords].join(" ").toLowerCase();
  assert(/not (actively )?hiring|hiring freeze|no open roles|in-house talent|staffing agenc/i.test(flat), `disq: ${flat}`);
  assert(!/non-software services/.test(flat), "must not treat a recruiter as a software seller");
});

Deno.test("staffr-8. triggers reflect a company that suddenly needs to hire", () => {
  const { draft } = staffrDraft();
  assert(draft.triggers.some((t) => /funding|senior|roles|scale|build-out|team/i.test(t)), `triggers: ${JSON.stringify(draft.triggers)}`);
});

Deno.test("staffr-9. founder normalization yields strong context (not sparse)", () => {
  const { founder } = staffrDraft();
  assertEquals(founder.name, "Sophie Kay");
  assertEquals(founder.current_company, "Staffr");
  assert(/founder|director/i.test(founder.current_role));
  assert(founder.credibility_signals.length > 0);
  assert(!isSparseFounderResearch(founder));
});

Deno.test("staffr-10. Agentory (a real GTM product) still reads as gtm_sales, not recruiting", () => {
  // Guards the classifier against over-firing on any 'hiring'/'GTM' mention.
  assertEquals(detectProductDomain({
    product_category: "AI workforce platform",
    one_line_summary: "AI workforce that finds leads, scores buying signals and drafts outreach for founders",
    primary_users: ["founders"], key_features: ["finds leads", "scores signals"],
    user_description: "AI workforce OS for B2B founders that finds signal-based leads before hiring SDRs",
  }), "gtm_sales");
});
