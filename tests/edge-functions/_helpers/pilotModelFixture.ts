// deno-lint-ignore no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  A,
  B,
  bind,
  CA,
  CB,
  CRED_A,
  CRED_B,
  fixture,
  ROOTS,
  task,
  TASK_A,
  TASK_B,
  UA,
  UB,
} from "./pilotScopeFixture.ts";
import { handlePilotContext } from "../../../supabase/functions/_shared/pilot/pilotContext.ts";
import type {
  ModelAdmission,
  PilotModelReceipt,
  PilotTaskModelStore,
} from "../../../supabase/functions/_shared/pilot/pilotTaskStore.ts";
import type { PilotModelDeps } from "../../../supabase/functions/_shared/pilot/pilotModelAdapter.ts";
import { PilotRefusal } from "../../../supabase/functions/_shared/pilot/pilotPolicy.ts";
Deno.env.set("PILOT_SCOPE_IMPORT_ONLY", "1");
export function envelope(overrides: Record<string, unknown> = {}) {
  return {
    id: "chatcmpl-synthetic",
    model: "gpt-4.1-mini",
    choices: [{
      finish_reason: "stop",
      message: { content: '{"ready":true}' },
    }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 10,
      prompt_tokens_details: { cached_tokens: 20 },
    },
    ...overrides,
  };
}
export class SyntheticAtomicModelStore implements PilotTaskModelStore {
  started = new Map<string, ModelAdmission>();
  receipts = new Map<string, PilotModelReceipt>();
  reserveCalls = 0;
  reserveFail = false;
  settleFail = false;
  modelSpent = 0;
  providerSpent = 0;
  runtimeAttempts = 0;
  // deno-lint-ignore require-await -- synchronous section models one atomic reservation
  async reserve(a: ModelAdmission) {
    this.reserveCalls++;
    const id = `attempt:${a.workspace_id}:${a.client_binding_id}:${a.task_id}`;
    if (this.reserveFail) throw Error("synthetic admission unavailable");
    if (this.started.has(id)) {
      throw new PilotRefusal("attempt_already_spent", 409);
    }
    if (
      this.runtimeAttempts >= a.runtime_attempt_ceiling ||
      this.modelSpent + a.reserve_usd > a.policy.model_budget_usd ||
      this.providerSpent > a.policy.provider_budget_usd ||
      this.modelSpent + this.providerSpent + a.reserve_usd >
        a.policy.combined_budget_usd
    ) throw new PilotRefusal("budget_exhausted", 409);
    this.started.set(id, structuredClone(a));
    this.runtimeAttempts++;
    this.modelSpent += a.reserve_usd;
    return { attempt_id: id };
  }
  // deno-lint-ignore require-await -- synchronous section models one atomic settlement
  async settle(r: PilotModelReceipt) {
    if (this.settleFail) throw Error("synthetic settlement unavailable");
    const a = this.started.get(r.attempt_id);
    if (
      !a || a.workspace_id !== r.workspace_id ||
      a.client_binding_id !== r.client_binding_id || a.task_id !== r.task_id ||
      this.receipts.has(r.attempt_id)
    ) throw Error("bad or duplicate receipt");
    this.receipts.set(r.attempt_id, structuredClone(r));
    if (!r.accounting_uncertain && r.estimated_cost_usd !== null) {
      this.modelSpent += r.estimated_cost_usd - a.reserve_usd;
    }
  }
}
export async function modelFixture(
  workspace = A,
  client = CA,
  user = UA,
  taskId = TASK_A,
  credentialId = CRED_A,
  overrides: Record<string, unknown> = {},
) {
  const f = fixture();
  f.settings.MODEL_SPEND_ENFORCEMENT = "enforce";
  f.settings.MODEL_SPEND_CEILING_USD = "0.05";
  f.settings.MODEL_SPEND_PERIOD_DAYS = "1";
  f.n.tables.lead_model_calls = [];
  const spendDb = createClient(
    f.env("SUPABASE_URL")!,
    f.env("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      global: { fetch: f.deps.fetch },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const selection = {
    provider: "openai",
    model: "gpt-4.1-mini",
    credential_id: credentialId,
    policy_version: 1,
    task_kind: "call_brief",
    schema: "pilot_model_probe_v1",
    ...overrides,
  };
  (task(f, taskId).payload as Record<string, unknown>).pilot_model = selection;
  if (taskId === TASK_A) await bind(f);
  else {
    f.settings.OUTPOST_PILOT_CONTEXT_ENABLED = "true";
    const r = await handlePilotContext(
      new Request("https://audit.invalid", {
        method: "POST",
        headers: { Authorization: "Bearer jwt-B" },
        body: JSON.stringify({
          action: "prepare_task",
          workspace_id: B,
          client_binding_id: CB,
          task_id: TASK_B,
          resources: [],
        }),
      }),
      f.deps,
    );
    if (r.status !== 200) throw Error("synthetic B binding failed");
  }
  const policy = {
    workspace_id: workspace,
    client_binding_id: client,
    version: 1,
    execution_enabled: true,
    data_sharing_approved: true,
    provider: "openai",
    model: "gpt-4.1-mini",
    credential_id: credentialId,
    max_input_tokens: 4096,
    max_output_tokens: 256,
    model_budget_usd: 0.05,
    provider_budget_usd: 0.20,
    combined_budget_usd: 0.25,
  };
  const accounting = new SyntheticAtomicModelStore();
  const calls: { url: string; init: RequestInit }[] = [],
    credentials: unknown[] = [];
  let response: () => Promise<Response> = () =>
    Promise.resolve(
      new Response(JSON.stringify(envelope()), {
        headers: { "x-request-id": "req-synthetic" },
      }),
    );
  const deps: PilotModelDeps = {
    mode: "offline_fixture",
    ...f.deps,
    user_id: user,
    loadPolicy: () => Promise.resolve(policy),
    resolveCredential: (s, b) => {
      credentials.push({ scope: s, binding: b });
      return Promise.resolve(
        workspace === A ? "synthetic-key-A" : "synthetic-key-B",
      );
    },
    accounting,
    spendDb: spendDb as never,
    transport: async (url, init) => {
      calls.push({ url, init });
      return await response();
    },
  };
  return {
    ...f,
    p1: f,
    policy,
    selection,
    accounting,
    calls,
    credentials,
    deps,
    scope: {
      workspace_id: workspace,
      client_binding_id: client,
      task_id: taskId,
    },
    response: (v: typeof response) => {
      response = v;
    },
    ROOTS,
  };
}
export { A, B, CA, CB, CRED_A, CRED_B, task, TASK_A, TASK_B, UA, UB };
