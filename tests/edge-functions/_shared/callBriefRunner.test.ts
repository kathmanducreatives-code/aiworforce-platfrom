// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runCallBrief } from "../../../supabase/functions/_shared/pilot/callBriefRunner.ts";
import { canonical } from "../../../supabase/functions/_shared/pilot/pilotScope.ts";
import {
  A,
  B,
  BOTH,
  CB,
  CRED_B,
  noPaid,
  task,
} from "../_helpers/pilotScopeFixture.ts";
import { briefFixture } from "../_helpers/callBriefFixture.ts";
import { envelope } from "../_helpers/pilotModelFixture.ts";
Deno.test("P6 real P1/P4/P5 path uses selected model and produces source-backed unreviewed draft only", async () => {
  const x = await briefFixture(), d = await runCallBrief(x.scope, x.deps);
  assertEquals(x.calls.length, 1);
  assertEquals(x.accounting.runtimeAttempts, 1);
  assertEquals(x.accounting.receipts.size, 1);
  assertEquals(x.briefs.writes, 1);
  const request = JSON.parse(String(x.calls[0].init.body));
  assertEquals(request.model, "gpt-4.1-mini");
  assertEquals(request.response_format.json_schema.name, "call_brief_v1");
  assertEquals(request.max_tokens, 512);
  assert(!request.tools);
  const prompt = request.messages.map((m: { content: string }) => m.content)
    .join(" ");
  assert(prompt.includes("PRIVATE_A_pipeline_support"));
  assert(!prompt.includes("PRIVATE_B"));
  assert(prompt.includes("No automated outreach"));
  assert(prompt.includes("not looking"));
  assertEquals(d.content.company_overview[0].value, "Buyer Demo");
  assertEquals(d.content.grounded_buying_signals, []);
  assertEquals(d.content.verified_facts, []);
  assertEquals(d.content.qualification_decision, null);
  assertEquals(d.review_status, "unreviewed_draft");
  assertEquals(d.review_required, true);
  assertEquals(d.dispatch_allowed, false);
  assertEquals(d.model_receipt.usage.input_tokens, 1700);
  assert(d.model_receipt.estimated_cost_usd! > 0);
  assertEquals(d.model_receipt.actual_provider, "openai");
  assertThrows(() => {
    d.content.company_overview[0].value = "invented";
  }, TypeError);
  noPaid(x.f.n);
});
Deno.test("P6 replay after Brain/source changes returns original draft without credential or model call", async () => {
  const x = await briefFixture(), d = await runCallBrief(x.scope, x.deps);
  const credentialReads = x.credentials.length;
  (x.row.profile as Record<string, unknown>).positioning = {
    offer: "new offer must not appear",
  };
  x.row.updated_at = "2026-10-21T00:00:00Z";
  x.deps.loadApprovedInputs = () => {
    throw Error("must not reload");
  };
  for (let i = 0; i < 3; i++) {
    assertEquals(await runCallBrief(x.scope, x.deps), d);
  }
  assertEquals(x.calls.length, 1);
  assertEquals(x.credentials.length, credentialReads);
  assertEquals(x.loads(), 1);
  assertEquals(x.briefs.writes, 1);
  noPaid(x.f.n);
});
Deno.test("P6 two signed clients with overlapping external identity never share context or drafts", async () => {
  const a = await briefFixture(), b = await briefFixture("B");
  const da = await runCallBrief(a.scope, a.deps),
    db = await runCallBrief(b.scope, b.deps);
  assertEquals(
    da.content.company_overview[0].value,
    db.content.company_overview[0].value,
  );
  assert(!JSON.stringify(da).includes("PRIVATE_B"));
  assert(!JSON.stringify(db).includes("PRIVATE_A"));
  assert(da.draft_hash !== db.draft_hash);
  a.deps.briefs.read = () => Promise.resolve(db);
  await assertRejects(() => runCallBrief(a.scope, a.deps));
  assertEquals(a.calls.length, 1);
  noPaid(a.f.n);
  noPaid(b.f.n);
});
for (
  const type of [
    "wrong-workspace",
    "wrong-client",
    "shared-user",
    "revoked",
    "cancelled",
    "payload",
    "policy",
    "model",
    "credential",
  ]
) {
  Deno.test(`P6 current authorization rejects ${type} on resume`, async () => {
    const x = await briefFixture();
    await runCallBrief(x.scope, x.deps);
    const s = { ...x.scope };
    switch (type) {
      case "wrong-workspace":
        s.workspace_id = B;
        break;
      case "wrong-client":
        s.client_binding_id = CB;
        break;
      case "shared-user":
        x.deps.user_id = BOTH;
        break;
      case "revoked":
        x.f.n.tables.workspace_members = [];
        break;
      case "cancelled":
        task(x.f, x.scope.task_id).status = "cancelled";
        break;
      case "payload":
        (task(x.f, x.scope.task_id).payload as Record<string, unknown>)
          .instruction = "changed";
        break;
      case "policy":
        x.policy.version++;
        break;
      case "model":
        x.policy.model = "other-model";
        break;
      case "credential":
        x.policy.credential_id = CRED_B;
        break;
    }
    await assertRejects(() => runCallBrief(s, x.deps));
    assertEquals(x.calls.length, 1);
    noPaid(x.f.n);
  });
}
for (const provider of ["anthropic", "google", "unknown"]) {
  Deno.test(`P6 unsupported selected provider ${provider} never falls back`, async () => {
    const x = await briefFixture("A", { provider });
    await assertRejects(() => runCallBrief(x.scope, x.deps));
    assertEquals(x.calls.length, 0);
    assertEquals(x.credentials.length, 0);
    assertEquals(x.accounting.runtimeAttempts, 0);
    noPaid(x.f.n);
  });
}
for (
  const finish of [
    "length",
    "content_filter",
    "tool_calls",
    "function_call",
    null,
    "missing",
  ]
) {
  Deno.test(`P6 parseable JSON with termination ${finish} cannot produce a brief or buy retries`, async () => {
    const x = await briefFixture();
    const choice: Record<string, unknown> = {
      message: { content: JSON.stringify(x.choice) },
    };
    if (finish !== "missing") choice.finish_reason = finish;
    x.response(() =>
      Promise.resolve(
        new Response(JSON.stringify(envelope({ choices: [choice] })), {
          headers: { "x-request-id": "req-failure" },
        }),
      )
    );
    await assertRejects(() => runCallBrief(x.scope, x.deps));
    await assertRejects(() => runCallBrief(x.scope, x.deps));
    assertEquals(x.calls.length, 1);
    assertEquals(x.accounting.runtimeAttempts, 1);
    assertEquals(x.accounting.receipts.size, 1);
    assertEquals(x.briefs.writes, 0);
    const receipt = [...x.accounting.receipts.values()][0];
    assertEquals(receipt.status, "failed");
    assertEquals(
      receipt.failure_code,
      finish === "length" ? "incomplete_response" : "unexpected_completion",
    );
    assert(receipt.estimated_cost_usd! > 0);
    noPaid(x.f.n);
  });
}
for (
  const type of [
    "timeout",
    "http-429",
    "http-500",
    "refusal",
    "empty",
    "malformed",
    "fabricated",
    "missing-evidence",
  ]
) {
  Deno.test(`P6 ${type} stays failed and accounted with no repair`, async () => {
    const x = await briefFixture();
    x.response(() => {
      if (type === "timeout") return Promise.reject(Error("synthetic timeout"));
      if (type.startsWith("http")) {
        return Promise.resolve(
          new Response('{"error":{"message":"not logged"}}', {
            status: type === "http-429" ? 429 : 500,
          }),
        );
      }
      const v = type === "fabricated"
        ? {
          ...x.choice,
          company_overview: [{
            text: "They raised $20m",
            fact_ids: x.choice.company_overview,
          }],
        }
        : type === "missing-evidence"
        ? { ...x.choice, company_overview: ["other-company-fact"] }
        : x.choice;
      return Promise.resolve(
        new Response(
          JSON.stringify(envelope({
            choices: [{
              finish_reason: "stop",
              message: type === "refusal"
                ? { refusal: "cannot comply", content: null }
                : {
                  content: type === "empty"
                    ? ""
                    : type === "malformed"
                    ? '{"partial":'
                    : JSON.stringify(v),
                },
            }],
          })),
          { headers: { "x-request-id": "req-failure" } },
        ),
      );
    });
    await assertRejects(() => runCallBrief(x.scope, x.deps));
    await assertRejects(() => runCallBrief(x.scope, x.deps));
    assertEquals(x.calls.length, 1);
    assertEquals(x.accounting.runtimeAttempts, 1);
    assertEquals(x.accounting.receipts.size, 1);
    assertEquals(x.briefs.writes, 0);
    noPaid(x.f.n);
  });
}
Deno.test("P6 concurrent generation consumes one shared attempt; only one caller receives new output", async () => {
  const x = await briefFixture();
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, () => runCallBrief(x.scope, x.deps)),
  );
  assert(results.some((r) => r.status === "fulfilled"));
  assertEquals(x.calls.length, 1);
  assertEquals(x.accounting.runtimeAttempts, 1);
  assertEquals(x.briefs.writes, 1);
  noPaid(x.f.n);
});
for (
  const type of [
    "four-attempts",
    "model-budget",
    "provider-budget",
    "combined-budget",
    "workspace-budget",
    "input-limit",
    "disabled",
    "consent",
    "credentials",
  ]
) {
  Deno.test(`P6 ${type} admission refusal dispatches nothing`, async () => {
    const x = await briefFixture();
    switch (type) {
      case "four-attempts":
        x.accounting.runtimeAttempts = 4;
        break;
      case "model-budget":
        x.accounting.modelSpent = 0.05;
        break;
      case "provider-budget":
        x.accounting.providerSpent = 0.201;
        break;
      case "combined-budget":
        x.policy.combined_budget_usd = 0.202;
        x.accounting.modelSpent = 0.001;
        x.accounting.providerSpent = 0.20;
        break;
      case "workspace-budget":
        x.f.n.tables.lead_model_calls = [{
          workspace_id: A,
          estimated_cost_usd: 0.05,
          started_at: new Date().toISOString(),
          cost_source: "event_priced",
          actual_cost_usd: null,
        }];
        break;
      case "input-limit":
        x.policy.max_input_tokens = 100;
        break;
      case "disabled":
        x.policy.execution_enabled = false;
        break;
      case "consent":
        x.policy.data_sharing_approved = false;
        break;
      case "credentials":
        x.deps.resolveCredential = () => Promise.resolve(null);
        break;
    }
    await assertRejects(() => runCallBrief(x.scope, x.deps));
    assertEquals(x.calls.length, 0);
    assertEquals(x.briefs.writes, 0);
    noPaid(x.f.n);
  });
}
Deno.test("P6 settlement failure holds result and reservation; retry cannot buy replacement", async () => {
  const x = await briefFixture();
  x.accounting.settleFail = true;
  await assertRejects(() => runCallBrief(x.scope, x.deps));
  x.accounting.settleFail = false;
  await assertRejects(() => runCallBrief(x.scope, x.deps));
  assertEquals(x.calls.length, 1);
  assertEquals(x.briefs.writes, 0);
  assertEquals(x.accounting.receipts.size, 0);
  assert(x.accounting.modelSpent > 0);
  noPaid(x.f.n);
});
Deno.test("P6 failed output persistence never returns a draft or automatically regenerates", async () => {
  const x = await briefFixture();
  x.briefs.failBefore = true;
  await assertRejects(() => runCallBrief(x.scope, x.deps));
  x.briefs.failBefore = false;
  await assertRejects(() => runCallBrief(x.scope, x.deps));
  assertEquals(x.calls.length, 1);
  assertEquals(x.briefs.writes, 0);
  assertEquals(x.accounting.receipts.size, 1);
  noPaid(x.f.n);
});
Deno.test("P6 lost output commit acknowledgement resumes original without repurchase", async () => {
  const x = await briefFixture();
  x.briefs.failAfter = true;
  await assertRejects(() => runCallBrief(x.scope, x.deps));
  x.briefs.failAfter = false;
  const d = await runCallBrief(x.scope, x.deps);
  assertEquals(canonical(d), canonical(await x.briefs.read(x.scope)));
  assertEquals(x.calls.length, 1);
  assertEquals(x.briefs.writes, 1);
  noPaid(x.f.n);
});
Deno.test("P6 output corruption is not returned or repaired", async () => {
  const x = await briefFixture();
  await runCallBrief(x.scope, x.deps);
  x.briefs.rows.get(x.briefs.key(x.scope))!.content.company_overview[0].value =
    "Fabricated funding";
  await assertRejects(() => runCallBrief(x.scope, x.deps));
  assertEquals(x.calls.length, 1);
  noPaid(x.f.n);
});
for (
  const type of [
    "missing-usage",
    "wrong-model",
    "excess-usage",
    "missing-receipt",
  ]
) {
  Deno.test(`P6 ${type} never releases output and settles once`, async () => {
    const x = await briefFixture();
    x.response(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(envelope({
            choices: [{
              finish_reason: "stop",
              message: { content: JSON.stringify(x.choice) },
            }],
            ...(type === "missing-usage"
              ? { usage: null }
              : type === "wrong-model"
              ? { model: "unexpected-model" }
              : type === "excess-usage"
              ? { usage: { prompt_tokens: 100, completion_tokens: 513 } }
              : {}),
          })),
          {
            headers: type === "missing-receipt"
              ? {}
              : { "x-request-id": "req-usage" },
          },
        ),
      )
    );
    await assertRejects(() => runCallBrief(x.scope, x.deps));
    assertEquals(x.calls.length, 1);
    assertEquals(x.accounting.receipts.size, 1);
    assertEquals(x.briefs.writes, 0);
    await assertRejects(() => runCallBrief(x.scope, x.deps));
    assertEquals(x.calls.length, 1);
    noPaid(x.f.n);
  });
}
Deno.test("P6 cancellation after reservation is accounted as an undispatched held attempt", async () => {
  const x = await briefFixture(), abort = new AbortController();
  x.deps.signal = abort.signal;
  const reserve = x.accounting.reserve.bind(x.accounting);
  x.accounting.reserve = async (a) => {
    const r = await reserve(a);
    abort.abort();
    return r;
  };
  await assertRejects(() => runCallBrief(x.scope, x.deps));
  assertEquals(x.calls.length, 0);
  assertEquals(x.accounting.runtimeAttempts, 1);
  const receipt = [...x.accounting.receipts.values()][0];
  assertEquals(receipt.transport_dispatched, false);
  assertEquals(receipt.accounting_uncertain, true);
  assertEquals(x.briefs.writes, 0);
  noPaid(x.f.n);
});
Deno.test("P6 cancellation during transport withholds draft after accounting actual usage", async () => {
  const x = await briefFixture();
  x.response(() => {
    task(x.f, x.scope.task_id).status = "cancelled";
    return Promise.resolve(
      new Response(
        JSON.stringify(
          envelope({
            choices: [{
              finish_reason: "stop",
              message: { content: JSON.stringify(x.choice) },
            }],
          }),
        ),
        { headers: { "x-request-id": "req-cancel" } },
      ),
    );
  });
  await assertRejects(() => runCallBrief(x.scope, x.deps));
  assertEquals(x.calls.length, 1);
  assertEquals(x.accounting.receipts.size, 1);
  assertEquals(x.briefs.writes, 0);
  noPaid(x.f.n);
});
Deno.test("P6 disabled execution mode and unbound source packet refuse before model operations", async () => {
  for (const type of ["live", "missing-packet", "read-failure"]) {
    const x = await briefFixture();
    if (type === "live") Object.assign(x.deps, { mode: "live" });
    if (type === "missing-packet") {
      x.deps.loadApprovedInputs = () =>
        Promise.reject(Error("no approved sources"));
      x.snapshots.packets.clear();
    }
    if (type === "read-failure") x.briefs.failRead = true;
    await assertRejects(() => runCallBrief(x.scope, x.deps));
    assertEquals(x.calls.length, 0);
    assertEquals(x.accounting.runtimeAttempts, 0);
    noPaid(x.f.n);
  }
});
for (const mode of ["csv_only", "conflict", "stale"] as const) {
  Deno.test(`P6 ${mode} evidence remains explicitly unverified in real draft path`, async () => {
    const x = await briefFixture("A", {}, mode),
      d = await runCallBrief(x.scope, x.deps);
    assertEquals(d.content.verified_facts, []);
    assertEquals(d.content.grounded_buying_signals, []);
    if (mode === "csv_only") {
      assertEquals(d.content.signal_evidence_for_human_review, []);
    }
    if (mode === "conflict") {
      assert(
        d.content.signal_evidence_for_human_review.every((f) =>
          f.provenance_class === "conflicting"
        ),
      );
      assertEquals(d.content.discovery_questions[0].kind, "clarify_conflict");
    }
    if (mode === "stale") {
      assert(
        d.content.missing_information.some((u) =>
          u.reason === "source_stale:website"
        ),
      );
    }
    assert(
      d.content.reviewed_client_instructions.some((b) =>
        b.value === "No automated outreach"
      ),
    );
    assertEquals(d.source_lineage.imported_row_id, null);
    noPaid(x.f.n);
  });
}
Deno.test("P6 wrong-client frozen packet is refused before credential resolution or generation", async () => {
  const a = await briefFixture(), b = await briefFixture("B");
  a.deps.snapshots.read = () => Promise.resolve(b.packet);
  await assertRejects(() => runCallBrief(a.scope, a.deps));
  assertEquals(a.calls.length, 0);
  assertEquals(a.credentials.length, 0);
  noPaid(a.f.n);
  noPaid(b.f.n);
});
Deno.test("P6 actual generated draft survives serialized presentation; every displayed fact keeps task scope", async () => {
  const { callBriefView } = await import(
    "../../../src/lib/pilot/callBriefView.ts"
  );
  const x = await briefFixture(),
    d = await runCallBrief(x.scope, x.deps),
    v = callBriefView(JSON.parse(canonical(d)), x.scope);
  assertEquals(v.company[0].value, "Buyer Demo");
  assert(v.signals[0].value.includes("not looking"));
  assertEquals(v.provider, "openai");
  assertEquals(v.model, "gpt-4.1-mini");
  noPaid(x.f.n);
});
Deno.test("P6 does not repurchase when P5 saved inputs are reordered by JSONB-style storage", async () => {
  const x = await briefFixture();
  x.snapshots.packets.set(
    x.snapshots.key(x.scope),
    JSON.parse(canonical(x.packet)),
  );
  await assertRejects(
    () => runCallBrief(x.scope, x.deps),
    Error,
    "snapshot_stored_integrity_failure",
  );
  assertEquals(x.calls.length, 0);
  assertEquals(x.credentials.length, 0);
  noPaid(x.f.n);
});
Deno.test("P6 distinct transport failure codes preserve refusal, empty content and malformed JSON", async () => {
  for (
    const [message, code] of [
      [{ refusal: "No", content: null }, "schema_refused"],
      [{ content: "" }, "empty_response"],
      [{ content: "{" }, "unparseable_json"],
    ] as const
  ) {
    const x = await briefFixture();
    x.response(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            envelope({ choices: [{ finish_reason: "stop", message }] }),
          ),
          { headers: { "x-request-id": "req-distinct" } },
        ),
      )
    );
    await assertRejects(() => runCallBrief(x.scope, x.deps));
    assertEquals([...x.accounting.receipts.values()][0].failure_code, code);
    assertEquals(x.accounting.receipts.size, 1);
    assertEquals(x.briefs.writes, 0);
    noPaid(x.f.n);
  }
});
Deno.test("P6 valid but misleading excerpt retains full negating context in model prompt and human draft", async () => {
  const x = await briefFixture("A", {}, "misleading_excerpt"),
    d = await runCallBrief(x.scope, x.deps);
  assert(
    d.content.signal_evidence_for_human_review[0].value.startsWith(
      "looking for",
    ),
  );
  assert(d.content.source_snapshots_for_review[0].body.includes("not looking"));
  assert(
    JSON.parse(String(x.calls[0].init.body)).messages[1].content.includes(
      "not looking",
    ),
  );
  assertEquals(d.content.grounded_buying_signals, []);
  assertEquals(d.content.verified_facts, []);
  noPaid(x.f.n);
});
