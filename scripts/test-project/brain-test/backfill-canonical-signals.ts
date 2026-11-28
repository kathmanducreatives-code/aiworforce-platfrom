// BACKFILL LEGACY SIGNALS INTO THE CANONICAL STORE — dry run by default. Signals recovery, Phase 2.
//
//   deno run --allow-net --allow-env scripts/test-project/brain-test/backfill-canonical-signals.ts \
//     --workspace <uuid> [--execute --confirm jekgwafobrzamoupehnn]
//   env: BRAIN_TEST_URL=https://jekgwafobrzamoupehnn.supabase.co  BRAIN_TEST_SERVICE_ROLE_KEY=…
//
// Each legacy `signals` row goes through the SAME mapper and writer the radar uses on every new
// scan (radarSignalToV2 + signalsV2Writer), so a backfilled row is identical to one the radar
// would write today. Idempotent: `signal_events.legacy_signal_id` is unique, and the writer's
// dedupe key is deterministic, so re-running writes nothing twice. Legacy rows are never changed
// or deleted. A row the mapper cannot identify (no resolvable company / market subject) is
// REPORTED and left legacy-only — it is never given an invented identity.
// Refuses any project but Brain TEST; prints counts and reasons, never secret values.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mapRadarSignalToV2, type RadarLegacyRow } from "../../../supabase/functions/_shared/radarSignalToV2.ts";
import { writeSignalEventV2 } from "../../../supabase/functions/_shared/signalsV2Writer.ts";

const REF = "jekgwafobrzamoupehnn";
const args = Deno.args;
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const ws = arg("--workspace");
const execute = args.includes("--execute");
const url = Deno.env.get("BRAIN_TEST_URL") ?? "";
const key = Deno.env.get("BRAIN_TEST_SERVICE_ROLE_KEY") ?? "";
const refuse = (m: string): never => { console.error(`refusing: ${m}`); Deno.exit(1); };
if (!ws || !/^[0-9a-f-]{36}$/.test(ws)) refuse("--workspace <uuid> is required");
if (url !== `https://${REF}.supabase.co`) refuse(`BRAIN_TEST_URL must be https://${REF}.supabase.co`);
if (!key) refuse("BRAIN_TEST_SERVICE_ROLE_KEY is not set");
if (execute && arg("--confirm") !== REF) refuse(`--execute needs --confirm ${REF}`);

const admin = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await admin.from("signals")
  .select("id, workspace_id, signal_type, title, description, source, source_url, raw, created_at")
  .eq("workspace_id", ws!).order("created_at", { ascending: true }).limit(5000);
if (error) refuse(`could not read legacy signals: ${error.message}`);

const stats = { legacy: 0, mappable: 0, unmappable: {} as Record<string, number>, written: 0, deduplicated: 0, failed: 0 };
for (const row of (data ?? []) as Array<RadarLegacyRow & { created_at: string }>) {
  stats.legacy++;
  const mapped = mapRadarSignalToV2(row, "manual_scan", row.created_at);
  if (!mapped.ok) { stats.unmappable[mapped.reason] = (stats.unmappable[mapped.reason] ?? 0) + 1; continue; }
  stats.mappable++;
  if (!execute) continue;
  const r = await writeSignalEventV2({ admin, enabled: true } as never, mapped.input);
  if (r.written) stats.written++; else if (r.deduplicated) stats.deduplicated++; else stats.failed++;
}
console.log(JSON.stringify({ project: REF, workspace: ws, mode: execute ? "execute" : "dry-run", ...stats }, null, 2));
if (!execute) console.log(`dry run only. Add --execute --confirm ${REF} after approval.`);
