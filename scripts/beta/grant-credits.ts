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

import { grantCredits, MAX_GRANT, rest, serviceEnv, UUID } from "./betaAdmin.ts";
export { MAX_GRANT };

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
  const { env, error } = serviceEnv();
  if (!env) {
    console.error(`error: ${error}`);
    Deno.exit(2);
  }
  // The workspace must exist: a typo'd uuid would otherwise grant into a
  // balance row nobody owns.
  const ws = await rest(env, `workspaces?id=eq.${args.workspace}&select=id,name`);
  const rows = Array.isArray(ws.body) ? ws.body as Array<{ id: string; name?: string }> : [];
  if (!ws.ok || rows.length !== 1) {
    console.error(`error: workspace ${args.workspace} not found (HTTP ${ws.status})`);
    Deno.exit(3);
  }
  console.log(`workspace: ${args.workspace} (${rows[0].name ?? "unnamed"})`);
  console.log(`grant:     ${args.credits} credits | reason: ${args.reason} | key: ${args.key}`);
  if (args.dryRun) {
    console.log("dry run: nothing granted");
    return;
  }
  const g = await grantCredits(env, { workspace: args.workspace, credits: args.credits, key: args.key, reason: args.reason });
  if (!g.ok) {
    console.error(`error: grant refused (${g.error})`);
    Deno.exit(4);
  }
  console.log(g.replayed
    ? `replayed: this key was already granted — nothing added. balance ${g.balance_after}`
    : `granted: balance now ${g.balance_after}`);
}

if (import.meta.main) await main();
