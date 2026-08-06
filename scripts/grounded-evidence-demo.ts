// OFFLINE GROUNDING DEMONSTRATION — five classifier answers, one verifier.
//
// Every "classifier result" below is a FIXTURE written by hand to stand for what
// a model might return, including the things a model gets wrong. The verifier is
// the real one. Nothing here opens a socket or calls a model.
//
//   deno run --allow-read scripts/grounded-evidence-demo.ts

import {
  buildEvidenceRegistry, type EvidenceRegistry,
} from "../supabase/functions/_shared/leadEvidenceRegistry.ts";
import {
  buildWorkbenchExplanation, verifyGroundedResult,
  type GroundedClassifierResult,
} from "../supabase/functions/_shared/groundedClaims.ts";
import { buildCompanyEvidence } from "../supabase/functions/_shared/leadCompanyEvidence.ts";
import { normalizeLinkedInJob } from "../supabase/functions/_shared/hiringActorNormalizers.ts";

const DESCRIPTION =
  "SnapMagic sells electronic-design software to engineering teams on a subscription.";
const NOW = Date.parse("2026-08-06T00:00:00Z");

function company(over: Record<string, unknown> = {}) {
  return {
    external_source_id: "snapmagic", company_name: "SnapMagic",
    canonical_domain: "snapmagic.com",
    linkedin_company_url: "https://www.linkedin.com/company/snapmagic",
    website: "https://snapmagic.com", description: DESCRIPTION,
    provider_industry: "Software Development",
    industry_ids: [{ id: "4", name: "Software Development", hierarchy: "Tech" }],
    employee_count: 75, employee_range_advisory: null, geography: "United States",
    company_type: null, startup_evidence: null, hiring_status: true,
    source_provenance: "harvestapi/linkedin-company", field_trust: {},
    missing_fields: [], raw_ref: { actor_key: "x", source_id: "snapmagic" },
    ...over,
  } as never;
}

const job = (title: string, date: string | null) => normalizeLinkedInJob({
  id: title, title, linkedinUrl: `https://x/${encodeURIComponent(title)}`,
  ...(date ? { postedDate: date } : {}),
  company: { id: 1, name: "SnapMagic",
    linkedinUrl: "https://www.linkedin.com/company/snapmagic" },
});

function reg(o: Partial<Parameters<typeof buildEvidenceRegistry>[0]> = {}): EvidenceRegistry {
  return buildEvidenceRegistry({
    evidence: buildCompanyEvidence({
      company_key: "snapmagic", source_capability: "startup_company_discovery",
      company: company(), identity_state: "resolved",
      linkedin_company_url: "https://www.linkedin.com/company/snapmagic",
    }),
    jobs: [job("Head of Sales", "2026-08-01")],
    now: NOW,
    ...o,
  });
}

const idOf = (r: EvidenceRegistry, type: string) =>
  r.items.find((x) => x.evidence_type === type)?.evidence_id ?? "MISSING";

function baseResult(r: EvidenceRegistry): GroundedClassifierResult {
  const d = idOf(r, "company_description"), j = idOf(r, "job_posting");
  return {
    business_model: {
      value: "b2b_software", confidence: 0.9,
      claims: [{
        claim: "SnapMagic sells electronic-design software to engineering teams.",
        claim_type: "business_model", evidence_ids: [d],
        evidence_excerpts: [{ evidence_id: d, excerpt: "electronic-design software" }],
      }],
    },
    company_fit: "pass",
    agentory_use_case: "strong",
    mission_signal_assessment: {
      strongest_signal: "Head of Sales", signal_strength: "strong",
      evidence_ids: [j], reason: "current commercial opening",
    },
    supporting_claims: [{
      claim: "Hiring Head of Sales.", claim_type: "commercial_signal",
      evidence_ids: [j],
      evidence_excerpts: [{ evidence_id: j, excerpt: "Head of Sales" }],
    }],
    conflicting_evidence_ids: [], missing_evidence: [], unknown_fields: [],
    confidence: 0.9, reason: "B2B design software with a current opening",
  };
}

interface Case {
  label: string; registry: EvidenceRegistry; result: GroundedClassifierResult;
  requiresSignal?: boolean;
}

const A_REG = reg();
const D_REG = reg({
  jobs: [],
  provider_failures: [{
    provider: "apify_linkedin_job_search", capability: "hiring_verification",
    reason: "actor run failed after 3 attempts",
  }],
});
const E_REG = buildEvidenceRegistry({
  evidence: buildCompanyEvidence({
    company_key: "snapmagic", source_capability: "startup_company_discovery",
    company: company({ employee_count: 20 }), enriched: company({ employee_count: 75 }),
    identity_state: "resolved",
  }),
  jobs: [job("Head of Sales", "2026-08-01")], now: NOW,
  employee_count_alternatives: [{ source: "yc", value: 20 }],
});
const C_REG = reg({ jobs: [job("Senior Software Engineer", "2026-08-01")] });

const CASES: Case[] = [
  { label: "A — SNAPMAGIC, FULLY GROUNDED", registry: A_REG, result: baseResult(A_REG),
    requiresSignal: true },
  {
    label: "B — INVENTED CLAIM (\"sells API subscriptions\")",
    registry: A_REG,
    result: {
      ...baseResult(A_REG),
      business_model: {
        value: "b2b_saas", confidence: 0.95,
        claims: [{
          claim: "SnapMagic sells API subscriptions.", claim_type: "business_model",
          evidence_ids: [idOf(A_REG, "company_description")],
          evidence_excerpts: [{
            evidence_id: idOf(A_REG, "company_description"),
            excerpt: "API subscriptions",
          }],
        }],
      },
    },
  },
  {
    label: "C — WRONG JOB CLAIM (evidence says Senior Software Engineer)",
    registry: C_REG,
    requiresSignal: true,
    result: {
      ...baseResult(C_REG),
      supporting_claims: [{
        claim: "Hiring Head of Sales.", claim_type: "commercial_signal",
        evidence_ids: [idOf(C_REG, "job_posting")],
        evidence_excerpts: [{
          evidence_id: idOf(C_REG, "job_posting"), excerpt: "Senior Software Engineer",
        }],
      }],
    },
  },
  {
    label: "D — PROVIDER FAILURE",
    registry: D_REG,
    requiresSignal: true,
    result: {
      ...baseResult(D_REG),
      supporting_claims: [{
        claim: "The company is not hiring.", claim_type: "commercial_signal",
        evidence_ids: [idOf(D_REG, "provider_failure")],
        evidence_excerpts: [{
          evidence_id: idOf(D_REG, "provider_failure"),
          excerpt: "actor run failed after 3 attempts",
        }],
      }],
    },
  },
  {
    label: "E — CONFLICTING SIZE (YC 20 vs LinkedIn 75)",
    registry: E_REG,
    result: {
      ...baseResult(E_REG),
      supporting_claims: [{
        claim: "Hiring Head of Sales.", claim_type: "commercial_signal",
        evidence_ids: [idOf(E_REG, "job_posting")],
        evidence_excerpts: [{
          evidence_id: idOf(E_REG, "job_posting"), excerpt: "Head of Sales",
        }],
      }],
    },
  },
];

const line = (s = "") => console.log(s);
const rule = (c = "─") => line(c.repeat(78));

for (const c of CASES) {
  const v = verifyGroundedResult({
    registry: c.registry, result: c.result,
    requiresCommercialSignal: c.requiresSignal,
  });
  const ui = buildWorkbenchExplanation(v, c.registry);

  rule("═");
  line(`CASE ${c.label}`);
  rule("═");

  line("\nVALIDATED CLAIMS");
  if (v.validated_claims.length === 0) line("  (none survived verification)");
  for (const cl of v.validated_claims) line(`  ✓ [${cl.claim_type}] ${cl.claim}`);

  line("\nREJECTED CLAIMS  (internal diagnostics only)");
  if (v.rejected_claims.length === 0) line("  (none)");
  for (const r of v.rejected_claims) {
    line(`  ✗ ${r.claim}`);
    line(`      reason: ${r.reason}`);
    line(`      detail: ${r.detail}`);
  }

  line(`\nGROUNDING SCORE      : ${v.grounding_score}`);
  line(`MODEL SAID           : ${c.result.company_fit}`);
  line(`GROUNDED DECISION    : ${v.final_grounded_decision}`);
  if (v.downgrade_reasons.length) {
    line("DOWNGRADE REASONS");
    for (const d of v.downgrade_reasons) line(`  • ${d}`);
  }

  line("\nWORKBENCH — WHAT THE USER SEES");
  if (ui.why_it_matched.length === 0) line("  Why it matched: (nothing verifiable)");
  for (const w of ui.why_it_matched) {
    line(`  Why it matched: "${w.statement}"`);
    for (const e of w.evidence) line(`      evidence: ${e}`);
  }
  if (ui.current_signal) {
    line(`  Current signal: "${ui.current_signal.statement}"`);
    for (const e of ui.current_signal.evidence) line(`      evidence: ${e}`);
  } else {
    line("  Current signal: (none established)");
  }
  for (const u of ui.uncertainty) line(`  Uncertainty: ${u}`);
  line(`  Confidence after grounding: ${ui.confidence_after_grounding} ` +
    `(model claimed ${c.result.confidence})`);

  // The whole point, checked out loud.
  const shown = JSON.stringify(ui).toLowerCase();
  for (const phrase of ["api subscriptions", "not hiring"]) {
    if (c.result.supporting_claims.concat(c.result.business_model.claims)
      .some((x) => x.claim.toLowerCase().includes(phrase))) {
      line(`  → "${phrase}" reaches the user: ${
        shown.includes(phrase) ? "YES — BUG" : "NO"}`);
    }
  }
  line();
}

rule("═");
line("No Actor was started. No model was called. No database was read.");
rule("═");
