// SIGNED PLAN APPROVAL — strategy_run executes exactly what strategy_plan produced.
//
// Stage 3 of Option E (architecture review C2). strategy_run used to call GPT again and
// compare hashes, so every model variance between plan and run was a refused run (409) or
// a truncated interpretation (422), and the run paid for the interpretation twice.
//
// strategy_plan now returns `approval_token`: the inputs that produced the plan — the
// model's proposal, the Company Brain context used, the strategy advisor's pick, the
// request, ceilings and provider choices — plus the plan hash, the workspace, the planner
// user, and an expiry, MAC'd with HMAC-SHA-256. strategy_run verifies the MAC, the expiry,
// the workspace and that the approval names the same hash, then RECOMPILES the signed
// proposal deterministically (no model call) and re-plans; the recomputed plan must have
// the approved hash (Stage 2 binds its meaning, ceilings and workspace) or nothing runs.
//
// The client is never trusted: a token it altered fails the MAC; a token for another
// workspace, an expired one, or one for a different hash is refused before any provider
// call. The key is derived from the function's existing service-role key (HMAC with a
// fixed label), so there is no new secret and nothing is stored — no migration.

export const PLAN_TOKEN_VERSION = "plan-token-v1" as const;
/** How long an approval stays valid after planning. */
export const PLAN_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_LABEL = "agentory/lead-pipeline/plan-approval-token/v1";

export interface PlanReplay {
  /** The model's mission proposal, exactly as the interpretation produced it. */
  proposal: unknown;
  /** The Company Brain planning context used (null when there was none). */
  brain: { status: string; fields: string[]; context: unknown | null };
  /** The strategy advisor's pick (null: deterministic choice only, or the user named a strategy). */
  advice: { proposed: string | null; rationale: string; model: string | null; error: string | null } | null;
}

export interface PlanTokenPayload {
  v: typeof PLAN_TOKEN_VERSION;
  workspaceId: string;
  plannedBy: string;
  issuedAt: number;
  expiresAt: number;
  planHash: string;
  query: string;
  requestedCount: number | null;
  replay: PlanReplay;
}

export interface PlanSigner {
  sign(p: Omit<PlanTokenPayload, "v" | "issuedAt" | "expiresAt">, now?: Date): Promise<string>;
  verify(token: string, expect: { workspaceId: string; planHash: string }, now?: Date): Promise<{ ok: true; payload: PlanTokenPayload } | { ok: false; reason: string }>;
}

const te = new TextEncoder();
const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

const buf = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer;

async function hmacKey(raw: Uint8Array): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", buf(raw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

/**
 * A signer keyed from a server secret (the service-role key). The secret itself never
 * signs a token: the token key is HMAC(secret, label), so it is useless for anything else.
 */
export async function planSigner(serverSecret: string): Promise<PlanSigner> {
  if (!serverSecret || serverSecret.length < 16) throw new Error("plan signer: missing server secret");
  const derived = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(te.encode(serverSecret)), buf(te.encode(KEY_LABEL))));
  const key = await hmacKey(derived);
  const mac = async (body: string) => new Uint8Array(await crypto.subtle.sign("HMAC", key, buf(te.encode(body))));
  return {
    async sign(p, now = new Date()) {
      const payload: PlanTokenPayload = { v: PLAN_TOKEN_VERSION, issuedAt: now.getTime(), expiresAt: now.getTime() + PLAN_TOKEN_TTL_MS, ...p };
      const body = b64u(te.encode(JSON.stringify(payload)));
      return `${body}.${b64u(await mac(body))}`;
    },
    async verify(token, expect, now = new Date()) {
      const [body, sig, extra] = String(token ?? "").split(".");
      if (!body || !sig || extra !== undefined) return { ok: false, reason: "malformed approval token" };
      let given: Uint8Array;
      try { given = unb64u(sig); } catch { return { ok: false, reason: "malformed approval token" }; }
      if (!equalBytes(given, await mac(body))) return { ok: false, reason: "approval token signature does not verify" };
      let payload: PlanTokenPayload;
      try { payload = JSON.parse(new TextDecoder().decode(unb64u(body))); } catch { return { ok: false, reason: "malformed approval token" }; }
      if (payload.v !== PLAN_TOKEN_VERSION) return { ok: false, reason: "approval token version is not supported; re-plan" };
      if (now.getTime() > payload.expiresAt) return { ok: false, reason: "approval token expired; re-plan" };
      if (payload.workspaceId !== expect.workspaceId) return { ok: false, reason: "approval token is for another workspace" };
      if (payload.planHash !== expect.planHash) return { ok: false, reason: "the approval names a different plan than the token" };
      return { ok: true, payload };
    },
  };
}
