// Company Brain consumption audit — deterministic isolation + wiring tests.
//
// Proves, with stub DBs only (no Supabase, no providers), that:
//   * the shared loader enforces workspace membership;
//   * two workspaces compile to DIFFERENT ICPs with no cross-leak;
//   * a no-brain workspace yields setup_required (never a fabricated ICP);
//   * legacy profile.icp does not override a richer active v2 brain;
//   * the run-agent brain-block injection only emits the ACTIVE brain (Fix A);
//   * the workspace access guard fail-closes a frontend-supplied workspace_id.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  getCompiledCompanyBrainForWorkspace, buildCanonicalCompanyBrain, type BrainDbClient,
} from "./getCompiledCompanyBrainForWorkspace.ts";
import { renderCompanyBrainBlock } from "./companyBrainContext.ts";
import { decideWorkspaceAccess } from "./workspaceAccessGuard.ts";

// -------------------------------------------------------- fictional brains ---

// Workspace A — B2B SaaS founder tool.
const BRAIN_A = {
  company: { name: "Acme GTM", description: "AI workforce for B2B SaaS founders", business_model: "B2B SaaS", category: "AI-powered lead intelligence" },
  target_customer: {
    industries: ["B2B SaaS"], business_models: ["B2B SaaS"], company_size: { label: "1-50" },
    geography: ["United States"], must_have: ["founder-led"],
    disqualifiers: { industries: ["staffing and recruiting"], company_types: ["agencies"], keywords: ["recruiting agency"], titles: [], domains: [] },
  },
  buyer_personas: ["Founder / CEO", "Head of Growth"],
  triggers: ["hiring SDRs", "raised funding", "outbound expansion"], jobs_to_watch: ["SDR", "BDR"],
  pain_points: ["pipeline inconsistent"], content_angles: ["pipeline before payroll"],
  positioning: { promise: "Pipeline before payroll", avoid_positioning: ["spam"] },
  brand_voice: { tone: "direct, founder-focused", avoid: ["hype without proof"] },
  qualification_rules: { required_evidence: ["website confirms fit"], reject_if: ["matches a disqualifier"], manual_review_if: ["fit unclear"] },
  // Legacy icp projection that activate() writes (mergeLegacyIcpProjection).
  icp: { industries: ["B2B SaaS"], buyer_roles: ["Founder", "Head of Growth"], disqualifiers: ["staffing and recruiting"], company_size: "1-50" },
  onboarding_completed: true, setup_status: "complete",
};

// Workspace B — recruitment agency.
const BRAIN_B = {
  company: { name: "Staffr", description: "software recruitment agency hiring GTM and engineering talent for tech startups", business_model: "agency / services", category: "staffing services" },
  target_customer: {
    industries: ["high-growth tech startups", "venture-backed SaaS"], business_models: [], company_size: { label: "11-500" },
    geography: ["EMEA"], must_have: ["actively hiring"],
    disqualifiers: { industries: ["companies not actively hiring"], company_types: ["other staffing agencies"], keywords: ["hiring freeze"], titles: [], domains: [] },
  },
  buyer_personas: ["Founder / CEO", "Head of Talent"],
  triggers: ["opened new roles", "raised funding", "hiring expansion"], jobs_to_watch: ["VP Engineering", "Head of Talent"],
  pain_points: ["can't find elite talent fast"], content_angles: ["how to hire your founding team"],
  positioning: { promise: "hire elite talent fast" },
  brand_voice: { tone: "direct, human" },
  icp: { industries: ["high-growth tech startups"], buyer_roles: ["Founder", "Head of Talent"], disqualifiers: ["companies not actively hiring", "hiring freeze"], company_size: "11-500" },
  onboarding_completed: true, setup_status: "complete",
};

// Legacy-vs-v2: rich v2 target industry + a generic legacy icp that must NOT win.
const BRAIN_LEGACY = {
  company: { name: "Fin", description: "fintech infra", business_model: "B2B SaaS" },
  target_customer: { industries: ["Fintech"], business_models: ["B2B SaaS"], disqualifiers: { industries: [], company_types: [], keywords: [], titles: [], domains: [] } },
  buyer_personas: ["Head of Payments"], triggers: ["raised funding"], pain_points: ["x"], content_angles: ["y"],
  icp: { industries: ["Generic SaaS", "Everyone"], buyer_roles: ["Anyone"] }, // legacy projection — generic
  onboarding_completed: true,
};

const WS = {
  "ws-A": { members: ["user-A"], profile: BRAIN_A },
  "ws-B": { members: ["user-B"], profile: BRAIN_B },
  "ws-legacy": { members: ["user-A"], profile: BRAIN_LEGACY },
  "ws-empty": { members: ["user-A"], profile: undefined as unknown as Record<string, unknown> | undefined },
} as Record<string, { members: string[]; profile?: Record<string, unknown> }>;

/** Stub matching BrainDbClient: workspace_members (two .eq) + company_brain (one .eq). */
function makeDb(): BrainDbClient {
  return {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_c1: string, wsId: string) {
              return {
                // workspace_members: .eq("user_id", uid).maybeSingle()
                eq(_c2: string, userId: string) {
                  return {
                    maybeSingle: () =>
                      Promise.resolve({ data: WS[wsId]?.members.includes(userId) ? { workspace_id: wsId } : null }),
                  };
                },
                // company_brain: .maybeSingle()
                maybeSingle: () =>
                  Promise.resolve({ data: WS[wsId]?.profile ? { profile: WS[wsId]!.profile } : null }),
              };
            },
          };
        },
      };
    },
  };
}

// --------------------------------------------------------------- membership --

Deno.test("consume-1. loader enforces workspace membership (no userId → forbidden)", async () => {
  const r = await getCompiledCompanyBrainForWorkspace(makeDb(), "ws-A", {});
  assertEquals(r.ok, false);
  assertEquals(r.error, "forbidden");
});

Deno.test("consume-2. a member loads their own brain", async () => {
  const r = await getCompiledCompanyBrainForWorkspace(makeDb(), "ws-A", { userId: "user-A" });
  assert(r.ok && r.brain);
  assert(r.brain!.target_customer.industries.includes("B2B SaaS"));
});

Deno.test("consume-3. a frontend-supplied workspace_id cannot load another workspace's brain", async () => {
  // user-A is NOT a member of ws-B.
  const r = await getCompiledCompanyBrainForWorkspace(makeDb(), "ws-B", { userId: "user-A" });
  assertEquals(r.ok, false);
  assertEquals(r.error, "forbidden");
  assertEquals(r.brain, null);
});

// ---------------------------------------------------- two-workspace outputs --

Deno.test("consume-4. two workspaces compile to different ICPs, with no cross-leak", async () => {
  const a = (await getCompiledCompanyBrainForWorkspace(makeDb(), "ws-A", { userId: "user-A" })).brain!;
  const b = (await getCompiledCompanyBrainForWorkspace(makeDb(), "ws-B", { userId: "user-B" })).brain!;
  const A = JSON.stringify(a), B = JSON.stringify(b);

  // Distinctive, brain-specific tokens (promises / angles / disqualifier
  // keywords) — not generic SaaS expansions — must not cross workspaces.
  assert(A.includes("pipeline before payroll") && !A.includes("how to hire your founding team"), "A content isolated");
  assert(B.includes("how to hire your founding team") && !B.includes("pipeline before payroll"), "B content isolated");
  assert(A.includes("Pipeline before payroll") && !A.includes("hire elite talent fast"), "A positioning isolated");
  assert(B.includes("hire elite talent fast") && !B.includes("Pipeline before payroll"), "B positioning isolated");
  assert(B.includes("hiring freeze") && !A.includes("hiring freeze"), "B disqualifiers do not leak into A");
  assert(A.includes("Head of Talent") === false, "B's unique persona 'Head of Talent' does not leak into A");

  // Compiled query strategy + targeting genuinely differ (drives Leads + Radar queries).
  assert(JSON.stringify(a.query_strategy) !== JSON.stringify(b.query_strategy), "query strategies differ");
  assert(JSON.stringify(a.target_customer.industries) !== JSON.stringify(b.target_customer.industries), "targeting differs");
  assert(JSON.stringify(a.content_angles) !== JSON.stringify(b.content_angles), "content angles differ");
});

// ----------------------------------------------------- honesty / no-fabricate --

Deno.test("consume-5. no-brain workspace → setup_required, never a fabricated ICP", async () => {
  const r = await getCompiledCompanyBrainForWorkspace(makeDb(), "ws-empty", { userId: "user-A" });
  assert(r.ok && r.brain);
  assertEquals(r.brain!.setup_required, true);
  assertEquals(r.brain!.target_customer.industries, []);
  assertEquals(r.brain!.buyer_personas.titles, []);
});

Deno.test("consume-6. legacy profile.icp does not override a richer active v2 brain", () => {
  const canon = buildCanonicalCompanyBrain("ws-legacy", BRAIN_LEGACY);
  // The richer v2 targeting is preserved (not replaced by the generic legacy
  // icp). NOTE: the compiler UNIONS legacy icp terms in for backward-compat, so
  // legacy values may also appear — but they never override/remove the v2 value.
  assert(canon.target_customer.industries.includes("Fintech"), "v2 industry preserved, not overridden");
  assert(canon.buyer_personas.title_keywords.join(" ").includes("Payments") || JSON.stringify(canon.buyer_personas).includes("Payments"), "v2 buyer persona preserved");
});

// ------------------------------------------------- Fix A: agent brain block --

Deno.test("consume-7. active brain reaches agents ONLY when onboarding_completed is passed (Fix A)", () => {
  // The bug: run-agent passed null → block always suppressed.
  const suppressed = renderCompanyBrainBlock(BRAIN_A, null);
  assert(/no active company brain yet/i.test(suppressed), "null flag suppresses (reproduces the old bug)");

  const active = renderCompanyBrainBlock(BRAIN_A, true);
  assert(active.includes("ICP"), "active block carries ICP");
  assert(active.includes("Head of Growth"), "active block carries buyer roles");
  assert(/Voice:/.test(active), "active block carries brand voice");
  assert(/Approval rules/.test(active), "active block carries approval-first rules");
  assert(!/no active company brain yet/i.test(active), "active block is not the empty message");
});

Deno.test("consume-8. an un-activated (draft) brain is NOT injected as active", () => {
  const draft = renderCompanyBrainBlock(BRAIN_A, false);
  assert(/no active company brain yet/i.test(draft), "draft is not treated as active");
});

// ------------------------------------------- Fix B: workspace access guard ---

Deno.test("consume-9. access guard: service-role bearer is trusted (orchestrate path)", () => {
  const d = decideWorkspaceAccess({ bearerIsServiceRole: true, authenticatedUserId: null, isMember: false });
  assertEquals(d.ok, true);
  assert(d.ok && d.trusted);
});

Deno.test("consume-10. access guard: unauthenticated user rejected", () => {
  const d = decideWorkspaceAccess({ bearerIsServiceRole: false, authenticatedUserId: null, isMember: false });
  assertEquals(d.ok, false);
  assert(!d.ok && d.status === 401);
});

Deno.test("consume-11. access guard: authenticated non-member rejected (frontend id bypass blocked)", () => {
  const d = decideWorkspaceAccess({ bearerIsServiceRole: false, authenticatedUserId: "user-A", isMember: false });
  assertEquals(d.ok, false);
  assert(!d.ok && d.status === 403);
});

Deno.test("consume-12. access guard: authenticated member allowed (untrusted but ok)", () => {
  const d = decideWorkspaceAccess({ bearerIsServiceRole: false, authenticatedUserId: "user-A", isMember: true });
  assertEquals(d.ok, true);
  assert(d.ok && !d.trusted);
});
