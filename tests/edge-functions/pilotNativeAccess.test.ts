// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { guardPilotStore } from "../../supabase/functions/_shared/pilot/pilotNativeAccess.ts";
import { PilotRefusal } from "../../supabase/functions/_shared/pilot/pilotPolicy.ts";
import type { PilotScopeStore } from "../../supabase/functions/_shared/pilot/pilotScopeStore.ts";
import { A, B, CA, TASK_A } from "./_helpers/pilotScopeFixture.ts";
function setup(responses: Array<boolean | string | number | Error>) {
  let reads = 0, calls = 0;
  const store: PilotScopeStore = {
    member: () => {
      reads++;
      return Promise.resolve({ role: "owner" });
    },
    brain: () => {
      reads++;
      return Promise.resolve({ workspace_id: A });
    },
    records: () => {
      reads++;
      return Promise.resolve([]);
    },
    bind: () => {
      reads++;
      return Promise.resolve({});
    },
  };
  const requests: Record<string, unknown>[] = [];
  const guarded = guardPilotStore(
    store,
    {
      env: (k) =>
        k === "SUPABASE_URL"
          ? "https://local.invalid"
          : k === "SUPABASE_ANON_KEY"
          ? "anon"
          : undefined,
      fetch: (_input, init) => {
        calls++;
        requests.push(JSON.parse(String(init?.body)));
        assertEquals(
          new Headers(init?.headers).get("Authorization"),
          "Bearer original-token",
        );
        const next = responses.shift();
        if (next instanceof Error) return Promise.reject(next);
        return Promise.resolve(
          new Response(
            typeof next === "string" ? next : JSON.stringify(next),
            { status: typeof next === "number" ? next : 200 },
          ),
        );
      },
    },
    "original-token",
    {
      workspace_id: A,
      client_binding_id: CA,
      version: 1,
      seller_domain: "a.example",
      mode: "draft_only",
      credentials: [],
      destinations: [],
    },
    TASK_A,
  );
  return { guarded, requests, stats: () => ({ reads, calls }) };
}
for (
  const [response, status] of [
    [false, 403],
    ["{}", 403],
    ["true trailing", 503],
    [404, 503],
    [401, 403],
    [new Error("timeout"), 503],
  ] as const
) {
  Deno.test(`native guard refuses ${String(response)} before privileged read`, async () => {
    const x = setup([response]);
    const e = await assertRejects(() => x.guarded.brain(A), PilotRefusal);
    assertEquals(e.status, status);
    assertEquals(x.stats(), { reads: 0, calls: 1 });
  });
}
Deno.test("native guard rechecks revocation after privileged read and withholds result", async () => {
  const x = setup([true, false]);
  await assertRejects(() => x.guarded.brain(A), PilotRefusal);
  assertEquals(x.stats(), { reads: 1, calls: 2 });
});
Deno.test("native guard preserves original scope/version/task on every retry", async () => {
  const x = setup([true, true, true, true]);
  for (let i = 0; i < 2; i++) {
    assertEquals(await x.guarded.brain(A), { workspace_id: A });
  }
  assertEquals(
    x.requests,
    Array(4).fill({
      p_workspace: A,
      p_client: CA,
      p_version: 1,
      p_task: TASK_A,
    }),
  );
  await assertRejects(() => x.guarded.brain(B), PilotRefusal);
  assertEquals(x.stats(), { reads: 2, calls: 4 });
});
Deno.test("native guard attests each task ancestor instead of inheriting the root privilege", async () => {
  const x = setup([true, false]);
  await assertRejects(
    () => x.guarded.records(A, "task", [TASK_A]),
    PilotRefusal,
  );
  assertEquals(x.stats(), { reads: 0, calls: 2 });
});
