// ATLAS SIMULATOR BACKEND — the REAL lead-pipeline service, every provider faked, on loopback.
//
// For manual UI acceptance (V5, 2026-11-28): the panel's buttons go through the true
// strategy_plan / strategy_run logic — interpretation contract, Company Brain and memory
// authority, capability routing, planner, budgets, provider isolation, signed approval tokens,
// the ledger, eligibility, Flexible Discovery — while Apify, LeadOcean and the grounding model
// are the simulator's fakes. Nothing leaves this machine; nothing costs money.
//
//   deno run --allow-read --allow-env --allow-net=127.0.0.1 scripts/dev/atlas-sim/server.ts
//   (or: npm run dev:atlas-server)  then open the app with VITE_STRATEGY_DISCOVERY_MOCK=server.
//
// The scenario (tests/fixtures/atlas-sim/*.json) defines the companies, the Brain and the
// model's reading of the request; the PANEL decides everything else — mode, provider, limits,
// approval. Sim controls (headers): x-atlas-scenario, x-atlas-clock-hours (run later, e.g. 25 to
// expire an approval), x-atlas-workspace ("other" = a workspace you are not a member of).

import { buildSim, loadScenarios, OTHER_WS, SIM_WS, type Scenario } from "./harness.ts";
import { handleStrategyRequest, parseStrategyRequest } from "../../../supabase/functions/_shared/leadPipeline/service.ts";

globalThis.fetch = (() => { throw new Error("the ATLAS simulator never calls the network"); }) as typeof fetch;

const PORT = Number(Deno.env.get("ATLAS_SIM_PORT") ?? 8787);
const DIR = new URL("../../../tests/fixtures/atlas-sim/", import.meta.url);
const scenarios = new Map((await loadScenarios(DIR)).map((s) => [s.name, s]));
const sims = new Map<string, Awaited<ReturnType<typeof buildSim>>>();
const DEFAULT = "v5-memory-exclusion";

const cors = (origin: string | null) => ({
  "access-control-allow-origin": origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ? origin : "http://localhost:8086",
  "access-control-allow-headers": "content-type, x-atlas-scenario, x-atlas-clock-hours, x-atlas-workspace",
  "access-control-allow-methods": "GET, POST, OPTIONS",
});
const json = (status: number, body: unknown, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors(origin) } });

async function simFor(name: string) {
  const s = scenarios.get(name);
  if (!s) return null;
  if (!sims.has(name)) sims.set(name, await buildSim(s));
  return { s, sim: sims.get(name)! };
}

Deno.serve({ hostname: "127.0.0.1", port: PORT }, async (req) => {
  const origin = req.headers.get("origin");
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method === "GET" && url.pathname === "/scenarios") {
    const list = [...scenarios.values()].filter((s) => s.name.startsWith("v5-") || s.name.startsWith("pilot-2026-11-23"))
      .map((s: Scenario) => ({ name: s.name, description: s.description, query: s.query, requestedCount: s.requestedCount ?? 5 }));
    return json(200, { default: DEFAULT, scenarios: list }, origin);
  }
  if (req.method === "POST" && url.pathname === "/reset") { sims.clear(); return json(200, { reset: true }, origin); }
  if (req.method !== "POST" || url.pathname !== "/lead-pipeline") return json(404, { error: "not found" }, origin);

  const name = req.headers.get("x-atlas-scenario") || DEFAULT;
  const found = await simFor(name);
  if (!found) return json(400, { error: `unknown scenario ${name}` }, origin);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "invalid body" }, origin); }
  // The scenario's request and the model's reading of it are fixed; the panel's choices are not.
  const other = req.headers.get("x-atlas-workspace") === "other";
  const parsed = parseStrategyRequest({ ...body, workspace_id: other ? OTHER_WS : SIM_WS, query: found.s.query });
  if (!parsed) return json(400, { error: "invalid request" }, origin);
  const hours = Number(req.headers.get("x-atlas-clock-hours") ?? 0);
  const base = found.sim.d.now ?? (() => new Date());
  const d = Number.isFinite(hours) && hours > 0 ? { ...found.sim.d, now: () => new Date(base().getTime() + hours * 3600_000) } : found.sim.d;
  const r = await handleStrategyRequest(parsed, d);
  console.log(`[atlas-sim] ${name} ${parsed.action} ${body.strategy ?? "auto"} → ${r.status} ${(r.body as { stage?: string }).stage ?? ""}/${(r.body as { code?: string }).code ?? ""}  apify=${found.sim.ap.calls.length} leadocean=${found.sim.loCalls.length}`);
  return json(r.status, { ...r.body, simulation: { scenario: name, apifyCalls: found.sim.ap.calls.length, leadoceanCalls: found.sim.loCalls.length } }, origin);
});
console.log(`[atlas-sim] SIMULATED backend on http://127.0.0.1:${PORT} — ${scenarios.size} scenarios, no network, no spend`);
