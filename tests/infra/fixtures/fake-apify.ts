// A STAND-IN FOR THE APIFY API, for the canary workflow's local rehearsal only
// (scripts/test-project/canary/local-rehearsal.sh). Serves the read-only GETs
// apify-account-check.ts makes, with the public 2026-10-28 prices. It refuses a
// request without the expected bearer token, so the rehearsal proves the token
// is sent — and it never echoes one.
//
// Run lists (`/v2/acts/{actor}/runs`) come from FAKE_APIFY_RUN_LIST, a JSON file
// `{ "<actor>": [{ id, startedAt, status }] }` read on every request (none: empty).
//
//   FAKE_APIFY_TOKEN=<t> FAKE_APIFY_PRICE_BUMP=<usd added per unit, optional> FAKE_APIFY_RUN_LIST=<file, optional> \
//     deno run --allow-net=127.0.0.1 --allow-env --allow-read tests/infra/fixtures/fake-apify.ts <port>

const port = Number(Deno.args[0] ?? 8787);
const token = Deno.env.get("FAKE_APIFY_TOKEN") ?? "";
const bump = Number(Deno.env.get("FAKE_APIFY_PRICE_BUMP") ?? 0);
const ppe = (start: number, unitKey: string, unit: number) => ({
  pricingInfos: [{ pricingModel: "PAY_PER_EVENT", startedAt: "2026-01-01T00:00:00Z", pricingPerEvent: { actorChargeEvents: {
    "actor-start": { eventTitle: "Actor start", eventPriceUsd: start },
    [unitKey]: { eventTitle: unitKey, eventPriceUsd: unit + bump },
  } } }],
  actorPermissionLevel: "LIMITED_PERMISSIONS",
});
const ACTS: Record<string, Record<string, unknown>> = {
  "harvestapi~linkedin-job-search": { id: "act-jobs", username: "harvestapi", name: "linkedin-job-search", ...ppe(0.001, "job", 0.001) },
  "harvestapi~linkedin-company": { id: "act-details", username: "harvestapi", name: "linkedin-company", ...ppe(0.00005, "company", 0.004) },
  "atomus~linkedin-company-scraper": { id: "act-atomus", username: "atomus", name: "linkedin-company-scraper", ...ppe(0.00005, "company-found", 0.0035) },
};
const RUNS: Record<string, Record<string, unknown>> = {
  "run-jobs": { actId: "harvestapi~linkedin-job-search", status: "SUCCEEDED", usageTotalUsd: 0.004, chargedEventCounts: { "actor-start": 1, job: 3 } },
  // Contract 3's one job: 1 start + 1 job, exactly its $0.002 cap.
  "run-jobs-c3": { actId: "harvestapi~linkedin-job-search", status: "SUCCEEDED", usageTotalUsd: 0.002, chargedEventCounts: { "actor-start": 1, job: 1 } },
  // Above Atomus's $0.01055 cap: must never be reconciled automatically.
  "run-over": { actId: "atomus~linkedin-company-scraper", status: "SUCCEEDED", usageTotalUsd: 0.02, chargedEventCounts: { "actor-start": 1 } },
  // Apify says it is an Atomus run; the purchase was admitted as company details.
  "run-wrong": { actId: "atomus~linkedin-company-scraper", status: "SUCCEEDED", usageTotalUsd: 0.001, chargedEventCounts: { "actor-start": 1 } },
};

Deno.serve({ port, hostname: "127.0.0.1", onListen: () => console.log(`fake apify on ${port}`) }, (req) => {
  if (req.headers.get("authorization") !== `Bearer ${token}`) return Response.json({ error: { type: "token-not-valid" } }, { status: 401 });
  const url = new URL(req.url), path = url.pathname;
  const runList = path.match(/^\/v2\/acts\/([^/]+)\/runs$/);
  if (runList) {
    const actor = decodeURIComponent(runList[1]);
    if (!ACTS[actor]) return Response.json({ error: { type: "record-not-found" } }, { status: 404 });
    const file = Deno.env.get("FAKE_APIFY_RUN_LIST");
    let all: Record<string, unknown>[] = [];
    try { all = file ? (JSON.parse(Deno.readTextFileSync(file))[actor] ?? []) : []; } catch { all = []; }
    all = [...all].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    const offset = Number(url.searchParams.get("offset") ?? 0), limit = Number(url.searchParams.get("limit") ?? 1000);
    return Response.json({ data: { total: all.length, offset, limit, count: Math.min(limit, Math.max(0, all.length - offset)), items: all.slice(offset, offset + limit) } });
  }
  const data = path === "/v2/users/me" ? { id: "user-canary", username: "canaryaccount", plan: { id: "STARTER", monthlyUsageCreditsUsd: 29 } }
    : path === "/v2/users/me/limits" ? { monthlyUsageCycle: { startAt: "2026-10-01T00:00:00Z", endAt: "2026-10-31T23:59:59Z" },
      limits: { maxMonthlyUsageUsd: Number(Deno.env.get("FAKE_APIFY_LIMIT") ?? 19) }, current: { monthlyUsageUsd: Number(Deno.env.get("FAKE_APIFY_USAGE") ?? 0.00013) } }
    : path.startsWith("/v2/acts/") ? ACTS[decodeURIComponent(path.slice("/v2/acts/".length))]
    : path.startsWith("/v2/actor-runs/") ? RUNS[decodeURIComponent(path.slice("/v2/actor-runs/".length))]
    : undefined;
  return data ? Response.json({ data }) : Response.json({ error: { type: "record-not-found" } }, { status: 404 });
});
