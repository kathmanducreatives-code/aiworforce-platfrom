// A SCRIBE REVISION IS RECORDED AS ONE.
//
// The Studio's Scribe panel ("Make more concise", "Ask Scribe…") regenerates on
// the one Content path with a typed `revision`. The writer puts it on the row's
// `last_prompt_context`, which the version trigger copies onto the new version —
// so History can say what was asked. Driven through the real writer.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { writeMemoryFromAgentResult } from "../../../supabase/functions/_shared/memoryWriter.ts";

function fakeAdmin(rows: Record<string, Array<Record<string, unknown>>>) {
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let op: "select" | "update" | "insert" = "select";
    let values: Record<string, unknown> = {};
    const hit = () => (rows[table] ?? []).filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
    const b: Record<string, unknown> = {
      select() { return b; },
      update(v: Record<string, unknown>) { op = "update"; values = v; return b; },
      insert(v: Record<string, unknown>) { op = "insert"; values = v; (rows[table] ??= []).push(v); return b; },
      eq(c: string, v: unknown) { filters[c] = v; return b; },
      maybeSingle() { return Promise.resolve({ data: hit()[0] ?? null, error: null }); },
      single() { return Promise.resolve({ data: hit()[0] ?? null, error: null }); },
      then(res: (v: unknown) => unknown) {
        if (op === "update") for (const r of hit()) Object.assign(r, values);
        return Promise.resolve({ data: null, error: null }).then(res);
      },
    };
    return b;
  };
  return { from };
}

const WS = "ws-1";
const item = () => ({ id: "item-1", workspace_id: WS, metadata: { brief: "B" } as Record<string, unknown> });

Deno.test("a revision request lands on last_prompt_context (and so on the version)", async () => {
  const rows = { content_item: [item()], saved_outputs: [] as Array<Record<string, unknown>> };
  await writeMemoryFromAgentResult({
    admin: fakeAdmin(rows), workspace_id: WS, conversation_id: "c", plan_id: "p", task_id: "t-1",
    agent_slug: "scribe", output_text: "A tighter post.", model_used: "claude-haiku-4-5-20251001", provider_used: "anthropic",
    content_loop: { source: "content_surface", subtype: "linkedin_post", content_item_id: "item-1", regenerate: true,
      revision: "Make the draft more concise — cut roughly a third while keeping the point and the voice." },
  } as never);
  const row = rows.content_item[0] as Record<string, unknown>;
  const ctx = (row.metadata as Record<string, unknown>).last_prompt_context as Record<string, unknown>;
  assertEquals(ctx.revision, "Make the draft more concise — cut roughly a third while keeping the point and the voice.");
  assertEquals(row.last_generation_source, "scribe_regeneration");
  assertEquals((row.metadata as Record<string, unknown>).brief, "B", "the brief is merged, never replaced");
  assertEquals(rows.saved_outputs.length, 0, "a canonical draft writes no shadow row");
});

Deno.test("an ordinary regeneration records no revision", async () => {
  const rows = { content_item: [item()], saved_outputs: [] as Array<Record<string, unknown>> };
  await writeMemoryFromAgentResult({
    admin: fakeAdmin(rows), workspace_id: WS, conversation_id: "c", plan_id: "p", task_id: "t-2",
    agent_slug: "scribe", output_text: "Another post.",
    content_loop: { source: "content_surface", subtype: "linkedin_post", content_item_id: "item-1", regenerate: true },
  } as never);
  const ctx = ((rows.content_item[0] as Record<string, unknown>).metadata as Record<string, unknown>).last_prompt_context as Record<string, unknown>;
  assertEquals(ctx.revision, null);
});
