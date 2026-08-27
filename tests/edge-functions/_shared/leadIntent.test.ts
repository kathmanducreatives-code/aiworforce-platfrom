import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  planJobsActorInput, filterHiringCandidates, tierFromScore, type LeadIntent,
  type RawCandidate,
} from "../../../supabase/functions/_shared/leadIntent.ts";
import { classifyRoleFamily, roleMatchesFamily, isProfileOrEquityTitle } from "../../../supabase/functions/_shared/roleFamilies.ts";

// ---------- Intent extraction (separates product / buyer / role / source) ----------

// ── THE PARSER TESTS ARE GONE WITH THE PARSER ───────────────────────────────
//
// Nine tests lived here proving that `extractLeadIntent` read English
// correctly: that "companies selling to founders" was a company search, that
// "posts about Claude Code workflows" was linkedin_posts, and so on. They were
// the only thing still holding that classifier alive — it had no callers left.
//
// They are not replaced. Deciding what a sentence means is Chat Brain's job
// now, and it is tested where that decision is made: RequestV1 objectives, the
// objective router, and the end-to-end path through `handlePilotChat`. A second
// set of expectations about English, asserted against a second parser, is the
// thing this cleanup exists to remove.
//
// What remains below tests `filterHiringCandidates` and `tierFromScore` — pure
// scoring over provider results, which never read a user's sentence.

/**
 * The intent an assistant-hiring mission projects to.
 *
 * A LITERAL, not a parse. It used to be `extractLeadIntent({ message: ... })`,
 * so a filter test depended on a classifier's reading of a sentence; a change in
 * the regexes could pass or fail a test about candidate scoring. Stating the
 * shape directly is what makes these tests about the filter.
 */
const assistantIntent: LeadIntent = {
  workflow_type: "company_hiring_sourcing",
  source_type: "jobs",
  target_buyer: ["Founder"],
  target_company_type: [],
  target_industry: [],
  target_geography: ["USA"],
  target_company_size: [],
  target_stage: [],
  hiring_signal: {
    requested: true,
    role_family: "assistant_founder_support",
    role_keywords: ["assistant"],
    exclude_role_keywords: [],
  },
  pain_points: [],
  competitors: [],
  keywords: [],
  disqualifiers: [],
  count: 5,
  strictness: "balanced",
  confidence: 1,
  clarification_needed: false,
};
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

// ── FOUR MORE PARSER TESTS REMOVED ─────────────────────────────────────────
//
// They asserted that `extractLeadIntent` routed "assistant hiring" to jobs,
// "competitor conversations" to comments, and that Company Brain ICP threaded
// through its output. All three are claims about how a regex reads English, and
// the regex is gone. The equivalent claims about the LIVE path are made against
// `leadIntentFromMission` — a projection of a compiled mission — and against
// Chat Brain's own objective tests.
//
// `planJobsActorInput` was asserted inside one of them; that assertion survives
// below, against the literal intent, because it is about provider input rather
// than about language.

Deno.test("planJobsActorInput: an assistant-hiring intent produces assistant role keywords", () => {
  const job = planJobsActorInput(assistantIntent);
  assert(job.role_keywords.some((k) => /assistant|chief of staff/i.test(k)),
    "the jobs actor must search the role family the mission asked for");
});

Deno.test("icpConstraintsFromIntent: SaaS 5-150 → max 150, not enterprise, SaaS positive", async () => {
  const { icpConstraintsFromIntent } = await import("../../../supabase/functions/_shared/companyIcpFilter.ts");
  // The ICP fields stated directly. This test is about how
  // `icpConstraintsFromIntent` reads an intent, not about how a parser built one.
  const cons = icpConstraintsFromIntent({
    ...assistantIntent,
    positive_industries: ["B2B SaaS"],
    target_company_size: ["5-150 employees"],
    allow_enterprise: false,
  });
  assertEquals(cons.max_employees, 150);
  assertEquals(cons.allow_enterprise, false);
  assert((cons.positive_industries ?? []).includes("B2B SaaS"));
});
