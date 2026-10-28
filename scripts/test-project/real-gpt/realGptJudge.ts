// THE ZERO-APIFY REAL-GPT TEST, JUDGED. Pure: no network, no database.
//
// Input: the evidence document `real-gpt-evidence.sql` prints for one queue
// row (the compiled mission, the run's execution plan and terminal state, the
// model and provider ledger rows, the smoke admission operations, the
// workspace's credits and persisted leads). Output: one PASS / FAIL row per
// criterion, each with the observed value, so a reviewer sees why.
//
// Four questions, as the test was approved to answer them:
//   I  did Agentory interpret the mission correctly?
//   P  did it build an appropriate research plan?
//   R  did it respect the provider restriction (zero Apify starts)?
//   M  did it record model spending accurately?
// plus T (an honest, contained ending). MANUAL rows are facts only the
// operator can read (the vendors' own consoles); they are never inferred.

export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Expectations {
  requested_count: number;
  /** Hard criteria the request states; each must be compiled, and nothing hard beyond them. */
  industry_includes: string;
  geography: { value: string; scope: string };
  company_size: { min: number; max: number };
  hiring: { role_term: string; window_days: number; role_families: readonly string[] };
  disallowed_broadening: readonly string[];
  /** Capabilities the request must not buy (no people search, no contact data). */
  prohibited_capabilities: readonly string[];
  approved_actor_keys: readonly string[];
  first_step: { capability: string; actor_key: string; jobTitles: readonly string[]; locations: readonly string[]; max_items: number; posted_limit: string };
  model: string;
  max_model_calls: number;
  /** Per-call committed maximum the smoke template charges (µ$), and the allocation. */
  committed_per_call_microusd: number;
  model_allocation_microusd: number;
  /** The ledger's price card for `model` ($ per 1M tokens): what `priceModelCall` must have applied. */
  price_per_1m: { input: number; cached_input: number; output: number };
  starting_credits: number;
}

/** The A7 mission: "Find 1 US B2B software company … 11–50 … open Account Executive posting … 30 days". */
export const A7_EXPECTATIONS: Expectations = {
  requested_count: 1,
  industry_includes: "b2b software",
  geography: { value: "United States", scope: "headquarters" },
  company_size: { min: 11, max: 50 },
  hiring: { role_term: "account executive", window_days: 30, role_families: ["gtm_sales"] },
  disallowed_broadening: ["geography", "role", "size"],
  prohibited_capabilities: ["contact_enrichment", "founder_discovery"],
  approved_actor_keys: ["apify_linkedin_job_search", "apify_linkedin_company"],
  first_step: {
    capability: "job_discovery", actor_key: "apify_linkedin_job_search",
    jobTitles: ["Account Executive"], locations: ["United States"], max_items: 3, posted_limit: "month",
  },
  model: "gpt-5.6-luna",
  max_model_calls: 4,
  committed_per_call_microusd: 12_480,
  model_allocation_microusd: 50_000,
  price_per_1m: { input: 0.20, cached_input: 0.02, output: 1.20 },
  starting_credits: 10,
};

export interface Verdict { id: string; question: "I" | "P" | "R" | "M" | "T"; criterion: string; result: "PASS" | "FAIL" | "MANUAL"; observed: string }

const lower = (v: unknown) => String(v ?? "").toLowerCase();
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** What `priceModelCall` computes from a row's token counts (modelCostModel.ts). */
export function expectedModelCostUsd(meta: Json, p: Expectations["price_per_1m"]): number | null {
  const input = typeof meta?.input_tokens === "number" ? meta.input_tokens : null;
  const output = typeof meta?.output_tokens === "number" ? meta.output_tokens : null;
  if (input == null && output == null) return null;
  const cached = Math.min(typeof meta?.cached_input_tokens === "number" ? meta.cached_input_tokens : 0, input ?? 0);
  const uncached = Math.max(0, (input ?? 0) - cached);
  return round6((uncached * p.input + cached * p.cached_input + (output ?? 0) * p.output) / 1_000_000);
}

export function judgeRealGptRun(ev: Json, x: Expectations = A7_EXPECTATIONS): Verdict[] {
  const out: Verdict[] = [];
  const v = (id: string, question: Verdict["question"], criterion: string, ok: boolean | "manual", observed: unknown) =>
    out.push({ id, question, criterion, result: ok === "manual" ? "MANUAL" : ok ? "PASS" : "FAIL",
      observed: typeof observed === "string" ? observed : JSON.stringify(observed) });

  // ── I. INTERPRETATION ─────────────────────────────────────────────────────
  const mission: Json = ev.lead_mission ?? {};
  const criteria: Json[] = Array.isArray(mission.criteria) ? mission.criteria : [];
  const hard = criteria.filter((c) => c.kind === "hard");
  const byDim = (d: string) => hard.filter((c) => c.dimension === d);
  v("I1", "I", `requested_count is ${x.requested_count}`, mission.requested_count === x.requested_count, mission.requested_count ?? null);
  const industry = byDim("industry");
  v("I2", "I", `a hard industry criterion naming "${x.industry_includes}"`,
    industry.length === 1 && lower(industry[0].value).includes(x.industry_includes), industry.map((c) => c.value));
  const geo = byDim("geography");
  v("I3", "I", `a hard geography criterion: ${x.geography.value}, scope ${x.geography.scope}`,
    geo.length === 1 && geo[0].value === x.geography.value && geo[0].geography_scope === x.geography.scope,
    geo.map((c) => ({ value: c.value, scope: c.geography_scope ?? null })));
  const size = byDim("company_size");
  v("I4", "I", `a hard company-size criterion ${x.company_size.min}–${x.company_size.max}`,
    size.length === 1 && size[0].value?.min === x.company_size.min && size[0].value?.max === x.company_size.max, size.map((c) => c.value));
  const hiring = byDim("hiring");
  const terms: string[] = hiring.flatMap((c) => c.value?.qualifier?.role_terms ?? []).map(lower);
  v("I5", "I", `a hard hiring criterion for "${x.hiring.role_term}" within ${x.hiring.window_days} days`,
    hiring.length === 1 && terms.includes(x.hiring.role_term) && hiring[0].time_window?.days === x.hiring.window_days,
    hiring.map((c) => ({ terms: c.value?.qualifier?.role_terms ?? null, days: c.time_window?.days ?? null })));
  const extra = hard.filter((c) => !["industry", "geography", "company_size", "hiring"].includes(c.dimension));
  v("I6", "I", "no hard criterion the request does not state", extra.length === 0, extra.map((c) => c.label ?? c.dimension));
  const disallowed: string[] = mission.directives?.disallowed_broadening ?? [];
  v("I7", "I", `broadening disallowed for ${x.disallowed_broadening.join(", ")}`,
    x.disallowed_broadening.every((d) => disallowed.includes(d)), disallowed);
  const prohibited: string[] = mission.prohibited_capabilities ?? [];
  v("I8", "I", `no people or contact purchase requested (${x.prohibited_capabilities.join(", ")} prohibited)`,
    x.prohibited_capabilities.every((p) => prohibited.includes(p)), prohibited);
  // I9 — STRICTER THAN I5, NEVER INSTEAD OF IT (independent review of PR #194).
  // I5 asks that the requested role be present; it cannot see a role ADDED
  // beside it ("Account Executive or SDR"), which would let SDR postings
  // qualify. Every hard hiring role term must be the requested one (a regular
  // plural allowed), and every role family one the request's role belongs to.
  const singular = (t: string) => lower(t).trim().replace(/s$/, "");
  const extraTerms = terms.filter((t) => singular(t) !== singular(x.hiring.role_term));
  const families: string[] = hiring.flatMap((c) => c.value?.qualifier?.role_families ?? []);
  const extraFamilies = families.filter((f) => !x.hiring.role_families.includes(f));
  // Second review (N1, N2): the RUNTIME reads `required_signals[]` — its
  // top-level `role_families` and `qualifier.role_terms` /
  // `excluded_role_terms` — not the criteria. So those exact fields are
  // checked too, the top-level families must equal the qualifier's, and no
  // excluded role may rule out the requested one (or any required term).
  const sigs: Json[] = (Array.isArray(mission.required_signals) ? mission.required_signals : [])
    .filter((s: Json) => (s.event ?? s.type) === "hiring");
  const sigTerms: string[] = sigs.flatMap((s) => s.qualifier?.role_terms ?? []).map(lower);
  const extraSigTerms = sigTerms.filter((t) => singular(t) !== singular(x.hiring.role_term));
  const topFamilies: string[] = sigs.flatMap((s) => s.role_families ?? []);
  const extraTopFamilies = topFamilies.filter((f) => !x.hiring.role_families.includes(f));
  const sameSet = (a: readonly string[], b: readonly string[]) =>
    new Set(a).size === new Set(b).size && a.every((f) => b.includes(f));
  const familyMismatch = sigs.filter((s) => !sameSet(s.role_families ?? [], s.qualifier?.role_families ?? []))
    .map((s) => ({ top: s.role_families ?? null, qualifier: s.qualifier?.role_families ?? null }));
  const wordsOf = (t: string) => ` ${lower(t).replace(/[^a-z0-9]+/g, " ").trim().split(" ").map((w) => w.replace(/s$/, "")).join(" ")} `;
  const required = [x.hiring.role_term, ...terms, ...sigTerms];
  const excluded: string[] = [...hiring.flatMap((c) => c.value?.qualifier?.excluded_role_terms ?? []),
    ...sigs.flatMap((s) => s.qualifier?.excluded_role_terms ?? [])].map(lower);
  const contradictions = excluded.filter((e) => required.some((r) => wordsOf(r).includes(wordsOf(e))));
  // W1: the window and the role the RUNTIME enforces are the signal's own —
  // `timeframe_days` and `qualifier.role_terms` — not the criterion's display
  // window (a default the criterion shows even when the runtime has none).
  // Every hiring signal must carry exactly the requested window and the
  // requested role, and no recorded window conflict.
  const runtimeWindowWrong = sigs.filter((s) => s.timeframe_days !== x.hiring.window_days || s.window_conflict != null)
    .map((s) => ({ timeframe_days: s.timeframe_days ?? null, window_conflict: s.window_conflict ?? null }));
  const runtimeRoleMissing = sigs.filter((s) =>
    !(s.qualifier?.role_terms ?? []).some((t: string) => singular(t) === singular(x.hiring.role_term))).length;
  v("I9", "I", `no hard hiring role beyond "${x.hiring.role_term}" (families ${x.hiring.role_families.join(", ")}), ` +
      `the runtime's own role fields agree and carry the requested role and ${x.hiring.window_days}-day window, ` +
      "and no exclusion rules the requested role out",
    hiring.length >= 1 && sigs.length >= 1 && extraTerms.length === 0 && extraFamilies.length === 0 &&
      extraSigTerms.length === 0 && extraTopFamilies.length === 0 && familyMismatch.length === 0 && contradictions.length === 0 &&
      runtimeWindowWrong.length === 0 && runtimeRoleMissing === 0,
    { extra_terms: extraTerms, extra_families: extraFamilies, runtime_extra_terms: extraSigTerms,
      runtime_extra_families: extraTopFamilies, family_mismatch: familyMismatch, excluded_contradictions: contradictions,
      runtime_window_wrong: runtimeWindowWrong, runtime_signals_missing_role: runtimeRoleMissing });

  // ── P. RESEARCH PLAN ──────────────────────────────────────────────────────
  const plan: Json = ev.execution_plan ?? {};
  const steps: Json[] = Array.isArray(plan.steps) ? plan.steps : [];
  v("P1", "P", "the plan came from the model and passed validation (no deterministic fallback, no violations)",
    plan.source === "model_validated" && Array.isArray(plan.violations) && plan.violations.length === 0,
    { source: plan.source ?? null, violations: plan.violations ?? null });
  const actors = steps.map((s) => s.actor_key).filter((a) => a != null);
  v("P2", "P", "every provider step uses an approved actor", actors.length > 0 && actors.every((a) => x.approved_actor_keys.includes(a)), actors);
  const first = steps.find((s) => s.actor_key != null) ?? null;
  const fi: Json = first?.input ?? {};
  v("P3", "P", `the first purchase is ${x.first_step.capability} on ${x.first_step.actor_key}: titles ${JSON.stringify(x.first_step.jobTitles)}, locations ${JSON.stringify(x.first_step.locations)}, ≤ ${x.first_step.max_items} items, posted "${x.first_step.posted_limit}"`,
    !!first && first.capability === x.first_step.capability && first.actor_key === x.first_step.actor_key &&
      JSON.stringify(fi.jobTitles) === JSON.stringify(x.first_step.jobTitles) &&
      JSON.stringify(fi.locations) === JSON.stringify(x.first_step.locations) &&
      typeof fi.maxItems === "number" && fi.maxItems <= x.first_step.max_items && fi.postedLimit === x.first_step.posted_limit,
    first ? { capability: first.capability, actor_key: first.actor_key, input: fi } : null);
  const qualifies = steps.some((s) => s.capability === "company_brain_qualification");
  v("P4", "P", "the plan qualifies companies against the stated requirements before persisting", qualifies,
    steps.map((s) => s.capability));

  // ── R. PROVIDER RESTRICTION ───────────────────────────────────────────────
  const ops: Json[] = ev.smoke_operations ?? [];
  const providerOps = ops.filter((o) => o.kind === "provider");
  const pollOps = ops.filter((o) => o.kind === "poll");
  v("R1", "R", "no provider purchase and no provider read was admitted", providerOps.length === 0 && pollOps.length === 0,
    { provider: providerOps.length, poll: pollOps.length });
  const providerRows: Json[] = (ev.ledger ?? []).filter((r: Json) => r.record_kind === "provider_call");
  const withRun = providerRows.filter((r) => String(r.provider_run_id ?? "").trim() !== "");
  v("R2", "R", "no provider call names a run (nothing started at the vendor)", withRun.length === 0,
    providerRows.map((r) => ({ actor: r.actor_id, status: r.status, failure: r.failure_code, run: r.provider_run_id })));
  const credits: Json[] = ev.credit_transactions ?? [];
  v("R3", "R", "no credit charged or held; every reservation refunded",
    credits.every((c) => c.status === "not_charged" || c.status === "released") &&
      ev.balance?.balance_credits === x.starting_credits && ev.balance?.reserved_credits === 0,
    { credits: credits.map((c) => c.status), balance: ev.balance ?? null });
  v("R4", "R", "the Apify console shows no run on the test account during the window", "manual",
    "operator: Apify → Runs, filtered to the window; expected none");

  // ── M. MODEL SPEND ────────────────────────────────────────────────────────
  const modelOps = ops.filter((o) => o.kind === "model");
  const runModelRows: Json[] = (ev.ledger ?? []).filter((r: Json) => r.record_kind === "model_call" && r.source === "run");
  const compileRows: Json[] = (ev.ledger ?? []).filter((r: Json) => r.record_kind === "model_call" && r.source === "kickoff");
  v("M1", "M", `≤ ${x.max_model_calls} model calls admitted, each at the template's committed maximum (${x.committed_per_call_microusd} µ$), total ≤ ${x.model_allocation_microusd} µ$`,
    modelOps.length >= 1 && modelOps.length <= x.max_model_calls &&
      modelOps.every((o) => Number(o.committed_microusd) === x.committed_per_call_microusd) &&
      modelOps.reduce((a, o) => a + Number(o.committed_microusd), 0) <= x.model_allocation_microusd,
    modelOps.map((o) => Number(o.committed_microusd)));
  v("M2", "M", "every admitted model call has exactly one ledger row (and the compilation has its own)",
    runModelRows.length === modelOps.length && compileRows.length === 1,
    { admitted: modelOps.length, run_rows: runModelRows.length, compile_rows: compileRows.length });
  const allModel = [...compileRows, ...runModelRows];
  const malformed = allModel.filter((r) => r.metadata?.model !== x.model || !(r.metadata?.input_tokens > 0) || !(r.metadata?.output_tokens > 0));
  v("M3", "M", `every model row names ${x.model} and the provider's token counts`, allModel.length > 0 && malformed.length === 0,
    allModel.map((r) => ({ role: r.metadata?.role, model: r.metadata?.model, in: r.metadata?.input_tokens, cached: r.metadata?.cached_input_tokens, out: r.metadata?.output_tokens })));
  const mispriced = allModel.filter((r) =>
    r.cost_source !== "event_priced" || Number(r.estimated_cost_usd) !== expectedModelCostUsd(r.metadata, x.price_per_1m));
  v("M4", "M", "every row is priced from its token counts at the price card (event_priced; no invented figure)",
    allModel.length > 0 && mispriced.length === 0,
    allModel.map((r) => ({ role: r.metadata?.role, recorded: r.estimated_cost_usd, expected: expectedModelCostUsd(r.metadata, x.price_per_1m), source: r.cost_source })));
  const runCostMicro = runModelRows.reduce((a, r) => a + Math.round(Number(r.estimated_cost_usd) * 1e6), 0);
  const committedMicro = modelOps.reduce((a, o) => a + Number(o.committed_microusd), 0);
  v("M5", "M", "recorded run spend never exceeds what admission committed", runCostMicro <= committedMicro,
    { recorded_microusd: runCostMicro, committed_microusd: committedMicro });
  const tokens = allModel.reduce((a, r) => ({
    input: a.input + (r.metadata?.input_tokens ?? 0), cached: a.cached + (r.metadata?.cached_input_tokens ?? 0),
    output: a.output + (r.metadata?.output_tokens ?? 0),
  }), { input: 0, cached: 0, output: 0 });
  v("M6", "M", "OpenAI's usage for the test project and window equals these token totals; its billed cost is within the ledger estimate plus cache writes", "manual",
    { ledger_tokens: tokens, ledger_usd: round6(allModel.reduce((a, r) => a + Number(r.estimated_cost_usd), 0)),
      note: "the price card has no cache-write rate: allow billed ≤ ledger + 0.05 $/1M × input tokens" });

  // ── T. AN HONEST, CONTAINED ENDING ────────────────────────────────────────
  v("T1", "T", "the mission ended with exactly one terminal verdict", Array.isArray(ev.terminal) && ev.terminal.length === 1, ev.terminal ?? null);
  v("T2", "T", "nothing was persisted or qualified without evidence", Number(ev.leads ?? 0) === 0, { leads: ev.leads ?? null });
  v("T3", "T", "the credit check lists nothing", Array.isArray(ev.credit_check) && ev.credit_check.length === 0, ev.credit_check ?? null);
  return out;
}

/**
 * THE PROVIDERS-OFF REHEARSAL (workflow `providers: none`, preparer `--proposal`):
 * the same kickoff and worker with no model or vendor key and both hosts denied.
 * Nothing may reach a vendor, be admitted, charged, held or persisted, and the
 * mission must end terminally with one verdict. On this candidate (without
 * #149) that verdict is `unhandled_exception` (the planner has no key); with
 * #149 it would be a refusal before execution. Either is a contained ending;
 * any other terminal verdict, or none, fails.
 */
export const PROVIDERS_OFF_TERMINALS = ["unhandled_exception", "refused_before_execution", "execution_planner_unavailable"];

export function judgeProvidersOff(ev: Json, x: Expectations = A7_EXPECTATIONS): Verdict[] {
  const out: Verdict[] = [];
  const v = (id: string, criterion: string, ok: boolean, observed: unknown) =>
    out.push({ id, question: id.startsWith("O") ? "R" : "T", criterion, result: ok ? "PASS" : "FAIL",
      observed: typeof observed === "string" ? observed : JSON.stringify(observed) });
  const ops: Json[] = ev.smoke_operations ?? [];
  const ledger: Json[] = ev.ledger ?? [];
  const credits: Json[] = ev.credit_transactions ?? [];
  v("O1", "the queue row ended terminally (failed or complete), never left claimable",
    ["failed", "complete"].includes(ev.queue?.status), ev.queue?.status ?? null);
  v("O2", `exactly one contained terminal verdict (${PROVIDERS_OFF_TERMINALS.join(" / ")})`,
    Array.isArray(ev.terminal) && ev.terminal.length === 1 && PROVIDERS_OFF_TERMINALS.includes(ev.terminal[0]), ev.terminal ?? null);
  v("O3", "no admitted operation of any kind (model, provider, poll)", ops.length === 0, ops.map((o) => o.kind));
  v("O4", "no ledger row: no model call (the compile was offline) and no provider call", ledger.length === 0,
    ledger.map((r) => ({ kind: r.record_kind, source: r.source, status: r.status })));
  v("O5", `no credit charged or held; balance ${x.starting_credits}, 0 reserved`,
    credits.every((c) => c.status === "not_charged" || c.status === "released") &&
      ev.balance?.balance_credits === x.starting_credits && ev.balance?.reserved_credits === 0,
    { credits: credits.map((c) => c.status), balance: ev.balance ?? null });
  v("O6", "nothing persisted or qualified", Number(ev.leads ?? 0) === 0, { leads: ev.leads ?? null });
  v("O7", "the credit check lists nothing", Array.isArray(ev.credit_check) && ev.credit_check.length === 0, ev.credit_check ?? null);
  return out;
}

/** PASS when no automatic criterion failed; MANUAL rows still need the operator's sign-off. */
export function overall(verdicts: Verdict[]): "PASS" | "FAIL" {
  return verdicts.some((v) => v.result === "FAIL") ? "FAIL" : "PASS";
}
