// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  B,
  CB,
  CRED_B,
  envelope,
  modelFixture,
  TASK_B,
  UB,
} from "../_helpers/pilotModelFixture.ts";
import { runPilotModelProbe } from "../../../supabase/functions/_shared/pilot/pilotModelAdapter.ts";
import { noPaid } from "../_helpers/pilotScopeFixture.ts";
Deno.test("P4 exact selected model and client credential reach real gptStructured request; no global env fallback", async () => {
  const f = await modelFixture();
  const r = await runPilotModelProbe(f.scope, f.deps);
  const body = JSON.parse(String(f.calls[0].init.body));
  assertEquals(body.model, "gpt-4.1-mini");
  assertEquals(body.max_tokens, 256);
  assertEquals(
    (f.calls[0].init.headers as Record<string, string>).Authorization,
    "Bearer synthetic-key-A",
  );
  assertEquals(r.value, { ready: true });
  assertEquals(r.receipt.actual_model, "gpt-4.1-mini");
  assertEquals(r.receipt.request_id, "req-synthetic");
  assertEquals(r.receipt.transport_dispatched, true);
  assertEquals(f.accounting.receipts.size, 1);
  noPaid(f.n);
  assert(!JSON.stringify(r).includes("synthetic-key"));
  assert(
    !JSON.stringify([...f.accounting.started.values()]).includes("Return only"),
  );
});
Deno.test("P4 parallel A/B calls retain distinct keys, receipts and signed task scope", async () => {
  const a = await modelFixture(),
    b = await modelFixture(B, CB, UB, TASK_B, CRED_B);
  const [ra, rb] = await Promise.all([
    runPilotModelProbe(a.scope, a.deps),
    runPilotModelProbe(b.scope, b.deps),
  ]);
  assertEquals(
    (a.calls[0].init.headers as Record<string, string>).Authorization,
    "Bearer synthetic-key-A",
  );
  assertEquals(
    (b.calls[0].init.headers as Record<string, string>).Authorization,
    "Bearer synthetic-key-B",
  );
  assert(ra.receipt.workspace_id !== rb.receipt.workspace_id);
  assert(ra.receipt.attempt_id !== rb.receipt.attempt_id);
});
for (
  const reason of [
    "length",
    "content_filter",
    "tool_calls",
    "function_call",
    "missing",
  ] as const
) {
  Deno.test(`P4 T01-compatible explicit finish required: ${reason}`, async () => {
    const f = await modelFixture();
    f.response(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            envelope({
              choices: [{
                ...(reason === "missing" ? {} : { finish_reason: reason }),
                message: { content: '{"ready":true}' },
              }],
            }),
          ),
          { headers: { "x-request-id": "req-test" } },
        ),
      )
    );
    await assertRejects(() => runPilotModelProbe(f.scope, f.deps));
    assertEquals(f.calls.length, 1);
    const r = [...f.accounting.receipts.values()][0];
    assertEquals(
      r.failure_code,
      reason === "length" ? "incomplete_response" : "unexpected_completion",
    );
    assertEquals(r.usage.input_tokens, 100);
  });
}
for (
  const [name, changes, code] of [
    ["refusal", {
      choices: [{
        finish_reason: "stop",
        message: { refusal: "no", content: null },
      }],
    }, "schema_refused"],
    ["empty", {
      choices: [{ finish_reason: "stop", message: { content: "" } }],
    }, "empty_response"],
    ["malformed", {
      choices: [{ finish_reason: "stop", message: { content: '{"ready":' } }],
    }, "unparseable_json"],
    ["schema", {
      choices: [{
        finish_reason: "stop",
        message: { content: '{"wrong":true}' },
      }],
    }, "pilot_model_schema_invalid"],
    ["substitution", { model: "gpt-4.1" }, "pilot_model_identity_mismatch"],
    [
      "missing actual model",
      { model: undefined },
      "pilot_model_identity_mismatch",
    ],
    ["missing response id", { id: undefined }, "pilot_model_receipt_missing"],
    ["missing usage", { usage: undefined }, "pilot_model_usage_unknown"],
  ] as const
) {
  Deno.test(`P4 failure remains explicit/accounted: ${name}`, async () => {
    const f = await modelFixture();
    f.response(() =>
      Promise.resolve(
        new Response(JSON.stringify(envelope(changes)), {
          headers: { "x-request-id": "req-test" },
        }),
      )
    );
    await assertRejects(() => runPilotModelProbe(f.scope, f.deps));
    assertEquals([...f.accounting.receipts.values()][0].failure_code, code);
    assertEquals(f.calls.length, 1);
  });
}
for (const kind of ["429", "500", "timeout", "body-read-error"] as const) {
  Deno.test(`P4 no automatic paid retry/fallback: ${kind}`, async () => {
    const f = await modelFixture();
    f.response(() =>
      kind === "timeout"
        ? Promise.reject(Error("timeout synthetic-key-A"))
        : kind === "body-read-error"
        ? Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.reject(Error("broken body")),
          headers: new Headers(),
        } as Response)
        : Promise.resolve(new Response("{}", { status: Number(kind) }))
    );
    await assertRejects(() => runPilotModelProbe(f.scope, f.deps));
    assertEquals(f.calls.length, 1);
    assertEquals(f.accounting.started.size, 1);
    assertEquals(f.accounting.receipts.size, 1);
    await assertRejects(() => runPilotModelProbe(f.scope, f.deps));
    assertEquals(f.calls.length, 1);
    assert(
      !JSON.stringify([...f.accounting.receipts.values()]).includes(
        "synthetic-key",
      ),
    );
  });
}
Deno.test("P4 provider metadata cannot echo client credential into returned/stored receipts", async () => {
  const f = await modelFixture();
  f.response(() =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          envelope({ id: "synthetic-key-A", model: "synthetic-key-A" }),
        ),
        { headers: { "x-request-id": "synthetic-key-A" } },
      ),
    )
  );
  await assertRejects(() => runPilotModelProbe(f.scope, f.deps));
  assert(
    !JSON.stringify([...f.accounting.receipts.values()]).includes(
      "synthetic-key-A",
    ),
  );
});
Deno.test("P4 throwing credential resolver returns only explicit safe refusal", async () => {
  const f = await modelFixture();
  f.deps.resolveCredential = () => Promise.reject(Error("synthetic-key-A"));
  const e = await assertRejects(() => runPilotModelProbe(f.scope, f.deps));
  assert(e instanceof Error);
  assertEquals(e.message, "pilot_model_credential_unavailable");
  assertEquals(f.calls.length, 0);
});
Deno.test("P4 T01 precedence: refusal stays distinct; length outranks parseable or malformed content", async () => {
  for (
    const [message, code] of [[
      { refusal: "no", content: null },
      "schema_refused",
    ], [{ content: '{"ready":' }, "incomplete_response"]] as const
  ) {
    const f = await modelFixture();
    f.response(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            envelope({ choices: [{ finish_reason: "length", message }] }),
          ),
          { headers: { "x-request-id": "req-test" } },
        ),
      )
    );
    await assertRejects(() => runPilotModelProbe(f.scope, f.deps));
    assertEquals([...f.accounting.receipts.values()][0].failure_code, code);
    assertEquals(f.calls.length, 1);
  }
});
Deno.test("P4 missing request receipt or an unapproved dated model alias cannot release output", async () => {
  for (const alias of [null, "gpt-4.1-mini-2025-04-14"]) {
    const f = await modelFixture();
    f.response(() =>
      Promise.resolve(
        new Response(JSON.stringify(envelope(alias ? { model: alias } : {})), {
          headers: alias ? { "x-request-id": "req-test" } : {},
        }),
      )
    );
    await assertRejects(() => runPilotModelProbe(f.scope, f.deps));
    assertEquals(f.calls.length, 1);
  }
});

Deno.test("P4 endpoint is owned by existing gptProvider; global/loopback URL overrides cannot change dispatch", async () => {
  const f = await modelFixture();
  f.settings.OPENAI_BASE_URL = "http://localhost:9999";
  f.settings.OPENAI_API_KEY = "wrong-global-key";
  await runPilotModelProbe(f.scope, f.deps);
  assertEquals(f.calls[0].url, "https://api.openai.com/v1/chat/completions");
  assertEquals(
    (f.calls[0].init.headers as Record<string, string>).Authorization,
    "Bearer synthetic-key-A",
  );
});
