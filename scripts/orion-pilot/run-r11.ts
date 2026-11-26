// R1.1 ACCEPTANCE ON TEST — the owner's 20 capability prompts against the TEST
// `pilot-chat`, in the fictional "ORION Pilot" workspace, with automatic checks
// of the routing and safety properties R1.1 promises. Causes small paid model
// calls on TEST (OpenAI, under the TEST spend ceiling): about $0.10–0.30 a run.
//
//   deno run --allow-env --allow-net --allow-read --allow-write=. scripts/orion-pilot/run-r11.ts --dry-run
//   ORION_R11_APPROVED="I approve the ORION R1.1 TEST run on tlvnfrxzjhsjgdofwehb" \
//   ORION_PILOT_SUPABASE_URL=https://tlvnfrxzjhsjgdofwehb.supabase.co \
//   ORION_PILOT_ANON_KEY=<TEST publishable key> \
//   ORION_PILOT_OWNER_JWT=… ORION_PILOT_OUTSIDER_JWT=…   (or ORION_PILOT_{OWNER,OUTSIDER}_{EMAIL,PASSWORD}) \
//   deno run --allow-env --allow-net --allow-read --allow-write=. scripts/orion-pilot/run-r11.ts
//
// Writes r11-transcript.json. REFUSES any URL but the TEST project. Never prints tokens.
// TEST has no Company Brain by design, so drafts there end at the onboarding
// gate — the check is that they are routed to ORION's draft path (never to
// delegation) and that nothing is created; draft QUALITY is checked on production
// after approval (PRODUCTION_TEST_PLAN in docs/release/2026-11-14-r1.1).
import { PILOT_WS, targetCheck, TEST_REF } from "./run-pilot.ts";

const APPROVAL = `I approve the ORION R1.1 TEST run on ${TEST_REF}`;
const FIXTURES = JSON.parse(await Deno.readTextFile(new URL("../../tests/fixtures/orion-r1-capability-tests.json", import.meta.url)));
// --suite r12: the owner's R1.2 manual acceptance prompts (verbatim) + paraphrases.
const R12 = JSON.parse(await Deno.readTextFile(new URL("../../tests/fixtures/orion-r12-acceptance.json", import.meta.url)));
type T = { n: number; prompt: string; expected_route: string; id?: string };
/** R1.2.1 probe rows carry this title (cleanup removes them by it); the foreign workspace is TEST's second pilot workspace. */
export const R121_PROBE_TITLE = "r121-binding-probe";
const R121_FOREIGN_WS = "a71a0000-0000-4000-8000-0000000011a2";
export function r12Tests(): T[] {
  return [...R12.findings.map((f: { id: string; prompt: string; expected_route: string }, i: number) => ({ n: i + 1, id: f.id, prompt: f.prompt, expected_route: f.expected_route })),
    ...R12.paraphrases.slice(0, 4).map((p: { prompt: string; expected_route: string }, i: number) => ({ n: R12.findings.length + i + 1, id: `para-${i + 1}`, prompt: p.prompt, expected_route: p.expected_route }))];
}

/** R1.2-specific checks on top of `judge`. Pure; exported for the unit test. */
export function judgeR12(t: T, r: { metadata: Record<string, unknown> | null }): string[] {
  const fail: string[] = [];
  const ev = (r.metadata?.orion_evidence ?? null) as { items?: Array<{ source_type?: string }>; signal_table_ids?: string[] } | null;
  const items = ev?.items ?? [];
  if (t.id === "F2-apify" || t.id === "para-3" || t.id === "para-4") {
    if (r.metadata?.orion_draft) fail.push("execution request carries a draft marker");
  }
  if (t.id === "F3-signals" || t.id === "F6-under30") {
    if (!items.some((i) => i.source_type === "lisa_signal")) fail.push("no LISA signal in the evidence");
    if (items.length && items.every((i) => i.source_type === "lead")) fail.push("evidence is ATLAS leads only");
    if (!ev?.signal_table_ids?.length) fail.push("no row-level signal table sent");
  }
  if (t.id === "F5-brain-audit" || t.id === "F5-content") {
    if (items.length) fail.push(`irrelevant evidence attached (${items.length} records)`);
  }
  return fail;
}

async function ask(base: string, anon: string, jwt: string, ws: string, message: string, conversation: string | null) {
  const t0 = Date.now();
  const res = await fetch(`${base.replace(/\/$/, "")}/functions/v1/pilot-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ message, workspace_id: ws, conversation_id: conversation ?? undefined, client_timezone: "UTC" }),
  });
  const body = await res.json().catch(() => null) as { conversation_id?: string; error?: string; message?: { content?: string; metadata?: Record<string, unknown> } } | null;
  return { http: res.status, ms: Date.now() - t0, conversation_id: body?.conversation_id ?? conversation,
    answer: String(body?.message?.content ?? ""), metadata: body?.message?.metadata ?? null, error: body?.error ?? null };
}

/** The checks one turn must pass. Pure; exported for the unit test. */
export function judge(t: T, r: { http: number; answer: string; metadata: Record<string, unknown> | null }): string[] {
  const fail: string[] = [];
  const cb = (r.metadata?.chat_brain ?? {}) as Record<string, unknown>;
  if (r.http !== 200) fail.push(`http ${r.http}`);
  const route = String(cb.route ?? "");
  if (t.expected_route === "orion_draft") {
    if (route !== "orion_draft") fail.push(`route ${route || "none"} (want orion_draft)`);
    if (/isn't switched on in this release/.test(r.answer) && !r.metadata?.gated) fail.push("answered by the delegation guard");
  } else if (route !== t.expected_route) fail.push(`route ${route || "none"} (want ${t.expected_route})`);
  if (/^\d+ leads? saved\./.test(r.answer.trim()) && t.expected_route !== "read") fail.push("answered by the list template");
  if (/don't have any leads saved/i.test(r.answer)) fail.push("misleading 'no leads saved' copy");
  if (/date not stated/.test(r.answer)) fail.push("'date not stated' shown for a dated signal");
  if (r.metadata?.orion_draft && (r.metadata.orion_draft as Record<string, unknown>).sent !== false) fail.push("draft not marked unsent");
  return fail;
}

if (import.meta.main) {
  const suite = Deno.args.includes("--suite") ? Deno.args[Deno.args.indexOf("--suite") + 1] : "r11";
  const all = suite === "r12" ? r12Tests() : FIXTURES.tests as T[];
  // FOCUSED RETEST: --only <id,…> keeps those turns in their suite order (so each
  // keeps the turns it followed), --repeat <n> runs them in n fresh conversations.
  // The assertions are the suite's own, unchanged.
  const only = Deno.args.includes("--only") ? Deno.args[Deno.args.indexOf("--only") + 1].split(",").map((x) => x.trim()) : null;
  const repeat = Deno.args.includes("--repeat") ? Math.max(1, Math.min(5, Number(Deno.args[Deno.args.indexOf("--repeat") + 1]) || 1)) : 1;
  if (only && only.some((id) => !all.some((t) => (t.id ?? String(t.n)) === id))) { console.error(`refusing: --only names an unknown test (${only.join(",")})`); Deno.exit(2); }
  const tests = only ? all.filter((t) => only.includes(t.id ?? String(t.n))) : all;
  if (Deno.args.includes("--dry-run")) {
    for (const t of tests) console.log(`${String(t.n).padStart(2)}  → ${t.expected_route.padEnd(11)} ${t.prompt.slice(0, 90)}`);
    console.log(`\n${tests.length} turns in one conversation + 1 isolation probe. Not run (dry run).`);
    Deno.exit(0);
  }
  if (Deno.env.get("ORION_R11_APPROVED") !== APPROVAL) { console.error(`refusing: set ORION_R11_APPROVED="${APPROVAL}"`); Deno.exit(2); }
  const base = Deno.env.get("ORION_PILOT_SUPABASE_URL");
  const target = targetCheck(base);
  if (!target.ok) { console.error(target.reason); Deno.exit(2); }
  const anon = Deno.env.get("ORION_PILOT_ANON_KEY") ?? "";
  // A token from the environment, or a TEST sign-in with email + password from the
  // environment (your shell only; never printed, never written).
  async function token(who: "OWNER" | "OUTSIDER"): Promise<string> {
    const jwt = Deno.env.get(`ORION_PILOT_${who}_JWT`);
    if (jwt) return jwt;
    const email = Deno.env.get(`ORION_PILOT_${who}_EMAIL`), password = Deno.env.get(`ORION_PILOT_${who}_PASSWORD`);
    if (!email || !password) return "";
    const res = await fetch(`${base!.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: anon },
      body: JSON.stringify({ email, password }) });
    const body = await res.json().catch(() => null) as { access_token?: string } | null;
    if (!res.ok || !body?.access_token) { console.error(`refusing: TEST sign-in failed for the ${who.toLowerCase()} account (HTTP ${res.status})`); Deno.exit(2); }
    return body.access_token;
  }
  const owner = anon ? await token("OWNER") : "", outsider = anon ? await token("OUTSIDER") : "";
  if (!anon || !owner || !outsider) { console.error("refusing: the TEST anon key and owner + outsider credentials (JWT, or EMAIL + PASSWORD) are required"); Deno.exit(2); }

  const out: unknown[] = [];
  let conversation: string | null = null, failures = 0;
  const runs = Array.from({ length: repeat }, (_, i) => tests.map((t) => ({ t, fresh: i > 0 && t === tests[0] }))).flat();
  for (const { t, fresh } of runs) {
    if (fresh) conversation = null;
    const r = await ask(base!, anon, owner, PILOT_WS, t.prompt, conversation);
    conversation = r.conversation_id ?? conversation;
    if (r.http === 429 && r.error === "model_spend_ceiling_reached") { console.log(`${t.n}: STOPPED — TEST spend ceiling reached; the rest not run`); break; }
    const f = [...judge(t, r), ...(suite === "r12" ? judgeR12(t, r) : [])];
    failures += f.length ? 1 : 0;
    console.log(`${String(t.n).padStart(2)} ${f.length ? "FAIL" : "ok  "} ${String((r.metadata?.chat_brain as Record<string, unknown> | undefined)?.route ?? "-").padEnd(11)} ${r.ms}ms ${f.join("; ")}`);
    out.push({ n: t.n, prompt: t.prompt, expected_route: t.expected_route, ...r, failures: f });
  }
  // R1.2.1: an APP-CREATED conversation (inserted by the browser, as the app's
  // "New chat" does) is bound to its workspace on first use; the database refuses
  // a conversation naming a workspace the user does not belong to. One model call.
  let bindingOk = true;
  if (suite === "r11" || Deno.args.includes("--binding-probe")) {
    const rest = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`${base!.replace(/\/$/, "")}/rest/v1/${path}`, { method,
        headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${owner}`, Prefer: "return=representation" },
        body: body ? JSON.stringify(body) : undefined });
      return { http: res.status, rows: (await res.json().catch(() => null)) as Array<{ id: string; workspace_id: string | null }> | null };
    };
    const me = JSON.parse(atob(owner.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub as string;
    const legacy = await rest("POST", "conversations", { user_id: me, agent_slug: "pilot", title: R121_PROBE_TITLE, status: "active" });
    const legacyId = legacy.rows?.[0]?.id ?? null;
    const first = legacyId ? await ask(base!, anon, owner, PILOT_WS, "In one sentence: what is this workspace for?", legacyId) : null;
    const after = legacyId ? await rest("GET", `conversations?id=eq.${legacyId}&select=id,workspace_id`) : null;
    const bound = after?.rows?.[0]?.workspace_id === PILOT_WS;
    const modern = await rest("POST", "conversations", { user_id: me, workspace_id: PILOT_WS, agent_slug: "pilot", title: R121_PROBE_TITLE, status: "active" });
    const foreign = await rest("POST", "conversations", { user_id: me, workspace_id: R121_FOREIGN_WS, agent_slug: "pilot", title: R121_PROBE_TITLE, status: "active" });
    const checks = {
      app_created_chat_accepted: first?.http === 200,
      bound_on_first_use: bound,
      new_client_insert_with_workspace: modern.http === 201,
      foreign_workspace_insert_refused: foreign.http >= 400,
    };
    bindingOk = Object.values(checks).every(Boolean);
    console.log(`R1.2.1 workspace binding: ${bindingOk ? "ok" : "FAIL"} ${JSON.stringify(checks)}`);
    out.push({ probe: "r121_workspace_binding", checks, http: { legacy: legacy.http, first: first?.http ?? null, modern: modern.http, foreign: foreign.http } });
  }

  // ISOLATION: the outsider asks about the pilot workspace — must be refused with nothing read.
  const probe = await ask(base!, anon, outsider, PILOT_WS, "How many leads and signals does this workspace have?", null);
  const isolated = probe.http === 403 || probe.http === 404;
  console.log(`isolation probe: HTTP ${probe.http} ${isolated ? "ok (refused)" : "FAIL"}`);
  out.push({ probe: "outsider_on_pilot_workspace", http: probe.http, answer_chars: probe.answer.length });
  await Deno.writeTextFile(`${suite}-transcript.json`, JSON.stringify(out, null, 2));
  console.log(`\n${runs.length - failures}/${runs.length} turns passed the automatic checks; transcript: ${suite}-transcript.json`);
  Deno.exit(failures || !isolated || !bindingOk ? 1 : 0);
}
