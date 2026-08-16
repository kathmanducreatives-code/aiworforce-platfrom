// THE COMPANY-SCOPED CANDIDATE IDENTITY.
//
// A workspace holds at most ONE account-type lead candidate per account, when
// that candidate anchors no contact and no signal. That is the identity the
// partial index `lead_candidates_company_scope_uniq` enforces and the one
// `persistPlan` now resolves against.
//
// The narrowness is the point. `account_id` is NOT unique across
// `lead_candidates` and must not become so: the model supports many candidates
// per account across the person, contact and signal dimensions, and the Lead
// Library renders them as a list. These tests pin BOTH halves — the collapse
// that must happen, and the four that must not.
//
// The persistence implementation is REAL: `createPersistPlan` runs unchanged
// against an in-memory table store whose filter chain behaves like Postgres
// (an absent column IS null). Only the SQL engine is a double.
//
// Pure. No network, no provider, no real database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createPersistPlan } from "../../../supabase/functions/_shared/qualifiedLeadPersistence.ts";
import type { CompoundPersistencePlan } from "../../../supabase/functions/_shared/runAgentCompoundPersistenceAdapter.ts";

/** Postgres-shaped store: absent column === null, and `update` mutates. */
function memoryDb() {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    accounts: [], lead_candidates: [], contacts: [],
  };
  let n = 0;
  return {
    rows: (t: string) => tables[t] ?? [],
    /** The invariant the partial index enforces, checked against the store. */
    companyScopeGroups() {
      const groups = new Map<string, number>();
      for (const r of tables.lead_candidates) {
        if (r.lead_type !== "account") continue;
        if ((r.contact_id ?? null) !== null) continue;
        if ((r.signal_id ?? null) !== null) continue;
        const k = `${r.workspace_id}|${r.account_id}`;
        groups.set(k, (groups.get(k) ?? 0) + 1);
      }
      return groups;
    },
    client: {
      from(table: string) {
        tables[table] ??= [];
        return {
          select(_c: string) {
            const f: Record<string, unknown> = {};
            const chain = {
              eq(c: string, v: unknown) { f[c] = v; return chain; },
              is(c: string, v: null) { f[c] = v; return chain; },
              maybeSingle() {
                const hit = tables[table].find((r) =>
                  Object.entries(f).every(([k, v]) =>
                    v === null ? (r[k] ?? null) === null : r[k] === v));
                return Promise.resolve({ data: hit ?? null });
              },
            };
            return chain;
          },
          insert(row: Record<string, unknown>) {
            const stored = { id: `${table}_${++n}`, ...row };
            tables[table].push(stored);
            return {
              select: (_c: string) => ({
                maybeSingle: () => Promise.resolve({ data: { id: stored.id } }),
              }),
            };
          },
          update(patch: Record<string, unknown>) {
            return {
              eq: (c: string, v: unknown) => {
                for (const r of tables[table]) if (r[c] === v) Object.assign(r, patch);
                return Promise.resolve({ data: null });
              },
            };
          },
        };
      },
    },
  };
}

/** The account-type company row the Mission hiring path produces. */
function companyPlan(over: Partial<CompoundPersistencePlan> = {}): CompoundPersistencePlan {
  return {
    workspaceId: "ws-1",
    account: {
      name: "Sortly", domain: "sortly.com",
      linkedinUrl: "linkedin.com/company/sortly", description: "B2B SaaS.",
    },
    contact: null,
    leadCandidate: {
      lead_type: "account", reason: "Hiring signal: Revenue Operations Manager",
      next_action: "find_decision_maker",
      raw: { row_kind: "company", company_domain: "sortly.com" },
    },
    verdict: "NEEDS_REVIEW",
    persistable: true,
    persistenceReason: "disposition_persistable:NEEDS_REVIEW",
    contactBlocked: true,
    blockReasons: [],
    ...over,
  } as CompoundPersistencePlan;
}

const writer = (db: ReturnType<typeof memoryDb>, planId: string | null = "plan-1",
                workspaceId = "ws-1") =>
  createPersistPlan({
    db: db.client as never, workspaceId, planId,
    writeContact: (() => Promise.resolve({ ok: true })) as never,
  });

// ═════════════════ A–D. the collapse that MUST happen ══════════════════════

Deno.test("A. the first write creates exactly one company candidate", async () => {
  const db = memoryDb();
  const r = await writer(db)(companyPlan());
  assert(r.ok);
  assertEquals(db.rows("accounts").length, 1);
  assertEquals(db.rows("lead_candidates").length, 1);
  assertEquals(r.reusedExisting, undefined, "the first write is an insert");
});

Deno.test("B. writing the same company again reuses the candidate", async () => {
  const db = memoryDb();
  const first = await writer(db)(companyPlan());
  const second = await writer(db)(companyPlan());

  assertEquals(db.rows("lead_candidates").length, 1);
  assertEquals(second.leadCandidateId, first.leadCandidateId, "the same row");
  assertEquals(second.reusedExisting, true, "and the writer says it reused it");
});

Deno.test("C. a different plan_id does not create a second company candidate", async () => {
  const db = memoryDb();
  await writer(db, "plan-1")(companyPlan());
  await writer(db, "plan-2")(companyPlan());
  assertEquals(db.rows("lead_candidates").length, 1);
  assertEquals(db.rows("lead_candidates")[0].plan_id, "plan-2", "refreshed to the latest run");
});

Deno.test("D. the reused row is refreshed, not left stale", async () => {
  const db = memoryDb();
  await writer(db)(companyPlan());
  await writer(db)(companyPlan({
    leadCandidate: {
      lead_type: "account", reason: "Hiring signal: Head of Revenue Operations",
      next_action: "find_decision_maker", raw: { row_kind: "company", refreshed: true },
    },
  }));
  const row = db.rows("lead_candidates")[0];
  assertEquals(db.rows("lead_candidates").length, 1);
  assertEquals(row.reason, "Hiring signal: Head of Revenue Operations");
  assertEquals((row.raw as Record<string, unknown>).refreshed, true);
});

// ═════════════════ E–H. what must NOT be collapsed ═════════════════════════

Deno.test("E. two different companies remain two candidates", async () => {
  const db = memoryDb();
  await writer(db)(companyPlan());
  await writer(db)(companyPlan({
    account: { name: "Clay", domain: "clay.com", linkedinUrl: null, description: null },
  }));
  assertEquals(db.rows("accounts").length, 2);
  assertEquals(db.rows("lead_candidates").length, 2);
});

Deno.test("F. the same company in two workspaces remains two candidates", async () => {
  const db = memoryDb();
  await writer(db, "plan-1", "ws-1")(companyPlan());
  await writer(db, "plan-1", "ws-2")(companyPlan({ workspaceId: "ws-2" }));
  assertEquals(db.rows("lead_candidates").length, 2);
  assertEquals(new Set(db.rows("lead_candidates").map((r) => r.workspace_id)).size, 2);
});

Deno.test("G. a PERSON candidate is never collapsed into the company candidate", async () => {
  const db = memoryDb();
  await writer(db)(companyPlan());
  // A person lead for the SAME account — a different candidate by definition.
  await writer(db)(companyPlan({
    contact: { name: "Ada Founder", title: "CEO", linkedinUrl: "linkedin.com/in/ada" },
    leadCandidate: {
      lead_type: "person", reason: "Founder at Sortly",
      next_action: "draft_outreach", raw: { row_kind: "person" },
    },
    verdict: "CONTACT",
  }));

  assertEquals(db.rows("lead_candidates").length, 2, "person and company are separate rows");
  assertEquals(db.rows("accounts").length, 1, "against ONE deduplicated account");
  const types = db.rows("lead_candidates").map((r) => r.lead_type).sort();
  assertEquals(types, ["account", "person"]);
});

Deno.test("G2. several person candidates for one account all persist", async () => {
  const db = memoryDb();
  for (const who of ["ada", "grace", "alan"]) {
    await writer(db)(companyPlan({
      contact: { name: who, title: "Founder", linkedinUrl: `linkedin.com/in/${who}` },
      leadCandidate: {
        lead_type: "person", reason: null, next_action: "draft_outreach", raw: {},
      },
      verdict: "CONTACT",
    }));
  }
  assertEquals(
    db.rows("lead_candidates").length, 3,
    "the model supports many candidates per account — that must not regress",
  );
});

Deno.test("H. a SIGNAL-anchored candidate is outside the company-scope identity", async () => {
  // The legacy tool path writes signal-anchored rows. They carry a signal_id,
  // so they fall outside the partial index and outside the reuse lookup — many
  // signals for one company are many candidates.
  const db = memoryDb();
  await writer(db)(companyPlan());
  db.rows("lead_candidates").push(
    { id: "sig_1", workspace_id: "ws-1", account_id: db.rows("accounts")[0].id,
      lead_type: "company", signal_id: "signal-1", contact_id: null },
    { id: "sig_2", workspace_id: "ws-1", account_id: db.rows("accounts")[0].id,
      lead_type: "company", signal_id: "signal-2", contact_id: null },
  );

  // Writing the company row again still reuses only ITS row.
  await writer(db)(companyPlan());
  assertEquals(db.rows("lead_candidates").length, 3, "the signal rows are untouched");
  for (const [, n] of db.companyScopeGroups()) {
    assertEquals(n, 1, "and the company-scope invariant still holds");
  }
});

// ═════════════════ I. account dedup preserved ══════════════════════════════

Deno.test("I. account deduplication still works and is unchanged", async () => {
  const db = memoryDb();
  await writer(db)(companyPlan());
  await writer(db)(companyPlan({
    // Same domain, different display name — the account resolves by domain.
    account: {
      name: "Sortly Inc.", domain: "sortly.com",
      linkedinUrl: "linkedin.com/company/sortly", description: null,
    },
  }));
  assertEquals(db.rows("accounts").length, 1, "one account for one domain");
  assertEquals(db.rows("lead_candidates").length, 1);
});

Deno.test("I2. an unverifiable company binds no account and stays non-contactable", async () => {
  const db = memoryDb();
  const r = await writer(db)(companyPlan({ account: null }));
  assertEquals(db.rows("accounts").length, 0);
  assertEquals(r.accountId, null);
  // With no account there is no company identity to reuse, so the row inserts.
  assertEquals(db.rows("lead_candidates").length, 1);
  assertEquals(
    (db.rows("lead_candidates")[0].raw as Record<string, unknown>).contact_eligible, false,
  );
});

// ═════════════════ J. the database-level contract ══════════════════════════

const MIGRATION = Deno.readTextFileSync(
  new URL("../../../supabase/migrations/20260812090000_lead_candidate_company_scope_uniq.sql",
    import.meta.url),
);

Deno.test("J. the migration declares the identity as a PARTIAL unique index", () => {
  assert(
    /CREATE UNIQUE INDEX IF NOT EXISTS lead_candidates_company_scope_uniq/i.test(MIGRATION),
    "the invariant must be enforced by the database, not only by the writer",
  );
  assert(
    /ON public\.lead_candidates \(workspace_id, account_id\)/i.test(MIGRATION),
    "scoped per workspace and account",
  );
  // The three predicates are what keep it from collapsing the other dimensions.
  for (const pred of [
    /WHERE lead_type = 'account'/i,
    /AND contact_id IS NULL/i,
    /AND signal_id IS NULL/i,
  ]) {
    assert(pred.test(MIGRATION), `the index must be partial on ${pred}`);
  }
});

Deno.test("J2. the migration neither restores lc_dedupe_uniq nor drops anything", () => {
  assert(
    !/CREATE\s+(UNIQUE\s+)?INDEX[\s\S]{0,80}lc_dedupe_uniq/i.test(MIGRATION),
    "the old plan-scoped key is deliberately NOT restored — plan_id defeats cross-run reuse",
  );
  assert(!/\bDROP\b/i.test(MIGRATION), "it drops nothing");
  assert(!/\bDELETE\b|\bUPDATE\s+public\./i.test(MIGRATION), "and mutates no existing data");
});

Deno.test("J3. the migration records which environment was audited, and how", () => {
  // WAS also asserting a warning that production had not been audited. That
  // caveat existed because two environments held different data; after the
  // consolidation onto one project — which starts empty — there is no second
  // environment to audit, and asserting the warning would pin a statement that
  // is no longer true.
  //
  // What still matters is that the migration says which database the numbers
  // came from and leaves the query behind, so a future environment with real
  // data can be checked the same way.
  assert(/zbwsbnqqpkvdhqwavjke/.test(MIGRATION), "the audited database is named");
  assert(/2026-08-12/.test(MIGRATION), "and when it was audited");
  assert(/select workspace_id, account_id, count\(\*\)/.test(MIGRATION),
    "the reproducing query survives for any future environment");
});

Deno.test("J4. the writer resolves the same identity the index enforces", () => {
  const SRC = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/qualifiedLeadPersistence.ts", import.meta.url),
  );
  const i = SRC.indexOf("const isCompanyRow");
  assert(i > 0, "the company-row branch must exist");
  const block = SRC.slice(i, i + 1400);
  for (const clause of [
    '.eq("workspace_id", workspace_id)', '.eq("account_id", accountId)',
    '.eq("lead_type", "account")', '.is("contact_id", null)', '.is("signal_id", null)',
  ]) {
    assert(block.includes(clause), `the lookup must filter on ${clause}`);
  }
});
