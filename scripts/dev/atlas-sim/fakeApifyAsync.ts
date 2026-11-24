// A FAKE APIFY API (offline) for the async run transport: the four documented endpoints, a
// virtual clock, and the failure modes phase C must survive. Used by the apifyRuns tests and
// the ATLAS simulator (`async` scenarios). It never touches the network.
//
//   POST /v2/acts/{actor}/runs?build=&maxItems=&maxTotalChargeUsd=&timeout=&waitForFinish=0
//   GET  /v2/actor-runs/{id}?waitForFinish=N        (advances the virtual clock up to N s)
//   GET  /v2/datasets/{id}/items?clean=true&limit=
//   POST /v2/actor-runs/{id}/abort

export interface FakeRunPlan {
  /** Seconds of virtual time until the run finishes. */
  durationS?: number;
  terminal?: "SUCCEEDED" | "FAILED" | "TIMED-OUT" | "ABORTED";
  items?: unknown[];
  /** Per-event prices and counts; defaults: start + one item event per dataset item. */
  pricing?: Record<string, number>;
  counts?: Record<string, number>;
  /** usageTotalUsd for the run (default: Σ counts × prices). */
  usageUsd?: number;
  /** Charges posted late: reads within `lateS` of finish report `lateUsd` instead. */
  lateS?: number;
  lateUsd?: number;
  /** The run document carries no charge fields (usageTotalUsd, chargedEventCounts, pricingInfo): an unreadable receipt. */
  receiptUnreadable?: boolean;
  /** Status reads answer 500 once the run is terminal (the run cannot be read at all). */
  statusUnreadable?: boolean;
}

export interface FakeApifyOptions {
  /** What the next start of an actor does. A function gets the start count for that actor. */
  plan?: (actorId: string, input: Record<string, unknown>, n: number) => FakeRunPlan;
  /** The run is CREATED, then the response is lost (connection drop after start). */
  dropStartResponse?: (actorId: string, n: number) => boolean;
  /** Answer the start with this status, creating nothing (4xx) or something unknown (5xx). */
  startStatus?: (actorId: string, n: number) => number | null;
  /** Builds the fake knows per actor; a start naming another build is 404 (nothing created). */
  builds?: Record<string, string>;
  /** A status read that fails (500) with this probability (deterministic `rand`). */
  pollFailRate?: number;
  rand?: () => number;
  startMs?: number;
}

interface FakeRun { id: string; actorId: string; input: Record<string, unknown>; build: string; datasetId: string; startedAt: number; plan: Required<Pick<FakeRunPlan, "durationS" | "terminal">> & FakeRunPlan; aborted: boolean; query: Record<string, string> }

export function fakeApify(o: FakeApifyOptions = {}) {
  let clock = o.startMs ?? Date.parse("2026-11-21T09:00:00Z");
  const runs = new Map<string, FakeRun>();
  const starts: { actorId: string; input: Record<string, unknown>; query: Record<string, string>; created: boolean; authHeader: boolean }[] = [];
  const perActor = new Map<string, number>();
  const rand = o.rand ?? Math.random;
  let seq = 0;

  const statusOf = (r: FakeRun) => r.aborted ? "ABORTED" : clock >= r.startedAt + r.plan.durationS * 1000 ? r.plan.terminal : "RUNNING";
  const finishedAt = (r: FakeRun) => r.startedAt + r.plan.durationS * 1000;
  const doc = (r: FakeRun) => {
    const st = statusOf(r);
    const items = r.plan.items ?? [];
    const pricing = r.plan.pricing ?? { "apify-actor-start": 0.001, "apify-default-dataset-item": 0.002 };
    const done = st !== "RUNNING";
    // Apify stops charging events at maxTotalChargeUsd (the run's cap): the item events
    // counted are the ones the cap allowed. A recorded figure (`usageUsd`, `counts`) is used as is.
    const cap = Number(r.query.maxTotalChargeUsd ?? Infinity);
    const itemPrice = pricing["apify-default-dataset-item"] ?? 0, startPrice = pricing["apify-actor-start"] ?? 0;
    const affordable = itemPrice > 0 ? Math.max(0, Math.floor((cap - startPrice) / itemPrice + 1e-9)) : Infinity;
    const counts = r.plan.counts ?? { "apify-actor-start": 1, "apify-default-dataset-item": done && st === "SUCCEEDED" ? Math.min(items.length, affordable) : 0 };
    const full = r.plan.usageUsd ?? Object.entries(counts).reduce((n, [k, c]) => n + c * (pricing[k] ?? 0), 0);
    const late = done && r.plan.lateS && clock < finishedAt(r) + r.plan.lateS * 1000;
    return {
      id: r.id, actId: r.actorId, status: st, buildNumber: r.build, buildId: `b-${r.build}`, defaultDatasetId: r.datasetId,
      startedAt: new Date(r.startedAt).toISOString(), finishedAt: done ? new Date(Math.min(clock, finishedAt(r))).toISOString() : null,
      usageTotalUsd: late ? (r.plan.lateUsd ?? 0) : Math.round(full * 1e6) / 1e6,
      chargedEventCounts: late ? { "apify-actor-start": 1 } : counts,
      pricingInfo: { pricingModel: "PAY_PER_EVENT", pricingPerEvent: { actorChargeEvents: Object.fromEntries(Object.entries(pricing).map(([k, v]) => [k, { eventPriceUsd: v }])) } },
    };
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<Response> => {
    const u = new URL(url);
    const q = Object.fromEntries(u.searchParams);
    const auth = (init?.headers?.Authorization ?? "").startsWith("Bearer ");
    if (u.searchParams.has("token")) return Promise.reject(new Error("token in URL"));
    let m: RegExpExecArray | null;
    if (init?.method === "POST" && (m = /^\/v2\/acts\/([^/]+)\/runs$/.exec(u.pathname))) {
      const actorId = m[1].replace("~", "/");
      const n = (perActor.get(actorId) ?? 0) + 1; perActor.set(actorId, n);
      const input = JSON.parse(init.body ?? "{}");
      const forced = o.startStatus?.(actorId, n) ?? null;
      const knownBuild = o.builds?.[actorId];
      if (forced && forced < 500) { starts.push({ actorId, input, query: q, created: false, authHeader: auth }); return Promise.resolve(json(forced, { error: { type: "invalid-input" } })); }
      if (knownBuild && q.build !== knownBuild) { starts.push({ actorId, input, query: q, created: false, authHeader: auth }); return Promise.resolve(json(404, { error: { type: "record-not-found", message: `build ${q.build} not found` } })); }
      const plan = { durationS: 20, terminal: "SUCCEEDED" as const, ...(o.plan?.(actorId, input, n) ?? {}) };
      const id = `run${++seq}`;
      const r: FakeRun = { id, actorId, input, build: q.build ?? "latest", datasetId: `ds${seq}`, startedAt: clock, plan, aborted: false, query: q };
      runs.set(id, r);
      starts.push({ actorId, input, query: q, created: true, authHeader: auth });
      if (forced) return Promise.resolve(json(forced, { error: { type: "server" } }));
      if (o.dropStartResponse?.(actorId, n)) return Promise.reject(new TypeError("connection reset after the run was created"));
      return Promise.resolve(json(201, { data: { id, defaultDatasetId: r.datasetId, buildId: `b-${r.build}`, status: "READY" } }));
    }
    if ((!init?.method || init.method === "GET") && (m = /^\/v2\/actor-runs\/([^/]+)$/.exec(u.pathname))) {
      const r = runs.get(decodeURIComponent(m[1]));
      if (!r) return Promise.resolve(json(404, {}));
      const wait = Math.min(60, Number(q.waitForFinish ?? 0)) * 1000;
      const until = finishedAt(r);
      clock = statusOf(r) === "RUNNING" ? Math.min(until, clock + wait) : clock;
      if (o.pollFailRate && rand() < o.pollFailRate) return Promise.resolve(json(500, {}));
      if (r.plan.statusUnreadable && statusOf(r) !== "RUNNING") return Promise.resolve(json(500, {}));
      if (r.plan.receiptUnreadable && statusOf(r) !== "RUNNING") { const { usageTotalUsd: _u, chargedEventCounts: _c, pricingInfo: _p, ...bare } = doc(r); return Promise.resolve(json(200, { data: bare })); }
      return Promise.resolve(json(200, { data: doc(r) }));
    }
    if ((m = /^\/v2\/datasets\/([^/]+)\/items$/.exec(u.pathname))) {
      const r = [...runs.values()].find((x) => x.datasetId === decodeURIComponent(m![1]));
      return Promise.resolve(json(200, (r?.plan.items ?? []).slice(0, Number(q.limit ?? 1000))));
    }
    if (init?.method === "POST" && (m = /^\/v2\/actor-runs\/([^/]+)\/abort$/.exec(u.pathname))) {
      const r = runs.get(decodeURIComponent(m[1]));
      if (r && statusOf(r) === "RUNNING") { r.aborted = true; r.plan = { ...r.plan, durationS: (clock - r.startedAt) / 1000 }; }
      return Promise.resolve(json(r ? 200 : 404, { data: r ? doc(r) : null }));
    }
    return Promise.resolve(json(404, { error: "unknown endpoint" }));
  };

  return {
    fetch,
    now: () => clock,
    sleep: (ms: number) => { clock += ms; return Promise.resolve(); },
    advance: (ms: number) => { clock += ms; },
    starts, runs,
    /** Runs CREATED at Apify per actor (each is a purchase). */
    purchases: (actorId?: string) => starts.filter((s) => s.created && (!actorId || s.actorId === actorId)).length,
  };
}
