// OFFLINE END-TO-END GROUNDING — the real engine, mocked classifiers.
//
// Drives `runCapabilityPlan` with the grounding deps actually wired, so what is
// printed is what the ENGINE did: the registry it built, the claims it verified,
// the decision the Brain reached, and what a user would have seen.
//
//   deno run --allow-read scripts/grounded-wiring-demo.ts

import {
  runCapabilityPlan, type CapabilityEngineDeps,
} from "../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../supabase/functions/_shared/leadCapabilityGraph.ts";
import { parseLeadMissionDeterministic } from "../supabase/functions/_shared/leadMission.ts";
import {
  buildWorkbenchExplanation, parseGroundedResult, verifyGroundedResult,
} from "../supabase/functions/_shared/groundedClaims.ts";
import { buildShadowComparison } from "../supabase/functions/_shared/groundedBrainBinding.ts";
import type { EvidenceRegistry } from "../supabase/functions/_shared/leadEvidenceRegistry.ts";
import type { CompiledActorCall } from "../supabase/functions/_shared/hiringActorInputs.ts";

const QUERY =
  "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";
const DESC = "SnapMagic sells electronic-design software to engineering teams.";

const ROWS: Record<string, Record<string, unknown>[]> = {
  apify_yc_companies_memo23: [{
    id: "snapmagic", name: "SnapMagic", website: "https://snapmagic.com",
    industry: "B2B", industries: ["B2B"], batch: "W22", teamSize: 42,
    oneLiner: DESC, allLocations: "San Francisco, CA, USA",
    openJobs: [{ title: "Revenue Operations Manager", url: "https://x/1" }],
  }],
  apify_linkedin_company_search: [{
    id: "snapmagic", name: "SnapMagic",
    linkedinUrl: "https://www.linkedin.com/company/snapmagic",
    website: "https://snapmagic.com", description: DESC, location: "San Francisco, CA",
  }],
  apify_linkedin_company_details: [{
    id: "snapmagic", name: "SnapMagic",
    linkedinUrl: "https://www.linkedin.com/company/snapmagic",
    website: "https://snapmagic.com", employeeCount: 42, description: DESC,
    industries: [{ id: "4", name: "B2B SaaS", hierarchy: "Technology" }],
    locations: [{ linkedinText: "United States" }],
  }],
};

const legacyPass: CapabilityEngineDeps["classifyCompany"] = () =>
  Promise.resolve({
    assessment: {
      business_model: "b2b_saas", company_fit: "pass", confidence: 0.9,
      agentory_use_case: "strong", supporting_evidence: ["sells software"],
      conflicting_evidence: [], unknown_fields: [], reason: "fits",
    },
    parse_status: "valid",
    raw_shape: { received_keys: [], repaired_fields: [], rejected_values: [] },
  } as never);

type Answer = (r: EvidenceRegistry) => unknown;
const descId = (r: EvidenceRegistry) =>
  r.items.find((x) => x.evidence_type === "company_description")?.evidence_id ?? "none";
const jobId = (r: EvidenceRegistry) =>
  r.items.find((x) => x.evidence_type === "yc_job" || x.evidence_type === "job_posting")
    ?.evidence_id ?? "none";

const grounded = (r: EvidenceRegistry, bmClaims: unknown[], support: unknown[]) => ({
  business_model: { value: "b2b_software", confidence: 0.9, claims: bmClaims },
  company_fit: "pass", agentory_use_case: "strong",
  supporting_claims: support, confidence: 0.9, reason: "B2B design software",
});

const CASES: Array<{
  label: string; mode: "shadow" | "enforce"; answer: Answer | null;
}> = [
  {
    label: "A — VALID SNAPMAGIC", mode: "enforce",
    answer: (r) => grounded(r, [{
      claim: "SnapMagic sells electronic-design software to engineering teams.",
      claim_type: "business_model", evidence_ids: [descId(r)],
      evidence_excerpts: [{ evidence_id: descId(r), excerpt: "electronic-design software" }],
    }], [{
      claim: "Hiring Revenue Operations Manager.", claim_type: "commercial_signal",
      evidence_ids: [jobId(r)],
      evidence_excerpts: [{ evidence_id: jobId(r), excerpt: "Revenue Operations Manager" }],
    }]),
  },
  {
    label: "B — INVENTED API SUBSCRIPTION CLAIM", mode: "enforce",
    answer: (r) => grounded(r, [{
      claim: "SnapMagic sells API subscriptions.", claim_type: "business_model",
      evidence_ids: [descId(r)],
      evidence_excerpts: [{ evidence_id: descId(r), excerpt: "API subscriptions" }],
    }], []),
  },
  {
    label: "C — WRONG HEAD OF SALES CLAIM", mode: "enforce",
    answer: (r) => grounded(r, [{
      claim: "SnapMagic sells electronic-design software to engineering teams.",
      claim_type: "business_model", evidence_ids: [descId(r)],
      evidence_excerpts: [{ evidence_id: descId(r), excerpt: "electronic-design software" }],
    }], [{
      claim: "Hiring Head of Sales.", claim_type: "commercial_signal",
      evidence_ids: [jobId(r)],
      evidence_excerpts: [{ evidence_id: jobId(r), excerpt: "Revenue Operations Manager" }],
    }]),
  },
  { label: "D — GROUNDED CLASSIFIER UNAVAILABLE", mode: "enforce", answer: null },
  {
    label: "E — SHADOW DISAGREEMENT (legacy PASS, grounded REVIEW)", mode: "shadow",
    answer: (r) => grounded(r, [{
      claim: "SnapMagic sells API subscriptions.", claim_type: "business_model",
      evidence_ids: [descId(r)],
      evidence_excerpts: [{ evidence_id: descId(r), excerpt: "API subscriptions" }],
    }], []),
  },
];

const line = (s = "") => console.log(s);
const rule = (c = "─") => line(c.repeat(78));

for (const c of CASES) {
  const m = parseLeadMissionDeterministic(QUERY);
  const calls: string[] = [];
  const run = await runCapabilityPlan({
    invoke: (call: CompiledActorCall<unknown>) => {
      calls.push(call.actorKey);
      return Promise.resolve(ROWS[call.actorKey] ?? []);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
    classifyCompany: legacyPass,
    groundingMode: c.mode,
    groundCompany: c.answer
      ? ({ registry, requiresCommercialSignal }) => Promise.resolve(
        verifyGroundedResult({
          registry, requiresCommercialSignal,
          result: parseGroundedResult(c.answer!(registry)),
        }))
      : () => Promise.resolve(null),
  }, {
    mission: m, plan: buildCapabilityGraph(m),
    brain: { employee_min: 10, employee_max: 150,
      positive_industries: ["b2b saas"], excluded_industries: [], required_geography: null },
  });

  const co = run.companies[0];
  rule("═");
  line(`CASE ${c.label}   [mode: ${c.mode}]`);
  rule("═");

  line("\nREGISTRY EVIDENCE IDS");
  for (const it of co?.evidence_registry?.items ?? []) {
    line(`  ${it.evidence_id}`);
    line(`      type=${it.evidence_type} state=${it.verification_state} fresh=${it.freshness}`);
  }

  const g = co?.grounded ?? null;
  line("\nPARSED GROUNDED RESULT");
  line(`  model said     : ${g?.classifier_result.company_fit ?? "(unavailable)"}`);
  line(`  business model : ${g?.classifier_result.business_model.value ?? "-"}`);

  line("\nVALIDATED CLAIMS");
  if (!g || g.validated_claims.length === 0) line("  (none)");
  for (const v of g?.validated_claims ?? []) line(`  ✓ [${v.claim_type}] ${v.claim}`);

  line("REJECTED CLAIMS  (internal only)");
  if (!g || g.rejected_claims.length === 0) line("  (none)");
  for (const r of g?.rejected_claims ?? []) {
    line(`  ✗ ${r.claim}`);
    line(`      ${r.reason}: ${r.detail}`);
  }

  line(`\nGROUNDING SCORE      : ${g?.grounding_score ?? "n/a"}`);
  line(`LEGACY DECISION      : QUALIFIED (the legacy classifier said pass)`);
  line(`GROUNDED DECISION    : ${g?.final_grounded_decision ?? "unavailable"}`);
  line(`FINAL USER-FACING    : ${co?.brain?.outcome ?? "(none)"}`);
  if (co?.brain?.reason) line(`  reason: ${co.brain.reason}`);

  if (c.mode === "shadow") {
    const cmp = buildShadowComparison({
      companyKey: co.key, legacyOutcome: co.brain?.outcome ?? "REVIEW",
      legacyConfidence: co.brain?.confidence ?? 0, grounded: g,
    });
    line("\nSHADOW COMPARISON (persisted, changes nothing)");
    line(`  disagreement            : ${cmp.disagreement}`);
    line(`  reason                  : ${cmp.disagreement_reason}`);
    line(`  user_facing_would_change: ${cmp.user_facing_would_change}`);
    line(`  rejected_claims         : ${cmp.rejected_claim_count}`);
  }

  line("\nWORKBENCH EXPLANATION");
  if (g && co.evidence_registry) {
    const ui = buildWorkbenchExplanation(g, co.evidence_registry);
    for (const w of ui.why_it_matched) {
      line(`  Why it matched: "${w.statement}"`);
      for (const e of w.evidence) line(`      evidence: ${e}`);
    }
    if (ui.why_it_matched.length === 0) line("  Why it matched: (nothing verifiable)");
    line(`  Current signal: ${ui.current_signal
      ? `"${ui.current_signal.statement}"` : "(none established)"}`);
    for (const u of ui.uncertainty) line(`  Uncertainty: ${u}`);
    line(`  Confidence after grounding: ${ui.confidence_after_grounding}`);
    const shown = JSON.stringify(ui).toLowerCase();
    line(`  → "api subscriptions" reaches the user: ${
      shown.includes("api subscriptions") ? "YES — BUG" : "NO"}`);
    line(`  → "head of sales" reaches the user: ${
      shown.includes("head of sales") ? "YES — BUG" : "NO"}`);
  } else {
    line("  (no grounded explanation — legacy path)");
  }

  const people = calls.filter((k) => /employees|people_search|profile_search/.test(k));
  line(`\nFOUNDER/CONTACT ACTORS INVOKED: ${people.length === 0 ? "NONE" : people.join(", ")}`);
  line();
}

rule("═");
line("No Actor was started. No model was called. No database was read.");
rule("═");
