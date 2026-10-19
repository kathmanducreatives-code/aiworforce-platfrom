// Failure-only A7 review. Real admission/credits/ledger RPCs on the disposable
// localhost database; vendor traffic is replaced before it reaches a socket.
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type AdmissionDb,
  createAdmissionFetch,
  missionAdmission,
  type MissionAdmissionContext,
} from "../../supabase/functions/_shared/smokeAdmission.ts";
import {
  runTool,
  type ToolContext,
} from "../../supabase/functions/_shared/toolRegistry.ts";
import { gptStructured } from "../../supabase/functions/_shared/gptProvider.ts";
import { APIFY_START_UNCERTAIN } from "../../supabase/functions/_shared/verifierPurchaseRecovery.ts";
import { mintJwt, REST_URL, sql } from "./lib/harness.ts";
import { seedSmokeMission, type SmokeMission } from "./lib/smokeMission.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };
const realFetch = globalThis.fetch.bind(globalThis);
const db = createClient(REST_URL, await mintJwt("service_role"), {
  auth: { persistSession: false },
  global: {
    fetch: (u, i) =>
      realFetch(String(u).replace(`${REST_URL}/rest/v1`, REST_URL), i),
  },
});
const catalog = JSON.parse(
  await Deno.readTextFile(
    new URL(
      "../../docs/launch/proposals/smoke-catalog-two-actor.json",
      import.meta.url,
    ),
  ),
);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
Deno.env.set("APIFY_API_TOKEN", "offline-fake");
Deno.env.set("LEAD_CREDIT_ENFORCEMENT", "enforce");

async function mission() {
  // Proposed limits unchanged. Evidence and the unverified details price are
  // synthetic fixture values ONLY, never approved account-specific quotes.
  const quotes = Object.fromEntries(
    Object.entries(catalog.approved_quotes).map(([k, v]) => [k, {
      ...(v as object),
      ...(k === "details" ? { maximum_microusd: 5000 } : {}),
      source: "offline synthetic reliability fixture",
      liability_bound_ref: "offline fixture",
      observed_at: new Date(Date.now() - 1000).toISOString(),
    }]),
  );
  const m = await seedSmokeMission({
    quotes,
    actorLimits: catalog.actor_limits,
  });
  await sql`insert into public.workspace_credit_balances (workspace_id, balance_credits) values (${m.ws}, 10)`;
  return m;
}
type Vendor = (url: URL, init: RequestInit) => Response | Promise<Response>;
async function inside<T>(
  m: SmokeMission,
  vendor: Vendor,
  fn: () => Promise<T>,
  extra: Partial<MissionAdmissionContext> = {},
) {
  const gate = createAdmissionFetch({
    db: db as unknown as AdmissionDb,
    ownApi: REST_URL,
    log: () => {},
    baseFetch: ((u, i = {}) => {
      const url = new URL(u instanceof Request ? u.url : String(u));
      if (url.origin === REST_URL) return realFetch(u, i);
      assert(
        ["api.apify.com", "api.openai.com"].includes(url.hostname),
        "unexpected destination",
      );
      return Promise.resolve(vendor(url, i));
    }) as typeof fetch,
  });
  globalThis.fetch = gate;
  try {
    return await missionAdmission.run({
      queueId: m.queueId,
      workerId: m.workerId,
      taskId: m.taskId,
      generation: m.generation,
      ...extra,
    }, fn);
  } finally {
    globalThis.fetch = realFetch;
  }
}
const ctx = (m: SmokeMission): ToolContext => ({
  admin: db,
  workspace_id: m.ws,
  task_id: m.taskId,
  lineage_root: m.taskId,
  agent_slug: "scout",
  agent_id: null,
});
const jobInput = {
  actor_id: "harvestapi/linkedin-job-search",
  selected_actor_key: "apify_linkedin_job_search",
  source_type: "jobs",
  compiled_actor_input: true,
  defer_persistence: true,
  allow_disabled: true,
  input: {
    jobTitles: ["Account Executive"],
    locations: ["United States"],
    maxItems: 3,
    postedLimit: "month",
  },
};
async function accounting(m: SmokeMission) {
  const [balance] =
    await sql`select balance_credits, reserved_credits from public.workspace_credit_balances where workspace_id = ${m.ws}`;
  const operations =
    await sql`select kind, committed_microusd, provider_run_id from public.discovery_smoke_operations where authorization_id = ${m.authorizationId}`;
  const reconciled =
    await sql`select * from public.discovery_smoke_reconciliations where authorization_id = ${m.authorizationId}`;
  return { balance, operations, reconciled };
}

for (const status of [402, 403, 429, 500, 0]) {
  Deno.test(
    `A7 failure: Apify ${
      status || "network loss"
    }; replay never buys twice or clears USD liability`,
    opts,
    async () => {
      const m = await mission();
      let posts = 0;
      const vendor: Vendor = (_u, i) => {
        assertEquals(i.method, "POST");
        posts++;
        if (!status) throw new TypeError("offline connection lost after send");
        return json({ error: "offline failure" }, status);
      };
      const first = await inside(
        m,
        vendor,
        () => runTool("source_with_apify", jobInput, ctx(m)),
      );
      assertEquals(first.ok, false);
      const before = await accounting(m);
      assertEquals(before.operations.length, 1);
      assertEquals(before.operations[0].committed_microusd, "5000");
      assertEquals(before.operations[0].provider_run_id, null);
      assertEquals(before.reconciled.length, 0);
      if (!status || status >= 500) {
        assertEquals(before.balance.reserved_credits, 1);
      }
      const again = await inside(
        m,
        vendor,
        () => runTool("source_with_apify", jobInput, ctx(m)),
      );
      assertEquals(again.ok, false);
      assertEquals(posts, 1);
      const after = await accounting(m);
      assertEquals(after.operations, before.operations);
      assertEquals(
        after.reconciled.length,
        0,
        "provider errors must not reconcile liabilities",
      );
      if (!status || status >= 500) {
        assertEquals(after.balance.reserved_credits, 1);
      }
    },
  );
}

Deno.test(
  "A7 failure: unreadable final status retains run identity, bounded reads and reservation",
  opts,
  async () => {
    const m = await mission();
    let posts = 0, reads = 0;
    const result = await inside(m, (_u, i) => {
      if (i.method === "POST") {
        posts++;
        return json({
          data: {
            id: "offline-run",
            defaultDatasetId: "offline-data",
            status: "RUNNING",
          },
        }, 201);
      }
      reads++;
      return json({ error: "offline status unavailable" }, 500);
    }, () => runTool("source_with_apify", jobInput, ctx(m)));
    assertEquals(result.ok, false);
    assertEquals(
      (result.data as { run_id: string; pending: boolean }).run_id,
      "offline-run",
    );
    assertEquals((result.data as { pending: boolean }).pending, true);
    assertEquals(posts, 1);
    assert(reads <= 3);
    const state = await accounting(m);
    const purchase = state.operations.find((o) => o.kind === "provider")!;
    assertEquals(purchase.provider_run_id, "offline-run");
    assertEquals(purchase.committed_microusd, "5000");
    assertEquals(state.reconciled.length, 0);
    await sql`select public.stop_discovery_smoke(${m.queueId}, 'offline done')`;
    await assertRejects(() =>
      sql`select public.reconcile_discovery_smoke_operation(${m.queueId},
    (select operation_key from public.discovery_smoke_operations where authorization_id = ${m.authorizationId} and kind='provider'),
    0, 'offline NO_RUN attempt against known run', 'NO_RUN')`
    );
  },
);

Deno.test(
  "A7 failure: concurrent uncertain actor starts share one purchase and keep credit held",
  opts,
  async () => {
    const m = await mission();
    let posts = 0;
    await inside(m, (_u, i) => {
      assertEquals(i.method, "POST");
      posts++;
      return json({ error: "offline uncertain start" }, 500);
    }, async () => {
      const results = await Promise.all(
        Array.from(
          { length: 8 },
          () => runTool("source_with_apify", jobInput, ctx(m)),
        ),
      );
      assert(results.every((r) => !r.ok));
    });
    const state = await accounting(m);
    assertEquals(posts, 1);
    assertEquals(state.operations.length, 1);
    assertEquals(state.balance.balance_credits, 9);
    assertEquals(state.balance.reserved_credits, 1);
    assertEquals(state.reconciled.length, 0);
  },
);

Deno.test(
  "A7 transport: ownership loss during an Apify POST stays uncertain and held on replay",
  opts,
  async () => {
    const m = await mission();
    const owner = new AbortController();
    let posts = 0;
    await inside(m, (_u, i) => {
      posts++;
      return new Promise<Response>((_resolve, reject) => {
        assert(i.signal, "provider transport needs the ownership signal");
        i.signal.addEventListener("abort", () => reject(i.signal!.reason), {
          once: true,
        });
        owner.abort(new DOMException("offline lease lost", "AbortError"));
      });
    }, async () => {
      const first = await runTool("source_with_apify", jobInput, ctx(m));
      assert(String(first.error).startsWith(APIFY_START_UNCERTAIN));
      const replay = await runTool("source_with_apify", jobInput, ctx(m));
      assertEquals(replay.ok, false);
    }, { signal: owner.signal });
    assertEquals(owner.signal.aborted, true);
    const state = await accounting(m);
    assertEquals(posts, 1);
    assertEquals(state.operations.length, 1);
    assertEquals(state.balance.reserved_credits, 1);
    assertEquals(state.operations[0].committed_microusd, "5000");
  },
);

Deno.test(
  "A7 accounting: stale internal-credit refund never releases the uncertain USD liability",
  opts,
  async () => {
    const m = await mission();
    await inside(
      m,
      () => json({ error: "offline uncertain start" }, 500),
      () => runTool("source_with_apify", jobInput, ctx(m)),
    );
    const before = await accounting(m);
    assertEquals(before.balance.reserved_credits, 1);
    await sql`update public.credit_transactions set created_at=now()-interval '31 minutes' where workspace_id=${m.ws}`;
    await sql`select public.credits_release_stale()`;
    const after = await accounting(m);
    assertEquals(
      after.balance.balance_credits,
      10,
      "documented internal-credit policy absorbs an uncertain cost after 30 minutes",
    );
    assertEquals(after.balance.reserved_credits, 0);
    assertEquals(
      after.operations,
      before.operations,
      "USD commitment is independent of internal credits",
    );
    assertEquals(after.reconciled.length, 0);
  },
);

for (const status of [402, 403, 429, 500, 0, 200]) {
  Deno.test(
    `A7 interruption: failed resume read (${status}) cannot forget or refund an existing purchase`,
    opts,
    async () => {
      const m = await mission();
      let reads = 0, posts = 0;
      let waiting!: () => void, release!: () => void;
      const interrupted = new Promise<void>((r) => waiting = r);
      const released = new Promise<void>((r) => release = r);
      await inside(m, async (_url, i) => {
        if (i.method === "POST") {
          posts++;
          return json({
            data: {
              id: "interrupted-run",
              defaultDatasetId: "interrupted-data",
              status: "RUNNING",
            },
          }, 201);
        }
        reads++;
        if (reads === 1) {
          // Pause at the same durable boundary as a crash: purchase and run ID
          // persisted, credit reserved, no final tool result/credit settlement.
          waiting();
          await released;
          return json({
            data: {
              id: "interrupted-run",
              defaultDatasetId: "interrupted-data",
              status: "RUNNING",
            },
          });
        }
        if (!status) throw new TypeError("offline resume connection lost");
        return json({ error: "offline unreadable resumed run" }, status);
      }, async () => {
        const original = runTool("source_with_apify", jobInput, ctx(m));
        try {
          await interrupted;
          assertEquals((await accounting(m)).balance.reserved_credits, 1);
          const resumed = await runTool("source_with_apify", {
            ...jobInput,
            resume_run_id: "interrupted-run",
          }, ctx(m));
          assertEquals(resumed.ok, false);
          assertEquals(
            (resumed.data as { run_id?: string } | undefined)?.run_id,
            "interrupted-run",
            "failed GET must preserve the known purchase identity",
          );
          const state = await accounting(m);
          assertEquals(
            state.balance.balance_credits,
            9,
            "reading an existing run never proves its purchase absent",
          );
          assertEquals(
            state.operations.find((o) => o.kind === "provider")!
              .committed_microusd,
            "5000",
          );
          assertEquals(state.reconciled.length, 0);
          assertEquals(posts, 1);
        } finally {
          release();
          await original;
        }
      });
    },
  );
}

for (const status of [429, 500, 0]) {
  Deno.test(
    `A7 model failure: ${
      status || "timeout"
    } retries consume at most four Luna reservations`,
    opts,
    async () => {
      const m = await mission();
      let sends = 0;
      await inside(m, () => {
        sends++;
        if (!status) throw new DOMException("offline timeout", "TimeoutError");
        return json(
          { error: { message: "offline transient failure" } },
          status,
        );
      }, async () => {
        for (let n = 0; n < 3; n++) {
          const result = await gptStructured({
            purpose: "offline reliability",
            system: "s",
            user: "u",
            model: "gpt-5.6-luna",
            maxTokens: 4000,
          }, {
            readEnv: (key) =>
              key === "OPENAI_API_KEY" ? "offline-fake" : undefined,
            fetch: (u, i) => globalThis.fetch(u, i),
            sleep: async () => {},
          });
          assertEquals(result.ok, false);
        }
      });
      assertEquals(sends, 4);
      const state = await accounting(m);
      assertEquals(state.operations.length, 4);
      assertEquals(
        state.operations.reduce(
          (sum, x) => sum + Number(x.committed_microusd),
          0,
        ),
        49920,
      );
    },
  );
}

for (
  const reason of [
    "ownership_lost",
    "mission_cancelled",
    "caller_cancelled",
    "deadline",
  ]
) {
  Deno.test(
    `A7 transport: ${reason} interrupts an already admitted model request`,
    opts,
    async () => {
      const m = await mission();
      const owner = new AbortController(), caller = new AbortController();
      let sent!: () => void, unblock!: () => void;
      const dispatched = new Promise<void>((r) => sent = r);
      let observedSignal: AbortSignal | null | undefined;
      await inside(m, (_u, i) =>
        new Promise<Response>((resolve, reject) => {
          observedSignal = i.signal;
          unblock = () => resolve(json({}));
          if (i.signal?.aborted) reject(i.signal.reason);
          else {i.signal?.addEventListener(
              "abort",
              () => reject(i.signal!.reason),
              { once: true },
            );}
          sent();
        }), async () => {
        const request = fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          body: JSON.stringify({
            model: "gpt-5.6-luna",
            max_completion_tokens: 4000,
            messages: [],
          }),
          signal: caller.signal,
        }).then(() => false, () => true);
        try {
          await dispatched;
          assert(
            observedSignal,
            "admitted transport must have a cancellation/deadline signal",
          );
          if (reason === "caller_cancelled") caller.abort("caller_cancelled");
          else if (reason !== "deadline") owner.abort(reason);
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const interrupted = await Promise.race([
              request,
              new Promise<boolean>((r) =>
                timer = setTimeout(() => r(false), 1500)
              ),
            ]);
            assertEquals(
              interrupted,
              true,
              "transport stayed in flight past revocation/deadline",
            );
          } finally {
            clearTimeout(timer);
          }
        } finally {
          unblock();
          await request;
        }
      }, {
        signal: owner.signal,
        ...(reason === "deadline" ? { remainingMs: () => 100 } : {}),
      });
      const state = await accounting(m);
      assertEquals(state.operations.length, 1);
      assertEquals(
        state.operations[0].committed_microusd,
        "12480",
        "aborting never refunds a dispatched attempt",
      );
    },
  );
}

// The claim-five crash this file once characterized as a KNOWN DEFECT is fixed by
// held migration 20261019120000; its regression (the same scenario, inverted) is
// tests/db-contract/leadMissionExhaustedLease.contract.test.ts.
