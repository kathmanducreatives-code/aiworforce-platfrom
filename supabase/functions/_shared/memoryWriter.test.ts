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

Deno.test("writeMemoryFromToolCall: LinkedIn engagement writes signals + contacts + lead_candidates; no invented contact data", async () => {
  const { tables, admin } = makeFake();
  await writeMemoryFromToolCall({
    admin,
    workspace_id: "ws-1",
    plan_id: "plan-li",
    task_id: null,
    tool_call_id: "tc-li",
    tool_name: "source_with_apify",
    selected_actor_key: "apify_linkedin_posts",
    output: {
      normalized_source_type: "linkedin_engagement",
      items: [
        {
          type: "linkedin_engagement",
          post_url: "https://linkedin.com/posts/a",
          post_text: "Outbound is broken.",
          post_author_name: "Jane Founder",
          post_author_title: "CEO",
          post_author_company: "Acme",
          post_author_profile_url: "https://linkedin.com/in/jane",
          topic: "outbound problems",
          signal_reason: "Active pain about outbound",
        },
        {
          type: "linkedin_engagement",
          post_url: "https://linkedin.com/posts/a", // same post
          post_author_name: "Jane Founder",
          post_author_profile_url: "https://linkedin.com/in/jane", // dedupe contact
          topic: "outbound problems",
        },
      ],
    },
  });
  assertEquals(tables.signals.length, 2, "one signal per engagement item");
  assert(tables.signals.every((s) => s.signal_type === "linkedin_engagement"));
  assertEquals(tables.contacts.length, 1, "contact deduped by linkedin_url");
  assert(tables.contacts.every((c) => c.email === null && c.phone === null), "never invents email/phone");
  assertEquals(tables.lead_candidates.length, 2);
  assert(tables.lead_candidates.every((l) => l.lead_type === "person"));
  assertEquals(tables.accounts.length, 1, "author company → one account");
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

Deno.test("writeMemoryFromAgentResult: Penn links drafts to explicit remembered lead ids", async () => {
  const { tables, admin } = makeFake();
  // Remembered leads from a PRIOR plan (the Penn-only draft plan has none of its own).
  tables.lead_candidates.push(
    { id: "lead-1", workspace_id: "ws-1", account_id: "acc-1", contact_id: "con-1", plan_id: "prior-plan" },
    { id: "lead-2", workspace_id: "ws-1", account_id: "acc-2", contact_id: null, plan_id: "prior-plan" },
  );
  await writeMemoryFromAgentResult({
    admin,
    workspace_id: "ws-1",
    plan_id: "draft-plan", // new Penn-only plan, no leads of its own
    task_id: "task-1",
    agent_slug: "penn",
    output_text: JSON.stringify([
      { subject: "Hi 1", body: "Personalized body one." },
      { subject: "Hi 2", body: "Personalized body two." },
    ]),
    lead_candidate_ids: ["lead-1", "lead-2"],
  });
  assertEquals(tables.outreach_drafts.length, 2, "one draft per remembered lead, no duplicates");
  const d1 = tables.outreach_drafts[0];
  assertEquals(d1.lead_candidate_id, "lead-1");
  assertEquals(d1.account_id, "acc-1");
  assertEquals(d1.contact_id, "con-1");
  assertEquals(d1.status, "draft");
  const d2 = tables.outreach_drafts[1];
  assertEquals(d2.lead_candidate_id, "lead-2");
  assertEquals(d2.account_id, "acc-2");
});
