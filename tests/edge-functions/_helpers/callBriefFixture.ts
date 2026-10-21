// deno-lint-ignore-file no-import-prefix
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  A,
  B,
  CA,
  call,
  CB,
  CRED_A,
  CRED_B,
  fixture,
  task,
  TASK_A,
  TASK_B,
  UA,
  UB,
} from "./pilotScopeFixture.ts";
import { AS_OF, inputs, MemorySnapshots } from "./pilotSnapshotFixture.ts";
import { envelope, SyntheticAtomicModelStore } from "./pilotModelFixture.ts";
import { createPilotScopeStore } from "../../../supabase/functions/_shared/pilot/pilotScopeStore.ts";
import {
  freezePilotContext,
  reviewBrainSnapshot,
} from "../../../supabase/functions/_shared/pilot/pilotContextSnapshot.ts";
import {
  canonical,
  digest,
} from "../../../supabase/functions/_shared/pilot/pilotScope.ts";
import { buildBriefCatalog } from "../../../supabase/functions/_shared/pilot/callBriefPrompt.ts";
import type { BriefChoice } from "../../../supabase/functions/_shared/pilot/callBriefContract.ts";
import type {
  BriefFence,
  CallBriefDraft,
  CallBriefStore,
} from "../../../supabase/functions/_shared/pilot/callBriefStore.ts";
import type { CallBriefDeps } from "../../../supabase/functions/_shared/pilot/callBriefRunner.ts";
import type { PacketScope } from "../../../supabase/functions/_shared/pilot/pilotEvidencePacket.ts";
Deno.env.set("PILOT_SCOPE_IMPORT_ONLY", "1");
export class MemoryBriefs implements CallBriefStore {
  rows = new Map<string, CallBriefDraft>();
  writes = 0;
  failRead = false;
  failBefore = false;
  failAfter = false;
  beforeInsert?: () => void;
  key(s: PacketScope) {
    return `${s.workspace_id}:${s.client_binding_id}:${s.task_id}`;
  }
  // deno-lint-ignore require-await -- atomic synthetic fixture, not native persistence
  async read(s: PacketScope) {
    if (this.failRead) throw Error("synthetic brief read failure");
    return structuredClone(this.rows.get(this.key(s)) ?? null);
  }
  // deno-lint-ignore require-await -- native transaction remains a gate
  async insertOnce(d: CallBriefDraft, f: BriefFence) {
    this.beforeInsert?.();
    if (this.failBefore) throw Error("synthetic brief write failure");
    assertEquals(d.packet_hash, f.packet_hash);
    const k = this.key(d), prior = this.rows.get(k);
    if (prior && canonical(prior) !== canonical(d)) {
      throw Error("immutable brief conflict");
    }
    if (!prior) {
      this.writes++;
      this.rows.set(k, structuredClone(d));
    }
    if (this.failAfter) throw Error("lost brief acknowledgement");
    return structuredClone(this.rows.get(k)!);
  }
}
export async function briefFixture(
  which: "A" | "B" = "A",
  selectionOverrides: Record<string, unknown> = {},
  evidenceMode:
    | "normal"
    | "csv_only"
    | "conflict"
    | "stale"
    | "misleading_excerpt" = "normal",
) {
  const f = fixture(),
    scope = {
      workspace_id: which === "A" ? A : B,
      client_binding_id: which === "A" ? CA : CB,
      task_id: which === "A" ? TASK_A : TASK_B,
    },
    user = which === "A" ? UA : UB,
    credential = which === "A" ? CRED_A : CRED_B;
  const row = f.n.tables.company_brain.find((r) =>
    r.workspace_id === scope.workspace_id
  )!;
  Object.assign(row.profile as Record<string, unknown>, {
    positioning: {
      offer: `PRIVATE_${which}_pipeline_support`,
      avoid_positioning: ["No guaranteed revenue"],
    },
    brand_voice: { style_rules: [`PRIVATE_${which}_VOICE`] },
    exclusions: ["No automated outreach"],
    business_context: { instructions: `Only draft for client ${which}` },
  });
  const brain = reviewBrainSnapshot(
    scope,
    row,
    Object.keys(row.profile as Record<string, unknown>),
  );
  const approved = await inputs(scope);
  if (evidenceMode === "csv_only") {
    approved.sources = [];
    approved.interpretations = [];
  }
  if (evidenceMode === "conflict") {
    approved.conflicts = [{
      reason: "Unresolved supplied employer statements",
      source_ids: ["csv", "website"],
    }];
  }
  if (evidenceMode === "misleading_excerpt") {
    const s = approved.sources[0], start = s.body.indexOf("looking");
    s.quotes = [{ start, end: 32, excerpt: s.body.slice(start, 32) }];
  }
  if (evidenceMode === "stale") {
    approved.sources[0].collected_at = null;
    approved.sources[0].valid_until = "2020-02-01T00:00:00Z";
  }

  const selection = {
    provider: "openai",
    model: "gpt-4.1-mini",
    credential_id: credential,
    policy_version: 1,
    task_kind: "call_brief",
    schema: "call_brief_v1",
    ...selectionOverrides,
  };
  task(f, scope.task_id).payload = {
    ...task(f, scope.task_id).payload as Record<string, unknown>,
    pilot_model: selection,
    pilot_context: {
      version: "pilot_context_v1",
      brain_hash: await digest(brain),
      inputs_hash: await digest(approved),
      approved_sections: brain.approved_sections,
      as_of: AS_OF,
    },
  };
  const r = await call(
    f,
    "bind_task",
    { task_id: scope.task_id, resources: [] },
    which === "A" ? "jwt-A" : "jwt-B",
    scope.workspace_id,
    scope.client_binding_id,
  );
  assertEquals(r.status, 200, JSON.stringify(r.body));
  f.settings.MODEL_SPEND_ENFORCEMENT = "enforce";
  f.settings.MODEL_SPEND_CEILING_USD = "0.05";
  f.settings.MODEL_SPEND_PERIOD_DAYS = "1";
  f.n.tables.lead_model_calls = [];
  const spendDb = createClient(
    f.env("SUPABASE_URL")!,
    f.env("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      global: { fetch: f.fetch },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const policy = {
    workspace_id: scope.workspace_id,
    client_binding_id: scope.client_binding_id,
    version: 1,
    execution_enabled: true,
    data_sharing_approved: true,
    provider: "openai",
    model: "gpt-4.1-mini",
    credential_id: credential,
    max_input_tokens: 8192,
    max_output_tokens: 512,
    model_budget_usd: 0.05,
    provider_budget_usd: 0.20,
    combined_budget_usd: 0.25,
  };
  const snapshots = new MemorySnapshots(),
    briefs = new MemoryBriefs(),
    accounting = new SyntheticAtomicModelStore(),
    scopeStore = createPilotScopeStore(f.deps);
  let loads = 0;
  const snapshotDeps = {
    mode: "offline_fixture" as const,
    env: f.env,
    user_id: user,
    scopeStore,
    snapshots,
    loadApprovedInputs: () => {
      loads++;
      return Promise.resolve(structuredClone(approved));
    },
  };
  const packet = await freezePilotContext(scope, snapshotDeps),
    catalog = buildBriefCatalog(packet);
  const company = catalog.facts.find((x) => x.fact.field === "company_name")!,
    signal = catalog.facts.find((x) => x.fact.field === "source_excerpt")!,
    offer = catalog.brain.find((b) => b.path === "positioning.offer")!;
  const choice: BriefChoice = {
    schema_version: "call_brief_v1",
    company_overview: [company.id],
    business_context: [offer.id],
    signal_evidence: signal ? [signal.id] : [],
    talking_points: signal ? [{ fact_id: signal.id, brain_id: offer.id }] : [],
    discovery_questions: [{
      kind: evidenceMode === "conflict" ? "clarify_conflict" : "verify_context",
      fact_id: signal?.id ?? company.id,
      brain_id: null,
    }, { kind: "understand_priorities", fact_id: null, brain_id: offer.id }],
    missing_information: [catalog.unknowns[0].id],
  };
  const calls: { url: string; init: RequestInit }[] = [],
    credentials: unknown[] = [];
  let response = () =>
    Promise.resolve(
      new Response(
        JSON.stringify(envelope({
          choices: [{
            finish_reason: "stop",
            message: { content: JSON.stringify(choice) },
          }],
          usage: {
            prompt_tokens: 1700,
            completion_tokens: 230,
            prompt_tokens_details: { cached_tokens: 0 },
          },
        })),
        { headers: { "x-request-id": "req-brief-synthetic" } },
      ),
    );
  const deps: CallBriefDeps = {
    ...snapshotDeps,
    ...f.deps,
    store: () => scopeStore,
    loadPolicy: () => Promise.resolve(policy),
    resolveCredential: (s, b) => {
      credentials.push({ scope: s, binding: b });
      return Promise.resolve(`synthetic-key-${which}`);
    },
    accounting,
    spendDb: spendDb as never,
    transport: async (url, init) => {
      calls.push({ url, init });
      return await response();
    },
    briefs,
  };
  return {
    f,
    scope,
    row,
    policy,
    selection,
    approved,
    packet,
    catalog,
    choice,
    briefs,
    snapshots,
    accounting,
    calls,
    credentials,
    deps,
    loads: () => loads,
    response: (next: typeof response) => {
      response = next;
    },
  };
}
