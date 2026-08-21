// A CHECKPOINT NOBODY READS IS A RECEIPT, NOT A RESUME.
//
// `leadResumeState`'s own header says exactly that, and it was true of the one
// field that makes the working set durable.
//
// THE RUNS THESE TESTS EXIST TO PREVENT — TEST plans 486928e8, 9105aa67 and
// 9b5ad99b, all on 2026-08-20, on three different builds.
//
// `toResumeRecord` writes a `snapshot` for every company. `readCheckpointCompanies`
// rebuilt each record field by field — identity, enrichment, hiring, brain,
// founder, url, operations, timestamp — and never mentioned `snapshot`. So it
// was written on every checkpoint and read on none.
//
// Measured on 9105aa67's own persisted checkpoint, through the real reader:
//
//     companies in the persisted checkpoint : 100
//     of those carrying a snapshot          : 100
//     records returned by the reader        : 100
//     of those carrying a snapshot          :   0
//
// `restoreWorkingSet` therefore restored nothing on every continuation. Every
// downstream stage iterated an empty array, the frontier read empty, and the
// yield gate answered `frontier_exhausted` — while the run had just told the
// user it was "looking for 8 more across 87 remaining companies" and 88 of 98
// candidates had never been touched. Each continuation burned a slice and a
// cost unit to do nothing.
//
// WHAT MAKES THIS TEST THE RIGHT SHAPE. Both halves already had tests, and both
// passed: the writer was covered, the reader was covered, and 5072 tests said
// the system was fine. Nothing drove a record from the writer THROUGH the
// reader and out the other side, which is the only place the disagreement
// lived. So these tests round-trip.
//
// ZERO network, ZERO providers, ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCheckpoint, readCheckpointCompanies, CHECKPOINT_RESULT_KEY,
  MAX_SNAPSHOT_JOBS, newCompanyRecord,
} from "../../../supabase/functions/_shared/leadResumeState.ts";
import {
  toResumeRecord, restoreWorkingSet,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";

/** One company as the engine holds it mid-run, after a paid identity call. */
function engineCompany(over: Record<string, unknown> = {}) {
  return {
    key: "anara.com",
    company: { company_name: "Anara", domain: "anara.com", website: "https://anara.com" },
    yc_open_jobs: [{ title: "Software Engineer" }, { title: "Founding Engineer" }],
    prequal_key: "anara.com",
    prequalified: { company_key: "anara.com", name: "Anara", eligible: true, score: 40 },
    shortlisted: true,
    triage: { verdict: "relevant", reason: "US AI startup, hiring" },
    investigation_state: "pending_investigation",
    investigation_rank: 7,
    enriched: null,
    enrichment_outcome: null,
    identity: null,
    hiring_assessment: null,
    brain: null,
    fit: null,
    verdict: null,
    founders: [],
    verified_founders: [],
    contact_identities: [],
    completed_operations: ["identity:anara.com"],
    ...over,
  } as never;
}

/** Writer → checkpoint → `tasks.result` → reader. The whole crossing. */
function roundTrip(companies: unknown[]) {
  const records = (companies as never[]).map(toResumeRecord);
  const checkpoint = buildCheckpoint({
    now: 0, deadlineAt: 120_000, remainingMs: 19_137,
    lastCompletedCapability: "startup_company_discovery",
    nextPendingCapability: "company_identity_resolution",
    companies: records,
    reason: "execution_deadline_checkpoint",
  });
  // Through JSON, because that is what a jsonb column does to it.
  const persisted = JSON.parse(JSON.stringify({ [CHECKPOINT_RESULT_KEY]: checkpoint }));
  return readCheckpointCompanies(persisted);
}

// ═══ 1. THE CROSSING ITSELF ════════════════════════════════════════════════

Deno.test("the snapshot survives writer → checkpoint → JSON → reader", () => {
  const read = roundTrip([engineCompany()]);
  assertEquals(read.length, 1);
  assert(read[0].snapshot,
    "written on every checkpoint and read on none is what made every continuation empty");
  assertEquals(read[0].snapshot!.company.company_name, "Anara");
});

Deno.test("and the working set is REBUILT from it", () => {
  const restored = restoreWorkingSet(roundTrip([engineCompany()]));
  assertEquals(restored.length, 1, "this returned [] for every continuation ever run");
  assertEquals(restored[0].key, "anara.com");
});

// ═══ 2. WHAT THE RESTORED COMPANY MUST STILL KNOW ══════════════════════════
//
// Each of these is something the run already PAID for or already decided. A
// restore that loses one makes the continuation buy it again.

Deno.test("the free prequalification verdict is not recomputed", () => {
  const c = restoreWorkingSet(roundTrip([engineCompany()]))[0];
  assert(c.prequalified, "prequalification would have to be re-derived");
  assertEquals((c.prequalified as { eligible?: boolean }).eligible, true);
});

Deno.test("the triage verdict is not re-bought — it cost four GPT batches", () => {
  const c = restoreWorkingSet(roundTrip([engineCompany()]))[0];
  assert(c.triage, "a lost triage verdict is a paid model call spent twice");
  assertEquals((c.triage as { verdict?: string }).verdict, "relevant");
});

Deno.test("enrichment already bought survives, and so does the reason there is none", () => {
  const bought = restoreWorkingSet(roundTrip([engineCompany({
    enriched: { company_name: "Anara", employeeCount: 5 },
    enrichment_outcome: "success",
  })]))[0];
  assert(bought.enriched, "re-enriching a company is a second paid Actor call");
  assertEquals(bought.enrichment_outcome, "success");

  const deferred = restoreWorkingSet(roundTrip([engineCompany({
    enrichment_outcome: "deferred",
  })]))[0];
  assertEquals(deferred.enriched, null);
  assertEquals(deferred.enrichment_outcome, "deferred",
    "a deadline deferral must not come back as `not_attempted` — it is resumable");
});

Deno.test("the ledger of paid operations survives, which is what stops double-buying", () => {
  const c = restoreWorkingSet(roundTrip([engineCompany()]))[0];
  assert(c.completed_operations.includes("identity:anara.com"));
});

// ═══ 3. THE FRONTIER — THE POINT OF THE WHOLE THING ════════════════════════

Deno.test("a pending company comes back on the FRONTIER, not closed", () => {
  const c = restoreWorkingSet(roundTrip([engineCompany()]))[0];
  assertEquals(c.investigation_state, "pending_investigation",
    "this is the state that lets a continuation widen the pool");
  assertEquals(c.investigation_rank, 7, "and its place in the ranking, so nothing re-ranks");
});

Deno.test("an investigated company does NOT re-enter the frontier", () => {
  const c = restoreWorkingSet(roundTrip([engineCompany({
    investigation_state: "investigated",
  })]))[0];
  assertEquals(c.investigation_state, "investigated");
  assertEquals(c.shortlisted, true, "shortlisted is the derived view of having been investigated");
});

Deno.test("an excluded company comes back excluded, with its reason intact", () => {
  const c = restoreWorkingSet(roundTrip([engineCompany({
    investigation_state: "excluded_permanently",
    triage: { verdict: "irrelevant", reason: "consumer app, not B2B" },
  })]))[0];
  assertEquals(c.investigation_state, "excluded_permanently");
  assertEquals((c.triage as { reason?: string }).reason, "consumer app, not B2B",
    "the Workbench must keep the reason a company was never pursued");
});

Deno.test("a hundred companies restore as a hundred — the shape of the real failure", () => {
  const pool = Array.from({ length: 100 }, (_, i) => engineCompany({
    key: `c${i}.com`,
    company: { company_name: `Co${i}`, domain: `c${i}.com`, website: `https://c${i}.com` },
    prequal_key: `c${i}.com`,
    prequalified: { company_key: `c${i}.com`, name: `Co${i}`, eligible: true, score: 40 },
    investigation_rank: i,
    investigation_state: i < 10 ? "investigated" : "pending_investigation",
    completed_operations: [],
  }));
  const restored = restoreWorkingSet(roundTrip(pool));

  assertEquals(restored.length, 100, "run 9b5ad99b restored 0 of these, and called it exhausted");
  assertEquals(
    restored.filter((c) => c.investigation_state === "pending_investigation").length, 90,
    "the frontier the auto-continuation promised the user it would work through",
  );
});

// ═══ 4. THE READER IS STILL A TRUST BOUNDARY ═══════════════════════════════

Deno.test("a snapshot with no company reads as ABSENT, keeping the missing-count honest", () => {
  const persisted = {
    [CHECKPOINT_RESULT_KEY]: {
      version: "lead-resume-state-v1",
      companies: [{ ...newCompanyRecord("x.com", "X"), snapshot: { yc_open_jobs: [] } }],
    },
  };
  const read = readCheckpointCompanies(persisted);
  assertEquals(read.length, 1);
  assertEquals(read[0].snapshot, null,
    "nothing can be rebuilt from it, so it must not count as present");
  assertEquals(restoreWorkingSet(read).length, 0);
});

Deno.test("a checkpoint written BEFORE snapshots existed still reads, and restores nothing", () => {
  const persisted = {
    [CHECKPOINT_RESULT_KEY]: {
      version: "lead-resume-state-v1",
      companies: [newCompanyRecord("legacy.com", "Legacy")],
    },
  };
  const read = readCheckpointCompanies(persisted);
  assertEquals(read.length, 1, "the record itself is still usable for the skip ledger");
  assertEquals(read[0].snapshot, null);
  assertEquals(restoreWorkingSet(read).length, 0, "degrades to the old behaviour, never throws");
});

Deno.test("garbage in the snapshot's own fields is narrowed, not trusted", () => {
  const persisted = {
    [CHECKPOINT_RESULT_KEY]: {
      version: "lead-resume-state-v1",
      companies: [{
        ...newCompanyRecord("odd.com", "Odd"),
        snapshot: {
          company: { company_name: "Odd", domain: "odd.com" },
          yc_open_jobs: "not an array",
          prequalified: "not an object",
          prequal_key: 42,
          shortlisted: "yes",
          investigation_rank: "seventh",
          triage: ["not", "an", "object"],
          enriched: 0,
        },
      }],
    },
  };
  const s = readCheckpointCompanies(persisted)[0].snapshot!;
  assertEquals(s.yc_open_jobs, []);
  assertEquals(s.prequalified, null);
  assertEquals(s.prequal_key, null);
  assertEquals(s.shortlisted, false);
  assertEquals(s.investigation_rank, null);
  assertEquals(s.triage, null);
  assertEquals(s.enriched, null);
  assertEquals(restoreWorkingSet(readCheckpointCompanies(persisted)).length, 1,
    "a company with a usable identity still restores; only the bad fields are dropped");
});

Deno.test("the job cap is enforced on READ as well as on write", () => {
  const persisted = {
    [CHECKPOINT_RESULT_KEY]: {
      version: "lead-resume-state-v1",
      companies: [{
        ...newCompanyRecord("big.com", "Big"),
        snapshot: {
          company: { company_name: "Big", domain: "big.com" },
          // A build with a different cap, or a hand edit.
          yc_open_jobs: Array.from({ length: 500 }, (_, i) => ({ title: `Role ${i}` })),
        },
      }],
    },
  };
  assertEquals(
    readCheckpointCompanies(persisted)[0].snapshot!.yc_open_jobs.length,
    MAX_SNAPSHOT_JOBS,
    "the cap is this module's promise about how large a restored working set gets",
  );
});
