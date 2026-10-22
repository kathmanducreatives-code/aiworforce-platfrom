import { decideWorkspaceAccess } from "../workspaceAccessGuard.ts";
import {
  buildCanonicalCompanyBrain,
  type CanonicalCompanyBrain,
} from "../getCompiledCompanyBrainForWorkspace.ts";
import {
  isSellerIdentityBlocked,
  resolveCanonicalSellerIdentity,
} from "../workbench/sellerIdentity.ts";
import {
  canUsePilot,
  object,
  type PilotEnrollment,
  PilotRefusal,
  validId,
} from "./pilotPolicy.ts";
import {
  type PilotScopeStore,
  recordIdColumn,
  type ResourceKind,
  type ResourceRef,
  RESOURCES,
  type Row,
} from "./pilotScopeStore.ts";

export function canonical(value: unknown): string {
  if (
    value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${
      Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map((
        [k, v],
      ) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")
    }}`;
  }
  throw new PilotRefusal("invalid_scope_data", 400);
}
const bytes = (value: string) => new TextEncoder().encode(value);
export async function digest(value: unknown): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", bytes(canonical(value)));
  return [...new Uint8Array(b)].map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export function resourceRefs(value: unknown): ResourceRef[] {
  if (!Array.isArray(value) || value.length > 25) {
    throw new PilotRefusal("invalid_resource_set", 400);
  }
  const seen = new Set<string>();
  return value.map((v) => {
    const r = object(v);
    if (
      Object.keys(r).some((k) => k !== "kind" && k !== "id") ||
      !Object.hasOwn(RESOURCES, String(r.kind)) || !validId(r.id)
    ) throw new PilotRefusal("invalid_resource_set", 400);
    const ref = { kind: r.kind as ResourceKind, id: r.id };
    const k = `${ref.kind}:${ref.id}`;
    if (seen.has(k)) throw new PilotRefusal("invalid_resource_set", 400);
    seen.add(k);
    return ref;
  });
}
// Known ownership-bearing relational columns in the supported records. No joined
// child is trusted just because its parent row belongs to this workspace.
const PARENTS: Readonly<Record<string, ResourceKind>> = {
  account_id: "account",
  contact_id: "contact",
  lead_candidate_id: "lead",
  task_id: "task",
  parent_task_id: "task",
  plan_id: "plan",
  task_plan_id: "plan",
  conversation_id: "conversation",
  signal_id: "signal",
  approval_id: "approval",
  agent_id: "agent",
  evidence_id: "evidence",
  legacy_signal_id: "signal",
  tool_call_id: "research",
  lineage_id: "lineage",
  lease_holder: "task",
};
const PUBLIC_FIELDS: Partial<Record<ResourceKind, readonly string[]>> = {
  account: ["name", "domain", "website_url", "linkedin_url", "industry"],
  contact: ["full_name", "title", "company", "linkedin_url"],
  lead: ["lead_type", "status", "reason"],
  memory: ["type", "title", "body"],
  draft: ["channel", "subject", "body", "status"],
  research: ["tool_name", "provider", "status", "output_json"],
  task: ["status", "output", "result"],
};
export interface TaskClaims {
  version: 1;
  task_id: string;
  workspace_id: string;
  client_binding_id: string;
  principal_user_id: string;
  policy_hash: string;
  payload_hash: string;
  resources: ResourceRef[];
  mode: "draft_only";
}
interface Envelope {
  claims: TaskClaims;
  mac: string;
}
async function macKey(key: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    bytes(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
async function sign(claims: TaskClaims, key: string): Promise<Envelope> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await macKey(key),
    bytes(canonical(claims)),
  );
  return {
    claims,
    mac: [...new Uint8Array(signature)].map((b) =>
      b.toString(16).padStart(2, "0")
    ).join(""),
  };
}
async function verify(value: unknown, key: string): Promise<TaskClaims> {
  try {
    const e = object(value), c = object(e.claims);
    if (
      Object.keys(e).sort().join(",") !== "claims,mac" ||
      typeof e.mac !== "string" || !/^[a-f0-9]{64}$/.test(e.mac)
    ) throw new Error();
    if (
      canonical(Object.keys(c).sort()) !==
        canonical(
          [
            "version",
            "task_id",
            "workspace_id",
            "client_binding_id",
            "principal_user_id",
            "policy_hash",
            "payload_hash",
            "resources",
            "mode",
          ].sort(),
        )
    ) throw new Error();
    if (
      c.version !== 1 || c.mode !== "draft_only" ||
      ![c.task_id, c.workspace_id, c.client_binding_id, c.principal_user_id]
        .every(validId) ||
      !/^[a-f0-9]{64}$/.test(String(c.policy_hash)) ||
      !/^[a-f0-9]{64}$/.test(String(c.payload_hash))
    ) throw new Error();
    resourceRefs(c.resources);
    const signature = new Uint8Array(
      e.mac.match(/../g)!.map((v) => parseInt(v, 16)),
    );
    if (
      !await crypto.subtle.verify(
        "HMAC",
        await macKey(key),
        signature,
        bytes(canonical(c)),
      )
    ) throw new Error();
    return c as unknown as TaskClaims;
  } catch {
    throw new PilotRefusal("task_scope_invalid", 409);
  }
}
function unsignedPayload(task: Row): Row {
  const p = object(task.payload);
  if (p.execution_mode !== "pilot_draft_only" || canonical(p).length > 65536) {
    throw new PilotRefusal("not_a_pilot_task", 409);
  }
  const copy = { ...p };
  delete copy.pilot_scope;
  return copy;
}

// Private constructor is paired with methods that perform every check. No
// request-supplied "authorized" boolean/context can instantiate this boundary.
export class PilotAccess {
  private constructor(
    private readonly store: PilotScopeStore,
    private readonly enrollment: PilotEnrollment,
    readonly userId: string,
    private readonly taskRestriction?: TaskClaims,
  ) {}
  static async forUser(
    store: PilotScopeStore,
    enrollment: PilotEnrollment,
    user: string,
  ): Promise<PilotAccess> {
    const member = await store.member(enrollment.workspace_id, user);
    const d = decideWorkspaceAccess({
      bearerIsServiceRole: false,
      authenticatedUserId: user,
      isMember: !!member && member.workspace_id === enrollment.workspace_id &&
        member.user_id === user,
    });
    if (!d.ok || !canUsePilot(member?.role)) {
      throw new PilotRefusal("forbidden_workspace", 403);
    }
    const access = new PilotAccess(store, structuredClone(enrollment), user);
    await access.clientBrain();
    return access;
  }
  static async forTask(
    store: PilotScopeStore,
    enrollment: PilotEnrollment,
    taskId: string,
    key: string,
    requestingUser: string | null,
  ): Promise<PilotAccess> {
    // A user must have current membership before any service-role task read.
    // Only a verified service caller may first read the task to resolve the
    // signed initiator, whose membership is then checked below.
    if (requestingUser !== null) {
      await PilotAccess.forUser(store, enrollment, requestingUser);
    }
    const rows = await store.records(enrollment.workspace_id, "task", [taskId]);
    if (
      rows.length !== 1 || rows[0].workspace_id !== enrollment.workspace_id ||
      rows[0].id !== taskId
    ) throw new PilotRefusal("resource_unavailable", 404);
    const task = rows[0], p = unsignedPayload(task);
    const c = await verify(object(task.payload).pilot_scope, key);
    if (
      c.task_id !== taskId || c.workspace_id !== enrollment.workspace_id ||
      c.client_binding_id !== enrollment.client_binding_id ||
      c.policy_hash !== await digest(enrollment) ||
      c.payload_hash !== await digest(p) ||
      task.user_id !== c.principal_user_id ||
      (requestingUser !== null && requestingUser !== c.principal_user_id)
    ) throw new PilotRefusal("task_scope_mismatch", 409);
    const access = await PilotAccess.forUser(
      store,
      enrollment,
      c.principal_user_id,
    );
    await access.records([{ kind: "task", id: taskId }, ...c.resources]);
    await access.brain();
    return new PilotAccess(
      store,
      structuredClone(enrollment),
      c.principal_user_id,
      c,
    );
  }
  summary(): {
    workspace_id: string;
    client_binding_id: string;
    mode: "draft_only";
    version: number;
  } {
    const e = this.enrollment;
    return {
      workspace_id: e.workspace_id,
      client_binding_id: e.client_binding_id,
      mode: e.mode,
      version: e.version,
    };
  }
  async recheck(): Promise<void> {
    await PilotAccess.forUser(this.store, this.enrollment, this.userId);
  }
  private async clientBrain(): Promise<Row> {
    const row = await this.store.brain(this.enrollment.workspace_id);
    if (
      !row || row.workspace_id !== this.enrollment.workspace_id ||
      row.onboarding_completed !== true
    ) {
      throw new PilotRefusal("pilot_brain_unavailable", 409);
    }
    const seller = resolveCanonicalSellerIdentity({
      profile: object(row.profile),
    });
    if (
      isSellerIdentityBlocked(seller) || !seller.companyName ||
      seller.domain !== this.enrollment.seller_domain
    ) {
      throw new PilotRefusal("client_identity_mismatch", 409);
    }
    return row;
  }
  async brain(): Promise<CanonicalCompanyBrain> {
    await this.recheck();
    const row = await this.clientBrain();
    return buildCanonicalCompanyBrain(
      this.enrollment.workspace_id,
      object(row.profile),
    );
  }
  async credential(
    id: string,
    provider: string,
    purpose: string,
  ): Promise<{ id: string; provider: string; purpose: string }> {
    await this.recheck();
    const c = this.enrollment.credentials.find((v) =>
      v.id === id && v.provider === provider && v.purpose === purpose
    );
    if (!c) throw new PilotRefusal("credential_scope_unavailable", 403);
    // Never expose references or keys. Provider execution is not implemented in P1.
    return { id: c.id, provider: c.provider, purpose: c.purpose };
  }
  async destination(id: string): Promise<{ id: string; kind: "manual_csv" }> {
    await this.recheck();
    const d = this.enrollment.destinations.find((v) =>
      v.id === id && v.kind === "manual_csv"
    );
    if (!d) throw new PilotRefusal("destination_scope_unavailable", 403);
    return { ...d };
  }
  async records(refs: readonly ResourceRef[]): Promise<Row[]> {
    await this.recheck();
    const allowed = this.taskRestriction
      ? new Set([
        `task:${this.taskRestriction.task_id}`,
        ...this.taskRestriction.resources.map((r) => `${r.kind}:${r.id}`),
      ])
      : null;
    for (const r of refs) {
      if (allowed && !allowed.has(`${r.kind}:${r.id}`)) {
        throw new PilotRefusal("task_resource_mismatch", 403);
      }
    }
    const cache = new Map<string, Row>();
    const load = async (r: ResourceRef, depth = 0): Promise<Row> => {
      const k = `${r.kind}:${r.id}`;
      if (cache.has(k)) return cache.get(k)!;
      if (depth > 8 || cache.size >= 100) {
        throw new PilotRefusal("resource_graph_invalid", 409);
      }
      const rows = await this.store.records(
        this.enrollment.workspace_id,
        r.kind,
        [r.id],
      );
      if (
        rows.length !== 1 || rows[0][recordIdColumn(r.kind)] !== r.id ||
        rows[0].workspace_id !== this.enrollment.workspace_id
      ) throw new PilotRefusal("resource_unavailable", 404);
      const row = rows[0];
      cache.set(k, row);
      for (const [column, kind] of Object.entries(PARENTS)) {
        if (row[column] == null) continue;
        if (!validId(row[column])) {
          throw new PilotRefusal("resource_graph_invalid", 409);
        }
        await load({ kind, id: row[column] }, depth + 1);
      }
      if (row.depends_on != null) {
        if (
          !Array.isArray(row.depends_on) || row.depends_on.length > 25 ||
          !row.depends_on.every(validId)
        ) throw new PilotRefusal("resource_graph_invalid", 409);
        for (const id of row.depends_on) {
          await load({ kind: "task", id }, depth + 1);
        }
      }
      return row;
    };
    const out: Row[] = [];
    // Resolve and validate the entire set before returning any content.
    for (const r of refs) {
      const row = await load(r);
      const fields = r.kind === "task" && !this.taskRestriction
        ? ["status"]
        : PUBLIC_FIELDS[r.kind] ?? [];
      out.push(
        Object.fromEntries(
          [
            ["id", r.id],
            ...["workspace_id", ...fields]
              .filter((k) => Object.hasOwn(row, k)).map((k) => [k, row[k]]),
          ],
        ),
      );
    }
    return out;
  }
  async bindTask(
    taskId: string,
    refs: ResourceRef[],
    key: string,
  ): Promise<void> {
    await this.records([{ kind: "task", id: taskId }, ...refs]);
    await this.brain();
    const rows = await this.store.records(
      this.enrollment.workspace_id,
      "task",
      [taskId],
    );
    if (
      rows.length !== 1 || rows[0].id !== taskId ||
      rows[0].workspace_id !== this.enrollment.workspace_id
    ) throw new PilotRefusal("resource_unavailable", 404);
    const task = rows[0], payload = unsignedPayload(task);
    if (task.user_id !== this.userId) {
      throw new PilotRefusal("task_owner_mismatch", 403);
    }
    if (object(task.payload).pilot_scope != null) {
      const access = await PilotAccess.forTask(
        this.store,
        this.enrollment,
        taskId,
        key,
        this.userId,
      );
      if (canonical(access.taskRestriction!.resources) !== canonical(refs)) {
        throw new PilotRefusal("task_scope_mismatch", 409);
      }
      return;
    }
    const claims: TaskClaims = {
      version: 1,
      task_id: taskId,
      workspace_id: this.enrollment.workspace_id,
      client_binding_id: this.enrollment.client_binding_id,
      principal_user_id: this.userId,
      policy_hash: await digest(this.enrollment),
      payload_hash: await digest(payload),
      resources: structuredClone(refs),
      mode: "draft_only",
    };
    await this.recheck();
    const next = { ...payload, pilot_scope: await sign(claims, key) };
    const stored = await this.store.bind(task, next);
    if (!stored) throw new PilotRefusal("task_binding_conflict", 409);
    if (
      stored.id !== taskId ||
      stored.workspace_id !== this.enrollment.workspace_id ||
      stored.user_id !== this.userId ||
      canonical(stored.payload) !== canonical(next)
    ) {
      throw new PilotRefusal("pilot_store_unavailable", 503);
    }
  }
}
