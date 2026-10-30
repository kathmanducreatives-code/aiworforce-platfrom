// THE CANARY SESSION'S APPROVAL CONTRACT. Pure; reads files.
//
// One approval covers one bounded session — verify, compile, validate, kickoff,
// worker, reconcile, report — and ONLY a plan that satisfies the approved
// contract exactly (docs/launch/proposals/canary-session-contract.json). A
// generated plan that needs anything else — another actor, more starts or
// units, a higher maximum, more companies, another mission, any other SQL —
// stops before the kickoff and needs a separate approval.
//
//   deno run --allow-read scripts/test-project/canary/session-contract.ts contract <contract.json> [--now <iso>]
//   deno run --allow-read scripts/test-project/canary/session-contract.ts ids <contract sha256>
//   deno run --allow-read --allow-write=<dir> scripts/test-project/canary/session-contract.ts kickoff <contract.json> <kickoff dir> <contract sha256> [--json <file>]
//
// SINGLE USE: the session's queue and plan ids are derived from the contract's
// sha256, so `lead_mission_queue`'s primary key refuses a second kickoff under
// the same contract — atomically, in the database, whatever the workflow does.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const CONTRACT_PROJECT_REF = "tlvnfrxzjhsjgdofwehb";
export const CONTRACT_WORKSPACE_ID = "40e2512f-09b6-433e-97fe-f9999a1f1897";
/** The reviewed catalog's actors and their approved per-start maxima; a contract may only narrow them. */
export const APPROVED_ACTORS: Readonly<Record<string, { template: string; max_microusd: number; max_units: number; units_field: string }>> = {
  "apify:harvestapi~linkedin-job-search": { template: "jobs", max_microusd: 4000, max_units: 3, units_field: "max_fields.maxItems" },
  "apify:harvestapi~linkedin-company": { template: "details", max_microusd: 4050, max_units: 1, units_field: "max_array_items.companies" },
  "apify:atomus~linkedin-company-scraper": { template: "atomus", max_microusd: 10550, max_units: 3, units_field: "max_array_items.companies" },
};
const CAPS = { provider: 200_000, model: 50_000, attempt: 250_000, budget: 3_000_000, perCall: 12_480 };
/** Worker model calls a session makes before any company: the execution plan and the pool evaluation (canary 2's ledger). */
export const WORKER_FIXED_CALLS = 2;
const KICKOFF_STATEMENTS: Readonly<Record<string, RegExp>> = {
  "insert task_plans": /^insert into public\.task_plans \(/,
  "insert lead_execution_calls": /^insert into public\.lead_execution_calls \(/,
  "insert lead_mission_queue": /^insert into public\.lead_mission_queue \(/,
  "select authorize_discovery_smoke": /^select public\.authorize_discovery_smoke\(/,
};

export interface Check { id: string; what: string; ok: boolean; observed: string }
const mk = (out: Check[]) => (id: string, what: string, ok: boolean, observed: unknown) =>
  out.push({ id, what, ok, observed: typeof observed === "string" ? observed : JSON.stringify(observed) });

/** The contract itself: well-formed, unexpired, this project, never wider than the reviewed caps. */
export function contractChecks(c: Json, now: Date): Check[] {
  const out: Check[] = [];
  const add = mk(out);
  add("A01", "a version-1 agentory-canary-session contract", c?.contract === "agentory-canary-session" && c?.version === 1 && typeof c?.id === "string" && c.id.length > 0, [c?.contract, c?.version, c?.id]);
  add("A02", "the isolated project and the canary workspace only", c?.project_ref === CONTRACT_PROJECT_REF && c?.workspace_id === CONTRACT_WORKSPACE_ID, [c?.project_ref, c?.workspace_id]);
  const exp = Date.parse(c?.expires_at ?? "");
  add("A03", "not expired", Number.isFinite(exp) && exp > now.getTime(), c?.expires_at ?? null);
  const m = c?.mission ?? {};
  add("A04", "one canary_funding mission for exactly one company", m.scenario === "canary_funding" && m.requested_count === 1 &&
    m.max_qualified_companies === 1 && typeof m.instruction === "string" && m.instruction.length > 0, [m.scenario, m.requested_count, m.max_qualified_companies]);
  const actors = Object.entries((c?.actors ?? {}) as Record<string, Json>);
  add("A05", "only reviewed actors, each at most one start and within its reviewed units and maximum", actors.length > 0 &&
    actors.every(([a, v]) => APPROVED_ACTORS[a] && v.max_starts === 1 && Number.isInteger(v.max_units) && v.max_units >= 1 &&
      v.max_units <= APPROVED_ACTORS[a].max_units && Number.isInteger(v.max_microusd) && v.max_microusd > 0 && v.max_microusd <= APPROVED_ACTORS[a].max_microusd),
    Object.fromEntries(actors.map(([a, v]) => [a, [v.max_starts, v.max_units, v.max_microusd]])));
  const s = c?.spending ?? {};
  const provider = actors.reduce((a, [, v]) => a + Number(v.max_microusd), 0);
  const model = Number(c?.model?.worker_attempts) * Number(c?.model?.max_microusd_per_call);
  const compile = Number(c?.model?.compile_calls) * Number(c?.model?.max_microusd_per_call);
  add("A06", "the model is Luna, at most 2 compile calls and 4 worker attempts, each within the reviewed bound",
    c?.model?.actor === "openai:gpt-5.6-luna" && c.model.compile_calls <= 2 && c.model.worker_attempts <= 4 && c.model.max_microusd_per_call <= CAPS.perCall, c?.model);
  add("A07", "spending adds up and never exceeds the existing caps ($0.20 provider, $0.05 model, $0.25 attempt, $3 canary)",
    s.max_provider_microusd === provider && s.max_worker_model_microusd === model && s.max_compile_microusd === compile &&
      s.max_session_microusd === provider + model + compile && provider <= CAPS.provider && model <= CAPS.model &&
      provider + model <= CAPS.attempt && s.provider_cap_microusd === CAPS.provider && s.model_cap_microusd === CAPS.model &&
      s.attempt_cap_microusd === CAPS.attempt && s.canary_budget_microusd === CAPS.budget, { provider, model, compile, declared: s.max_session_microusd });
  const stmts = (c?.database?.kickoff_statements ?? []) as string[];
  add("A08", "kickoff SQL limited to the four reviewed statements; no migration", stmts.length > 0 && stmts.every((x) => x in KICKOFF_STATEMENTS) &&
    c?.database?.migrations === "none", stmts);
  add("A09", "automatic execution is stated explicitly", typeof c?.auto_execute === "boolean", c?.auto_execute);
  // ── THE CONTRACT MUST COVER ITS OWN POOL (canary session 2) ─────────────────
  //
  // Contract 2 discovered 3 companies (jobs max_units 3) but allowed company
  // details for 1 and 4 worker model attempts — the plan and the pool
  // evaluation take 2, so the third company's evaluation was refused (HTTP
  // error) and two companies were never enriched. Neither limit is a reason to
  // spend more: a contract whose limits cannot finish the pool it buys is
  // refused, and the pool is narrowed or the limits re-approved.
  const pool = Number(c?.actors?.["apify:harvestapi~linkedin-job-search"]?.max_units ?? 0);
  const details = Number(c?.actors?.["apify:harvestapi~linkedin-company"]?.max_units ?? 0);
  const needed = WORKER_FIXED_CALLS + pool;
  add("A10", `worker model attempts cover the plan, the pool evaluation and one evaluation per discovered company (${WORKER_FIXED_CALLS} + pool)`,
    Number(c?.model?.worker_attempts) >= needed, { worker_attempts: c?.model?.worker_attempts ?? null, pool, needed });
  add("A11", "company details can read every discovered company (its headquarters is a hard claim only the record proves)",
    pool >= 1 && details >= pool, { pool, details });
  return out;
}

/** A deterministic v4-shaped uuid from the contract hash: the database's single-use key. */
export async function sessionIds(contractSha: string): Promise<{ queue_id: string; plan_id: string }> {
  if (!/^[0-9a-f]{64}$/.test(contractSha)) throw new Error("contract sha256 must be 64 hex");
  const id = async (salt: string) => {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${contractSha}`))).slice(0, 16);
    d[6] = (d[6] & 0x0f) | 0x40; d[8] = (d[8] & 0x3f) | 0x80;
    const h = [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  return { queue_id: await id("agentory-canary-session-queue"), plan_id: await id("agentory-canary-session-plan") };
}

const get = (o: Json, path: string) => path.split(".").reduce((a: Json | undefined, k) => a?.[k], o);

/** The generated kickoff, against the approved contract. Any FAIL: no kickoff, a separate approval is needed. */
export function kickoffWithinContract(k: Json, sql: string, c: Json, ids: { queue_id: string; plan_id: string }): Check[] {
  const out: Check[] = [];
  const add = mk(out);
  const req = k?.request ?? {}, mission = k?.compiled_mission ?? {}, auth = k?.authorization ?? {};
  const quotes = (auth.quotes ?? {}) as Record<string, Json>;
  const limits = (auth.actor_limits ?? {}) as Record<string, number>;
  const actors = (c.actors ?? {}) as Record<string, Json>;
  add("S01", "the contract's mission, verbatim", req.instruction === c.mission.instruction, req.instruction);
  add("S02", "the contract's company count", req.requested_lead_count === c.mission.requested_count && mission.requested_count === c.mission.requested_count &&
    c.mission.requested_count <= c.mission.max_qualified_companies, [req.requested_lead_count, mission.requested_count]);
  const signals = ((mission.required_signals ?? []) as Json[]).map((s) => [s.event ?? s.type, s.timeframe_days]);
  add("S03", "the contract's interpretation: signals and windows", JSON.stringify(signals) === JSON.stringify(c.mission.signals), signals);
  const interp = (k.interpretation ?? []) as Json[];
  add("S04", "interpretation D1–D7 all PASS", interp.length === 7 && interp.every((v) => v.result === "PASS"), interp.map((v) => `${v.id}:${v.result}`));
  add("S05", "assumed defaults: exactly the contract's, disclosed", (k.disclosures ?? []).length === c.mission.assumed_defaults.length, k.disclosures ?? []);
  add("S06", "actors: exactly the contract's, none added", JSON.stringify(Object.keys(limits).sort()) === JSON.stringify(Object.keys(actors).sort()), Object.keys(limits));
  add("S07", "starts: within each actor's contract maximum", Object.entries(limits).every(([a, n]) => Number.isInteger(n) && n >= 0 && n <= (actors[a]?.max_starts ?? 0)), limits);
  const templateOf = (a: string) => Object.values(quotes).find((q) => (q.allowed_actors ?? []).includes(a) && (q.allowed_kinds ?? []).includes("provider"));
  add("S08", "per-start maxima: within the contract", Object.keys(actors).every((a) => Number(templateOf(a)?.maximum_microusd ?? Infinity) <= actors[a].max_microusd),
    Object.fromEntries(Object.keys(actors).map((a) => [a, templateOf(a)?.maximum_microusd ?? null])));
  add("S09", "output units: within the contract (the gate pins them on every start)", Object.keys(actors).every((a) => {
    const units = Number(get(templateOf(a)?.request_limits ?? {}, APPROVED_ACTORS[a].units_field));
    return Number.isInteger(units) && units >= 1 && units <= actors[a].max_units;
  }), Object.fromEntries(Object.keys(actors).map((a) => [a, get(templateOf(a)?.request_limits ?? {}, APPROVED_ACTORS[a]?.units_field ?? "")])));
  const provider = Object.entries(limits).reduce((s, [a, n]) => s + n * Number(templateOf(a)?.maximum_microusd ?? Infinity), 0);
  add("S10", "worst-case provider spend within the contract", provider <= c.spending.max_provider_microusd, provider);
  add("S11", "the model template within the contract", Number(quotes.model?.maximum_microusd ?? Infinity) <= c.model.max_microusd_per_call &&
    JSON.stringify(quotes.model?.allowed_actors) === JSON.stringify([c.model.actor]), quotes.model?.allowed_actors);
  add("S12", "templates: only the contract's actors, reads and the model — no Pvalyou or other kind",
    Object.values(quotes).every((q) => (q.allowed_actors ?? []).every((a: string) => a in actors || a === c.model.actor)) &&
      !/pvalyou/i.test(JSON.stringify(auth)), Object.keys(quotes));
  const ledger = (k.compile_ledger_rows ?? []) as Json[];
  const compileMicro = Math.ceil(ledger.reduce((s, r) => s + Number(r.estimated_cost_usd ?? 0), 0) * 1e6);
  add("S13", "the compile: within its calls and its reservation", ledger.length <= c.model.compile_calls && compileMicro <= c.spending.max_compile_microusd,
    { calls: ledger.length, microusd: compileMicro });
  const statements = sql.split("\n").filter((l) => l.trim() && !l.startsWith("--") && !/^\s/.test(l) && l !== "begin;" && l !== "commit;");
  const allowed = (c.database.kickoff_statements as string[]).map((n) => KICKOFF_STATEMENTS[n]);
  add("S14", "SQL: only the contract's statements", statements.length > 0 && statements.every((l) => allowed.some((r) => r.test(l))),
    statements.filter((l) => !allowed.some((r) => r.test(l))).slice(0, 3));
  add("S15", "the single-use ids derived from this contract", sql.includes(`values ('${ids.queue_id}', '${c.workspace_id}'`) && req.plan_id === ids.plan_id,
    [ids.queue_id, req.plan_id]);
  add("S16", "the contract's workspace and project", req.workspace_id === c.workspace_id && sql.includes(`for TEST project ${c.project_ref}.`), req.workspace_id);
  add("S17", "the mission's own run budget within the provider cap", Number(req.run_budget?.provider_usd) * 1e6 <= c.spending.provider_cap_microusd, req.run_budget);
  // The engine asks for `max_candidates` jobs; the gate refuses more than the pin.
  add("S18", "the engine's candidate pool equals the job units the contract and the gate allow",
    Number(req.run_budget?.max_candidates) === Number(get(templateOf("apify:harvestapi~linkedin-job-search")?.request_limits ?? {}, "max_fields.maxItems")) &&
      Number(req.run_budget?.max_candidates) <= Number(actors["apify:harvestapi~linkedin-job-search"]?.max_units ?? 0),
    { max_candidates: req.run_budget?.max_candidates ?? null, contract_units: actors["apify:harvestapi~linkedin-job-search"]?.max_units ?? null });
  return out;
}

if (import.meta.main) {
  const [cmd, ...rest] = Deno.args;
  const flag = (n: string) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
  const print = (checks: Check[]) => { for (const x of checks) console.log(`${x.ok ? "PASS" : "FAIL"}  ${x.id} ${x.what}: ${x.observed}`); };
  if (cmd === "contract") {
    const checks = contractChecks(JSON.parse(Deno.readTextFileSync(rest[0])), new Date(flag("--now") ?? Date.now()));
    print(checks);
    Deno.exit(checks.every((x) => x.ok) ? 0 : 1);
  } else if (cmd === "ids") {
    const ids = await sessionIds(rest[0]);
    console.log(`${ids.queue_id} ${ids.plan_id}`);
  } else if (cmd === "kickoff") {
    const [contractFile, dir, sha] = rest;
    const c = JSON.parse(Deno.readTextFileSync(contractFile));
    const checks = kickoffWithinContract(JSON.parse(Deno.readTextFileSync(`${dir}/kickoff.json`)), Deno.readTextFileSync(`${dir}/kickoff.sql`), c, await sessionIds(sha));
    print(checks);
    const ok = checks.every((x) => x.ok);
    const json = flag("--json");
    if (json) Deno.writeTextFileSync(json, JSON.stringify({ ok, checks }, null, 2) + "\n");
    console.log(ok ? "WITHIN THE CONTRACT" : "OUTSIDE THE CONTRACT — no kickoff; this plan needs a separate approval");
    Deno.exit(ok ? 0 : 1);
  } else {
    console.error("usage: session-contract.ts contract|ids|kickoff …"); Deno.exit(2);
  }
}
