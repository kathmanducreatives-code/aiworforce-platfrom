import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildProviderIndexFromItems, parseScoutCandidates, guardScoutToAria } from "./leadHandoffGuard.ts";
import { Q1_PROVIDER_PEOPLE, Q1_SCOUT_NARRATIVE_NAMES, Q1_INVENTED_NARRATIVE_COUNT } from "./q1PersonReplayFixture.ts";

// The accepted provider index for the five Q1 people.
const providerItems = Q1_PROVIDER_PEOPLE.map((p) => ({
  company: p.company, name: p.full_name, person: p.full_name,
  source_url: p.profile_url, url: p.profile_url,
  person_linkedin_url: p.profile_url,
}));
const index = buildProviderIndexFromItems(providerItems);

// (14) Five normalized provider people become five Aria handoff candidates when
// handed DIRECTLY (the run-agent section-10 path), independent of the LLM list.
Deno.test("five provider people → five direct Aria candidates", () => {
  const directCandidates = Q1_PROVIDER_PEOPLE.map((p) => ({
    name: p.full_name, company: p.company, title: p.title, source_url: p.profile_url,
  }));
  assertEquals(directCandidates.length, 5);
  // Every direct candidate is provider-backed (URL in the index).
  const guard = guardScoutToAria(
    directCandidates.map((c) => ({ company: c.company, person: c.name, source_url: c.source_url, evidence_url: null })),
    index,
  );
  assertEquals(guard.verified.length, 5);
  assertEquals(guard.rejected.length, 0);
});

// (16) Only provider-index identities reach Aria. (15) The LLM narrative pool
// cannot inject invented identities — reproduces the audit's 1/9 handoff.
Deno.test("LLM narrative pool: only provider-backed reach Aria, 9 invented rejected", () => {
  // Reconstruct the 10-candidate narrative: #1 is the real Jeff Esposito (with the
  // provider URL); the other 9 are invented (no provider URL / not in index).
  const narrative = {
    candidates: Q1_SCOUT_NARRATIVE_NAMES.map((name, i) =>
      i === 0
        ? { name, company: "VeraAI Technologies Inc.", source_url: Q1_PROVIDER_PEOPLE[0].profile_url }
        : { name, company: `${name} Co`, source_url: `https://www.linkedin.com/in/invented-${i}` },
    ),
  };
  const guard = guardScoutToAria(parseScoutCandidates(JSON.stringify(narrative), null), index);
  assertEquals(guard.verified.length, 1);
  assertEquals(guard.rejected.length, Q1_INVENTED_NARRATIVE_COUNT); // 9 invented
  // The direct-pool path (test above) recovers all 5 — proving the narrative pool
  // must NOT be the gate that shrinks a sourced pool of 5 down to 1.
  assert(guard.verified.length < 5, "narrative-only handoff under-lists provider people");
});
