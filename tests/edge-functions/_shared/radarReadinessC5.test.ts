// CONTRACT C5 (#165): the radar's "setup required" rule follows Company Brain
// readiness (BRAIN_READINESS_V2), and "not activated" is its own flag.
//
//   C5a  meta.setup_required = !companyBrainReadiness(v2, activated).can.signals
//   C5b  meta.unactivated_draft: a usable, never-activated draft RUNS, at low
//        caps, and never yields a VERIFIED Top Signal
//   C5c  the normalizer's own rule is retired for the radar under the switch
//        (both normalizers stay unchanged, so page parity is untouched)
//
// With the switch off nothing changes: `setup_required` is exactly
// `v2.setup_required || is_draft`, as before.
//
// Offline: no database, no provider, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileCompanyBrainContext } from "../../../supabase/functions/_shared/companyBrainCompiler.ts";
import { normalizeCompanyBrain } from "../../../supabase/functions/_shared/normalizeCompanyBrain.ts";
import { scoreAgainstCompanyBrain, type SignalCandidate } from "../../../supabase/functions/_shared/icpSignalScorer.ts";
import { buildRadarScanPlan } from "../../../supabase/functions/_shared/radarScanPlanner.ts";
import { buildRadarIntelligenceProfile } from "../../../supabase/functions/_shared/radarIntel/radarIntelligenceProfile.ts";

const NOW = Date.parse("2026-07-06T00:00:00Z");
const FULL = {
  company: { category: "AI SaaS", description: "AI workforce OS for founders building B2B pipeline" },
  icp: { buyer_roles: ["Founder", "RevOps", "Head of Growth", "Founding Account Executive"], company_size: "10-150 employees", industries: ["B2B SaaS", "AI SaaS"], disqualifiers: ["manufacturing"] },
  gtm: { motion: "founder-led sales", current_tools: ["Clay", "Apollo"] },
  competitors: { known: ["Clay", "Apollo"], adjacent: ["Instantly"] },
};
const PROFILES: Record<string, Record<string, unknown>> = {
  nothing: {},
  nothing_draft: { is_draft: true },
  industries_only_draft: { schema_version: 2, is_draft: true, target_customer: { industries: ["B2B SaaS"] } },
  must_have_only_draft: { schema_version: 2, is_draft: true, target_customer: { must_have: ["sells to finance teams"] } },
  full_activated: FULL,
  full_draft: { ...FULL, is_draft: true },
};
const compile = (p: Record<string, unknown>, on: boolean) => compileCompanyBrainContext({ workspace_id: "ws", profile: p, readiness_v2: on });
const strongHiring: SignalCandidate = {
  signal_type: "hiring", title: "Cekura hiring Founding Account Executive", company_name: "Cekura", now: NOW,
  company_domain: "cekura.ai", website: "https://cekura.ai", industries: ["B2B SaaS", "AI"], employee_count: 40,
  job_title: "Founding Account Executive", job_url: "https://linkedin.com/jobs/view/cekura", source_url: "https://linkedin.com/jobs/view/cekura",
  job_description: "Building GTM at an AI SaaS company", source_published_at: "2026-07-04T00:00:00Z",
};

Deno.test("C5 switch OFF: setup_required is exactly v2.setup_required || is_draft, for every Brain", () => {
  for (const [name, p] of Object.entries(PROFILES)) {
    const v2 = normalizeCompanyBrain(p);
    assertEquals(compile(p, false).meta.setup_required, v2.setup_required || v2.is_draft === true, name);
  }
});

Deno.test("C5a switch ON: setup_required follows readiness can.signals (industries OR must-have)", () => {
  assertEquals(compile(PROFILES.nothing, true).meta.setup_required, true, "nothing set → setup required");
  assertEquals(compile(PROFILES.nothing_draft, true).meta.setup_required, true);
  assertEquals(compile(PROFILES.industries_only_draft, true).meta.setup_required, false, "industries only → the radar may run");
  assertEquals(compile(PROFILES.must_have_only_draft, true).meta.setup_required, false, "must-haves only → the radar may run");
  assertEquals(compile(PROFILES.full_activated, true).meta.setup_required, false);
});

Deno.test("C5b: a usable un-activated draft runs at low caps, is usable for providers, and never verifies", () => {
  const b = compile(PROFILES.industries_only_draft, true);
  assertEquals(b.meta.unactivated_draft, true);
  assertEquals(buildRadarIntelligenceProfile(b).usable, true, "providers may run");
  const plan = buildRadarScanPlan(b, { firecrawlReady: true });
  assertEquals(plan.setup_required, false);
  assert(plan.warnings.some((w) => w.includes("draft not activated")), JSON.stringify(plan.warnings));
  // The full Brain as a draft: everything fits, yet nothing is VERIFIED until activation.
  const draft = compile(PROFILES.full_draft, true);
  assertEquals([draft.meta.setup_required, draft.meta.unactivated_draft], [false, true]);
  const r = scoreAgainstCompanyBrain(strongHiring, draft);
  assert(r.verification_status !== "verified", r.verification_status);
  assert(r.risk_flags.some((f) => f.includes("draft not activated")), JSON.stringify(r.risk_flags));
});

Deno.test("C5b: low caps for a usable draft equal the caps of an incomplete Brain (cost stays conservative)", () => {
  const draftPlan = buildRadarScanPlan(compile(PROFILES.full_draft, true), { firecrawlReady: true });
  const legacyPlan = buildRadarScanPlan(compile(PROFILES.full_draft, false), { firecrawlReady: true });
  assertEquals(draftPlan.source_plan.map((s) => [s.source, s.cap]), legacyPlan.source_plan.map((s) => [s.source, s.cap]));
});

Deno.test("C5 positive control: an activated Brain still verifies, switch on or off", () => {
  for (const on of [false, true]) {
    const b = compile(PROFILES.full_activated, on);
    assertEquals(b.meta.unactivated_draft, false);
    assertEquals(scoreAgainstCompanyBrain(strongHiring, b).verification_status, "verified", `switch ${on}`);
  }
});

Deno.test("C5 wiring: both radar entries (run-radar-scan, run-monitoring-scan) pass the switch", () => {
  for (const f of ["run-radar-scan", "run-monitoring-scan"]) {
    const src = Deno.readTextFileSync(new URL(`../../../supabase/functions/${f}/index.ts`, import.meta.url));
    assert(/readiness_v2: brainReadinessV2Enabled\(\(k\) => Deno\.env\.get\(k\)\)/.test(src), f);
  }
});
