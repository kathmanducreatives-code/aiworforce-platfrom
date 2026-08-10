// THE CAPABILITY GRAPH NAMES ACTOR KEYS. NOTHING CHECKED THEY EXIST.
//
// `leadCapabilityGraph.ts` decides which providers a capability may reach, by
// KEY — "apify_yc_companies_memo23", "apify_linkedin_job_search", and so on. Its
// own docblock says provider ids live in `hiringActorCatalog`, and it is
// deliberately import-light: the only thing it imports is `type LeadMissionV1`.
//
// The consequence is that its eleven actor keys were free-standing string
// literals. Nothing — not the compiler, not a test — checked that any of them
// named an actor this system actually has. Renaming a key in a catalog, or
// retiring an actor, would leave the graph pointing at a provider that cannot be
// resolved, and the failure would surface at run time, mid-mission, after the
// planning that selected it had already been paid for.
//
// WHY A TEST AND NOT AN IMPORT. Binding the graph at compile time means giving
// it value imports of two registries it currently does not depend on at all.
// That decoupling is deliberate — the module is pure, and its purity is what
// lets every consumer import it without pulling the provider layer in behind it.
// A test-time assertion buys the same guarantee (the suite is the gate) at no
// coupling cost, so the binding lives here.
//
// This asserts against the real exported VALUES, not source text, so a key that
// stops existing fails immediately rather than when someone reformats a file.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ALL_GRAPH_PROVIDERS, BROAD_JOB_PROVIDERS, CAPABILITY_IDS, CAPABILITY_REGISTRY,
} from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { ACTOR_REGISTRY } from "../../../supabase/functions/_shared/actorRegistry.ts";
import { HIRING_ACTOR_CATALOG } from "../../../supabase/functions/_shared/hiringActorCatalog.ts";

/**
 * The canonical key space.
 *
 * Deliberately the UNION of both catalogs, because neither alone covers the
 * graph: `apify_yc_companies_memo23` and `apify_linkedin_job_search` are known
 * only to the hiring catalog, while `apify_jobs` and `apify_glassdoor_jobs` are
 * known only to the actor registry. Asserting against either one alone would
 * fail on keys that are perfectly valid.
 */
const CANONICAL_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(ACTOR_REGISTRY),
  ...Object.keys(HIRING_ACTOR_CATALOG),
]);

Deno.test("every actor key the capability graph can reach exists in a canonical catalog", () => {
  assert(CANONICAL_KEYS.size > 0, "the catalogs must have loaded");
  assert(ALL_GRAPH_PROVIDERS.size > 0, "the graph must name at least one provider");

  const unknown = [...ALL_GRAPH_PROVIDERS].filter((k) => !CANONICAL_KEYS.has(k)).sort();
  assertEquals(
    unknown, [],
    `leadCapabilityGraph names actor key(s) no catalog defines: ${unknown.join(", ")}. ` +
    `A capability that selects an unresolvable provider fails mid-mission, after ` +
    `planning has already committed to it. Add the actor to ACTOR_REGISTRY or ` +
    `HIRING_ACTOR_CATALOG, or correct the key in the graph.`,
  );
});

Deno.test("each capability's own provider list is catalog-backed, named per capability", () => {
  // Same guarantee as above, reported per capability so a failure says WHICH
  // capability would break rather than only which key is missing.
  for (const id of CAPABILITY_IDS) {
    const providers = CAPABILITY_REGISTRY[id].providers;
    for (const key of providers) {
      assert(
        CANONICAL_KEYS.has(key),
        `capability "${id}" lists provider "${key}", which no catalog defines`,
      );
    }
  }
});

Deno.test("the broad-job-board list is stated, reachable, and catalog-backed", () => {
  // BROAD_JOB_PROVIDERS is deliberately a literal rather than derived from
  // job_discovery.providers — deriving it would silently reclassify a targeted
  // company-scoped search as a broad sweep. Being stated, it needs its own
  // check that it has not drifted out of the graph it describes.
  assert(BROAD_JOB_PROVIDERS.length > 0);
  for (const key of BROAD_JOB_PROVIDERS) {
    assert(
      CANONICAL_KEYS.has(key),
      `BROAD_JOB_PROVIDERS names "${key}", which no catalog defines`,
    );
    assert(
      ALL_GRAPH_PROVIDERS.has(key),
      `BROAD_JOB_PROVIDERS names "${key}", but no capability can reach it — ` +
      `the broad-board guard would be describing a provider the graph never selects`,
    );
  }
});

Deno.test("ALL_GRAPH_PROVIDERS stays derived from the capability registry", () => {
  // It is built by flat-mapping CAPABILITY_REGISTRY. If someone converts it to a
  // hand-maintained literal, the containment assertions above start checking a
  // list instead of checking reality — which is exactly the drift this file
  // exists to prevent, one level up.
  const derived = new Set(CAPABILITY_IDS.flatMap((c) => CAPABILITY_REGISTRY[c].providers));
  assertEquals(
    [...ALL_GRAPH_PROVIDERS].sort(), [...derived].sort(),
    "ALL_GRAPH_PROVIDERS must equal the union of every capability's providers",
  );
});
