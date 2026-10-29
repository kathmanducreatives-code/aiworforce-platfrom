// THE FIRST REAL-APIFY CANARY'S AUTOMATION, PINNED.
//
// The canary runs through the existing guarded test-worker workflow (input
// `canary_stage`), never a parallel path. Pinned here, offline:
//   - `none` is the worker exactly as before; the canary stages run in the
//     same Environment, behind a refusal step that names the isolated project,
//     the canary workspace and the approved commit;
//   - each secret reaches only the step that reads it; the model key only the
//     paid compile; actions are pinned to full SHAs;
//   - the stage script's own constants (target, reviewed checksums, approval
//     phrases) match the reviewed files;
//   - the kickoff validator refuses every drift the approval rests on.
// The stages themselves run end to end against a local database and a
// stand-in Apify API in scripts/test-project/canary/local-rehearsal.sh.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parse } from "https://deno.land/std@0.224.0/yaml/mod.ts";
import { prepareKickoff } from "../../scripts/test-project/real-gpt/prepareKickoff.ts";
import { validateKickoff } from "../../scripts/test-project/canary/validate-kickoff.ts";
import { canaryBudget, CANARY_BUDGET_MICROUSD } from "../../scripts/test-project/canary/canary-budget.ts";

const ROOT = new URL("../../", import.meta.url);
const RAW = Deno.readTextFileSync(new URL(".github/workflows/discovery-test-worker.yml", ROOT));
const STAGE = Deno.readTextFileSync(new URL("scripts/test-project/canary/canary-stage.sh", ROOT));
const CATALOG = JSON.parse(Deno.readTextFileSync(new URL("docs/launch/proposals/smoke-catalog-canary-funding.json", ROOT)));
const PROPOSAL = JSON.parse(Deno.readTextFileSync(new URL("docs/launch/proposals/canary-funding-reviewed-mission-proposal.json", ROOT)));
const MIGRATION = Deno.readFileSync(new URL("supabase/migrations-held/20261029120000_smoke_read_cap_seven.sql", ROOT)) as Uint8Array<ArrayBuffer>;
const ROLLBACK = Deno.readFileSync(new URL("supabase/migrations-held/rollback/20261029120000_smoke_read_cap_seven.down.sql", ROOT)) as Uint8Array<ArrayBuffer>;

interface Step { name?: string; run?: string; uses?: string; if?: string; with?: Record<string, string>; env?: Record<string, string> }
interface Job { if?: string; environment?: string; permissions?: Record<string, string>; "timeout-minutes"?: number; env: Record<string, string>; steps: Step[] }
const wf = parse(RAW) as { on: { workflow_dispatch: { inputs: Record<string, Record<string, unknown>> } }; jobs: Record<string, Job> };
const worker = wf.jobs.worker, canary = wf.jobs.canary;
const secretKeys = (env: Record<string, string> = {}) =>
  Object.entries(env).filter(([, v]) => String(v).includes("secrets.")).map(([k]) => k).sort();
const SHA = "0123456789abcdef0123456789abcdef01234567";

Deno.test("canary: one workflow — `none` (the default) is the worker; the other stages are one Environment-guarded job", () => {
  const i = wf.on.workflow_dispatch.inputs;
  assertEquals(i.canary_stage.default, "none");
  assertEquals(i.canary_stage.options, ["none", "verify", "migrate", "prepare", "launch", "reconcile"]);
  assertEquals(Object.keys(wf.jobs).sort(), ["canary", "worker"]);
  assertStringIncludes(worker.if!, `!contains(fromJSON('["verify","migrate","prepare","reconcile"]'), inputs.canary_stage)`);
  assertStringIncludes(canary.if!, `contains(fromJSON('["verify","migrate","prepare","reconcile"]'), inputs.canary_stage)`);
  assertEquals(canary.environment, "discovery-test", "the same Environment and required reviewer");
  assertEquals(worker.permissions, { contents: "read", actions: "read" }, "actions: read only, to download the prepare artifact");
  assert(!("permissions" in canary), "the canary job keeps the workflow's read-only token");
});

async function guard(job: Job, env: Record<string, string>) {
  const out = await new Deno.Command("bash", {
    args: ["-c", job.steps[0].run!], clearEnv: true, stdout: "piped", stderr: "piped",
    env: { PATH: Deno.env.get("PATH") ?? "", GITHUB_SHA: SHA, EXPECTED_SHA: SHA, ...env },
  }).output();
  return { code: out.code, err: new TextDecoder().decode(out.stderr) };
}
const CANARY_ENV = { CONFIRM_REF: "tlvnfrxzjhsjgdofwehb", TEST_PROJECT_REF: "tlvnfrxzjhsjgdofwehb",
  SUPABASE_URL: "https://tlvnfrxzjhsjgdofwehb.supabase.co", TEST_WORKSPACE_ID: "40e2512f-09b6-433e-97fe-f9999a1f1897", CANARY_STAGE: "verify" };

Deno.test("canary job guard, executed: the canary project, workspace and commit only; production refused before checkout", async () => {
  assert(canary.steps[0].name!.startsWith("Refuse"), "the guard is the first step");
  assertEquals((await guard(canary, CANARY_ENV)).code, 0);
  for (const stage of ["verify", "migrate", "prepare", "reconcile"]) assertEquals((await guard(canary, { ...CANARY_ENV, CANARY_STAGE: stage })).code, 0);
  const refused: Array<[Record<string, string>, string]> = [
    [{ CONFIRM_REF: "ohsdatpvfdjdemstoiuj", TEST_PROJECT_REF: "ohsdatpvfdjdemstoiuj", SUPABASE_URL: "https://ohsdatpvfdjdemstoiuj.supabase.co" }, "not a non-production project"],
    [{ CONFIRM_REF: "abcdefghijklmnopqrst", TEST_PROJECT_REF: "abcdefghijklmnopqrst", SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" }, "tlvnfrxzjhsjgdofwehb only"],
    [{ TEST_PROJECT_REF: "abcdefghijklmnopqrst" }, "does not match the Environment"],
    [{ SUPABASE_URL: "https://ohsdatpvfdjdemstoiuj.supabase.co" }, "does not name the confirmed project"],
    [{ TEST_WORKSPACE_ID: "9d09038b-2d39-49ca-b687-e3946ea7266d" }, "not the canary workspace"],
    [{ EXPECTED_SHA: "f".repeat(40) }, "not the approved expected_sha"],
    [{ CANARY_STAGE: "launch" }, "unknown canary stage"],
  ];
  for (const [over, why] of refused) {
    const r = await guard(canary, { ...CANARY_ENV, ...over });
    assertEquals(r.code, 1, JSON.stringify(over));
    assertStringIncludes(r.err, why);
  }
});

const WORKER_ENV = { CONFIRM_REF: "tlvnfrxzjhsjgdofwehb", TEST_PROJECT_REF: "tlvnfrxzjhsjgdofwehb",
  SUPABASE_URL: "https://tlvnfrxzjhsjgdofwehb.supabase.co", LEAD_V2_WORKER_WORKSPACES: "40e2512f-09b6-433e-97fe-f9999a1f1897",
  SESSION_MINUTES: "5", PROVIDERS: "openai-and-apify", CANARY_STAGE: "launch", KICKOFF_RUN_ID: "40833206361", KICKOFF_SHA256: "a".repeat(64) };

Deno.test("worker guard, executed: launch needs the canary project and workspace, a paid dispatch and a named kickoff", async () => {
  assertEquals((await guard(worker, WORKER_ENV)).code, 0);
  assertEquals((await guard(worker, { ...WORKER_ENV, CANARY_STAGE: "none", PROVIDERS: "openai-only" })).code, 0, "the plain worker is unchanged");
  const refused: Array<[Record<string, string>, string]> = [
    [{ PROVIDERS: "openai-only" }, "providers must be openai-and-apify"],
    [{ KICKOFF_SHA256: "" }, "approved kickoff sha256"],
    [{ KICKOFF_RUN_ID: "latest" }, "approved kickoff sha256"],
    [{ LEAD_V2_WORKER_WORKSPACES: "9d09038b-2d39-49ca-b687-e3946ea7266d" }, "discovery-test workspace only"],
    [{ CONFIRM_REF: "abcdefghijklmnopqrst", TEST_PROJECT_REF: "abcdefghijklmnopqrst", SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" }, "tlvnfrxzjhsjgdofwehb only"],
    [{ CANARY_STAGE: "migrate" }, "does not run the worker"],
  ];
  for (const [over, why] of refused) {
    const r = await guard(worker, { ...WORKER_ENV, ...over });
    assertEquals(r.code, 1, JSON.stringify(over));
    assertStringIncludes(r.err, why);
  }
});

Deno.test("canary: each secret reaches only its step; the model key only the paid compile; actions pinned; no interpolation", () => {
  assertEquals(secretKeys(canary.env), [], "no secret at job level");
  assertEquals(canary.steps[0].env, { SUPABASE_URL: "${{ secrets.TEST_SUPABASE_URL }}" });
  const stage = canary.steps.find((s) => (s.run ?? "").includes("canary-stage.sh"))!;
  assertEquals(secretKeys(stage.env), ["APIFY_API_TOKEN", "OPENAI_API_KEY", "TEST_DB_URL"]);
  assertEquals(stage.env!.OPENAI_API_KEY, "${{ inputs.canary_stage == 'prepare' && secrets.TEST_OPENAI_API_KEY || '' }}");
  for (const s of canary.steps.filter((s) => s !== canary.steps[0] && s !== stage)) assertEquals(secretKeys(s.env), [], s.name ?? s.uses);
  for (const job of [worker, canary]) {
    for (const s of job.steps) {
      assert(!(s.run ?? "").includes("${{"), `no expression interpolation in '${s.name ?? s.uses}'`);
      if (s.uses) assert(/^[^@]+@[0-9a-f]{40}$/.test(s.uses), `${s.uses} must be pinned to a full commit SHA`);
    }
  }
  // The launch: its kickoff executes immediately before the worker step, inside the 300 s window.
  const names = worker.steps.map((s) => s.name ?? s.uses ?? "");
  const exec = names.findIndex((n) => n.startsWith("Canary launch: re-verify"));
  assertEquals(names[exec + 1], "One bounded worker session (drains on SIGTERM, then exits)");
  for (const s of worker.steps.filter((s) => (s.name ?? "").startsWith("Canary launch:"))) assertStringIncludes(s.if!, "inputs.canary_stage == 'launch'");
});

async function sha256(b: Uint8Array<ArrayBuffer>) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.test("stage script: the one target, the reviewed checksums and the exact approval phrases", async () => {
  assertStringIncludes(STAGE, "REF=tlvnfrxzjhsjgdofwehb");
  assertStringIncludes(STAGE, "WS=40e2512f-09b6-433e-97fe-f9999a1f1897");
  assertStringIncludes(STAGE, "PRODUCTION_REFS=(ohsdatpvfdjdemstoiuj wqnigjhcwjxtmordrwno)");
  assertStringIncludes(STAGE, `MIGRATION_SHA256=${await sha256(MIGRATION)}`);
  assertStringIncludes(STAGE, `ROLLBACK_SHA256=${await sha256(ROLLBACK)}`);
  assertStringIncludes(STAGE, 'require_approval "apply 20261029120000_smoke_read_cap_seven to $REF"');
  assertStringIncludes(STAGE, 'require_approval "compile canary kickoff at $EXPECTED_SHA"');
  assertStringIncludes(STAGE, 'require_approval "launch canary $sha on $REF with a software-enforced \\$3 budget"');
  // Every paid stage runs the $3 budget gate; read-only stages open read-only sessions.
  for (const stage of ["verify)", "prepare)", "launch)"]) {
    const body = STAGE.slice(STAGE.indexOf(`  ${stage}\n`), STAGE.indexOf(";;", STAGE.indexOf(`  ${stage}\n`)));
    assertStringIncludes(body, "check_budget", stage);
  }
  assertStringIncludes(STAGE, 'case "$STAGE" in migrate|launch) DB_WRITES=1 ;; *) DB_WRITES=0 ;; esac');
  assertStringIncludes(STAGE, '-c "set default_transaction_read_only = on"');
  // The database URL is only ever handed to psql; nothing echoes it.
  assert(!/echo[^\n]*\$TEST_DB_URL/.test(STAGE) && !/echo[^\n]*\$\{?APIFY_API_TOKEN/.test(STAGE) && !/echo[^\n]*\$\{?OPENAI_API_KEY/.test(STAGE));
  // Read-only stages write nothing: no psql -f of anything but the reviewed migration, the kickoff and read-only SQL.
  const files = [...STAGE.matchAll(/q (?:-F '\|' )?(?:-v [^ ]+ )*-f "?([^"\s]+)"?/g)].map((m) => m[1]);
  assertEquals(files.sort(), ['$AUDIT/verify-checks.sql', '$MIGRATION', '$dir/kickoff.sql', "scripts/test-project/real-gpt/preflight.sql",
    "scripts/test-project/smoke-reconciliation.sql"].sort());
});

const kickoff = (over: Record<string, unknown> = {}) => prepareKickoff({
  scenario: "canary_funding", project_ref: "tlvnfrxzjhsjgdofwehb", workspace_id: "40e2512f-09b6-433e-97fe-f9999a1f1897",
  user_id: "22222222-2222-4222-8222-222222222222", queue_id: "33333333-3333-4333-8333-333333333333", plan_id: "44444444-4444-4444-8444-444444444444",
  pricing_version: "test", catalog: CATALOG.approved_quotes, planner_commit: SHA,
  prices: { jobs_maximum_microusd: 4000, details_maximum_microusd: 4050, atomus_maximum_microusd: 10550, observed_at: "2026-10-29T00:00:00Z", source: "test" },
  compile: () => Promise.resolve(structuredClone(PROPOSAL)),
  paid: { approved_by: "test approver", actor_limits: Object.fromEntries(Object.entries(CATALOG.actor_limits_proposed_for_paid_canary).filter(([k]) => k !== "note")) as Record<string, number> },
  ...over,
} as never);
const failed = (k: Record<string, unknown>, sql: string, sha = SHA) => validateKickoff(k as never, sql, sha).filter((c) => !c.ok).map((c) => c.id);

Deno.test("kickoff validator: the approved paid canary passes K01–K19", async () => {
  const k = await kickoff() as unknown as Record<string, unknown> & { sql: string };
  assertEquals(failed(k, k.sql), []);
});

Deno.test("kickoff validator: every drift the approval rests on is refused", async () => {
  const k = await kickoff() as unknown as Record<string, any> & { sql: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  assertEquals(failed(k, k.sql, "f".repeat(40)), ["K08"], "another commit");
  const zero = await kickoff({ paid: undefined }) as unknown as Record<string, unknown> & { sql: string };
  assert(failed(zero, zero.sql).includes("K09") && failed(zero, zero.sql).includes("K17"), "a zero-start kickoff is not the paid canary");
  const twoStarts = structuredClone(k); twoStarts.authorization.actor_limits["apify:atomus~linkedin-company-scraper"] = 2;
  assert(failed(twoStarts, k.sql).includes("K09"), "a second Atomus start");
  const pv = structuredClone(k); pv.authorization.quotes.pvalyou = { maximum_microusd: 40050, allowed_actors: ["apify:pvalyou~company-record"] };
  assert(failed(pv, k.sql).includes("K10"), "a Pvalyou fallback");
  const dear = structuredClone(k); dear.authorization.quotes.atomus.maximum_microusd = 20000;
  assert(failed(dear, k.sql).includes("K11") && failed(dear, k.sql).includes("K12"), "a raised maximum");
  const five = structuredClone(k); five.request.requested_lead_count = 5;
  assert(failed(five, k.sql).includes("K03"), "five companies");
  const unassumed = structuredClone(k); unassumed.disclosures = [];
  assert(failed(unassumed, k.sql).includes("K07"), "the assumed hiring window dropped");
  assert(failed(k, k.sql.replace("tlvnfrxzjhsjgdofwehb.", "abcdefghijklmnopqrst.")).includes("K16"), "another project");
  assert(failed(k, k.sql.replace("commit;\n", "update public.workspace_credit_balances set balance_credits = 99;\ncommit;\n")).includes("K18"),
    "an extra statement");
  const other = structuredClone(k); other.request.workspace_id = "9d09038b-2d39-49ca-b687-e3946ea7266d";
  assert(failed(other, k.sql).includes("K04"), "another workspace");
});

// ── the $3 canary budget (canary-budget.ts) ──────────────────────────────────
const APIFY = { account: { room_usd: 18.99987, max_monthly_usage_usd: 19 }, actors: [
  { template: "jobs", available: true, pricing_model: "PAY_PER_EVENT", worst_case_usd: 0.004 },
  { template: "details", available: true, pricing_model: "PAY_PER_EVENT", worst_case_usd: 0.00405 },
  { template: "atomus", available: true, pricing_model: "PAY_PER_EVENT", worst_case_usd: 0.01055 },
] };
const budget = (over: { stage?: string; apify?: unknown; spent?: number } = {}) => canaryBudget({
  stage: over.stage ?? "prepare", apify: (over.apify ?? APIFY) as never, spentMicrousd: over.spent ?? 0, catalog: CATALOG.approved_quotes });
const failing = (r: ReturnType<typeof canaryBudget>) => r.checks.filter((c) => c.result === "FAIL").map((c) => c.id);

Deno.test("budget: the observed account (a $19 limit) passes the $3 canary gate, and the limitation is stated, never a PASS", () => {
  const r = budget();
  assertEquals([r.ok, failing(r)], [true, []]);
  assertEquals(r.next_worst_microusd, 93_480, "compile 2 × $0.01248 + provider $0.0186 + worker model 4 × $0.01248");
  const b6 = r.checks.find((c) => c.id === "B6")!;
  assertEquals(b6.result, "INFO");
  assertStringIncludes(b6.observed, "account hard limit $19");
  assertStringIncludes(b6.observed, "unproven until the first run's receipts");
  assertEquals(budget({ stage: "launch" }).next_worst_microusd, 68_520, "launch: the compile is already spent");
});

Deno.test("budget: too little left of the $3, a price above its reservation, a non-PPE actor or too little account room each refuse", () => {
  assertEquals(failing(budget({ spent: CANARY_BUDGET_MICROUSD - 93_479 })), ["B4"], "one micro-dollar short");
  assertEquals(budget({ spent: CANARY_BUDGET_MICROUSD - 93_480 }).ok, true, "exactly fits");
  assertEquals(failing(budget({ stage: "launch", spent: 2_950_000 })), ["B4"]);
  const dear = structuredClone(APIFY); dear.actors[2].worst_case_usd = 0.0106;
  assertEquals(failing(budget({ apify: dear })), ["B2"]);
  const flat = structuredClone(APIFY); (flat.actors[0] as Record<string, unknown>).pricing_model = "FLAT_PRICE_PER_MONTH";
  assertEquals(failing(budget({ apify: flat })), ["B1"], "no per-run charge cap on a non-PPE actor");
  const gone = structuredClone(APIFY); gone.actors[1].available = false;
  assertEquals(failing(budget({ apify: gone })), ["B1"]);
  const poor = structuredClone(APIFY); poor.account.room_usd = 0.01;
  assertEquals(failing(budget({ apify: poor })), ["B5"]);
  assertEquals(budget({ apify: { account: {}, actors: [] } }).ok, false, "no Apify record: refused");
});
