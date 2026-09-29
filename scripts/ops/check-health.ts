// SCHEDULED HEALTH CHECK — exits non-zero when a person should look.
//
//   OPS_HEALTH_URL=https://<ref>.supabase.co/functions/v1/ops-health OPS_HEALTH_TOKEN=… \
//   WORKER_HEALTH_URL=https://<railway domain>/health \
//     deno run --allow-net --allow-env scripts/ops/check-health.ts --fail-on critical|warn
//
// Run by .github/workflows/ops-health.yml: every 15 minutes failing on
// `critical` (the product is not working for someone now), and once a day
// failing on `warn` too (look today). A failed scheduled run is what GitHub
// emails — that is the alert. The ops token is sent in a header and never
// printed; the responses carry aggregates only.

export type Severity = "critical" | "warn";
export interface Alert { severity: Severity; code: string; detail: string }

/** The worker's /health, reduced to an alert or nothing. */
export function workerAlert(i: { reachable: boolean; status?: number; body?: { ok?: unknown; status?: unknown } | null }): Alert | null {
  if (!i.reachable) return { severity: "critical", code: "worker_unreachable", detail: "the Railway worker's /health did not answer" };
  if (i.status !== 200 || i.body?.ok !== true) {
    return { severity: "critical", code: "worker_unhealthy", detail: `worker /health: HTTP ${i.status}, status ${String(i.body?.status ?? "unknown")}` };
  }
  return null;
}

/** The ops endpoint's answer, reduced to alerts. An unreadable answer is itself critical. */
export function opsAlerts(i: { reachable: boolean; status?: number; body?: { alerts?: unknown } | null }): Alert[] {
  if (!i.reachable) return [{ severity: "critical", code: "ops_unreachable", detail: "ops-health did not answer" }];
  if (i.status === 401) return [{ severity: "critical", code: "ops_unauthorized", detail: "ops-health refused the token — OPS_HEALTH_TOKEN differs between GitHub and Supabase" }];
  if (i.status === 503) return [{ severity: "critical", code: "ops_disabled", detail: "ops-health is disabled — OPS_HEALTH_TOKEN is not set on the function" }];
  const alerts = Array.isArray(i.body?.alerts) ? i.body!.alerts as Alert[] : null;
  if (!alerts) return [{ severity: "critical", code: "ops_bad_response", detail: `ops-health answered HTTP ${i.status} without alerts` }];
  return alerts;
}

/** 0 = nothing to do; 1 = fail the run. `warn` fails on warnings too. */
export function exitCode(alerts: readonly Alert[], failOn: Severity): 0 | 1 {
  return alerts.some((a) => a.severity === "critical" || (failOn === "warn" && a.severity === "warn")) ? 1 : 0;
}

async function getJson(url: string, headers: Record<string, string> = {}) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    return { reachable: true, status: res.status, body: body as Record<string, unknown> | null };
  } catch {
    return { reachable: false };
  }
}

async function main() {
  const i = Deno.args.indexOf("--fail-on");
  const failOn: Severity = i >= 0 && Deno.args[i + 1] === "warn" ? "warn" : "critical";
  const opsUrl = Deno.env.get("OPS_HEALTH_URL") ?? "";
  const token = Deno.env.get("OPS_HEALTH_TOKEN") ?? "";
  const workerUrl = Deno.env.get("WORKER_HEALTH_URL") ?? "";
  if (!opsUrl || !token) {
    console.error("OPS_HEALTH_URL and OPS_HEALTH_TOKEN must be set");
    Deno.exit(2);
  }
  const ops = await getJson(opsUrl, { "x-ops-token": token });
  const alerts: Alert[] = opsAlerts(ops as never);
  if (workerUrl) {
    const w = await getJson(workerUrl);
    const a = workerAlert(w as never);
    if (a) alerts.push(a);
    const build = (w as { body?: { build?: { sha?: string } } }).body?.build?.sha;
    if (build) console.log(`worker build: ${build}`);
  } else {
    console.log("WORKER_HEALTH_URL not set: the worker is not checked");
  }
  const snap = (ops as { body?: { snapshot?: unknown } }).body?.snapshot;
  if (snap) console.log(JSON.stringify(snap, null, 1));
  if (alerts.length === 0) console.log("OK: no alerts");
  for (const a of alerts) console.log(`${a.severity.toUpperCase().padEnd(8)} ${a.code}: ${a.detail}`);
  Deno.exit(exitCode(alerts, failOn));
}

if (import.meta.main) await main();
