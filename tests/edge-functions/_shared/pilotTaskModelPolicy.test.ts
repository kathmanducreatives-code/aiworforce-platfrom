// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  A,
  B,
  CB,
  CRED_B,
  modelFixture,
  task,
  UB,
} from "../_helpers/pilotModelFixture.ts";
import { runPilotModelProbe } from "../../../supabase/functions/_shared/pilot/pilotModelAdapter.ts";
import {
  PILOT_HARD_LIMITS,
  PILOT_MODEL_REGISTRY,
} from "../../../supabase/functions/_shared/pilot/pilotModelRegistry.ts";
Deno.test("P4 all registry options disabled, Claude/Gemini not implemented; existing A7 caps unchanged", () => {
  assertEquals(PILOT_MODEL_REGISTRY.every((x) => !x.enabled), true);
  assertEquals(PILOT_HARD_LIMITS, {
    runtime_attempts: 4,
    model_usd: 0.05,
    provider_usd: 0.20,
    combined_usd: 0.25,
  });
});
for (
  const kind of [
    "disabled",
    "no-consent",
    "foreign-policy",
    "stale-version",
    "foreign-credential",
    "wrong-user",
    "foreign-task",
    "mutated-selection",
    "unknown-field",
    "unpriced",
    "oversized-budget",
    "oversized-tokens",
    "revoked",
    "cancelled",
    "missing-key",
    "input-limit",
  ] as const
) {
  Deno.test(`P4 zero transport on policy/auth refusal: ${kind}`, async () => {
    const f = await modelFixture();
    if (kind === "disabled") f.policy.execution_enabled = false;
    if (kind === "no-consent") f.policy.data_sharing_approved = false;
    if (kind === "foreign-policy") f.policy.workspace_id = B;
    if (kind === "stale-version") f.policy.version = 2;
    if (kind === "foreign-credential") f.policy.credential_id = CRED_B;
    if (kind === "wrong-user") f.deps.user_id = UB;
    if (kind === "foreign-task") f.scope.workspace_id = B;
    if (kind === "mutated-selection") {
      (task(f.p1).payload as Record<string, unknown>).pilot_model = {
        ...f.selection,
        provider: "anthropic",
      };
    }
    if (kind === "unknown-field") Object.assign(f.policy, { fallback: true });
    if (kind === "unpriced") Object.assign(f.policy, { model: "unpriced-gpt" });
    if (kind === "oversized-budget") f.policy.model_budget_usd = 0.051;
    if (kind === "oversized-tokens") f.policy.max_output_tokens = 513;
    if (kind === "revoked") {
      f.n.tables.workspace_members = f.n.tables.workspace_members.filter((x) =>
        x.user_id !== f.deps.user_id
      );
    }
    if (kind === "cancelled") f.deps.signal = AbortSignal.abort();
    if (kind === "missing-key") {
      f.deps.resolveCredential = () => Promise.resolve(null);
    }
    if (kind === "input-limit") f.policy.max_input_tokens = 1;
    await assertRejects(() => runPilotModelProbe(f.scope, f.deps));
    assertEquals(f.calls.length, 0);
    assertEquals(f.accounting.receipts.size, 0);
  });
}
Deno.test("P4 signed client A task cannot execute under B even for shared-user settings", async () => {
  const f = await modelFixture();
  await assertRejects(() =>
    runPilotModelProbe(
      { ...f.scope, workspace_id: B, client_binding_id: CB },
      f.deps,
    )
  );
  assertEquals(f.calls.length, 0);
  assertEquals(f.policy.workspace_id, A);
});
for (
  const value of [
    { provider: "anthropic" },
    { provider: "google" },
    { model: "gpt-4.1" },
    { model: "gpt-4.1-mini-fake" },
    { fallback: true },
    { task_kind: "lead_qualification" },
    { schema: "arbitrary_schema" },
    { credential_id: CRED_B },
  ]
) {
  Deno.test(`P4 even signed selections reject unsupported/foreign policy: ${JSON.stringify(value)}`, async () => {
    const f = await modelFixture(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      value,
    );
    if (value.credential_id) f.policy.credential_id = value.credential_id;
    await assertRejects(() => runPilotModelProbe(f.scope, f.deps));
    assertEquals(f.calls.length, 0);
  });
}

Deno.test("P4 live execution mode is absent even if a caller supplies an enabled policy", async () => {
  const f = await modelFixture();
  Object.assign(f.deps, { mode: "live" });
  await assertRejects(() => runPilotModelProbe(f.scope, f.deps));
  assertEquals(f.calls.length, 0);
});
Deno.test("P4 malformed or expanded task scope rejected before admission", async () => {
  const f = await modelFixture();
  for (
    const scope of [{ ...f.scope, task_id: "bad" }, {
      ...f.scope,
      provider: "anthropic",
    }]
  ) await assertRejects(() => runPilotModelProbe(scope, f.deps));
  assertEquals(f.calls.length, 0);
  assertEquals(f.accounting.reserveCalls, 0);
});

Deno.test("P4 cancelled, completed, paused or otherwise non-ready signed tasks cannot dispatch", async () => {
  for (
    const status of [
      "cancelled",
      "canceled",
      "done",
      "completed",
      "failed",
      "paused",
      "running",
      "unknown",
    ]
  ) {
    const f = await modelFixture();
    task(f.p1).status = status;
    await assertRejects(() => runPilotModelProbe(f.scope, f.deps));
    assertEquals(f.calls.length, 0);
    assertEquals(f.accounting.started.size, 0);
  }
});
