// ONE ESTIMATE PER PROVIDER CALL: AFFORDABILITY READS WHAT THE LEDGER RESERVES.
//
// Canary 8 (production 2026-10-04, task c01d28d8). PR #22's affordability gate
// priced a job search from its RAW input: 12 titles × 10 rows = $0.121. The
// ledger never reserves that — the ProviderCallSpec compiler clamps the rows to
// the $0.05 hiring call ceiling (4 per title) and reserves $0.049. $0.121 alone
// is past the $0.06 per-company ceiling, so every company was marked
// unaffordable, no job search was bought in 8 slices, and the mission widened
// discovery until the hard budget cap stopped it.
//
// LlamaIndex is the counterexample: $0.0098 spent + $0.049 = $0.0588 ≤ $0.06 —
// the ledger would have bought it. Solana Labs ($0.0236), Delta Lake and
// Actioneer ($0.0235) are the opposite: + $0.049 > $0.06, correctly blocked.
//
// Now the gate compiles the call the verifier would send with the SAME spec
// compiler the purchase uses and asks the ledger's own candidate check of
// `spec.cost.estimate_usd` (`ledgerAffordability`). These tests drive the real
// compiler, the real `ledgerBoundCall` and the real `reserve`; only the
// provider invocation is stubbed.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  candidateCeilingRefusal, DEFAULT_CEILINGS, markExecuted, newSpendLedger, reserve, settle, type Ceilings,
  type SpendLedger,
} from "../../../supabase/functions/_shared/budgetPolicy.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import {
  ledgerAffordability, ledgerBoundCall, unaffordableRoutes, type VerifiableCandidate, type VerificationTarget,
} from "../../../supabase/functions/_shared/claimVerifier.ts";
import {
  HIRING_ROUTE_ACTOR, hiringClaimVerifier, hiringEstimatePerTargetUsd,
} from "../../../supabase/functions/_shared/hiringClaimVerifier.ts";
import { hiringActorCard } from "../../../supabase/functions/_shared/hiringActorCatalog.ts";
import { runClaimVerificationPhase } from "../../../supabase/functions/_shared/claimVerificationPhase.ts";
import { verifierSpecCompiler } from "../../../supabase/functions/_shared/verifierCallSpec.ts";
import { criteriaExecutionPolicy } from "../../../supabase/functions/_shared/criteriaExecutionPolicy.ts";
import { PRODUCTION_READINESS } from "../../../supabase/functions/_shared/routeReadiness.ts";

globalThis.fetch = () => { throw new Error("hiring affordability tests must not reach the network"); };

const co = (slug: string) => `https://www.linkedin.com/company/${slug}`;
const LLAMA = co("llamaindex");
const SOLANA = co("solana-labs");
const DELTA = co("delta-lake");
const ACTIONEER = co("actioneer");

/** Canary 8's compiled role vocabulary: 12 title keywords. */
const TITLES_12 = [
  "sales", "account executive", "sdr", "bdr", "sales development", "business development",
  "account manager", "sales manager", "head of sales", "vp sales", "sales director", "revenue",
];
/** The older, smaller vocabulary (Canary 7). */
const TITLES_4 = ["sales", "account executive", "sdr", "bdr"];
const io = (titles: readonly string[]) => ({
  titles, role_families: ["sales"], window_days: 30, matchesRole: (t: string) => /sales|account|sdr|bdr/i.test(t),
});
const HIRING_CHECK = { criterion_id: "hiring:sales", dimension: "hiring", result: "unknown", reason: "hiring is not established" };

/** A ledger holding what each company had bought before the job search. */
function ledgerWith(spent: Record<string, number>, ceilings: Ceilings = { ...DEFAULT_CEILINGS }): SpendLedger {
  const l = newSpendLedger(ceilings);
  for (const [key, usd] of Object.entries(spent)) {
    // In purchases of at most $0.03, so no prior call meets its own call ceiling.
    for (let left = usd, n = 0; left > 1e-9; n++) {
      const part = Math.round(Math.min(left, 0.03) * 10000) / 10000;
      const k = `prior:${key}:${n}`;
      assert(reserve(l, { idempotency_key: k, provider_call_id: k, purpose: "funding_evidence", route_id: null,
        candidate_keys: [key], estimate_usd: part }).ok);
      markExecuted(l, k, part);
      settle(l, k, part);
      left = Math.round((left - part) * 10000) / 10000;
    }
  }
  return l;
}

/** The compiler run-agent builds once per phase (`verifierSpecFor`). */
const specFor = (ledger: SpendLedger) => verifierSpecCompiler({
  scope: { workspace_id: "ws", lineage_id: "ln" }, mission_hash: "mh",
  policy: criteriaExecutionPolicy({ company_profile: {}, required_signals: [] } as never),
  ceilings: () => ledger.ceilings, readiness: PRODUCTION_READINESS,
});

const target = (key: string): VerificationTarget => ({
  company_key: key, name: null, domain: null, linkedin_url: key,
  criterion: { criterion_id: HIRING_CHECK.criterion_id, dimension: "hiring", value: ["sales"] },
  graph: buildCompanyEvidenceGraph(key, [], {}),
});
const candidate = (key: string, ops: string[]): VerifiableCandidate => ({
  company_key: key, name: null, domain: null, linkedin_url: key,
  graph: buildCompanyEvidenceGraph(key, [], {}), eligibility: "pending", hard_checks: [HIRING_CHECK],
  attempted_routes: [], unaffordable_routes: unaffordableRoutes(ops),
});

/**
 * The verification phase exactly as run-agent wires it: ONE spec compiler for
 * `ledgerBoundCall` (the purchase) and `ledgerAffordability` (the gate), one
 * ledger. Only the provider is stubbed.
 */
async function replay(spent: Record<string, number>, titles: readonly string[], ceilings?: Ceilings) {
  const ledger = ledgerWith(spent, ceilings);
  const spec = specFor(ledger);
  const invoked: Array<{ candidate_keys: string[]; estimate_usd: number; input: Record<string, unknown> }> = [];
  const ops: Record<string, string[]> = {};
  const marked: string[] = [];
  const keys = Object.keys(spent);
  const report = await runClaimVerificationPhase({
    mission_id: "c01d28d8", requested_count: 5,
    candidates: () => keys.map((k) => candidate(k, ops[k] ?? [])),
    qualified: () => 0,
    criteriaValue: () => ["sales"],
    verifiers: [hiringClaimVerifier(io(titles))],
    pending: [],
    deps: {
      call: ledgerBoundCall({
        ledger, spec,
        actorIdFor: (k) => hiringActorCard(k)?.actor_id ?? null,
        invoke: (c) => {
          invoked.push({ candidate_keys: [...c.providerCallSpec.candidate_keys], estimate_usd: c.providerCallSpec.cost.estimate_usd, input: c.input });
          return Promise.resolve([]);
        },
        hash: () => "h",
      }),
      now: () => "2026-10-04T18:00:00.000Z", log: () => {},
    },
    apply: () => false,
    affordability: ledgerAffordability({ ledger, spec }),
    markUnaffordable: (key, v) => {
      marked.push(key);
      (ops[key] ??= []).push(`unaffordable:${v.route_actor}`);
    },
  });
  const hiring = ledger.reservations.filter((r) => r.purpose === "hiring_evidence");
  return { report, invoked, marked, ledger, hiring };
}

// ── CASES 1–4: THE CANARY 8 COMPANIES, ONE AT A TIME ───────────────────────

Deno.test("CASE 1 — LlamaIndex: $0.0098 + compiled $0.049 = $0.0588 ≤ $0.06 → AFFORDABLE, the job search runs", async () => {
  const { report, invoked, marked, hiring } = await replay({ [LLAMA]: 0.0098 }, TITLES_12);
  assertEquals(marked, [], "not marked unaffordable");
  assertEquals(report.unaffordable, []);
  assertEquals(invoked.length, 1, "the hiring verifier reached the provider");
  assertEquals(invoked[0].candidate_keys, [LLAMA]);
  assertEquals(invoked[0].estimate_usd, 0.049);
  assertEquals(hiring.length, 1);
  assertEquals([hiring[0].status, hiring[0].estimate_usd], ["executed", 0.049]);
  // PR #22's raw figure would have blocked it.
  assert(0.0098 + hiringEstimatePerTargetUsd(io(TITLES_12))! > 0.06);
});

for (const [name, key, spent] of [
  ["CASE 2 — Solana Labs", SOLANA, 0.0236],
  ["CASE 3 — Delta Lake", DELTA, 0.0235],
  ["CASE 4 — Actioneer", ACTIONEER, 0.0235],
] as const) {
  Deno.test(`${name}: $${spent} + compiled $0.049 > $0.06 → UNAFFORDABLE, nothing bought, route marked`, async () => {
    const { report, invoked, marked, hiring } = await replay({ [key]: spent }, TITLES_12);
    assertEquals(invoked.length, 0, "no provider call");
    assertEquals(hiring.length, 0, "no reservation, not even a refused one");
    assertEquals(marked, [key]);
    const u = report.unaffordable![0];
    assertEquals([u.company_key, u.estimate_usd, u.limit_usd], [key, 0.049, 0.06]);
    assertAlmostEquals(u.spent_usd, spent, 1e-9);
    assert(u.spent_usd + u.estimate_usd > u.limit_usd);
  });
}

Deno.test("CANARY 8 REPLAY: the four companies together — only LlamaIndex is bought; the batch is not refused whole", async () => {
  const { invoked, marked, hiring } = await replay(
    { [LLAMA]: 0.0098, [SOLANA]: 0.0236, [DELTA]: 0.0235, [ACTIONEER]: 0.0235 }, TITLES_12);
  assertEquals(marked.sort(), [ACTIONEER, DELTA, SOLANA].sort());
  assertEquals(invoked.map((c) => c.candidate_keys), [[LLAMA]]);
  assertEquals(hiring.map((r) => r.status), ["executed"]);
});

// ── CASES 5–6: THE VOCABULARY SIZE ─────────────────────────────────────────

Deno.test("CASE 5 — 12 titles: raw input prices $0.121, the gate uses the compiled $0.049 the ledger reserves", async () => {
  assertEquals(hiringEstimatePerTargetUsd(io(TITLES_12)), 0.121, "start $0.001 + 10 rows × 12 titles × $0.001");
  const ledger = ledgerWith({});
  const call = hiringClaimVerifier(io(TITLES_12)).call_for!([target(LLAMA)])!;
  assertEquals(call.input.maxItems, 10, "the verifier asks for 10 rows per title");
  const spec = specFor(ledger)(call);
  assertEquals(spec.serialized_input.maxItems, 4, "the $0.05 call ceiling affords 49 rows: 4 per title");
  assertEquals(spec.cost.estimate_usd, 0.049);
  assertEquals(ledgerAffordability({ ledger, spec: specFor(ledger) })(call), { ok: true, estimate_usd: 0.049 });
  // Solana's report carries the compiled figure, never the raw one.
  const { report } = await replay({ [SOLANA]: 0.0236 }, TITLES_12);
  assertEquals(report.unaffordable![0].estimate_usd, 0.049);
});

Deno.test("CASE 6 — 4 titles: no clamp, raw = compiled = $0.041; Canary 7's LlamaIndex ($0.0304) still blocked, $0.019 still bought", async () => {
  assertEquals(hiringEstimatePerTargetUsd(io(TITLES_4)), 0.041);
  const ledger = ledgerWith({});
  assertEquals(specFor(ledger)(hiringClaimVerifier(io(TITLES_4)).call_for!([target(LLAMA)])!).cost.estimate_usd, 0.041);
  const blocked = await replay({ [LLAMA]: 0.0304 }, TITLES_4);
  assertEquals([blocked.invoked.length, blocked.marked], [0, [LLAMA]]);
  assertEquals(blocked.report.unaffordable![0].estimate_usd, 0.041);
  const bought = await replay({ [LLAMA]: 0.019 }, TITLES_4);
  assertEquals([bought.invoked.length, bought.marked.length], [1, 0]);
});

// ── CASE 7: THE BOUNDARY IS RESERVE'S ──────────────────────────────────────

Deno.test("CASE 7 — exact boundary: spent + compiled == limit is AFFORDABLE, as `reserve` allows it; one hundredth of a cent over is not", async () => {
  const at = await replay({ [LLAMA]: 0.011 }, TITLES_12); // 0.011 + 0.049 = 0.06
  assertEquals([at.invoked.length, at.marked.length], [1, 0]);
  assertEquals(at.hiring[0].status, "executed", "reserve accepted the equal case");
  const over = await replay({ [LLAMA]: 0.0111 }, TITLES_12);
  assertEquals([over.invoked.length, over.marked], [0, [LLAMA]]);
  // And reserve agrees on both sides of the line.
  for (const [spent, ok] of [[0.011, true], [0.0111, false]] as const) {
    const l = ledgerWith({ [LLAMA]: spent });
    const spec = specFor(l)(hiringClaimVerifier(io(TITLES_12)).call_for!([target(LLAMA)])!);
    assertEquals(reserve(l, { idempotency_key: spec.idempotency_key, provider_call_id: spec.provider_call_id,
      purpose: spec.purpose, route_id: null, candidate_keys: spec.candidate_keys, estimate_usd: spec.cost.estimate_usd }).ok, ok);
  }
});

// ── CASE 8: THE COMPILER DECIDES, AND THE GATE FOLLOWS ─────────────────────

Deno.test("CASE 8 — the call ceiling changes the compiled rows; affordability follows with no change of its own", async () => {
  const tight: Ceilings = { ...DEFAULT_CEILINGS, per_call_usd: { ...DEFAULT_CEILINGS.per_call_usd, hiring_evidence: 0.03 } };
  // $0.03 affords 29 rows: 2 per title → $0.025. Solana now fits: 0.0236 + 0.025 = 0.0486.
  const solana = await replay({ [SOLANA]: 0.0236 }, TITLES_12, tight);
  assertEquals([solana.invoked.length, solana.marked.length], [1, 0]);
  assertEquals(solana.invoked[0].estimate_usd, 0.025);
  assertEquals(solana.invoked[0].input.maxItems, 2);
  assertEquals(solana.hiring[0].estimate_usd, 0.025);
  const loose: Ceilings = { ...DEFAULT_CEILINGS, per_call_usd: { ...DEFAULT_CEILINGS.per_call_usd, hiring_evidence: 0.10 } };
  // $0.10 affords 99 rows: 8 per title → $0.097. LlamaIndex no longer fits.
  const llama = await replay({ [LLAMA]: 0.0098 }, TITLES_12, loose);
  assertEquals([llama.invoked.length, llama.marked], [0, [LLAMA]]);
  assertEquals(llama.report.unaffordable![0].estimate_usd, 0.097);
  // The raw ordering estimate never moved; the gate did not read it.
  assertEquals(hiringEstimatePerTargetUsd(io(TITLES_12)), 0.121);
});

Deno.test("CASE 8b — a spec the compiler refuses is not an affordability verdict: nothing marked, nothing bought", async () => {
  // $0.01 affords 9 rows — under one per title, so the clamp cannot apply and the spec is refused at the call ceiling.
  const tiny: Ceilings = { ...DEFAULT_CEILINGS, per_call_usd: { ...DEFAULT_CEILINGS.per_call_usd, hiring_evidence: 0.01 } };
  const ledger = ledgerWith({}, tiny);
  const call = hiringClaimVerifier(io(TITLES_12)).call_for!([target(LLAMA)])!;
  assertEquals(specFor(ledger)(call).status, "refused_budget");
  assertEquals(ledgerAffordability({ ledger, spec: specFor(ledger) })(call), null);
  const r = await replay({ [LLAMA]: 0 }, TITLES_12, tiny);
  assertEquals([r.invoked.length, r.marked.length, r.hiring.length], [0, 0, 0]);
});

// ── CASE 9: THE INVARIANT ──────────────────────────────────────────────────

Deno.test("CASE 9 — INVARIANT: for the same compiled spec, affordability estimate === reservation estimate, and the verdicts agree", async () => {
  let checked = 0;
  for (const titleCount of [1, 2, 3, 4, 5, 7, 12, 15]) {
    const titles = Array.from({ length: titleCount }, (_, i) => `role ${i}`);
    for (const perCall of [0.02, 0.03, 0.05, 0.10]) {
      const ceilings: Ceilings = { ...DEFAULT_CEILINGS, per_call_usd: { ...DEFAULT_CEILINGS.per_call_usd, hiring_evidence: perCall } };
      for (const spent of [0, 0.0098, 0.011, 0.0235, 0.0236, 0.0304, 0.05, 0.06]) {
        const ledger = ledgerWith({ [LLAMA]: spent }, ceilings);
        const call = hiringClaimVerifier(io(titles)).call_for!([target(LLAMA)])!;
        const spec = specFor(ledger)(call);
        const gate = ledgerAffordability({ ledger, spec: specFor(ledger) })(call);
        if (spec.status !== "intended") { assertEquals(gate, null); continue; }
        assertEquals(gate!.estimate_usd, spec.cost.estimate_usd, "the gate prices the spec");
        const d = reserve(ledger, { idempotency_key: spec.idempotency_key, provider_call_id: spec.provider_call_id,
          purpose: spec.purpose, route_id: null, candidate_keys: spec.candidate_keys, estimate_usd: spec.cost.estimate_usd });
        assertEquals(d.reservation.estimate_usd, gate!.estimate_usd, "the reservation holds the same figure");
        // Under the default ceilings nothing but the candidate ceiling can refuse here.
        assertEquals(gate!.ok, d.ok, `${titleCount} titles, $${perCall} call ceiling, $${spent} spent`);
        if (!d.ok) assertEquals(d.ceiling, "candidate");
        checked++;
      }
    }
  }
  assert(checked > 200, `checked ${checked}`);
});

Deno.test("CASE 9b — `reserve` and the gate share ONE candidate check (`candidateCeilingRefusal`)", async () => {
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/budgetPolicy.ts", import.meta.url));
  const body = src.slice(src.indexOf("export function reserve("), src.indexOf("export function missionBudgetState"));
  assert(body.includes("candidateCeilingRefusal(l,"), "reserve asks the shared check");
  assert(!body.includes("per_candidate_evidence_usd + 1e-9"), "no second inline copy of the comparison");
  const gate = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/claimVerifier.ts", import.meta.url));
  const fn = gate.slice(gate.indexOf("export function ledgerAffordability("));
  assert(fn.includes("candidateCeilingRefusal(d.ledger"), "the gate asks the same check");
  assert(fn.includes("spec.cost.estimate_usd"), "of the compiled estimate");
  assert(!/estimateCallUsd|estimate_per_target_usd|hiringEstimatePerTargetUsd/.test(fn), "and prices nothing itself");
  const phase = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/claimVerificationPhase.ts", import.meta.url));
  const aff = phase.slice(phase.indexOf("const affordable = "), phase.indexOf("// IN FLIGHT"));
  assert(!aff.includes("costOf("), "the phase's affordability never reads the ordering estimate");
  // Behaviour, not only source: the exported check is reserve's verdict.
  const l = ledgerWith({ [SOLANA]: 0.0236 });
  assertEquals(candidateCeilingRefusal(l, { purpose: "hiring_evidence", candidate_keys: [SOLANA], estimate_usd: 0.049 })?.company_key, SOLANA);
  assertEquals(candidateCeilingRefusal(l, { purpose: "hiring_evidence", candidate_keys: [SOLANA], estimate_usd: 0.0364 }), null);
});

// ── CASES 10–11: THE GATE AND THE PROVIDER ─────────────────────────────────

Deno.test("CASE 10 — truly unaffordable: no provider call executes, the ledger stays clean, continuation stops asking", async () => {
  const { invoked, hiring, ledger, marked } = await replay({ [SOLANA]: 0.05 }, TITLES_12);
  assertEquals(invoked.length, 0);
  assertEquals(hiring.length, 0);
  assertEquals(ledger.reservations.filter((r) => r.status === "refused_budget").length, 0, "refused before reserve, not by it");
  assertEquals(marked, [SOLANA]);
});

Deno.test("CASE 11 — affordable: the gate does not stand between the verifier and the provider", async () => {
  const { invoked, hiring, report } = await replay({ [LLAMA]: 0 }, TITLES_12);
  assertEquals(invoked.length, 1);
  assertEquals(hiring.map((r) => [r.status, r.estimate_usd]), [["executed", 0.049]]);
  assertEquals(report.ran.map((r) => r.targets), [[LLAMA]]);
});

Deno.test("the verifier's purchase and its priced call are one builder: `verify` sends exactly `call_for`'s input", async () => {
  const v = hiringClaimVerifier(io(TITLES_12));
  const t = [target(LLAMA), target(SOLANA)];
  const sent: unknown[] = [];
  await v.verify(t, {
    call: (c) => { sent.push(c); return Promise.resolve({ status: "refused", reason: "x" }); },
    ready: () => true, now: () => "", log: () => {},
  }, { mission_id: null, pending: [] });
  assertEquals(sent, [v.call_for!(t)]);
});
