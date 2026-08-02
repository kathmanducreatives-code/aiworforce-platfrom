// Signals V2 — INTEGRATION test through the real writeMemoryFromToolCall path.
//
// Proves the flag-gated wiring in memoryWriter.ts is reachable and correct:
//   * flag OFF  → ONLY legacy rows are written; the V2 tables are never touched
//                 (legacy behaviour byte-for-byte identical).
//   * flag ON   → legacy rows AND the V2 mirror (lead_evidence / signal_events /
//                 signal_event_evidence) are written, with the legacy signals.id
//                 preserved as legacy_signal_id and occurred_at from the posting.
//   * V2 failure→ legacy persistence is untouched (best-effort isolation).
//
// Provider-free: no network, no real database. The flag is injected via the env
// and always restored.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { writeMemoryFromToolCall } from "../../supabase/functions/_shared/memoryWriter.ts";
import { SIGNALS_V2_FLAG } from "../../supabase/functions/_shared/signalsV2Flag.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const RUN = "run-int-1";

/** Fake admin supporting BOTH legacy chains (insert/upsert → select → maybeSingle,
 * and awaited insert) and the V2 chain (upsert(row,opts) → select("id") awaited),
 * plus the V2 dedup lookup (select → eq* → maybeSingle). `failTables` injects a DB
 * rejection on the V2 upsert of a given table. */
function fakeAdmin(o?: { failTables?: string[] }) {
  const store: Record<string, any[]> = {};
  const fail = new Set(o?.failTables ?? []);

  function builder(table: string) {
    store[table] ??= [];
    const b: any = {
      _op: null as null | "insert" | "upsert",
      _row: null as any,
      _opts: null as any,
      _filters: [] as [string, any][],
      insert(row: any) { b._op = "insert"; b._row = row; return b; },
      upsert(row: any, opts?: any) { b._op = "upsert"; b._row = row; b._opts = opts ?? {}; return b; },
      update() { return b; },
      select(_cols?: string) { return b; },
      eq(k: string, v: any) { b._filters.push([k, v]); return b; },
      gte() { return b; },
      order() { return b; },
      limit() { return b; },
      maybeSingle() {
        // A pure select lookup (V2 dedup) — find the matching stored row.
        if (b._op === null && b._filters.length) {
          const row = store[table].find((r) => b._filters.every(([k, v]: [string, any]) => String(r[k]) === String(v)));
          return Promise.resolve({ data: row ? { id: row.id } : null, error: null });
        }
        // insert/upsert legacy single-row result — assign + record an id.
        const id = crypto.randomUUID();
        store[table].push({ ...(b._row ?? {}), id });
        return Promise.resolve({ data: { id }, error: null });
      },
      // Awaited chains: legacy `await insert(...)` and V2 `await upsert(...).select("id")`.
      then(resolve: (v: any) => void) {
        if (b._op === "upsert" && b._opts?.onConflict) {
          if (fail.has(table)) return resolve({ data: null, error: { message: "boom db 42P01" } });
          const cols = String(b._opts.onConflict).split(",").map((s) => s.trim());
          const keyOf = (r: any) => cols.map((c) => String(r[c])).join("|");
          const existing = store[table].find((r) => keyOf(r) === keyOf(b._row));
          if (existing && b._opts.ignoreDuplicates) return resolve({ data: [], error: null });
          const id = crypto.randomUUID();
          store[table].push({ ...b._row, id });
          return resolve({ data: [{ id }], error: null });
        }
        // Legacy directly-awaited insert (e.g. lead_candidates) — record the row.
        if (b._op === "insert") {
          store[table].push({ ...(b._row ?? {}), id: crypto.randomUUID() });
        }
        return resolve({ data: null, error: null });
      },
    };
    return b;
  }

  return { admin: { from: (t: string) => builder(t) }, store };
}

async function withFlag<T>(value: string | null, fn: () => Promise<T>): Promise<T> {
  const prev = Deno.env.get(SIGNALS_V2_FLAG);
  if (value === null) Deno.env.delete(SIGNALS_V2_FLAG);
  else Deno.env.set(SIGNALS_V2_FLAG, value);
  try {
    return await fn();
  } finally {
    if (prev === undefined) Deno.env.delete(SIGNALS_V2_FLAG);
    else Deno.env.set(SIGNALS_V2_FLAG, prev);
  }
}

const peopleCtx = (admin: any) => ({
  admin, workspace_id: WS, plan_id: "plan-1", tool_name: "source_with_apify",
  selected_actor_key: "apify_people", provider: "apify", actor_id: "harvestapi/people",
  actor_key: "apify_people", provider_run_id: RUN, workflow_run_id: RUN, trace_id: RUN,
  artifact_type: "person_candidate", enforce_provenance: true, lead_origin: "provider_sourced" as const,
});

const peopleOutput = {
  normalized_source_type: "people_profiles",
  items: [{ type: "people_profile", full_name: "Jane Doe", title: "VP Sales", company: "Acme",
    profile_url: "https://www.linkedin.com/in/jane-doe", location: "SF", headline: "Scaling GTM", id: "prof-1" }],
};

// ---- people: flag OFF ⇒ legacy only ---------------------------------------
Deno.test("people flag OFF: legacy rows only, lead_evidence untouched", async () => {
  await withFlag(null, async () => {
    const { admin, store } = fakeAdmin();
    await writeMemoryFromToolCall({ ...peopleCtx(admin), output: peopleOutput } as any);
    assertEquals((store.lead_candidates ?? []).length, 1, "legacy lead persists");
    assertEquals((store.contacts ?? []).length, 1);
    assertEquals((store.lead_evidence ?? []).length, 0, "flag OFF ⇒ no V2 write");
  });
});

// ---- people: flag ON ⇒ legacy + lead_evidence mirror -----------------------
Deno.test("people flag ON: legacy rows AND lead_evidence, legacy_signal_id preserved", async () => {
  await withFlag("enabled", async () => {
    const { admin, store } = fakeAdmin();
    await writeMemoryFromToolCall({ ...peopleCtx(admin), output: peopleOutput } as any);
    assertEquals((store.lead_candidates ?? []).length, 1, "legacy lead still persists");
    assertEquals((store.lead_evidence ?? []).length, 1, "V2 identity evidence mirrored");
    const ev = store.lead_evidence[0];
    assertEquals(ev.evidence_kind, "person_identity");
    assertEquals(ev.workspace_id, WS);
    const legacySignalId = store.signals[0].id;
    assertEquals(ev.legacy_signal_id, legacySignalId, "legacy signals.id preserved on evidence");
    assert(typeof ev.contact_id === "string" && ev.contact_id.length > 0, "evidence grounded on the contact");
    // No email/phone/raw ever reaches normalized_value.
    const flat = JSON.stringify(ev.normalized_value ?? {});
    assert(!/@|phone|email|"raw"/.test(flat), "normalized_value carries no PII/raw payload");
  });
});

// ---- people: V2 failure does not fail legacy persistence -------------------
Deno.test("people flag ON: lead_evidence DB failure leaves legacy persistence intact", async () => {
  await withFlag("1", async () => {
    const { admin, store } = fakeAdmin({ failTables: ["lead_evidence"] });
    await writeMemoryFromToolCall({ ...peopleCtx(admin), output: peopleOutput } as any);
    assertEquals((store.lead_candidates ?? []).length, 1, "legacy lead persists despite V2 failure");
    assertEquals((store.lead_evidence ?? []).length, 0, "failed V2 write inserted nothing");
  });
});

// ---- jobs: flag ON ⇒ canonical hiring event + evidence ---------------------
const jobsCtx = (admin: any) => ({
  admin, workspace_id: WS, plan_id: "plan-1", tool_name: "source_with_apify",
  selected_actor_key: "apify_jobs", provider: "apify", actor_id: "curious_coder/linkedin-jobs-scraper",
  actor_key: "apify_jobs", provider_run_id: RUN, workflow_run_id: RUN, trace_id: RUN,
  artifact_type: "job_signal", enforce_provenance: true, lead_origin: "provider_sourced" as const,
});

const jobsOutput = {
  items: [{
    type: "job", company: "Acme", company_name: "Acme", title: "Account Executive",
    job_url: "https://www.linkedin.com/jobs/view/1", url: "https://www.linkedin.com/jobs/view/1",
    website: "https://acme.com", company_website: "https://acme.com", domain: "acme.com",
    company_linkedin_url: "https://www.linkedin.com/company/acme",
    posted_at: "2026-07-05T00:00:00.000Z", provider_job_id: "job-1",
  }],
};

Deno.test("jobs flag ON: canonical GTM hiring event + evidence mirrored, occurred_at from posting", async () => {
  await withFlag("true", async () => {
    const { admin, store } = fakeAdmin();
    await writeMemoryFromToolCall({ ...jobsCtx(admin), output: jobsOutput } as any);
    assertEquals((store.lead_candidates ?? []).length, 1, "legacy company lead persists");
    assertEquals((store.signal_events ?? []).length, 1, "canonical hiring event mirrored");
    const ev = store.signal_events[0];
    assertEquals(ev.signal_type, "sales_hiring");
    assertEquals(ev.signal_category, "gtm");
    assertEquals(ev.evidence_category, "job_signal");
    assertEquals(ev.occurred_at, "2026-07-05T00:00:00.000Z", "occurred_at is the source posting time");
    assertEquals(ev.legacy_signal_id, store.signals[0].id);
    assertEquals((store.signal_event_evidence ?? []).length, 1, "observation attached to the event");
    assertEquals(store.signal_event_evidence[0].signal_event_id, ev.id);
  });
});

Deno.test("jobs flag OFF: legacy only, no signal_events", async () => {
  await withFlag(null, async () => {
    const { admin, store } = fakeAdmin();
    await writeMemoryFromToolCall({ ...jobsCtx(admin), output: jobsOutput } as any);
    assertEquals((store.lead_candidates ?? []).length, 1);
    assertEquals((store.signal_events ?? []).length, 0, "flag OFF ⇒ no V2 write");
  });
});
