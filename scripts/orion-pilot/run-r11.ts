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
type T = { n: number; prompt: string; expected_route: string };

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
  const tests = FIXTURES.tests as T[];
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
  for (const t of tests) {
    const r = await ask(base!, anon, owner, PILOT_WS, t.prompt, conversation);
    conversation = r.conversation_id ?? conversation;
    if (r.http === 429 && r.error === "model_spend_ceiling_reached") { console.log(`${t.n}: STOPPED — TEST spend ceiling reached; the rest not run`); break; }
    const f = judge(t, r);
    failures += f.length ? 1 : 0;
    console.log(`${String(t.n).padStart(2)} ${f.length ? "FAIL" : "ok  "} ${String((r.metadata?.chat_brain as Record<string, unknown> | undefined)?.route ?? "-").padEnd(11)} ${r.ms}ms ${f.join("; ")}`);
    out.push({ n: t.n, prompt: t.prompt, expected_route: t.expected_route, ...r, failures: f });
  }
  // ISOLATION: the outsider asks about the pilot workspace — must be refused with nothing read.
  const probe = await ask(base!, anon, outsider, PILOT_WS, "How many leads and signals does this workspace have?", null);
  const isolated = probe.http === 403 || probe.http === 404;
  console.log(`isolation probe: HTTP ${probe.http} ${isolated ? "ok (refused)" : "FAIL"}`);
  out.push({ probe: "outsider_on_pilot_workspace", http: probe.http, answer_chars: probe.answer.length });
  await Deno.writeTextFile("r11-transcript.json", JSON.stringify(out, null, 2));
  console.log(`\n${tests.length - failures}/${tests.length} turns passed the automatic checks; transcript: r11-transcript.json`);
  Deno.exit(failures || !isolated ? 1 : 0);
}
