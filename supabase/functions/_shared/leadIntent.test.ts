import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractLeadIntent, planJobsActorInput, filterHiringCandidates, tierFromScore,
  type RawCandidate,
} from "./leadIntent.ts";
import { classifyRoleFamily, roleMatchesFamily, isProfileOrEquityTitle } from "./roleFamilies.ts";

// ---------- Intent extraction (separates product / buyer / role / source) ----------

Deno.test("intent: 'founders hiring assistant roles … my AI SaaS' separates product/buyer/role/source", () => {
  const i = extractLeadIntent({ message: "I want founders hiring for assistant roles so I can target them with my AI SaaS product. Help me find the leads." });
  assertEquals(i.workflow_type, "company_hiring_sourcing");
  assertEquals(i.source_type, "jobs");
  assertEquals(i.hiring_signal.role_family, "assistant_founder_support");
  assert(i.hiring_signal.requested);
  // "AI SaaS" is the PRODUCT, not a target industry.
  assertEquals(i.user_product?.category, "AI SaaS");
  assert(!i.target_industry.includes("AI SaaS"), "AI SaaS must not leak into target industry");
  assert(i.target_buyer.includes("Founder"));
});

Deno.test("intent: 'companies selling to founders' → company search (not people)", () => {
  const i = extractLeadIntent({ message: "Find 5 early-stage B2B SaaS companies selling to founders in USA." });
  assertEquals(i.source_type, "company_search");
  assertEquals(i.workflow_type, "company_icp_sourcing");
  assert(!i.hiring_signal.requested);
});

Deno.test("intent: 'founders of recruiting agencies' → people search", () => {
  const i = extractLeadIntent({ message: "Find 5 founders of recruiting agencies in USA." });
  assertEquals(i.source_type, "people");
  assertEquals(i.workflow_type, "people_sourcing");
});

Deno.test("intent: 'companies hiring SDRs' → jobs / gtm_sales", () => {
  const i = extractLeadIntent({ message: "Find companies hiring SDRs in B2B SaaS in the US." });
  assertEquals(i.source_type, "jobs");
  assertEquals(i.hiring_signal.role_family, "gtm_sales");
  assert(i.hiring_signal.role_keywords.some((k) => /sdr/i.test(k)));
});

Deno.test("intent: 'posts about Claude Code workflows' → linkedin_posts", () => {
  const i = extractLeadIntent({ message: "Find posts about Claude Code workflows." });
  assertEquals(i.source_type, "linkedin_posts");
  assertEquals(i.workflow_type, "linkedin_intent_sourcing");
});

// ---------- Actor input planner ----------

Deno.test("actor input: assistant query includes support aliases + excludes founder/profile titles", () => {
  const i = extractLeadIntent({ message: "I want founders hiring for assistant roles so I can target them with my AI SaaS product." });
  const job = planJobsActorInput(i);
  assert(job.role_keywords.some((k) => /executive assistant/i.test(k)));
  assert(job.role_keywords.some((k) => /chief of staff/i.test(k)));
  assert(job.exclude_keywords.includes("Co-Founder") && job.exclude_keywords.includes("Founder") && job.exclude_keywords.includes("CEO"));
  assert(/OR/.test(job.query), "query should OR-join aliases");
});

Deno.test("actor input: GTM hiring includes SDR/AE/Growth aliases", () => {
  const i = extractLeadIntent({ message: "Find companies hiring SDRs in the US." });
  const job = planJobsActorInput(i);
  const ks = job.role_keywords.join(" ").toLowerCase();
  assert(ks.includes("sdr") && ks.includes("account executive"));
});

Deno.test("actor input: company search produces NO job-role filters", () => {
  const i = extractLeadIntent({ message: "Find recruiting agencies in USA." });
  assertEquals(i.hiring_signal.requested, false);
  assertEquals(i.hiring_signal.role_keywords.length, 0);
});

Deno.test("source routing: people request does not use the jobs actor", () => {
  const i = extractLeadIntent({ message: "Find 5 CEOs of healthcare AI companies in London." });
  assertEquals(i.source_type, "people");
});

// ---------- Filtering (role family + negative titles + source proof) ----------

const assistantIntent = extractLeadIntent({ message: "founders hiring assistant roles in USA" });
const withUrl = (company: string, job_title: string): RawCandidate => ({ company, job_title, source_url: `https://linkedin.com/jobs/view/${company}` });

Deno.test("filter: Senior AI Engineer rejected for assistant-support workflow", () => {
  const r = filterHiringCandidates([withUrl("Acme", "Senior AI Engineer")], assistantIntent);
  assertEquals(r.accepted.length, 0);
  assert(r.rejected.some((x) => /wrong role/.test(x.reason)));
});

Deno.test("filter: Growth Lead + Product Marketing rejected for assistant-support workflow", () => {
  const r = filterHiringCandidates([withUrl("A", "Growth Lead"), withUrl("B", "Product Marketing Manager")], assistantIntent);
  assertEquals(r.accepted.length, 0);
});

Deno.test("filter: Co-Founder / CEO rejected as a hiring signal", () => {
  const r = filterHiringCandidates([withUrl("X", "Co-Founder"), withUrl("Y", "CEO")], assistantIntent);
  assertEquals(r.accepted.length, 0);
  assert(r.rejected.every((x) => /profile\/equity/.test(x.reason)));
});

Deno.test("filter: Chief of Staff + Executive Assistant accepted with source proof", () => {
  const r = filterHiringCandidates([withUrl("Z", "Chief of Staff to CEO"), withUrl("W", "Executive Assistant")], assistantIntent);
  assertEquals(r.accepted.length, 2);
});

Deno.test("filter: missing source URL → rejected at proof stage", () => {
  const r = filterHiringCandidates([{ company: "NoUrl", job_title: "Executive Assistant", source_url: null }], assistantIntent);
  assertEquals(r.accepted.length, 0);
  assert(r.rejected.some((x) => /no source proof/.test(x.reason)));
});

Deno.test("filter: trace records before/after/rejected per stage", () => {
  const cands = [withUrl("A", "Executive Assistant"), withUrl("B", "Senior AI Engineer"), { company: "C", job_title: "Chief of Staff", source_url: null }];
  const r = filterHiringCandidates(cands, assistantIntent);
  assert(r.trace.length >= 2);
  assert(r.trace.every((t) => t.before_count >= t.after_count));
  assertEquals(r.accepted.length, 1); // only the EA with a URL
});

Deno.test("filter: dedupe same company+title+url", () => {
  const c = withUrl("Dup", "Executive Assistant");
  const r = filterHiringCandidates([c, { ...c }], assistantIntent);
  assertEquals(r.accepted.length, 1);
});

// ---------- role family library ----------

Deno.test("roleFamilies: classify + match + profile-title guards", () => {
  assertEquals(classifyRoleFamily("Executive Assistant"), "assistant_founder_support");
  assertEquals(classifyRoleFamily("SDR"), "gtm_sales");
  assertEquals(classifyRoleFamily("Product Marketing Manager"), "marketing_growth");
  assert(roleMatchesFamily("Chief of Staff", "assistant_founder_support"));
  assert(!roleMatchesFamily("Senior AI Engineer", "assistant_founder_support"));
  assert(isProfileOrEquityTitle("Co-Founder & CEO"));
  assert(!isProfileOrEquityTitle("Founder's Office Associate")); // support role, not equity
});

Deno.test("tierFromScore: A/B/C + proof gating", () => {
  assertEquals(tierFromScore(80, true), "A");
  assertEquals(tierFromScore(60, true), "B");
  assertEquals(tierFromScore(80, false), "C"); // no source proof caps at C
});

// ---- Confirmed-Start routing invariant (the lead_intent threaded to the card) ----
Deno.test("confirmed-route: assistant-hiring lead_intent carries jobs (never people)", () => {
  const i = extractLeadIntent({ message: "I want founders hiring for assistant roles so I can target them with my AI SaaS product." });
  // This is the exact object the card threads back on Start.
  assertEquals(i.workflow_type, "company_hiring_sourcing");
  assertEquals(i.source_type, "jobs");
  assert(i.source_type !== "people", "must not route to people search");
  const job = planJobsActorInput(i);
  assert(job.role_keywords.some((k) => /assistant|chief of staff/i.test(k)));
});

Deno.test("confirmed-route: GTM hiring lead_intent also carries jobs", () => {
  const i = extractLeadIntent({ message: "Find companies hiring SDRs in the US." });
  assertEquals(i.workflow_type, "company_hiring_sourcing");
  assertEquals(i.source_type, "jobs");
});

// ---- Phase 7: regression from the real bad exported CSV ----
const assistantQ = extractLeadIntent({ message: "I want founders hiring for assistant roles in USA. Help me find them." });
const withProof = (company: string, job_title: string): RawCandidate => ({ company, job_title, source_url: `https://www.linkedin.com/jobs/view/${company.replace(/\s/g,'')}` });

Deno.test("Phase7: the exact bad CSV founder/profile rows are all rejected", () => {
  const bad: RawCandidate[] = [
    withProof("My Medical Records.ai", "Co-Founder"),
    withProof("FutureSight", "Entrepreneur in Residence / Technical Co-founder"),
    withProof("AI House", "Founder / Entrepreneur in Residence"),
    { company: "EmptyTitleCo", job_title: "", source_url: "https://linkedin.com/jobs/view/x" },
    { company: "NoProofCo", job_title: "Executive Assistant", source_url: "proof_incomplete" },
    { company: "NullCo", job_title: "Executive Assistant", source_url: null },
  ];
  const r = filterHiringCandidates(bad, assistantQ);
  assertEquals(r.accepted.length, 0);
  // reasons cover profile/equity, missing title, no source proof
  const reasons = r.rejected.map((x) => x.reason).join("|");
  assert(/profile\/equity/.test(reasons));
  assert(/missing job_title/.test(reasons));
  assert(/no source proof/.test(reasons));
});

Deno.test("Phase7: valid assistant/founder-support rows accepted ONLY with source proof", () => {
  const good: RawCandidate[] = [
    withProof("Acme", "Executive Assistant"),
    withProof("Beta", "Assistant to CEO"),
    withProof("Gamma", "Chief of Staff to CEO"),
    withProof("Delta", "Founder's Office"),
    withProof("Eps", "Operations Assistant"),
    withProof("Zeta", "Administrative Assistant"),
    withProof("Eta", "Office Manager"),
  ];
  const r = filterHiringCandidates(good, assistantQ);
  assertEquals(r.accepted.length, good.length);
  // same titles WITHOUT proof → all rejected
  const noProof = good.map((g) => ({ ...g, source_url: "proof_incomplete" }));
  assertEquals(filterHiringCandidates(noProof, assistantQ).accepted.length, 0);
});

Deno.test("Phase7: Amae Health 'Founder Associate, Ops' accepted ONLY with real job proof", () => {
  // Founder Associate is a support role (not equity) — accept WITH proof, reject without.
  assertEquals(filterHiringCandidates([withProof("Amae Health", "Founder Associate, Growth & Partnership Operations")], assistantQ).accepted.length, 1);
  assertEquals(filterHiringCandidates([{ company: "Amae Health", job_title: "Founder Associate, Growth & Partnership Operations", source_url: "proof_incomplete" }], assistantQ).accepted.length, 0);
});

Deno.test("routing: 'competitor conversations around Clay and 11x' → competitor_mentions (not unknown)", () => {
  const i = extractLeadIntent({ message: "Show competitor conversations around Clay and 11x." });
  assertEquals(i.source_type, "comments");
  assertEquals(i.workflow_type, "competitor_signal_sourcing");
});

// ---- Company-Brain ICP constraints threaded into LeadIntent (Phase 3) ----
Deno.test("extractLeadIntent: threads extended Brain ICP (industries/size/negatives/types/competitors)", () => {
  const li = extractLeadIntent({
    message: "Find founders hiring executive assistants.",
    brain: {
      icp: {
        industries: ["B2B SaaS"], geography: "North America", company_size: "5-150 employees",
        negative_industries: ["Manufacturing"], excluded_company_types: ["Agency", "Consultancy"],
        funding_stage: ["Seed", "Series A"], company_model: ["Product-led"], allow_enterprise: false,
        disqualifiers: ["Recruiting firms"],
      },
      competitors: ["Clay", "11x"],
    },
  });
  assertEquals(li.positive_industries, ["B2B SaaS"]);
  assert((li.negative_industries ?? []).includes("Manufacturing"));
  assert((li.excluded_company_types ?? []).includes("Agency"));
  assertEquals(li.target_company_size, ["5-150 employees"]);
  assert((li.funding_stage ?? []).includes("Seed"));
  assert((li.competitors ?? []).includes("Clay"));
  assertEquals(li.allow_enterprise, false);
  assert((li.disqualifiers ?? []).includes("Recruiting firms"));
});

Deno.test("icpConstraintsFromIntent: SaaS 5-150 → max 150, not enterprise, SaaS positive", async () => {
  const { icpConstraintsFromIntent } = await import("./companyIcpFilter.ts");
  const li = extractLeadIntent({
    message: "Find founders hiring executive assistants.",
    brain: { icp: { industries: ["B2B SaaS"], company_size: "5-150 employees" } },
  });
  const cons = icpConstraintsFromIntent(li);
  assertEquals(cons.max_employees, 150);
  assertEquals(cons.allow_enterprise, false);
  assert((cons.positive_industries ?? []).includes("B2B SaaS"));
});
