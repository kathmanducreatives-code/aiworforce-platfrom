// deno-lint-ignore-file no-import-prefix
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  A,
  bind,
  CA,
  call,
  fixture,
  task,
  TASK_A,
  UA,
} from "./pilotScopeFixture.ts";
import {
  type FrozenPilotPacket,
  reviewBrainSnapshot,
  type SnapshotDeps,
} from "../../../supabase/functions/_shared/pilot/pilotContextSnapshot.ts";
import {
  type PacketScope,
  reviewCsvSnapshot,
  validateInputs,
} from "../../../supabase/functions/_shared/pilot/pilotEvidencePacket.ts";
import { previewCsv } from "../../../supabase/functions/_shared/pilot/pilotImportContract.ts";
import {
  canonical,
  digest,
} from "../../../supabase/functions/_shared/pilot/pilotScope.ts";
import { createPilotScopeStore } from "../../../supabase/functions/_shared/pilot/pilotScopeStore.ts";
import type {
  PilotSnapshotStore,
  SnapshotFence,
} from "../../../supabase/functions/_shared/pilot/pilotSnapshotStore.ts";
Deno.env.set("PILOT_SCOPE_IMPORT_ONLY", "1");
export const scope: PacketScope = {
  workspace_id: A,
  client_binding_id: CA,
  task_id: TASK_A,
};
export const AS_OF = "2026-10-21T00:00:00Z";
export const CSV =
  "Company,Domain,Apollo Account,Title,Updated,Notes\nBuyer Demo,buyer-demo.com,same-account,CEO,2020-01-01T00:00:00Z,DO_NOT_COPY_OTHER_CLIENT\nBuyer Demo,buyer-demo.com,same-account,CEO,2020-01-01T00:00:00Z,DO_NOT_COPY_OTHER_CLIENT";
export const MAPPING = {
  Company: "company_name",
  Domain: "company_domain",
  "Apollo Account": "apollo_account_id",
  Title: "contact_title",
  Updated: "source_updated_at",
  Notes: null,
} as const;
export function source(s = scope) {
  const body = "We are not looking for new tools. We opened a factory in 2020.";
  return {
    id: "website",
    workspace_id: s.workspace_id,
    client_binding_id: s.client_binding_id,
    subject: {
      domain: "buyer-demo.com",
      linkedin_url: null,
      apollo_account_id: "same-account",
    },
    role: "prospect" as const,
    kind: "company_website" as const,
    url: "https://buyer-demo.com/news",
    requested_url: "https://buyer-demo.com/news",
    redirect_chain: [],
    locator: "supplied synthetic page",
    body,
    collected_at: "2026-10-20T00:00:00Z",
    updated_at: null,
    event_at: "2020-01-01T00:00:00Z",
    valid_until: null,
    quotes: [{ start: 0, end: 32, excerpt: body.slice(0, 32) }],
  };
}
export async function inputs(s = scope) {
  const preview = await previewCsv(CSV, MAPPING);
  return await validateInputs(
    {
      csv: await reviewCsvSnapshot(
        s,
        CSV,
        MAPPING,
        preview.rows[0].normalized_hash,
        null,
      ),
      sources: [source(s)],
      interpretations: [{
        text:
          "Possible resistance to new tools; requires human interpretation.",
        source_ids: ["website"],
      }],
      conflicts: [],
    },
    s,
    AS_OF,
  );
}
export class MemorySnapshots implements PilotSnapshotStore {
  packets = new Map<string, FrozenPilotPacket>();
  writes = 0;
  failRead = false;
  failBefore = false;
  failAfter = false;
  beforeInsert?: () => void;
  key(s: PacketScope) {
    return `${s.workspace_id}:${s.client_binding_id}:${s.task_id}`;
  }
  // deno-lint-ignore require-await -- synthetic store implements async interface
  async read(s: PacketScope) {
    if (this.failRead) throw new Error("synthetic read failure");
    return structuredClone(this.packets.get(this.key(s)) ?? null);
  }
  // deno-lint-ignore require-await -- atomic synthetic fixture, not a database adapter
  async insertOnce(p: FrozenPilotPacket, f: SnapshotFence) {
    this.beforeInsert?.();
    if (this.failBefore) throw new Error("synthetic insert failure");
    assertEquals(f.brain_hash, p.approval.brain_hash);
    assertEquals(f.inputs_hash, p.approval.inputs_hash);
    const k = this.key(p), old = this.packets.get(k);
    if (old && canonical(old) !== canonical(p)) {
      throw new Error("synthetic immutable conflict");
    }
    if (!old) {
      this.writes++;
      this.packets.set(k, structuredClone(p));
    }
    if (this.failAfter) throw new Error("synthetic lost acknowledgement");
    return structuredClone(this.packets.get(k)!);
  }
}
export async function snapshotFixture(
  selectedScope = scope,
  userId = UA,
  version: unknown = "pilot_context_v1",
) {
  const f = fixture();
  const row = f.n.tables.company_brain.find((r) =>
    r.workspace_id === selectedScope.workspace_id
  )!;
  const profile = row.profile as Record<string, unknown>;
  const label = selectedScope.workspace_id === A ? "A" : "B";
  profile.positioning = {
    offer: `Private ${label} offer`,
    pricing: `Private ${label} pricing`,
  };
  profile.brand_voice = {
    style_rules: [`PRIVATE_${label}_STYLE`],
    avoid: ["Never promise results"],
  };
  profile.exclusions = ["Do not target competitors"];
  profile.messaging_guidelines = ["Drafts only"];
  profile.business_context = {
    region: "Nepal",
    instructions: "Preserve custom client requirements",
  };
  profile.target_customer = {
    industries: ["Software"],
    must_have: ["A mandatory region"],
    nice_to_have: ["Recent growth"],
    disqualifiers: ["Consumer-only"],
  };
  profile.qualification_rules = {
    must_have: ["Evidence required"],
    disqualifiers: ["Excluded owner"],
  };
  const brain = reviewBrainSnapshot(selectedScope, row, Object.keys(profile));
  let approvedInputs = await inputs(selectedScope);
  const t = task(f, selectedScope.task_id);
  t.payload = {
    ...t.payload as Record<string, unknown>,
    pilot_context: {
      version,
      brain_hash: await digest(brain),
      inputs_hash: await digest(approvedInputs),
      approved_sections: brain.approved_sections,
      as_of: AS_OF,
    },
  };
  const bound = selectedScope.workspace_id === A ? await bind(f) : await call(
    f,
    "bind_task",
    { task_id: selectedScope.task_id, resources: [] },
    "jwt-B",
    selectedScope.workspace_id,
    selectedScope.client_binding_id,
  );
  assertEquals(bound.status, 200, JSON.stringify(bound.body));
  const snapshots = new MemorySnapshots();
  let loads = 0;
  const deps: SnapshotDeps = {
    mode: "offline_fixture",
    env: f.env,
    user_id: userId,
    scopeStore: createPilotScopeStore(f.deps),
    snapshots,
    loadApprovedInputs: () => {
      loads++;
      return Promise.resolve(structuredClone(approvedInputs));
    },
  };
  return {
    f,
    row,
    brain,
    deps,
    snapshots,
    loads: () => loads,
    changeInputs: (v: typeof approvedInputs) => approvedInputs = v,
  };
}
