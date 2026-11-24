// ONE CLOCK PER PHASE: the hiring verifier judges its posting window at the
// phase's `deps.now()`, the same instant it stamps on the evidence, when no
// `io.now` is given (production gives none; it passes the wall clock as
// `deps.now`). It used to fall back to a second, real wall-clock read, so a
// replay judged at its fixture time expired 30 real days later — two
// fundingRecencyFallback phase replays started failing on 2026-10-24 at 16:00
// UTC, exactly 30 days after their fixture's clock.
//
// The clock here is in the year 2000: a wall-clock read can never pass it.
//
// Offline: no database, no provider, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { VerificationTarget, VerifierCall, VerifierCallOutcome, VerifierDeps } from "../../../supabase/functions/_shared/claimVerifier.ts";
import { hiringClaimVerifier } from "../../../supabase/functions/_shared/hiringClaimVerifier.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";

globalThis.fetch = () => { throw new Error("these tests must not reach the network"); };

const PHASE_NOW = new Date("2000-01-15T12:00:00.000Z");
const target: VerificationTarget = {
  company_key: "k_acme", name: "acme", domain: "acme.com", linkedin_url: "https://www.linkedin.com/company/acme",
  criterion: { criterion_id: "hiring:sales", dimension: "hiring", value: null, window_days: 30 },
  graph: buildCompanyEvidenceGraph("k_acme", [], { now: PHASE_NOW }),
};
const posting = (postedDate: string) => ({
  id: "job-acme", title: "Account Executive", postedDate, linkedinUrl: "https://www.linkedin.com/jobs/view/job-acme/",
  company: { linkedinUrl: "https://www.linkedin.com/company/acme", name: "acme" },
});
function deps(rows: Record<string, unknown>[]): VerifierDeps {
  return {
    call: (_c: VerifierCall) => Promise.resolve({ status: "ok", rows, provider_call_id: "pc1" } as VerifierCallOutcome),
    ready: () => true, now: () => PHASE_NOW.toISOString(), log: () => {}, stop: () => null,
  };
}
// Exactly as run-agent builds it: no `now` in the IO.
const verifier = () => hiringClaimVerifier({
  titles: ["Account Executive"], role_families: ["gtm_sales"], window_days: 30, matchesRole: (t) => /account executive/i.test(t),
});

Deno.test("hiring window: judged at the phase clock, not a second wall-clock read", async () => {
  const inside = await verifier().verify([target], deps([posting("2000-01-10T10:00:00.000Z")]), { mission_id: "m", pending: [] });
  assertEquals(inside.findings.length, 1);
  assert(inside.findings[0].item, "a posting 5 days before the phase clock proves the 30-day window");
  assertEquals(inside.findings[0].item!.observed_at, PHASE_NOW.toISOString(), "the evidence carries the same clock");
});

Deno.test("hiring window: a posting outside the window at the phase clock is not proof", async () => {
  const outside = await verifier().verify([target], deps([posting("1999-11-01T10:00:00.000Z")]), { mission_id: "m", pending: [] });
  assertEquals(outside.findings.map((f) => [f.answered, f.item]), [[true, null]]);
});
