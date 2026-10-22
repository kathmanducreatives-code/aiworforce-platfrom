// EVERY COMPANY BRAIN READER AGREES, AFTER EVERY KIND OF WRITE (roadmap 1.6).
//
// One matrix: each scenario writes the Brain through a REAL write path
// (onboarding's applyBrainSave, the page's planBrainUpdate) and then every
// reader that turns the stored profile into behaviour is asked the same
// questions — which industries do we target, which do we exclude, who is the
// buyer, which claims are banned. A reader that answers differently from the
// structured Brain is a bug of the kind the audit found (docs/audits/company-
// brain-onboarding, Appendix A): the page saying one thing while an agent, lead
// search or the radar acts on another.
//
// READERS (all pure, all the production modules):
//   page      src/lib/normalizeCompanyBrain            (the Company Brain UI)
//   backend   _shared/normalizeCompanyBrain            (every backend consumer's base)
//   agents    renderCompanyBrainBlock                  (run-agent prompt)
//   chat      buildCompanyBrainContext                 (pilot-chat prompt)
//   leads     compileCompanyBrainContext               (lead path ICP + exclusions)
//   radar     buildRadarScanPlan(compiled)             (Signals scan queries + negatives)
//   opener    brainContextFromProfile                  (outreach opener: banned claims)
//
// NOT HERE, and why:
//   · the planner (orchestrate) — its bounded projection is PR 1.3; add a row
//     when both land.
//   · run-radar-scan's readPrefs — module-private; it reads signal_preferences
//     with a legacy icp fallback, both of which the write paths now reconcile
//     (asserted below through the stored copies themselves).
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyBrainSave } from "../../../supabase/functions/_shared/companyBrainV2Save.ts";
import { planBrainUpdate } from "../../../supabase/functions/_shared/companyBrainUpdate.ts";
import { renderCompanyBrainBlock, buildCompanyBrainContext } from "../../../supabase/functions/_shared/companyBrainContext.ts";
import { compileCompanyBrainContext } from "../../../supabase/functions/_shared/companyBrainCompiler.ts";
import { buildRadarScanPlan } from "../../../supabase/functions/_shared/radarScanPlanner.ts";
import { brainContextFromProfile } from "../../../supabase/functions/_shared/workbench/openerBackend.ts";
import { normalizeCompanyBrain as normalizeBackend } from "../../../supabase/functions/_shared/normalizeCompanyBrain.ts";
import { normalizeCompanyBrain as normalizePage } from "../../../src/lib/normalizeCompanyBrain.ts";

type Raw = Record<string, unknown>;
const V = "2026-10-22T10:00:00.000000+00:00";

// ── the write paths ─────────────────────────────────────────────────────────
function onboard(): Raw {
  const r = applyBrainSave({}, {
    company: { name: "Northwind", description: "Revenue analytics", business_model: "B2B SaaS", team_size: "24" },
    target_customer: {
      industries: ["Fintech"], business_models: [], geography: ["United Kingdom"], funding_stage: [], must_have: [], nice_to_have: [],
      company_size: { min: 50, max: 200, label: "" },
      disqualifiers: { industries: ["Agencies"], company_types: [], domains: [], keywords: [], titles: [] },
    },
    buyer_personas: ["CFO"], pain_points: ["Slow board reporting"], triggers: ["New funding"],
    brand_voice: { tone: "Direct", avoid: ["guaranteed ROI"] },
  } as never, { activate: true });
  assert(r.onboarding_completed, "fixture activates");
  return r.profile;
}
function pageEdit(existing: Raw, change: (t: Raw) => Raw): Raw {
  const t = normalizePage(existing).target_customer as unknown as Raw;
  const plan = planBrainUpdate({ existing, currentUpdatedAt: V, expectedUpdatedAt: V, alreadyActive: true, patch: { target_customer: change(t) } });
  if (!plan.ok) throw new Error(`page edit refused: ${plan.reason}`);
  return plan.profile;
}
function onboardingEdit(existing: Raw, change: (t: Raw) => Raw): Raw {
  const t = normalizePage(existing).target_customer as unknown as Raw;
  return applyBrainSave(existing, { target_customer: change(t) } as never).profile;
}
const setIndustries = (xs: string[]) => (t: Raw) => ({ ...t, industries: xs });
const setExcluded = (xs: string[]) => (t: Raw) => ({ ...t, disqualifiers: { ...(t.disqualifiers as Raw), industries: xs } });

// ── the readers, each asked the same questions ─────────────────────────────
interface Answers { targets: (x: string) => boolean; excludes: (x: string) => boolean }
function readers(p: Raw): Record<string, Answers> {
  const has = (text: string) => (x: string) => text.toLowerCase().includes(x.toLowerCase());
  const inList = (xs: string[]) => (x: string) => xs.some((v) => v.toLowerCase() === x.toLowerCase());
  const page = normalizePage(p).target_customer;
  const backend = normalizeBackend(p).target_customer;
  const leads = compileCompanyBrainContext({ workspace_id: "ws", profile: p, signal_preferences: p.signal_preferences as Raw });
  const radar = buildRadarScanPlan(leads, { firecrawlReady: true, apifyReady: true });
  const radarQueries = radar.source_plan.flatMap((s) => s.queries).join(" | ");
  const radarNegatives = radar.source_plan.flatMap((s) => s.negative_terms);
  const agents = renderCompanyBrainBlock(p, true);
  const chat = buildCompanyBrainContext(p);
  // Prompt text names exclusions on their own line; targeting elsewhere.
  const excludedLine = (text: string) => text.split("\n").filter((l) => /exclu|disqualif|never target|avoid/i.test(l)).join("\n");
  const targetText = (text: string) => text.split("\n").filter((l) => !/exclu|disqualif|never target|avoid/i.test(l)).join("\n");
  return {
    page: { targets: inList(page.industries), excludes: inList(page.disqualifiers.industries) },
    backend: { targets: inList(backend.industries), excludes: inList(backend.disqualifiers.industries) },
    agents: { targets: has(targetText(agents)), excludes: has(excludedLine(agents)) },
    chat: { targets: has(targetText(chat)), excludes: has(excludedLine(chat)) },
    leads: { targets: inList(leads.icp.industries), excludes: inList(leads.disqualifiers.industries_explicit) },
    radar: { targets: has(radarQueries), excludes: inList(radarNegatives) },
  };
}
/** Every reader must give `expected` for this question; report all that do not. */
function agree(p: Raw, q: "targets" | "excludes", value: string, expected: boolean, scenario: string) {
  const wrong = Object.entries(readers(p)).filter(([, a]) => a[q](value) !== expected).map(([name]) => name);
  assertEquals(wrong, [], `${scenario}: readers that disagree on "${q} ${value}" (expected ${expected})`);
}

// ── the matrix ──────────────────────────────────────────────────────────────
Deno.test("A. after onboarding: every reader targets Fintech and excludes Agencies", () => {
  const p = onboard();
  agree(p, "targets", "Fintech", true, "A");
  agree(p, "excludes", "Agencies", true, "A");
});

for (const [label, write] of [["page", pageEdit], ["onboarding", onboardingEdit]] as const) {
  Deno.test(`B(${label}). edit Fintech → Logistics: every reader moves`, () => {
    const p = write(onboard(), setIndustries(["Logistics"]));
    agree(p, "targets", "Logistics", true, `B ${label}`);
    agree(p, "targets", "Fintech", false, `B ${label}`);
  });
  Deno.test(`C(${label}). clear industries: no reader still targets Fintech`, () => {
    const p = write(onboard(), setIndustries([]));
    agree(p, "targets", "Fintech", false, `C ${label}`);
  });
  Deno.test(`D(${label}). clear the exclusion: no reader still excludes Agencies`, () => {
    const p = write(onboard(), setExcluded([]));
    agree(p, "excludes", "Agencies", false, `D ${label}`);
  });
}

Deno.test("E. reload: saving what was loaded changes nothing any reader sees", () => {
  const p = pageEdit(onboard(), setIndustries(["Logistics"]));
  const again = pageEdit(p, (t) => t);
  assertEquals(again.icp, p.icp, "the legacy mirror is stable");
  assertEquals(again.signal_preferences, p.signal_preferences, "the radar copy is stable");
  agree(again, "targets", "Logistics", true, "E");
});

Deno.test("F. concurrent edit: a stale version is refused, so no reader sees a lost update", () => {
  const p = onboard();
  const stale = planBrainUpdate({ existing: p, currentUpdatedAt: "2026-10-22T10:00:05+00:00", expectedUpdatedAt: V,
    alreadyActive: true, patch: { target_customer: setIndustries(["Logistics"])(normalizePage(p).target_customer as unknown as Raw) } });
  assertFalse(stale.ok);
  if (!stale.ok) assertEquals(stale.reason, "stale");
});

Deno.test("G. alternating write paths: page edit, then onboarding edit, then a clear — still one answer", () => {
  let p = pageEdit(onboard(), setIndustries(["Logistics"]));
  p = onboardingEdit(p, setIndustries(["Logistics", "Retail"]));
  agree(p, "targets", "Retail", true, "G1");
  p = pageEdit(p, setIndustries(["Retail"]));
  agree(p, "targets", "Logistics", false, "G2");
  agree(p, "targets", "Fintech", false, "G2");
});

Deno.test("H. the stored copies other readers fall back to match the structured Brain", () => {
  const p = pageEdit(onboard(), setIndustries(["Logistics"]));
  assertEquals((p.icp as Raw).industries, ["Logistics"], "legacy icp (run-radar-scan readPrefs fallback, lead compiler union)");
  const prefs = p.signal_preferences as Raw;
  assertFalse(JSON.stringify(prefs.industries ?? []).includes("Fintech"), "radar preferences (readPrefs primary)");
});

Deno.test("I. the opener enforces the banned claim the Brain holds, and drops it when removed", () => {
  const p = onboard();
  assert(brainContextFromProfile(p).prohibited_claims.includes("guaranteed ROI"));
  const plan = planBrainUpdate({ existing: p, currentUpdatedAt: V, expectedUpdatedAt: V, alreadyActive: true,
    patch: { brand_voice: { ...(normalizePage(p).brand_voice as unknown as Raw), avoid: [] } } });
  if (!plan.ok) throw new Error(plan.reason);
  assertFalse(brainContextFromProfile(plan.profile).prohibited_claims.includes("guaranteed ROI"));
});
