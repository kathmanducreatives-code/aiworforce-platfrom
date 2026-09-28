// THE JEV SHADOW — JEV JUDGES THE SAME EVIDENCE, AND NOTHING LISTENS YET.
//
// Phase 1 of the Agentory + Jev company-evidence architecture. For every
// business-model grounding the run already performs, the same trusted evidence
// is also split into snippets (`buildEvidenceSnippets`), Jev answers the fixed
// facet questions (`jevProvider`), code validates every snippet id it returns
// (`validateFacetAnswers`), and the result is compared with the CURRENT
// grounder's canonical reading. The comparison is a diagnostic, persisted
// under `grounded_brain_diagnostics.jev_shadow`, and that is all it is.
//
// ── ZERO AUTHORITY, BY CONSTRUCTION ────────────────────────────────────────
//
//   * The wrapped `groundCompany` returns the grounder's result UNCHANGED — the
//     same object — whatever Jev says, fails to say, or how long it takes.
//   * Nothing here writes to a company, a registry, an evidence item or a
//     verification. The registry is COPIED before Jev's answer is validated
//     against it, so not even a later read can observe a mutation.
//   * The only output is `report()`, which `run-agent` places inside the
//     existing grounded diagnostics. No eligibility, Workbench count, gap
//     route, provider call or terminal state reads it.
//
// ── IT CANNOT HOLD THE RUN UP ─────────────────────────────────────────────
//
//   * Jev starts IN PARALLEL with the grounder, not after it.
//   * Every call has a timeout; `settle()` waits a bounded time and then
//     reports whatever is still outstanding as `unsettled`.
//   * Nothing here throws. A failure is a record.
//
// ── IT CANNOT SPEND BEYOND ITS ALLOWANCE ─────────────────────────────────
//
//   * OFF by default: the flag AND a workspace allow-list must pass; an empty
//     allow-list enables nobody.
//   * A per-task call cap, and the run's own model budget consulted before
//     each call (`allowSpend`).
//   * Only a PINNED, PRICED model. An alias such as `jev-latest` has no price
//     here, and an unpriced call would count against the run's UNPRICED-call
//     budget — the one the real stages live on. So it refuses to enable.
//   * Metered through the existing seam (`onModelCall` → ModelCallCollector →
//     the model-call ledger), under its own role, never as provider spend.

import type { EvidenceRegistry } from "./leadEvidenceRegistry.ts";
import type { GroundedVerification } from "./groundedClaims.ts";
import { MODEL_PRICES, canonicalModelId, type ModelCallTelemetry } from "./modelCostModel.ts";
import {
  ATTESTED_FACETS, FACET_ATTESTATION_VERSION, buildEvidenceSnippets, compareWithCurrent,
  currentGrounderView, validateFacetAnswers,
  type AttestedFacet, type CurrentGrounderView, type FacetDisagreement, type FacetVerdict,
  type ValidationFailure,
} from "./facetAttestation.ts";
import {
  DEFAULT_JEV_MODEL, DEFAULT_JEV_TIMEOUT_MS, jevJudge,
  type FacetJudge, type JudgeFailure,
} from "./jevProvider.ts";

export type EnvReader = (key: string) => string | undefined;

export const JEV_SHADOW_FLAG = "JEV_SHADOW_ENABLED";
export const JEV_SHADOW_WORKSPACES_ENV = "JEV_SHADOW_WORKSPACES";
export const JEV_API_KEY_ENV = "JEV_API_KEY";
export const JEV_MODEL_ENV = "JEV_MODEL";
export const JEV_SHADOW_MAX_CALLS_ENV = "JEV_SHADOW_MAX_CALLS";
export const JEV_SHADOW_TIMEOUT_MS_ENV = "JEV_SHADOW_TIMEOUT_MS";
export const JEV_SHADOW_SETTLE_MS_ENV = "JEV_SHADOW_SETTLE_MS";

export const DEFAULT_JEV_SHADOW_MAX_CALLS = 10;
export const DEFAULT_JEV_SHADOW_SETTLE_MS = 3000;
const MAX_TIMEOUT_MS = 15_000;
const MAX_SETTLE_MS = 10_000;
/** Records kept on the task. A diagnostic, not an archive. */
export const MAX_SHADOW_RECORDS = 25;
const MAX_FAILURES_PER_RECORD = 20;

export type JevShadowReason =
  | "flag_off" | "no_allowlist" | "workspace_not_listed" | "no_api_key" | "model_unpriced" | "enabled";

export interface JevShadowEnablement {
  enabled: boolean;
  reason: JevShadowReason;
  model: string;
  max_calls: number;
  timeout_ms: number;
  settle_ms: number;
}

function envReader(read?: EnvReader): EnvReader {
  return read ?? ((k) => {
    try { return Deno.env.get(k); } catch { return undefined; }
  });
}

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n >= min ? Math.min(n, max) : fallback;
}

export function isJevShadowEnabled(workspaceId: string, read?: EnvReader): JevShadowEnablement {
  const get = envReader(read);
  const model = (get(JEV_MODEL_ENV) ?? "").trim() || DEFAULT_JEV_MODEL;
  const base = {
    model,
    max_calls: boundedInt(get(JEV_SHADOW_MAX_CALLS_ENV), DEFAULT_JEV_SHADOW_MAX_CALLS, 0, 50),
    timeout_ms: boundedInt(get(JEV_SHADOW_TIMEOUT_MS_ENV), DEFAULT_JEV_TIMEOUT_MS, 1, MAX_TIMEOUT_MS),
    settle_ms: boundedInt(get(JEV_SHADOW_SETTLE_MS_ENV), DEFAULT_JEV_SHADOW_SETTLE_MS, 0, MAX_SETTLE_MS),
  };
  const off = (reason: JevShadowReason): JevShadowEnablement => ({ enabled: false, reason, ...base });

  const flag = String(get(JEV_SHADOW_FLAG) ?? "").trim().toLowerCase();
  if (flag !== "true" && flag !== "1") return off("flag_off");
  const list = String(get(JEV_SHADOW_WORKSPACES_ENV) ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return off("no_allowlist");
  if (!list.includes(workspaceId)) return off("workspace_not_listed");
  if (!(get(JEV_API_KEY_ENV) ?? "").trim()) return off("no_api_key");
  if (!MODEL_PRICES[canonicalModelId(model)]) return off("model_unpriced");
  return { enabled: true, reason: "enabled", ...base };
}

// ───────────────────────────────────────────────────────────── the record ──

export type ShadowSource = "per_company" | "batch";

export interface JevShadowRecord {
  version: typeof FACET_ATTESTATION_VERSION;
  company_key: string;
  source: ShadowSource;
  at: string;
  judge: "jev";
  model: string | null;
  latency_ms: number | null;
  estimated_cost_usd: number | null;
  input_tokens: number | null;
  request_id: string | null;
  outcome: "ok" | "failed" | "skipped";
  failure: JudgeFailure | null;
  snippet_count: number;
  snippets_truncated: number;
  facets: Record<AttestedFacet, {
    verdict: FacetVerdict;
    judge_verdict: FacetVerdict | null;
    supporting_snippet_ids: string[];
    contradicting_snippet_ids: string[];
    confidence: number | null;
  }> | null;
  contradiction_present: boolean | null;
  current_grounder_result: CurrentGrounderView;
  /** Null when there was nothing to compare (no Jev answer, or no grounder result). */
  agreement: boolean | null;
  disagreement_facets: FacetDisagreement[];
  selected_snippet_ids: string[];
  rejected_snippet_ids: string[];
  validation_failures: ValidationFailure[];
}

export interface JevShadowReport {
  version: typeof FACET_ATTESTATION_VERSION;
  enabled: boolean;
  reason: JevShadowReason;
  model: string;
  authority: "none";
  max_calls: number;
  calls_started: number;
  calls_ok: number;
  calls_failed: number;
  skipped: { call_cap: number; run_budget: number; no_snippets: number };
  unsettled: number;
  compared: number;
  agreed: number;
  disagreement_by_facet: Partial<Record<AttestedFacet, number>>;
  records: JevShadowRecord[];
}

export interface JevShadow {
  readonly enabled: boolean;
  readonly enablement: JevShadowEnablement;
  /** The binding with a shadowed `groundCompany` — or the SAME binding when off. */
  wrapBinding<B extends { groundCompany: ((i: GroundInput) => Promise<GroundedVerification | null>) | null }>(b: B): B;
  /** For a grounding that did not go through `groundCompany` (Stage 2 batches). Never throws. */
  observe(i: { registry: EvidenceRegistry | null; verification: GroundedVerification | null; source: ShadowSource }): void;
  /** Wait, at most `settle_ms`, for outstanding shadow calls. */
  settle(maxMs?: number): Promise<void>;
  report(): JevShadowReport;
}

type GroundInput = { registry: EvidenceRegistry; requiresCommercialSignal: boolean };

export interface BuildJevShadowInput {
  workspaceId: string;
  read?: EnvReader;
  /** The run's model-spend seam. */
  onModelCall?: (t: ModelCallTelemetry, ok: boolean) => void;
  /** The run's model budget — consulted before every shadow call. */
  allowSpend?: () => boolean;
  /** Injected in tests; production builds the Jev adapter from env. */
  judge?: FacetJudge;
  now?: () => number;
}

function copyRegistry(r: EvidenceRegistry): EvidenceRegistry {
  return typeof structuredClone === "function" ? structuredClone(r) : JSON.parse(JSON.stringify(r));
}

export function buildJevShadow(input: BuildJevShadowInput): JevShadow {
  const enablement = isJevShadowEnabled(input.workspaceId, input.read);
  const get = envReader(input.read);
  const now = input.now ?? Date.now;
  const judge: FacetJudge = input.judge ?? jevJudge({
    apiKey: (get(JEV_API_KEY_ENV) ?? "").trim() || null,
    model: enablement.model,
    timeoutMs: enablement.timeout_ms,
    onModelCall: input.onModelCall,
  });

  const records: JevShadowRecord[] = [];
  const pending = new Set<Promise<void>>();
  const counts = { started: 0, ok: 0, failed: 0, cap: 0, budget: 0, no_snippets: 0, compared: 0, agreed: 0 };
  const byFacet: Partial<Record<AttestedFacet, number>> = {};
  let unsettled = 0;

  const push = (r: JevShadowRecord) => {
    if (records.length < MAX_SHADOW_RECORDS) records.push(r);
  };

  /** Begin a shadow judgement of this registry. Null when nothing will be called. */
  const start = (registry: EvidenceRegistry | null, source: ShadowSource) => {
    if (!enablement.enabled || !registry) return null;
    try {
      if (counts.started >= enablement.max_calls) { counts.cap++; return null; }
      let allowed = true;
      try { allowed = input.allowSpend ? input.allowSpend() !== false : true; } catch { allowed = false; }
      if (!allowed) { counts.budget++; return null; }
      const frozen = copyRegistry(registry);
      const snippets = buildEvidenceSnippets(frozen);
      const at = new Date(now()).toISOString();
      if (snippets.snippets.length === 0) {
        counts.no_snippets++;
        return { frozen, snippets, source, at, outcome: null };
      }
      counts.started++;
      // Started NOW, in parallel with whatever the caller is about to await.
      const outcome = judge({ snippets }).catch((e) => ({
        ok: false as const, failure: "network" as JudgeFailure,
        detail: String(e instanceof Error ? e.message : e).slice(0, 200), latency_ms: 0, telemetry: null,
      }));
      return { frozen, snippets, source, at, outcome };
    } catch {
      return null;
    }
  };

  type Handle = NonNullable<ReturnType<typeof start>>;

  /** Compare with the grounder's result once both are in. Tracked; never throws. */
  const finish = (h: Handle | null, verification: GroundedVerification | null) => {
    if (!h) return;
    let current: CurrentGrounderView;
    try { current = currentGrounderView(verification); } catch { current = currentGrounderView(null); }
    const base = (): JevShadowRecord => ({
      version: FACET_ATTESTATION_VERSION,
      company_key: h.frozen.company_key, source: h.source, at: h.at, judge: "jev",
      model: null, latency_ms: null, estimated_cost_usd: null, input_tokens: null, request_id: null,
      outcome: "skipped", failure: null,
      snippet_count: h.snippets.snippets.length, snippets_truncated: h.snippets.truncated,
      facets: null, contradiction_present: null, current_grounder_result: current,
      agreement: null, disagreement_facets: [], selected_snippet_ids: [], rejected_snippet_ids: [],
      validation_failures: [],
    });
    if (!h.outcome) {
      push({ ...base(), failure: "no_snippets" });
      return;
    }
    const p = (async () => {
      try {
        const out = await h.outcome!;
        if (!out.ok) {
          counts.failed++;
          push({
            ...base(), outcome: "failed", failure: out.failure, latency_ms: out.latency_ms,
            model: out.telemetry?.model ?? enablement.model,
            estimated_cost_usd: out.telemetry?.estimated_cost_usd ?? null,
          });
          return;
        }
        counts.ok++;
        const att = validateFacetAnswers({ registry: h.frozen, snippets: h.snippets, answers: out.answers });
        const cmp = compareWithCurrent(att, current);
        if (current.available) {
          counts.compared++;
          if (cmp.agreement) counts.agreed++;
          for (const d of cmp.disagreement_facets) byFacet[d.facet] = (byFacet[d.facet] ?? 0) + 1;
        }
        push({
          ...base(), outcome: "ok", model: out.model, latency_ms: out.latency_ms,
          estimated_cost_usd: out.telemetry?.estimated_cost_usd ?? null,
          input_tokens: out.telemetry?.input_tokens ?? null, request_id: out.request_id,
          facets: Object.fromEntries(ATTESTED_FACETS.map((f) => [f, {
            verdict: att.facets[f].verdict,
            judge_verdict: att.facets[f].judge_verdict,
            supporting_snippet_ids: att.facets[f].supporting_snippet_ids,
            contradicting_snippet_ids: att.facets[f].contradicting_snippet_ids,
            confidence: att.facets[f].confidence,
          }])) as JevShadowRecord["facets"],
          contradiction_present: att.contradiction_present,
          agreement: current.available ? cmp.agreement : null,
          disagreement_facets: cmp.disagreement_facets,
          selected_snippet_ids: att.selected_snippet_ids.slice(0, 30),
          rejected_snippet_ids: att.rejected_snippet_ids.slice(0, 30),
          validation_failures: att.failures.slice(0, MAX_FAILURES_PER_RECORD),
        });
      } catch {
        counts.failed++;
      }
    })();
    pending.add(p);
    p.finally(() => pending.delete(p));
  };

  return {
    enabled: enablement.enabled,
    enablement,
    wrapBinding(b) {
      if (!enablement.enabled || !b.groundCompany) return b;
      const ground = b.groundCompany;
      return {
        ...b,
        groundCompany: async (i: GroundInput) => {
          const h = start(i.registry, "per_company");
          let v: GroundedVerification | null = null;
          try {
            v = await ground(i);
            return v;
          } finally {
            finish(h, v);
          }
        },
      };
    },
    observe(i) {
      try {
        finish(start(i.registry, i.source), i.verification);
      } catch { /* a shadow observer never costs a company */ }
    },
    async settle(maxMs) {
      if (pending.size === 0) return;
      const wait = Math.max(0, Math.min(maxMs ?? enablement.settle_ms, MAX_SETTLE_MS));
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled([...pending]),
        new Promise<void>((r) => { timer = setTimeout(r, wait); }),
      ]);
      clearTimeout(timer);
      unsettled = pending.size;
    },
    report() {
      return {
        version: FACET_ATTESTATION_VERSION,
        enabled: enablement.enabled,
        reason: enablement.reason,
        model: enablement.model,
        authority: "none",
        max_calls: enablement.max_calls,
        calls_started: counts.started,
        calls_ok: counts.ok,
        calls_failed: counts.failed,
        skipped: { call_cap: counts.cap, run_budget: counts.budget, no_snippets: counts.no_snippets },
        unsettled,
        compared: counts.compared,
        agreed: counts.agreed,
        disagreement_by_facet: { ...byFacet },
        records: records.map((r) => ({ ...r })),
      };
    },
  };
}
