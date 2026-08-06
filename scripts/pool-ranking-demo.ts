// OFFLINE FULL-POOL DEMONSTRATION — 20+ companies, real gates, real validator.
//
//   deno run --allow-read scripts/pool-ranking-demo.ts

import { buildEligiblePool } from "../supabase/functions/_shared/leadEligiblePool.ts";
import {
  planBatches, resolveBatchLimits, evaluateBatchResponse,
} from "../supabase/functions/_shared/groundedBatchEvaluation.ts";
import {
  applyPortfolioPolicy, buildCandidateSummary, deterministicOrder,
  validatePoolRanking, type GroundedCandidateSummary,
} from "../supabase/functions/_shared/poolRanking.ts";
import { buildEvidenceRegistry } from "../supabase/functions/_shared/leadEvidenceRegistry.ts";
import { buildCompanyEvidence } from "../supabase/functions/_shared/leadCompanyEvidence.ts";
import { parseLeadMissionDeterministic } from "../supabase/functions/_shared/leadMission.ts";
import { normalizeLinkedInJob } from "../supabase/functions/_shared/hiringActorNormalizers.ts";

const NOW = Date.parse("2026-08-06T00:00:00Z");
const MISSION = parseLeadMissionDeterministic(
  "Find founders of US B2B SaaS startups hiring Sales Operations. Return 25 qualified leads.");

const line = (s = "") => console.log(s);
const rule = (c = "─") => line(c.repeat(78));

function co(key: string, over: Record<string, unknown> = {}) {
  return {
    external_source_id: key, company_name: key, canonical_domain: `${key}.com`,
    linkedin_company_url: `https://www.linkedin.com/company/${key}`,
    website: `https://${key}.com`,
    description: `${key} sells electronic-design software to engineering teams.`,
    provider_industry: "Software Development",
    industry_ids: [{ id: "4", name: "B2B SaaS", hierarchy: "Tech" }],
    employee_count: 60, employee_range_advisory: null, geography: "United States",
    company_type: null, startup_evidence: null, hiring_status: true,
    source_provenance: "harvestapi/linkedin-company", field_trust: {},
    missing_fields: [], raw_ref: { actor_key: "x", source_id: key },
    ...over,
  } as never;
}
const job = (t: string, d: string | null) => normalizeLinkedInJob({
  id: t, title: t, linkedinUrl: `https://x/${encodeURIComponent(t)}`,
  ...(d ? { postedDate: d } : {}),
  company: { id: 1, name: "c", linkedinUrl: "https://www.linkedin.com/company/c" },
});

function cand(key: string, over: Record<string, unknown> = {}, alts: any[] = []) {
  return {
    company_key: key, company_name: key,
    registry: buildEvidenceRegistry({
      evidence: buildCompanyEvidence({
        company_key: key, source_capability: "startup_company_discovery",
        company: co(key, over),
        enriched: alts.length ? co(key, { ...over, employee_count: 75 }) : null,
        identity_state: "resolved",
        linkedin_company_url: `https://www.linkedin.com/company/${key}`,
      }),
      jobs: [job("Head of Sales", "2026-08-01")], now: NOW,
      employee_count_alternatives: alts,
    }),
  };
}

// ── the pool: 20+ companies with the required mix ──────────────────────────
const raw = [
  ...Array.from({ length: 6 }, (_, i) => cand(`tierA-${i + 1}`)),
  ...Array.from({ length: 4 }, (_, i) => cand(`tierB-${i + 1}`)),
  ...Array.from({ length: 4 }, (_, i) => cand(`review-${i + 1}`)),
  ...Array.from({ length: 2 }, (_, i) => cand(`watch-${i + 1}`)),
  ...Array.from({ length: 2 }, (_, i) => cand(`reject-${i + 1}`)),
  cand("geo-fail", { geography: "Berlin, Germany" }),
  cand("tierA-1"),                                   // duplicate
  cand("invented-claim"),
  cand("size-conflict", {}, [{ source: "yc", value: 20 }]),
];

rule("═"); line("1-2. HARD GATES → ELIGIBLE POOL"); rule("═");
const pool = buildEligiblePool(raw, { mission: MISSION, employee_max: 150 });
line(`  discovered : ${pool.metrics.discovered}`);
line(`  hard-gated : ${pool.metrics.hard_gated}`);
line(`  eligible   : ${pool.metrics.eligible}`);
for (const e of pool.excluded) line(`    ✗ ${e.company_key}: ${e.reason} — ${e.detail}`);

rule("═"); line("3. BATCH PLAN"); rule("═");
const limits = resolveBatchLimits({ batch_size: 8, max_evaluated: 100 });
const { batches, beyond_cap } = planBatches(pool.eligible, limits);
line(`  batch size ${limits.batch_size}, max evaluated ${limits.max_evaluated}`);
line(`  batches: ${batches.length}  (sizes ${batches.map((b) => b.length).join(", ")})`);
line(`  beyond the evaluation cap: ${beyond_cap}`);

// ── 4-5. evaluate, with one invented claim and isolated evidence ───────────
rule("═"); line("4-5. BATCH EVALUATION → COMPACT SUMMARIES"); rule("═");
const summaries: GroundedCandidateSummary[] = [];
let batchNo = 0;
for (const b of batches) {
  batchNo++;
  const members = b.map((c) => ({
    company_key: c.company_key, company_name: c.company_name,
    registry: c.registry, requiresCommercialSignal: false,
  }));
  const results = members.map((m) => {
    const d = m.registry.items.find((x) => x.evidence_type === "company_description")!.evidence_id;
    // The "invented-claim" company cites text that is not in its source.
    const invented = m.company_key === "invented-claim";
    return {
      company_key: m.company_key,
      business_model: { value: "b2b_software", confidence: 0.9, claims: [{
        claim: invented ? `${m.company_key} sells API subscriptions.`
          : `${m.company_key} sells electronic-design software.`,
        claim_type: "business_model", evidence_ids: [d],
        evidence_excerpts: [{ evidence_id: d,
          excerpt: invented ? "API subscriptions" : "electronic-design software" }],
      }] },
      company_fit: m.company_key.startsWith("reject") ? "fail" : "pass",
      agentory_use_case: "strong",
      supporting_claims: [], confidence: 0.9, reason: "",
    };
  });
  const out = evaluateBatchResponse({ batch: members, raw: { results } });
  line(`  batch ${batchNo}: evaluated ${out.evaluated}, failed ${out.failed}`);
  for (const o of out.outcomes) {
    const m = members.find((x) => x.company_key === o.company_key)!;
    const v = o.verification;
    const decision = !v ? "REVIEW"
      : v.final_grounded_decision === "pass" ? "QUALIFIED"
      : v.final_grounded_decision === "fail" ? "REJECT" : "REVIEW";
    const tier = o.company_key.startsWith("tierA") ? "A"
      : o.company_key.startsWith("tierB") ? "B"
      : o.company_key.startsWith("watch") ? "C" : null;
    summaries.push(buildCandidateSummary({
      company_key: o.company_key, company_name: m.company_name,
      brain_outcome: decision as never, tier: tier as never, grounded: v,
    }));
    if (v && v.rejected_claims.length) {
      line(`      ✗ ${o.company_key}: ${v.rejected_claims[0].reason} → ${decision}`);
    }
  }
}
line(`  compact summaries built: ${summaries.length}`);
const leaked = JSON.stringify(summaries).includes("API subscriptions");
line(`  → rejected claim text present in summaries: ${leaked ? "YES — BUG" : "NO"}`);

// ── 6-8. ranking with deliberate faults ────────────────────────────────────
rule("═"); line("6-8. FULL-POOL RANKING + DETERMINISTIC VALIDATION"); rule("═");
const modelRanking = {
  ranked_candidates: [
    { company_key: "reject-1", rank: 1, relative_strength: "strong", ranking_reason: "I like it", comparison_basis: ["mission_fit"], recommended_action: "offer_founder_unlock" },
    { company_key: "ghost-corp", rank: 2, relative_strength: "strong", ranking_reason: "invented", comparison_basis: [], recommended_action: "offer_founder_unlock" },
    { company_key: "tierA-1", rank: 3, relative_strength: "strong", ranking_reason: "harvestapi confirms hiring", comparison_basis: ["mission_fit"], recommended_action: "offer_founder_unlock" },
    { company_key: "tierA-2", rank: 4, relative_strength: "strong", ranking_reason: "strongest current commercial signal in the pool", comparison_basis: ["signal_strength", "mission_fit"], recommended_action: "offer_founder_unlock" },
    { company_key: "tierA-2", rank: 5, relative_strength: "weak", ranking_reason: "dup", comparison_basis: [], recommended_action: "review" },
  ],
  portfolio_summary: { ranking_confidence: 0.8, pool_explanation: "compared on fit and signal" },
};
const v = validatePoolRanking({ raw: modelRanking, summaries, requestedCount: 25 });
line(`  ranking source   : ${v.ranking_source}`);
line(`  validator changes: ${v.validator_changes.join(", ") || "(none)"}`);
for (const r of v.rejected_entries) line(`    ✗ ${r.company_key}: ${r.reason} — ${r.detail}`);
const rejRank = v.ranked.find((r) => r.company_key === "reject-1")?.rank;
const qualRank = v.ranked.find((r) => r.company_key === "tierA-2")?.rank;
line(`  reject-1 rank ${rejRank} vs tierA-2 rank ${qualRank} → reject outranks qualified: ${
  (rejRank ?? 99) < (qualRank ?? 0) ? "YES — BUG" : "NO"}`);
line(`  → provider name in any surviving reason: ${
  JSON.stringify(v.ranked).includes("harvestapi") ? "YES — BUG" : "NO"}`);

// ── 9-11. portfolio at 5 / 10 / 25 ─────────────────────────────────────────
rule("═"); line("9-11. PORTFOLIO AT 5, 10 AND 25"); rule("═");
for (const requested of [5, 10, 25]) {
  const d = applyPortfolioPolicy({
    ranking: v, summaries, requestedCount: requested,
    eligibleCount: pool.metrics.eligible, unevaluatedCount: beyond_cap,
  });
  line(`  requested ${String(requested).padStart(2)} → delivered ${d.metrics.delivered}, ` +
    `shortfall ${d.metrics.shortfall}, qualified ${d.metrics.qualified}, ` +
    `review ${d.metrics.review}, watch ${d.metrics.watch}, rejected ${d.metrics.rejected}`);
  if (requested === 25) {
    line("    Workbench order:");
    for (const x of d.delivered.slice(0, 8)) {
      line(`      ${String(x.rank).padStart(2)}. ${x.summary.company_key.padEnd(16)} ` +
        `${x.summary.brain_decision.padEnd(9)} tier=${x.summary.opportunity_tier ?? "-"} ` +
        `g=${x.summary.grounding_score} → ${x.recommended_action}`);
    }
    line(`    → any reject delivered: ${
      d.delivered.some((x) => x.summary.brain_decision === "reject") ? "YES — BUG" : "NO"}`);
    line(`    → 25 requested, ${d.metrics.delivered} real opportunities (not fabricated)`);
  }
}

// ── 12-13. shadow vs enforce, and ranking failure ──────────────────────────
rule("═"); line("12-13. SHADOW vs ENFORCE, AND RANKING FAILURE"); rule("═");
const det = validatePoolRanking({ raw: null, summaries, requestedCount: 25 });
line(`  ranking outage   → source=${det.ranking_source}, reason=${det.fallback_reason}`);
line(`  deterministic order: ${deterministicOrder(summaries).slice(0, 5).map((s) => s.company_key).join(" → ")}`);
line(`  semantic order    : ${v.ranked.slice(0, 5).map((r) => r.company_key).join(" → ")}`);
line("  shadow  = user sees the deterministic order, semantic ranking persisted");
line("  enforce = user sees the semantic order, policy still owned by code");
line(`  workflow survived ranking failure: ${det.ranked.length === summaries.length ? "YES" : "NO"}`);
rule("═");
line("No Actor started. No model called. No database read.");
rule("═");
