// LISA · FIXTURE MODE and PLAN EXECUTION (Signals recovery).
//
// FIXTURE MODE exists so a test project (Brain TEST) can exercise the WHOLE pipeline — plan →
// collect → extract → verify → qualify → store → page / ORION / ATLAS handoff — with NO paid
// provider. It is allowed only when BOTH LISA_FIXTURE_MODE=true AND the workspace is listed in
// LISA_FIXTURE_WORKSPACES, so it can never be pointed at a workspace by accident. Its sources are
// synthetic: company names say "Fixture", every host is under `.example.test`, and the stored
// provider is "fixture". The UI labels such rows "Test fixture — not market evidence".
//
// selectLisaSource decides, before anything runs, which source a request may use — and refuses
// (provider_not_configured) instead of running a scan that cannot collect anything and would
// otherwise read as an empty success.
import type { SharedBrainContext } from "../companyBrainContextLoader.ts";
import { firecrawlSource } from "./providers.ts";
import { fixtureSource } from "./providers.ts";
import { planQueries } from "./collectors.ts";
import { collectContext } from "./pipeline.ts";
import { canonicalDomain } from "../brainMemoryModel.ts";
import { LISA_CATEGORIES, type LisaCategory, type SearchResult, type SearchSource, type WatchSubject } from "./types.ts";

export const FIXTURE_PROVIDER = "fixture";

export type SourceChoice =
  | { ok: true; mode: "provider" | "fixture"; source: (watch: WatchSubject, brain: SharedBrainContext | null, now: Date) => SearchSource }
  | { ok: false; reason: "provider_not_configured"; detail: string };

export function fixtureModeAllowed(env: (k: string) => string | undefined, workspaceId: string): boolean {
  if (env("LISA_FIXTURE_MODE") !== "true") return false;
  const list = String(env("LISA_FIXTURE_WORKSPACES") ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return list.includes(workspaceId.toLowerCase());
}

export function selectLisaSource(env: (k: string) => string | undefined, workspaceId: string, injected?: SearchSource): SourceChoice {
  if (injected) return { ok: true, mode: injected.provider === FIXTURE_PROVIDER ? "fixture" : "provider", source: () => injected };
  if (fixtureModeAllowed(env, workspaceId)) {
    return { ok: true, mode: "fixture", source: (w, b, now) => syntheticFixtureSource(w, b, now) };
  }
  const key = env("FIRECRAWL_API_KEY");
  if (key && key.trim()) return { ok: true, mode: "provider", source: () => firecrawlSource(key) };
  return { ok: false, reason: "provider_not_configured",
    detail: "No signal provider is configured on this project (and fixture mode is not enabled for this workspace). Nothing was run and nothing was charged." };
}

const day = (now: Date, minus: number) => new Date(now.getTime() - minus * 86_400_000).toISOString().slice(0, 10);

/** Synthetic, clearly-marked responses for the FIRST planned query of each category. */
export function syntheticFixtureSource(watch: WatchSubject, brain: SharedBrainContext | null, now: Date): SearchSource {
  const ctx = collectContext(brain, now, watch);
  const geo = ctx.geographies[0] ?? "Ohio";
  const industry = (ctx.industries[0] ?? "Manufacturing").toLowerCase();
  const who = watch.kind === "market" ? "Kestrel Fixture Fabrication" : `${watch.name} Fixture`;
  const host = watch.kind === "market" ? "kestrel-fixture.example.test" : `${(watch.domain ?? "company").replace(/\.[a-z]+$/, "")}.example.test`;
  const responses: Partial<Record<LisaCategory, SearchResult>> = {
    expansion: { error: null, credits: 0, hits: [
      { url: `https://business-journal.example.test/${host}/plant`, title: `${who} opens new ${industry} plant in ${geo}`,
        description: `${who} opens new ${industry} plant in ${geo}, adding 120 jobs. [TEST FIXTURE]`, published_at: day(now, 3) },
      { url: `https://trade-news.example.test/${host}/expansion`, title: `${who} opens ${industry} plant in ${geo}`,
        description: `${who} opens a new ${industry} plant in ${geo}. [TEST FIXTURE]`, published_at: day(now, 3) },
      { url: `https://${host}/press/new-plant`, title: `${who} opens new ${industry} plant in ${geo}`,
        description: `${who} opens its new ${industry} plant in ${geo}. [TEST FIXTURE]`, published_at: day(now, 4) },
    ] },
    hiring: { error: null, credits: 0, hits: [
      { url: `https://jobs.example.test/${host}/account-executive`, title: `${who} is hiring an Account Executive in ${geo}`,
        description: `${who} is hiring an Account Executive to grow regional sales in ${geo}. [TEST FIXTURE]`, published_at: day(now, 2) },
    ] },
  };
  const first = new Map<string, LisaCategory>();
  for (const p of planQueries(watch, ctx)) if (![...first.values()].includes(p.category)) first.set(p.query, p.category);
  return fixtureSource((query) => {
    const cat = first.get(query);
    return (cat && responses[cat]) ? responses[cat]! : { hits: [], error: null, credits: 0 };
  }, FIXTURE_PROVIDER);
}

/** A monitoring plan row as LISA executes it. */
export interface PlanRow {
  id: string; workspace_id: string; kind: "company" | "icp"; status: string; title: string;
  target: Record<string, unknown>; signal_categories: string[];
}
/** The plan as a LISA watch; categories LISA does not collect yet are returned, never dropped silently. */
export function watchFromPlan(plan: PlanRow): { ok: true; watch: WatchSubject; not_collected: string[] } | { ok: false; reason: string } {
  const categories = LISA_CATEGORIES.filter((c) => plan.signal_categories.includes(c));
  const not_collected = plan.signal_categories.filter((c) => !(LISA_CATEGORIES as readonly string[]).includes(c));
  if (!categories.length) return { ok: false, reason: `LISA does not collect ${plan.signal_categories.join(", ")} yet` };
  if (plan.kind === "company") {
    const identifier = String(plan.target.identifier ?? "");
    const domain = canonicalDomain(identifier) ?? canonicalDomain(identifier.replace(/^.*linkedin\.com\/company\//i, ""));
    if (!domain) return { ok: false, reason: "the plan's company has no usable domain" };
    return { ok: true, not_collected, watch: { kind: "tracked_company", domain, name: String(plan.target.label ?? domain), origin: "watchlist",
      categories, cadence_minutes: 7 * 24 * 60 } };
  }
  const list = (v: unknown) => Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
  const industries = list(plan.target.industries);
  const geographies = list(plan.target.locations ?? plan.target.geographies);
  return { ok: true, not_collected, watch: { kind: "market", domain: null, name: `ICP: ${industries.slice(0, 2).join(", ") || plan.title}`,
    origin: "icp", categories, cadence_minutes: 7 * 24 * 60, scope: { industries, geographies } } };
}
