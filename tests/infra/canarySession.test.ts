// FAST CANARY MODE: one approval, one bounded session, one exact contract.
//
// Pinned here, offline:
//   - the contract (docs/launch/proposals/canary-session-contract.json) is
//     well-formed, unexpired and never wider than the existing caps; every way
//     to widen it — another project or workspace, an unreviewed actor, a second
//     start, more output units, a higher maximum, more companies, a model or
//     spend beyond the caps, other SQL, a migration — is refused (A01–A09);
//   - a generated plan executes only if it satisfies the contract exactly
//     (S01–S17): a malformed or wider plan cannot execute;
//   - single use: the queue and plan ids derive from the contract's sha256;
//   - the workflow: the session's guard, secret scoping, the commit-scoped
//     dependency cache, the worker only after an executed kickoff, session
//     runs counted in the $3 budget like prepare runs.
// The stages run end to end against a local database in
// scripts/test-project/canary/local-rehearsal.sh (sessions: expired, wider,
// unapproved actor, plan outside the contract, unreadable history, manual,
// executed, duplicate, interrupted, partially completed with an uncertain
// purchase, blocked follow-up, administrator reconciliation, clean close).
import { assert, assertEquals, assertNotEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parse } from "https://deno.land/std@0.224.0/yaml/mod.ts";
import { contractChecks, kickoffWithinContract, sessionIds } from "../../scripts/test-project/canary/session-contract.ts";
import { prepareKickoff } from "../../scripts/test-project/real-gpt/prepareKickoff.ts";

const CONTRACT = JSON.parse(Deno.readTextFileSync(new URL("../../docs/launch/proposals/canary-session-contract.json", import.meta.url)));
const CATALOG = JSON.parse(Deno.readTextFileSync(new URL("../../docs/launch/proposals/smoke-catalog-canary-funding.json", import.meta.url)));
const PROPOSAL = JSON.parse(Deno.readTextFileSync(new URL("../../docs/launch/proposals/canary-funding-reviewed-mission-proposal.json", import.meta.url)));
const RAW = Deno.readTextFileSync(new URL("../../.github/workflows/discovery-test-worker.yml", import.meta.url));
const STAGE = Deno.readTextFileSync(new URL("../../scripts/test-project/canary/canary-stage.sh", import.meta.url));
const NOW = new Date("2026-10-30T12:00:00Z");
const SHA = "0123456789abcdef0123456789abcdef01234567";
const CSHA = "a".repeat(64);
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const failedA = (c: J, now = NOW) => contractChecks(c, now).filter((x) => !x.ok).map((x) => x.id);
const variant = (f: (c: J) => void) => { const c = structuredClone(CONTRACT); f(c); return c; };

Deno.test("contract: the proposed first-session contract passes A01–A09 and states automatic execution", () => {
  assertEquals(failedA(CONTRACT), []);
  assertEquals(CONTRACT.auto_execute, true);
  assertEquals(CONTRACT.mission.instruction, "Find one US company hiring Account Executives that raised funding within the last six months.");
  assertEquals(CONTRACT.spending.max_session_microusd, 93_480, "compile $0.02496 + provider $0.0186 + worker model $0.04992");
});

Deno.test("contract: every way to widen it is refused", () => {
  const cases: Array<[string, (c: J) => void, string]> = [
    ["expired", (c) => { c.expires_at = "2026-10-30T11:59:59Z"; }, "A03"],
    ["no expiry", (c) => { delete c.expires_at; }, "A03"],
    ["production project", (c) => { c.project_ref = "ohsdatpvfdjdemstoiuj"; }, "A02"],
    ["another workspace", (c) => { c.workspace_id = "9d09038b-2d39-49ca-b687-e3946ea7266d"; }, "A02"],
    ["two companies", (c) => { c.mission.requested_count = 2; }, "A04"],
    ["more qualified companies", (c) => { c.mission.max_qualified_companies = 2; }, "A04"],
    ["another mission kind", (c) => { c.mission.scenario = "demo_funding"; }, "A04"],
    ["an unreviewed actor", (c) => { c.actors["apify:pvalyou~company-record"] = { max_starts: 1, max_units: 1, max_microusd: 40050 }; }, "A05"],
    ["a second start", (c) => { c.actors["apify:atomus~linkedin-company-scraper"].max_starts = 2; }, "A05"],
    ["more output units", (c) => { c.actors["apify:harvestapi~linkedin-job-search"].max_units = 4; }, "A05"],
    ["a higher maximum", (c) => { c.actors["apify:harvestapi~linkedin-company"].max_microusd = 4051; }, "A05"],
    ["another model", (c) => { c.model.actor = "openai:gpt-5.6-terra"; }, "A06"],
    ["more worker attempts", (c) => { c.model.worker_attempts = 5; }, "A06"],
    ["a dearer model call", (c) => { c.model.max_microusd_per_call = 20_000; }, "A06"],
    ["spend that does not add up", (c) => { c.spending.max_session_microusd = 200_000; }, "A07"],
    ["a raised provider cap", (c) => { c.spending.provider_cap_microusd = 300_000; }, "A07"],
    ["a raised canary budget", (c) => { c.spending.canary_budget_microusd = 5_000_000; }, "A07"],
    ["other SQL", (c) => { c.database.kickoff_statements.push("update workspace_credit_balances"); }, "A08"],
    ["a migration", (c) => { c.database.migrations = "20261101000000_anything"; }, "A08"],
    ["automatic execution unstated", (c) => { delete c.auto_execute; }, "A09"],
    ["not a contract", (c) => { c.version = 2; }, "A01"],
  ];
  for (const [label, f, id] of cases) assert(failedA(variant(f)).includes(id), `${label} → ${failedA(variant(f))}`);
});

Deno.test("single use: the ids derive from the contract's sha256 — same contract, same queue; another, another", async () => {
  const a = await sessionIds(CSHA), b = await sessionIds(CSHA), c = await sessionIds("b".repeat(64));
  assertEquals(a, b);
  assertNotEquals(a.queue_id, c.queue_id);
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a.queue_id), a.queue_id);
  assertNotEquals(a.queue_id, a.plan_id);
});

async function kickoff(over: J = {}) {
  const ids = await sessionIds(CSHA);
  return { ids, k: await prepareKickoff({
    scenario: "canary_funding", project_ref: "tlvnfrxzjhsjgdofwehb", workspace_id: CONTRACT.workspace_id,
    user_id: "22222222-2222-4222-8222-222222222222", queue_id: ids.queue_id, plan_id: ids.plan_id,
    pricing_version: "test", catalog: CATALOG.approved_quotes, planner_commit: SHA,
    prices: { jobs_maximum_microusd: 4000, details_maximum_microusd: 4050, atomus_maximum_microusd: 10550, observed_at: "2026-10-30T00:00:00Z", source: "test" },
    compile: () => Promise.resolve(structuredClone(PROPOSAL)),
    paid: { approved_by: "test", actor_limits: Object.fromEntries(Object.entries(CATALOG.actor_limits_proposed_for_paid_canary).filter(([k]) => k !== "note")) as Record<string, number> },
    ...over,
  } as never) as unknown as J & { sql: string } };
}
const failedS = (k: J, sql: string, ids: { queue_id: string; plan_id: string }, c: J = CONTRACT) =>
  kickoffWithinContract(k, sql, c, ids).filter((x) => !x.ok).map((x) => x.id);

Deno.test("plan: the reviewed plan under the contract's ids satisfies S01–S17", async () => {
  const { ids, k } = await kickoff();
  assertEquals(failedS(k, k.sql, ids), []);
});

Deno.test("plan: a malformed or wider generated plan cannot execute", async () => {
  const { ids, k } = await kickoff();
  const m = (f: (x: J) => void) => { const x = structuredClone(k); f(x); return x; };
  const cases: Array<[string, J, string, string]> = [
    ["another mission", m((x) => { x.request.instruction = "Find 50 companies"; }), k.sql, "S01"],
    ["five companies", m((x) => { x.request.requested_lead_count = 5; }), k.sql, "S02"],
    ["merged windows", m((x) => { x.compiled_mission.required_signals = [{ event: "hiring", timeframe_days: 180 }, { event: "funding", timeframe_days: 180 }]; }), k.sql, "S03"],
    ["a failed interpretation", m((x) => { x.interpretation[0].result = "FAIL"; }), k.sql, "S04"],
    ["an undisclosed assumption", m((x) => { x.disclosures = []; }), k.sql, "S05"],
    ["an added actor", m((x) => { x.authorization.actor_limits["apify:pvalyou~company-record"] = 1; }), k.sql, "S06"],
    ["a second start", m((x) => { x.authorization.actor_limits["apify:atomus~linkedin-company-scraper"] = 2; }), k.sql, "S07"],
    ["a dearer start", m((x) => { x.authorization.quotes.atomus.maximum_microusd = 20_000; }), k.sql, "S08"],
    ["more output units", m((x) => { x.authorization.quotes.jobs.request_limits.max_fields.maxItems = 10; }), k.sql, "S09"],
    ["a dearer model", m((x) => { x.authorization.quotes.model.maximum_microusd = 50_000; }), k.sql, "S11"],
    ["a Pvalyou template", m((x) => { x.authorization.quotes.pvalyou = { allowed_actors: ["apify:pvalyou~company-record"] }; }), k.sql, "S12"],
    ["a third compile call", m((x) => { x.compile_ledger_rows = [{}, {}, {}]; }), k.sql, "S13"],
    ["an expensive compile", m((x) => { x.compile_ledger_rows = [{ estimated_cost_usd: 0.05 }]; }), k.sql, "S13"],
    ["extra SQL", k, k.sql.replace("commit;\n", "update public.workspace_credit_balances set balance_credits = 99;\ncommit;\n"), "S14"],
    ["random ids (not single-use)", k, k.sql.replaceAll(ids.queue_id, "33333333-3333-4333-8333-333333333333"), "S15"],
    ["another workspace", m((x) => { x.request.workspace_id = "9d09038b-2d39-49ca-b687-e3946ea7266d"; }), k.sql, "S16"],
    ["a raised run budget", m((x) => { x.request.run_budget.provider_usd = 0.5; }), k.sql, "S17"],
    ["no plan at all", {}, "", "S01"],
  ];
  for (const [label, x, sql, id] of cases) assert(failedS(x, sql, ids).includes(id), `${label} → ${failedS(x, sql, ids)}`);
  // A narrower contract than the plan: the plan stops.
  const narrow = variant((c) => { delete c.actors["apify:atomus~linkedin-company-scraper"]; });
  assert(failedS(k, k.sql, ids, narrow).includes("S06"));
});

interface Step { name?: string; id?: string; run?: string; uses?: string; if?: string; with?: Record<string, string>; env?: Record<string, string> }
const wf = parse(RAW) as { on: { workflow_dispatch: { inputs: Record<string, J> } }; jobs: Record<string, { steps: Step[] }> };
const steps = wf.jobs.worker.steps;
const secretKeys = (env: Record<string, string> = {}) => Object.entries(env).filter(([, v]) => String(v).includes("secrets.")).map(([k]) => k).sort();

Deno.test("workflow: session is one stage of the guarded worker job; the worker runs only after an executed kickoff", () => {
  assert((wf.on.workflow_dispatch.inputs.canary_stage.options as string[]).includes("session"));
  const names = steps.map((s) => s.name ?? s.uses ?? "");
  const sess = steps.findIndex((s) => s.id === "session"), worker = names.indexOf("One bounded worker session (drains on SIGTERM, then exits)");
  assertEquals(worker, sess + 1, "the kickoff executes immediately before the worker, inside the 300 s window");
  assertEquals(steps[worker].if, "${{ inputs.canary_stage != 'session' || steps.session.outputs.kickoff == 'executed' }}");
  const close = steps.find((s) => (s.name ?? "").startsWith("Canary session: stop"))!;
  assertStringIncludes(close.if!, "steps.session.outputs.kickoff == 'executed'");
  assertStringIncludes(close.if!, "always()", "a session that started a purchase always closes and reconciles");
  for (const s of steps.filter((s) => (s.name ?? "").startsWith("Canary session:"))) assertStringIncludes(s.if!, "inputs.canary_stage == 'session'");
  assertEquals(secretKeys(steps[sess].env), ["APIFY_API_TOKEN", "OPENAI_API_KEY", "TEST_DB_URL"]);
  assertEquals(secretKeys(close.env), ["APIFY_API_TOKEN", "TEST_DB_URL"]);
  assert(Number((steps[sess] as J)["timeout-minutes"]) <= 10 && Number((close as J)["timeout-minutes"]) <= 10, "bounded steps");
});

Deno.test("workflow: the dependency cache is pinned and scoped to the exact commit", () => {
  for (const job of Object.values(wf.jobs)) {
    const cache = job.steps.find((s) => s.uses?.startsWith("actions/cache@"))!;
    assert(/^actions\/cache@[0-9a-f]{40}$/.test(cache.uses!), cache.uses);
    assertEquals(cache.with!.key, "deno-v2.8.2-${{ runner.os }}-${{ github.sha }}", "only a run of the same commit restores it");
    assertEquals(secretKeys(cache.env), []);
  }
});

async function guard(env: Record<string, string>) {
  const out = await new Deno.Command("bash", { args: ["-c", steps[0].run!], clearEnv: true, stdout: "piped", stderr: "piped",
    env: { PATH: Deno.env.get("PATH") ?? "", GITHUB_SHA: SHA, EXPECTED_SHA: SHA, ...env } }).output();
  return { code: out.code, err: new TextDecoder().decode(out.stderr) };
}
const SESSION_ENV = { CONFIRM_REF: "tlvnfrxzjhsjgdofwehb", TEST_PROJECT_REF: "tlvnfrxzjhsjgdofwehb", SUPABASE_URL: "https://tlvnfrxzjhsjgdofwehb.supabase.co",
  LEAD_V2_WORKER_WORKSPACES: "40e2512f-09b6-433e-97fe-f9999a1f1897", SESSION_MINUTES: "6", PROVIDERS: "openai-and-apify",
  CANARY_STAGE: "session", CANARY_APPROVAL: `run canary session ${CSHA} at ${SHA}` };

Deno.test("workflow guard, executed: a session needs the canary project and workspace, a paid dispatch and its approval phrase", async () => {
  assertEquals((await guard(SESSION_ENV)).code, 0);
  const refused: Array<[Record<string, string>, string]> = [
    [{ CANARY_APPROVAL: "" }, "approval phrase"],
    [{ CANARY_APPROVAL: `run canary session ${CSHA}` }, "approval phrase"],
    [{ CANARY_APPROVAL: "run canary session everything at main" }, "approval phrase"],
    [{ PROVIDERS: "openai-only" }, "providers must be openai-and-apify"],
    [{ LEAD_V2_WORKER_WORKSPACES: "9d09038b-2d39-49ca-b687-e3946ea7266d" }, "discovery-test workspace only"],
    [{ CONFIRM_REF: "ohsdatpvfdjdemstoiuj", TEST_PROJECT_REF: "ohsdatpvfdjdemstoiuj", SUPABASE_URL: "https://ohsdatpvfdjdemstoiuj.supabase.co" }, "not a non-production project"],
    [{ EXPECTED_SHA: "f".repeat(40) }, "not the approved expected_sha"],
    [{ SESSION_MINUTES: "11" }, "at most 10 minutes"],
  ];
  for (const [over, why] of refused) {
    const r = await guard({ ...SESSION_ENV, ...over });
    assertEquals(r.code, 1, JSON.stringify(over));
    assertStringIncludes(r.err, why);
  }
});

Deno.test("stage: the session's approval binds the contract hash and the commit; sessions count in the $3 like prepares", () => {
  assertStringIncludes(STAGE, 'require_approval "run canary session $csha at $EXPECTED_SHA"');
  assertStringIncludes(STAGE, 'contains(" — prepare @ ")) or (.display_title | contains(" — session @ "))');
  assertStringIncludes(STAGE, "has already been used");
  // Read-only until the one write boundary, and the conflict check repeated right before it.
  const body = STAGE.slice(STAGE.indexOf("  session)\n"), STAGE.indexOf("  session-close)\n"));
  assert(body.indexOf("check_conflicts\n      DB_WRITES=1") > 0, "conflicts re-checked immediately before the kickoff write");
  assert(body.indexOf("DB_WRITES=1") > body.indexOf("the generated plan satisfies the contract exactly"), "no write before the contract check");
  assertStringIncludes(STAGE, '[ "${CANARY_LOCAL_REHEARSAL:-}" = "1" ] && [ -n "${CANARY_SESSION_CONTRACT:-}" ]');
  assert(!RAW.includes("CANARY_SESSION_CONTRACT"), "the workflow never overrides the contract");
});

Deno.test("stage, executed: local-rehearsal overrides are refused under GitHub Actions before anything runs", async () => {
  for (const v of ["CANARY_LOCAL_REHEARSAL", "CANARY_SESSION_CONTRACT", "CANARY_OFFLINE_PROPOSAL", "CANARY_PRIOR_PREPARES", "CANARY_APIFY_NET", "APIFY_API_BASE"]) {
    const out = await new Deno.Command("bash", {
      args: [new URL("../../scripts/test-project/canary/canary-stage.sh", import.meta.url).pathname, "session"], clearEnv: true,
      // No audit directory: the refusal comes before anything is created or read.
      env: { PATH: Deno.env.get("PATH") ?? "", GITHUB_ACTIONS: "true", [v]: "x", EXPECTED_SHA: SHA },
      stdout: "piped", stderr: "piped",
    }).output();
    assertEquals(out.code, 1, v);
    assertStringIncludes(new TextDecoder().decode(out.stderr), `${v} is a local-rehearsal override and is refused in GitHub Actions`);
  }
});

Deno.test("session-close: receipts reconcile only within cap and for the same actor; open liability uses the gate's own rule", () => {
  const close = STAGE.slice(STAGE.indexOf("  session-close)\n"), STAGE.indexOf('  *) stop "unknown stage'));
  assertStringIncludes(close, '[ "apify:$r_actor" = "$actor" ] && [ "$within" = "true" ]');
  assertStringIncludes(close, '[ "$micro" -le "$committed" ]');
  assertStringIncludes(close, '[[ "$run" =~ ^[A-Za-z0-9_-]{1,64}$ ]]');
  assertStringIncludes(close, "|| fail \"apify receipts:");
  assertStringIncludes(close, "r.vendor_microusd <= o.committed_microusd");
  assertStringIncludes(STAGE, "and x.vendor_microusd <= o.committed_microusd", "check_conflicts uses the same rule");
  assert(!/-v [a-z]+="\$[a-z]+"[^\n]*-c "/.test(close), "no -v variables with -c (psql does not substitute them there)");
  assert(!/q -c "[^"]*'\$run'/.test(close), "no Apify value interpolated into SQL text");
  assertStringIncludes(close, "|| stop \"the workspace is not in this database; nothing closed\"");
});
