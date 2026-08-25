// PHASE 4 — EXPANSION AND PRODUCT LAUNCH, PROVEN LINK BY LINK.
//
// Funding taught what "registered" and "the actor returned rows" are worth:
// nothing on their own. `apify_funding_rounds_datahyena` was carded, driven and
// returning 25 rows while the engine logged "the actor returned no rows at
// all", because the TRANSPORT reshaped every row into a job record. An offline
// test that hands the engine the provider's shape cannot see that — the
// transport sits between them.
//
// So each link is checked separately here:
//
//   1  collectability says executable
//   2  the transport preserves the provider's shape      ← the funding failure
//   3  the capability actually runs
//   4  evidence reaches the company and the registry
//   5  a verdict can cite it
//   6  a canonical signal_event can be produced
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runCapabilityPlan, ENGINE_DRIVEN_SIGNAL_VERIFICATION,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { compileMonitoringMission } from "../../../supabase/functions/_shared/monitoringMission.ts";
import { signalCollectability } from "../../../supabase/functions/_shared/signalCollectability.ts";
import {
  resolveResponseKind, structuredRowsLookIntact,
} from "../../../supabase/functions/_shared/providerResponseContract.ts";
import { normalizeNewsArticle } from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import { runMonitoring } from "../../../supabase/functions/_shared/monitoringRunner.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

/** A google-news row in the shape the live actor emits. */
/**
 * A story inside the subject's 90-day window.
 *
 * Computed rather than hardcoded: the capability now enforces the mission's
 * window on the article's own publication date, because the actor's timeframe
 * vocabulary (1h/1d/7d/30d/1y/all) cannot express 90 days and is sent as the
 * narrowest bucket that certainly contains it. A fixed date would start failing
 * the day it aged out.
 */
const NEWS_ISO = new Date(Date.now() - 10 * 86_400_000).toISOString();

const NEWS = {
  title: "Acme expands into Germany",
  url: "https://news.example/acme-germany",
  source: "CNBC",
  publishedAt: NEWS_ISO,
  description: "Acme opened a Berlin office this week.",
};
/** The same story with no date. A headline is not evidence. */
const UNDATED = { ...NEWS, publishedAt: null };

const SEARCH = {
  id: "acme", name: "Acme",
  linkedinUrl: "https://www.linkedin.com/company/acme",
  website: "https://acme.com",
  description: "Acme is a B2B SaaS platform.", location: "Austin, TX",
};

const CASES = [
  { event: "expansion", capability: "expansion_signal_verification", evidence: "expansion_signal" },
  { event: "product_launch", capability: "product_launch_verification", evidence: "launch_signal" },
] as const;

function missionFor(event: string) {
  const r = compileMonitoringMission({
    workspace_id: "w",
    subjects: [{
      kind: "tracked_company", identifier: "acme.com", label: "Acme",
      signals: [{ event: event as never, subject: "company" as never }], timeframe_days: 90,
    }],
    icp: null,
  });
  assert(r.ok && r.mission, `${event} failed to compile: ${r.reason}`);
  return r.mission!;
}

async function drive(event: string, newsRows: Record<string, unknown>[]) {
  const calls: string[] = [];
  const inputs: unknown[] = [];
  const mission = missionFor(event);
  const plan = buildCapabilityGraph(mission as never);
  const run = await runCapabilityPlan(
    {
      invoke: (call: CompiledActorCall<unknown>) => {
        calls.push(call.actorKey);
        if (call.actorKey === "apify_google_news") inputs.push(call.input);
        return Promise.resolve(
          call.actorKey === "apify_google_news"
            ? newsRows
            : call.actorKey === "apify_linkedin_company_search"
            ? [SEARCH]
            : [],
        );
      },
      verifyEmployer: () => ({ verified: false, outcome: "not_attempted" }),
      // deno-lint-ignore no-explicit-any
    } as any,
    // deno-lint-ignore no-explicit-any
    { mission, plan, maxCandidates: 10 } as any,
  );
  return { run, calls, inputs };
}

// ── LINK 1 ──────────────────────────────────────────────────────────────────

Deno.test("1. collectability says both are executable, for every subject kind", () => {
  for (const { event, capability } of CASES) {
    for (const k of ["tracked_company", "competitor", "icp"] as const) {
      const c = signalCollectability(event, k);
      assert(c.collectible, `${k}/${event}: ${c.reason}`);
      assertEquals(c.proven_by, capability);
    }
  }
  // And the engine names the shared stage, so the claim is not a second table.
  assertEquals(
    [...ENGINE_DRIVEN_SIGNAL_VERIFICATION].sort(),
    ["expansion_signal_verification", "product_launch_verification"],
  );
});

// ── LINK 2: THE FUNDING FAILURE CLASS ───────────────────────────────────────

Deno.test("2. the news actor's rows survive the transport", () => {
  // Funding's defect exactly: unrecognised actor → falls through to the tool's
  // declared source type → read through the JOBS path → every row reshaped.
  for (
    const id of [
      { actorKey: "apify_google_news", actorId: null },
      { actorKey: null, actorId: "data_xplorer/google-news-scraper-fast" },
      // The actor wins over a declared type. This is the precedence that failed.
      { actorKey: "apify_google_news", actorId: null, sourceType: "hiring" },
    ]
  ) {
    assertEquals(resolveResponseKind(id), "structured_companies", JSON.stringify(id));
  }
  // A job-normalized news row is a VISIBLE transport failure, not an empty read.
  const mangled = [{ job_title: null, raw: { provider_payload: NEWS } }];
  assertFalse(structuredRowsLookIntact(mangled).intact);
  assertEquals(structuredRowsLookIntact([NEWS]).intact, true);
});

Deno.test("2b. the normalizer reads the live row shape, not an invented one", () => {
  // `normalizeNewsArticle` was corrected against a live run: the field is
  // `url` not `link`, and `source` is a plain string. A fixture that drifts
  // from the live shape is how funding looked healthy offline.
  const a = normalizeNewsArticle(NEWS);
  assertEquals(a.url, "https://news.example/acme-germany");
  assertEquals(a.source, "CNBC");
  // CANONICALISED, not echoed. The provider's string is normalised to ISO so
  // two providers reporting the same instant compare equal.
  assertEquals(a.published_at, NEWS_ISO);
  assert(a.is_evidence);
  // NO DATE, NO EVIDENCE.
  assertFalse(normalizeNewsArticle(UNDATED).is_evidence);
});

// ── LINKS 3–5 ───────────────────────────────────────────────────────────────

Deno.test("3. the capability actually runs, and asks about THIS company", async () => {
  for (const { event, capability } of CASES) {
    const { run, calls, inputs } = await drive(event, [NEWS]);
    assert(calls.includes("apify_google_news"), `${event} never called the provider`);
    assert(
      run.state.completed_capabilities.includes(capability),
      `${event}: ${JSON.stringify(run.state.completed_capabilities)}`,
    );
    // THE COMPANY AND THE CLAIM, TOGETHER. A search for the terms alone returns
    // the industry's news; a search for the name alone returns everything.
    const q = JSON.stringify(inputs[0]);
    // The compiler lowercases; what matters is that the name is IN the query.
    assert(/acme/i.test(q), `${event} query lost the company: ${q}`);
    assert(
      event === "expansion" ? /expand/i.test(q) : /launch|announc|unveil/i.test(q),
      `${event} query lost the signal: ${q}`,
    );
  }
});

Deno.test("4. the evidence reaches the company and the registry, under its own signal", async () => {
  for (const { event, evidence } of CASES) {
    const { run } = await drive(event, [NEWS]);
    const c = run.companies[0];
    assertEquals((c.signal_evidence[event] ?? []).length, 1, `${event} evidence not carried`);

    const items = (c.evidence_registry?.items ?? []).filter((i) => i.evidence_type === evidence);
    assertEquals(items.length, 1, `${event} evidence never reached the registry`);
    assertEquals(items[0].source_url, NEWS.url);
    // The PUBLICATION date is the observation. A story published in August was
    // published in August however recently we read it.
    assertEquals(items[0].observed_at, NEWS_ISO);
    // A publisher reported it; we did not verify it.
    assertEquals(items[0].verification_state, "reported");

    // AND IT IS FILED UNDER THE SIGNAL IT PROVES. An article proving a launch
    // must not be citable as an expansion.
    const other = event === "expansion" ? "launch_signal" : "expansion_signal";
    assertEquals(
      (c.evidence_registry?.items ?? []).filter((i) => i.evidence_type === other).length, 0,
      `${event} evidence leaked into ${other}`,
    );
  }
});

Deno.test("5. a verdict cites it, with no evaluator involved", async () => {
  for (const { event, capability, evidence } of CASES) {
    const { run } = await drive(event, [NEWS]);
    const a = (run.companies[0].signal_assessments ?? [])
      .find((x) => x.signal === `${event}/company`);
    assert(a, `${event}: no assessment`);
    // `plausible`, NOT `verified`. A publisher reported the claim; we read a
    // headline. `verified` would say we confirmed it.
    assertEquals(a!.verdict, "plausible");
    assertEquals(a!.established_by, capability);
    assert(a!.evidence_ids.every((id) => id.startsWith(`${evidence}:`)), a!.evidence_ids.join(","));
  }
});

Deno.test("6. an undated story proves nothing", async () => {
  for (const { event } of CASES) {
    const { run } = await drive(event, [UNDATED]);
    const c = run.companies[0];
    assertEquals((c.signal_evidence[event] ?? []).length, 0);
    const a = (c.signal_assessments ?? []).find((x) => x.signal === `${event}/company`);
    assertFalse(a?.verdict === "plausible" || a?.verdict === "verified");
  }
});

// ── LINK 6: THE CANONICAL EVENT ─────────────────────────────────────────────

Deno.test("7. a canonical signal_event is produced, typed and dated honestly", async () => {
  for (const { event } of CASES) {
    const written: Record<string, unknown>[] = [];
    const out = await runMonitoring(
      {
        workspace_id: "w",
        subjects: [{
          kind: "competitor", identifier: "acme.com", label: "Acme",
          signals: [{ event: event as never, subject: "company" as never }],
          timeframe_days: 90,
        }],
        icp: null,
      },
      {
        buildPlan: buildCapabilityGraph as never,
        runPlan: async (mission, plan) => {
          // deno-lint-ignore no-explicit-any
          return await runCapabilityPlan(
            {
              invoke: (call: CompiledActorCall<unknown>) =>
                Promise.resolve(
                  call.actorKey === "apify_google_news"
                    ? [NEWS]
                    : call.actorKey === "apify_linkedin_company_search"
                    ? [SEARCH]
                    : [],
                ),
              verifyEmployer: () => ({ verified: false, outcome: "not_attempted" }),
              // deno-lint-ignore no-explicit-any
            } as any,
            // deno-lint-ignore no-explicit-any
            { mission, plan, maxCandidates: 10 } as any,
          ) as any;
        },
        loadHeldEvidence: () => Promise.resolve([]),
        writeEvent: (i) => {
          written.push(i as Record<string, unknown>);
          return Promise.resolve({ written: true });
        },
      },
    );
    assert(out.ok, `${event}: ${out.refusal} — ${out.reason}`);
    assertEquals(written.length, 1, `${event} produced no canonical event`);

    const e = written[0];
    assertEquals(e.origin, "scheduled_monitor");
    assertEquals(e.subject_type, "competitor");
    assertEquals(
      e.signal_type,
      event === "expansion" ? "market_expansion" : "product_launch",
    );
    // ── THE ARTICLE'S DATE REACHES THE EVENT ──────────────────────────────
    //
    // It used to be discarded here: the event was written `occurred_at: null`
    // on the grounds that this stage states no source time of its own. It does
    // not — but the EVIDENCE does, and throwing it away made every monitoring
    // event undated, which then made the reuse pre-flight unable to reuse one
    // (an undated event cannot be shown to fall inside a recency window). A
    // monitor re-bought answers it already held.
    assertEquals(e.occurred_at, NEWS_ISO, "the publisher's date is a source-reported date");
    assertEquals(e.occurred_at_basis, "source_reported");
    assertEquals((e.normalized_value as Record<string, unknown>).verdict, "plausible");
  }
});

Deno.test("8. a story older than the window the mission asked for is refused", async () => {
  // The actor's timeframe vocabulary is 1h/1d/7d/30d/1y/all, so a 90-day
  // request is sent as "1y" — the narrowest bucket that certainly contains it.
  // Results can therefore be older than the window, and a story from last
  // spring is not evidence of an expansion this quarter. The window is enforced
  // on the article's own publication date, which is the only exact place.
  const old = { ...NEWS, publishedAt: new Date(Date.now() - 300 * 86_400_000).toISOString() };
  for (const { event } of CASES) {
    const { run } = await drive(event, [old]);
    assertEquals(
      (run.companies[0].signal_evidence[event] ?? []).length, 0,
      `${event} accepted a story from outside its window`,
    );
  }
});


// ── 9. AND THE DATE IS ONLY WRITTEN WHEN IT IS REAL ─────────────────────────

Deno.test("9. an undated story still yields an undated event", async () => {
  // The rule that nothing may acquire a time from the moment we happened to
  // look is unchanged. What changed is that a real reported date survives.
  const written: Record<string, unknown>[] = [];
  await runMonitoring(
    {
      workspace_id: "w",
      subjects: [{
        kind: "competitor", identifier: "acme.com", label: "Acme",
        signals: [{ event: "expansion", subject: "company" }], timeframe_days: 90,
      }],
      icp: null,
    },
    {
      buildPlan: buildCapabilityGraph as never,
      // A verdict with no cited date at all — the shape a model verdict has.
      runPlan: () =>
        Promise.resolve({
          companies: [{
            key: "acme.com",
            company: {
              company_name: "Acme", canonical_domain: "acme.com",
              linkedin_company_url: null,
              external_source_id: "mission_supplied:acme.com",
            },
            signal_assessments: [{
              signal: "expansion/company", verdict: "plausible",
              evidence_ids: ["expansion_signal:x"], occurred_at: null,
            }],
          }],
          state: {
            qualified_company_keys: [],
            completed_capabilities: ["expansion_signal_verification"],
          },
          // deno-lint-ignore no-explicit-any
        }) as any,
      loadHeldEvidence: () => Promise.resolve([]),
      writeEvent: (i) => {
        written.push(i as Record<string, unknown>);
        return Promise.resolve({ written: true });
      },
    },
  );
  assertEquals(written.length, 1);
  assertEquals(written[0].occurred_at, null);
  assertEquals(written[0].occurred_at_basis, "unknown");
});

Deno.test("10. a future date is refused, never written as an occurrence", async () => {
  // A provider reporting tomorrow is reporting a mistake, and writing it would
  // make the event look fresher than anything that has happened — the one
  // direction a timing error must never go.
  const { validSourceDate } = await import(
    "../../../supabase/functions/_shared/monitoringRunner.ts"
  );
  const now = Date.parse("2026-08-25T12:00:00.000Z");
  assertEquals(validSourceDate(new Date(now + 5 * 86_400_000).toISOString(), now), null);
  assertEquals(validSourceDate("not a date", now), null);
  assertEquals(validSourceDate(null, now), null);
  // A real past date survives, canonicalised.
  assertEquals(
    validSourceDate("2026-08-10T09:00:00Z", now), "2026-08-10T09:00:00.000Z",
  );
});
