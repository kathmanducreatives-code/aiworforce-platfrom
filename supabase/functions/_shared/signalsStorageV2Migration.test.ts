// STATIC, provider-free validation of the Signals Storage v2 Phase-1 migration.
//
// These tests read the migration SQL as TEXT and assert its shape. They NEVER apply it,
// never connect to a database, and make no network calls. Their purpose is to prove the
// migration is ADDITIVE and NON-DESTRUCTIVE before anyone runs it against TEST.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH = new URL(
  "../../migrations/20260717170000_signals_storage_v2_hybrid.sql",
  import.meta.url,
);
const LEGACY_SIGNALS_MIGRATION = new URL(
  "../../migrations/20260611080445_c6dc2c5b-bff7-45a2-9445-d56a4d3d0ca2.sql",
  import.meta.url,
);
const SIGNAL_REVIEWS_MIGRATION = new URL(
  "../../migrations/20260613130000_phase6_signal_reviews.sql",
  import.meta.url,
);

const sql = await Deno.readTextFile(MIGRATION_PATH);
/** SQL with `--` comments stripped, so prose never satisfies a structural assertion. */
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
/** `code` with COMMENT ON … IS '…'; statements removed too, so documentation prose
 * inside string literals cannot be mistaken for a structural reference. */
const structural = code.replace(/COMMENT ON[\s\S]*?';/g, "");

const NEW_TABLES = ["lead_evidence", "signal_events", "signal_event_evidence", "engagement_events"];

// ---- (1) all expected tables created ----
Deno.test("1: creates exactly the four new hybrid tables", () => {
  for (const t of NEW_TABLES) {
    assert(code.includes(`CREATE TABLE public.${t} (`), `missing CREATE TABLE public.${t}`);
  }
  const creates = [...code.matchAll(/CREATE TABLE public\.(\w+)/g)].map((m) => m[1]).sort();
  assertEquals(creates, [...NEW_TABLES].sort(), "no unexpected table is created");
});

// ---- (2) lead_candidates.evidence_id additive + nullable ----
Deno.test("2: adds lead_candidates.evidence_id as a nullable additive column", () => {
  assert(/ALTER TABLE public\.lead_candidates\s+ADD COLUMN evidence_id uuid REFERENCES public\.lead_evidence\(id\) ON DELETE SET NULL/.test(code));
  // Nullable: no NOT NULL and no DEFAULT on the added column.
  const stmt = code.match(/ALTER TABLE public\.lead_candidates[\s\S]*?;/)![0];
  assert(!/NOT NULL/i.test(stmt), "evidence_id must be nullable");
  assert(!/DEFAULT/i.test(stmt), "evidence_id must not be defaulted/populated");
  assert(code.includes("lead_candidates_evidence_idx"), "evidence_id must be indexed");
});

// ---- (3) signals.signal_id untouched ----
Deno.test("3: does not remove or alter lead_candidates.signal_id or the legacy dedupe index", () => {
  assert(!/DROP\s+COLUMN\s+signal_id/i.test(code));
  assert(!/ALTER\s+COLUMN\s+signal_id/i.test(code));
  assert(!/DROP\s+INDEX[\s\S]*lc_dedupe_uniq/i.test(code));
  assert(!code.includes("lc_dedupe_uniq"), "the existing lead dedupe index is not modified in this phase");
});

// ---- (4) no destructive statements anywhere ----
Deno.test("4: contains no DROP TABLE / DROP COLUMN / destructive rename", () => {
  assert(!/DROP\s+TABLE/i.test(code));
  assert(!/DROP\s+COLUMN/i.test(code));
  assert(!/RENAME\s+TO/i.test(code));
  assert(!/RENAME\s+COLUMN/i.test(code));
  assert(!/TRUNCATE/i.test(code));
  assert(!/DROP\s+POLICY/i.test(code));
});

// ---- (5) no backfill / data mutation ----
Deno.test("5: performs no backfill — no INSERT/UPDATE/DELETE against data", () => {
  assert(!/\bINSERT\s+INTO\b/i.test(code));
  assert(!/\bUPDATE\s+public\./i.test(code));
  assert(!/\bDELETE\s+FROM\b/i.test(code));
});

// ---- (6) legacy schemas untouched by this migration ----
Deno.test("6/26: does not alter public.signals or public.signal_reviews", () => {
  assert(!/ALTER TABLE public\.signals\b/i.test(code));
  assert(!/ALTER TABLE public\.signal_reviews\b/i.test(code));
  // signals is referenced ONLY as a legacy FK target (COMMENT prose excluded).
  const signalRefs = [...structural.matchAll(/public\.signals\b/g)].length;
  const legacyFkRefs = [...structural.matchAll(/REFERENCES public\.signals\(id\) ON DELETE SET NULL/g)].length;
  assertEquals(signalRefs, legacyFkRefs, "public.signals appears only as a legacy FK target");
  assertEquals(legacyFkRefs, 4, "lead_evidence, signal_events, signal_event_evidence, engagement_events each map legacy rows");
});

Deno.test("26: the legacy signals + signal_reviews migrations are themselves unchanged", async () => {
  // Guards against someone "fixing" history instead of adding a new migration.
  const legacy = await Deno.readTextFile(LEGACY_SIGNALS_MIGRATION);
  assert(legacy.includes("CREATE TABLE public.signals ("));
  assert(legacy.includes("signal_id  uuid REFERENCES public.signals(id)  ON DELETE SET NULL"));
  assert(legacy.includes("lc_dedupe_uniq"));
  const reviews = await Deno.readTextFile(SIGNAL_REVIEWS_MIGRATION);
  assert(reviews.includes("CREATE TABLE public.signal_reviews ("));
  assert(reviews.includes("signal_id uuid REFERENCES public.signals(id) ON DELETE CASCADE"));
});

// ---- (7)(8) RLS + policies on every new table ----
Deno.test("7/8: RLS enabled with workspace-member policies on all four tables", () => {
  for (const t of NEW_TABLES) {
    assert(code.includes(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`), `${t} RLS not enabled`);
    for (const op of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      assert(new RegExp(`CREATE POLICY "${t} members \\w+"\\s+ON public\\.${t} FOR ${op}`).test(code),
        `${t} missing ${op} policy`);
    }
    // Every policy is gated on the existing workspace-access helper.
    assert(code.includes(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.${t} TO authenticated;`));
    assert(code.includes(`GRANT ALL ON public.${t} TO service_role;`));
  }
  const policies = [...code.matchAll(/CREATE POLICY/g)].length;
  assertEquals(policies, 16, "4 tables x 4 operations");
  const helper = [...code.matchAll(/public\.has_workspace_access\(auth\.uid\(\), workspace_id\)/g)].length;
  assert(helper >= 16, "every policy uses the existing has_workspace_access helper");
  // No public/anon access.
  assert(!/TO\s+anon\b/i.test(code) && !/TO\s+public\b/i.test(code));
});

// ---- (9)(21)(22) workspace-scoped dedupe constraints ----
Deno.test("9/21/22: workspace-scoped unique dedupe constraints exist", () => {
  assert(code.includes("CREATE UNIQUE INDEX lead_evidence_workspace_dedupe_uniq ON public.lead_evidence (workspace_id, dedupe_key)"));
  assert(code.includes("CREATE UNIQUE INDEX signal_events_workspace_dedupe_uniq ON public.signal_events (workspace_id, dedupe_key)"));
  assert(code.includes("CREATE UNIQUE INDEX engagement_events_workspace_dedupe_uniq ON public.engagement_events (workspace_id, dedupe_key)"));
  // Per-event evidence fingerprint uniqueness.
  assert(code.includes("CREATE UNIQUE INDEX signal_event_evidence_fingerprint_uniq ON public.signal_event_evidence (workspace_id, signal_event_id, evidence_fingerprint)"));
});

// ---- (10)(11)(12) event-time columns ----
Deno.test("10/11/12: signal_events requires occurred_at and observed_at, and has expires_at", () => {
  const t = code.match(/CREATE TABLE public\.signal_events \([\s\S]*?\n\);/)![0];
  assert(/occurred_at timestamptz NOT NULL/.test(t), "occurred_at must be NOT NULL");
  assert(/observed_at timestamptz NOT NULL/.test(t), "observed_at must be NOT NULL");
  assert(/expires_at timestamptz/.test(t), "expires_at must exist");
  // occurred_at has no default: it must be supplied from the source event time.
  assert(!/occurred_at timestamptz NOT NULL DEFAULT/.test(t), "occurred_at must not be defaulted to insert time");
});

// ---- (13) canonical taxonomy constraints ----
Deno.test("13: canonical signal_type / category / evidence_category constraints exist", () => {
  assert(code.includes("CONSTRAINT signal_events_type_valid CHECK (signal_type IN ("));
  // Canonical members present; engagement members excluded from signal_events.
  for (const ty of ["recent_funding", "sales_hiring", "revops_hiring", "product_launch",
    "founder_pipeline_post", "person_left_company"]) {
    assert(code.includes(`'${ty}'`), `missing canonical signal_type ${ty}`);
  }
  const typeBlock = code.match(/signal_events_type_valid CHECK \(signal_type IN \([\s\S]*?\)\)/)![0];
  for (const eng of ["linkedin_post_like", "direct_reply", "content_engagement"]) {
    assert(!typeBlock.includes(`'${eng}'`), `engagement type ${eng} must NOT be a signal_event type`);
  }
  assert(code.includes("CONSTRAINT signal_events_category_valid CHECK (signal_category IN ("));
  const catBlock = code.match(/signal_events_category_valid CHECK \(signal_category IN \([\s\S]*?\)\)/)![0];
  assert(!catBlock.includes("'engagement'"), "engagement is not a signal_events category");
  // The six canonical timing evidence categories.
  for (const c of ["job_signal", "funding_signal", "launch_signal", "expansion_signal",
    "founder_activity_signal", "gtm_signal"]) {
    assert(code.includes(`'${c}'`), `missing canonical evidence_category ${c}`);
  }
});

// ---- (14) lifecycle constraints ----
Deno.test("14: lifecycle constraints cover the full documented vocabulary", () => {
  for (const t of ["lead_evidence", "signal_events", "engagement_events"]) {
    const m = code.match(new RegExp(`${t}_lifecycle_valid CHECK \\(lifecycle_status IN \\([\\s\\S]*?\\)\\)`));
    assert(m, `${t} missing lifecycle constraint`);
    for (const s of ["active", "stale", "expired", "contradicted", "superseded", "dismissed", "archived"]) {
      assert(m![0].includes(`'${s}'`), `${t} lifecycle missing ${s}`);
    }
    // Canonical in-memory SignalStatus is a strict subset (no canonical value dropped).
    assert(m![0].includes("'retracted'"), `${t} must still accept the canonical 'retracted'`);
  }
});

// ---- (15) listing status ----
Deno.test("15: listing_status uses the canonical ListingStatus union", () => {
  const m = code.match(/signal_events_listing_status_valid CHECK \(listing_status IS NULL OR listing_status IN \([\s\S]*?\)\)/)![0];
  for (const s of ["active", "closed", "expired", "unknown"]) assert(m.includes(`'${s}'`));
});

// ---- (16) verification ----
Deno.test("16: verification_status uses the canonical SignalVerification union everywhere", () => {
  for (const t of NEW_TABLES) {
    const m = code.match(new RegExp(`${t}_verification_valid CHECK \\(verification_status IN \\([\\s\\S]*?\\)\\)`));
    assert(m, `${t} missing verification constraint`);
    for (const v of ["provider_verified", "self_reported", "unverified"]) {
      assert(m![0].includes(`'${v}'`), `${t} verification missing ${v}`);
    }
  }
});

// ---- (17)(18) raw payload + PII columns forbidden ----
Deno.test("17/18: no raw provider payload, email or phone columns exist", () => {
  // Column definitions only (avoid matching prose/identifiers like normalized_value).
  assert(!/^\s+raw\s+jsonb/m.test(code), "no bare `raw jsonb` payload column");
  assert(!/^\s+raw_payload\b/m.test(code));
  assert(!/^\s+provider_payload\b/m.test(code));
  assert(!/^\s+email\s+text/m.test(code), "no email column");
  assert(!/^\s+phone\s+text/m.test(code), "no phone column");
  // Sanitization flag present on every new table.
  for (const t of NEW_TABLES) {
    const block = code.match(new RegExp(`CREATE TABLE public\\.${t} \\([\\s\\S]*?\\n\\);`))![0];
    assert(/sanitized boolean NOT NULL DEFAULT true/.test(block), `${t} missing sanitized flag`);
    assert(/normalized_value jsonb NOT NULL DEFAULT '\{\}'::jsonb/.test(block), `${t} missing normalized_value`);
  }
});

// ---- (19) legacy mapping never cascade-deletes signals ----
Deno.test("19: legacy_signal_id never cascade-deletes legacy signals", () => {
  const refs = [...code.matchAll(/legacy_signal_id uuid REFERENCES public\.signals\(id\) ON DELETE (\w+ ?\w*)/g)];
  assertEquals(refs.length, 4, "all four tables carry a legacy mapping");
  for (const r of refs) assertEquals(r[1].trim(), "SET NULL", "legacy mapping must be ON DELETE SET NULL");
  assert(!/REFERENCES public\.signals\(id\) ON DELETE CASCADE/i.test(code));
});

// ---- (20) evidence cascades only with its parent event ----
Deno.test("20: signal_event_evidence cascades only with its parent, workspace-pinned", () => {
  assert(code.includes("FOREIGN KEY (signal_event_id, workspace_id)"));
  assert(code.includes("REFERENCES public.signal_events (id, workspace_id) ON DELETE CASCADE"));
  // The composite FK requires this parent-side unique.
  assert(code.includes("CONSTRAINT signal_events_id_workspace_uniq UNIQUE (id, workspace_id)"));
  assert(code.includes("signal_event_id uuid NOT NULL"));
});

// ---- (23)(24) indexes ----
Deno.test("23/24: entity-reference and workspace/time indexes exist", () => {
  for (const ix of [
    "signal_events_workspace_occurred_idx",
    "signal_events_workspace_type_occurred_idx",
    "signal_events_workspace_lifecycle_occurred_idx",
    "signal_events_account_occurred_idx",
    "signal_events_contact_occurred_idx",
    "signal_events_lead_candidate_occurred_idx",
    "signal_events_expires_at_idx",
    "lead_evidence_workspace_kind_idx",
    "lead_evidence_workspace_lifecycle_idx",
    "lead_evidence_contact_idx",
    "lead_evidence_account_idx",
    "lead_evidence_lead_candidate_idx",
    "engagement_events_workspace_occurred_idx",
    "engagement_events_contact_occurred_idx",
    "engagement_events_account_occurred_idx",
    "engagement_events_channel_type_idx",
    "signal_event_evidence_event_idx",
  ]) {
    assert(code.includes(ix), `missing index ${ix}`);
  }
  assert(code.includes("signal_events_expires_at_idx ON public.signal_events (expires_at) WHERE expires_at IS NOT NULL"));
});

// ---- (25) comments explain the semantics ----
Deno.test("25: comments explain occurred_at vs observed_at and the payload policy", () => {
  assert(/COMMENT ON COLUMN public\.signal_events\.occurred_at/.test(sql));
  assert(/COMMENT ON COLUMN public\.signal_events\.observed_at/.test(sql));
  assert(/controls freshness/i.test(sql), "occurred_at comment must state it controls freshness");
  assert(/never refresh an old event/i.test(sql), "observed_at comment must state it never refreshes");
  assert(/COMMENT ON COLUMN public\.lead_candidates\.evidence_id/.test(sql));
  assert(/COMMENT ON TABLE public\.engagement_events/.test(sql));
  assert(/does NOT automatically satisfy an individual candidate timing requirement/i.test(sql));
  assert(/Raw provider payloads are forbidden/i.test(sql));
});

// ---- entity grounding ----
Deno.test("every new entity-bearing table requires a grounded entity reference", () => {
  for (const t of ["lead_evidence", "signal_events", "engagement_events"]) {
    assert(code.includes(`CONSTRAINT ${t}_entity_present CHECK (`), `${t} missing entity-grounding constraint`);
  }
  assert(code.includes("CONSTRAINT signal_event_evidence_source_present CHECK ("));
});

// ---- (27) runtime behaviour unchanged: migration touches no function code ----
Deno.test("27: the migration references no Edge Function or frontend source path", () => {
  assert(!/supabase\/functions\//.test(code));
  assert(!/\bsrc\//.test(code));
});
