// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { TASK_MODEL_OPTIONS } from "../../src/lib/pilot/taskModelOptions.ts";
import { PILOT_MODEL_REGISTRY } from "../../supabase/functions/_shared/pilot/pilotModelRegistry.ts";
Deno.test("P4 no UI model may be enabled, every provider has explicit unavailable reason", () => {
  assertEquals(
    TASK_MODEL_OPTIONS.map((x) => [x.provider, x.model, x.enabled]),
    PILOT_MODEL_REGISTRY.map((x) => [x.provider, x.model, x.enabled]),
  );
  assert(TASK_MODEL_OPTIONS.every((x) => !x.enabled && x.reason.length > 20));
});
Deno.test("P4 selector is not connected to settings writes, existing executor or network", async () => {
  const ui = await Deno.readTextFile(
    "src/components/leads/pilot/TaskModelSelector.tsx",
  );
  assert(ui.includes('disabled value=""'));
  assert(ui.includes("No selection is saved"));
  assert(!/invokeFunction|fetch\(|\.update\(|\.insert\(|run-agent/.test(ui));
  const page = await Deno.readTextFile("src/pages/OutpostWorkspace.tsx");
  assert(!page.includes("TaskModelSelector"));
});
