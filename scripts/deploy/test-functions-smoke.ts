// DISCOVERY FUNCTIONS → TEST: change detection, pre-deploy snapshot, post-deploy smoke.
//
//   deno run -A scripts/deploy/test-functions-smoke.ts changed  <target_sha>          → functions to deploy
//   deno run -A scripts/deploy/test-functions-smoke.ts snapshot <out.json>            → state before the deploy
//   deno run -A scripts/deploy/test-functions-smoke.ts verify   <before.json> <outdir> → smoke checks + report
//
// Used by .github/workflows/deploy-test-functions.yml, and runnable by hand with the
// same environment. It targets ONE project, TEST_REF, and refuses anything else:
// there is no input that names a project, so nothing here can reach production
// except the read-only, unauthenticated OPTIONS probe that proves production did
// not change.
//
// SPEND. It never calls a provider. The planning smoke makes exactly ONE
// `strategy_plan` call per verify (GPT reads the query: ≤ 3 model calls, the
// function's own retry ceiling); the isolation calls are refused before any model
// runs. `strategy_run` and the pipeline's `run` are not representable here
// (PLAN_ACTION is the only action this file sends to lead-pipeline), and the smoke
// account should be a plain member, which the function refuses for any paid run.
//
// LOGS ARE PUBLIC (public repository). Nothing printed or written here contains a
// token, a password, the smoke account's email, or a secret's value. Secret
// values are never read into the report: only names, plus one boolean for the
// workspace allowlists (digest comparison, see allowlistMatches).

import { DISCOVERY_CAPABILITIES, discoveryJobTitles } from "../../supabase/functions/_shared/leadPipeline/strategy.ts";

export const TEST_REF = "tlvnfrxzjhsjgdofwehb";
export const PROD_REF = "ohsdatpvfdjdemstoiuj";
export const TEST_URL = `https://${TEST_REF}.supabase.co`;
export const PROD_URL = `https://${PROD_REF}.supabase.co`;
/** TEST's publishable (public) key: it identifies the project and grants nothing on its own. */
export const TEST_PUBLISHABLE_KEY = "sb_publishable_xJyW_B57hr6_SMFQbf2KPg_7-Fdyrjp";
/** The ONE workspace both discovery allowlists must name on TEST. */
export const TEST_WORKSPACE = "40e2512f-09b6-433e-97fe-f9999a1f1897";
/** A real TEST workspace that must stay outside the allowlists, and one that does not exist. */
export const OTHER_WORKSPACE = "9d09038b-2d39-49ca-b687-e3946ea7266d";
export const ABSENT_WORKSPACE = "00000000-0000-4000-8000-000000000000";
export const FUNCTIONS = ["lead-pipeline", "provider-connections"] as const;
export const PLAN_ACTION = "strategy_plan" as const;
export const SMOKE_QUERY =
  "Find 5 US B2B companies actively hiring salespeople. Prefer 20–500 employees, but include strong opportunities outside that range.";
/** Per-request ceilings the plan must stay within (the function's defaults, sent explicitly). */
export const SMOKE_BUDGET = { max_leadocean_records: 50, max_apify_usd: 0.25 } as const;
/** Flags that must be SET on TEST, and flags that must NOT exist there at all. */
export const REQUIRED_FLAGS = [
  "LEAD_PIPELINE_ENABLED", "LEAD_PIPELINE_WORKSPACES",
  "PROVIDER_DISCOVERY_ENABLED", "PROVIDER_DISCOVERY_WORKSPACES", "PROVIDER_APIFY_DISCOVERY_ENABLED",
] as const;
export const FORBIDDEN_FLAGS = [
  "PROVIDER_APOLLO_ENABLED", "LEAD_PIPELINE_PHONES_ENABLED", "LEAD_PIPELINE_SIGNALS_ENABLED",
  "DISCOVERY_EVIDENCE_CACHE_ENABLED", "APOLLO_COMMERCIAL_TERMS_CONFIRMED",
] as const;
/** Tables whose row counts must not move during a deploy + smoke (spend, writes, outreach, calls). */
export const WATCHED_TABLES = [
  "provider_usage_ledger", "lead_pipeline_checkpoints", "lead_candidates", "accounts", "contacts",
  "lead_execution_calls", "call_attempts", "scheduled_emails", "outreach_activities", "outreach_drafts",
  "outreach_daily_queue", "workspace_provider_connections",
] as const;
/** Capabilities that must never appear in a plan from this commit (not approved / not validated). */
export const NEVER_PLANNED = /^(apollo\.|apify\.founder_check$|apify\.company_employees$|apify\.people_search$|apify\.funding_corroboration$)|phone/;

export type Status = "pass" | "fail" | "skip";
export interface Check { id: string; name: string; status: Status; detail: string; likely_cause?: string }
const pass = (id: string, name: string, detail: string): Check => ({ id, name, status: "pass", detail });
const fail = (id: string, name: string, detail: string, likely_cause: string): Check => ({ id, name, status: "fail", detail, likely_cause });
const skip = (id: string, name: string, detail: string): Check => ({ id, name, status: "skip", detail });

// ------------------------------------------------------------------ pure checks

/** `<sha>@<built_at>` → sha, or null when absent/unstamped. */
export function buildShaOf(header: string | null | undefined): string | null {
  const sha = (header ?? "").split("@")[0].trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/**
 * Which functions need a deploy: a function whose live build is unknown, or whose
 * dependency graph contains a file changed between its live build and the target.
 * Any doubt deploys (an unknown sha, a non-ancestor, a config change).
 */
export function functionsToDeploy(input: {
  graphs: Record<string, string[]>;
  live: Record<string, { sha: string | null; exists: boolean }>;
  changedSince: (sha: string) => string[] | null;
}): { fn: string; deploy: boolean; reason: string }[] {
  return Object.keys(input.graphs).map((fn) => {
    const live = input.live[fn];
    if (!live?.exists) return { fn, deploy: true, reason: "not deployed on TEST" };
    if (!live.sha) return { fn, deploy: true, reason: "live build is unstamped (unknown commit)" };
    const changed = input.changedSince(live.sha);
    if (changed === null) return { fn, deploy: true, reason: `live build ${live.sha.slice(0, 12)} is not an ancestor of the target` };
    const graph = new Set(input.graphs[fn]);
    const always = changed.filter((f) => f === "supabase/config.toml" || /^supabase\/functions\/[^/]+\.json$/.test(f));
    const hits = [...changed.filter((f) => graph.has(f)), ...always];
    return hits.length
      ? { fn, deploy: true, reason: `${hits.length} file(s) in its graph changed since ${live.sha.slice(0, 12)}: ${hits.slice(0, 5).join(", ")}${hits.length > 5 ? ", …" : ""}` }
      : { fn, deploy: false, reason: `unchanged since live build ${live.sha.slice(0, 12)}` };
  });
}

export function countChecks(before: Record<string, number>, after: Record<string, number>): Check[] {
  const moved = Object.keys({ ...before, ...after }).filter((t) => (before[t] ?? -1) !== (after[t] ?? -1));
  const ledger = ["provider_usage_ledger", "lead_execution_calls"].filter((t) => moved.includes(t));
  const outreach = ["call_attempts", "scheduled_emails", "outreach_activities", "outreach_drafts", "outreach_daily_queue"].filter((t) => moved.includes(t));
  const writes = moved.filter((t) => !ledger.includes(t) && !outreach.includes(t));
  return [
    ledger.length
      ? fail("8", "Spending ledger unchanged", `moved: ${ledger.map((t) => `${t} ${before[t]}→${after[t]}`).join(", ")}`, "a provider call was made during deploy/smoke — stop and reconcile the ledger before anything else")
      : pass("8", "Spending ledger unchanged", `provider_usage_ledger ${after.provider_usage_ledger ?? "n/a"}, lead_execution_calls ${after.lead_execution_calls ?? "n/a"} (unchanged)`),
    outreach.length
      ? fail("9", "No phone enrichment or outreach", `moved: ${outreach.join(", ")}`, "something sent, queued or called during the smoke window")
      : pass("9", "No phone enrichment or outreach", "call, email and outreach tables unchanged"),
    writes.length
      ? fail("8b", "No lead/ATLAS writes", `moved: ${writes.map((t) => `${t} ${before[t]}→${after[t]}`).join(", ")}`, "a write happened on TEST during the smoke window (another user, or a run)")
      : pass("8b", "No lead/ATLAS writes", "leads, accounts, contacts, checkpoints, connections unchanged"),
  ];
}

export function secretChecks(names: string[], allowlistsExact: boolean | null): Check[] {
  const have = new Set(names);
  const missing = REQUIRED_FLAGS.filter((n) => !have.has(n));
  const forbidden = FORBIDDEN_FLAGS.filter((n) => have.has(n));
  return [
    missing.length
      ? fail("7a", "Discovery flags present", `missing: ${missing.join(", ")}`, "set the flag on TEST (supabase secrets set --project-ref " + TEST_REF + ")")
      : pass("7a", "Discovery flags present", REQUIRED_FLAGS.join(", ")),
    forbidden.length
      ? fail("7", "Disabled capabilities stay disabled (flags)", `present on TEST: ${forbidden.join(", ")}`, "unset it: it would enable a capability that is not approved")
      : pass("7", "Disabled capabilities stay disabled (flags)", `absent: ${FORBIDDEN_FLAGS.join(", ")}`),
    allowlistsExact === null
      ? skip("5a", "Allowlists name only the TEST workspace", "the secrets API did not return comparable digests")
      : allowlistsExact
      ? pass("5a", "Allowlists name only the TEST workspace", "LEAD_PIPELINE_WORKSPACES and PROVIDER_DISCOVERY_WORKSPACES = the TEST workspace exactly")
      : fail("5a", "Allowlists name only the TEST workspace", "an allowlist differs from the single TEST workspace", "reset both *_WORKSPACES secrets to exactly the TEST workspace id"),
  ];
}

/** Code-level: at this commit, every capability NEVER_PLANNED is unavailable in the registry. */
export function registryCheck(): Check {
  const open = Object.values(DISCOVERY_CAPABILITIES).filter((c) => NEVER_PLANNED.test(c.id) && c.status === "available").map((c) => c.id);
  return open.length
    ? fail("7b", "Disabled capabilities stay disabled (code)", `available at this commit: ${open.join(", ")}`, "a capability was enabled in strategy.ts without approval")
    : pass("7b", "Disabled capabilities stay disabled (code)", "Apollo, founder check, company employees, people search, funding corroboration: unavailable");
}

interface PlanBody {
  status?: string;
  plan?: { status?: string; strategy?: string | null; planHash?: string; estimate?: { leadoceanRecords?: number; apifyUsd?: number };
    steps?: { capability: string; provider: string; maxItems: number }[]; selectedBy?: string | null; blockedReason?: string | null };
  interpretation?: { hard?: { key: string; label?: string }[]; preferences?: { key: string; values: unknown }[];
    signals?: { kind: string; hard?: boolean; windowDays?: number | null; roleTerms?: string[]; roleFamilies?: string[] }[]; companyBrain?: { status?: string } | null };
}

/** Sales titles the run would search, from the plan's own interpretation (the planner's function). */
export function titlesFromInterpretation(i: PlanBody["interpretation"]): string[] {
  const pref = i?.preferences?.find((p) => p.key === "employee_range")?.values as { min?: number; max?: number } | undefined;
  const spec = { signals: (i?.signals ?? []).map((s) => ({ ...s, roleTerms: s.roleTerms ?? [], roleFamilies: s.roleFamilies ?? [] })), preferredEmployees: pref ?? null };
  return discoveryJobTitles(spec as never);
}

export const ACCEPTED_STRATEGIES = ["apify_only", "apify_plus_leadocean"];

export function planChecks(httpStatus: number, body: PlanBody): Check[] {
  const p = body.plan, i = body.interpretation;
  if (httpStatus !== 200 || !p || !i) {
    return [fail("P0", "strategy_plan answered", `HTTP ${httpStatus}: ${JSON.stringify(body).slice(0, 200)}`,
      httpStatus === 401 ? "the smoke account could not authenticate" : httpStatus === 403 ? "the smoke account is not a member of the TEST workspace, or the allowlist lacks it"
      : httpStatus === 404 ? "flags not in effect on TEST" : "interpretation failed (OpenAI key/quota) or the function errored — read the function log")];
  }
  const hard = (i.hard ?? []).map((h) => h.key);
  const size = i.preferences?.find((x) => x.key === "employee_range")?.values as { min?: number; max?: number } | undefined;
  const hiring = (i.signals ?? []).find((s) => s.kind === "hiring");
  const titles = titlesFromInterpretation(i);
  const steps = p.steps ?? [];
  const bad = steps.filter((s) => NEVER_PLANNED.test(s.capability) || s.provider === "apollo").map((s) => s.capability);
  const est = p.estimate ?? {};
  return [
    pass("P0", "strategy_plan answered", `HTTP 200, status ${p.status}`),
    hard.includes("geography_hq") && hard.includes("signal") && !hard.includes("employee_range")
      ? pass("P1", "Hard requirements", `${hard.join(", ")}${hard.length > 2 ? " (extra hard keys reported, not failed)" : ""}`)
      : fail("P1", "Hard requirements", `hard = [${hard.join(", ")}]`, hard.includes("employee_range") ? "the size became HARD: the hedged-size fix is not in effect" : "US HQ and the hiring signal must both be hard"),
    size && size.min === 20 && size.max === 500
      ? pass("P2", "Soft employee-size preference", "employee_range 20–500 is a preference")
      : fail("P2", "Soft employee-size preference", `employee_range preference = ${JSON.stringify(size ?? null)}`, "the 20–500 range was dropped, narrowed (Company Brain?) or made hard"),
    hiring?.roleFamilies?.includes("gtm_sales") && titles.some((t) => /account executive|sales/i.test(t))
      ? pass("P3", "Appropriate sales title", `role family gtm_sales; titles searched: ${titles.join(" | ")}`)
      : fail("P3", "Appropriate sales title", `families ${JSON.stringify(hiring?.roleFamilies ?? [])}, titles ${JSON.stringify(titles)}`, "\"salespeople\" was not mapped to a sales title (sales-title fix)"),
    p.status === "ready" && ACCEPTED_STRATEGIES.includes(p.strategy ?? "") && !bad.length
      ? pass("P4", "Strategy selection", `${p.strategy} (selected by ${p.selectedBy}); steps: ${steps.map((s) => `${s.capability}≤${s.maxItems}`).join(", ")}`)
      : fail("P4", "Strategy selection", `status ${p.status}, strategy ${p.strategy}, blocked: ${p.blockedReason ?? "-"}${bad.length ? `, forbidden steps: ${bad.join(", ")}` : ""}`,
        bad.length ? "a disabled capability was planned" : "a hiring query must be led by Apify job search (apify_only / apify_plus_leadocean)"),
    /^[0-9a-f]{8}$/.test(p.planHash ?? "")
      ? pass("P5", "Valid plan hash", p.planHash!)
      : fail("P5", "Valid plan hash", `planHash = ${JSON.stringify(p.planHash)}`, "the planner did not bind the plan"),
    (est.apifyUsd ?? Infinity) <= SMOKE_BUDGET.max_apify_usd && (est.leadoceanRecords ?? Infinity) <= SMOKE_BUDGET.max_leadocean_records
      ? pass("P6", "Budget ceiling", `worst case $${est.apifyUsd} Apify, ${est.leadoceanRecords} LeadOcean records (ceilings $${SMOKE_BUDGET.max_apify_usd}, ${SMOKE_BUDGET.max_leadocean_records})`)
      : fail("P6", "Budget ceiling", `worst case ${JSON.stringify(est)}`, "the cost sizer did not fit the plan inside the request's ceilings"),
  ];
}

export function verdict(checks: Check[]): "READY" | "NOT READY" {
  return checks.every((c) => c.status === "pass") ? "READY" : "NOT READY";
}

export function renderSummary(r: { sha: string; runUrl: string; deployed: string[]; versions: Record<string, unknown>; checks: Check[]; stage: string }): string {
  const icon = (s: Status) => s === "pass" ? "✅" : s === "fail" ? "❌" : "⚪";
  const v = verdict(r.checks);
  const lines = [
    `## TEST readiness: ${v === "READY" ? "✅ READY" : "❌ NOT READY"}`,
    "",
    `- Commit: \`${r.sha}\``,
    `- Project: \`${TEST_REF}\` (TEST)`,
    `- Deployed this run: ${r.deployed.length ? r.deployed.join(", ") : "none (unchanged)"}`,
    `- Versions: ${Object.entries(r.versions).map(([k, x]) => `${k} ${JSON.stringify(x)}`).join("; ")}`,
    `- Stage: ${r.stage}`,
    `- Run: ${r.runUrl}`,
    "",
    "| # | Check | Result | Detail | Likely cause |",
    "|---|---|---|---|---|",
    ...r.checks.map((c) => `| ${c.id} | ${c.name} | ${icon(c.status)} ${c.status} | ${c.detail.replace(/\|/g, "\\|")} | ${(c.likely_cause ?? "").replace(/\|/g, "\\|")} |`),
  ];
  return lines.join("\n") + "\n";
}

// ------------------------------------------------------------------ I/O (CI only)

function env(k: string, required = true): string {
  const v = Deno.env.get(k)?.trim() ?? "";
  if (required && !v) throw new Error(`${k} is not set`);
  return v;
}

async function mgmt(path: string, init: RequestInit = {}): Promise<Response> {
  if (!path.startsWith(`/v1/projects/${TEST_REF}/`)) throw new Error(`refusing a management call outside TEST: ${path}`);
  return await fetch(`https://api.supabase.com${path}`, {
    ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${env("SUPABASE_ACCESS_TOKEN")}`, "content-type": "application/json" },
  });
}

async function functionMeta(fn: string): Promise<{ exists: boolean; version: number | null; status: string | null; verify_jwt: boolean | null; updated_at: number | null }> {
  const r = await mgmt(`/v1/projects/${TEST_REF}/functions/${fn}`);
  if (r.status === 404) { await r.body?.cancel(); return { exists: false, version: null, status: null, verify_jwt: null, updated_at: null }; }
  if (!r.ok) throw new Error(`functions/${fn}: HTTP ${r.status}`);
  const j = await r.json();
  return { exists: true, version: j.version ?? null, status: j.status ?? null, verify_jwt: j.verify_jwt ?? null, updated_at: j.updated_at ?? null };
}

async function buildHeader(base: string, fn: string): Promise<{ status: number; build: string | null }> {
  const r = await fetch(`${base}/functions/v1/${fn}`, { method: "OPTIONS", headers: { Origin: "https://agentory.invalid", "Access-Control-Request-Method": "POST" } });
  await r.body?.cancel();
  return { status: r.status, build: r.headers.get("x-agentory-build") };
}

const COUNT_SQL = `select coalesce(jsonb_object_agg(t, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text::bigint), '{}'::jsonb) as counts
from unnest(array[${WATCHED_TABLES.map((t) => `'${t}'`).join(",")}]) as t where to_regclass('public.' || t) is not null`;

async function counts(): Promise<Record<string, number>> {
  const r = await mgmt(`/v1/projects/${TEST_REF}/database/query`, { method: "POST", body: JSON.stringify({ query: COUNT_SQL }) });
  if (!r.ok) throw new Error(`database/query: HTTP ${r.status}`);
  const rows = await r.json();
  return (rows?.[0]?.counts ?? {}) as Record<string, number>;
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Secret NAMES, and whether both allowlists equal the TEST workspace. The API returns a
 * digest per secret (what `supabase secrets list` shows); it is compared, never kept.
 */
async function secrets(): Promise<{ names: string[]; allowlistsExact: boolean | null }> {
  const r = await mgmt(`/v1/projects/${TEST_REF}/secrets`);
  if (!r.ok) throw new Error(`secrets: HTTP ${r.status}`);
  const rows = (await r.json()) as { name: string; value?: string }[];
  const want = await sha256Hex(TEST_WORKSPACE);
  const lists = rows.filter((x) => x.name === "LEAD_PIPELINE_WORKSPACES" || x.name === "PROVIDER_DISCOVERY_WORKSPACES");
  // Comparable only when the API returns sha256 digests (or, defensively, the plain id).
  const comparable = lists.length === 2 && lists.every((x) => typeof x.value === "string" && (/^[0-9a-f]{64}$/.test(x.value) || x.value === TEST_WORKSPACE));
  const exact: boolean | null = lists.length < 2 ? false : comparable ? lists.every((x) => x.value === want || x.value === TEST_WORKSPACE) : null;
  return { names: rows.map((x) => x.name).sort(), allowlistsExact: exact };
}

async function call(fn: string, body: unknown, token?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { apikey: TEST_PUBLISHABLE_KEY, "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${TEST_URL}/functions/v1/${fn}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(150_000) });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; } catch { return { status: r.status, body: { raw: text.slice(0, 200) } }; }
}

async function signIn(): Promise<string | null> {
  const email = env("SMOKE_USER_EMAIL", false), password = env("SMOKE_USER_PASSWORD", false);
  if (!email || !password) return null;
  const r = await fetch(`${TEST_URL}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: TEST_PUBLISHABLE_KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`smoke sign-in failed: HTTP ${r.status}`);
  console.log(`::add-mask::${j.access_token}`);
  return j.access_token as string;
}

async function git(...args: string[]): Promise<{ ok: boolean; out: string }> {
  const o = await new Deno.Command("git", { args, stdout: "piped", stderr: "null" }).output();
  return { ok: o.success, out: new TextDecoder().decode(o.stdout) };
}

async function graphOf(fn: string): Promise<string[]> {
  const o = await new Deno.Command(Deno.execPath(), { args: ["info", "--json", `supabase/functions/${fn}/index.ts`], stdout: "piped", stderr: "inherit" }).output();
  if (!o.success) throw new Error(`deno info ${fn} failed`);
  const root = `file://${Deno.cwd()}/`;
  const mods = (JSON.parse(new TextDecoder().decode(o.stdout)).modules ?? []) as { specifier: string }[];
  return mods.map((m) => m.specifier).filter((s) => s.startsWith(root)).map((s) => decodeURIComponent(s.slice(root.length)));
}

async function cmdChanged(target: string) {
  const graphs: Record<string, string[]> = {};
  const live: Record<string, { sha: string | null; exists: boolean }> = {};
  for (const fn of FUNCTIONS) {
    graphs[fn] = await graphOf(fn);
    const meta = await functionMeta(fn);
    live[fn] = { exists: meta.exists, sha: meta.exists ? buildShaOf((await buildHeader(TEST_URL, fn)).build) : null };
  }
  const memo = new Map<string, string[] | null>();
  const changedSince = (sha: string) => memo.get(sha) ?? null;
  for (const l of Object.values(live)) {
    if (!l.sha || memo.has(l.sha)) continue;
    const anc = await git("merge-base", "--is-ancestor", l.sha, target);
    memo.set(l.sha, anc.ok ? (await git("diff", "--name-only", l.sha, target)).out.split("\n").filter(Boolean) : null);
  }
  const plan = functionsToDeploy({ graphs, live, changedSince });
  for (const p of plan) console.log(`${p.fn}: ${p.deploy ? "DEPLOY" : "skip"} — ${p.reason}`);
  const out = Deno.env.get("GITHUB_OUTPUT");
  const list = plan.filter((p) => p.deploy).map((p) => p.fn).join(" ");
  if (out) await Deno.writeTextFile(out, `functions=${list}\nlive=${JSON.stringify(live)}\n`, { append: true });
}

async function cmdSnapshot(path: string) {
  const fns: Record<string, unknown> = {};
  for (const fn of FUNCTIONS) fns[fn] = { ...(await functionMeta(fn)), build: (await buildHeader(TEST_URL, fn)).build };
  const prod: Record<string, unknown> = {};
  for (const fn of FUNCTIONS) prod[fn] = await buildHeader(PROD_URL, fn);
  const snap = { at: new Date().toISOString(), project: TEST_REF, functions: fns, counts: await counts(), production: prod };
  await Deno.writeTextFile(path, JSON.stringify(snap, null, 2));
  console.log(JSON.stringify({ functions: fns, counts: snap.counts, production: prod }));
}

async function cmdVerify(beforePath: string, outDir: string) {
  const sha = env("EXPECTED_SHA");
  const deployed = (Deno.env.get("DEPLOYED_FUNCTIONS") ?? "").split(/\s+/).filter(Boolean);
  const runUrl = Deno.env.get("RUN_URL") ?? "(local)";
  const before = JSON.parse(await Deno.readTextFile(beforePath));
  const checks: Check[] = [];
  let stage = "functions";
  const versions: Record<string, unknown> = {};
  try {
    // 1, 2, 3 — active, the right project, the right commit.
    for (const fn of FUNCTIONS) {
      const m = await functionMeta(fn);
      const b = before.functions?.[fn] ?? {};
      versions[fn] = { before: b.version ?? null, after: m.version };
      const bumped = !deployed.includes(fn) || (m.version ?? 0) > (b.version ?? 0);
      checks.push(m.exists && m.status === "ACTIVE" && m.verify_jwt === true && bumped
        ? pass("1", `${fn} active`, `v${m.version} ACTIVE, verify_jwt on${deployed.includes(fn) ? ` (was v${b.version ?? "none"})` : " (not redeployed)"}`)
        : fail("1", `${fn} active`, JSON.stringify(m), !bumped ? "the deploy did not create a new version" : m.verify_jwt === false ? "verify_jwt is OFF" : "function missing or not ACTIVE"));
      const h = await buildHeader(TEST_URL, fn);
      const got = buildShaOf(h.build);
      const want = deployed.includes(fn) ? sha : buildShaOf(b.build);
      checks.push(got && got === want
        ? pass("3", `${fn} commit`, `x-agentory-build ${got.slice(0, 12)}${deployed.includes(fn) ? "" : " (unchanged, graph untouched)"}`)
        : fail("3", `${fn} commit`, `x-agentory-build = ${h.build ?? "none"}, expected ${want ?? "a stamped build"}`, "stale or unstamped deploy; redeploy through this workflow"));
    }
    checks.push(pass("2", "Correct project", `${TEST_REF} only (hard-coded; production ref refused)`));

    stage = "auth";
    for (const fn of FUNCTIONS) {
      const anon = await call(fn, { action: "list", workspace_id: TEST_WORKSPACE });
      const noKey = await fetch(`${TEST_URL}/functions/v1/${fn}`, { method: "POST", body: "{}" });
      await noKey.body?.cancel();
      checks.push(noKey.status === 401 && anon.status === 401
        ? pass("4", `${fn} JWT enforced`, "no auth → 401 at the gateway; publishable key only → 401 in the function")
        : fail("4", `${fn} JWT enforced`, `no auth ${noKey.status}, key only ${anon.status} ${JSON.stringify(anon.body).slice(0, 80)}`,
          anon.status === 404 ? "flags not in effect (function answers disabled)" : "JWT verification is off or auth is broken"));
    }

    stage = "flags";
    const s = await secrets();
    checks.push(...secretChecks(s.names, s.allowlistsExact), registryCheck());

    stage = "signed-in";
    const token = await signIn();
    if (!token) {
      for (const [id, n] of [["5", "Workspace allowlist enforced"], ["6", "Unauthorized workspace denied"], ["P", "GPT strategy_plan smoke"]]) {
        checks.push(skip(id, n, "SMOKE_USER_EMAIL / SMOKE_USER_PASSWORD not configured in the TEST environment"));
      }
    } else {
      const lp = await call("lead-pipeline", { action: PLAN_ACTION, workspace_id: OTHER_WORKSPACE, walk_id: "smoke-isolation", query: SMOKE_QUERY }, token);
      const pc = await call("provider-connections", { action: "list", workspace_id: OTHER_WORKSPACE }, token);
      checks.push(lp.status === 403 && pc.status === 403
        ? pass("5", "Workspace allowlist enforced", "a real non-allowlisted TEST workspace → 403 from both functions (before any model call)")
        : fail("5", "Workspace allowlist enforced", `lead-pipeline ${lp.status}, provider-connections ${pc.status}`, "the allowlist admits another workspace"));
      const ab = await call("lead-pipeline", { action: PLAN_ACTION, workspace_id: ABSENT_WORKSPACE, walk_id: "smoke-isolation", query: SMOKE_QUERY }, token);
      checks.push(ab.status === 403
        ? pass("6", "Unauthorized workspace denied", "unknown workspace → 403")
        : fail("6", "Unauthorized workspace denied", `HTTP ${ab.status}`, "an unknown workspace was not refused"));
      const conn = await call("provider-connections", { action: "list", workspace_id: TEST_WORKSPACE }, token);
      const apollo = ((conn.body.connections ?? []) as { provider: string; enabled?: boolean; status?: string }[]).find((c) => c.provider === "apollo");
      checks.push(conn.status === 200 && apollo && apollo.enabled !== true && apollo.status !== "connected"
        ? pass("7c", "Apollo disabled (live)", `apollo: enabled=${apollo.enabled}, status=${apollo.status}`)
        : fail("7c", "Apollo disabled (live)", `HTTP ${conn.status}, apollo enabled=${apollo?.enabled}, status=${apollo?.status ?? conn.body.error ?? "?"}`, "Apollo is enabled or connected on TEST"));

      stage = "planning";
      const plan = await call("lead-pipeline", {
        action: PLAN_ACTION, workspace_id: TEST_WORKSPACE, walk_id: `smoke-${sha.slice(0, 12)}`, query: SMOKE_QUERY, requested_count: 5, ...SMOKE_BUDGET,
      }, token);
      checks.push(...planChecks(plan.status, plan.body as PlanBody));
      await Deno.writeTextFile(`${outDir}/plan.json`, JSON.stringify({ http: plan.status, plan: plan.body.plan ?? null, interpretation: plan.body.interpretation ?? null, error: plan.body.error ?? null }, null, 2));
    }

    stage = "state";
    checks.push(...countChecks(before.counts ?? {}, await counts()));
    const prodNow: Record<string, unknown> = {};
    for (const fn of FUNCTIONS) prodNow[fn] = await buildHeader(PROD_URL, fn);
    checks.push(JSON.stringify(prodNow) === JSON.stringify(before.production)
      ? pass("10", "No production mutations", `production ${FUNCTIONS.join(", ")} unchanged: ${JSON.stringify(prodNow)}`)
      : fail("10", "No production mutations", `before ${JSON.stringify(before.production)} after ${JSON.stringify(prodNow)}`, "a production discovery function changed during this run — investigate immediately"));
    stage = "done";
  } catch (e) {
    checks.push(fail("X", `stage ${stage} errored`, String((e as Error).message ?? e).slice(0, 200), "infrastructure or credential problem; see the step log"));
  }
  const report = { sha, project: TEST_REF, run_url: runUrl, stage, deployed, versions, verdict: verdict(checks), checks, at: new Date().toISOString() };
  await Deno.writeTextFile(`${outDir}/smoke-report.json`, JSON.stringify(report, null, 2));
  const md = renderSummary({ sha, runUrl, deployed, versions, checks, stage });
  await Deno.writeTextFile(`${outDir}/smoke-summary.md`, md);
  const summary = Deno.env.get("GITHUB_STEP_SUMMARY");
  if (summary) await Deno.writeTextFile(summary, md, { append: true });
  for (const c of checks.filter((x) => x.status === "fail")) console.log(`::error title=TEST smoke ${c.id} ${c.name}::${c.detail} — likely: ${c.likely_cause}`);
  console.log(md);
  const out = Deno.env.get("GITHUB_OUTPUT");
  if (out) await Deno.writeTextFile(out, `verdict=${report.verdict}\nfailed=${checks.filter((c) => c.status === "fail").map((c) => c.id).join(",")}\nskipped=${checks.filter((c) => c.status === "skip").length}\n`, { append: true });
  if (checks.some((c) => c.status === "fail")) Deno.exit(1);
}

if (import.meta.main) {
  const [cmd, a, b] = Deno.args;
  if (cmd === "changed" && a) await cmdChanged(a);
  else if (cmd === "snapshot" && a) await cmdSnapshot(a);
  else if (cmd === "verify" && a && b) await cmdVerify(a, b);
  else { console.error("usage: test-functions-smoke.ts changed <sha> | snapshot <out.json> | verify <before.json> <outdir>"); Deno.exit(2); }
}
