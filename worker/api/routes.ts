// THE ROUTE TABLE — ONE IMPLEMENTATION, TWO FRONT DOORS.
//
// Each route mounts the function's OWN handler, imported from
// supabase/functions/. Nothing is reimplemented here and nothing is copied: the
// module that serves `https://<project>.supabase.co/functions/v1/pilot-chat`
// is the module that serves `https://<railway>/api/pilot-chat`, in the same
// repository, at the same commit. That is the property the whole migration
// rests on — if the two could differ, every behavioural test would have to be
// run twice and every bug fixed twice.
//
// ── WHY THE IMPORTS ARE LAZY ───────────────────────────────────────────────
//
// `supabase/functions/run-agent/index.ts` alone pulls in several hundred shared
// modules. Importing all four eagerly would make a container that serves only
// the worker role pay for an HTTP surface it never opens. They are loaded when
// the API is actually mounted, and only for the routes it is configured to
// serve.
//
// ── AND WHY THE FLAGS ARE SET FIRST ────────────────────────────────────────
//
// Every one of these modules calls `Deno.serve` at the bottom unless its
// opt-out variable is set. Imported into this process without the flags, four
// listeners would race the API's own for `PORT`, and three would lose. The
// flags are set before the first dynamic import and never unset.

import { RAILWAY_SERVED_FUNCTIONS, type RailwayServedFunction } from "../../supabase/functions/_shared/functionEndpoints.ts";

export type FunctionHandler = (req: Request) => Promise<Response>;

/** The opt-out each function reads at import time. See run-agent/index.ts. */
export const IMPORT_ONLY_FLAGS: Record<RailwayServedFunction, string> = {
  "pilot-chat": "PILOT_CHAT_IMPORT_ONLY",
  "run-agent": "RUN_AGENT_IMPORT_ONLY",
  "orchestrate": "ORCHESTRATE_IMPORT_ONLY",
  "enqueue-lead-mission": "ENQUEUE_LEAD_MISSION_IMPORT_ONLY",
};

/**
 * Stop every imported function from opening its own socket.
 *
 * Called before ANY route module is imported — including by the worker, which
 * already sets `RUN_AGENT_IMPORT_ONLY` for the same reason.
 */
export function sealFunctionListeners(setEnv: (k: string, v: string) => void = Deno.env.set): void {
  for (const flag of Object.values(IMPORT_ONLY_FLAGS)) setEnv(flag, "1");
}

/**
 * How each route reaches its handler.
 *
 * pilot-chat mounts `servePilotChat`, not `handlePilotChat`: the wrapper is
 * where an unhandled failure becomes a message in the conversation and where
 * model spend reaches the ledger. run-agent and orchestrate have no such
 * wrapper — their `Deno.serve` calls the handler directly — so the handler is
 * the whole contract and is what is mounted.
 */
const LOADERS: Record<RailwayServedFunction, () => Promise<FunctionHandler>> = {
  "pilot-chat": async () =>
    (await import("../../supabase/functions/pilot-chat/index.ts")).servePilotChat,
  "run-agent": async () =>
    (await import("../../supabase/functions/run-agent/index.ts")).handleRunAgent,
  "orchestrate": async () =>
    (await import("../../supabase/functions/orchestrate/index.ts")).handleOrchestrate,
  "enqueue-lead-mission": async () =>
    (await import("../../supabase/functions/enqueue-lead-mission/index.ts")).handleEnqueueLeadMission,
};

/** Every route the API is capable of serving. Built from the same list the callers read. */
export const SERVABLE_ROUTES: readonly RailwayServedFunction[] = RAILWAY_SERVED_FUNCTIONS;

/**
 * Which routes THIS process mounts.
 *
 * `AGENTORY_API_ROUTES` is the API's own switch and is intentionally separate
 * from `AGENTORY_API_FUNCTIONS`, which tells CALLERS where to send work. The
 * order matters during a cutover: mount the route first, verify it, and only
 * then point callers at it. One variable would force both to happen at once.
 *
 * Unset means all of them — a process asked to run the API with no list is
 * asking for the API, not for a silent no-op.
 */
export function routesToMount(env: (k: string) => string | undefined): RailwayServedFunction[] {
  const raw = (env("AGENTORY_API_ROUTES") ?? "").trim();
  if (!raw || raw === "*") return [...SERVABLE_ROUTES];
  const wanted = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  return SERVABLE_ROUTES.filter((r) => wanted.has(r));
}

/**
 * Import and return the handlers for `names`.
 *
 * A module that fails to import is a deployment error, not a request error, so
 * it is thrown here — at start-up, where a health check can see it — rather
 * than being turned into a 500 on the first call.
 */
export async function loadHandlers(
  names: readonly RailwayServedFunction[],
): Promise<Map<string, FunctionHandler>> {
  sealFunctionListeners();
  const out = new Map<string, FunctionHandler>();
  for (const name of names) {
    const handler = await LOADERS[name]();
    if (typeof handler !== "function") {
      throw new Error(`api route ${name}: module exported no handler`);
    }
    out.set(name, handler);
  }
  return out;
}
