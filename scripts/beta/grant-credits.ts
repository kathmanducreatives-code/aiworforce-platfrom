// GRANT CREDITS TO AN APPROVED BETA WORKSPACE. OPERATOR-ONLY.
//
// Credit enforcement fails closed: a workspace spends provider credits only
// after one is granted here. `credits_grant` is service-role only
// (20260929120000_lock_down_definer_rpcs.sql), so this runs with the service
// role key — read from the environment, never printed, never written.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… \
//     deno run --allow-net --allow-env scripts/beta/grant-credits.ts \
//       --workspace <uuid> --credits 50 --reason "beta: Acme (approved 2026-09-28)" [--dry-run]
//
// IDEMPOTENT. The default key is `beta-grant:<workspace>:<credits>:<UTC date>`,
// so re-running the same command the same day grants nothing further (the RPC
// replays the first transaction). Pass --key to grant deliberately again.

export const MAX_GRANT = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GrantArgs {
  workspace: string;
  credits: number;
  reason: string;
  key: string;
  dryRun: boolean;
}

/** Parse and validate. Returns the errors instead of throwing, so a test can read them. */
export function parseGrantArgs(argv: readonly string[], today: string): { args: GrantArgs | null; errors: string[] } {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
  };
  const errors: string[] = [];
  const workspace = get("--workspace") ?? "";
  if (!UUID.test(workspace)) errors.push("--workspace must be a workspace uuid");
  const raw = get("--credits") ?? "";
  const credits = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(credits) || credits <= 0) errors.push("--credits must be a positive whole number");
  else if (credits > MAX_GRANT) errors.push(`--credits above ${MAX_GRANT} is refused; grant in steps if you really mean it`);
  const reason = (get("--reason") ?? "").trim();
  if (reason.length < 3) errors.push("--reason is required (who approved it, and why)");
  const key = get("--key") ?? `beta-grant:${workspace}:${credits}:${today}`;
  if (errors.length) return { args: null, errors };
  return { args: { workspace, credits, reason, key, dryRun: argv.includes("--dry-run") }, errors };
}

async function main() {
  const { args, errors } = parseGrantArgs(Deno.args, new Date().toISOString().slice(0, 10));
  if (!args) {
    for (const e of errors) console.error(`error: ${e}`);
    Deno.exit(2);
  }
  const url = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) {
    console.error("error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment");
    Deno.exit(2);
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" };

  // The workspace must exist: a typo'd uuid would otherwise grant into a
  // balance row nobody owns.
  const ws = await fetch(`${url}/rest/v1/workspaces?id=eq.${args.workspace}&select=id,name`, { headers });
  const wsRows = ws.ok ? await ws.json() as Array<{ id: string; name?: string }> : [];
  if (!ws.ok || wsRows.length !== 1) {
    console.error(`error: workspace ${args.workspace} not found (HTTP ${ws.status})`);
    Deno.exit(3);
  }
  console.log(`workspace: ${args.workspace} (${wsRows[0].name ?? "unnamed"})`);
  console.log(`grant:     ${args.credits} credits | reason: ${args.reason} | key: ${args.key}`);
  if (args.dryRun) {
    console.log("dry run: nothing granted");
    return;
  }
  const res = await fetch(`${url}/rest/v1/rpc/credits_grant`, {
    method: "POST", headers,
    body: JSON.stringify({
      p_workspace: args.workspace, p_amount: args.credits, p_idempotency_key: args.key,
      p_reason: args.reason, p_plan_id: "beta",
    }),
  });
  const body = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok || body?.ok !== true) {
    console.error(`error: grant refused (HTTP ${res.status}): ${JSON.stringify(body?.error ?? body?.message ?? body)}`);
    Deno.exit(4);
  }
  console.log(body.replayed === true
    ? `replayed: this key was already granted — nothing added. balance ${body.balance_after}`
    : `granted: balance now ${body.balance_after}`);
}

if (import.meta.main) await main();
