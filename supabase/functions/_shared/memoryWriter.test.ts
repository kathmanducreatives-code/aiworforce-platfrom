import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { writeMemoryFromToolCall, writeMemoryFromAgentResult } from "./memoryWriter.ts";

// Lightweight in-memory fake of the supabase-js client surface we use.
function makeFake() {
  const tables: Record<string, any[]> = {
    accounts: [],
    contacts: [],
    signals: [],
    lead_candidates: [],
    lead_enrichments: [],
    outreach_drafts: [],
    saved_outputs: [],
    messages: [],
    approvals: [],
  };
  function builder(name: string) {
    const state: any = { table: name, filters: [], _select: null };
    const b: any = {
      insert(row: any) {
        const rows = Array.isArray(row) ? row : [row];
        const inserted = rows.map((r) => ({ id: crypto.randomUUID(), ...r }));
        tables[name].push(...inserted);
        state._inserted = inserted;
        return b;
      },
      upsert(row: any, opts?: any) {
        const rows = Array.isArray(row) ? row : [row];
        const onConflict = (opts?.onConflict ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
        const inserted: any[] = [];
        for (const r of rows) {
          let existing: any = null;
          if (onConflict.length > 0) {
            existing = tables[name].find((e) =>
              onConflict.every((k: string) => {
                const ev = (e[k] ?? "").toString().toLowerCase();
                const rv = (r[k] ?? "").toString().toLowerCase();
                return ev === rv && ev !== "";
              })
            );
          }
          if (existing) {
            if (opts?.ignoreDuplicates) {
              inserted.push(existing);
            } else {
              Object.assign(existing, r);
              inserted.push(existing);
            }
          } else {
            const row2 = { id: crypto.randomUUID(), ...r };
            tables[name].push(row2);
            inserted.push(row2);
          }
        }
        state._inserted = inserted;
        return b;
      },
      update(patch: any) { state._patch = patch; return b; },
      select(_cols?: string) { return b; },
      eq(col: string, val: any) { state.filters.push([col, val]); return b; },
      match(obj: any) { for (const k of Object.keys(obj)) state.filters.push([k, obj[k]]); return b; },
      filter(_a: any, _op: any, _v: any) { return b; },
      in(col: string, vals: any[]) { state.filters.push([col, vals, "in"]); return b; },
      order() { return b; },
      limit() { return b; },
      maybeSingle() {
        const first = (state._inserted ?? tables[name].filter((row) =>
          state.filters.every(([k, v]: [string, any]) => row[k] === v)
        ))[0] ?? null;
        return Promise.resolve({ data: first, error: null });
      },
      single() { return b.maybeSingle(); },
      then(resolve: any) {
        if (state._patch) {
          for (const row of tables[name]) {
            if (state.filters.every(([k, v]: [string, any]) => row[k] === v)) {
              Object.assign(row, state._patch);
            }
          }
          return resolve({ data: null, error: null });
        }
        const rows = tables[name].filter((row) =>
          state.filters.every(([k, v, op]: [string, any, string?]) =>
            op === "in" ? (v as any[]).includes(row[k]) : row[k] === v
          )
        );
        return resolve({ data: rows, error: null });
      },
    };
    return b;
  }
  return {
    tables,
    admin: { from: (name: string) => builder(name) } as any,
  };
}

Deno.test("writeMemoryFromToolCall: Apify jobs creates accounts + signals + lead_candidates", async () => {
  const { tables, admin } = makeFake();
  await writeMemoryFromToolCall({
    admin,
    workspace_id: "ws-1",
    plan_id: "plan-1",
    task_id: null,
    tool_call_id: "tc-1",
    tool_name: "source_with_apify",
    selected_actor_key: "apify_jobs_indeed",
    output: {
      items: [
        { companyName: "Acme", title: "Growth Marketer", url: "https://indeed.com/x", companyUrl: "https://acme.com" },
        { companyName: "Acme", title: "Growth Marketer", url: "https://indeed.com/x", companyUrl: "https://acme.com" }, // duplicate
        { companyName: "Beta Co", title: "GTM Lead", companyUrl: "https://beta.io" },
      ],
    },
  });
  assertEquals(tables.accounts.length, 2, "two unique accounts after dedupe");
  assertEquals(tables.signals.length, 2, "two signals (one per unique account)");
  assertEquals(tables.lead_candidates.length, 2);
  assert(tables.lead_candidates.every((l) => l.lead_type === "company"));
});

Deno.test("writeMemoryFromToolCall: Apify people creates contacts + signals; never invents email", async () => {
  const { tables, admin } = makeFake();
  await writeMemoryFromToolCall({
    admin,
    workspace_id: "ws-1",
    plan_id: "plan-1",
    task_id: null,
    tool_call_id: "tc-2",
    tool_name: "source_with_apify",
    output: {
      normalized_source_type: "people_profiles",
      items: [
        { full_name: "Jane Dev", title: "React Engineer", profile_url: "https://linkedin.com/in/jane" },
        { full_name: "Jane Dev", title: "React Engineer", profile_url: "https://linkedin.com/in/jane" }, // dup
      ],
    },
  });
  assertEquals(tables.contacts.length, 1, "linkedin dedupe");
  assert(tables.contacts.every((c) => c.email === null && c.phone === null), "no invented contact data");
  assertEquals(tables.signals.length, 2);
  assertEquals(tables.lead_candidates.length, 2);
  assert(tables.lead_candidates.every((l) => l.lead_type === "person"));
});

Deno.test("writeMemoryFromToolCall: Firecrawl writes enrichment + saved_output", async () => {
  const { tables, admin } = makeFake();
  await writeMemoryFromToolCall({
    admin,
    workspace_id: "ws-1",
    plan_id: "plan-1",
    task_id: null,
    tool_call_id: "tc-3",
    tool_name: "scrape_url",
    output: { data: { url: "https://stripe.com/jobs", title: "Stripe Jobs", markdown: "We are hiring." } },
  });
  assertEquals(tables.lead_enrichments.length, 1);
  assertEquals(tables.saved_outputs.length, 1);
  assertEquals(tables.saved_outputs[0].type, "workflow_summary");
});

Deno.test("writeMemoryFromAgentResult: Scribe writes content_draft", async () => {
  const { tables, admin } = makeFake();
  await writeMemoryFromAgentResult({
    admin,
    workspace_id: "ws-1",
    plan_id: "plan-1",
    agent_slug: "scribe",
    output_text: "Hello world\nThis is a LinkedIn post about what we shipped.",
  });
  assertEquals(tables.saved_outputs.length, 1);
  assertEquals(tables.saved_outputs[0].type, "content_draft");
  assertEquals(tables.saved_outputs[0].title, "Hello world");
});
