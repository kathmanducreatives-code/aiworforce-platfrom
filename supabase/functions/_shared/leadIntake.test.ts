import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isLeadIntakeRequest,
  extractLeadDetails,
  hasEnoughToRun,
  buildLeadIntakeForm,
  brainPrefill,
  leadRequestToToolInput,
  leadRequestToInstruction,
  leadRequestToLinkedInFallbackInstruction,
  leadRequestToCompaniesInstruction,
  modeFromLabel,
  isLeadIntakeRequest as _isLead,
  type LeadRequest,
} from "./leadIntake.ts";

const BRAIN_STRUCTURED = {
  company_name: "Agentory",
  icp: { buyer_roles: ["Founder", "Head of GTM"], industries: ["B2B SaaS"], geography: "USA" },
  goals: { gtm: "find warm leads", competitor_tracking: "track competitors" },
  competitors: { known: ["Clay", "Artisan"] },
};

Deno.test("triggers fire on the listed phrases", () => {
  for (const p of ["Find me leads", "Get me prospects", "Find people to reach out to", "Find companies for me", "Find buyers"]) {
    assert(isLeadIntakeRequest(p), `should trigger: ${p}`);
  }
  assert(!isLeadIntakeRequest("What can you do?"));
});

Deno.test("people-role asks trigger; LinkedIn/hiring/competitor do not", () => {
  assert(isLeadIntakeRequest("Find founders building AI products"));
  assert(isLeadIntakeRequest("Find me 5 founders building AI software in healthcare in the USA"));
  assert(!isLeadIntakeRequest("Find 5 LinkedIn posts where founders talk about outbound"), "Phase 3 flow must not be hijacked");
  assert(!isLeadIntakeRequest("Find 5 people talking about Clay on LinkedIn"));
  assert(!isLeadIntakeRequest("Find companies hiring GTM roles"));
});

Deno.test("#3 complete brief runs directly (no form)", () => {
  const d = extractLeadDetails("Find me 5 founders building AI software in healthcare in the USA.");
  assertEquals(d.mode, "people");
  assertEquals(d.target_role, "Founder");
  assertEquals(d.industry, "Healthcare");
  assertEquals(d.location, "USA");
  assertEquals(d.count, 5);
  assert(hasEnoughToRun(d), "complete brief should run directly");
});

Deno.test("#4 partial request shows form (founder + AI products prefilled, missing industry/location/count)", () => {
  const d = extractLeadDetails("Find founders building AI products.");
  assertEquals(d.mode, "people");
  assertEquals(d.target_role, "Founder");
  assert((d.company_category ?? "").toLowerCase().includes("ai products"));
  assertEquals(d.industry, null);
  assert(!hasEnoughToRun(d), "partial request should NOT run directly");
});

Deno.test("#6 people vs jobs routing", () => {
  const people = extractLeadDetails("founders building AI software");
  assertEquals(people.mode, "people");
  const ti = leadRequestToToolInput({ mode: "people", target_role: "Founder", count: 5, needs_outreach: false, original_user_request: "x", company_brain_context_used: false });
  assertEquals(ti.selected_actor_key, "apify_people_search");
  assert(ti.selected_actor_key !== "apify_jobs", "people must not use jobs actor");

  const hiring = extractLeadDetails("find companies hiring GTM roles");
  assertEquals(hiring.mode, "hiring");
  const tij = leadRequestToToolInput({ mode: "hiring", target_role: "GTM", count: 5, needs_outreach: false, original_user_request: "x", company_brain_context_used: false });
  assertEquals(tij.selected_actor_key, "apify_jobs");
});

Deno.test("#7 count cap respected", () => {
  const ti = leadRequestToToolInput({ mode: "people", count: 5, needs_outreach: false, original_user_request: "x", company_brain_context_used: false });
  assertEquals(ti.max_results, 5);
  const big = leadRequestToToolInput({ mode: "people", count: 999, needs_outreach: false, original_user_request: "x", company_brain_context_used: false });
  assertEquals(big.max_results, 25);
});

Deno.test("#8 outreach toggle → outreach mode (Penn drafts later, no send)", () => {
  const ti = leadRequestToToolInput({ mode: "people", count: 5, needs_outreach: true, original_user_request: "x", company_brain_context_used: false });
  assert(ti.needs_outreach);
  assertEquals(ti.execution_mode, "outreach");
  const instr = leadRequestToInstruction({ mode: "people", target_role: "Founder", count: 5, needs_outreach: true, original_user_request: "x", company_brain_context_used: false });
  assert(/do not send/i.test(instr), "instruction must forbid sending");
});

Deno.test("#1 form prefilled from Company Brain when details missing", () => {
  const d = extractLeadDetails("Find me leads");
  const form = buildLeadIntakeForm(d, BRAIN_STRUCTURED, true);
  assertEquals(form.kind, "lead_intake");
  assertEquals(form.title, "Lead Search Brief");
  assert(form.brain_used);
  const role = form.fields.find((f) => f.key === "target_role");
  assertEquals(role?.value, "Founder"); // from brain buyer_roles
  const ind = form.fields.find((f) => f.key === "industry");
  assertEquals(ind?.value, "B2B SaaS");
  const loc = form.fields.find((f) => f.key === "location");
  assertEquals(loc?.value, "USA");
});

Deno.test("#2 form without brain flags missing brain + still asks target", () => {
  const d = extractLeadDetails("Find me leads");
  const form = buildLeadIntakeForm(d, null, false);
  assert(form.brain_missing);
  assert(!form.brain_used);
  const count = form.fields.find((f) => f.key === "count");
  assertEquals(count?.value, "5"); // safe default
});

Deno.test("#10 explicit user input overrides Company Brain (healthcare AI founders, not Data Analysts)", () => {
  const brainSaysAnalysts = { icp: { buyer_roles: ["Data Analyst"], industries: ["Fintech"], geography: "UK" } };
  const d = extractLeadDetails("Find founders building AI software in healthcare in USA");
  const form = buildLeadIntakeForm(d, brainSaysAnalysts, true);
  assertEquals(form.fields.find((f) => f.key === "target_role")?.value, "Founder");
  assertEquals(form.fields.find((f) => f.key === "industry")?.value, "Healthcare");
  assertEquals(form.fields.find((f) => f.key === "location")?.value, "USA");
});

Deno.test("brainPrefill: goal-driven mode + roles", () => {
  const pre = brainPrefill(BRAIN_STRUCTURED);
  assertEquals(pre.mode, "competitor_engagement"); // goals mention competitor tracking
  assertEquals(pre.target_role, "Founder");
  assertEquals(pre.industry, "B2B SaaS");
  assertEquals(pre.location, "USA");
});

Deno.test("modeFromLabel maps UI labels", () => {
  assertEquals(modeFromLabel("People / profiles"), "people");
  assertEquals(modeFromLabel("Companies / accounts"), "companies");
  assertEquals(modeFromLabel("Hiring signals"), "hiring");
  assertEquals(modeFromLabel("LinkedIn conversations"), "signals");
  assertEquals(modeFromLabel("Competitor engagement"), "competitor_engagement");
});

Deno.test("people-unavailable fallbacks: LinkedIn instruction routes away from people actor + respects count", () => {
  const req: LeadRequest = { mode: "people", target_role: "Founder", industry: "Healthcare", location: "USA", company_category: "AI software", count: 5, needs_outreach: false, original_user_request: "Find me leads", company_brain_context_used: false };
  const li = leadRequestToLinkedInFallbackInstruction(req);
  assert(li.startsWith("Find 5 LinkedIn posts about"));
  assert(/founder/i.test(li) && /healthcare/i.test(li) && /usa/i.test(li));
  // contains "LinkedIn" → excluded from lead-intake → routes to linkedin_engagement, not people search.
  assert(!_isLead(li), "LinkedIn fallback must not re-trigger the people lead form");
  assert(/do not send/i.test(li));

  const co = leadRequestToCompaniesInstruction(req);
  assert(/companies hiring/i.test(co) && co.includes("Find 5"));
  assert(!_isLead(co), "companies/hiring fallback routes to jobs, not the lead form");
});

Deno.test("instruction is complete + count-accurate", () => {
  const req: LeadRequest = { mode: "people", target_role: "Founder", industry: "Healthcare", location: "USA", company_category: "AI software", count: 5, needs_outreach: false, original_user_request: "Find me leads", company_brain_context_used: true };
  const instr = leadRequestToInstruction(req);
  assert(instr.startsWith("Find 5 "));
  assert(/healthcare/i.test(instr) && /usa/i.test(instr) && /founder/i.test(instr));
});
