// PHASE 4 — A CATEGORY IS COLLECTIBLE OR IT IS REFUSED. NEVER SILENTLY EMPTY.
//
// ── WHAT THE AUDIT ASSUMED, AND WHAT WAS TRUE ───────────────────────────────
//
// The plan called Phase 4 "wiring, not capability", on the grounds that
// `funding_signal_discovery`, `expansion_signal_discovery`,
// `product_launch_discovery`, `technology_verification` and
// `company_post_verification` are "all already supported with providers".
//
// They are all registered, and all carded. Only two of them RUN:
// `hiring_verification` and `funding_signal_discovery`. The rest sit in the
// engine's skip list — declared, carded and unrunnable, exactly as
// `known_company_resolution` did for the whole of Phase 3.
//
// A subject naming one of them compiled cleanly, planned cleanly, resolved the
// company's identity, paid to enrich it, reached qualification, and established
// nothing. The run reported `ok`. The feed stayed empty. Nothing said why.
//
// ── AND IT DEPENDS ON THE SUBJECT KIND ──────────────────────────────────────
//
// A named subject enters through `known_company_resolution`, so the graph
// schedules only VERIFICATION capabilities. An ICP subject enters through
// DISCOVERY, and for funding the discovery IS the proof — the source's job is
// to find companies that raised. So `funding` is collectible for an ICP subject
// and not for a tracked company, and saying so is worth more than a filter that
// quietly returns nothing.
//
// PURE. No network, no provider, no model, no database.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  signalCollectability, filterCollectableSignals,
} from "../../../supabase/functions/_shared/signalCollectability.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { compileMonitoringMission } from "../../../supabase/functions/_shared/monitoringMission.ts";
import { isEngineDriven } from "../../../supabase/functions/_shared/leadResearchPlaybooks.ts";
import { provingCapabilities } from "../../../supabase/functions/_shared/signalQualification.ts";
import { CANONICAL_TYPE_FOR } from "../../../supabase/functions/_shared/monitoringRunner.ts";

const KINDS = ["tracked_company", "competitor", "icp"] as const;
const EVENTS = [
  "hiring", "funding", "expansion", "product_launch", "technology",
  "post", "headcount_change",
] as const;

// ── 1–3. THE MATRIX AS IT ACTUALLY IS ───────────────────────────────────────

Deno.test("1. hiring is collectible for every subject kind", () => {
  for (const k of KINDS) {
    const c = signalCollectability("hiring", k);
    assert(c.collectible, `${k}/hiring: ${c.reason}`);
    assertEquals(c.proven_by, "hiring_verification");
  }
});

Deno.test("2. funding is collectible for an ICP subject and not for a named one", () => {
  const icp = signalCollectability("funding", "icp");
  assert(icp.collectible, icp.reason);
  assertEquals(icp.proven_by, "funding_signal_discovery");

  for (const k of ["tracked_company", "competitor"] as const) {
    const c = signalCollectability("funding", k);
    assertFalse(c.collectible, `${k}/funding claims to be collectible`);
    assertEquals(c.proven_by, null);
    // AND THE REASON DISTINGUISHES THE TWO FAILURES. "Nothing is scheduled" is
    // a different problem from "it is scheduled but not driven", and they need
    // different work.
    assert(/nothing that would prove/.test(c.reason), c.reason);
  }
});

Deno.test("3a. expansion and product launch are collectible for every subject kind", () => {
  // Phase 4 drove both through ONE stage: they ask the same provider the same
  // shape of question about the same company, and a branch each is how
  // `general_company_discovery` acquired a hardcoded provider.
  for (const e of ["expansion", "product_launch"] as const) {
    for (const k of KINDS) {
      const c = signalCollectability(e, k);
      assert(c.collectible, `${k}/${e}: ${c.reason}`);
      assertEquals(
        c.proven_by,
        e === "expansion" ? "expansion_signal_verification" : "product_launch_verification",
      );
    }
  }
});

Deno.test("3b. technology and company posts are refused, with the reason", () => {
  // NOT AN OVERSIGHT, AND THE REASONS DIFFER.
  //
  // `technology`: BuiltWith reports what a domain runs NOW and publishes no
  // adoption date — `NormalizedTechnologyProfile.adopted_at` is always null, on
  // purpose. An event store whose every row carries `occurred_at_basis` cannot
  // hold an undated state, and there is no canonical signal type for one.
  //
  // `post`: a company's own post is an EVIDENCE SOURCE, not a signal. The
  // registry already lists `apify_linkedin_company_posts` as a provider for
  // expansion and launch VERIFICATION, which is what reading a company's posts
  // is for. There is no canonical type for "the company posted something",
  // and inventing one would file evidence as a finding.
  for (const e of ["technology", "post"] as const) {
    for (const k of KINDS) {
      const c = signalCollectability(e, k);
      assertFalse(c.collectible, `${k}/${e} claims to be collectible`);
      // THE REASON IS THE LAST LINK, not a missing capability. Both have a
      // driven-or-drivable capability; neither has a canonical type to become.
      assert(
        /no canonical signal type exists/.test(c.reason),
        `${k}/${e}: ${c.reason}`,
      );
    }
  }
});

Deno.test("4. a signal no capability could ever prove says exactly that", () => {
  const c = signalCollectability("headcount_change", "tracked_company");
  assertFalse(c.collectible);
  assertEquals(c.scheduled_but_not_driven, []);
  assert(/no capability exists/.test(c.reason), c.reason);
});

// ── 5. THE ANTI-DRIFT GUARANTEE ─────────────────────────────────────────────

Deno.test("5. the verdict matches what the REAL graph and engine would do", () => {
  // This is why the module holds no table of its own. A table would be a second
  // copy of the routing rules and would disagree with the first one the day
  // either changed — which is how `known_company_resolution` sat in the graph,
  // carded and unrunnable, for the whole of Phase 3.
  //
  // Here the expectation is recomputed independently, from the graph the engine
  // would actually execute.
  for (const k of KINDS) {
    for (const e of EVENTS) {
      const verdict = signalCollectability(e, k);

      const compiled = compileMonitoringMission({
        workspace_id: "probe",
        subjects: [{
          kind: k, identifier: k === "icp" ? null : "probe.example", label: "probe",
          signals: [{ event: e as never, subject: "company" as never }],
          timeframe_days: 90,
        }],
        icp: k === "icp"
          ? { verticals: ["b2b saas"], business_models: ["saas"], locations: ["United States"], stages: ["seed"] }
          : null,
      });
      assert(compiled.ok && compiled.mission, `probe failed to compile for ${k}/${e}`);

      const scheduled = buildCapabilityGraph(compiled.mission! as never).steps
        .map((s) => String(s.capability));
      const expected = provingCapabilities({ event: e, subject: "company" } as never)
        .filter((c) => scheduled.includes(c))
        .some((c) => isEngineDriven(c as never));

      assertEquals(
        verdict.collectible, expected,
        `${k}/${e}: the module says ${verdict.collectible}, the graph says ${expected}`,
      );
    }
  }
});

// ── 6–8. NOTHING UNCOLLECTIBLE REACHES A PLAN ───────────────────────────────

Deno.test("6. an uncollectible signal is dropped before anything can be spent", () => {
  const f = filterCollectableSignals(
    [{ event: "hiring" }, { event: "funding" }, { event: "technology" }],
    "tracked_company",
  );
  assertEquals(f.kept.map((s) => s.event), ["hiring"]);
  assertEquals(f.dropped.map((d) => d.event), ["funding", "technology"]);
  for (const d of f.dropped) assert(d.reason.length > 20, `${d.event} needs a real reason`);
});

Deno.test("7. the same signal survives for a subject kind that can collect it", () => {
  assertEquals(
    filterCollectableSignals([{ event: "funding" }], "icp").kept.map((s) => s.event),
    ["funding"],
  );
  assertEquals(filterCollectableSignals([{ event: "funding" }], "competitor").kept, []);
});

Deno.test("8. the filter preserves the signal's own shape, not just its event", () => {
  // The subject and timeframe travel with the signal into the mission; a filter
  // that rebuilt them would quietly drop whatever it did not know about.
  const original = { event: "hiring", subject: "company", extra: "kept" };
  const f = filterCollectableSignals([original], "icp");
  assertEquals(f.kept[0], original);
});


// ── 9. THE CHAIN IS CHECKED END TO END, NOT AT ITS FIRST LINK ───────────────

Deno.test("9. a capability that runs but has nowhere to file its finding is refused", () => {
  // The failure this closes: `company_post_verification` could be driven
  // tomorrow, and `post` would then report "collectible" while the monitoring
  // runner reached `if (!canon) continue` and wrote silence. Collectability
  // must mean the WHOLE chain, and the cheapest link is checked first.
  for (const e of ["technology", "post"] as const) {
    const c = signalCollectability(e, "icp");
    assertFalse(c.collectible);
    assert(/never become a signal_event/.test(c.reason), c.reason);
    // And it does NOT blame a capability, because a capability is not what is
    // missing — saying so would send someone to fix the wrong thing.
    assertEquals(c.scheduled_but_not_driven, []);
  }

  // Every collectible signal, by contrast, has a canonical type to become.
  for (const e of ["hiring", "funding", "expansion", "product_launch"] as const) {
    const kinds = (["icp", "tracked_company", "competitor"] as const)
      .filter((k) => signalCollectability(e, k).collectible);
    assert(kinds.length > 0, `${e} should be collectible somewhere`);
    assert(CANONICAL_TYPE_FOR[e], `${e} is collectible but has no canonical type`);
  }
});
