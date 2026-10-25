// deno-lint-ignore-file no-import-prefix
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { briefFixture } from "./callBriefFixture.ts";
import {
  runCallBrief,
} from "../../../supabase/functions/_shared/pilot/callBriefRunner.ts";
import { canonical } from "../../../supabase/functions/_shared/pilot/pilotScope.ts";
import {
  expectedReceipt,
  type PilotReviewDeps,
} from "../../../supabase/functions/_shared/pilot/pilotReview.ts";
import {
  inspectReview,
  reviewBrief,
} from "../../../supabase/functions/_shared/pilot/pilotReview.ts";
import { prepareReviewCsv } from "../../../supabase/functions/_shared/pilot/pilotExport.ts";
import type {
  PilotExportStore,
  ReviewCommit,
  ReviewEvent,
  ReviewOperation,
  ReviewReceipt,
} from "../../../supabase/functions/_shared/pilot/pilotExportStore.ts";
import type { PacketScope } from "../../../supabase/functions/_shared/pilot/pilotEvidencePacket.ts";
import { call, DEST_A, DEST_B, id, task } from "./pilotScopeFixture.ts";
import { envelope } from "./pilotModelFixture.ts";
export class SyntheticReviewStore implements PilotExportStore {
  streams = new Map<string, ReviewEvent[]>();
  operations = new Map<string, ReviewReceipt>();
  commits = 0;
  failRead = false;
  failBefore = false;
  failAfter = false;
  beforeCommit?: () => void;
  guard?: (c: ReviewCommit) => void;
  key(s: PacketScope) {
    return `${s.workspace_id}:${s.client_binding_id}:${s.task_id}`;
  }
  opKey(s: ReviewOperation) {
    return `${s.workspace_id}:${s.client_binding_id}:${s.actor_id}:${s.operation_id}`;
  }
  // deno-lint-ignore require-await -- atomic synthetic storage only, not native evidence
  async history(s: PacketScope) {
    if (this.failRead) throw Error("synthetic history unavailable");
    return structuredClone(this.streams.get(this.key(s)) ?? []);
  }
  // deno-lint-ignore require-await -- same storage boundary as future native operation lookup
  async operation(s: ReviewOperation) {
    return structuredClone(this.operations.get(this.opKey(s)) ?? null);
  }
  // deno-lint-ignore require-await -- one synchronous critical section models an atomic native commit
  async commit(c: ReviewCommit) {
    this.beforeCommit?.();
    if (this.failBefore) throw Error("synthetic commit unavailable");
    this.guard?.(c);
    const key = this.opKey(c.operation), old = this.operations.get(key);
    if (old) {
      if (old.request_hash !== c.request_hash) {
        throw Error("operation conflict");
      }
      return structuredClone(old);
    }
    if (!c.transitions.length || c.transitions.length > 5) {
      throw Error("bad transition count");
    }
    for (const t of c.transitions) {
      const h = this.streams.get(this.key(t.fence)) ?? [];
      if (
        (h.at(-1)?.event_hash ?? null) !== t.expected_head ||
        t.event.previous_hash !== t.expected_head ||
        t.event.sequence !== h.length + 1
      ) throw Error("stale head");
    }
    // All validations complete before the first append; no partial batch commits.
    for (const t of c.transitions) {
      const key = this.key(t.fence), h = this.streams.get(key) ?? [];
      this.streams.set(key, [...h, structuredClone(t.event)]);
    }
    const receipt = expectedReceipt(
      c.operation,
      c.request_hash,
      c.transitions.map((t) => t.event),
      c.manifest,
    );
    this.operations.set(key, structuredClone(receipt));
    this.commits++;
    if (this.failAfter) throw Error("lost commit acknowledgement");
    return structuredClone(receipt);
  }
}
export async function reviewFixture(
  which: "A" | "B" = "A",
  contextVersion = "pilot_context_v1",
  beforeCapture?: Parameters<typeof briefFixture>[4],
) {
  const x = await briefFixture(
      which,
      {},
      "normal",
      contextVersion,
      beforeCapture,
    ),
    draft = await runCallBrief(x.scope, x.deps),
    events = new SyntheticReviewStore();
  const policy = {
    workspace_id: x.scope.workspace_id,
    client_binding_id: x.scope.client_binding_id,
    version: 1,
    review_enabled: true,
    export_enabled: true,
    approval_ttl_seconds: 3600,
    max_export_rows: 5,
    destination_id: which === "A" ? DEST_A : DEST_B,
  };
  let now = "2026-10-22T00:00:00Z", counter = 5000;
  const deps: PilotReviewDeps = {
    mode: "offline_fixture",
    env: x.deps.env,
    fetch: x.deps.fetch,
    user_id: x.deps.user_id,
    store: x.deps.store,
    loadPolicy: x.deps.loadPolicy,
    signal: x.deps.signal,
    snapshots: x.deps.snapshots,
    briefs: x.deps.briefs,
    events,
    loadReviewPolicy: () => Promise.resolve(policy),
    now: () => now,
  };
  const expectedTasks = new Map([[
      x.scope.task_id,
      canonical(task(x.f, x.scope.task_id)),
    ]]),
    modelPolicy = canonical(x.policy);
  events.guard = (c) => {
    for (const t of c.transitions) {
      const member = x.f.n.tables.workspace_members.find((r) =>
        r.workspace_id === t.fence.workspace_id &&
        r.user_id === t.fence.actor_id
      );
      if (
        !member || !["owner", "admin"].includes(String(member.role)) ||
        canonical(task(x.f, t.fence.task_id)) !==
          expectedTasks.get(t.fence.task_id) ||
        canonical(x.policy) !== modelPolicy
      ) throw Error("native-style authorization fence refused");
    }
  };
  const operation = () => id(++counter);
  const inspect = (scope = x.scope) => inspectReview(scope, deps);
  const approve = async (scope = x.scope) => {
    const s = await inspect(scope);
    return await reviewBrief(scope, {
      action: "approve",
      operation_id: operation(),
      expected_head: s.head_hash,
      expected_revision: s.revision.hash,
      acknowledge_unverified: true,
    }, deps);
  };
  const exportOne = async (scope = x.scope) => {
    const s = await inspect(scope);
    return await prepareReviewCsv({
      workspace_id: scope.workspace_id,
      client_binding_id: scope.client_binding_id,
    }, {
      operation_id: operation(),
      items: [{
        task_id: scope.task_id,
        expected_head: s.head_hash,
        revision_hash: s.revision.hash,
        approval_hash: s.approval?.event_hash ?? "f".repeat(64),
      }],
    }, deps);
  };
  const assertNoExecution = () => {
    assertEquals(x.calls.length, 1);
    assertEquals(x.accounting.runtimeAttempts, 1);
    assertEquals(x.accounting.receipts.size, 1);
    assertEquals(x.credentials.length, 1);
  };
  const addTask = async () => {
    const tid = id(++counter),
      source = structuredClone(task(x.f, x.scope.task_id)),
      p = { ...source.payload as Record<string, unknown> };
    delete p.pilot_scope;
    source.id = tid;
    source.payload = p;
    x.f.n.tables.tasks.push(source);
    const r = await call(
      x.f,
      "bind_task",
      { task_id: tid, resources: [] },
      which === "A" ? "jwt-A" : "jwt-B",
      x.scope.workspace_id,
      x.scope.client_binding_id,
    );
    assertEquals(r.status, 200);
    x.response(() => {
      const req = JSON.parse(String(x.calls.at(-1)!.init.body)),
        ctx = JSON.parse(req.messages[1].content),
        company = ctx.facts.find((f: { field: string }) =>
          f.field === "company_name"
        ),
        signal = ctx.facts.find((f: { field: string }) =>
          f.field === "source_excerpt"
        ),
        offer = ctx.client_context.find((b: { path: string }) =>
          b.path === "positioning.offer"
        );
      const choice = {
        schema_version: "call_brief_v1",
        company_overview: [company.id],
        business_context: [offer.id],
        signal_evidence: [signal.id],
        talking_points: [],
        discovery_questions: [{
          kind: "verify_context",
          fact_id: signal.id,
          brain_id: null,
        }],
        missing_information: [],
      };
      return Promise.resolve(
        new Response(
          JSON.stringify(
            envelope({
              choices: [{
                finish_reason: "stop",
                message: { content: JSON.stringify(choice) },
              }],
            }),
          ),
          { headers: { "x-request-id": "req-extra-task" } },
        ),
      );
    });
    const scope = { ...x.scope, task_id: tid };
    await runCallBrief(scope, x.deps);
    expectedTasks.set(tid, canonical(task(x.f, tid)));
    return scope;
  };
  return {
    ...x,
    draft,
    events,
    reviewPolicy: policy,
    reviewDeps: deps,
    operation,
    inspect,
    approve,
    exportOne,
    assertNoExecution,
    setNow: (v: string) => now = v,
    addTask,
  };
}
