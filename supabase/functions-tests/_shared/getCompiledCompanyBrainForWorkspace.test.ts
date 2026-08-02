// Shared Company Brain access layer. The DB is a local stub — no Supabase,
// no network, no providers.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  getCompiledCompanyBrainForWorkspace, buildCanonicalCompanyBrain, type BrainDbClient,
} from "../../functions/_shared/getCompiledCompanyBrainForWorkspace.ts";

const WS = "ws-1";
const USER = "user-1";

/** A Brain written by Onboarding v3 — v2 shape, NO legacy `icp` block. */
const v3Profile = {
  schema_version: 2,
  company: { name: "Cekura", website_url: "https://cekura.ai", description: "AI SaaS for revenue teams", business_model: "B2B SaaS", category: "AI SaaS" },
  target_customer: {
    industries: ["B2B SaaS", "AI SaaS"],
    business_models: ["B2B SaaS"],
    company_size: { min: 10, max: 150, label: "10-150 employees" },
    geography: ["US", "EU"],
    must_have: ["outbound motion"], nice_to_have: [], funding_stage: ["seed"],
    disqualifiers: { industries: ["lab testing"], company_types: ["agency"], keywords: ["staffing"], titles: [], domains: [] },
  },
  buyer_personas: ["Founder", "Head of Revenue"],
  triggers: ["recently funded"],
  jobs_to_watch: ["Founding Account Executive"],
  competitors: ["Clay", "Apollo"],
  tools: ["HubSpot"],
  pain_points: ["manual outbound"],
  positive_examples: ["Acme"],
  negative_examples: ["Pace Analytical"],
  content_angles: ["pipeline before payroll"],
  qualification_rules: { required_evidence: ["job_url"], reject_if: ["lab testing"], manual_review_if: ["no website"] },
  positioning: { promise: "Pipeline before payroll", proof_points: ["3x faster"], avoid_positioning: ["AI SDR"] },
  brand_voice: { tone: "direct", avoid: ["hype"] },
};

/** Minimal stub matching BrainDbClient. */
function stubDb(opts: { member: boolean; profile: unknown }): BrainDbClient {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq(_c: string, _v: string) {
              return {
                // company_brain path: .eq().maybeSingle()
                maybeSingle: async () =>
                  table === "company_brain" ? { data: { profile: opts.profile } } : { data: null },
                // workspace_members path: .eq().eq().maybeSingle()
                eq: (_c2: string, _v2: string) => ({
                  maybeSingle: async () => ({ data: opts.member ? { workspace_id: WS } : null }),
                }),
              };
            },
          };
        },
      };
    },
  } as BrainDbClient;
}

Deno.test("1. loads, normalizes and compiles into one canonical object", async () => {
  const r = await getCompiledCompanyBrainForWorkspace(stubDb({ member: true, profile: v3Profile }), WS, { userId: USER });
  assertEquals(r.ok, true);
  const b = r.brain!;
  assertEquals(b.workspace_id, WS);
  assertEquals(b.company_summary.product_name, "Cekura");
  assert(b.target_customer.industries.includes("B2B SaaS"));
  assertEquals(b.target_customer.company_size.min, 10);
  assertEquals(b.target_customer.company_size.max, 150);
  assert(b.target_customer.geography.includes("US"));
});

Deno.test("2. canonical object exposes every required field", async () => {
  const r = await getCompiledCompanyBrainForWorkspace(stubDb({ member: true, profile: v3Profile }), WS, { userId: USER });
  const b = r.brain!;
  assert(b.buyer_personas.titles.includes("Founder"));
  assertEquals(b.pain_points, ["manual outbound"]);
  assertEquals(b.jobs_to_watch, ["Founding Account Executive"]);
  assertEquals(b.positive_examples, ["Acme"]);
  assertEquals(b.negative_examples, ["Pace Analytical"]);
  assert(b.competitors.includes("Clay"));
  assertEquals(b.tools, ["HubSpot"]);
  assertEquals(b.content_angles, ["pipeline before payroll"]);
  assertEquals(b.qualification_rules.required_evidence, ["job_url"]);
  assertEquals(b.qualification_rules.reject_if, ["lab testing"]);
  assertEquals(b.qualification_rules.manual_review_if, ["no website"]);
  assertEquals(b.positioning.promise, "Pipeline before payroll");
  assert(b.positioning.banned_claims.includes("AI SDR"));
  assert(b.brand_voice.voice_notes.includes("direct"));
  assertEquals(b.setup_required, false);
  assertEquals(b.brain_confidence, "strong");
  assertEquals(b.missing_fields, []);
  assert(b.disqualifiers.industries.some((d) => d.toLowerCase() === "lab testing"));
  assert(Array.isArray(b.query_strategy.hiring_role_terms));
});

Deno.test("3. membership is enforced — non-member gets forbidden, no brain", async () => {
  const r = await getCompiledCompanyBrainForWorkspace(stubDb({ member: false, profile: v3Profile }), WS, { userId: USER });
  assertEquals(r.ok, false);
  assertEquals(r.error, "forbidden");
  assertEquals(r.brain, null);
});

Deno.test("4. missing userId is forbidden unless the check is explicitly skipped", async () => {
  const db = stubDb({ member: true, profile: v3Profile });
  assertEquals((await getCompiledCompanyBrainForWorkspace(db, WS, {})).error, "forbidden");
  const trusted = await getCompiledCompanyBrainForWorkspace(db, WS, { skipMembershipCheck: true });
  assertEquals(trusted.ok, true);
});

Deno.test("5. workspace with no Brain → conservative empty brain, setup_required, no fabrication", async () => {
  const r = await getCompiledCompanyBrainForWorkspace(stubDb({ member: true, profile: null }), WS, { userId: USER });
  assertEquals(r.ok, true, "absent Brain is not an error");
  const b = r.brain!;
  assertEquals(b.setup_required, true);
  assertEquals(b.brain_confidence, "weak");
  assertEquals(b.target_customer.industries, []);
  assertEquals(b.buyer_personas.titles, []);
  assert(b.missing_fields.length > 0);
});

Deno.test("6. empty workspace_id → not_found", async () => {
  const r = await getCompiledCompanyBrainForWorkspace(stubDb({ member: true, profile: v3Profile }), "", { userId: USER });
  assertEquals(r.error, "not_found");
});

Deno.test("7. legacy_icp view is exposed for un-migrated readers", async () => {
  const b = buildCanonicalCompanyBrain(WS, v3Profile);
  assertEquals(b.legacy_icp.industries, ["B2B SaaS", "AI SaaS"]);
  assertEquals(b.legacy_icp.buyer_roles, ["Founder", "Head of Revenue"]);
  assertEquals(b.legacy_icp.company_size, "10-150 employees");
  assertEquals(b.legacy_icp.geography, "US");
  assertEquals(b.legacy_icp.pain_points, ["manual outbound"]);
  assert(b.legacy_icp.disqualifiers.includes("lab testing"));
  assert(b.legacy_icp.disqualifiers.includes("agency"), "all buckets flattened");
  assert(b.legacy_icp.disqualifiers.includes("staffing"));
});

Deno.test("8. software ICP still hard-rejects lab/pharma via the compiled disqualifiers", () => {
  const b = buildCanonicalCompanyBrain(WS, v3Profile);
  for (const bad of ["pharma", "analytical services", "packaging", "staffing"]) {
    assert(b.disqualifiers.industries.some((d) => d.toLowerCase() === bad), `expected ${bad}`);
  }
});

Deno.test("9. buildCanonicalCompanyBrain is pure — same input, same output", () => {
  const a = buildCanonicalCompanyBrain(WS, v3Profile);
  const b = buildCanonicalCompanyBrain(WS, v3Profile);
  assertEquals(a.target_customer, b.target_customer);
  assertEquals(a.missing_fields, b.missing_fields);
});
