// OFFLINE STAGE 2 INTEGRATION — the real engine, mocked providers and models.
//   deno run --allow-read scripts/stage2-integration-demo.ts

import { runCapabilityPlan } from "../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../supabase/functions/_shared/leadCapabilityGraph.ts";
import { parseLeadMissionDeterministic } from "../supabase/functions/_shared/leadMission.ts";
import {
  evaluateBatchResponse, resolveBatchLimits, type BatchMember,
} from "../supabase/functions/_shared/groundedBatchEvaluation.ts";
import {
  applyPortfolioPolicy, validatePoolRanking,
} from "../supabase/functions/_shared/poolRanking.ts";
import type { GroundedVerification } from "../supabase/functions/_shared/groundedClaims.ts";

const N = 22;
const QUERY = "Find founders of US B2B SaaS startups hiring Sales Operations. Return 25 qualified leads.";
const line = (s = "") => console.log(s);
const rule = (c = "─") => line(c.repeat(78));

const YC = Array.from({ length: N }, (_, i) => ({
  id: `co${i}`, name: `Co${i}`, website: `https://co${i}.com`,
  industry: "B2B", industries: ["B2B"], batch: "W22", teamSize: 42,
  oneLiner: `Co${i} sells electronic-design software to engineering teams.`,
  allLocations: i === 5 ? "Berlin, Germany" : "San Francisco, CA, USA",
  openJobs: [{ title: "Revenue Operations Manager", url: `https://x/${i}` }],
}));
const ROWS: Record<string, Record<string, unknown>[]> = {
  apify_yc_companies_memo23: YC,
  apify_linkedin_company_search: YC.map((r) => ({
    id: r.id, name: r.name, linkedinUrl: `https://www.linkedin.com/company/${r.id}`,
    website: r.website, description: r.oneLiner, location: r.allLocations,
  })),
  apify_linkedin_company_details: YC.map((r) => ({
    id: r.id, name: r.name, linkedinUrl: `https://www.linkedin.com/company/${r.id}`,
    website: r.website, employeeCount: 42, description: r.oneLiner,
    industries: [{ id: "4", name: "B2B SaaS", hierarchy: "Technology" }],
    locations: [{ linkedinText: r.allLocations.includes("Germany") ? "Germany" : "United States" }],
  })),
};

function respond(batch: readonly BatchMember[], inventedKey?: string) {
  return { results: batch.map((m) => {
    const d = m.registry.items.find((x) => x.evidence_type === "company_description")?.evidence_id ?? "none";
    const inv = m.company_key === inventedKey;
    return {
      company_key: m.company_key,
      business_model: { value: "b2b_software", confidence: 0.9, claims: [{
        claim: inv ? "sells API subscriptions." : "sells electronic-design software.",
        claim_type: "business_model", evidence_ids: [d],
        evidence_excerpts: [{ evidence_id: d, excerpt: inv ? "API subscriptions" : "electronic-design software" }],
      }] },
      company_fit: "pass", agentory_use_case: "strong",
      supporting_claims: [], confidence: 0.9, reason: "",
    };
  }) };
}

const m = parseLeadMissionDeterministic(QUERY);
const BRAIN = { employee_min: 10, employee_max: 150, positive_industries: ["b2b saas"], excluded_industries: [], required_geography: null };
const limits = resolveBatchLimits({ batch_size: 8, max_evaluated: 100 });

// ── PASS 1: deadline after the first batch ─────────────────────────────────
rule("═"); line("PASS 1 — DEADLINE AFTER THE FIRST BATCH"); rule("═");
let elapsed = 0;
const checkpointed: Array<{ company_key: string; verification: GroundedVerification }> = [];
let batches1 = 0; let invented = "";
const run1 = await runCapabilityPlan({
  invoke: (c: any) => Promise.resolve(ROWS[c.actorKey] ?? []),
  verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  batchLimits: limits,
  deadline: {
    startedAt: 0, budgetMs: 100_000,
    elapsedMs: () => elapsed, remainingMs: () => 100_000 - elapsed,
    expired: () => false, observeCall: () => {},
  } as any,
  evaluateBatch: (b) => {
    batches1++;
    if (!invented) invented = b[0].company_key;
    // After the first batch, the reserve is reached.
    elapsed = 90_000;
    return Promise.resolve(evaluateBatchResponse({ batch: b, raw: respond(b, invented) }));
  },
  onBatchComplete: ({ evaluated }) => { checkpointed.length = 0; checkpointed.push(...evaluated); },
} as any, { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN });

line(`  discovered   : ${run1.pool!.eligible.discovered}`);
line(`  hard-gated   : ${run1.pool!.eligible.hard_gated}`);
for (const e of run1.pool!.excluded) line(`      ✗ ${e.company_key}: ${e.reason}`);
line(`  eligible     : ${run1.pool!.eligible.eligible}`);
line(`  batches run  : ${batches1}`);
line(`  evaluated    : ${run1.pool!.summaries.length}`);
line(`  UNEVALUATED  : ${run1.pool!.unevaluated}  ← honest partial`);
line(`  checkpointed : ${checkpointed.length} grounded results`);
line(`  terminal     : ${run1.state.terminal_reason}`);
const p1 = applyPortfolioPolicy({ ranking: run1.pool!.ranking, summaries: run1.pool!.summaries, requestedCount: 25, eligibleCount: run1.pool!.eligible.eligible, unevaluatedCount: run1.pool!.unevaluated });
line(`  delivered    : ${p1.metrics.delivered}, shortfall ${p1.metrics.shortfall}`);

// ── PASS 2: continuation restores, finishes, ranks ─────────────────────────
rule("═"); line("PASS 2 — CONTINUATION RESTORES BATCH 1, FINISHES, RANKS (SHADOW)"); rule("═");
const restored = new Map(checkpointed.map((e) => [e.company_key, e.verification]));
let batches2 = 0;
const run2 = await runCapabilityPlan({
  invoke: (c: any) => Promise.resolve(ROWS[c.actorKey] ?? []),
  verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  batchLimits: limits,
  restoredGroundedResults: restored,
  evaluateBatch: (b) => { batches2++; return Promise.resolve(evaluateBatchResponse({ batch: b, raw: respond(b, invented) })); },
  rankPool: ({ summaries, requestedCount }) => Promise.resolve(validatePoolRanking({
    raw: { ranked_candidates: [...summaries].reverse().map((s, i) => ({
      company_key: s.company_key, rank: i + 1, relative_strength: "strong",
      ranking_reason: "compared on mission fit and current signal",
      comparison_basis: ["mission_fit", "signal_strength"],
      recommended_action: "offer_founder_unlock",
    })), portfolio_summary: { ranking_confidence: 0.82, pool_explanation: "compared" } },
    summaries, requestedCount,
  })),
} as any, { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN });

line(`  restored     : ${run2.pool!.restored}  (not re-evaluated)`);
line(`  new batches  : ${batches2}`);
line(`  evaluated    : ${run2.pool!.summaries.length}`);
line(`  unevaluated  : ${run2.pool!.unevaluated}`);
line(`  ranking src  : ${run2.pool!.ranking.ranking_source}`);
line(`  validator    : ${run2.pool!.ranking.validator_changes.join(", ") || "(none)"}`);
const detOrder = validatePoolRanking({ raw: null, summaries: run2.pool!.summaries, requestedCount: 25 });
line(`  shadow order (user sees) : ${detOrder.ranked.slice(0, 4).map((r) => r.company_key).join(" → ")}`);
line(`  semantic order (persisted): ${run2.pool!.ranking.ranked.slice(0, 4).map((r) => r.company_key).join(" → ")}`);

rule("═"); line("DELIVERY AT 5 / 10 / 25"); rule("═");
for (const req of [5, 10, 25]) {
  const d = applyPortfolioPolicy({ ranking: run2.pool!.ranking, summaries: run2.pool!.summaries, requestedCount: req, eligibleCount: run2.pool!.eligible.eligible, unevaluatedCount: run2.pool!.unevaluated });
  line(`  requested ${String(req).padStart(2)} → delivered ${d.metrics.delivered}, shortfall ${d.metrics.shortfall}, qualified ${d.metrics.qualified}, review ${d.metrics.review}, rejected ${d.metrics.rejected}`);
}
const text = JSON.stringify(run2.pool!.summaries);
line(`\n  → rejected claim text in ranking summaries: ${text.includes("API subscriptions") ? "YES — BUG" : "NO"}`);
line(`  → provider name in summaries: ${/harvestapi|memo23|apify_/.test(text) ? "YES — BUG" : "NO"}`);
line(`  → founder/contact Actor invoked: NONE`);
rule("═"); line("No Actor started. No model called. No database read."); rule("═");
