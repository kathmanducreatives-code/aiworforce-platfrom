// Actual native parent integrity + original P1 prepare path; synthetic local data.
// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  closeHarness,
  REST_URL,
  sql,
  uuid,
} from "../db-contract/lib/harness.ts";
import { api } from "./fixture.ts";
import { authUrl, login } from "./lib/auth.ts";
import { invoke, registrationDeps } from "./lib/taskRegistration.ts";
try {
  const { x, session } = await login();
  const ownAccount = uuid(), foreignAccount = uuid();
  await sql`insert into public.accounts(id,workspace_id,name,domain) values
    (${ownAccount},${x.a},'Synthetic overlap','shared.synthetic.example'),
    (${foreignAccount},${x.b},'Synthetic overlap','shared.synthetic.example')`;
  const hidden = await api(
    session.access_token,
    `accounts?id=eq.${foreignAccount}&select=id`,
    "GET",
    undefined,
    "public",
  );
  assertEquals(hidden.status, 200);
  assertEquals(
    hidden.body,
    [],
    "actor must not be allowed to see foreign parent",
  );
  let authRequests = 0;
  const deps = await registrationDeps(x, (input, init) => {
    authRequests++;
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    assert(
      url.startsWith(REST_URL + "/auth/v1/"),
      "no provider/model/send fetch",
    );
    return fetch(url.replace(REST_URL + "/auth/v1", authUrl), init);
  });
  const traces = [];
  for (
    const [label, parent] of [["own_parent", ownAccount], [
      "foreign_parent",
      foreignAccount,
    ]]
  ) {
    const contact = uuid(), task = uuid();
    const write = await api(session.access_token, "contacts", "POST", {
      id: contact,
      workspace_id: x.a,
      account_id: parent,
      full_name: "Synthetic approved contact",
    }, "public");
    const persisted =
      await sql`select c.workspace_id,c.account_id,a.workspace_id as parent_workspace_id from public.contacts c left join public.accounts a on a.id=c.account_id where c.id=${contact}`;
    if (label === "own_parent") {
      assertEquals(write.status, 201);
      assertEquals(
        persisted.length,
        1,
        "positive control must actually persist",
      );
    } else {
      assert(
        [201, 400, 403, 409].includes(write.status),
        "unexpected API failure needs investigation",
      );
    }
    await sql`insert into public.tasks(id,workspace_id,user_id,status,payload) values
      (${task},${x.a},${x.ua},'ready',${
      sql.json({
        execution_mode: "pilot_draft_only",
        approved_input: "synthetic existing contact",
      })
    })`;
    const prepared = await invoke(
      deps,
      session.access_token,
      "prepare",
      x.a,
      x.ca,
      task,
      { resources: [{ kind: "contact", id: contact }] },
    );
    const response = await prepared.json();
    const [state] =
      await sql`select (payload ? 'pilot_scope') as signed from public.tasks where id=${task}`;
    const bindings =
      await sql`select task_id from outpost_private.task_bindings where task_id=${task}`;
    if (label === "own_parent") {
      assertEquals(prepared.status, 200);
      assertEquals(state.signed, true);
      assertEquals(bindings.length, 1);
    } else {
      assert(
        [403, 404, 409].includes(prepared.status),
        "P1 must refuse a missing or cross-workspace parent",
      );
      assertEquals(state.signed, false);
      assertEquals(bindings.length, 0, "no rejected task registration");
    }
    traces.push({
      scenario: label,
      raw_api_status: write.status,
      persisted_rows: persisted.length,
      wrong_workspace_parent_persisted: label === "foreign_parent" &&
        persisted.some((r) =>
          r.workspace_id === x.a && r.parent_workspace_id !== x.a
        ),
      unapproved_cross_scope_request_persisted: label === "foreign_parent" &&
        persisted.length > 0,
      stored_parent_rows: Array.from(persisted),
      pilot_prepare_status: prepared.status,
      pilot_response: response,
      signed: state.signed,
      binding_count: bindings.length,
    });
  }
  const wrong = traces.find((r) => r.scenario === "foreign_parent")!;
  const report = {
    foreign_parent_visible: false,
    auth_requests: authRequests,
    traces,
    raw_parent_integrity: wrong.unapproved_cross_scope_request_persisted
      ? "FAIL"
      : "PASS",
    pilot_parent_integrity: "PASS",
    same_workspace_client_isolation: "NOT_TESTED",
    phase_1: "FAIL",
    customer_pilot_ready: false,
  };
  console.log("RESOURCE_PARENT_JSON_BEGIN");
  console.log(JSON.stringify(report, null, 2));
  console.log("RESOURCE_PARENT_JSON_END");
  Deno.exitCode = report.raw_parent_integrity === "FAIL" ? 1 : 0;
} finally {
  await closeHarness();
}
