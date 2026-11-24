// CONTRACT 3, REHEARSED OFFLINE THROUGH THE REAL ENGINE.
//
// The Contract 3 mission, compiled from canary session 2's REAL gpt-5.6-luna
// proposal, run by `runCapabilityPlan` + the claim verification phase with
// fixture providers (the Q4 acceptance harness), with Pvalyou UNAVAILABLE as
// the contract approves no Pvalyou template. Every purchase the engine makes is
// pushed through the smoke gate's own `classifyRequest` + `boundRequest` with
// Contract 3's catalog, so a request the live gate would refuse fails here.
//
// What it proves, and what it cannot: the decisions and the purchase shapes
// are production code. The provider ROWS are fixtures — whether Atomus answers
// for a real company, and with what, is only learned live.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type AcceptanceCase, runAcceptanceCase } from "./q4/acceptanceHarness.ts";
import { boundRequest, classifyRequest, templateFor } from "../../../supabase/functions/_shared/smokeAdmission.ts";
import { hiringActorCard } from "../../../supabase/functions/_shared/hiringActorCatalog.ts";

const read = (p: string) => JSON.parse(Deno.readTextFileSync(new URL(`../../../${p}`, import.meta.url)));
const CONTRACT3 = read("docs/launch/proposals/canary-session-contract-3.json");
const CATALOG3 = read("docs/launch/proposals/smoke-catalog-canary-funding-3.json");
const REAL = read("docs/launch/proposals/canary-session-2-real-gpt-proposal.json");
const MISSION = CONTRACT3.mission.instruction as string;
const APPROVED = new Set(Object.keys(CONTRACT3.actors));

const rehearse = (over: Partial<AcceptanceCase>) => runAcceptanceCase({
  id: over.id ?? "c3", request: MISSION, signal: REAL.preferred_signals, proposal: REAL,
  unavailable: ["apify_funding_pvalyou"], ...over,
});

/** Every purchase, as the live gate would see it under Contract 3's catalog. */
function gateVerdicts(calls: Array<{ actor: string; input: Record<string, unknown> }>) {
  return calls.map((call) => {
    const actorId = hiringActorCard(call.actor)?.actor_id ?? null;
    if (!actorId) return { actor: call.actor, ok: false, reason: "no_actor_card" };
    const req = {
      method: "POST", url: new URL(`https://api.apify.com/v2/acts/${actorId.replace("/", "~")}/runs`),
      body: JSON.stringify(call.input),
    };
    const c = classifyRequest(req, null);
    if (c.kind !== "provider") return { actor: call.actor, ok: false, reason: `classified ${c.kind}` };
    if (!APPROVED.has(c.actor)) return { actor: c.actor, ok: false, reason: "not in Contract 3" };
    const t = templateFor({ approved_quotes: CATALOG3.approved_quotes } as never, "provider", c.actor);
    if (!t.ok) return { actor: c.actor, ok: false, reason: t.reason };
    const b = boundRequest(req, c as never, t.template.request_limits as never, t.template.maximum_microusd as number);
    return { actor: c.actor, ok: b.ok, reason: b.ok ? "admitted" : b.reason, maximum: t.template.maximum_microusd as number };
  });
}
const count = (calls: Array<{ actor: string }>, actor: string) => calls.filter((c) => c.actor === actor).length;

Deno.test("C3-1 the expected path: US HQ on the company record, AE posting, a round 40 days ago → 1 qualified, within every limit", async () => {
  const f = await rehearse({ id: "c3-qualify", rounds: [{ type: "Series A", daysAgo: 40 }] });
  assertEquals(f.qualifiedKeys.length, 1, "Atomus alone settles a dated, in-window round — no Pvalyou needed");
  assertEquals([count(f.providerCalls, "apify_linkedin_job_search"), count(f.providerCalls, "apify_linkedin_company_details"),
    count(f.providerCalls, "apify_funding_atomus"), count(f.providerCalls, "apify_funding_pvalyou")], [1, 1, 1, 0]);
  const gate = gateVerdicts(f.providerCalls);
  assert(gate.every((g) => g.ok), JSON.stringify(gate));
  const worst = gate.reduce((s, g) => s + (g.maximum ?? 0), 0);
  assert(worst <= CONTRACT3.spending.max_provider_microusd, `worst case ${worst} µ$ within ${CONTRACT3.spending.max_provider_microusd}`);
});

Deno.test("C3-2 a US job at a Canadian-HQ company: ineligible, and Atomus is NOT bought", async () => {
  const f = await rehearse({ id: "c3-hq-ca", details: "hq_conflict", rounds: [{ type: "Series A", daysAgo: 40 }] });
  assertEquals(f.qualifiedKeys.length, 0);
  assertEquals(f.eligibility[0].eligibility, "ineligible", "a proven non-US headquarters fails the hard requirement");
  assertEquals(count(f.providerCalls, "apify_funding_atomus"), 0, "no funding bought for a company that already failed");
});

Deno.test("C3-3 company details answer nothing: pending (never failed), Atomus waits", async () => {
  const f = await rehearse({ id: "c3-empty", details: "empty", rounds: [{ type: "Series A", daysAgo: 40 }] });
  assertEquals(f.qualifiedKeys.length, 0);
  assertEquals(f.eligibility[0].eligibility, "pending", "missing HQ evidence is not a failed qualification");
  assertEquals(count(f.providerCalls, "apify_funding_atomus"), 0, "the cheap HQ claim is settled first");
});

Deno.test("C3-4 the last round is 300 days old: ineligible on funding, after exactly one Atomus start", async () => {
  const f = await rehearse({ id: "c3-old", rounds: [{ type: "Series A", daysAgo: 300 }] });
  assertEquals(f.qualifiedKeys.length, 0);
  assertEquals(f.eligibility[0].eligibility, "ineligible");
  assertEquals(count(f.providerCalls, "apify_funding_atomus"), 1);
  assert(gateVerdicts(f.providerCalls).every((g) => g.ok));
});

Deno.test("C3-5 Atomus has no record: pending — absence of funding evidence is not a funding failure", async () => {
  const f = await rehearse({ id: "c3-none" });
  assertEquals(f.qualifiedKeys.length, 0);
  assertEquals(f.eligibility[0].eligibility, "pending");
  assertEquals(count(f.providerCalls, "apify_funding_atomus"), 1, "bought once, never retried");
});

Deno.test("C3-6 the evaluator call fails: nothing qualifies, no evaluation is recorded, nothing extra is bought", async () => {
  const f = await rehearse({ id: "c3-eval-fail", evaluator: "http_error", rounds: [{ type: "Series A", daysAgo: 40 }] });
  assertEquals(f.qualifiedKeys.length, 0, "the evaluator must answer before anything qualifies");
  assert(!Object.values(f.evaluation_paths).includes("model_evaluated"));
  assert(gateVerdicts(f.providerCalls).every((g) => g.ok));
});

Deno.test("C3-7 a slice that runs out of time after discovery resumes and buys each actor once", async () => {
  const f = await rehearse({ id: "c3-interrupt", interrupt: true, rounds: [{ type: "Series A", daysAgo: 40 }] });
  assert(f.execution.slices >= 2);
  for (const a of ["apify_linkedin_job_search", "apify_linkedin_company_details", "apify_funding_atomus"]) {
    assert(count(f.providerCalls, a) <= 1, `${a}: at most one start (Contract 3 max_starts 1)`);
  }
  assertEquals(f.qualifiedKeys.length, 1);
});
