// Disabled foundation. No HTTP route, global fetch, global key, live store, or default dependencies.
import { type GptDeps, gptStructured } from "../gptProvider.ts";
import {
  authorizeModelSpend,
  resolveCeiling,
  resolveSpendEnforcement,
  type SpendDb,
} from "../modelSpendCeiling.ts";
import { canonical, digest, PilotAccess } from "./pilotScope.ts";
import {
  type CredentialBinding,
  loadPilotEnrollment,
  PilotRefusal,
  pilotSigningKey,
  validId,
} from "./pilotPolicy.ts";
import { type PilotContextDeps } from "./pilotContext.ts";
import { createPilotScopeStore } from "./pilotScopeStore.ts";
import { accountModel, reserveModelUsd } from "./pilotModelAccounting.ts";
import {
  enforceModelSelection,
  modelPolicy,
  modelSelection,
} from "./pilotTaskModelPolicy.ts";
import type {
  PilotModelReceipt,
  PilotTaskModelStore,
} from "./pilotTaskStore.ts";
export interface PilotModelDeps extends PilotContextDeps {
  mode: "offline_fixture"; // No production execution mode is implemented.
  // Caller must already have authenticated a real user. No service execution path in P4.
  user_id: string;
  loadPolicy: (workspace: string, client: string) => Promise<unknown>;
  resolveCredential: (
    scope: { workspace_id: string; client_binding_id: string },
    binding: CredentialBinding,
  ) => Promise<string | null>;
  accounting: PilotTaskModelStore;
  spendDb: SpendDb;
  transport: NonNullable<GptDeps["fetch"]>;
  signal?: AbortSignal;
}
const safeId = (v: unknown) =>
  typeof v === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(v) ? v : null;
export async function runPilotModelProbe(
  scope: { workspace_id: string; client_binding_id: string; task_id: string },
  deps: PilotModelDeps,
) {
  if (deps.mode !== "offline_fixture") {
    throw new PilotRefusal("pilot_model_execution_disabled", 503);
  }
  if (
    Object.keys(scope).length !== 3 ||
    Object.keys(scope).some((k) =>
      !["workspace_id", "client_binding_id", "task_id"].includes(k)
    ) || !validId(scope.workspace_id) || !validId(scope.client_binding_id) ||
    !validId(scope.task_id) || !validId(deps.user_id)
  ) throw new PilotRefusal("explicit_model_task_scope_required", 400);
  const e = loadPilotEnrollment(
    deps.env,
    scope.workspace_id,
    scope.client_binding_id,
  );
  const store = deps.store?.() ?? createPilotScopeStore(deps);
  await PilotAccess.forUser(store, e, deps.user_id);
  const tasks = await store.records(e.workspace_id, "task", [scope.task_id]);
  if (tasks.length !== 1) {
    throw new PilotRefusal("pilot_model_task_unavailable", 404);
  }
  const task = structuredClone(tasks[0]);
  if (task.status !== "ready") {
    throw new PilotRefusal("pilot_model_task_not_ready", 409);
  }
  // P1 verifies precisely this selection-bearing snapshot; it is not a new signature.
  const snapshotStore = {
    ...store,
    records: async (
      w: string,
      k: Parameters<typeof store.records>[1],
      ids: readonly string[],
    ) =>
      k === "task" && w === scope.workspace_id && ids.length === 1 &&
        ids[0] === scope.task_id
        ? [task]
        : await store.records(w, k, ids),
  };
  const access = await PilotAccess.forTask(
    snapshotStore,
    e,
    scope.task_id,
    pilotSigningKey(deps.env),
    deps.user_id,
  );
  const selection = modelSelection(
    (task.payload as Record<string, unknown>).pilot_model,
  );
  const policy = modelPolicy(
    await deps.loadPolicy(e.workspace_id, e.client_binding_id),
    e.workspace_id,
    e.client_binding_id,
  );
  enforceModelSelection(selection, policy);
  await access.credential(
    selection.credential_id,
    selection.provider,
    "call_brief",
  );
  const credential = e.credentials.find((c) =>
    c.id === selection.credential_id && c.provider === "openai" &&
    c.purpose === "call_brief"
  )!;
  const binding_hash = await digest(task), policy_hash = await digest(policy);
  const check = async () => {
    if (deps.signal?.aborted) {
      throw new PilotRefusal("pilot_model_cancelled", 409);
    }
    const current = await store.records(e.workspace_id, "task", [
      scope.task_id,
    ]);
    if (
      current.length !== 1 || await digest(current[0]) !== binding_hash ||
      canonical(
          loadPilotEnrollment(deps.env, e.workspace_id, e.client_binding_id),
        ) !== canonical(e) ||
      await digest(
          await deps.loadPolicy(e.workspace_id, e.client_binding_id),
        ) !== policy_hash
    ) throw new PilotRefusal("pilot_model_context_changed", 409);
    await access.recheck();
  };
  await check();
  let key: string | null;
  try {
    key = await deps.resolveCredential({
      workspace_id: e.workspace_id,
      client_binding_id: e.client_binding_id,
    }, structuredClone(credential));
  } catch {
    throw new PilotRefusal("pilot_model_credential_unavailable", 503);
  }
  if (
    !key?.trim() || key !== key.trim() || key.length > 512 ||
    [...key].some((c) => c.charCodeAt(0) < 33 || c.charCodeAt(0) > 126)
  ) {
    throw new PilotRefusal("pilot_model_credential_unavailable", 503);
  }
  const metadata = (v: unknown) => {
    const id = safeId(v);
    return id?.includes(key) ? null : id;
  };
  const reserve_usd = reserveModelUsd(policy);
  const ceiling = resolveCeiling(deps.env);
  if (resolveSpendEnforcement(deps.env) !== "enforce") {
    throw new PilotRefusal("pilot_spend_enforcement_required", 503);
  }
  const spend = await authorizeModelSpend({
    db: deps.spendDb,
    workspace_id: e.workspace_id,
    mode: "enforce",
    ...ceiling,
  });
  if (
    !spend.allowed || spend.unpriced_calls ||
    spend.spent_usd + reserve_usd > spend.ceiling_usd
  ) throw new PilotRefusal("pilot_workspace_model_spend_refused", 409);

  let receipt: PilotModelReceipt | null = null,
    admitted = false,
    entered = false;
  const probeSchema = {
    name: "pilot_model_probe_v1",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: { ready: { type: "boolean" } },
      required: ["ready"],
    },
  };
  // Fixed, synthetic schema/transport probe only. P6 caller briefs/prompts are not implemented.
  const system =
    "Return only the requested readiness JSON. This is a synthetic transport probe.";
  const user =
    "Report ready=true. Do not perform research, contact anyone or invoke tools.";
  // Worst-case UTF-8 bytes upper-bound text tokens; reserve substantial schema/message overhead.
  if (
    new TextEncoder().encode(system + user + JSON.stringify(probeSchema))
          .length + 1024 > policy.max_input_tokens
  ) throw new PilotRefusal("pilot_model_input_limit", 413);
  let httpOk = false, validEnvelope = false;
  const started = Date.now();
  let result:
    | Awaited<ReturnType<typeof gptStructured<{ ready: boolean }>>>
    | null = null;
  try {
    result = await gptStructured<{ ready: boolean }>({
      purpose: "outpost_model_probe",
      model: selection.model,
      system,
      user,
      schema: probeSchema,
      maxTokens: policy.max_output_tokens,
      temperature: 0,
    }, {
      readEnv: (k) => k === "OPENAI_API_KEY" ? key : undefined,
      log: () => {},
      sleep: () => Promise.resolve(), // no waiting or internal retry may buy another call
      // Transport telemetry is intentionally not another sink; raw attempt receipts settle once below.
      fetch: async (url, init) => {
        if (entered) {
          throw new PilotRefusal("pilot_model_retry_not_authorized", 409);
        }
        entered = true;
        await check();
        const request = JSON.parse(String(init.body));
        if (
          url !== "https://api.openai.com/v1/chat/completions" ||
          request.model !== selection.model ||
          request.max_tokens !== policy.max_output_tokens ||
          request.messages?.length !== 2 || request.tools
        ) throw new PilotRefusal("pilot_model_request_mismatch", 409);
        const reservation = await deps.accounting.reserve({
          ...scope,
          actor_id: deps.user_id,
          binding_hash,
          selection,
          policy_hash,
          policy,
          reserve_usd,
          max_task_attempts: 1,
          runtime_attempt_ceiling: 4,
          workspace_ceiling_usd: ceiling.ceiling_usd,
          workspace_period_days: ceiling.period_days,
        });
        admitted = true;
        // Revocation/cancellation after reservation consumes/holds the attempt, never refunds it.
        receipt = {
          attempt_id: reservation.attempt_id,
          ...scope,
          requested_provider: "openai",
          actual_provider: null,
          transport_dispatched: false,
          requested_model: selection.model,
          actual_model: null,
          response_id: null,
          request_id: null,
          ...accountModel(null, null),
          status: "failed",
          failure_code: "transport_error",
          finish_reason: null,
          http_status: null,
          duration_ms: 0,
        };
        await check();
        receipt.actual_provider = "openai";
        receipt.transport_dispatched = true;
        const r = await deps.transport(url, {
          ...init,
          ...(deps.signal ? { signal: deps.signal } : {}),
        });
        httpOk = r.ok;
        receipt.http_status = r.status;
        receipt.request_id = metadata(r.headers?.get("x-request-id"));
        const raw = await r.text();
        let envelope: Record<string, unknown> | null = null;
        try {
          const p = JSON.parse(raw);
          if (p && typeof p === "object" && !Array.isArray(p)) {
            envelope = p;
            validEnvelope = true;
          }
        } catch { /* transport owns malformed JSON */ }
        const choices = envelope?.choices;
        const choice = Array.isArray(choices) ? choices[0] : null;
        receipt = {
          ...receipt,
          request_id: metadata(r.headers?.get("x-request-id")),
          response_id: metadata(envelope?.id),
          actual_model: metadata(envelope?.model),
          finish_reason: metadata(choice?.finish_reason),
          ...accountModel(envelope, metadata(envelope?.model)),
        };
        return {
          ok: r.ok,
          status: r.status,
          headers: r.headers,
          text: () => Promise.resolve(raw),
        };
      },
    });
  } catch {
    /* failure remains a held attempt, with no error-body/secret leakage */
  }
  if (!receipt) {
    throw new PilotRefusal(
      admitted
        ? "pilot_model_admission_uncertain"
        : "pilot_model_not_dispatched",
      409,
    );
  }
  const saved = receipt as PilotModelReceipt;
  saved.duration_ms = Math.max(0, Date.now() - started);
  let code: string | null = result && !result.ok ? result.code : null;
  if (
    saved.http_status !== null && saved.http_status >= 400 &&
    code !== "quota_exhausted"
  ) code = "http_error";
  // Receipt integrity guard also protects an uncombined P3 base without T01.
  // No content parser or repair here: gptStructured owns refusal/JSON handling.
  if (
    httpOk && validEnvelope && code !== "schema_refused" &&
    saved.finish_reason !== "stop"
  ) {
    code = saved.finish_reason === "length"
      ? "incomplete_response"
      : "unexpected_completion";
  }
  if (result?.ok && !code && saved.actual_model !== selection.model) {
    code = "pilot_model_identity_mismatch";
  }
  if (result?.ok && !code && (!saved.response_id || !saved.request_id)) {
    code = "pilot_model_receipt_missing";
  }
  if (result?.ok && !code && saved.accounting_uncertain) {
    code = "pilot_model_usage_unknown";
  }
  if (
    result?.ok && !code &&
    (saved.usage.input_tokens! > policy.max_input_tokens ||
      saved.usage.output_tokens! > policy.max_output_tokens ||
      saved.estimated_cost_usd! > reserve_usd)
  ) code = "pilot_model_usage_exceeds_reservation";
  if (
    result?.ok && !code &&
    (!result.value || typeof result.value !== "object" ||
      Array.isArray(result.value) || Object.keys(result.value).length !== 1 ||
      typeof result.value.ready !== "boolean")
  ) code = "pilot_model_schema_invalid";
  if (!result) code = "pilot_model_transport_failed";
  saved.status = code ? "failed" : "succeeded";
  saved.failure_code = code;
  // No value is released before a durable settlement. Store retains pending reservations on failure.
  try {
    await deps.accounting.settle(saved);
  } catch {
    throw new PilotRefusal("pilot_model_accounting_unavailable", 503);
  }
  await check();
  if (code || !result?.ok) {
    throw new PilotRefusal(code ?? "pilot_model_transport_failed", 409);
  }
  return { value: result.value, receipt: saved };
}
