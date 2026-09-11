// A SIGNAL HANDED TO PILOT: which one, verified, and what it means for routing.
// ZERO network, ZERO database, ZERO models — the database is a fake.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  anchorComposeToSignal, contentAngleForHandoff, contentFormatForHandoff,
  contentObjectiveForHandoff, resolveSignalHandoff, signalHandoffRefusalMessage,
  type SignalHandoff, type SignalLookupDb,
} from "../../../supabase/functions/_shared/signalContentHandoff.ts";
import { planCompose } from "../../../supabase/functions/_shared/composeSurface.ts";
import { routeRequest } from "../../../supabase/functions/_shared/objectiveRouter.ts";
import type { RequestV1 } from "../../../supabase/functions/_shared/requestV1.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "22222222-2222-4222-8222-222222222222";
const SIG = "33333333-3333-4333-8333-333333333333";
const LEGACY = "44444444-4444-4444-8444-444444444444";
const MAPPED = "55555555-5555-4555-8555-555555555555";

type Row = Record<string, unknown>;

/** A fake PostgREST: rows per table, filtered by every `eq`. Records each query. */
function fakeDb(tables: Record<string, Row[]>, opts: { failOn?: string } = {}) {
  const queries: Array<{ table: string; filters: Record<string, string> }> = [];
  const db: SignalLookupDb = {
    from(table) {
      return {
        select() {
          const filters: Record<string, string> = {};
          const step = (col: string, val: string) => {
            filters[col] = val;
            return {
              eq(c2: string, v2: string) {
                filters[c2] = v2;
                return {
                  maybeSingle: async () => {
                    queries.push({ table, filters: { ...filters } });
                    if (opts.failOn === table) return { data: null, error: { message: "boom" } };
                    const hit = (tables[table] ?? []).find((r) =>
                      Object.entries(filters).every(([k, v]) => r[k] === v));
                    return { data: hit ?? null, error: null };
                  },
                };
              },
            };
          };
          return { eq: step };
        },
      };
    },
  };
  return { db, queries };
}

const TABLES = {
  signal_events: [
    { id: SIG, workspace_id: WS, signal_type: "competitor_activity", subject_type: "competitor", subject_key: "outreach",
      normalized_value: { title: "Acme is hiring 3 SDRs" } },
    { id: MAPPED, workspace_id: WS, legacy_signal_id: LEGACY + "-x", normalized_value: {} },
  ],
  signals: [{ id: LEGACY, workspace_id: WS, title: "Old radar signal", signal_type: "competitor", raw: {} }],
};

// ══════════ 1. verification ═════════════════════════════════════════════════

Deno.test("no signal named: no query at all", async () => {
  const { db, queries } = fakeDb(TABLES);
  for (const v of [undefined, null, ""]) {
    assertEquals(await resolveSignalHandoff(db, WS, v), { kind: "none" });
  }
  assertEquals(queries.length, 0);
});

Deno.test("a canonical signal in this workspace resolves, with the feed's title", async () => {
  const { db, queries } = fakeDb(TABLES);
  assertEquals(await resolveSignalHandoff(db, WS, SIG), {
    kind: "signal", signal_id: SIG, title: "Acme is hiring 3 SDRs",
    // WHO IT HAPPENED TO, from the row's own relationship fields.
    subject: { relationship: "competitor", name: "Outreach" },
  });
  // Scoped, and never asking for a column signal_events does not have.
  assertEquals(queries[0], { table: "signal_events", filters: { id: SIG, workspace_id: WS } });
});

Deno.test("another workspace's signal is refused, not attached", async () => {
  const { db, queries } = fakeDb(TABLES);
  assertEquals(await resolveSignalHandoff(db, OTHER_WS, SIG),
    { kind: "refused", reason: "signal_not_in_workspace" });
  assert(queries.every((q) => q.filters.workspace_id === OTHER_WS), "every lookup is workspace-scoped");
});

Deno.test("a forged / non-uuid id is refused before any query", async () => {
  const { db, queries } = fakeDb(TABLES);
  for (const v of ["not-a-uuid", "'; drop table x; --", 42, { id: SIG }]) {
    assertEquals(await resolveSignalHandoff(db, WS, v), { kind: "refused", reason: "invalid_signal_id" });
  }
  assertEquals(queries.length, 0);
});

Deno.test("a legacy-only signal is real but unlinked; a mapped legacy id takes its canonical id", async () => {
  const { db } = fakeDb(TABLES);
  assertEquals(await resolveSignalHandoff(db, WS, LEGACY), {
    kind: "legacy_unlinked", legacy_signal_id: LEGACY, title: "Old radar signal",
    subject: { relationship: "competitor", name: null },
  });

  const mapped = fakeDb({
    signal_events: [{ id: MAPPED, workspace_id: WS, legacy_signal_id: LEGACY, normalized_value: { title: "Mapped" } }],
    signals: [{ id: LEGACY, workspace_id: WS, title: "Old" }],
  });
  assertEquals(await resolveSignalHandoff(mapped.db, WS, LEGACY),
    { kind: "signal", signal_id: MAPPED, title: "Mapped", subject: { relationship: "external", name: null } });
});

Deno.test("a failed lookup refuses honestly rather than guessing", async () => {
  const { db } = fakeDb(TABLES, { failOn: "signal_events" });
  assertEquals(await resolveSignalHandoff(db, WS, SIG), { kind: "refused", reason: "signal_lookup_failed" });
  assert(/nothing was charged/i.test(signalHandoffRefusalMessage("signal_lookup_failed")));
  assert(/nothing was charged/i.test(signalHandoffRefusalMessage("signal_not_in_workspace")));
});

// ══════════ 2. anchoring the request ════════════════════════════════════════

function compose(entity: string, refs: Array<{ kind: "named" | "saved_set" | "prior_result"; value: string }>, blocking = true): RequestV1 {
  return {
    version: "request-v1", objective: "compose", confidence: 0.9,
    parts: [{
      id: "p1", objective: "compose",
      subject: { entity, references: refs },
      output: { shape: "artifact", count: null, completeness: "sample", medium: "text" },
    }],
    ambiguity: blocking
      ? [{ part_id: "p1", field: "subject.references", question: "Which one?", blocking: true }]
      : [],
    spend: { may_spend: false, max_cost_units: null, requires_confirmation: true },
    authority: {}, provenance: {},
  } as unknown as RequestV1;
}
const LINKED: SignalHandoff = {
  kind: "signal", signal_id: SIG, title: "Acme is hiring 3 SDRs", subject: { relationship: "competitor", name: "Outreach" },
};
const THIS = [{ kind: "prior_result" as const, value: "this signal" }];

Deno.test("'turn this signal into a post' — every subject Chat Brain might pick — creates content", () => {
  for (const entity of ["signal", "content", "company", "market", "job"]) {
    const req = anchorComposeToSignal(compose(entity, THIS), LINKED);
    const plan = planCompose(req);
    assertEquals(plan?.kind, "content", `${entity} must not become outreach`);
    // A back-reference to a SIGNAL is not a back-reference to a draft.
    assertEquals(plan?.content_objective, "create", `${entity} must not regenerate`);
    assertEquals(plan?.targets_existing_content, false);
    // The answered reference no longer blocks, so the router serves it.
    const route = routeRequest(req, { spendAllowed: true, confirmationRequired: true });
    assertEquals(route.kind, "compose", entity);
    assertEquals(route.compose?.kind, "content");
  }
});

Deno.test("WITHOUT the handoff, a content back-reference still regenerates — the rule is unchanged", () => {
  const plan = planCompose(compose("content", [{ kind: "prior_result", value: "that post" }]));
  assertEquals(plan?.content_objective, "regenerate_text");
});

Deno.test("the anchored reference is the verified signal; the model's words are not kept as a back-reference", () => {
  const req = anchorComposeToSignal(compose("content", THIS), LINKED);
  const refs = req.parts[0].subject.references ?? [];
  assertEquals(req.parts[0].subject.entity, "signal");
  assert(!refs.some((r) => r.kind === "prior_result"));
  assertEquals(refs.find((r) => r.kind === "named")?.resolved_key, SIG);
  assertEquals(req.ambiguity.length, 0);
});

Deno.test("an explicit recipient is never anchored: outreach stays gated", () => {
  for (const req of [
    compose("person", THIS),
    compose("company", [{ kind: "saved_set", value: "my leads" }]),
  ]) {
    const anchored = anchorComposeToSignal(req, LINKED);
    assertEquals(anchored, req, "untouched");
    assertEquals(planCompose(anchored)?.kind, "outreach");
  }
});

Deno.test("no handoff, or a refused one: the request is returned untouched", () => {
  const req = compose("content", THIS);
  assertEquals(anchorComposeToSignal(req, { kind: "none" }), req);
  assertEquals(anchorComposeToSignal(req, { kind: "refused", reason: "signal_not_in_workspace" }), req);
});

Deno.test("other ambiguities survive anchoring", () => {
  const req = compose("content", THIS);
  req.ambiguity.push({ part_id: "p1", field: "output.count", question: "How many?", blocking: true });
  const anchored = anchorComposeToSignal(req, LINKED);
  assertEquals(anchored.ambiguity.map((a) => a.field), ["output.count"]);
});

// ══════════ 3. objective, format, angle ═════════════════════════════════════

Deno.test("a handed-over signal always creates its own draft", () => {
  for (const planned of ["create", "regenerate_text", "generate_image", "reference", null] as const) {
    assertEquals(contentObjectiveForHandoff(planned, LINKED), "create");
  }
  assertEquals(contentObjectiveForHandoff("regenerate_text", { kind: "none" }), "regenerate_text");
});

Deno.test("format: a comment only from a signal card that asked for one", () => {
  assertEquals(contentFormatForHandoff({ content_format: "linkedin_comment" }, LINKED), "linkedin_comment");
  assertEquals(contentFormatForHandoff({ content_format: "carousel" }, LINKED), "linkedin_post");
  assertEquals(contentFormatForHandoff({ content_format: "linkedin_comment" }, { kind: "none" }), "linkedin_post");
});

Deno.test("angle: the card's own sentence is not the user's angle; a typed message is", () => {
  const card = { intent: "signal_to_content", signal_id: SIG };
  assertEquals(contentAngleForHandoff("Scribe, turn signal \"X\" into a post", card, LINKED), "");
  assertEquals(contentAngleForHandoff("focus on hiring pain", { signal_id: SIG }, LINKED), "focus on hiring pain");
  assertEquals(contentAngleForHandoff("write about AI", null, { kind: "none" }), "write about AI");
});
