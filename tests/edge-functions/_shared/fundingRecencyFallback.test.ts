// THE NARROW PVALYOU FALLBACK FOR A HARD `recently_funded` CLAIM.
//
// Live canaries 1156c062 and 5bfa76db (2026-09-24): Atomus FOUND How to AI,
// BigRio and Design Milk and returned zero rounds with no completeness, so
// recency stayed PENDING and — correctly — no job search or Firecrawl was ever
// bought. Atomus stays PRIMARY; Pvalyou is asked ONCE, only when Atomus ran,
// was not decisive, the claim is HARD, the candidate viable, and Pvalyou has
// not already answered. Pvalyou can PASS (a verified dated round in the window)
// and can never FAIL: it states no complete history, and absence is not
// completeness.
//
// Pure. The provider is scripted; no network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fundingStageVerifier } from "../../../supabase/functions/_shared/fundingStageVerifier.ts";
import type {
  ClaimVerifier, VerificationTarget, VerifierCall, VerifierCallOutcome, VerifierFinding,
} from "../../../supabase/functions/_shared/claimVerifier.ts";
import { attemptedRoutes, ledgerBoundCall, verificationTargets } from "../../../supabase/functions/_shared/claimVerifier.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { PRODUCTION_READINESS } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { buildClaimPlan } from "../../../supabase/functions/_shared/claimPlan.ts";
import { runClaimVerificationPhase } from "../../../supabase/functions/_shared/claimVerificationPhase.ts";
import { CLAIM_REGISTRY, evidenceGapsFor } from "../../../supabase/functions/_shared/evidenceGapRouter.ts";
import { hiringClaimVerifier } from "../../../supabase/functions/_shared/hiringClaimVerifier.ts";
import { roleMatchesFamily } from "../../../supabase/functions/_shared/roleFamilies.ts";
import { verifierSpecCompiler } from "../../../supabase/functions/_shared/verifierCallSpec.ts";
import { criteriaExecutionPolicy } from "../../../supabase/functions/_shared/criteriaExecutionPolicy.ts";
import { newSpendLedger, resolveCeilings } from "../../../supabase/functions/_shared/budgetPolicy.ts";
import { parseRunBudget, tightenCeilings } from "../../../supabase/functions/_shared/runBudget.ts";
import type { EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";

globalThis.fetch = () => { throw new Error("these tests must not reach the network"); };

const NOW = new Date("2026-09-24T16:00:00.000Z");
const ATOMUS = "apify_funding_atomus", PVALYOU = "apify_funding_pvalyou";
type Row = Record<string, unknown>;

// ── scripted provider rows, in the recorded shapes (p6-funding-probes.json) ──
/** Atomus FOUND the company and holds no funding — the live BigRio / Design Milk reading. */
const atomusEmpty = (slug: string): Row => ({ input: slug, status: "success",
  summary: { name: slug, linkedin_url: `https://www.linkedin.com/company/${slug}`, domain: `${slug}.com` }, company: { financial: {} } });
const atomusRounds = (slug: string, dates: string[], complete: boolean): Row => ({ input: slug, status: "success",
  summary: { name: slug, linkedin_url: `https://www.linkedin.com/company/${slug}`, domain: `${slug}.com` },
  company: { financial: { funding: { type: "SEED", num_funding_rounds: complete ? dates.length : dates.length + 3,
    rounds: dates.map((d) => ({ announced_at: d, raised_amount: 1_000_000, type: "SEED_ROUND" })), date: dates[0] } } } });
const pvalyouRow = (domain: string, dates: string[]): Row => ({ query: domain, status: "active", domain, record_as_of: "2026-09-24T10:00:00Z",
  record: { funding: { rounds_count: dates.length, last_round_date: dates[0] ?? null, rounds: dates.map((d, i) => ({
    round_index: i + 1, round_type: "Seed", round_title: "Seed", round_date: d, round_date_precision: "day", round_amount_m_usd: 2,
    is_non_equity: false, source_urls: [`https://news.example.com/${domain}-seed`], investors: [{ name: "Fund" }] })) } } });

const FUNDING_CRITERION = { criterion_id: "funding:recent", dimension: "funding",
  value: { event: "funding", subject: "company", qualifier: {} }, window_days: 365 };
const target = (slug: string, items: EvidenceItem[] = []): VerificationTarget => ({
  company_key: `https://www.linkedin.com/company/${slug}`, name: slug, domain: `${slug}.com`,
  linkedin_url: `https://www.linkedin.com/company/${slug}`, criterion: FUNDING_CRITERION,
  graph: buildCompanyEvidenceGraph(`https://www.linkedin.com/company/${slug}`, items, { now: NOW }),
});

/** The real verifier with a scripted provider, recording every purchase. */
async function verify(targets: VerificationTarget[], script: { atomus: (slugs: string[]) => Row[]; pvalyou?: (domains: string[]) => Row[] }) {
  const calls: VerifierCall[] = [];
  const res = await fundingStageVerifier().verify(targets, {
    call: (c) => {
      calls.push(c);
      const list = (c.input.companies as string[]) ?? [];
      const rows = c.actor_key === ATOMUS
        ? script.atomus(list.map((u) => u.split("/company/")[1]))
        : (script.pvalyou ?? (() => []))(list);
      return Promise.resolve({ status: "ok", rows, provider_call_id: `pc_${c.actor_key}_${calls.length}` } as VerifierCallOutcome);
    },
    ready: () => true, now: () => NOW.toISOString(), log: () => {},
  }, { mission_id: "m", pending: [] });
  return { ...res, calls, pv: calls.filter((c) => c.actor_key === PVALYOU), atomus: calls.filter((c) => c.actor_key === ATOMUS) };
}
const verdictOf = (f: VerifierFinding) => f.detail.verdict_after;

// ═══════════════════════════════════════════════════════════ the fallback rule ══

Deno.test("1. Atomus PASS (dated round inside the window) → zero Pvalyou calls", async () => {
  const r = await verify([target("acme")], { atomus: () => [atomusRounds("acme", ["2026-05-01"], false)] });
  assertEquals([r.atomus.length, r.pv.length], [1, 0]);
  assertEquals(verdictOf(r.findings[0]), "pass");
});

Deno.test("2. Atomus complete history FAIL → zero Pvalyou calls", async () => {
  const r = await verify([target("old")], { atomus: () => [atomusRounds("old", ["2022-01-10"], true)] });
  assertEquals(r.pv.length, 0);
  assertEquals(verdictOf(r.findings[0]), "fail");
});

Deno.test("3. Atomus found-but-empty → exactly ONE Pvalyou fallback, batched", async () => {
  const r = await verify([target("bigrio"), target("design-milk")], {
    atomus: (s) => s.map(atomusEmpty), pvalyou: () => [] });
  assertEquals(r.atomus.length, 1);
  assertEquals(r.pv.length, 1, "one call carries both companies");
  assertEquals(r.pv[0].input, { tier: "basic", companies: ["bigrio.com", "design-milk.com"] });
  assertEquals([r.pv[0].capability, r.pv[0].purpose], ["funding_verification", "funding_evidence"]);
});

Deno.test("4. Pvalyou recent dated round → PASS (and it is canonical: eligibility reads it)", async () => {
  const r = await verify([target("bigrio")], { atomus: (s) => s.map(atomusEmpty), pvalyou: (d) => [pvalyouRow(d[0], ["2026-06-15"])] });
  const f = r.findings[0];
  assertEquals([f.detail.stage, verdictOf(f)], ["atomus_then_pvalyou", "pass"]);
  const graph = buildCompanyEvidenceGraph(f.company_key, [f.item!, ...(f.supporting ?? [])], { now: NOW });
  const check = evaluateEligibility([{ id: "funding:recent", kind: "hard", dimension: "funding", value: FUNDING_CRITERION.value,
    label: "Funding", source: "user_explicit", user_phrase: "", rationale: "", status: "ok",
    time_window: { days: 365, basis: "announced", source: "user_explicit", enforced: false } } as never], graph).checks[0];
  assertEquals(check.result, "pass", check.reason);
});

Deno.test("5. Pvalyou returns nothing → remains PENDING (answered, never FAIL)", async () => {
  const r = await verify([target("bigrio")], { atomus: (s) => s.map(atomusEmpty), pvalyou: () => [] });
  assertEquals([verdictOf(r.findings[0]), r.findings[0].answered], ["pending", true]);
});

Deno.test("6. Pvalyou only old dated rounds, even with a stated count → PENDING: absence is not completeness", async () => {
  const r = await verify([target("bigrio")], { atomus: (s) => s.map(atomusEmpty), pvalyou: (d) => [pvalyouRow(d[0], ["2021-03-01"])] });
  assertEquals(verdictOf(r.findings[0]), "pending");
  assert((r.findings[0].detail.reasons as string[]).includes("history_incomplete"));
});

Deno.test("10. already answered by Pvalyou (a continuation) → no second Pvalyou purchase", async () => {
  const first = await verify([target("bigrio")], { atomus: (s) => s.map(atomusEmpty), pvalyou: () => [] });
  const carried = [first.findings[0].item!, ...(first.findings[0].supporting ?? [])];
  assert(carried.some((i) => i.source.actor === PVALYOU) || first.pv.length === 1);
  // Pvalyou returned no row → the stored record is Atomus's alone; the route is
  // then marked answered and the gap router never re-targets it (below). With a
  // Pvalyou record held, the verifier itself declines to ask again:
  const withPv = await verify([target("bigrio")], { atomus: (s) => s.map(atomusEmpty), pvalyou: (d) => [pvalyouRow(d[0], ["2021-03-01"])] });
  const again = await verify([target("bigrio", [withPv.findings[0].item!, ...(withPv.findings[0].supporting ?? [])])], {
    atomus: (s) => s.map(atomusEmpty), pvalyou: () => { throw new Error("must not be asked again"); } });
  assertEquals(again.pv.length, 0);
});

Deno.test("11. Pvalyou evidence carries provider provenance and citations", async () => {
  const r = await verify([target("bigrio")], { atomus: (s) => s.map(atomusEmpty), pvalyou: (d) => [pvalyouRow(d[0], ["2026-06-15"])] });
  const pv = [r.findings[0].item!, ...(r.findings[0].supporting ?? [])].find((i) => i.source.actor === PVALYOU)!;
  assertEquals(pv.dimension, "funding");
  assertEquals(pv.source.provider_call_id, "pc_apify_funding_pvalyou_2");
  const rounds = (pv.value as { record: { rounds: Array<{ source_urls: string[] }> } }).record.rounds;
  assertEquals(rounds[0].source_urls, ["https://news.example.com/bigrio.com-seed"]);
});

Deno.test("12. the fallback is spec-compiled, reserved at its estimate, executed once, and idempotent", async () => {
  const ceilings = tightenCeilings(resolveCeilings(null, false), parseRunBudget({ provider_usd: 0.14, max_candidates: 2 })!);
  const ledger = newSpendLedger(ceilings);
  const events: string[] = [];
  let sent = 0;
  const call = ledgerBoundCall({
    ledger, actorIdFor: () => "pvalyou/company-record",
    spec: verifierSpecCompiler({ scope: { workspace_id: "w", lineage_id: "l" }, mission_hash: "h",
      policy: criteriaExecutionPolicy({ company_profile: {}, required_signals: [] } as never), ceilings: () => ledger.ceilings, readiness: PRODUCTION_READINESS }),
    invoke: () => { sent++; return Promise.resolve([pvalyouRow("bigrio.com", [])]); },
    hash: () => "h", trace: (t: string) => events.push(t),
  } as never);
  const c = { actor_key: PVALYOU, capability: "funding_verification", purpose: "funding_evidence" as const,
    input: { tier: "basic", companies: ["bigrio.com", "design-milk.com"] }, candidate_keys: ["a", "b"] };
  assertEquals((await call(c)).status, "ok");
  const r = ledger.reservations.find((x) => x.purpose === "funding_evidence")!;
  assertEquals([r.estimate_usd, r.status], [0.0401, "executed"]);
  assertEquals(events, ["spec_compiled", "call_reserved", "call_executed"]);
  assertEquals((await call(c)).status, "failed", "the same purchase is never bought twice");
  assertEquals(sent, 1);
});

// ════════════════════ 7–9, 13–14: through the phase, on the canary's own evidence ══

const FX = JSON.parse(Deno.readTextFileSync(new URL("../../fixtures/lead-v2/canary-5bfa76db/result.json", import.meta.url)));
const CRITERIA = deriveMissionCriteria(FX.lead_mission, PRODUCTION_READINESS);
const HARD_PLAN = buildClaimPlan(CRITERIA, "general_company_discovery", PRODUCTION_READINESS);
const BIGRIO = "https://www.linkedin.com/company/bigrio", DESIGNMILK = "https://www.linkedin.com/company/design-milk";

/** BigRio and Design Milk exactly as company details left them, BEFORE any funding purchase. */
function canaryWorld() {
  const items = new Map<string, EvidenceItem[]>(), tried = new Map<string, string[]>();
  for (const c of FX.lead_resume_checkpoint.companies as Array<{ company_key: string; snapshot: { observations: Array<{ actor_key: string; evidence: EvidenceItem[] }> } }>) {
    items.set(c.company_key, c.snapshot.observations.filter((o) => o.actor_key !== ATOMUS)
      .flatMap((o) => o.evidence).map((e) => ({ ...e, company_key: c.company_key })));
    tried.set(c.company_key, []);
  }
  return { items, tried };
}
const item = (k: string, dimension: string, value: unknown): EvidenceItem => ({
  evidence_id: `t_${k}_${dimension}`, company_key: k, dimension: dimension as never, value, status: "proven",
  source: { provider: "t", actor: "grounded_evidence_evaluation", provider_call_id: "pc", url: null, excerpt: null },
  method: "provider_field", observed_at: NOW.toISOString(), valid_until: null, confidence: "high", derived_from: [], mission_id: "m", origin: "web",
} as EvidenceItem);

async function phase(o: { pvalyou: (domains: string[]) => Row[]; criteria?: typeof CRITERIA; qualifiedAlready?: number; mutate?: (w: ReturnType<typeof canaryWorld>) => void }) {
  const crit = o.criteria ?? CRITERIA;
  const w = canaryWorld(); o.mutate?.(w);
  const bought: Record<string, string[][]> = { atomus: [], pvalyou: [], jobs: [], firecrawl: [] };
  const candidates = () => [...w.items.entries()].map(([k, its]) => {
    const graph = buildCompanyEvidenceGraph(k, its, { now: NOW });
    const e = evaluateEligibility(crit, graph);
    return { company_key: k, name: k, domain: `${k.split("/company/")[1]}.com`, linkedin_url: k, graph, eligibility: e.eligibility,
      hard_checks: e.checks.filter((c) => c.kind === "hard"), attempted_routes: w.tried.get(k)! };
  });
  const firecrawl: ClaimVerifier = { key: "business_model_first_party_pages", claim: "business_model", route_actor: "firecrawl", max_targets: 5,
    estimate_per_target_usd: () => 0.02,
    verify: (ts) => { bought.firecrawl.push(ts.map((t) => t.company_key));
      return Promise.resolve({ pending: [], findings: ts.map((t) => ({ company_key: t.company_key, item: item(t.company_key, "business_model", "b2b saas"), answered: true, detail: {} })) }); } };
  const hiring = hiringClaimVerifier({ titles: ["growth"], role_families: ["growth"], window_days: 30, matchesRole: (t) => roleMatchesFamily(t, "growth") });
  const report = await runClaimVerificationPhase({
    mission_id: "m", requested_count: 1, claim_plan: buildClaimPlan(crit, "general_company_discovery", PRODUCTION_READINESS),
    candidates, qualified: () => (o.qualifiedAlready ?? 0) + candidates().filter((c) => c.eligibility === "eligible").length,
    criteriaValue: (id) => crit.find((c) => c.id === id)?.value ?? null,
    criteriaWindow: (id) => crit.find((c) => c.id === id)?.time_window?.days ?? null,
    verifiers: [fundingStageVerifier(), hiring, firecrawl], readiness: PRODUCTION_READINESS, pending: [],
    apply: (f, v) => { w.tried.get(f.company_key)!.push(v.route_actor);
      if (f.item) w.items.get(f.company_key)!.push(f.item, ...(f.supporting ?? [])); return !!f.item; },
    deps: { now: () => NOW.toISOString(), log: () => {}, call: (c) => {
      const list = (c.input.companies as string[] | undefined) ?? (c.input.company as string[]);
      const which = c.actor_key === ATOMUS ? "atomus" : c.actor_key === PVALYOU ? "pvalyou" : "jobs";
      bought[which].push(list);
      const rows = which === "atomus" ? list.map((u) => atomusEmpty(u.split("/company/")[1]))
        : which === "pvalyou" ? o.pvalyou(list)
        : list.map((u) => ({ id: "j", title: "Head of Growth", postedDate: NOW.toISOString(), linkedinUrl: "https://www.linkedin.com/jobs/view/1",
          company: { name: "x", linkedinUrl: u } }));
      return Promise.resolve({ status: "ok", rows, provider_call_id: `pc_${which}` } as VerifierCallOutcome); } },
  });
  const final = Object.fromEntries(candidates().map((c) => [c.company_key, c.eligibility]));
  return { report, bought, final, candidates };
}

Deno.test("REPLAY BigRio-style: Atomus empty → Pvalyou PASS → funding unlocked → hiring and Firecrawl follow → qualified", async () => {
  const r = await phase({ pvalyou: (d) => d.filter((x) => x.startsWith("bigrio")).map((x) => pvalyouRow(x, ["2026-06-15"])) });
  assertEquals(r.bought.atomus.length, 1);
  assertEquals(r.bought.pvalyou, [["bigrio.com", "design-milk.com"]], "one batched fallback for both");
  assert(r.bought.jobs.flat().includes(BIGRIO), "13. funding PASS unlocks the hiring gap");
  assert(r.bought.firecrawl.flat().includes(BIGRIO), "…and the business-model gap");
  assertEquals(r.final[BIGRIO], "eligible");
});

Deno.test("REPLAY Design-Milk-style: Atomus empty → Pvalyou empty → PENDING, and NOTHING unrelated is bought", async () => {
  const r = await phase({ pvalyou: (d) => d.filter((x) => x.startsWith("bigrio")).map((x) => pvalyouRow(x, ["2026-06-15"])) });
  assertEquals(r.final[DESIGNMILK], "pending");
  assertFalse(r.bought.jobs.flat().includes(DESIGNMILK), "14. no job search for a candidate whose funding is still stuck");
  assertFalse(r.bought.firecrawl.flat().includes(DESIGNMILK), "14. no Firecrawl either");
});

Deno.test("both still PENDING after the fallback → no hiring, no Firecrawl, no second fallback (continuation-safe)", async () => {
  const r = await phase({ pvalyou: () => [] });
  assertEquals([r.bought.jobs.length, r.bought.firecrawl.length], [0, 0]);
  assertEquals(r.bought.pvalyou.length, 1);
  // A second slice over the same state buys nothing: Atomus's route is answered for both.
  const stateAfter = r.candidates();
  for (const c of stateAfter) assertEquals(verificationTargets({ route_actor: ATOMUS, max_targets: 6 }, [c] as never,
    (id) => CRITERIA.find((x) => x.id === id)?.value, CLAIM_REGISTRY, PRODUCTION_READINESS), [], c.company_key);
});

Deno.test("7. a SOFT recently-funded target buys no Atomus and no Pvalyou", async () => {
  const soft = CRITERIA.map((c) => c.dimension === "funding" ? { ...c, kind: "target" as const } : c);
  const r = await phase({ criteria: soft, pvalyou: () => { throw new Error("must not run"); } });
  assertEquals([r.bought.atomus.length, r.bought.pvalyou.length], [0, 0]);
});

Deno.test("8. an already-ineligible candidate gets no Atomus and no Pvalyou", async () => {
  const r = await phase({ pvalyou: (d) => d.map((x) => pvalyouRow(x, [])), mutate: (w) => {
    // Design Milk's company record says Germany: country FAIL before any funding purchase.
    const its = w.items.get(DESIGNMILK)!.map((e) => e.dimension === "geography" ? { ...e, value: "Berlin, Germany" } : e);
    w.items.set(DESIGNMILK, its);
  } });
  assertFalse(r.bought.atomus.flat().some((u) => u.includes("design-milk")));
  assertFalse(r.bought.pvalyou.flat().includes("design-milk.com"));
});

Deno.test("9. quota_met → no new Atomus or Pvalyou purchase", async () => {
  const r = await phase({ qualifiedAlready: 1, pvalyou: () => { throw new Error("must not run"); } });
  assertEquals([r.bought.atomus.length, r.bought.pvalyou.length], [0, 0]);
  assertEquals(r.report.stopped, "quota_met");
});

Deno.test("the recorded canary really was stuck: after Atomus, both candidates' funding gaps are blocked", () => {
  // Rebuilt from the canary's OWN observations INCLUDING its Atomus rows.
  for (const c of FX.lead_resume_checkpoint.companies as Array<{ company_key: string; completed_operations: string[]; snapshot: { observations: Array<{ evidence: EvidenceItem[] }> } }>) {
    const graph = buildCompanyEvidenceGraph(c.company_key, c.snapshot.observations.flatMap((o) => o.evidence).map((e) => ({ ...e, company_key: c.company_key })), { now: NOW });
    const hard = evaluateEligibility(CRITERIA, graph).checks.filter((x) => x.kind === "hard");
    const funding = evidenceGapsFor(hard, graph, CLAIM_REGISTRY, new Set(attemptedRoutes(c.completed_operations)), PRODUCTION_READINESS)
      .find((g) => g.dimension === "funding")!;
    assertEquals(funding.next, "blocked", c.company_key);
  }
  assertEquals(FX.recorded.evidence_gaps, { pending: 2, with_executable_route: 0, blocked: 2 });
  void HARD_PLAN;
});

Deno.test("no window passed: a COMPLETE Atomus history is decisive → zero Pvalyou; an empty one still falls back", async () => {
  const noWindow = (slug: string): VerificationTarget => ({ ...target(slug), criterion: { ...FUNDING_CRITERION, window_days: null } });
  const complete = await verify([noWindow("old")], { atomus: () => [atomusRounds("old", ["2022-01-10"], true)] });
  assertEquals(complete.pv.length, 0);
  const empty = await verify([noWindow("bigrio")], { atomus: (s) => s.map(atomusEmpty), pvalyou: () => [] });
  assertEquals(empty.pv.length, 1);
});
