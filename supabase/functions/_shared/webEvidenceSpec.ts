// LEAD V2 P2 — WEB EVIDENCE PAGES GO THROUGH THE SAME SPINE AS APIFY CALLS.
//
// The P2 canary (task cfc5c18f) bought five Firecrawl pages after the engine
// returned: no ProviderCallSpec, no reservation, cost `unknown`. So the mission
// ceiling was not absolute and "what was sent" had no record to compare to.
//
// Every page fetch now compiles a spec, reserves against the mission's spend
// ledger, executes exactly the spec's input, and records its cost.
//
// COST. Firecrawl bills plan credits and returns no per-call charge: `/scrape`
// is 1 credit per page that produced a document (docs.firecrawl.dev/billing,
// verified 2026-09-10; `firecrawlCostModel.ts`). The USD rate is the account's
// configured `FIRECRAWL_USD_PER_CREDIT`, or — for budgeting only — the highest
// published self-serve rate, labelled as such. Settlement is the published
// credit rule applied to what came back: `derived_floor`, never presented as a
// provider receipt.

import {
  callCeilingFor, markExecuted, release, reserve, type SpendLedger,
} from "./budgetPolicy.ts";
import { firecrawlCredits, resolveFirecrawlCreditPrice } from "./firecrawlCostModel.ts";
import { appendTrace, type MissionTrace } from "./missionTrace.ts";
import { canonicalJson, sha256Hex } from "./providerInputFingerprint.ts";
import {
  PROVIDER_CALL_SPEC_VERSION, specSummary, type ProviderCallSpec, type SpecFieldProvenance,
} from "./providerCallSpec.ts";
import type { PageFetcher } from "./webEvidenceRunner.ts";

export const WEB_EVIDENCE_ACTOR = "firecrawl_scrape" as const;
/** Budgeting rate when no account rate is configured: Hobby, $19 / 3,000 credits. */
export const FIRECRAWL_BUDGET_USD_PER_CREDIT = 0.0064;

export function webEvidenceCreditRate(read?: (k: string) => string | undefined): {
  usd_per_credit: number; basis: "account_rate" | "budget_assumption";
} {
  const configured = resolveFirecrawlCreditPrice(read);
  return configured !== null
    ? { usd_per_credit: configured, basis: "account_rate" }
    : { usd_per_credit: FIRECRAWL_BUDGET_USD_PER_CREDIT, basis: "budget_assumption" };
}

export interface WebEvidenceSpecInput {
  url: string;
  company_key: string;
  request_id: string;
  scope: { workspace_id: string; lineage_id: string };
  mission_hash: string;
  plan: { plan_id: string | null; version: number | null };
  ledger: SpendLedger;
  usd_per_credit: number;
}

/** The tool input a page fetch sends. Pinned to one synchronous `/scrape` page. */
export function webEvidenceInput(url: string): Record<string, unknown> {
  return { url, extraction_goal: "requirement evidence", max_pages: 1 };
}

export function compileWebEvidenceSpec(i: WebEvidenceSpecInput): ProviderCallSpec {
  const input = webEvidenceInput(i.url);
  const idempotency_key = sha256Hex(
    `${i.scope.workspace_id}:${i.scope.lineage_id}:firecrawl:${WEB_EVIDENCE_ACTOR}:web_evidence:${canonicalJson(input)}:0`);
  const estimate = Number((1 * i.usd_per_credit).toFixed(6));
  const ceiling = callCeilingFor(i.ledger.ceilings, "web_evidence");
  const prov: SpecFieldProvenance[] = [
    { field: "url", role: "binding", proposed_value: i.url, final_value: i.url,
      changed_by: "evidence_planner", reason: "page resolved from the evidence plan's intent", changed: false },
    { field: "max_pages", role: "count", proposed_value: 1, final_value: 1,
      changed_by: "evidence_policy", reason: "one synchronous /scrape page; /crawl could strand a paid job", changed: false },
    { field: "extraction_goal", role: "operational", proposed_value: "requirement evidence",
      final_value: "requirement evidence", changed_by: "evidence_policy", reason: "operational label", changed: false },
  ];
  const over = estimate > ceiling + 1e-9;
  const spec: ProviderCallSpec = {
    version: PROVIDER_CALL_SPEC_VERSION,
    provider_call_id: `pc_${idempotency_key.slice(0, 26)}`,
    idempotency_key,
    mission_hash: i.mission_hash,
    plan_id: i.plan.plan_id, plan_version: i.plan.version, route_id: null,
    candidate_keys: [i.company_key],
    purpose: "web_evidence", provider: "firecrawl", actor: WEB_EVIDENCE_ACTOR, capability: "web_evidence_verification",
    proposed_input: { ...input },
    serialized_input: input,
    provenance: prov,
    engine_rewrites_rejected: [],
    cost: { estimate_usd: estimate, ceiling_usd: ceiling },
    status: over ? "refused_budget" : "intended",
    refusal: over ? { code: "call_ceiling", detail: `estimate $${estimate} exceeds the $${ceiling} web_evidence call ceiling` } : null,
  };
  return deepFreeze(spec);
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

export interface SpecGovernedFetcherInput {
  state: { spend_ledger?: SpendLedger; mission_trace?: MissionTrace; retrieval_plans?: Array<{ plan_id: string; version: number; mission_hash: string }> };
  scope: { workspace_id: string; lineage_id: string };
  usd_per_credit: number;
  /** Sends exactly `spec.serialized_input` (plus the envelope) and reports what came back. */
  send: (spec: ProviderCallSpec) => ReturnType<PageFetcher>;
  log?: (event: string, meta: Record<string, unknown>) => void;
}

/**
 * Wrap a page fetch in spec → reserve → execute → record.
 *
 * A key this lineage already bought is not bought again, and a fetch the
 * ledger cannot afford is not made; both answer `blocked`, which the runner
 * records as an attempt with no text.
 */
export function specGovernedPageFetcher(i: SpecGovernedFetcherInput): PageFetcher {
  return async ({ url, request_id, company_key }) => {
    const ledger = i.state.spend_ledger;
    const trace = i.state.mission_trace;
    if (!ledger || !trace) {
      // No P2 state means no ledger to hold the spend: refuse rather than spend untracked.
      i.log?.("web_evidence_spec_missing_state", { url });
      return { ok: false, markdown: "", status: "blocked" };
    }
    const plan = i.state.retrieval_plans?.[i.state.retrieval_plans.length - 1] ?? null;
    const spec = compileWebEvidenceSpec({
      url, company_key, request_id, scope: i.scope, mission_hash: plan?.mission_hash ?? "",
      plan: { plan_id: plan?.plan_id ?? null, version: plan?.version ?? null },
      ledger, usd_per_credit: i.usd_per_credit,
    });
    const refs = { plan_version: spec.plan_version, provider_call_id: spec.provider_call_id, idempotency_key: spec.idempotency_key };
    const summary = specSummary(spec);
    appendTrace(trace, spec.status === "intended" ? "spec_compiled" : "spec_refused", {
      actor: spec.actor, capability: spec.capability, url, changes: summary.changes,
      estimate_usd: spec.cost.estimate_usd, ceiling_usd: spec.cost.ceiling_usd, refusal: spec.refusal,
    }, refs);
    if (spec.status !== "intended") return { ok: false, markdown: "", status: "blocked" };

    const already = ledger.reservations.find((r) => r.idempotency_key === spec.idempotency_key &&
      (r.status === "executed" || r.status === "settled"));
    if (already) {
      appendTrace(trace, "call_idempotent_skip", { actor: spec.actor, url }, refs);
      return { ok: false, markdown: "", status: "blocked" };
    }
    const decision = reserve(ledger, {
      idempotency_key: spec.idempotency_key, provider_call_id: spec.provider_call_id, purpose: "web_evidence",
      route_id: null, candidate_keys: [company_key], estimate_usd: spec.cost.estimate_usd,
    });
    if (!decision.ok) {
      appendTrace(trace, "call_refused_budget", {
        actor: spec.actor, url, ceiling: decision.ceiling, limit_usd: decision.limit_usd, would_commit_usd: decision.would_commit_usd,
      }, refs);
      return { ok: false, markdown: "", status: "blocked" };
    }
    appendTrace(trace, "call_reserved", { actor: spec.actor, estimate_usd: spec.cost.estimate_usd }, refs);

    let res: Awaited<ReturnType<PageFetcher>>;
    try {
      res = await i.send(spec);
    } catch (e) {
      // Synchronous `/scrape`: a throw before a document came back consumed no credit.
      release(ledger, spec.idempotency_key);
      appendTrace(trace, "call_released", { actor: spec.actor, error: String(e).slice(0, 200) }, refs);
      throw e;
    }
    const produced = res.ok === true || (res.status_code != null && res.status_code > 0);
    const credits = firecrawlCredits({ pages: 1, formats: ["markdown", "summary"], producedResult: produced });
    const usd = Number((credits * i.usd_per_credit).toFixed(6));
    markExecuted(ledger, spec.idempotency_key, usd);
    appendTrace(trace, "call_executed", {
      actor: spec.actor, url, status: res.status, credits, provisional_usd: usd,
      cost_basis: "published_credit_rule",
    }, refs);
    return res;
  };
}
