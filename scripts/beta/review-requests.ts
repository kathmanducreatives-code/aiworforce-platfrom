// REVIEW BETA ACCESS REQUESTS. OPERATOR-ONLY.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… deno run --allow-net --allow-env \
//     scripts/beta/review-requests.ts list [--status pending|approved|declined|all]
//     scripts/beta/review-requests.ts approve <request-id> --credits 50 [--note "…"] [--dry-run]
//     scripts/beta/review-requests.ts decline <request-id> [--note "…"]
//
// APPROVE = GRANT, THEN RECORD. The grant's idempotency key is
// `beta-request:<request-id>`, so however often approve is re-run for one
// request it adds credits once; the request is then marked approved only while
// it is still pending. A crash between the two steps is repaired by running
// approve again: the grant replays, the mark applies.

import { grantCredits, MAX_GRANT, rest, serviceEnv, UUID, type ServiceEnv } from "./betaAdmin.ts";

export type ReviewCommand =
  | { kind: "list"; status: "pending" | "approved" | "declined" | "all" }
  | { kind: "approve"; id: string; credits: number; note: string | null; dryRun: boolean }
  | { kind: "decline"; id: string; note: string | null };

/** Parse and validate before any network call. */
export function parseReviewArgs(argv: readonly string[]): { cmd: ReviewCommand | null; errors: string[] } {
  const flag = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
  };
  const note = (flag("--note") ?? "").trim() || null;
  const errors: string[] = [];
  const [verb, id] = argv;
  if (note && note.length > 1000) errors.push("--note is limited to 1000 characters");
  if (verb === "list") {
    const status = (flag("--status") ?? "pending") as "pending" | "approved" | "declined" | "all";
    if (!["pending", "approved", "declined", "all"].includes(status)) errors.push("--status must be pending, approved, declined or all");
    return errors.length ? { cmd: null, errors } : { cmd: { kind: "list", status }, errors };
  }
  if (verb !== "approve" && verb !== "decline") {
    return { cmd: null, errors: ["usage: review-requests.ts <list|approve|decline> …"] };
  }
  if (!id || !UUID.test(id)) errors.push(`${verb} needs a request id (uuid)`);
  if (verb === "decline") return errors.length ? { cmd: null, errors } : { cmd: { kind: "decline", id: id!, note }, errors };
  const raw = flag("--credits") ?? "";
  const credits = Number(raw);
  if (!/^\d+$/.test(raw) || credits <= 0) errors.push("--credits must be a positive whole number");
  else if (credits > MAX_GRANT) errors.push(`--credits above ${MAX_GRANT} is refused; grant in steps if you really mean it`);
  if (errors.length) return { cmd: null, errors };
  return { cmd: { kind: "approve", id: id!, credits, note, dryRun: argv.includes("--dry-run") }, errors };
}

/** The grant key for a request: one request, one grant, however often approve runs. */
export const requestGrantKey = (id: string) => `beta-request:${id}`;

interface RequestRow {
  id: string; workspace_id: string; requested_by: string; note: string | null;
  status: string; credits_granted: number | null; created_at: string; decided_at: string | null;
}

async function readRequest(env: ServiceEnv, id: string): Promise<RequestRow | null> {
  const r = await rest(env, `beta_access_requests?id=eq.${id}&select=*`);
  const rows = Array.isArray(r.body) ? r.body as RequestRow[] : [];
  return r.ok && rows.length === 1 ? rows[0] : null;
}

/** Mark a decision — only while the request is still pending. Returns how many rows changed. */
async function decide(env: ServiceEnv, id: string, patch: Record<string, unknown>): Promise<number> {
  const r = await rest(env, `beta_access_requests?id=eq.${id}&status=eq.pending`, {
    method: "PATCH", prefer: "return=representation",
    body: { ...patch, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  });
  if (!r.ok) throw new Error(`decision write failed (HTTP ${r.status}): ${JSON.stringify(r.body)}`);
  return Array.isArray(r.body) ? r.body.length : 0;
}

async function main() {
  const { cmd, errors } = parseReviewArgs(Deno.args);
  if (!cmd) {
    for (const e of errors) console.error(`error: ${e}`);
    Deno.exit(2);
  }
  const { env, error } = serviceEnv();
  if (!env) {
    console.error(`error: ${error}`);
    Deno.exit(2);
  }

  if (cmd.kind === "list") {
    const filter = cmd.status === "all" ? "" : `status=eq.${cmd.status}&`;
    const r = await rest(env, `beta_access_requests?${filter}select=id,workspace_id,status,note,credits_granted,created_at,decided_at,workspaces(name)&order=created_at.asc`);
    if (!r.ok) {
      console.error(`error: could not list requests (HTTP ${r.status})`);
      Deno.exit(3);
    }
    const rows = r.body as Array<RequestRow & { workspaces?: { name?: string } | null }>;
    if (rows.length === 0) console.log(`no ${cmd.status === "all" ? "" : cmd.status + " "}requests`);
    for (const x of rows) {
      console.log(`${x.id}  ${x.status.padEnd(8)}  ${x.created_at.slice(0, 16)}  ${x.workspace_id} (${x.workspaces?.name ?? "unnamed"})` +
        `${x.credits_granted ? `  +${x.credits_granted}` : ""}${x.note ? `\n    “${x.note.slice(0, 200)}”` : ""}`);
    }
    return;
  }

  const req = await readRequest(env, cmd.id);
  if (!req) {
    console.error(`error: request ${cmd.id} not found`);
    Deno.exit(3);
  }
  console.log(`request:   ${req.id} (${req.status}) for workspace ${req.workspace_id}`);

  if (cmd.kind === "decline") {
    if (req.status !== "pending") {
      console.log(`already ${req.status} — nothing changed`);
      return;
    }
    const n = await decide(env, req.id, { status: "declined", decision_note: cmd.note });
    console.log(n === 1 ? "declined" : "not changed: it was decided concurrently");
    return;
  }

  if (req.status === "declined") {
    console.error("error: this request was declined; ask the workspace to file a new one");
    Deno.exit(4);
  }
  console.log(`grant:     ${cmd.credits} credits | key: ${requestGrantKey(req.id)}`);
  if (cmd.dryRun) {
    console.log("dry run: nothing granted");
    return;
  }
  const g = await grantCredits(env, {
    workspace: req.workspace_id, credits: cmd.credits, key: requestGrantKey(req.id),
    reason: `beta request ${req.id}${cmd.note ? `: ${cmd.note}` : ""}`,
  });
  if (!g.ok) {
    console.error(`error: grant refused (${g.error}) — the request is still pending`);
    Deno.exit(4);
  }
  console.log(g.replayed ? `grant replayed (already granted); balance ${g.balance_after}` : `granted; balance now ${g.balance_after}`);
  if (req.status === "approved") {
    console.log("request was already approved — nothing else changed");
    return;
  }
  const n = await decide(env, req.id, { status: "approved", credits_granted: cmd.credits, decision_note: cmd.note });
  console.log(n === 1 ? "approved" : "not marked: it was decided concurrently (the grant stands, keyed to this request)");
}

if (import.meta.main) await main();
