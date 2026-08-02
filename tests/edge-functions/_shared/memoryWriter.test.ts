import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { writeMemoryFromToolCall, writeMemoryFromAgentResult } from "../../../supabase/functions/_shared/memoryWriter.ts";

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

Deno.test("writeMemoryFromToolCall: match_tier + funding fields promote to TOP-LEVEL raw", async () => {
  const { tables, admin } = makeFake();
  await writeMemoryFromToolCall({
    admin, workspace_id: "ws-1", plan_id: "plan-1", task_id: null, tool_call_id: "tc-1",
    tool_name: "source_with_apify", selected_actor_key: "apify_jobs",
    output: {
      items: [
        // run-agent's tierAndCount labels these onto the item's raw before persist.
        { companyName: "Nimbus AI", title: "SDR", url: "https://linkedin.com/jobs/1", companyWebsite: "https://nimbus.ai",
          match_tier: "secondary", funding_required: true, funding_proof_found: false, funding_source_url: null,
          missing_evidence: ["recent funding proof"] },
      ],
    },
  });
  const lead = tables.lead_candidates[0];
  assertEquals(lead.raw.match_tier, "secondary");         // top-level, not raw.hiring.*
  assertEquals(lead.raw.funding_required, true);
  assertEquals(lead.raw.funding_proof_found, false);
  assert((lead.raw.missing_evidence ?? []).includes("recent funding proof"));
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

Deno.test("writeMemoryFromToolCall: competitor mention → competitor_engagement; generic stays linkedin_engagement", async () => {
  const { tables, admin } = makeFake();
  await writeMemoryFromToolCall({
    admin,
    workspace_id: "ws-1",
    plan_id: "plan-comp",
    task_id: null,
    tool_call_id: "tc-comp",
    tool_name: "source_with_apify",
    selected_actor_key: "apify_linkedin_posts",
    output: {
      normalized_source_type: "linkedin_engagement",
      items: [
        {
          type: "linkedin_engagement",
          post_url: "https://linkedin.com/posts/1",
          post_text: "Comparing GojiBerry vs other AI SDR tools for outbound.",
          post_author_name: "Jane Founder",
          post_author_profile_url: "https://linkedin.com/in/jane",
          topic: "AI SDR",
        },
        {
          type: "linkedin_engagement",
          post_url: "https://linkedin.com/posts/2",
          post_text: "Hiring a growth marketer, any tips?",
          post_author_name: "Bob Builder",
          post_author_profile_url: "https://linkedin.com/in/bob",
          topic: "hiring",
        },
      ],
    },
  });
  const comp = tables.signals.find((s) => s.source_url === "https://linkedin.com/posts/1");
  const generic = tables.signals.find((s) => s.source_url === "https://linkedin.com/posts/2");
  assertEquals(comp.signal_type, "competitor_engagement");
  assertEquals(comp.raw.competitor_key, "gojiberry");
  assert(Array.isArray(comp.raw.matched_terms) && comp.raw.matched_terms.length > 0);
  assertEquals(comp.raw.original_signal_type, "linkedin_engagement");
  assertEquals(generic.signal_type, "linkedin_engagement");
  // contacts + leads written; no invented contact data
  assertEquals(tables.contacts.length, 2);
  assert(tables.contacts.every((c) => c.email === null && c.phone === null));
  assertEquals(tables.lead_candidates.length, 2);
  assert(tables.lead_candidates.every((l) => l.lead_type === "person"));
});

Deno.test("competitor signal stores source/category/conversation_type metadata", async () => {
  const { tables, admin } = makeFake();
  await writeMemoryFromToolCall({
    admin, workspace_id: "ws-1", plan_id: "p", task_id: null, tool_call_id: "t",
    tool_name: "source_with_apify", selected_actor_key: "apify_linkedin_posts",
    output: { normalized_source_type: "linkedin_engagement", items: [
      { type: "linkedin_engagement", post_url: "https://linkedin.com/posts/x", post_text: "Apollo data quality is broken, looking for alternatives", post_author_name: "A", post_author_profile_url: "https://linkedin.com/in/a", topic: "Apollo" },
    ] },
  });
  const s = tables.signals[0];
  assertEquals(s.signal_type, "competitor_engagement");
  assertEquals(s.raw.competitor_key, "apollo");
  assertEquals(s.raw.competitor_source, "post_content");
  assert(typeof s.raw.competitor_category === "string");
  assert(["complaint", "alternative_seeking"].includes(s.raw.conversation_type));
  assertEquals(s.raw.original_signal_type, "linkedin_engagement");
});

Deno.test("inferred competitor discovery: tags competitor_engagement even without seed mention", async () => {
  const { tables, admin } = makeFake();
  await writeMemoryFromToolCall({
    admin, workspace_id: "ws-1", plan_id: "p", task_id: null, tool_call_id: "t",
    tool_name: "source_with_apify", selected_actor_key: "apify_linkedin_posts",
    output: {
      normalized_source_type: "linkedin_engagement",
      discovery: { inferred_competitors: ["Regie.ai"], competitor_category: "ai_sdr", matched_query: "Regie.ai AI SDR", original_business_description: "AI employees for GTM teams", original_website_url: null, hypothesis_reason: "inferred from description" },
      items: [
        // No seed competitor in the text, but it came from a discovery search.
        { type: "linkedin_engagement", post_url: "https://linkedin.com/posts/z", post_text: "Outbound is changing fast in 2025.", post_author_name: "Sam", post_author_profile_url: "https://linkedin.com/in/sam", topic: "AI SDR" },
      ],
    },
  });
  const s = tables.signals[0];
  assertEquals(s.signal_type, "competitor_engagement");
  assertEquals(s.raw.competitor_source, "ai_inferred");
  assertEquals(s.raw.competitor_name, "Regie.ai");
  assertEquals(s.raw.competitor_category, "ai_sdr");
  assertEquals(s.raw.matched_query, "Regie.ai AI SDR");
  assertEquals(s.raw.original_business_description, "AI employees for GTM teams");
  assert(s.raw.hypothesis_reason);
  assertEquals(tables.lead_candidates.length, 1);
});

Deno.test("post commenters → contacts + leads, no invented email/phone", async () => {
  const { tables, admin } = makeFake();
  await writeMemoryFromToolCall({
    admin, workspace_id: "ws-1", plan_id: "p", task_id: null, tool_call_id: "t",
    tool_name: "source_with_apify", selected_actor_key: "apify_linkedin_post_comments",
    output: { normalized_source_type: "linkedin_comments", items: [
      { type: "linkedin_commenter", commenter_name: "Jane", commenter_profile_url: "https://linkedin.com/in/jane", comment_text: "we switched off Clay", post_url: "https://linkedin.com/posts/y" },
      { type: "linkedin_commenter", commenter_name: "Jane", commenter_profile_url: "https://linkedin.com/in/jane", post_url: "https://linkedin.com/posts/y" },
    ] },
  });
  assertEquals(tables.signals.length, 2);
  assert(tables.signals.every((s) => s.signal_type === "competitor_engagement"));
  assertEquals(tables.contacts.length, 1, "deduped by linkedin_url");
  assert(tables.contacts.every((c) => c.email === null && c.phone === null));
  assertEquals(tables.lead_candidates.length, 2);
  assert(tables.lead_candidates.every((l) => l.reason === "Commented on competitor/category post"));
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
  // No content_loop → raw is empty (backwards compatible).
  assertEquals(tables.saved_outputs[0].raw, {});
});

Deno.test("writeMemoryFromAgentResult: Scribe content-loop tags subtype/topic/angle", async () => {
  const { tables, admin } = makeFake();
  await writeMemoryFromAgentResult({
    admin,
    workspace_id: "ws-1",
    plan_id: "plan-1",
    agent_slug: "scribe",
    output_text: "Why we built Agentory\nFounder post body…",
    content_loop: {
      source: "content_engagement_loop",
      subtype: "founder_post",
      topic: "AI GTM agents",
      audience: "seed-stage founders",
      angle: "founder lesson",
      engagement_queries: ["AI GTM agents", "AI GTM agents for founders"],
      competitor_related: false,
    },
  });
  const row = tables.saved_outputs[0];
  assertEquals(row.type, "content_draft");
  assertEquals(row.raw.source, "content_engagement_loop");
  assertEquals(row.raw.subtype, "founder_post");
  assertEquals(row.raw.topic, "AI GTM agents");
  assertEquals(row.raw.audience, "seed-stage founders");
  assertEquals(row.raw.angle, "founder lesson");
  assertEquals(row.raw.engagement_queries.length, 2);
});

Deno.test("writeMemoryFromAgentResult: Scribe content-loop comment_draft subtype", async () => {
  const { tables, admin } = makeFake();
  await writeMemoryFromAgentResult({
    admin,
    workspace_id: "ws-1",
    plan_id: "plan-1",
    agent_slug: "scribe",
    output_text: "Comment 1\nComment 2",
    content_loop: { source: "content_engagement_loop", subtype: "comment_draft", topic: "AI SDRs" },
  });
  assertEquals(tables.saved_outputs[0].raw.subtype, "comment_draft");
  assertEquals(tables.saved_outputs[0].raw.source, "content_engagement_loop");
});

Deno.test("writeMemoryFromAgentResult: Penn links drafts to explicit remembered lead ids", async () => {
  const { tables, admin } = makeFake();
  // Remembered leads from a PRIOR plan (the Penn-only draft plan has none of its
  // own). They must be contact-ready for the global draft gate to allow drafting.
  const contactReadyRaw = (co: string) => ({
    canonical_final_decision: "contact", contact_ready: true, company: co,
    source_url: `https://${co}.example.com`, evidence_url: `https://${co}.example.com/careers/1`,
    decision_maker_profile_url: "https://linkedin.com/in/decision-maker",
    provider_provenance: { verified: true, level: "person" },
  });
  tables.lead_candidates.push(
    { id: "lead-1", workspace_id: "ws-1", account_id: "acc-1", contact_id: "con-1", plan_id: "prior-plan", raw: contactReadyRaw("acme") },
    { id: "lead-2", workspace_id: "ws-1", account_id: "acc-2", contact_id: null, plan_id: "prior-plan", raw: contactReadyRaw("globex") },
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
  assertEquals(tables.outreach_drafts.length, 2, "one draft per remembered contact-ready lead, no duplicates");
  const d1 = tables.outreach_drafts[0];
  assertEquals(d1.lead_candidate_id, "lead-1");
  assertEquals(d1.account_id, "acc-1");
  assertEquals(d1.contact_id, "con-1");
  assertEquals(d1.status, "draft");
  const d2 = tables.outreach_drafts[1];
  assertEquals(d2.lead_candidate_id, "lead-2");
  assertEquals(d2.account_id, "acc-2");
});

Deno.test("writeMemoryFromAgentResult: draft gate blocks non-contact-ready remembered leads", async () => {
  const { tables, admin } = makeFake();
  // Leads exist but are NOT contact-ready (no canonical=contact/contact_ready).
  tables.lead_candidates.push(
    { id: "lead-1", workspace_id: "ws-1", account_id: "acc-1", contact_id: "con-1", plan_id: "prior-plan", raw: { canonical_final_decision: "needs_review", contact_ready: false } },
  );
  await writeMemoryFromAgentResult({
    admin, workspace_id: "ws-1", plan_id: "draft-plan", task_id: "task-1", agent_slug: "penn",
    output_text: JSON.stringify([{ subject: "Hi", body: "Body." }]),
    lead_candidate_ids: ["lead-1"],
  });
  assertEquals(tables.outreach_drafts.length, 0, "no draft for a non-contact-ready lead");
});

Deno.test("writeMemoryFromAgentResult: source_and_qualify_only persists zero drafts", async () => {
  const { tables, admin } = makeFake();
  tables.lead_candidates.push(
    { id: "lead-1", workspace_id: "ws-1", account_id: "acc-1", contact_id: "con-1", plan_id: "p", raw: { canonical_final_decision: "contact", contact_ready: true, company: "acme", source_url: "https://acme.example.com", evidence_url: "https://acme.example.com/1", decision_maker_profile_url: "https://linkedin.com/in/x", provider_provenance: { verified: true, level: "person" } } },
  );
  await writeMemoryFromAgentResult({
    admin, workspace_id: "ws-1", plan_id: "p", task_id: "task-1", agent_slug: "penn",
    execution_mode: "source_and_qualify_only",
    output_text: JSON.stringify([{ subject: "Hi", body: "Body." }]),
    lead_candidate_ids: ["lead-1"],
  });
  assertEquals(tables.outreach_drafts.length, 0, "sourcing-only mode never drafts, even for a contact-ready lead");
});

Deno.test("writeMemoryFromAgentResult: draft gate requires verified provider_provenance (level=person)", async () => {
  const { tables, admin } = makeFake();
  // Contact-ready in every way EXCEPT provenance is not verified → blocked.
  tables.lead_candidates.push(
    { id: "lead-1", workspace_id: "ws-1", account_id: "acc-1", contact_id: "con-1", plan_id: "p", raw: { canonical_final_decision: "contact", contact_ready: true, company: "acme", source_url: "https://acme.example.com", evidence_url: "https://acme.example.com/1", decision_maker_profile_url: "https://linkedin.com/in/x", provider_provenance: { verified: false, level: "person" } } },
  );
  await writeMemoryFromAgentResult({
    admin, workspace_id: "ws-1", plan_id: "p", task_id: "task-1", agent_slug: "penn",
    output_text: JSON.stringify([{ subject: "Hi", body: "Body." }]),
    lead_candidate_ids: ["lead-1"],
  });
  assertEquals(tables.outreach_drafts.length, 0, "unverified provenance → no draft, even when otherwise contact-ready");
});
