// ENGAGEMENT COMMENT DRAFTS ARE CANONICAL CONTENT — one item per post.
//
// Pure helpers, plus the real `writeMemoryFromAgentResult` driven against a
// recording fake database: what the writer inserts and updates is asserted as
// behaviour, not read out of source text. ZERO network, ZERO models.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  commentItemIdea, commentItemTitle, commentOpportunitiesFrom, resolveEngagementPostSource,
  type EngagementLookupDb,
} from "../../../supabase/functions/_shared/engagementCommentItems.ts";
import { writeMemoryFromAgentResult } from "../../../supabase/functions/_shared/memoryWriter.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const URL_A = "https://www.linkedin.com/posts/alice_abc";
const URL_B = "https://www.linkedin.com/posts/bob_def";

// ══════════ a recording fake of the PostgREST builder ═══════════════════════

type Row = Record<string, unknown>;
interface Op { table: string; op: "insert" | "update" | "select"; values?: unknown; filters: Record<string, unknown> }

function fakeAdmin(tables: Record<string, Row[]>, opts: { failInsertOn?: string; throwInsertOn?: string } = {}) {
  const ops: Op[] = [];
  let seq = 0;
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let op: Op["op"] = "select";
    let values: unknown;
    let single = false;
    const rows = () => (tables[table] ?? []).filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
    const result = () => {
      if (op === "insert") {
        if (opts.failInsertOn === table) return { data: null, error: { message: "insert refused" } };
        const row = { id: `${table}-${++seq}`, status: "draft", current_version_id: null, current_asset_id: null, ...(values as Row) };
        (tables[table] ??= []).push(row);
        return { data: single ? row : [row], error: null };
      }
      if (op === "update") {
        for (const r of rows()) Object.assign(r, values as Row);
        return { data: null, error: null };
      }
      const hit = rows();
      return { data: single ? (hit[0] ?? null) : hit, error: null };
    };
    const b: Record<string, unknown> = {
      select() { return b; },
      insert(v: unknown) {
        if (opts.throwInsertOn === table) throw new Error("connection reset");
        op = "insert"; values = v; ops.push({ table, op, values: v, filters }); return b;
      },
      update(v: unknown) { op = "update"; values = v; ops.push({ table, op, values: v, filters }); return b; },
      eq(c: string, v: unknown) { filters[c] = v; return b; },
      order() { return b; },
      limit() { return b; },
      single() { single = true; return Promise.resolve(result()); },
      maybeSingle() { single = true; return Promise.resolve(result()); },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(result()).then(res, rej); },
    };
    return b;
  };
  return { admin: { from } as unknown, ops, tables };
}

function ctx(admin: unknown, output: string, content_loop: Record<string, unknown>) {
  return {
    admin, workspace_id: WS, conversation_id: "conv-1", plan_id: "plan-1", task_id: "task-1",
    agent_slug: "scribe", output_text: output, model_used: "claude-haiku-4-5-20251001", provider_used: "anthropic",
    content_loop,
  } as never;
}

const LOOP = { source: "content_engagement_loop", subtype: "comment_draft", topic: "AI SDRs" };
const TWO = JSON.stringify([
  { post_url: URL_A, author: "Alice", comment: "Useful framing — the handoff is where teams lose the thread." },
  { post_url: URL_B, author: "Bob", comment: "Agree on consistency over volume; we saw the same." },
]);

// ══════════ 1. the writer ════════════════════════════════════════════════════

Deno.test("one canonical linkedin_comment per commented post, filled, and NO saved_outputs row", async () => {
  const { admin, ops, tables } = fakeAdmin({
    signals: [{ id: "legacy-a", workspace_id: WS, source_url: URL_A, title: "Alice — AI SDRs", description: "post text A" }],
  });
  await writeMemoryFromAgentResult(ctx(admin, TWO, LOOP));

  const items = tables.content_item ?? [];
  assertEquals(items.length, 2, "exactly one item per post that got a comment");
  for (const it of items) {
    assertEquals(it.format, "linkedin_comment");
    assertEquals(it.source, "content_engagement_loop");
    assertEquals(it.workspace_id, WS);
    // Filled through the same update as every draft: body, scribe, draft, provenance.
    assertEquals(it.agent_slug, "scribe");
    assertEquals(it.status, "draft");
    assertEquals(it.last_generation_source, "scribe_generation");
    assertEquals((it.metadata as Row).last_model, "claude-haiku-4-5-20251001");
    assertEquals((it.metadata as Row).last_provider, "anthropic");
    assert(String((it.metadata as Row).brief ?? "").length > 0, "the brief a regeneration reads back is kept");
  }
  assertEquals(items.map((i) => i.body), [
    "Useful framing — the handoff is where teams lose the thread.",
    "Agree on consistency over volume; we saw the same.",
  ]);
  assertEquals(ops.filter((o) => o.table === "saved_outputs").length, 0,
    "the canonical items ARE the output — no read-only twin in saved_outputs");
  // Every update is workspace-scoped.
  for (const u of ops.filter((o) => o.op === "update")) assertEquals(u.filters.workspace_id, WS);
});

Deno.test("a legacy engagement post is provenance, never a fake FK; an unknown post keeps its URL", async () => {
  const { admin, tables } = fakeAdmin({
    signals: [{ id: "legacy-a", workspace_id: WS, source_url: URL_A, title: "Alice — AI SDRs", description: "post text A" }],
  });
  await writeMemoryFromAgentResult(ctx(admin, TWO, LOOP));
  const [a, b] = tables.content_item!;
  assertEquals(a.source_type, "idea");
  assertEquals(a.source_signal_id, null);
  assertEquals((a.metadata as Row).legacy_signal, { id: "legacy-a", title: "Alice — AI SDRs", store: "signals" });
  assertEquals((a.metadata as Row).engagement_post, { post_url: URL_A, author: "Alice" });
  assertEquals(b.source_type, "idea");
  assertEquals((b.metadata as Row).legacy_signal, undefined);
  assertEquals((b.metadata as Row).engagement_post, { post_url: URL_B, author: "Bob" });
});

Deno.test("a post collected as a canonical signal gets the real FK", async () => {
  const { admin, tables } = fakeAdmin({
    signal_events: [{ id: "sig-a", workspace_id: WS, source_url: URL_A, normalized_value: { title: "Alice post" } }],
  });
  await writeMemoryFromAgentResult(ctx(admin, TWO, LOOP));
  const a = tables.content_item![0];
  assertEquals(a.source_type, "signal");
  assertEquals(a.source_signal_id, "sig-a");
});

Deno.test("prose instead of JSON: still ONE canonical draft, not lost and not split by guesswork", async () => {
  const { admin, ops, tables } = fakeAdmin({});
  await writeMemoryFromAgentResult(ctx(admin, "Here are two thoughts on the thread about AI SDRs…", LOOP));
  assertEquals(tables.content_item?.length, 1);
  assertEquals(ops.filter((o) => o.table === "saved_outputs").length, 0);
});

Deno.test("if no canonical row can be created, the output falls back to saved_outputs rather than vanish", async () => {
  const { admin, ops } = fakeAdmin({}, { failInsertOn: "content_item" });
  await writeMemoryFromAgentResult(ctx(admin, TWO, LOOP));
  assertEquals(ops.filter((o) => o.table === "saved_outputs" && o.op === "insert").length, 1);
});

Deno.test("a THROWN failure mid-seam still reaches the saved_outputs fallback — nothing paid for is lost", async () => {
  const { admin, ops } = fakeAdmin({}, { throwInsertOn: "content_item" });
  await writeMemoryFromAgentResult(ctx(admin, TWO, LOOP));
  assertEquals(ops.filter((o) => o.table === "saved_outputs" && o.op === "insert").length, 1);
});

Deno.test("a post draft with a content_item_id is untouched by the comment seam", async () => {
  const { admin, ops, tables } = fakeAdmin({
    content_item: [{ id: "item-1", workspace_id: WS, metadata: { brief: "B" } }],
  });
  await writeMemoryFromAgentResult(ctx(admin, "A post.", {
    source: "content_surface", subtype: "founder_post", content_item_id: "item-1",
  }));
  assertEquals(ops.filter((o) => o.op === "insert").length, 0, "no new items, no saved_outputs");
  assertEquals(tables.content_item!.length, 1);
  assertEquals(tables.content_item![0].body, "A post.");
});

// ══════════ 2. the pure helpers ═════════════════════════════════════════════

Deno.test("opportunities: accepted key variants, empty comments dropped, prose is one", () => {
  assertEquals(commentOpportunitiesFrom({ items: [
    { url: URL_A, post_author_name: "A", comment_draft: "x" },
    { post_url: URL_B, text: "y" },
    { post_url: "z", comment: "   " },
  ] }, "ignored"), [
    { post_url: URL_A, author: "A", comment: "x" },
    { post_url: URL_B, author: null, comment: "y" },
  ]);
  assertEquals(commentOpportunitiesFrom({ comments: [{ comment: "c" }] }, ""), [{ post_url: null, author: null, comment: "c" }]);
  assertEquals(commentOpportunitiesFrom(null, "prose"), [{ post_url: null, author: null, comment: "prose" }]);
  assertEquals(commentOpportunitiesFrom(null, "   "), []);
});

Deno.test("title and brief describe the POST, never restate the comment as its subject", () => {
  const o = { post_url: URL_A, author: "Alice", comment: "c" };
  assertEquals(commentItemTitle(o), "Comment on Alice's post");
  const idea = commentItemIdea(o, { kind: "legacy_unlinked", legacy_signal_id: "l", title: "t", snippet: "post text" }, "AI SDRs");
  assert(idea.includes(URL_A) && idea.includes("post text") && idea.includes("AI SDRs"));
  assert(!idea.includes('"c"'));
});

Deno.test("post source lookup is workspace-scoped and tolerant", async () => {
  const seen: Array<Record<string, string>> = [];
  const db = (rows: Record<string, Row[]>, fail = false): EngagementLookupDb => ({
    from: (t) => ({ select: () => ({ eq: (c1, v1) => ({ eq: (c2, v2) => ({ order: () => ({ limit: async () => {
      seen.push({ t, [c1]: v1, [c2]: v2 });
      if (fail) throw new Error("down");
      return { data: (rows[t] ?? []).filter((r) => r[c1] === v1 && r[c2] === v2), error: null };
    } }) }) }) }) }),
  });
  assertEquals(await resolveEngagementPostSource(db({}), WS, null), { kind: "unmatched" });
  assertEquals((await resolveEngagementPostSource(db({ signals: [{ id: "l", workspace_id: "other", source_url: URL_A }] }), WS, URL_A)).kind, "unmatched");
  assertEquals((await resolveEngagementPostSource(db({}, true), WS, URL_A)).kind, "unmatched");
  assert(seen.every((q) => q.workspace_id === WS));
});
