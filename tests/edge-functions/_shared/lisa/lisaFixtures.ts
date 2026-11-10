// Offline replay of tests/fixtures/lisa/*.json — every company is fictional and
// every provider response is RECORDED: nothing here reaches a network.
import type { SharedBrainContext } from "../../../../supabase/functions/_shared/companyBrainContextLoader.ts";
import { planQueries } from "../../../../supabase/functions/_shared/lisa/collectors.ts";
import { collectContext, runPass, type PassResult, type SignalStore, type StoreOutcome } from "../../../../supabase/functions/_shared/lisa/pipeline.ts";
import { countingBudget, fixtureSource } from "../../../../supabase/functions/_shared/lisa/providers.ts";
import { verify } from "../../../../supabase/functions/_shared/lisa/verify.ts";
import type { LisaSignal, SearchResult, WatchSubject } from "../../../../supabase/functions/_shared/lisa/types.ts";

const DIR = new URL("../../../fixtures/lisa/", import.meta.url);

export interface Fixture {
  name: string; note: string; now: string; subject: WatchSubject;
  responses: Record<string, SearchResult | "hang" | "throw">;
  expect: Record<string, unknown>; budget?: number; store?: "fail";
}

export function loadFixture(name: string): Fixture {
  return JSON.parse(Deno.readTextFileSync(new URL(`${name}.json`, DIR)));
}

export function brainFrom(over: Partial<{ industries: string[]; geography: string[]; goals: string[]; fingerprint: string;
  competitors: Array<{ name: string; domain: string | null; source: string }>; excludeCompanies: string[]; status: "ready" | "missing" }> = {}): SharedBrainContext {
  const b = JSON.parse(Deno.readTextFileSync(new URL("brain.json", DIR)));
  return {
    workspace_id: "ws-fixture", status: over.status ?? "ready", fingerprint: over.fingerprint ?? b.fingerprint, onboarding_completed: true,
    profile: {}, effective_profile: {},
    canonical: { target_customer: { industries: over.industries ?? b.industries, geography: over.geography ?? b.geography,
      business_models: [], company_size: {}, categories: [], maturity_stage: [], segments: [] } },
    goals: (over.goals ?? b.goals).map((text: string) => ({ text, source: "profile" })),
    preferences: [], facts: [], decisions: [],
    exclusions: { companies: over.excludeCompanies ?? b.exclusions.companies, industries: [], geographies: [], keywords: [], items: [] },
    competitors: over.competitors ?? b.competitors, retracted_competitors: [], needs_review: [], pending_proposals: 0,
    recent_changes: [], applied: [], warnings: [],
  } as unknown as SharedBrainContext;
}

/** An in-memory store with the database's dedupe + recount semantics (the DB contract test pins the real one). */
export function memoryStore(fail = false): SignalStore & { events: Map<string, LisaSignal> } {
  const events = new Map<string, LisaSignal>();
  return {
    events,
    record(s: LisaSignal): Promise<StoreOutcome> {
      if (fail) return Promise.resolve({ status: "failed", event_id: null, error: "database_rejected" });
      const prev = events.get(s.dedupe_key);
      if (!prev) { events.set(s.dedupe_key, structuredClone(s)); return Promise.resolve({ status: "new", event_id: s.dedupe_key }); }
      const urls = new Set(prev.evidence.map((e) => e.url));
      const added = s.evidence.filter((e) => !urls.has(e.url));
      prev.evidence.push(...added);
      prev.verification = verify(prev.evidence.map((e) => ({ source_domain: e.domain, source_type: e.source_type, negation: e.negation, attributes: e.attributes, category: prev.category })));
      return Promise.resolve({ status: added.length ? "updated" : "duplicate", event_id: s.dedupe_key });
    },
  };
}

/** Map each planned query to its category's recorded response. */
export function sourceFor(f: Fixture, brain: SharedBrainContext | null) {
  const now = new Date(f.now);
  // The recorded response answers the FIRST query of its category; later queries
  // of that category (and other categories) answer empty, as a real search would.
  const first = new Map<string, string>();
  for (const p of planQueries(f.subject, collectContext(brain, now))) if (!first.has(p.category)) first.set(p.category, p.query);
  return fixtureSource((q) => {
    const cat = [...first.entries()].find(([, query]) => query === q)?.[0];
    const r = cat ? f.responses[cat] : undefined;
    return r ?? { hits: [], error: null, credits: 1 };
  });
}

export async function replay(f: Fixture, opts: { brain?: SharedBrainContext | null; store?: SignalStore; timeout_ms?: number; workspace_id?: string; budget?: number } = {}): Promise<PassResult & { store: SignalStore }> {
  const brain = opts.brain === undefined ? brainFrom() : opts.brain;
  const store = opts.store ?? memoryStore(f.store === "fail");
  const r = await runPass({
    workspace_id: opts.workspace_id ?? "ws-fixture", subject: f.subject, brain, source: sourceFor(f, brain), store,
    budget: countingBudget(opts.budget ?? f.budget ?? 100), now: new Date(f.now), method: "lisa_v2_scheduled", timeout_ms: opts.timeout_ms ?? 50,
  });
  return { ...r, store };
}
