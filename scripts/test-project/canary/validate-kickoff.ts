// THE CANARY KICKOFF, VALIDATED BEFORE IT IS EXECUTED. Pure; reads two files.
//
//   deno run --allow-read=<dir> --allow-write=<dir> scripts/test-project/canary/validate-kickoff.ts \
//     --dir <kickoff dir> --expected-sha <40 hex> [--json <file>]
//
// The canary workflow (.github/workflows/discovery-test-worker.yml) runs this on
// every kickoff it generates and again, at launch, on the exact file it is
// about to execute. Every property the approval rests on is checked here, so
// a kickoff that drifted — another project, another workspace, Pvalyou, a
// second start, a raised cap, a lost assumption, another commit, any SQL
// beyond the four reviewed statements — is refused before any write.

import { parseArgs } from "https://deno.land/std@0.224.0/cli/parse_args.ts";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const CANARY_PROJECT_REF = "tlvnfrxzjhsjgdofwehb";
export const CANARY_WORKSPACE_ID = "40e2512f-09b6-433e-97fe-f9999a1f1897";
export const CANARY_MISSION = "Find one US company hiring Account Executives that raised funding within the last six months.";
const PRODUCTION_REFS = ["ohsdatpvfdjdemstoiuj", "wqnigjhcwjxtmordrwno"];
const JOBS = "apify:harvestapi~linkedin-job-search";
const DETAILS = "apify:harvestapi~linkedin-company";
const ATOMUS = "apify:atomus~linkedin-company-scraper";
/**
 * The REVIEWED CEILINGS per start (µ$): Contract 2's catalog. A later contract's
 * catalog may narrow them and never raise them (`approvedCatalog`).
 */
export const APPROVED_MAXIMA: Readonly<Record<string, number>> = { jobs: 4000, details: 4050, atomus: 10550, model: 12480, reads: 0 };
/** The only catalogs a canary kickoff may be prepared from: the reviewed canary-funding files. */
export const CANARY_CATALOG_PATH = /^docs\/launch\/proposals\/smoke-catalog-canary-funding(-[0-9]+)?\.json$/;
export const DEFAULT_CANARY_CATALOG = "docs/launch/proposals/smoke-catalog-canary-funding.json";

/** What a kickoff must equal: one reviewed catalog's maxima, each within the reviewed ceiling. */
export interface ApprovedCatalog { maxima: Record<string, number>; within_ceilings: boolean }
export function approvedCatalog(doc: Json): ApprovedCatalog {
  const q = (doc?.approved_quotes ?? {}) as Record<string, Json>;
  const name = (n: string) => n === "luna" ? "model" : n;
  const maxima = Object.fromEntries(Object.entries(q).map(([n, t]) => [name(n), Number(t?.maximum_microusd)]));
  const within_ceilings = Object.keys(APPROVED_MAXIMA).every((n) => Number.isFinite(maxima[n]) && maxima[n] <= APPROVED_MAXIMA[n]) &&
    Object.keys(maxima).every((n) => n in APPROVED_MAXIMA);
  return { maxima, within_ceilings };
}
/** Contract 2's catalog, as the reviewed default. */
const CONTRACT2_CATALOG: ApprovedCatalog = { maxima: { ...APPROVED_MAXIMA }, within_ceilings: true };
export const PROVIDER_CAP_MICROUSD = 200_000;
export const MODEL_CAP_MICROUSD = 50_000;
const MODEL_ATTEMPTS = 4;

export interface Check { id: string; what: string; ok: boolean; observed: string }

/** Every SQL line that starts a statement must be one of the reviewed four (plus the transaction). */
const ALLOWED_STATEMENT = /^(begin;|commit;|insert into public\.task_plans \(|insert into public\.lead_execution_calls \(|insert into public\.lead_mission_queue \(|select public\.authorize_discovery_smoke\()/;

export function validateKickoff(k: Json, sql: string, expectedSha: string, approved: ApprovedCatalog = CONTRACT2_CATALOG): Check[] {
  const out: Check[] = [];
  const c = (id: string, what: string, ok: boolean, observed: unknown) =>
    out.push({ id, what, ok, observed: typeof observed === "string" ? observed : JSON.stringify(observed) });
  const req = k.request ?? {};
  const mission = k.compiled_mission ?? {};
  const auth = k.authorization ?? {};
  const quotes = (auth.quotes ?? {}) as Record<string, Json>;
  const limits = (auth.actor_limits ?? {}) as Record<string, number>;

  c("K01", "scenario is canary_funding", k.scenario === "canary_funding", k.scenario);
  c("K02", "the user's request, verbatim", req.instruction === CANARY_MISSION, req.instruction);
  c("K03", "one company requested", req.requested_lead_count === 1 && mission.requested_count === 1,
    [req.requested_lead_count, mission.requested_count]);
  c("K04", "the canary workspace only", req.workspace_id === CANARY_WORKSPACE_ID, req.workspace_id);
  const interp = (k.interpretation ?? []) as Json[];
  c("K05", "interpretation D1–D7 all PASS", interp.length === 7 && interp.every((v) => v.result === "PASS"),
    interp.map((v) => `${v.id}:${v.result}`));
  const signals = ((mission.required_signals ?? []) as Json[]).map((s) => [s.event ?? s.type, s.timeframe_days]);
  c("K06", "hiring 30 days and funding 180 days, kept separate", JSON.stringify(signals) === JSON.stringify([["hiring", 30], ["funding", 180]]), signals);
  const disclosures = (k.disclosures ?? []) as string[];
  c("K07", "the 30-day hiring window is disclosed as an ASSUMED default, in the artifacts and the SQL",
    disclosures.length === 1 && /^Hiring.*last 30 days is Agentory's default/.test(disclosures[0]) &&
      sql.includes(`-- ASSUMED, NOT STATED BY THE USER: ${disclosures[0]}`), disclosures);
  c("K08", "planner_runtime is the reviewed commit", mission.planner_runtime?.git_sha === expectedSha, mission.planner_runtime?.git_sha ?? null);
  c("K09", "exactly one start each: job search, company details, Atomus",
    JSON.stringify(Object.entries(limits).sort()) === JSON.stringify([[ATOMUS, 1], [DETAILS, 1], [JOBS, 1]]), limits);
  c("K10", "templates are exactly jobs, details, atomus, reads, model — no Pvalyou",
    JSON.stringify(Object.keys(quotes).sort()) === JSON.stringify(["atomus", "details", "jobs", "model", "reads"]) &&
      // Executable lines only: the header's own "No Pvalyou template" note is a comment.
      !/pvalyou/i.test(sql.split("\n").filter((l) => !l.startsWith("--")).join("\n")) &&
      !/pvalyou/i.test(JSON.stringify(auth)), Object.keys(quotes).sort());
  const maxima = Object.fromEntries(Object.entries(quotes).map(([n, q]) => [n, q.maximum_microusd]));
  c("K11", "every maximum is the approved catalog's, and no catalog exceeds the reviewed ceiling",
    approved.within_ceilings && Object.keys(APPROVED_MAXIMA).every((n) => maxima[n] === approved.maxima[n]), maxima);
  const templateOf = (actor: string) => Object.values(quotes).find((q) => (q.allowed_actors ?? []).includes(actor) &&
    (q.allowed_kinds ?? []).includes("provider"));
  const provider = Object.entries(limits).reduce((a, [actor, n]) => a + n * Number(templateOf(actor)?.maximum_microusd ?? Infinity), 0);
  // One start of each approved actor at the catalog's own maxima — Contract 2's 18,600 µ$, or less.
  const expected = approved.maxima.jobs + approved.maxima.details + approved.maxima.atomus;
  c("K12", `worst-case provider spend ≤ ${PROVIDER_CAP_MICROUSD} µ$ ($0.20) and exactly the catalog's`,
    provider <= PROVIDER_CAP_MICROUSD && provider === expected, provider);
  const model = MODEL_ATTEMPTS * Number(quotes.model?.maximum_microusd ?? Infinity);
  c("K13", `worst-case worker model spend ≤ ${MODEL_CAP_MICROUSD} µ$ ($0.05)`, model <= MODEL_CAP_MICROUSD, model);
  c("K20", "provider + worker model worst case ≤ the $0.25 combined authorization", provider + model <= 250_000, provider + model);
  c("K14", "the mission's own run budget is $0.20", req.run_budget?.provider_usd === 0.2, req.run_budget);
  const ledger = (k.compile_ledger_rows ?? []) as Json[];
  const compileUsd = ledger.reduce((a, r) => a + Number(r.estimated_cost_usd ?? 0), 0);
  c("K15", "kickoff compile: at most 2 Luna calls, accounted separately", ledger.length <= 2 &&
    ledger.every((r) => String(r.metadata?.model ?? "gpt-5.6-luna") === "gpt-5.6-luna"), { calls: ledger.length, usd: compileUsd });
  c("K16", "the SQL names the canary project and never production",
    sql.includes(`for TEST project ${CANARY_PROJECT_REF}.`) && !PRODUCTION_REFS.some((r) => sql.replace(/NEVER run on [a-z0-9 ]+\./, "").includes(r)), "header");
  c("K17", "the SQL is a PAID canary approval naming its approver",
    new RegExp(`^-- PAID: APPROVED BY .+\\. Starts: .*worst-case provider ${expected} µ\\$\\.$`, "m").test(sql),
    sql.match(/^-- PAID: APPROVED BY ([^.]*)\./m)?.[1] ?? null);
  const statements = sql.split("\n").filter((l) => l.trim() && !l.startsWith("--") && !/^\s/.test(l));
  const bad = statements.filter((l) => !ALLOWED_STATEMENT.test(l));
  c("K18", "only the four reviewed statements, in one transaction", bad.length === 0 &&
    statements.filter((l) => l === "begin;").length === 1 && statements.at(-1) === "commit;" &&
    statements.filter((l) => l.startsWith("insert into public.lead_mission_queue (")).length === 1 &&
    statements.filter((l) => l.startsWith("select public.authorize_discovery_smoke(")).length === 1, bad.slice(0, 3));
  const queueInsert = sql.match(/insert into public\.lead_mission_queue \(id, workspace_id, request, status\)\n\s+values \('([0-9a-f-]{36})', '([0-9a-f-]{36})'/);
  c("K19", "the queue row is the canary workspace's, queued", queueInsert?.[2] === CANARY_WORKSPACE_ID && /'queued'\);\n/.test(sql), queueInsert?.[2] ?? null);
  return out;
}

export function queueIdOf(sql: string): string | null {
  return sql.match(/insert into public\.lead_mission_queue \(id, workspace_id, request, status\)\n\s+values \('([0-9a-f-]{36})'/)?.[1] ?? null;
}

if (import.meta.main) {
  const a = parseArgs(Deno.args, { string: ["dir", "expected-sha", "json", "catalog"] });
  if (!a.dir || !/^[0-9a-f]{40}$/.test(a["expected-sha"] ?? "")) { console.error("--dir and a 40-hex --expected-sha are required"); Deno.exit(2); }
  const catalogFile = a.catalog ?? DEFAULT_CANARY_CATALOG;
  if (!CANARY_CATALOG_PATH.test(catalogFile)) { console.error(`--catalog must be a reviewed canary-funding catalog: ${catalogFile}`); Deno.exit(2); }
  const k = JSON.parse(Deno.readTextFileSync(`${a.dir}/kickoff.json`));
  const sql = Deno.readTextFileSync(`${a.dir}/kickoff.sql`);
  const checks = validateKickoff(k, sql, a["expected-sha"]!, approvedCatalog(JSON.parse(Deno.readTextFileSync(catalogFile))));
  for (const x of checks) console.log(`${x.ok ? "PASS" : "FAIL"} ${x.id} ${x.what}: ${x.observed}`);
  const ok = checks.every((x) => x.ok);
  if (a.json) Deno.writeTextFileSync(a.json, JSON.stringify({ ok, queue_id: queueIdOf(sql), checks }, null, 2) + "\n");
  console.log(ok ? "KICKOFF VALID" : "KICKOFF INVALID — nothing is executed");
  Deno.exit(ok ? 0 : 1);
}
