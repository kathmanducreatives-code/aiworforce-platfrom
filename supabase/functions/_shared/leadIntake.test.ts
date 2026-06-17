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
  for (const p of ["Find me leads", "Scrape leads for me", "Get me prospects", "Find people to reach out to", "Find companies for me", "Find buyers"]) {
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

Deno.test("#4 people partials: bare role → selector; role+category → run", () => {
  // role + category is enough to attempt (people → LinkedIn fallback when disabled).
  const withCat = extractLeadDetails("Find founders building AI products.");
  assertEquals(withCat.mode, "people");
  assertEquals(withCat.target_role, "Founder");
  assert((withCat.company_category ?? "").toLowerCase().includes("ai products"));
  assert(hasEnoughToRun(withCat), "role + category should run (not stall)");

  // bare role with no industry/category is too vague → Source Selector.
  const bare = extractLeadDetails("Find founders.");
  assert(!hasEnoughToRun(bare), "bare role should fall to the Source Selector");
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

import { buildLeadSourceSelector, leadRequestToToolInput as _toTI, type ToolAvailability, type LeadSourceType } from "./leadIntake.ts";

const ALL_AVAILABLE: ToolAvailability = { people: true, comments: true, firecrawl: true };

Deno.test("Lead Source Selector: 7 engines, fields per source, brain competitors prefilled", () => {
  const sel = buildLeadSourceSelector(extractLeadDetails("Find me leads"), BRAIN_STRUCTURED, true, ALL_AVAILABLE);
  assertEquals(sel.kind, "lead_source_selector");
  assertEquals(sel.title, "Choose a lead source");
  const ids = sel.sources.map((s) => s.source_type);
  for (const want of ["icp_search", "hiring_signal", "linkedin_posts", "linkedin_comments", "competitor_engagement", "people_profiles", "company_search"]) {
    assert(ids.includes(want as LeadSourceType), `missing source ${want}`);
  }
  // competitor source prefills competitors from brain
  const comp = sel.sources.find((s) => s.source_type === "competitor_engagement")!;
  const compField = comp.fields.find((f) => f.key === "competitors")!;
  assert(String(compField.value ?? "").includes("Clay"));
  // every source has a count field defaulting to 5
  for (const s of sel.sources) {
    const c = s.fields.find((f) => f.key === "count");
    assertEquals(c?.value, "5");
  }
});

Deno.test("Selector: unavailable actors show honest fallbacks, stay visible", () => {
  const sel = buildLeadSourceSelector(extractLeadDetails("Find me leads"), null, false, { people: false, comments: false, firecrawl: false });
  const comments = sel.sources.find((s) => s.source_type === "linkedin_comments")!;
  assert(!comments.available && /configured/i.test(comments.fallback_note ?? ""));
  const people = sel.sources.find((s) => s.source_type === "people_profiles")!;
  assert(!people.available && /LinkedIn engagement/i.test(people.fallback_note ?? ""));
  const company = sel.sources.find((s) => s.source_type === "company_search")!;
  assert(/Company Brain|description/i.test(company.fallback_note ?? ""), "firecrawl-off note on company search");
});

Deno.test("source_type routing: each engine maps to the right actor", () => {
  const mk = (source_type: LeadSourceType, extra: Partial<LeadRequest> = {}): LeadRequest =>
    ({ source_type, mode: "people", count: 5, needs_outreach: false, original_user_request: "x", company_brain_context_used: false, ...extra });
  assertEquals(_toTI(mk("hiring_signal")).selected_actor_key, "apify_jobs");
  assertEquals(_toTI(mk("company_search")).selected_actor_key, "apify_jobs");
  assertEquals(_toTI(mk("linkedin_posts")).selected_actor_key, "apify_linkedin_posts");
  assertEquals(_toTI(mk("linkedin_comments")).selected_actor_key, "apify_linkedin_post_comments");
  const comp = _toTI(mk("competitor_engagement", { competitors: ["Clay", "Apollo"] }));
  assertEquals(comp.selected_actor_key, "apify_linkedin_posts");
  assertEquals(comp.signal_type, "competitor_engagement");
  assertEquals(_toTI(mk("people_profiles")).selected_actor_key, "apify_people_search");
  assert(_toTI(mk("people_profiles")).selected_actor_key !== "apify_jobs", "people never use jobs");
});

Deno.test("source instructions route correctly + don't re-open the selector", () => {
  const base: LeadRequest = { mode: "people", count: 5, needs_outreach: false, original_user_request: "x", company_brain_context_used: false };
  const hiring = leadRequestToInstruction({ ...base, source_type: "hiring_signal", target_role: "GTM", location: "USA" });
  assert(/companies hiring GTM roles/i.test(hiring));
  const comp = leadRequestToInstruction({ ...base, source_type: "competitor_engagement", competitors: ["Clay"] });
  assert(/talking about Clay/i.test(comp) && !_isLead(comp));
  const posts = leadRequestToInstruction({ ...base, source_type: "linkedin_posts", topic: "outbound problems" });
  assert(/LinkedIn posts about outbound problems/i.test(posts) && !_isLead(posts));
});

Deno.test("hasNewSourcingIntent: a lead brief beats save/refine handlers", async () => {
  const { hasNewSourcingIntent } = await import("./leadIntake.ts");
  // #1/#2 new sourcing brief (even with "Save them to Signal Feed") → new sourcing.
  assert(hasNewSourcingIntent("Find 5 founder AI Software in healthcare in USA. Save them to Signal Feed. Do not send any outreach."));
  assert(hasNewSourcingIntent("Find 5 companies hiring GTM roles. Save them to Signal Feed."));
  assert(hasNewSourcingIntent("Find 5 founder/profile leads in healthcare AI software in the USA. Open results in Workbench."));
  // #3/#4 genuine save actions (no sourcing verb) → NOT new sourcing.
  assert(!hasNewSourcingIntent("Save these leads to the Signal Feed for later review."));
  assert(!hasNewSourcingIntent("Save these 4 leads."));
  // #5 refine → not new sourcing.
  assert(!hasNewSourcingIntent("Only keep US companies."));
  assert(!hasNewSourcingIntent("Rank these leads by fit."));
});

Deno.test("founder brief still routes to lead intake (people) after copy change", () => {
  const msg = "Find 5 founder AI Software in healthcare in USA. Open results in Workbench. Do not send any outreach.";
  assert(isLeadIntakeRequest(msg));
  const d = extractLeadDetails(msg);
  assertEquals(d.target_role, "Founder");
  assertEquals(d.location, "USA");
  assert(hasEnoughToRun(d), "founder + healthcare/AI software → runs (people)");
});

Deno.test("instruction is complete + count-accurate", () => {
  const req: LeadRequest = { mode: "people", target_role: "Founder", industry: "Healthcare", location: "USA", company_category: "AI software", count: 5, needs_outreach: false, original_user_request: "Find me leads", company_brain_context_used: true };
  const instr = leadRequestToInstruction(req);
  assert(instr.startsWith("Find 5 "));
  assert(/healthcare/i.test(instr) && /usa/i.test(instr) && /founder/i.test(instr));
});
