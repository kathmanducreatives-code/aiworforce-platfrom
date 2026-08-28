// THE BASELINE MUST BE SAFE, READABLE AND UNABLE TO BREAK ANYTHING.
//
// Phase 0 exists because the Chat Brain migration's safety argument is
// equivalence with the current classifiers, and nothing records what they
// decide. The logger is the cheapest possible defence against repeating Phase
// 8, where fixes shipped against behaviour nobody had measured.
//
// Its three obligations: never alter a decision, never leak a contact detail,
// and stay joinable across paraphrases.
//
// Pure. No network, no database.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildUnderstandingRow, recordUnderstanding, redactUtterance, utteranceHash,
  REQUEST_UNDERSTANDING_TABLE, type UnderstandingWriter,
} from "../../../supabase/functions/_shared/requestUnderstandingLog.ts";

const writer = (over: Partial<{ throws: boolean; error: unknown }> = {}) => {
  const rows: unknown[] = [];
  const db: UnderstandingWriter = {
    from: (t: string) => ({
      insert: (row: unknown) => {
        if (over.throws) throw new Error("db down");
        assertEquals(t, REQUEST_UNDERSTANDING_TABLE);
        rows.push(row);
        return { error: over.error ?? null };
      },
    }),
  };
  return { db, rows };
};

// ══ 1. IT CANNOT BREAK THE REQUEST ═════════════════════════════════════════

Deno.test("a thrown database error is swallowed", async () => {
  // A logger that can fail a request is worse than no logger. The execution
  // ledger sets the precedent: observability must not fail the run it watches.
  const { db } = writer({ throws: true });
  await recordUnderstanding(db, {
    workspaceId: "ws", source: "workflow_classifier", utterance: "hi",
  });
});

Deno.test("a returned error is swallowed", async () => {
  const { db } = writer({ error: { message: "rls" } });
  await recordUnderstanding(db, {
    workspaceId: "ws", source: "workflow_classifier", utterance: "hi",
  });
});

Deno.test("a missing client is a no-op, not a crash", async () => {
  await recordUnderstanding(null, {
    workspaceId: "ws", source: "workflow_classifier", utterance: "hi",
  });
  await recordUnderstanding(undefined, {
    workspaceId: "ws", source: "workflow_classifier", utterance: "hi",
  });
});

Deno.test("recordUnderstanding returns nothing a caller could branch on", async () => {
  const { db } = writer();
  const out = await recordUnderstanding(db, {
    workspaceId: "ws", source: "workflow_classifier", utterance: "hi",
  });
  assertEquals(out, undefined);
});

// ══ 2. IT CANNOT LEAK ══════════════════════════════════════════════════════

Deno.test("contact details are redacted from the readable copy", () => {
  const raw = "Email dan@acme.co or call +1 (415) 555-0134 about acct 998877665544";
  const r = redactUtterance(raw);
  assertEquals(r.includes("dan@acme.co"), false);
  assertEquals(/555-0134/.test(r), false);
  assertEquals(r.includes("998877665544"), false);
  assert(r.includes("[email]") && r.includes("[phone]"));
});

Deno.test("the meaning survives redaction", () => {
  // The corpus is read by a human deciding whether six objectives cover the
  // product. Over-redacting to the point of unreadability defeats it.
  const r = redactUtterance("Find 3 B2B SaaS companies hiring SDRs in the US");
  assertEquals(r, "Find 3 B2B SaaS companies hiring SDRs in the US");
});

Deno.test("a very long utterance is bounded", () => {
  assert(redactUtterance("x".repeat(9000)).length <= 2000);
});

// ══ 3. IT STAYS JOINABLE ═══════════════════════════════════════════════════

Deno.test("paraphrase-identical utterances share a hash", async () => {
  // The corpus counts how often a phrasing recurs, so casing and whitespace
  // must not fragment it.
  const a = await utteranceHash("Find 5 SaaS companies hiring SDRs");
  const b = await utteranceHash("  find 5  saas   companies HIRING sdrs ");
  assertEquals(a, b);
});

Deno.test("different questions do not collide", async () => {
  const a = await utteranceHash("Find companies hiring SDRs");
  const b = await utteranceHash("Find companies hiring AEs");
  assert(a !== b);
});

Deno.test("the hash is not the utterance", async () => {
  const h = await utteranceHash("dan@acme.co wants 5 leads");
  assertEquals(h.includes("acme"), false);
  assertEquals(h.length, 32);
});

// ══ 4. THE ROW CARRIES BOTH VOCABULARIES ═══════════════════════════════════

Deno.test("an old-path row records a category and no objective", async () => {
  const row = await buildUnderstandingRow({
    workspaceId: "ws", conversationId: "c1", source: "workflow_classifier",
    utterance: "Find 5 SaaS companies", category: "qualified_lead_sourcing",
    confidence: 0.82,
  });
  assertEquals(row.category, "qualified_lead_sourcing");
  assertEquals(row.objective, null, "the old path has no objective vocabulary");
  assertEquals(row.confidence, 0.82);
  assertEquals(row.workspace_id, "ws");
});

Deno.test("a shadow row records an objective and no category", async () => {
  // Phase B writes these beside the old ones, so agreement can be measured by
  // joining on utterance_hash without a schema change.
  const row = await buildUnderstandingRow({
    workspaceId: "ws", source: "chat_brain_shadow",
    utterance: "What are my strongest signals?", objective: "read",
  });
  assertEquals(row.objective, "read");
  assertEquals(row.category, null);
});

Deno.test("a decision joins to the run it produced", async () => {
  const row = await buildUnderstandingRow({
    workspaceId: "ws", source: "lead_intent_model", utterance: "Find 3 companies",
    missionHash: "abc123", taskId: "t1",
    stage0Grades: { hiring: "satisfied" },
  });
  assertEquals(row.mission_hash, "abc123");
  assertEquals(row.task_id, "t1");
  assertEquals(row.stage0_grades, { hiring: "satisfied" });
});

Deno.test("absent fields are null, never undefined", async () => {
  // The row is inserted verbatim; an undefined would be dropped by the client
  // and the column would silently keep a default instead of the honest null.
  const row = await buildUnderstandingRow({
    workspaceId: "ws", source: "lead_intent", utterance: "hi",
  });
  for (const [k, v] of Object.entries(row)) {
    assertEquals(v === undefined, false, `${k} must not be undefined`);
  }
});

// ══ 5. THE CALL SITE ═══════════════════════════════════════════════════════

Deno.test("pilot-chat records Chat Brain's verdict, and branches on nothing", async () => {
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url),
  );
  // ── THE BASELINE IS RETIRED WITH ITS SUBJECT ─────────────────────────────
  //
  // This asserted a `source: "workflow_classifier"` row was written on every
  // message, so the new path's equivalence could be measured against the old
  // one. The old one is deleted, so there is nothing to compare against and a
  // row sourced from a removed component would be a fiction.
  assertFalse(SRC.includes('source: "workflow_classifier"'),
    "no row may name a component that no longer exists");

  const i = SRC.indexOf('source: "chat_brain_shadow"');
  assert(i > 0, "Chat Brain's own verdict is now the whole record");
  const block = SRC.slice(Math.max(0, i - 600), i + 900);
  assert(block.includes("recordUnderstanding("));

  // NOTHING MAY DEPEND ON IT. An assignment or a conditional keyed on the
  // logger's result would make observation load-bearing, which is the one thing
  // this table must never become.
  const code = block.split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  assertFalse(/if\s*\(\s*await recordUnderstanding|=\s*await recordUnderstanding/.test(code),
    "the log must return nothing anyone branches on");
});

