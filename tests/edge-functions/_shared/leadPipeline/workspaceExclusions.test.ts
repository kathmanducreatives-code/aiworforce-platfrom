// WORKSPACE EXCLUSIONS (ATLAS V5, 2026-11-28): approved-memory exclusions with their own
// provenance, whole-word matching, de-duplication that keeps every source, conflicts as
// questions, and the legacy path no longer ignoring them.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { exclusionMatches, mergeExclusions, normalizePhrase, phraseMatches } from "../../../../supabase/functions/_shared/exclusionPhrase.ts";
import {
  applyCompanyBrain, resolveWorkspaceExclusions, servableMemoryExclusions, workspaceExclusionsOf, workspaceRulesFingerprint, type MemoryIndustryExclusion,
} from "../../../../supabase/functions/_shared/missionContract/brain.ts";
import { contractFromProposal } from "../../../../supabase/functions/_shared/missionContract/interpret.ts";
import { contractHash } from "../../../../supabase/functions/_shared/missionContract/contract.ts";
import { legacyWorkspaceExclusions } from "../../../../supabase/functions/_shared/leadPipeline/workspaceExclusions.ts";
import { isWorkspaceExclusion, relaxForFlexible } from "../../../../supabase/functions/_shared/leadPipeline/flexibleDiscovery.ts";
import { specFromMission } from "../../../../supabase/functions/_shared/leadPipeline/strategy.ts";

const WS = "40e2512f-09b6-433e-97fe-f9999a1f1897";
const mem = (value: string, id: string, o: Partial<MemoryIndustryExclusion> = {}): MemoryIndustryExclusion =>
  ({ value, memory_id: id, approval_status: "approved", lifecycle_status: "active", scope: "workspace", workspace_id: WS, expires_at: null, ...o });

// ── Matching ────────────────────────────────────────────────────────────────

Deno.test("MATCH: whole words, case-insensitive — no substring false positives", () => {
  assertEquals(phraseMatches("Toilet & bathroom fixtures", "oil"), false, "oil ≠ toilet");
  assertEquals(phraseMatches("Retail", "AI"), false, "ai ≠ retail");
  assertEquals(phraseMatches("Building Maintenance", "AI"), false);
  assertEquals(phraseMatches("AI-powered analytics", "ai"), true, "a two-letter exclusion is no longer ignored");
  assertEquals(phraseMatches("OIL AND GAS", "oil & gas"), true, "& reads as and");
});

Deno.test("MATCH: multiword phrases need every word, in order and adjacent; plurals match singulars", () => {
  assertEquals(phraseMatches("Commercial Real Estate Services", "real estate"), true);
  assertEquals(phraseMatches("Estate planning for real people", "real estate"), false);
  assertEquals(phraseMatches("Staffing agency", "Staffing Agencies"), true);
  assertEquals(exclusionMatches("Staffing and Recruiting", "staffing agencies"), true, "the core of the exclusion (generic head noun dropped)");
  assertEquals(exclusionMatches("Recruiting", "staffing agencies"), false);
  assertEquals(normalizePhrase("  Staffing   Agencies "), "staffing agency");
});

Deno.test("DEDUPE: one entry per phrase, every source and memory id kept", () => {
  const m = mergeExclusions([
    { value: "Crypto", source: "brain_profile" }, { value: "crypto", source: "brain_memory", memoryId: "m2" },
    { value: "CRYPTO", source: "brain_memory", memoryId: "m1" }, { value: "Gambling", source: "brain_memory", memoryId: "m3" },
  ]);
  assertEquals(m.map((x) => [x.value, x.sources, x.memoryIds]), [["Crypto", ["brain_profile", "brain_memory"], ["m1", "m2"]], ["Gambling", ["brain_memory"], ["m3"]]]);
});

// ── Memory authority ────────────────────────────────────────────────────────

Deno.test("MEMORY: only approved, active, workspace-wide, this-workspace, unexpired memory acts — the rest is refused with a reason", () => {
  const now = new Date("2026-11-28T00:00:00Z");
  const r = servableMemoryExclusions([
    mem("crypto", "ok"),
    mem("gambling", "pending", { approval_status: "pending" }),
    mem("tobacco", "rejected", { approval_status: "rejected" }),
    mem("firearms", "stale", { lifecycle_status: "stale" }),
    mem("vaping", "disputed", { lifecycle_status: "disputed" }),
    mem("adult", "lead", { scope: "lead" }),
    mem("mining", "other-ws", { workspace_id: "another" }),
    mem("payday loans", "expired", { expires_at: "2026-11-01T00:00:00Z" }),
  ], { workspaceId: WS, now });
  assertEquals(r.accepted.map((m) => m.memory_id), ["ok"]);
  assertEquals(r.refused.map((x) => x.memory_id), ["pending", "rejected", "stale", "disputed", "lead", "other-ws", "expired"]);
  assert(r.refused.every((x) => x.reason.length > 0));
});

Deno.test("RESOLVE: memory-only exclusion has its own id and policy; profile+memory is applied once with both sources", () => {
  const r = resolveWorkspaceExclusions({ asked: [], requestExcludes: [], workspaceId: WS,
    brain: { excluded_industries_explicit: ["Crypto"], excluded_industries_memory: [mem("crypto", "m1"), mem("Online Gambling", "m2")] } });
  assertEquals(r.apply.map((a) => [a.id, a.policy, a.memoryIds]), [
    ["brain:exclusion:industry:crypto", "company_brain_excluded_industry", ["m1"]],
    ["memory:exclusion:industry:online_gambling", "company_brain_memory_exclusion", ["m2"]],
  ]);
  assertEquals(r.merged, [{ requirementId: "brain:exclusion:industry:crypto", value: "Crypto", sources: ["brain_profile", "brain_memory"], memoryIds: ["m1"] }]);
});

Deno.test("RESOLVE: the request already excluding it adds nothing, but the shared provenance is recorded", () => {
  const r = resolveWorkspaceExclusions({ asked: [], requestExcludes: ["crypto companies"], workspaceId: WS,
    brain: { excluded_industries_memory: [mem("crypto", "m1")] } });
  assertEquals(r.apply.length, 1, "'crypto companies' and 'crypto' are different phrases; core matching is for companies, not identity");
  const same = resolveWorkspaceExclusions({ asked: [], requestExcludes: ["Crypto"], workspaceId: WS, brain: { excluded_industries_memory: [mem("crypto", "m1")] } });
  assertEquals(same.apply, []);
  assertEquals(same.merged, [{ requirementId: null, value: "Crypto", sources: ["request", "brain_memory"], memoryIds: ["m1"] }]);
});

Deno.test("CONFLICT: a request for an industry approved memory excludes is a question — neither side wins silently", () => {
  const r = resolveWorkspaceExclusions({ asked: ["crypto exchanges"], requestExcludes: [], workspaceId: WS, brain: { excluded_industries_memory: [mem("crypto", "m1")] } });
  assertEquals(r.apply, []);
  assertEquals(r.conflicts.length, 1);
  assert(r.conflicts[0].question.includes("approved memory"));
  // Whole words: asking for "retail" does NOT conflict with an "AI" exclusion.
  const ok = resolveWorkspaceExclusions({ asked: ["retail"], requestExcludes: [], workspaceId: WS, brain: { excluded_industries_memory: [mem("AI", "m9")] } });
  assertEquals([ok.conflicts.length, ok.apply.length], [0, 1]);
});

// ── Contract mode ───────────────────────────────────────────────────────────

const Q = "Find 10 US companies hiring Account Executives in the last 14 days.";
const proposal = {
  understanding: { roles: [{ span: "Account Executives", title: "account_executive", family: null, relation: "required" }], role_match: "any",
    places: [{ span: "US", place: "united states", other_place: null, scope: "headquarters", necessity: "required" }], industries: [],
    signals: [{ span: "hiring Account Executives", kind: "hiring", necessity: "required" }], signal_logic: "all", ambiguities: [], unsupported: [] },
  signal_windows: [{ event: "hiring", days: 14, phrase: "in the last 14 days", signal: null }],
  deliverable: { entity: "company", count: 10, count_span: "10", person_roles: [] }, company_size: null, funding_stages: [], forbid_broadening: [],
};

Deno.test("CONTRACT: a memory exclusion is a required, attributed requirement that carries its memory ids; no memory → same hash as before", async () => {
  const base = contractFromProposal(Q, proposal as never).contract;
  const none = applyCompanyBrain(base, { excluded_industries_explicit: ["Crypto"] }, { workspaceId: WS }).contract;
  const before = await contractHash(none);
  const withMem = applyCompanyBrain(base, { excluded_industries_explicit: ["Crypto"], excluded_industries_memory: [mem("Gambling", "m2")] }, { workspaceId: WS });
  const r = withMem.contract.requirements.find((x) => x.id === "memory:exclusion:industry:gambling")!;
  assertEquals([r.necessity, r.origin.source, r.origin.policy, r.origin.memoryIds], ["required", "company_brain_policy", "company_brain_memory_exclusion", ["m2"]]);
  assertEquals(await contractHash(applyCompanyBrain(base, { excluded_industries_explicit: ["Crypto"], excluded_industries_memory: [] }, { workspaceId: WS }).contract), before);
  const refused = applyCompanyBrain(base, { excluded_industries_memory: [mem("Gambling", "p1", { approval_status: "pending" })] }, { workspaceId: WS });
  assertEquals(refused.contract.requirements.some((x) => x.id.startsWith("memory:")), false);
  assertEquals(refused.report.refusedMemory?.[0]?.memory_id, "p1");
});

// ── Legacy path ─────────────────────────────────────────────────────────────

const legacyMission = () => ({
  version: 1, original_user_query: Q, requested_count: 10, entity: "company",
  criteria: [
    { id: "geo", kind: "hard", dimension: "geography", label: "HQ: United States", value: "united states", source: "user_explicit", status: "ok" },
    { id: "ind", kind: "hard", dimension: "industry", label: "Industry: fintech", value: "fintech", source: "user_explicit", status: "ok" },
  ],
});

Deno.test("LEGACY: workspace exclusions (profile + approved memory) become REQUIRED criteria and reach the provider-facing hard list", () => {
  const brain = workspaceExclusionsOf({ industries: ["SaaS"], excluded_industries_explicit: ["Crypto"], excluded_industries_memory: [mem("Online Gambling", "m2")] });
  assertEquals(Object.keys(brain!).sort(), ["excluded_industries_explicit", "excluded_industries_memory"], "only exclusions are signed and replayed");
  const r = legacyWorkspaceExclusions(legacyMission(), brain, { workspaceId: WS });
  assertEquals(r.added, ["brain:exclusion:industry:crypto", "memory:exclusion:industry:online_gambling"]);
  const spec = specFromMission(r.mission as never, { defaultCount: 10 });
  const hard = spec.requirements.hard.filter((h) => h.key === "excluded_company_types").map((h) => [h.criterionId, h.values]);
  assertEquals(hard, [["brain:exclusion:industry:crypto", ["Crypto"]], ["memory:exclusion:industry:online_gambling", ["Online Gambling"]]]);
  assertEquals(spec.requirements.criteria.filter((c) => c.id.includes("exclusion")).every((c) => c.kind === "hard"), true);
});

Deno.test("LEGACY: a conflict is surfaced (the service answers 422 needs_clarification), nothing is added", () => {
  const m = legacyMission();
  const r = legacyWorkspaceExclusions(m, { excluded_industries_memory: [mem("fintech", "m1")] }, { workspaceId: WS });
  assertEquals([r.added, r.resolution.conflicts.length, r.mission === m], [[], 1, true]);
});

Deno.test("LEGACY: no workspace exclusions → the mission is returned untouched (same object)", () => {
  const m = legacyMission();
  assert(legacyWorkspaceExclusions(m, null).mission === m);
  assertEquals(workspaceExclusionsOf({ industries: ["SaaS"] }), null);
});

// ── Flexible never relaxes a workspace exclusion ────────────────────────────

Deno.test("FLEXIBLE: the request's own industry and exclusion relax; a Brain rule and an approved memory stay REQUIRED and are listed as kept", () => {
  const m = legacyMission();
  m.criteria.push({ id: "excl", kind: "hard", dimension: "exclusion", label: "Excluding: consumer", value: { field: "excluded_company_types", value: ["consumer"] } as never, source: "user_explicit", status: "ok" });
  const r = legacyWorkspaceExclusions(m, { excluded_industries_explicit: ["Crypto"], excluded_industries_memory: [mem("Gambling", "m2")] }, { workspaceId: WS });
  const spec = specFromMission(r.mission as never, { defaultCount: 10 });
  const flex = relaxForFlexible(spec, { requested: ["fintech"], related: [], source: "none", model: null, error: null }).spec;
  const kind = Object.fromEntries(flex.requirements.criteria.map((c) => [c.id, c.kind]));
  assertEquals([kind.ind, kind.excl, kind["brain:exclusion:industry:crypto"], kind["memory:exclusion:industry:gambling"]], ["target", "target", "hard", "hard"]);
  assertEquals(flex.flexible?.kept?.map((k) => k.criterionId), ["brain:exclusion:industry:crypto", "memory:exclusion:industry:gambling"]);
  assert(flex.requirements.criteria.filter((c) => c.id.startsWith("memory:")).every(isWorkspaceExclusion));
});

// ── G4: an approval assumes the workspace's rules as they were ──────────────

Deno.test("G4 FINGERPRINT: an approved memory or a changed rule changes it; order, case, pending or other-workspace memory do not", async () => {
  const f = (b: Record<string, unknown> | null) => workspaceRulesFingerprint(b as never, { workspaceId: WS, now: new Date("2026-11-28T00:00:00Z") });
  const base = await f({ excluded_industries_explicit: ["Crypto", "Gambling"], industries: ["SaaS"] });
  assertEquals(await f({ excluded_industries_explicit: ["gambling", "CRYPTO"], industries: ["saas"] }), base, "order and case are not changes");
  assert(await f({ excluded_industries_explicit: ["Crypto", "Gambling"], industries: ["SaaS"], excluded_industries_memory: [mem("tobacco", "m1")] }) !== base, "a newly approved memory is a change");
  assertEquals(await f({ excluded_industries_explicit: ["Crypto", "Gambling"], industries: ["SaaS"], excluded_industries_memory: [mem("tobacco", "m1", { approval_status: "pending" }), mem("x", "m2", { workspace_id: "other" })] }), base,
    "pending and cross-workspace memory act on nothing, so they change nothing");
  assert(await f({ excluded_industries_explicit: ["Crypto"], industries: ["SaaS"] }) !== base, "a removed exclusion is a change");
  assertEquals(await f(null), await f({}), "no Brain and an empty Brain are the same rules");
});
