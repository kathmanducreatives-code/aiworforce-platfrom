// WATCH ONE LOCAL MISSION UNTIL IT IS TERMINAL — OR UNTIL TIME IS UP.
//
// The previous watcher was an inline shell loop:
//
//     until [ "$s" = "complete" ] || [ "$s" = "failed" ]; do sleep 15; done
//
// It spun for nearly two hours against a mission that had settled in four
// minutes, because the mission ended `cancelled` — a terminal state the loop
// never tested for — and it had no deadline. The engine was fine; the watcher
// was not.
//
// So this does not restate the terminal set. It imports the backend's own
// `isTerminalQueueStatus`, which is what the worker uses to release a row. One
// definition, and a new terminal state can never again be invisible to tooling.
//
//   deno run --allow-net --allow-env --allow-read \
//     scripts/local-supabase/watch-mission.ts <queue_id> [--timeout-s=900] [--interval-s=10]

import { isTerminalQueueStatus } from "../../supabase/functions/_shared/leadMissionTerminal.ts";

const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function arg(name: string, fallback: number): number {
  const hit = Deno.args.find((a) => a.startsWith(`--${name}=`));
  const v = hit ? Number(hit.split("=")[1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const queueId = Deno.args.find((a) => !a.startsWith("--"));
if (!queueId) {
  console.error("usage: watch-mission.ts <queue_id> [--timeout-s=900] [--interval-s=10]");
  Deno.exit(2);
}
const timeoutMs = arg("timeout-s", 900) * 1000;
const intervalMs = arg("interval-s", 10) * 1000;

/** One read, through the CLI's own container so no psql client is needed. */
async function readStatus(): Promise<{ status: string; attempts: string; task: string } | null> {
  const sql =
    `select status || '|' || attempts || '|' || coalesce(task_id::text,'-') ` +
    `from lead_mission_queue where id='${queueId}'`;
  const cmd = new Deno.Command("docker", {
    args: ["exec", "-i", "supabase_db_ohsdatpvfdjdemstoiuj", "psql", "-U", "postgres",
           "-d", "postgres", "-tAc", sql],
    stdout: "piped", stderr: "piped",
  });
  const out = await cmd.output();
  const line = new TextDecoder().decode(out.stdout).trim();
  if (!line) return null;
  const [status, attempts, task] = line.split("|");
  return { status, attempts, task };
}

const started = Date.now();
let last = "";
while (true) {
  const row = await readStatus();
  if (!row) {
    console.error(`queue row ${queueId} not found`);
    Deno.exit(2);
  }
  const elapsed = Math.round((Date.now() - started) / 1000);
  if (row.status !== last) {
    console.log(`[${elapsed}s] ${row.status} (attempts ${row.attempts}, task ${row.task})`);
    last = row.status;
  }
  // THE CANONICAL ANSWER, not a local list.
  if (isTerminalQueueStatus(row.status)) {
    console.log(`TERMINAL: ${row.status} after ${elapsed}s (attempts ${row.attempts})`);
    Deno.exit(0);
  }
  if (Date.now() - started >= timeoutMs) {
    // A timeout is a REPORT, not a silent give-up: it says what the row was
    // last seen as, so the reader knows whether to investigate the engine or
    // simply wait longer.
    console.error(
      `TIMEOUT after ${elapsed}s — still "${row.status}" (attempts ${row.attempts}, task ${row.task}). ` +
      `Not terminal. Nothing was stopped; inspect the worker before assuming a hang.`,
    );
    Deno.exit(1);
  }
  await new Promise((r) => setTimeout(r, intervalMs));
}
