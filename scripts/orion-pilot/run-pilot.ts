// RUN THE 15 ORION PILOT QUESTIONS AGAINST THE TEST `pilot-chat` ENDPOINT AND RECORD
// THE REAL RESPONSES. Requires approval (it causes small paid model calls on TEST).
//
//   deno run --allow-env --allow-net --allow-write=. scripts/orion-pilot/run-pilot.ts --dry-run
//   ORION_PILOT_APPROVED="I approve the ORION TEST pilot run on tlvnfrxzjhsjgdofwehb" \
//   ORION_PILOT_SUPABASE_URL=https://tlvnfrxzjhsjgdofwehb.supabase.co \
//   ORION_PILOT_ANON_KEY=<TEST publishable key> \
//   ORION_PILOT_OWNER_JWT=<owner access token>  ORION_PILOT_OUTSIDER_JWT=<outsider access token> \
//   [ORION_PILOT_EDITOR_JWT=… ORION_PILOT_VIEWER_JWT=…] \
//   deno run --allow-env --allow-net --allow-write=. scripts/orion-pilot/run-pilot.ts [--label evidence-on|baseline]
//
// Writes transcript-<label>.json (for score.ts) and probes-<label>.json.
// REFUSES any URL that is not the TEST project, and the production ref outright.
// Never prints tokens. Estimated model spend per full run ≈ $0.10–0.25
// (Luna understanding + Haiku reply per turn, ~22 turns); worst case ≈ $0.30.

import { PILOT_QUESTIONS } from "./questions.ts";
import type { Turn } from "./score.ts";

export const TEST_REF = "tlvnfrxzjhsjgdofwehb";
const PROD_REFS = ["ohsdatpvfdjdemstoiuj", "wqnigjhcwjxtmordrwno"];
export const PILOT_WS = "a71a0000-0000-4000-8000-0000000011a1";
export const ISOLATION_WS = "a71a0000-0000-4000-8000-0000000011a2";
export const APPROVAL = `I approve the ORION TEST pilot run on ${TEST_REF}`;

/** Threads: follow-ups run in the same conversation as the question they follow. */
export function plannedThreads(): string[][] {
  const followers = new Map<string, string[]>();
  for (const q of PILOT_QUESTIONS) for (const a of q.after ?? []) followers.set(a, [...(followers.get(a) ?? []), q.id]);
  const isFollower = new Set(PILOT_QUESTIONS.filter((q) => q.after?.length).map((q) => q.id));
  return PILOT_QUESTIONS.filter((q) => !isFollower.has(q.id)).map((q) => [q.id, ...(followers.get(q.id) ?? [])]);
}

export function targetCheck(url: string | undefined): { ok: true } | { ok: false; reason: string } {
  if (!url) return { ok: false, reason: "ORION_PILOT_SUPABASE_URL is not set" };
  if (PROD_REFS.some((r) => url.includes(r))) return { ok: false, reason: "refusing: the URL names a production / abandoned project" };
  if (!new RegExp(`^https://${TEST_REF}\\.supabase\\.co/?$`).test(url)) return { ok: false, reason: `refusing: URL must be https://${TEST_REF}.supabase.co` };
  return { ok: true };
}

async function ask(base: string, anon: string, jwt: string, workspaceId: string, message: string, conversationId: string | null) {
  const t0 = Date.now();
  const res = await fetch(`${base.replace(/\/$/, "")}/functions/v1/pilot-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ message, workspace_id: workspaceId, conversation_id: conversationId ?? undefined,
      client_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  });
  const latency_ms = Date.now() - t0;
  const body = await res.json().catch(() => null) as { conversation_id?: string; message?: { content?: string; metadata?: Record<string, unknown> } } | null;
  return { http: res.status, latency_ms, conversation_id: body?.conversation_id ?? conversationId,
    answer: String(body?.message?.content ?? ""), metadata: body?.message?.metadata ?? null };
}

if (import.meta.main) {
  const args = Deno.args;
  const label = args.includes("--label") ? args[args.indexOf("--label") + 1] : "evidence-on";
  if (args.includes("--dry-run")) {
    console.log(JSON.stringify({ target: `https://${TEST_REF}.supabase.co`, pilot_workspace: PILOT_WS, isolation_workspace: ISOLATION_WS,
      threads: plannedThreads(), role_repeats: ["Q01", "Q07", "Q11"],
      probes: ["outsider asks about Kestrel in their own workspace", "outsider calls the pilot workspace → expect 403"],
      approval_value: APPROVAL }, null, 2));
    Deno.exit(0);
  }
  const env = (k: string) => Deno.env.get(k);
  if (env("ORION_PILOT_APPROVED") !== APPROVAL) { console.error(`refused: set ORION_PILOT_APPROVED="${APPROVAL}"`); Deno.exit(3); }
  const tc = targetCheck(env("ORION_PILOT_SUPABASE_URL"));
  if (!tc.ok) { console.error(tc.reason); Deno.exit(3); }
  const base = env("ORION_PILOT_SUPABASE_URL")!, anon = env("ORION_PILOT_ANON_KEY") ?? "";
  const owner = env("ORION_PILOT_OWNER_JWT"), outsider = env("ORION_PILOT_OUTSIDER_JWT");
  if (!anon || !owner || !outsider) { console.error("refused: ORION_PILOT_ANON_KEY, ORION_PILOT_OWNER_JWT and ORION_PILOT_OUTSIDER_JWT are required"); Deno.exit(3); }

  const turns: Array<Turn & { http: number; role: string }> = [];
  for (const thread of plannedThreads()) {
    let conv: string | null = null;
    for (const id of thread) {
      const q = PILOT_QUESTIONS.find((x) => x.id === id)!;
      const r = await ask(base, anon, owner, PILOT_WS, q.question, conv);
      conv = r.conversation_id ?? conv;
      turns.push({ question_id: id, role: "owner", answer: r.answer, metadata: r.metadata, latency_ms: r.latency_ms, http: r.http });
      console.log(`${id} owner HTTP ${r.http} ${r.latency_ms} ms`);
    }
  }
  for (const [role, jwt] of [["editor", env("ORION_PILOT_EDITOR_JWT")], ["viewer", env("ORION_PILOT_VIEWER_JWT")]] as const) {
    if (!jwt) continue;
    for (const id of ["Q01", "Q07", "Q11"]) {
      const q = PILOT_QUESTIONS.find((x) => x.id === id)!;
      const r = await ask(base, anon, jwt, PILOT_WS, q.question, null);
      console.log(`${id} ${role} HTTP ${r.http} ${r.latency_ms} ms`);
      turns.push({ question_id: `${id}@${role}`, role, answer: r.answer, metadata: r.metadata, latency_ms: r.latency_ms, http: r.http });
    }
  }
  const own = await ask(base, anon, outsider, ISOLATION_WS, "Tell me about Kestrel Fabrication.", null);
  const cross = await ask(base, anon, outsider, PILOT_WS, "Which of our leads should I prioritize this week?", null);
  const probes = {
    outsider_own_workspace: { http: own.http, mentions_kestrel_facts: /dayton|second plant|machinist|fit 86/i.test(own.answer),
      cited: (own.metadata?.orion_evidence as { cited_ids?: string[] } | undefined)?.cited_ids ?? [], answer: own.answer },
    outsider_into_pilot_workspace: { http: cross.http, refused: cross.http === 403 },
  };
  Deno.writeTextFileSync(`transcript-${label}.json`, JSON.stringify(turns.filter((t) => t.role === "owner"), null, 2));
  Deno.writeTextFileSync(`transcript-${label}-roles.json`, JSON.stringify(turns.filter((t) => t.role !== "owner"), null, 2));
  Deno.writeTextFileSync(`probes-${label}.json`, JSON.stringify(probes, null, 2));
  console.log(`wrote transcript-${label}.json, transcript-${label}-roles.json, probes-${label}.json`);
  console.log(`isolation: outsider own-workspace mentions pilot facts = ${probes.outsider_own_workspace.mentions_kestrel_facts}; cross-workspace HTTP ${cross.http}`);
}
