import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileCompanyBrainContext } from "../../functions/_shared/companyBrainCompiler.ts";
import { firecrawlHitToCandidate, scoreCandidates, buildRadarSignalRow, type FirecrawlHit } from "../../functions/_shared/radarCandidatePipeline.ts";
import { scoreAgainstCompanyBrain } from "../../functions/_shared/icpSignalScorer.ts";

const NOW = Date.parse("2026-07-06T00:00:00Z");
const brain = compileCompanyBrainContext({
  workspace_id: "ws",
  profile: {
    company: { category: "AI SaaS", description: "AI workforce OS for founders building B2B pipeline" },
    icp: { buyer_roles: ["Founder", "RevOps", "Founding Account Executive"], company_size: "10-150 employees", industries: ["B2B SaaS", "AI SaaS"], disqualifiers: ["manufacturing", "hospital", "university", "government", "logistics", "local services"] },
    gtm: { motion: "founder-led sales" },
    competitors: { known: ["Clay", "Apollo"] },
  },
  signal_preferences: { hiring_roles: ["Founding Account Executive", "RevOps"] },
});

function run(items: { source: any; hit: FirecrawlHit }[], cap = 10) {
  return scoreCandidates({
    items: items.map((i) => ({ candidate: firecrawlHitToCandidate(i.source, i.hit, NOW), source: i.source, scanPlanReason: "test reason" })),
    brain, workspace_id: "ws", userId: "u", cap,
  });
}

Deno.test("1. Agentory Brain accepts SaaS + Founding AE hit with company-page proof", () => {
  const r = run([{ source: "hiring", hit: { title: "Cekura is hiring a Founding Account Executive", url: "https://www.cekura.ai/careers/founding-ae", description: "Join our B2B SaaS AI company building GTM" } }]);
  assertEquals(r.accepted, 1);
  const raw = r.rows[0].raw as any;
  assert(raw.verification_status === "verified", `verification ${raw.verification_status}`);
  assert(raw.matched_icp.some((m: string) => /saas/i.test(m)));
});

Deno.test("2. rejects manufacturing Operations Manager", () => {
  const cand = firecrawlHitToCandidate("hiring", { title: "BuildCo is hiring an Operations Manager", url: "https://linkedin.com/jobs/view/buildco", description: "a manufacturing company" }, NOW);
  const s = scoreAgainstCompanyBrain(cand, brain);
  assertEquals(s.verification_status, "rejected");
  assert(s.disqualifiers_hit.some((d) => d.toLowerCase() === "manufacturing"));
  const r = run([{ source: "hiring", hit: { title: "BuildCo is hiring an Operations Manager", url: "https://linkedin.com/jobs/view/buildco", description: "a manufacturing company" } }]);
  assertEquals(r.accepted, 0);
  assertEquals(r.rejected, 1);
});

Deno.test("3. rejects hospital / university / government / local-service disqualifiers", () => {
  for (const bad of ["hospital", "university", "government", "logistics", "local services"]) {
    const r = run([{ source: "hiring", hit: { title: `${bad}Org is hiring a Manager`, url: "https://x.test/j", description: `a ${bad} organization` } }]);
    assertEquals(r.accepted, 0, bad);
  }
});

Deno.test("4. hit with no source_url is not verified", () => {
  const cand = firecrawlHitToCandidate("hiring", { title: "Acme is hiring a RevOps", description: "B2B SaaS" }, NOW);
  const s = scoreAgainstCompanyBrain(cand, brain);
  assert(s.verification_status !== "verified");
});

Deno.test("5. generic Operations Manager is not accepted as RevOps", () => {
  const cand = firecrawlHitToCandidate("hiring", { title: "SaaSCo is hiring an Operations Manager", url: "https://www.saasco.io/careers", description: "B2B SaaS" }, NOW);
  const s = scoreAgainstCompanyBrain(cand, brain);
  assertEquals(s.buyer_relevance_score, 0);
  assert(!s.matched_buyer_personas.some((b) => /revops|revenue operations/i.test(b)));
});

Deno.test("6. persisted raw JSON includes required scoring fields", () => {
  const cand = firecrawlHitToCandidate("hiring", { title: "Cekura is hiring a Founding Account Executive", url: "https://www.cekura.ai/careers", description: "B2B SaaS AI" }, NOW);
  const score = scoreAgainstCompanyBrain(cand, brain);
  const row = buildRadarSignalRow({ workspace_id: "ws", userId: "u", candidate: cand, score, scanPlanReason: "hiring plan" });
  const raw = row.raw as any;
  for (const f of ["signal_score", "verification_status", "why_now", "missing_evidence", "recommended_action", "matched_icp", "disqualifiers_hit", "source_details", "scan_plan_reason"]) {
    assert(f in raw, `missing raw.${f}`);
  }
  assertEquals(typeof raw.signal_score, "number");
  assertEquals(raw.scan_plan_reason, "hiring plan");
  // frontend-compat mirrors present
  assert("score" in raw && "signal_quality" in raw);
});
