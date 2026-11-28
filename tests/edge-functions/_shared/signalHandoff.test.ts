// Canonical signal → recommended actions and → ATLAS handoff (Signals recovery, Phases 3 and 5).
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildSignalAtlasHandoff, evidenceLevel, isVerifiedSignal, recommendedSignalActions, type CanonicalSignalRow } from "../../../supabase/functions/_shared/signalHandoff.ts";
import { signalToAtlasHandoff } from "../../../supabase/functions/_shared/collab/signalToAtlas.ts";
import { handoffError } from "../../../supabase/functions/_shared/collab/contract.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const base = (over: Partial<CanonicalSignalRow> = {}): CanonicalSignalRow => ({
  id: "44444444-4444-4444-8444-444444444444", workspace_id: WS, signal_type: "market_expansion", signal_category: "growth",
  origin: "lisa", subject_type: "company", subject_key: "kestrel.example", occurred_at: "2026-11-20T00:00:00Z", occurred_at_basis: "published",
  observed_at: "2026-11-25T00:00:00Z", verification_status: "self_reported", confidence: "high", provider: "firecrawl",
  source_url: "https://kestrel.example/press/new-plant", lifecycle_status: "active", dedupe_key: "company:kestrel.example:market_expansion:2026-11",
  normalized_value: { lisa: { company: { name: "Kestrel Fabrication", domain: "kestrel.example" }, event_date: "2026-11-20",
    verification: { level: "corroborated" }, relevance: { band: "strong", reasons: ["Manufacturing", "Ohio"] },
    evidence: [{ url: "https://kestrel.example/press/new-plant", excerpt: "opens a new plant in Ohio", source_type: "company_site" }] } },
  ...over,
});

Deno.test("a verified expansion signal becomes a provider-independent ATLAS handoff that executes nothing", () => {
  const r = buildSignalAtlasHandoff(base(), WS, { excluded_industries: ["crypto"] });
  assert(r.ok);
  const h = r.handoff;
  assertEquals(h.company.name, "Kestrel Fabrication");
  assertEquals(h.company.domain_verified, true, "source is the company's own site");
  assertEquals(h.signal.kind, "expansion");
  assertEquals(h.signal.event_date, "2026-11-20");
  assertEquals(h.verification.level, "corroborated");
  assertEquals(h.icp_relevance.band, "strong");
  assertEquals(h.recommended_discovery_action.requires_approval, true);
  assertEquals(h.recommended_discovery_action.mode, "proposal");
  assertFalse(h.guardrails.outreach); assertFalse(h.guardrails.contact_enrichment);
  assertFalse(JSON.stringify(h).includes("firecrawl"), "no provider name leaks into the contract");
});

Deno.test("refusals: other workspace, unverified, AI-inferred, excluded, dismissed", () => {
  assertEquals((buildSignalAtlasHandoff(base(), "99999999-9999-4999-8999-999999999999", null) as { reason: string }).reason, "wrong_workspace");
  const single = base({ normalized_value: { lisa: { company: { name: "K" }, verification: { level: "single_source" } } } });
  assertEquals((buildSignalAtlasHandoff(single, WS, null) as { reason: string }).reason, "not_verified");
  const ai = base({ origin: "ai_inference", verification_status: "unverified", confidence: "high", normalized_value: { company_name: "K" } });
  assertEquals(evidenceLevel(ai), "inferred");
  assertFalse(isVerifiedSignal(ai), "high confidence never makes an AI claim verified");
  assertEquals((buildSignalAtlasHandoff(base(), WS, { excluded_company_names: ["Kestrel Fabrication"] }) as { reason: string }).reason, "excluded");
  assertEquals((buildSignalAtlasHandoff(base({ lifecycle_status: "dismissed" }), WS, null) as { reason: string }).reason, "not_active");
});

Deno.test("a fixture row is marked and yields only a dry-run discovery action", () => {
  const fx = base({ provider: "fixture", source_url: "https://kestrel-fixture.example.test/press/new-plant",
    normalized_value: { lisa: { company: { name: "Kestrel Fixture Fabrication", domain: "kestrel-fixture.example.test" }, verification: { level: "corroborated" } } } });
  const r = buildSignalAtlasHandoff(fx, WS, null);
  assert(r.ok);
  assertEquals(r.handoff.is_fixture, true);
  assertEquals(r.handoff.recommended_discovery_action.mode, "dry_run_only");
  assert(recommendedSignalActions(fx).held.some((x) => x.includes("fixture")));
});

Deno.test("recommended actions: discovery + brief + content for verified; never outreach; held reasons stated", () => {
  const a = recommendedSignalActions(base());
  assertEquals(a.actions.map((x) => x.kind).sort(), ["atlas_discovery", "content_topic", "orion_brief"]);
  assert(a.actions.every((x) => x.executes === false && x.requires_approval === true));
  assertFalse(JSON.stringify(a).toLowerCase().includes("outreach"));
  const comp = recommendedSignalActions(base({ subject_type: "competitor", subject_key: "corvane" }));
  assert(comp.actions.some((x) => x.kind === "competitor_review"));
  assertFalse(comp.actions.some((x) => x.kind === "atlas_discovery"));
  const un = recommendedSignalActions(base({ verification_status: "unverified", normalized_value: { company_name: "K" } }));
  assertEquals(un.actions.length, 0); assert(un.held.some((x) => x.startsWith("not verified")));
  const ex = recommendedSignalActions(base(), { excluded_domains: ["kestrel.example"] });
  assertFalse(ex.actions.some((x) => x.kind === "atlas_discovery"));
});

Deno.test("the ATLAS handoff rides the existing collaboration contract and is idempotent per signal", () => {
  const a = signalToAtlasHandoff(base(), WS, null, "fp1");
  const b = signalToAtlasHandoff(base(), WS, null, "fp2");
  assert(a.ok && b.ok);
  assertEquals(handoffError(a.handoff), null);
  assertEquals(a.handoff.requires_approval, true);
  assertEquals(a.handoff.target_agent, "atlas");
  assertEquals(a.handoff.idempotency_key, b.handoff.idempotency_key, "a rescan or second click proposes the same handoff");
  assert(a.handoff.verification.inferred[0].includes("may fit"), "fit is inferred, not confirmed");
});
