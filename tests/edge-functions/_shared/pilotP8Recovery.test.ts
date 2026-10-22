// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { briefFixture } from "../_helpers/callBriefFixture.ts";
import { runCallBrief } from "../../../supabase/functions/_shared/pilot/callBriefRunner.ts";
import { noPaid, task } from "../_helpers/pilotScopeFixture.ts";

for (
  const failure of ["settlement", "before-output", "after-output", "cancel"]
) {
  Deno.test(`P8 V2 recovery ${failure} cannot purchase a second model attempt`, async () => {
    const x = await briefFixture("A", {}, "normal", "pilot_context_v2");
    if (failure === "settlement") x.accounting.settleFail = true;
    if (failure === "before-output") x.briefs.failBefore = true;
    if (failure === "after-output") x.briefs.failAfter = true;
    if (failure === "cancel") {
      const original = x.deps.accounting.settle.bind(x.accounting);
      x.deps.accounting.settle = async (r) => {
        await original(r);
        task(x.f, x.scope.task_id).status = "cancelled";
      };
    }
    await assertRejects(() => runCallBrief(x.scope, x.deps));
    x.accounting.settleFail = false;
    x.briefs.failBefore = false;
    x.briefs.failAfter = false;
    // New dependency object, same surviving store: simulates adapter restart,
    // not durable Postgres/process-loss proof.
    const resumed = { ...x.deps };
    if (failure === "after-output") {
      const out = await runCallBrief(x.scope, resumed);
      assertEquals(out.packet_hash, x.packet.packet_hash);
    } else {
      await assertRejects(() => runCallBrief(x.scope, resumed));
    }
    assertEquals(x.calls.length, 1);
    assertEquals(x.accounting.runtimeAttempts, 1);
    assertEquals(x.accounting.receipts.size, failure === "settlement" ? 0 : 1);
    noPaid(x.f.n);
  });
}
