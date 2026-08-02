// Signals workflow — the 14 required deterministic scenarios + two-workspace
// isolation. Pure: compiler + planner + scorer + access guard. NO provider calls.
//
// Workspace A: B2B SaaS founders; excludes staffing/recruiting agencies.
// Workspace B: a recruitment agency; its ICP is staffing/recruiting/talent
//              businesses (regional expansion) — staffing is ALLOWED, not a reject.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileCompanyBrainContext } from "../../functions/_shared/companyBrainCompiler.ts";
import { buildRadarScanPlan, type RadarSource } from "../../functions/_shared/radarScanPlanner.ts";
import { scoreAgainstCompanyBrain, type SignalCandidate } from "../../functions/_shared/icpSignalScorer.ts";
import { decideWorkspaceAccess } from "../../functions/_shared/workspaceAccessGuard.ts";

// ---- fixtures --------------------------------------------------------------
function brainA(extra: Record<string, unknown> = {}) {
  return compileCompanyBrainContext({
    workspace_id: "wsA",
    profile: {
      company: { category: "AI SaaS", description: "AI workforce OS for B2B SaaS founders" },
      icp: {
        buyer_roles: ["Founder", "RevOps", "SDR"], company_size: "10-150 employees",
        industries: ["B2B SaaS", "AI SaaS"], geography: "United States",
        disqualifiers: ["staffing", "recruiting agency"], pain_points: ["pipeline before hiring"],
      },
      competitors: { known: ["Clay", "Apollo"] },
      ...extra,
    },
    signal_preferences: { workflow_topics: ["outbound automation"] },
  });
}

// A recruitment agency whose *targets* are staffing / recruiting / talent firms.
// Deliberately NO SaaS/software words → must not trip the software-ICP staffing reject.
function brainB(extra: Record<string, unknown> = {}) {
  return compileCompanyBrainContext({
    workspace_id: "wsB",
    profile: {
      company: { category: "Recruitment Agency", description: "We help staffing and recruiting firms expand into new regions" },
      icp: {
        buyer_roles: ["Head of Talent", "Managing Director", "Recruitment Lead"],
        company_size: "50-500 employees", industries: ["staffing", "recruiting agency", "talent acquisition"],
        geography: "Europe", pain_points: ["regional expansion hiring"],
      },
      ...extra,
    },
    signal_preferences: {},
  });
}

function hiringPlan(brain: ReturnType<typeof brainA>, source: RadarSource = "hiring") {
  return buildRadarScanPlan(brain, { firecrawlReady: true, apifyReady: false }).source_plan.find((p) => p.source === source)!;
}
function allQueryText(brain: ReturnType<typeof brainA>): string {
  const s = hiringPlan(brain).staged_queries;
  return [...s.exact, ...s.synonym, ...s.adjacent].join(" | ");
}
function cand(over: Partial<SignalCandidate> = {}): SignalCandidate {
  return { signal_type: "hiring", title: "role", ...over };
}

// ---- 1. active Company Brain drives Radar query ----------------------------
Deno.test("1. active Brain drives the hiring query (brain seeds + roles, not generic)", () => {
  const p = hiringPlan(brainA());
  assert(p.queries.some((q) => /saas/i.test(q)), "query uses the Brain's ICP category");
  assert(p.queries.some((q) => /RevOps|SDR|Founder/i.test(q)), "query uses the Brain's buyer roles");
});

// ---- 2. draft does not override the active brain ---------------------------
Deno.test("2. an unactivated draft degrades (setup_required); activation clears it", () => {
  const draft = brainA({ is_draft: true });
  assertEquals(draft.meta.setup_required, true, "draft must not drive verified signals");
  assert(buildRadarScanPlan(draft, { firecrawlReady: true }).setup_required);
  // Same content, activated (not a draft) → usable.
  assertEquals(brainA().meta.setup_required, false);
});

// ---- 3. saved ICP edit changes the next query ------------------------------
Deno.test("3. a saved ICP edit changes the next scan's queries", () => {
  const before = allQueryText(brainA());
  const after = allQueryText(brainA({ icp: {
    buyer_roles: ["Founder", "RevOps", "SDR", "Demand Gen Lead"], industries: ["B2B SaaS", "AI SaaS"],
    company_size: "10-150 employees", geography: "United States", disqualifiers: ["staffing", "recruiting agency"],
  } }));
  assert(before !== after, "editing the ICP must change the plan");
  assert(/Demand Gen Lead/i.test(after), "the newly-added buyer role appears in the new queries");
});

// ---- 4. buyer title alone cannot verify ------------------------------------
Deno.test("4. a buyer title alone (no ICP industry/size fit) never verifies", () => {
  const s = scoreAgainstCompanyBrain(cand({
    company_name: "Nimbus Foods", company_description: "regional food distribution company",
    job_title: "RevOps", source_url: "https://nimbusfoods.com/careers/1", job_url: "https://nimbusfoods.com/careers/1",
    job_description: "Own revenue operations", website: "https://nimbusfoods.com",
  }), brainA());
  assert(s.verification_status !== "verified", `got ${s.verification_status}`);
  assert(s.risk_flags.some((r) => /buyer\/title match only|ICP/i.test(r)) || s.missing_evidence.some((m) => /ICP/i.test(m)));
});

// ---- 5. evidence URL is required -------------------------------------------
Deno.test("5. an ICP-fit signal with no source URL cannot verify", () => {
  const s = scoreAgainstCompanyBrain(cand({
    company_name: "Acme SaaS", company_description: "B2B SaaS revenue platform", job_title: "SDR",
    employee_count: 60, /* no source_url / job_url */ evidence_text: "hiring an SDR",
  }), brainA());
  assert(s.verification_status !== "verified");
  assert(s.missing_evidence.some((m) => /source proof url/i.test(m)));
});

// ---- 6. disqualifier forces skip/reject ------------------------------------
Deno.test("6. a Brain disqualifier hard-rejects for workspace A", () => {
  const s = scoreAgainstCompanyBrain(cand({
    company_name: "TalentBridge Staffing", company_description: "a staffing agency placing contractors",
    job_title: "SDR", source_url: "https://talentbridge.com/jobs/1", website: "https://talentbridge.com",
  }), brainA());
  assertEquals(s.verification_status, "rejected");
  assert(s.disqualifiers_hit.length > 0);
});

// ---- 7. exact signal outranks generic fit ----------------------------------
Deno.test("7. exact ICP + trigger + buyer outranks a bare ICP-only mention", () => {
  const exact = scoreAgainstCompanyBrain(cand({
    company_name: "Acme SaaS", company_description: "B2B SaaS company scaling revenue", job_title: "SDR",
    employee_count: 60, source_url: "https://acme.com/jobs/1", job_url: "https://acme.com/jobs/1",
    job_description: "Hiring an SDR to build outbound pipeline", website: "https://acme.com",
    source_published_at: new Date().toISOString(),
  }), brainA());
  const generic = scoreAgainstCompanyBrain(cand({
    signal_type: "workflow_trend", company_name: "SomeCo", company_description: "an AI SaaS blog post",
    source_url: "https://blog.example.com/post", evidence_text: "AI SaaS trends",
  }), brainA());
  assert(exact.signal_score > generic.signal_score, `exact ${exact.signal_score} !> generic ${generic.signal_score}`);
});

// ---- 8. no brain → setup_required ------------------------------------------
Deno.test("8. an empty Brain returns setup_required, no fabricated ICP", () => {
  const empty = compileCompanyBrainContext({ workspace_id: "ws", profile: {} });
  assertEquals(empty.meta.setup_required, true);
  assertEquals(empty.icp.industries.length, 0);
  assert(buildRadarScanPlan(empty).setup_required);
});

// ---- 9. two workspaces produce different plans -----------------------------
Deno.test("9. workspace A and B produce different scan plans", () => {
  assert(allQueryText(brainA()) !== allQueryText(brainB()), "plans must diverge by workspace");
  assert(/saas/i.test(allQueryText(brainA())));
  assert(/staffing|recruit|talent/i.test(allQueryText(brainB())));
});

// ---- 10. unauthorized workspace is rejected --------------------------------
Deno.test("10. a frontend-supplied workspace_id cannot bypass membership", () => {
  const nonMember = decideWorkspaceAccess({ bearerIsServiceRole: false, authenticatedUserId: "u1", isMember: false });
  assertEquals(nonMember.ok, false);
  assert(!nonMember.ok && nonMember.status === 403);
  const member = decideWorkspaceAccess({ bearerIsServiceRole: false, authenticatedUserId: "u1", isMember: true });
  assertEquals(member.ok, true);
});

// ---- 11. missing evidence → needs_review / skip ----------------------------
Deno.test("11. an ICP-fit signal missing evidence becomes needs_verification", () => {
  const s = scoreAgainstCompanyBrain(cand({
    company_name: "Acme SaaS", company_description: "B2B SaaS", employee_count: 60,
    source_url: "https://acme.com/x", /* no job_title, no evidence_text/description */
  }), brainA());
  assert(s.verification_status !== "verified");
  assert(s.missing_evidence.length > 0);
});

// ---- 12. no fabricated funding / recency -----------------------------------
Deno.test("12. funding without amount/round is not verified and invents no date", () => {
  const s = scoreAgainstCompanyBrain(cand({
    signal_type: "funding", company_name: "Acme SaaS", company_description: "B2B SaaS company",
    source_url: "https://news.example.com/acme", evidence_text: "Acme raised funding",
    /* no funding_amount / funding_round / investors / source_published_at */
  }), brainA());
  assert(s.verification_status !== "verified", `funding verified without amount: ${s.verification_status}`);
  // No fabricated specifics: no invented dollar amount, year, or specific round.
  assert(!/\$|\d{4}|series\s+[a-z]/i.test(s.why_now), `why_now fabricated recency/amount: "${s.why_now}"`);
  assert(!/\$|\d{4}|series\s+[a-z]/i.test(s.why_it_matters), `why_it_matters fabricated: "${s.why_it_matters}"`);
});

// ---- 13. explicit geography is retained ------------------------------------
Deno.test("13. explicit geography survives every query stage", () => {
  const s = hiringPlan(brainA()).staged_queries;
  assert(s.exact.every((q) => /United States/.test(q)), "exact tier keeps geography");
  assert(s.adjacent.every((q) => /United States/.test(q)), "adjacent tier keeps geography");
});

// ---- 14. recruitment ICP is not blocked by anti-recruiting defaults --------
Deno.test("14. recruitment workspace B does NOT disqualify staffing; A still does", () => {
  const b = brainB();
  assert(!b.disqualifiers.industries.some((d) => /staffing|recruit/i.test(d)), "B must not auto-reject its own ICP");
  const staffingTarget = cand({
    company_name: "TalentBridge Staffing", company_description: "a staffing and recruiting agency expanding regionally",
    job_title: "Recruitment Lead", source_url: "https://talentbridge.com/jobs/1", website: "https://talentbridge.com",
    employee_count: 120, job_description: "Hiring recruiters for a new region",
  });
  const forB = scoreAgainstCompanyBrain(staffingTarget, b);
  const forA = scoreAgainstCompanyBrain(staffingTarget, brainA());
  assert(forB.verification_status !== "rejected", `B wrongly rejected its ICP: ${forB.disqualifiers_hit}`);
  assertEquals(forA.verification_status, "rejected"); // A explicitly excludes staffing → no leak either way
});
