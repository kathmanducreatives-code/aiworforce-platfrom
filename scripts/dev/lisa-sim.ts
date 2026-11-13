// LISA SIMULATOR (npm run dev:lisa) — replays the recorded, fictional LISA V2
// fixtures through the real pipeline, offline, and prints what each produced.
//
//   npm run dev:lisa              # every fixture, one line each
//   npm run dev:lisa -- <name>    # one fixture, full signal record(s)
//   npm run dev:lisa -- --demo    # the product demonstration: a verified expansion
//                                 # signal, then the same event under a changed Brain
//
// NO network (fetch is disabled) and NO database: an in-memory store with the
// database's dedupe semantics. Fixtures: tests/fixtures/lisa/*.json.
import { brainFrom, loadFixture, memoryStore, replay } from "../../tests/edge-functions/_shared/lisa/lisaFixtures.ts";
import { toAgentSignal, weeklyDigest, type StoredSignalRow } from "../../supabase/functions/_shared/lisa/weekly.ts";
import type { LisaSignal } from "../../supabase/functions/_shared/lisa/types.ts";

globalThis.fetch = (() => { throw new Error("network disabled in the LISA simulator"); }) as typeof fetch;

const DIR = new URL("../../tests/fixtures/lisa/", import.meta.url);
const names = [...Deno.readDirSync(DIR)].map((e) => e.name).filter((n) => n.endsWith(".json") && n !== "brain.json")
  .map((n) => n.replace(/\.json$/, "")).sort();
const evts = (s: unknown) => [...(s as { events: Map<string, LisaSignal> }).events.values()];
const asRow = (s: LisaSignal, id: string): StoredSignalRow => ({
  id, workspace_id: s.workspace_id, signal_type: s.signal_type, lifecycle_status: s.lifecycle_status,
  verification_status: s.verification.column_status, confidence: s.verification.confidence,
  occurred_at: s.event_date, observed_at: s.discovered_at, source_url: s.source_url, subject_type: s.subject_type, subject_key: s.subject_key,
  normalized_value: { lisa: { category: s.category, company: { name: s.company_name, domain: s.company_domain }, title: s.title,
    description: s.description, event_date: s.event_date, discovered_at: s.discovered_at, event_instance: s.event_instance,
    source_type: s.source_type, watch_origin: s.watch_origin, verification: s.verification, relevance: s.relevance } },
});

const arg = Deno.args[0];
if (arg === "--demo") {
  const f = loadFixture("expansion");
  const r = await replay(f);
  const [s] = evts(r.store);
  const now = new Date(f.now);
  const ev = s.evidence.map((e) => ({ url: e.url, domain: e.domain }));
  const a = toAgentSignal(asRow(s, "demo-1"), brainFrom(), now, ev)!;
  console.log("── A verified expansion signal (fictional) ──");
  console.log(JSON.stringify({
    what_happened: a.what_happened, company: a.company.name, when: a.event_date,
    evidence: a.evidence.map((e) => e.url), verification: `${a.verification} (${a.independent_sources} independent sources)`,
    confidence: a.confidence, relevance: `${a.relevance.score} / ${a.relevance.band}`, why_it_matters: a.why_it_matters,
    why_now: a.why_now, suggested_action: a.suggested_action, brain_influence: a.brain_influence,
  }, null, 2));
  const changed = brainFrom({ fingerprint: "fp-brain-v2", industries: ["Healthcare"], geography: ["Germany"] });
  const b = toAgentSignal(asRow(s, "demo-1"), changed, now, ev)!;
  console.log("\n── The SAME event after the Company Brain's ICP changes to Healthcare / Germany ──");
  console.log(JSON.stringify({ relevance: `${b.relevance.score} / ${b.relevance.band}`, recomputed: b.relevance_recomputed,
    reasons: b.relevance.reasons, why_it_matters: b.why_it_matters }, null, 2));
  const d1 = weeklyDigest("ws-demo", [asRow(s, "demo-1")], brainFrom(), now, () => ev);
  const d2 = weeklyDigest("ws-demo", [asRow(s, "demo-1")], changed, now, () => ev);
  console.log(`\nWeekly top-5 before: ${d1.items.length} item(s); after: ${d2.items.length} item(s) (${JSON.stringify(d2.excluded)})`);
  Deno.exit(0);
}

for (const n of arg ? [arg] : names) {
  const f = loadFixture(n);
  const r = await replay(f, { store: memoryStore(f.store === "fail") });
  const list = evts(r.store);
  const line = list.map((e) => `${e.company_name} · ${e.signal_type}/${e.event_instance} · ${e.verification.level} · ${e.lifecycle_status} · ${e.evidence.length} src · ${e.relevance?.score}/${e.relevance?.band}`).join(" ; ");
  console.log(`${n.padEnd(30)} ${r.status.padEnd(16)} events=${r.counts.events} sent=${r.counts.queries_sent} dropped=${JSON.stringify(r.counts.dropped)}${r.errors.length ? ` errors=${r.errors.length}` : ""}${line ? `\n   ${line}` : ""}`);
  if (arg) console.log(JSON.stringify(list, null, 2));
}
