// PRELOADED INTO A REAL `worker/main.ts` PROCESS (deno run --preload) by
// workerKill.rehearsal.ts. Runs before the worker captures `fetch` for its
// admission gate, so the gate's base transport is this one:
//
//   * the project's own API (SUPABASE_URL/rest/v1/…) goes to the local
//     PostgREST, which serves at its root;
//   * OpenAI and Apify are answered by the scenario's scripted vendors
//     (tests/db-contract/lib/discoveryScenario.ts `vendorResponder`);
//   * anything else is refused and reported as a forbidden call.
//
// Every vendor request is appended to REHEARSAL_EVENTS as one JSON line, so the
// driver can count purchases across processes. With REHEARSAL_KILL_AT set, the
// matching request is reported as `kill_point` and never answered; the driver
// then SIGKILLs this process. With REHEARSAL_PAUSE_AT set, the matching vendor
// request (already admitted by the gate) is reported as `pause_point` and held
// until the driver creates `<REHEARSAL_EVENTS>.release` — the window in which an
// operator stop lands mid-mission.
import { vendorResponder, type Scenario } from "../db-contract/lib/discoveryScenario.ts";

const own = new URL(Deno.env.get("SUPABASE_URL")!);
const eventsPath = Deno.env.get("REHEARSAL_EVENTS")!;
const killAt = Deno.env.get("REHEARSAL_KILL_AT") ?? "";
const pauseAt = Deno.env.get("REHEARSAL_PAUSE_AT") ?? "";
let paused = false;
const pid = Deno.pid;
const scenario: Scenario = { label: "real-process", ...JSON.parse(Deno.env.get("REHEARSAL_SCENARIO") ?? "{}") };
const realFetch = globalThis.fetch.bind(globalThis);
const emit = (e: Record<string, unknown>) =>
  Deno.writeTextFileSync(eventsPath, JSON.stringify({ pid, at: Date.now(), ...e }) + "\n", { append: true });
const hang = () => new Promise<Response>(() => {});
let killed = false;
const trace: Record<string, unknown> = { requests: [], model_stages: [], admissions: [] };
const vendor = vendorResponder(scenario, {
  trace, vendorRequests: [], isCompiled: () => true,
  interruptAt: (at) => {
    if (!killAt || at !== killAt) return false;
    killed = true;
    emit({ type: "kill_point", point: at });
    return true;
  },
});

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (killed) return hang();
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === own.origin) {
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (killAt === "jobs_run_id_write" && method === "PATCH" && url.pathname.endsWith("/lead_execution_calls")
        && typeof init?.body === "string" && init.body.includes('"provider_run_id":"run-jobs"')) {
      killed = true;
      emit({ type: "kill_point", point: killAt });
      return hang();
    }
    const target = url.href.replace(`${own.origin}/rest/v1`, own.origin);
    return input instanceof Request ? realFetch(new Request(target, input), init) : realFetch(target, init);
  }
  if (url.hostname === "api.openai.com" || url.hostname === "api.apify.com") {
    const method = init?.method ?? "GET";
    emit({ type: "vendor", host: url.hostname, method, path: url.pathname });
    if (pauseAt === "jobs_status" && !paused && method === "GET" && url.pathname.includes("/actor-runs/run-jobs")) {
      paused = true;
      emit({ type: "pause_point", point: pauseAt });
      return (async () => {
        const release = `${eventsPath}.release`;
        for (;;) {
          try { Deno.statSync(release); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
        }
        return vendor(url, init, null);
      })();
    }
    return vendor(url, init, null);
  }
  emit({ type: "forbidden", host: url.hostname, path: url.pathname });
  return Promise.reject(new TypeError(`rehearsal: forbidden external call to ${url.hostname}`));
}) as typeof fetch;
