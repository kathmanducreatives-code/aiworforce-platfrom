import { installStrictNetwork, type StrictNet } from "./strictNetwork.ts";
import { canonical } from "../../../supabase/functions/_shared/pilot/pilotScope.ts";
import type { Row } from "../../../supabase/functions/_shared/pilot/pilotScopeStore.ts";
export const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const A = id(1),
  B = id(2),
  CA = id(11),
  CB = id(12),
  UA = id(21),
  UB = id(22),
  BOTH = id(23);
export const ACCOUNT_A = id(101),
  ACCOUNT_B = id(102),
  CONTACT_A = id(201),
  CONTACT_B = id(202),
  TASK_A = id(301),
  TASK_B = id(302),
  MEMORY_A = id(401),
  MEMORY_B = id(402),
  RESEARCH_A = id(501),
  RESEARCH_B = id(502),
  DRAFT_A = id(601),
  LEAD_A = id(701);
export const CRED_A = id(801),
  CRED_B = id(802),
  DEST_A = id(901),
  DEST_B = id(902);
export const SIGNING =
  "synthetic-p1-signing-key-not-a-production-secret-123456";
export function fixture() {
  const policy = {
    version: 1,
    workspaces: [
      {
        workspace_id: A,
        client_binding_id: CA,
        seller_domain: "client-a.example",
        version: 1,
        mode: "draft_only",
        credentials: [{
          id: CRED_A,
          provider: "openai",
          purpose: "call_brief",
          reference: "CLIENT_A_OPENAI",
        }],
        destinations: [{ id: DEST_A, kind: "manual_csv" }],
      },
      {
        workspace_id: B,
        client_binding_id: CB,
        seller_domain: "client-b.example",
        version: 1,
        mode: "draft_only",
        credentials: [{
          id: CRED_B,
          provider: "openai",
          purpose: "call_brief",
          reference: "CLIENT_B_OPENAI",
        }],
        destinations: [{ id: DEST_B, kind: "manual_csv" }],
      },
    ],
  };
  const tables: Record<string, Row[]> = {
    workspace_members: [
      { workspace_id: A, user_id: UA, role: "owner" },
      { workspace_id: B, user_id: UB, role: "owner" },
      { workspace_id: A, user_id: BOTH, role: "admin" },
      { workspace_id: B, user_id: BOTH, role: "admin" },
    ],
    company_brain: [{
      workspace_id: A,
      onboarding_completed: true,
      profile: {
        company: {
          name: "Client A",
          website_url: "https://client-a.example",
          description: "PRIVATE_A_VOICE",
        },
        target_customer: { industries: ["Software"] },
      },
      updated_at: "2026-10-20T00:00:00Z",
    }, {
      workspace_id: B,
      onboarding_completed: true,
      profile: {
        company: {
          name: "Client B",
          website_url: "https://client-b.example",
          description: "PRIVATE_B_VOICE",
        },
        target_customer: { industries: ["Manufacturing"] },
      },
      updated_at: "2026-10-20T00:00:00Z",
    }],
    accounts: [{
      id: ACCOUNT_A,
      workspace_id: A,
      name: "Account A",
      domain: "overlap.example",
      raw: { apollo_id: "same-company-id" },
    }, {
      id: ACCOUNT_B,
      workspace_id: B,
      name: "Account B",
      domain: "overlap.example",
      raw: { apollo_id: "same-company-id" },
    }],
    contacts: [{
      id: CONTACT_A,
      workspace_id: A,
      account_id: ACCOUNT_A,
      full_name: "Contact A",
      email: "same@overlap.example",
      raw: { apollo_id: "same-contact-id" },
    }, {
      id: CONTACT_B,
      workspace_id: B,
      account_id: ACCOUNT_B,
      full_name: "Contact B",
      email: "same@overlap.example",
      raw: { apollo_id: "same-contact-id" },
    }],
    tasks: [{
      id: TASK_A,
      workspace_id: A,
      user_id: UA,
      status: "ready",
      payload: {
        execution_mode: "pilot_draft_only",
        instruction: "Prepare A only",
      },
      result: { note: "PRIVATE_A_OUTPUT" },
      output: "PRIVATE_A_OUTPUT",
    }, {
      id: TASK_B,
      workspace_id: B,
      user_id: UB,
      status: "ready",
      payload: {
        execution_mode: "pilot_draft_only",
        instruction: "Prepare B only",
      },
      result: { note: "PRIVATE_B_OUTPUT" },
      output: "PRIVATE_B_OUTPUT",
    }],
    saved_outputs: [{
      id: MEMORY_A,
      workspace_id: A,
      task_id: TASK_A,
      title: "A memory",
      body: "PRIVATE_A_MEMORY",
    }, {
      id: MEMORY_B,
      workspace_id: B,
      task_id: TASK_B,
      title: "B memory",
      body: "PRIVATE_B_MEMORY",
    }],
    tool_calls: [{
      id: RESEARCH_A,
      workspace_id: A,
      task_id: TASK_A,
      tool_name: "scrape_url",
      status: "succeeded",
      output_json: { excerpt: "PRIVATE_A_RESEARCH" },
    }, {
      id: RESEARCH_B,
      workspace_id: B,
      task_id: TASK_B,
      tool_name: "scrape_url",
      status: "succeeded",
      output_json: { excerpt: "PRIVATE_B_RESEARCH" },
    }],
    outreach_drafts: [{
      id: DRAFT_A,
      workspace_id: A,
      contact_id: CONTACT_A,
      body: "PRIVATE_A_DRAFT",
      status: "draft",
    }],
    lead_candidates: [{
      id: LEAD_A,
      workspace_id: A,
      account_id: ACCOUNT_A,
      contact_id: CONTACT_A,
      status: "new",
    }],
    task_plans: [],
    conversations: [],
    signals: [],
    approvals: [],
    agents: [],
    lead_evidence: [],
    lead_lineages: [],
  };
  const n = installStrictNetwork({
    tables,
    users: { "jwt-A": UA, "jwt-B": UB, "jwt-both": BOTH },
  });
  const settings: Record<string, string | undefined> = {
    OUTPOST_PILOT_SCOPE_ENABLED: "true",
    OUTPOST_PILOT_SCOPE_SIGNING_KEY: SIGNING,
  };
  let writeError = false, race = false, policyOverride: string | undefined;
  const env = (k: string) =>
    k === "OUTPOST_PILOT_SCOPE_POLICY"
      ? (policyOverride ?? JSON.stringify(policy))
      : settings[k] ?? n.env(k);
  // strictNetwork supports ordinary PostgREST filters; add real jsonb equality
  // semantics for the complete-payload CAS, never substitute handler behavior.
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request
      ? input
      : new Request(String(input), init);
    const u = new URL(req.url);
    if (
      req.method === "POST" &&
      u.pathname === "/rest/v1/rpc/outpost_pilot_access"
    ) {
      n.log.push(`NATIVE ${u.pathname}`);
      const args = await req.json();
      const token = req.headers.get("Authorization")?.replace("Bearer ", "");
      const user = ({ "jwt-A": UA, "jwt-B": UB, "jwt-both": BOTH } as Record<
        string,
        string
      >)[token ?? ""];
      const allowed = policy.workspaces.some((w) =>
        w.workspace_id === args.p_workspace &&
        w.client_binding_id === args.p_client && w.version === args.p_version
      ) &&
        (token === n.env("SUPABASE_SERVICE_ROLE_KEY")
          ? !!args.p_task
          : !!tables.workspace_members.find((m) =>
            m.workspace_id === args.p_workspace && m.user_id === user &&
            ["owner", "admin"].includes(String(m.role))
          ));
      return new Response(JSON.stringify(allowed), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (req.method === "PATCH" && u.pathname === "/rest/v1/tasks") {
      n.log.push(`CAS ${u.pathname}`);
      if (writeError) {
        return new Response('{"message":"synthetic write error"}', {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const filter = u.searchParams.get("payload");
      if (filter?.startsWith("eq.")) {
        const expected = JSON.parse(filter.slice(3));
        const row = tables.tasks.find((r) =>
          `eq.${r.id}` === u.searchParams.get("id") &&
          `eq.${r.workspace_id}` === u.searchParams.get("workspace_id")
        );
        if (race && row) {
          row.payload = { ...row.payload as Row, concurrent_edit: true };
          race = false;
        }
        if (!row || canonical(row.payload) !== canonical(expected)) {
          return new Response("null", {
            headers: { "Content-Type": "application/json" },
          });
        }
        u.searchParams.delete("payload");
        return n.fetch(new Request(u, req));
      }
    }
    return await n.fetch(input, init);
  }) as typeof globalThis.fetch;
  return {
    n,
    policy,
    settings,
    env,
    fetch,
    deps: { env, fetch },
    setWriteError: (v: boolean) => writeError = v,
    setRace: () => race = true,
    setPolicy: (v: string) => policyOverride = v,
  };
}
export type Fixture = ReturnType<typeof fixture>;
export async function call(
  f: Fixture,
  action: string,
  extra: Row = {},
  token = "jwt-A",
  workspace = A,
  client = CA,
) {
  const { handlePilotScope } = await import(
    "../../../supabase/functions/pilot-scope/index.ts"
  );
  const response = await handlePilotScope(
    new Request("https://audit.invalid/pilot-scope", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        workspace_id: workspace,
        client_binding_id: client,
        ...extra,
      }),
    }),
    f.deps,
  );
  const body = await response.json();
  return { status: response.status, body };
}
export function task(f: Fixture, which = TASK_A): Row {
  return f.n.tables.tasks.find((r) => r.id === which)!;
}
export const ROOTS = [
  { kind: "account", id: ACCOUNT_A },
  { kind: "contact", id: CONTACT_A },
  { kind: "memory", id: MEMORY_A },
  { kind: "research", id: RESEARCH_A },
] as const;
export async function bind(f: Fixture) {
  return await call(f, "bind_task", { task_id: TASK_A, resources: ROOTS });
}
export function noPaid(n: StrictNet) {
  if (n.external.length) throw new Error("unexpected external transport");
}
