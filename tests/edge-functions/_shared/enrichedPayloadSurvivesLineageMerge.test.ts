// A PAYLOAD ONE SIDE HOLDS IS NEVER LOST TO A SIDE WITHOUT IT.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Lineage c31585f8, 2026-09-05. Seventy checkpoint writes, EVERY one confirmed
// `written: true` with an advancing `checkpoint_version` — and the enriched
// payload count still regressed across slice boundaries:
//
//     16:02:48  written=true cv=8   rec=49
//     16:09:08  written=true cv=9   rec=42   ← next slice restored 42, not 49
//     16:09:24  written=true cv=9   rec=52
//     16:15:16  written=true cv=10  rec=42   ← next slice restored 42, not 52
//
// It re-bought the difference each time, and on DiligenceVault it discarded a
// requirement P4 had already resolved from a page the run had paid for:
//
//     15:52:57  resolved: ["Whether DiligenceVault is a B2B SaaS company"]
//     15:54:07  resolved: []            ← gone, and never resolved again
//
// ── WHY THE EXISTING MONOTONICITY DID NOT CATCH IT ─────────────────────────
//
// `mergeOne`'s clauses are STAGE monotonicity — settled beats unsettled, cited
// beats uncited. They fire only when one side owes work and the other does not.
// When both sides say `enrichment: completed`, nothing fires, and `out` keeps
// the INCOMING snapshot. On a tie, a payload the other side holds is dropped.
//
// That tie is not rare at the lineage-restore call site. `mergeOne` starts from
// `incoming` because it is "the newer view" — and there it is not:
// `lead_lineages.current_state` is written once per slice at release, while
// `tasks.result` is written at every publish. A slice killed between its last
// publish and its release leaves the task row AHEAD of the lineage.
//
// ZERO network, ZERO models, ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mergeCompanyResumeRecords,
} from "../../../supabase/functions/_shared/lineageStateMerge.ts";
import type { CompanyResumeRecord } from "../../../supabase/functions/_shared/leadResumeState.ts";

const rec = (over: Record<string, unknown> = {}) =>
  ({
    company_key: "https://www.linkedin.com/company/acme",
    company_name: "Acme",
    identity: "resolved",
    enrichment: "completed",
    hiring: "not_started",
    brain: "not_started",
    founder: "not_started",
    completed_operations: [],
    updated_at: "2026-09-05T16:00:00Z",
    snapshot: {},
    ...over,
  }) as unknown as CompanyResumeRecord;

const payload = { companyName: "Acme", employeeCount: 131 };

Deno.test("THE TIE: both sides say completed, only one holds the payload", () => {
  // The exact shape of the c31585f8 loss. Stage values agree, so no stage
  // clause fires; without payload monotonicity the enriched row is dropped.
  const fresh = rec({ snapshot: { enriched: payload, enrichment_outcome: "success" } });
  const stale = rec({ snapshot: {} });

  const out = mergeCompanyResumeRecords([fresh], [stale]);
  const merged = out.records[0] as unknown as { snapshot: { enriched?: unknown } };

  assertEquals(
    merged.snapshot.enriched,
    payload,
    "the enriched payload was dropped on a tie — this is the 49→42 regression, " +
      "and it re-buys the company on the next slice",
  );
});

Deno.test("it holds whichever side leads", () => {
  // The fix must not depend on argument order, because the call site's notion
  // of "newer" is exactly what turned out to be wrong.
  const fresh = rec({ snapshot: { enriched: payload, enrichment_outcome: "success" } });
  const stale = rec({ snapshot: {} });

  for (const [a, b, label] of [
    [fresh, stale, "fresh as stored"],
    [stale, fresh, "fresh as incoming"],
  ] as const) {
    const m = mergeCompanyResumeRecords([a], [b]).records[0] as unknown as {
      snapshot: { enriched?: unknown };
    };
    assertEquals(m.snapshot.enriched, payload, `lost the payload with ${label}`);
  }
});

Deno.test("hiring evidence is protected the same way", () => {
  const withCite = rec({
    hiring: "verified_externally",
    snapshot: {
      hiring_assessment: { verdict: "hiring_verified" },
      hiring_jobs: [{ title: "Account Executive" }],
    },
  });
  const without = rec({ hiring: "verified_externally", snapshot: {} });

  const m = mergeCompanyResumeRecords([withCite], [without]).records[0] as unknown as {
    snapshot: { hiring_assessment?: unknown; hiring_jobs?: unknown[] };
  };
  assert(m.snapshot.hiring_assessment, "a verdict must not outlive its evidence");
  assertEquals((m.snapshot.hiring_jobs ?? []).length, 1);
});

Deno.test("a REAL newer payload still wins — presence does not mean stale-wins", () => {
  // Monotonicity is about absence, not recency. When both sides HAVE a payload,
  // the leading side's value stands; this fix must not freeze the first one.
  const older = rec({ snapshot: { enriched: { companyName: "Acme", employeeCount: 10 } } });
  const newer = rec({ snapshot: { enriched: payload } });

  const m = mergeCompanyResumeRecords([older], [newer]).records[0] as unknown as {
    snapshot: { enriched?: { employeeCount?: number } };
  };
  assertEquals(
    m.snapshot.enriched?.employeeCount,
    131,
    "an actual newer payload must still replace an older one",
  );
});

Deno.test("stage monotonicity is untouched", () => {
  // The pre-existing rule: settled beats unsettled. A stale side that never
  // enriched must not drag a completed stage backwards.
  const done = rec({ enrichment: "completed", snapshot: { enriched: payload } });
  const never = rec({ enrichment: "not_started", snapshot: {} });

  const m = mergeCompanyResumeRecords([done], [never]).records[0] as unknown as {
    enrichment: string; snapshot: { enriched?: unknown };
  };
  assertEquals(m.enrichment, "completed");
  assertEquals(m.snapshot.enriched, payload);
});

Deno.test("a company only one side ever loaded is still kept", () => {
  // The other pre-existing guarantee: restoring ten of fifty must not delete
  // forty.
  const a = rec({ company_key: "a", snapshot: { enriched: payload } });
  const b = rec({ company_key: "b", snapshot: { enriched: payload } });
  const out = mergeCompanyResumeRecords([a, b], [b]);
  assertEquals(out.records.length, 2);
});
