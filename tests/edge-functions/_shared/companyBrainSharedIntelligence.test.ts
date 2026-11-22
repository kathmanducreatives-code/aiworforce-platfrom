// Company Brain V2 · B2.4 — the context id and LISA's one radar rule (pure). Fictional data.
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { brainContextId } from "../../../supabase/functions/_shared/companyBrainContextLoader.ts";
import { agentBrainStamp, lisaRadarPreferences } from "../../../supabase/functions/_shared/companyBrainAgentViews.ts";
import type { SharedBrainContext } from "../../../supabase/functions/_shared/companyBrainContextLoader.ts";

const base = { workspace_id: "w1", brain_updated_at: "2026-11-22T00:00:00Z", onboarding_completed: true, served: ["a@1", "b@2"], excluded: ["c:disputed"] };

Deno.test("B2.4: the context id is versioned, deterministic and order-independent", () => {
  const id = brainContextId(base);
  assert(/^bctx1-[a-p]{16}$/.test(id), id);
  assertEquals(brainContextId({ ...base, served: ["b@2", "a@1"] }), id);
  assertEquals(brainContextId(base), id);
});

Deno.test("B2.4: it changes with anything an agent would be served differently", () => {
  const id = brainContextId(base);
  for (const changed of [
    { ...base, workspace_id: "w2" },
    { ...base, brain_updated_at: "2026-11-22T00:00:01Z" },
    { ...base, onboarding_completed: false },
    { ...base, served: ["a@1", "b@3"] },                 // a new version
    { ...base, served: ["a@1"], excluded: ["c:disputed", "b:stale"] }, // b crossed its review date
  ]) assertNotEquals(brainContextId(changed), id, JSON.stringify(changed));
});

const ctx = (over: Partial<SharedBrainContext> = {}): SharedBrainContext => ({
  workspace_id: "w1", status: "ready", fingerprint: "fp", context_id: "bctx1-0000000000000001", onboarding_completed: true,
  profile: {}, effective_profile: {},
  canonical: { target_customer: { industries: ["Retail"], geography: ["France"] } } as unknown as SharedBrainContext["canonical"],
  goals: [], preferences: [], facts: [], decisions: [],
  exclusions: { industries: ["Gambling"], companies: ["rival.example"], geographies: ["Russia"], keywords: ["crypto"], items: [] } as unknown as SharedBrainContext["exclusions"],
  competitors: [{ name: "FleetBot", domain: "fleetbot.example", source: "memory" }, { name: "Rivalco", domain: null, source: "profile" }],
  retracted_competitors: ["oldco"], needs_review: [], pending_proposals: 0, recent_changes: [], applied: [], warnings: [],
  ...over,
});
const radarBase = { competitors: ["Rivalco", "OldCo"], disqualifiers: ["Agencies"], industries: ["Healthcare"], geographies: ["Portugal"], default_mix: { hiring: 3 } };

Deno.test("B2.4: LISA radar — approved competitors added, retracted removed, exclusions only narrow", () => {
  const p = lisaRadarPreferences(ctx(), radarBase);
  assertEquals(p.competitors, ["Rivalco", "FleetBot"]);
  assertEquals(p.disqualifiers, ["Agencies", "Gambling", "rival.example", "crypto"]);
  assertEquals([p.industries, p.geographies], [["Healthcare"], ["Portugal"]], "no newer ICP preference: the profile's targeting stands");
  assertEquals(p.default_mix, { hiring: 3 }, "everything else is the radar's own");
});

Deno.test("B2.4: LISA radar — a newer ICP preference replaces targeting (the loader's newest-wins rule)", () => {
  const p = lisaRadarPreferences(ctx({ applied: [
    { memory_id: "m1", fact_key: "icp.industries", effect: "target industries" },
    { memory_id: "m2", fact_key: "icp.geography", effect: "target geography" },
  ] }), radarBase);
  assertEquals([p.industries, p.geographies], [["Retail"], ["France"]]);
});

Deno.test("B2.4: the stamp names the agent and the context, or says the Brain was unavailable", () => {
  assertEquals(agentBrainStamp(ctx(), "orion"), { agent: "orion", brain_context_id: "bctx1-0000000000000001", brain_fingerprint: "fp", brain_status: "ready" });
  assertEquals(agentBrainStamp(null, "lyra"), { agent: "lyra", brain_context_id: null, brain_fingerprint: null, brain_status: "unavailable" });
});

Deno.test("B2.4: consumers record the stamp — radar, monitoring, the brief, LYRA drafts, LISA relevance, ORION replies", async () => {
  const read = (p: string) => Deno.readTextFile(new URL(`../../../supabase/functions/${p}`, import.meta.url));
  assert((await read("run-radar-scan/index.ts")).includes("brain: brainStamp,"));
  assert((await read("run-radar-scan/index.ts")).includes("lisaRadarPreferences(shared, prefs)"));
  assert((await read("run-monitoring-scan/index.ts")).includes(`brain: agentBrainStamp(shared, "lisa"),`));
  assert((await read("daily-brief/index.ts")).includes("raw: { ...brief, brain: briefBrain },"));
  assert((await read("run-agent/index.ts")).includes("brain_context_id: lyraBrainContextId,"));
  assert((await read("_shared/lisa/relevance.ts")).includes("brain_context_id: brain?.context_id ?? null"));
  assert(((await read("pilot-chat/index.ts")).match(/brain_context_id: chatBrain\.shared\?\.context_id \?\? null/g) ?? []).length >= 4);
});

Deno.test("B2.4: the id never contains digits beyond its version, so no contact-data guard can mistake it for a phone number", async () => {
  const { containsContactData } = await import("../../../supabase/functions/_shared/lisa/persistence.ts");
  // The bug this pins: a hex id can carry a digit run the guard reads as a phone number,
  // and LISA then refused to store the signal ("sanitization_rejected").
  assertEquals(containsContactData({ relevance: { brain_context_id: "bctx1-8070238491234567" } }), true, "the old hex form could trip the guard");
  for (let i = 0; i < 500; i++) {
    const id = brainContextId({ ...base, brain_updated_at: `2026-11-22T00:00:${String(i % 60).padStart(2, "0")}.${i}Z` });
    assert(/^bctx1-[a-p]{16}$/.test(id), id);
    assertEquals(containsContactData({ relevance: { brain_context_id: id } }), false, id);
  }
});
