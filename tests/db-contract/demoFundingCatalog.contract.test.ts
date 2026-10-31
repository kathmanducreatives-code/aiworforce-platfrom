// THE FIVE-COMPANY DEMO'S CATALOG, AGAINST THE REAL ADMISSION SQL.
//
// docs/launch/proposals/smoke-catalog-demo-funding.json adds the funding
// verifiers (Atomus, Pvalyou) to the reviewed two-actor catalog. Pinned here,
// on the held admission migration itself:
//   1. the kickoff's authorization (every actor at ZERO starts) is accepted;
//   2. a funding purchase under it is refused — preparing the demo buys nothing;
//   3. the read allocation a PAID four-actor run needs is refused by the
//      five-read cap: the documented blocker, so lifting it is a reviewed
//      change to the migration, never a silent one.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sql, uuid } from "./lib/harness.ts";
import { hex, seedSmokeMission } from "./lib/smokeMission.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
const catalog = JSON.parse(Deno.readTextFileSync(new URL("../../docs/launch/proposals/smoke-catalog-demo-funding.json", import.meta.url)));
const ATOMUS = "apify:atomus~linkedin-company-scraper";
const PVALYOU = "apify:pvalyou~company-record";

/** The catalog as the operator completes it: observed within the hour, every price filled. */
function observedQuotes(readsOver?: Record<string, number>): Record<string, unknown> {
  const at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const out: Record<string, Record<string, unknown>> = {};
  for (const [k, t] of Object.entries(catalog.approved_quotes as Record<string, Record<string, unknown>>)) {
    out[k] = { ...t, observed_at: at, source: "synthetic contract control (not a vendor quote)",
      ...(t.maximum_microusd == null ? { maximum_microusd: 1000 } : {}) };
  }
  if (readsOver) out.reads = { ...out.reads, request_limits: { max_reads_per_actor: readsOver } };
  return out;
}

Deno.test("demo catalog: the kickoff's zero-start authorization is accepted", opts, async () => {
  const m = await seedSmokeMission({ quotes: observedQuotes(), actorLimits: catalog.actor_limits_for_kickoff });
  assert(m.authorizationId, "authorized");
  const [a] = await sql`select actor_limits from public.discovery_smoke_authorizations where id = ${m.authorizationId}`;
  assertEquals(a.actor_limits[ATOMUS], 0);
  assertEquals(a.actor_limits[PVALYOU], 0);
});

Deno.test("demo catalog: a funding purchase under the kickoff's authorization is refused", opts, async () => {
  const m = await seedSmokeMission({ quotes: observedQuotes(), actorLimits: catalog.actor_limits_for_kickoff });
  for (const [actor, template] of [[ATOMUS, "atomus"], [PVALYOU, "pvalyou"]]) {
    const [r] = await sql`select public.admit_discovery_smoke(${m.queueId}, ${m.workerId}, ${m.taskId}, ${m.generation},
      ${"demo-" + uuid()}, 'provider', ${actor}, ${template}, ${hex("d")}, null) as d`;
    assert((r.d as { decision: string }).decision !== "admitted", `${actor}: ${JSON.stringify(r.d)}`);
  }
  const [n] = await sql`select count(*)::int as n from public.discovery_smoke_operations o
    join public.discovery_smoke_authorizations a on a.id = o.authorization_id where a.queue_id = ${m.queueId} and o.kind = 'provider'`;
  assertEquals(n.n, 0, "nothing was reserved for purchase");
});

Deno.test("demo catalog BLOCKER: a paid four-actor read allocation exceeds the five-read cap and is refused", opts, async () => {
  await assertRejects(
    () => seedSmokeMission({
      quotes: observedQuotes({ "apify:harvestapi~linkedin-job-search": 3, "apify:harvestapi~linkedin-company": 2, [ATOMUS]: 2, [PVALYOU]: 2 }),
      actorLimits: catalog.actor_limits_for_kickoff,
    }),
    Error, "sum to at most 5",
  );
});
