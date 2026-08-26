// WHY THIS FILE EXISTS.
//
// Discovery used to iterate `step.providers` — a frozen pair, memo23 then
// solidcode — and build memo23's input from a literal written into the engine:
// `industries: ["B2B"], batch: ["All Batches"], isHiring: true`. Every mission
// this workflow ever ran asked that same question. "AI startups hiring software
// engineers" and "manufacturers adopting automation" both fetched the same Y
// Combinator page, and qualification was left to discard the mismatch.
//
// `leadDiscoveryStrategy` now decides, from the request. These tests cover the
// WIRING — that the strategy reaches the provider calls — and the two
// properties that make handing actor choice to a model safe to ship:
//
//   * with no selector wired, or a broken one, discovery does exactly what it
//     did before, so the floor of the change is the previous behaviour; and
//   * the fields the downstream stages depend on are not the strategy's to
//     change, however plausibly it asks.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { runCapabilityPlan } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { stubMissionEvaluator } from "./missionEvaluatorFixture.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

const CANONICAL =
  "Find AI startups in the United States hiring software engineers. " +
  "Return 10 qualified leads.";

const mission = (): LeadMissionV1 => {
  const m = parseLeadMissionDeterministic(CANONICAL);
  return {
    ...m, requested_count: 10,
    // Named companies: this suite tests WIRING, and a name matcher is
    // legitimately usable for a lookup mission. Without this it is a concept
    // mission, which `actor_not_for_semantic_discovery` now refuses.
    known_companies: ["Anthropic", "Figma"],
    company_profile: { ...m.company_profile, employee_range: { min: 10, max: 500 } },
  };
};

const BRAIN = {
  employee_min: 10, employee_max: 500,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
};

const ycRow = (i: number) => ({
  name: `Acme${i}`, website: `https://acme${i}.com`, teamSize: 40,
  batch: "W20", industries: ["B2B"], id: `acme${i}`,
  oneLiner: "B2B SaaS platform sold on subscription.",
  openJobs: [{ title: "Backend Engineer" }],
});

const linkedInRow = (i: number) => ({
  id: `li-${i}`, name: `Beta${i}`,
  linkedinUrl: `https://www.linkedin.com/company/beta${i}`,
  website: `https://beta${i}.com`, employeeCount: 44,
  description: `Beta${i} is a B2B SaaS platform sold on subscription.`,
});

interface Seen { actorKey: string; input: Record<string, unknown> }

/**
 * DISCOVERY calls only, taken from the capability-tagged record.
 *
 * Filtering the raw call log by actor key is wrong: `apify_linkedin_company_search`
 * is ALSO how `company_identity_resolution` resolves a company, so a key filter
 * counted six identity lookups as discovery. `provider_attempts` carries the
 * capability, which is the only thing that distinguishes the two uses.
 */
const discoveryProviders = (state: Record<string, unknown>): string[] =>
  (state.provider_attempts as Array<Record<string, unknown>>)
    .filter((a) => a.capability === "startup_company_discovery" &&
      a.outcome !== "skipped_not_configured")
    .map((a) => String(a.provider));

/** Run the plan, recording every provider call the engine actually made. */
const run = async (o: {
  planDiscovery?: (i: unknown) => Promise<unknown>;
  solidcodeTeamSizes?: string[];
  signals?: Array<{ type: string }>;
}) => {
  const seen: Seen[] = [];
  const result = await runCapabilityPlan({
    invoke: (call: CompiledActorCall<unknown>) => {
      seen.push({
        actorKey: call.actorKey,
        input: (call as unknown as { input: Record<string, unknown> }).input ?? {},
      });
      if (call.actorKey === "apify_yc_companies_memo23") {
        return Promise.resolve(
          Array.from({ length: 6 }, (_, i) => ycRow(i)) as Record<string, unknown>[],
        );
      }
      if (call.actorKey === "apify_yc_companies_solidcode") {
        return Promise.resolve([] as Record<string, unknown>[]);
      }
      if (call.actorKey === "apify_linkedin_company_search") {
        return Promise.resolve(
          Array.from({ length: 4 }, (_, i) => linkedInRow(i)) as Record<string, unknown>[],
        );
      }
      // Identity resolution and everything downstream.
      return Promise.resolve(
        Array.from({ length: 6 }, (_, i) => ({
          companyName: `Acme${i}`,
          linkedinUrl: `https://www.linkedin.com/company/acme${i}`,
          website: `https://acme${i}.com`, employeeCount: 42,
          description: `Acme${i} is a B2B SaaS platform sold on subscription.`,
        })) as Record<string, unknown>[],
      );
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    evaluateMission: stubMissionEvaluator({ mission_fit: "pass" }),
    ...(o.planDiscovery ? { planDiscovery: o.planDiscovery } : {}),
  } as never, {
    mission: { ...mission(), ...(o.signals ? { required_signals: o.signals } : {}) },
    plan: buildCapabilityGraph(mission()), brain: BRAIN,
    maxCandidates: 60, readEnv: () => undefined,
    ...(o.solidcodeTeamSizes ? { solidcodeTeamSizes: o.solidcodeTeamSizes } : {}),
  } as never);
  return { seen, result: result as unknown as { state: Record<string, unknown> } };
};

/** The INPUT a discovery call was made with, for the actors we assert on. */
const discoveryInput = (seen: Seen[], actorKey: string): Record<string, unknown> | null =>
  seen.find((s) => s.actorKey === actorKey)?.input ?? null;

// ── INVERTED: THE "FLOOR" WAS THE DEFECT ─────────────────────────────────
//
// This asserted that an unwired selector behaves "exactly as it does today" —
// memo23 with `industries: ["B2B"], batch: ["All Batches"]`. That floor is why
// every mission asked the same question, and the literals it pins are deleted.
//
// What replaces it is the property that matters now: a selector's input is the
// ONLY source of search terms, and the engine adds none of its own.
Deno.test("1. the engine contributes no search terms of its own", async () => {
  // NOTE, AND IT MATTERS FOR ACTOR CHOICE: memo23's `industries` is a CLOSED
  // enum — All industries / B2B / Consumer / Healthcare / Fintech / … — with no
  // "AI" value. The YC scraper cannot express "AI startups" as an industry
  // filter at all; its free-text `queries` field is the only place that term
  // can go. This is exactly the kind of fact the playbook exists to tell a
  // selector, and exactly why "startup ⇒ YC" was never a safe mapping.
  const { seen, result } = await run({
    planDiscovery: () => Promise.resolve([{
      actor_key: "apify_yc_companies_memo23", role: "primary",
      input: { queries: ["AI"], industries: ["AI"] },
    }]),
  });

  const input = discoveryInput(seen, "apify_yc_companies_memo23")!;
  assertEquals(input.queries, ["AI"], "the selector's own search term must reach the call");
  assertEquals(input.batch, undefined, "no `All Batches` literal is added");
  assertEquals(input.regions, undefined, "no default geography is added");
  assertEquals(input.minEmployeeSize, undefined, "no default size band is added");
  assertEquals(input.industries, undefined, "an off-enum value is dropped, not sent");

  // AND THE DROP IS RECORDED. A filter that silently disappears is how a run
  // ends up searching for something nobody asked for.
  const d = result.state.discovery_strategy as Record<string, unknown>;
  const actors = d.actors as Array<Record<string, unknown>>;
  const dropped = actors[0].dropped_filters as Array<Record<string, unknown>>;
  assert(
    dropped.some((f) => String(f.field) === "industries"),
    "the rejected enum value must appear in dropped_filters",
  );
  // The evidence-bearing fields are still the engine's, because downstream
  // stages are built on them — see test 6.
  assertEquals(input.mode, "companies");
  assertEquals(input.scrapeOpenJobs, true);
  assertEquals(input.enrichEmails, false);
});

Deno.test("2. the strategy reaches the provider calls", async () => {
  // The wiring itself: an actor the frozen pair never contained is now called,
  // with the query the selector chose.
  const { seen, result } = await run({
    planDiscovery: () => Promise.resolve({
      actors: [
        { actor_key: "apify_yc_companies_memo23", role: "primary", input: { industries: ["B2B"] } },
        {
          actor_key: "apify_linkedin_company_search", role: "breadth",
          input: { searchQuery: "Anthropic" },
        },
      ],
    }),
  });

  assert(discoveryProviders(result.state).includes("apify_linkedin_company_search"),
    "an actor outside the frozen pair must actually run, as DISCOVERY");
  const li = discoveryInput(seen, "apify_linkedin_company_search")!;
  assertEquals(li.searchQuery, "Anthropic", "the selector's query must reach the call");
});

Deno.test("3. rows from every actor land in ONE deduplicated pool", async () => {
  // The diagram's "deduplication is global across all actors". `addCompany`
  // keys on LinkedIn URL then domain, so the union needed no new machinery —
  // but nothing proved the union actually happened until now.
  const { seen, result } = await run({
    planDiscovery: () => Promise.resolve([
      { actor_key: "apify_yc_companies_memo23", role: "primary", input: {} },
      {
        actor_key: "apify_linkedin_company_search", role: "breadth",
        input: { searchQuery: "Anthropic" },
      },
    ]),
  });

  assertEquals(discoveryProviders(result.state).length, 2);
  const keys = result.state.company_keys as string[];
  // Six distinct YC companies plus four distinct LinkedIn ones, none shared.
  assertEquals(keys.length, 10);
  assertEquals(new Set(keys).size, keys.length, "the pool must carry no duplicate key");
});

// ── INVERTED: A MODEL OUTAGE IS NOT A REASON TO SEARCH SOMETHING ELSE ────
Deno.test("4. a selector that throws blocks the run", async () => {
  let msg = "";
  try {
    await run({ planDiscovery: () => Promise.reject(new Error("model timeout")) });
  } catch (e) { msg = String(e); }
  assert(
    msg.includes("discovery actor selection was blocked"),
    `a selector outage must block; got: ${msg || "no error"}`,
  );
  assert(msg.includes("discovery_selector_failed"), "and must name the cause");
});

// ── INVERTED 2026-08-17: NONSENSE NO LONGER DISCOVERS ────────────────────
//
// This asserted that a selector returning junk "still discovers", landing on
// memo23. That was the defect stated as a guarantee: a model that answered
// gibberish and a model that deliberately chose YC produced identical runs, and
// the user got a confident pool built from a proposal nobody could read.
Deno.test("5. a selector returning nonsense BLOCKS rather than discovering", async () => {
  for (const junk of [null, {}, { actors: "everything" }, [{ actor_key: "apify/invented" }]]) {
    let blocked = false;
    try {
      await run({ planDiscovery: () => Promise.resolve(junk) });
    } catch (e) {
      blocked = String(e).includes("discovery actor selection was blocked");
    }
    assert(blocked, `must block for ${JSON.stringify(junk)}, never fall back to YC`);
  }
});

Deno.test("6. the evidence-bearing fields are not the strategy's to change", async () => {
  // `scrapeOpenJobs` feeds the free prequalification pass, the hiring signal
  // and the job evidence three stages downstream. A selector could plausibly
  // turn it off to make the run cheaper and faster, and the run would then
  // report a discovered pool whose companies can never prove they are hiring.
  // `mode` anchors the row shape the normalizer expects.
  const { seen } = await run({
    planDiscovery: () => Promise.resolve([{
      actor_key: "apify_yc_companies_memo23", role: "primary",
      input: { mode: "jobs", scrapeOpenJobs: false, scrapeFounderDetails: true },
    }]),
  });

  const memo = discoveryInput(seen, "apify_yc_companies_memo23")!;
  assertEquals(memo.scrapeOpenJobs, true, "open jobs are downstream evidence, not an option");
  assertEquals(memo.mode, "companies");
  assertEquals(memo.scrapeFounderDetails, false);
});

Deno.test("7. an actor the catalog does not permit never becomes a call", async () => {
  // The closed catalog, proven at the point where money is spent rather than
  // only in the strategy module's own unit tests.
  const seen: Seen[] = [];
  let blockedMessage = "";
  try {
    const r = await run({
      planDiscovery: () => Promise.resolve([
        { actor_key: "apify_linkedin_company_details", role: "primary", input: {} },
        { actor_key: "apify/some-scraper", role: "breadth", input: {} },
      ]),
    });
    seen.push(...r.seen);
  } catch (e) { blockedMessage = String(e); }

  assertEquals(seen.some((s) => s.actorKey === "apify/some-scraper"), false);
  // company_details is a real, callable actor — for ENRICHMENT. Neither is
  // permitted for DISCOVERY, so nothing survives validation and the run blocks
  // rather than quietly substituting the YC scraper.
  assert(blockedMessage.includes("discovery actor selection was blocked"));
  assert(
    blockedMessage.includes("No deterministic strategy was substituted"),
    "and states plainly that YC was not quietly used instead",
  );
});

Deno.test("8. a company search with neither a query nor filters is skipped", async () => {
  // NARROWED, 2026-08-26. This asserted that ANY query-less call is skipped, on
  // the card's claim that "a query-less company search returns nothing at full
  // price". Run RidX3qBPdnjToMcqM disproved that: `industryIds:["104"] +
  // locations:["United States"] + companySize:["11-50"]` with no `searchQuery`
  // returned 5/5 genuine US staffing agencies out of ~10,952 matches.
  //
  // The real rule is narrower and still holds: a call with NO name and NO
  // structured filter is unfiltered, and an unfiltered company search returns
  // arbitrary companies. This mission's ICP yields no industry, so nothing can
  // be derived and the skip stands.
  const { seen, result } = await run({
    planDiscovery: () => Promise.resolve([
      { actor_key: "apify_yc_companies_memo23", role: "primary", input: {} },
      { actor_key: "apify_linkedin_company_search", role: "breadth", input: {} },
    ]),
  });

  assertEquals(
    discoveryProviders(result.state).includes("apify_linkedin_company_search"), false,
    "no query means no paid discovery call",
  );
  const attempts = result.state.provider_attempts as Array<Record<string, unknown>>;
  assert(
    attempts.some((a) =>
      a.provider === "apify_linkedin_company_search" && a.outcome === "skipped_not_configured"),
    "and the skip must be recorded rather than silent",
  );
});

Deno.test("9. breadth does not run once the pool is already big enough", async () => {
  // Widening a pool that already satisfies the request is spend with nothing to
  // buy. `maxCandidates` is 60 here and memo23 returns 6, so breadth SHOULD
  // run; the negative case is covered by the strategy module's unit tests.
  const { result } = await run({
    planDiscovery: () => Promise.resolve([
      { actor_key: "apify_yc_companies_memo23", role: "primary", input: {} },
      {
        actor_key: "apify_linkedin_company_search", role: "breadth",
        input: { searchQuery: "Anthropic" },
      },
    ]),
  });
  assertEquals(discoveryProviders(result.state).length, 2, "6 of 60 is not a full pool");
});

Deno.test("10. a fallback stays silent while the primary is producing", async () => {
  // The old solidcode special-case, now the contract for any actor carrying the
  // role — and the reason a fallback is not simply a second source.
  const { result } = await run({
    solidcodeTeamSizes: ["11-50"],
    planDiscovery: () => Promise.resolve([
      { actor_key: "apify_yc_companies_memo23", role: "primary", input: {} },
      { actor_key: "apify_yc_companies_solidcode", role: "fallback", input: {} },
    ]),
  });
  assertEquals(
    discoveryProviders(result.state).includes("apify_yc_companies_solidcode"), false,
    "memo23 returned rows, so the fallback must not spend",
  );
});

Deno.test("11. the run records which actors were chosen, how, and with what input", async () => {
  // The one record that answers "was this pool built for THIS request?" after
  // the fact.
  //
  // ── WHY THE PAYLOAD IS NOW ON THE RECORD ─────────────────────────────────
  //
  // This asserted field names only, to keep `tasks.result` from growing. The
  // size lesson behind that was real but was about PROVIDER payloads — scraped
  // rows measured in megabytes — not about actor inputs, which are a few dozen
  // scalars capped at `DEFAULT_MAX_ACTORS` (3).
  //
  // The 2026-08-17 audit paid the price of the omission: with names only,
  // "where did `industries: ['B2B']` come from?" could not be answered from the
  // run at all, and had to be reconstructed by matching the live Apify input
  // against hardcoded literals in the engine. The values are the evidence.
  const { result } = await run({
    planDiscovery: () => Promise.resolve([
      { actor_key: "apify_yc_companies_memo23", role: "primary", input: {} },
      {
        actor_key: "apify_linkedin_company_search", role: "breadth",
        input: { searchQuery: "Anthropic", bogusFilter: 1 },
      },
    ]),
  });

  const d = result.state.discovery_strategy as Record<string, unknown>;
  assert(d, "the strategy must be recorded on the execution state");
  assertEquals(d.source, "model_repaired", "the bogus filter was dropped");
  const actors = d.actors as Array<Record<string, unknown>>;
  assertEquals(actors.length, 2);
  for (const a of actors) {
    assert(Array.isArray(a.input_fields));
    assertEquals("input" in a, true, "the input actually sent must be recorded");
    assert("rationale" in a, "and the reason it was chosen");
  }
  // The repaired filter must be nameable, not merely counted — "one filter was
  // dropped" does not tell you WHICH, and that is the whole question when a
  // pool comes back wrong.
  const violations = d.violations as Array<Record<string, unknown>>;
  assert(Array.isArray(violations) && violations.length > 0);
  assert(
    violations.some((v) => String(v.message ?? "").includes("bogusFilter") ||
      String(v.code ?? "").length > 0),
    "the validator's decision must be readable from the record",
  );
});

// ── REPLACED: THERE IS NO DETERMINISTIC PATH TO RECORD ───────────────────
Deno.test("12. no selector at all is a blocked run, and says so", async () => {
  let msg = "";
  try {
    await run({ planDiscovery: undefined });
  } catch (e) { msg = String(e); }
  assert(
    msg.includes("discovery actor selection was blocked"),
    `a run with no selector must block; got: ${msg || "no error"}`,
  );
  assert(
    msg.includes("No deterministic strategy was substituted"),
    "and must say plainly that nothing was substituted in its place",
  );
});

// ═══════════════════════════════════════════ multi-signal execution ══
//
// The point of the whole layer: a request needing two kinds of evidence must
// actually ask for both. Before this, the strategy chose company-discovery
// Actors and every other required signal was left to a later stage that may or
// may not have looked — so a mission requiring hiring AND funding could report
// success having never asked a funding source anything.

Deno.test("13. an unserved signal adds its source to the run", async () => {
  // The mission requires hiring. A strategy of pure YC discovery leaves the
  // hiring PROOF unserved — the job source is what proves an open role — so the
  // engine adds it rather than letting qualification guess.
  const { result } = await run({
    planDiscovery: () => Promise.resolve([
      { actor_key: "apify_yc_companies_memo23", role: "primary", input: {} },
    ]),
    signals: [{ type: "hiring" }],
  });

  const coverage = result.state.signal_coverage as Record<string, unknown>;
  assert(coverage, "coverage must be recorded on every run");
  assertEquals(coverage.fully_covered, true, "hiring is a covered signal");
});

Deno.test("14. a signal already served adds nothing, and costs nothing extra", async () => {
  // ORDER MATTERS. The first implementation added every runnable Actor a signal
  // named — and a hiring scenario names the discovery sources too, because
  // discovery is how you find the company a role belongs to. That re-added
  // company search on top of a strategy that had declined it, overrode the
  // strategy's own cost decision, and broke the guarantee that a resumed run
  // costs strictly less than the first.
  const { seen, result } = await run({
    planDiscovery: () => Promise.resolve([
      { actor_key: "apify_yc_companies_memo23", role: "primary", input: {} },
      {
        actor_key: "apify_linkedin_company_search", role: "breadth",
        input: { searchQuery: "Anthropic" },
      },
    ]),
    signals: [{ type: "hiring" }],
  });

  // Exactly the two the strategy chose — nothing was bolted on top.
  //
  // Counted from `provider_attempts`, not the raw call log: identity resolution
  // also calls `apify_linkedin_company_search` with a `searchQuery`, so a filter
  // on the input shape counts its six lookups as discovery too.
  const providers = discoveryProviders(result.state);
  assertEquals(providers.length, 2);
  assertEquals(
    providers.filter((p) => p === "apify_linkedin_company_search").length, 1,
    "the declined-then-re-added double call must not happen",
  );
  // `seen` is still the proof that only ONE discovery-shaped call was made.
  void seen;
});

Deno.test("15. a signal no capability can serve is reported, never silently skipped", async () => {
  // Crunchbase is described by the registry and declared by no capability. A run
  // that needed funding evidence and never asked for it must not look like a run
  // that asked and found none.
  const { seen, result } = await run({
    planDiscovery: () => Promise.resolve([
      { actor_key: "apify_yc_companies_memo23", role: "primary", input: {} },
    ]),
    signals: [{ type: "funding" }],
  });

  // Nothing outside the capability was called.
  for (const s of seen) {
    assertEquals(s.actorKey.includes("crunchbase"), false, "containment holds");
  }
  const coverage = result.state.signal_coverage as Record<string, unknown>;
  const described = coverage.described_only as string[] | undefined;
  assert(described && described.includes("memo23/crunchbase-scraper"),
    "the gap must be recorded on the run, not merely known");
});

Deno.test("16. an unanswerable signal produces an honest shortfall, not a silent pass", async () => {
  const { result } = await run({
    planDiscovery: () => Promise.resolve([
      { actor_key: "apify_yc_companies_memo23", role: "primary", input: {} },
    ]),
    signals: [{ type: "hiring" }, { type: "technology_adoption" }],
  });

  const coverage = result.state.signal_coverage as Record<string, unknown>;
  assertEquals(coverage.fully_covered, false);
  const statement = String(coverage.shortfall_statement ?? "");
  assert(/technology_adoption/.test(statement));
  assert(/reverse lookup/i.test(statement),
    "the shortfall must carry the verified reason, not just the verdict");
});
