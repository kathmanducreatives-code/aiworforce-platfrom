// LISA V2 — COLLECTORS: what to ask a search provider, per category.
//
// A collector turns one watched subject into a small, bounded set of search
// queries. It never parses results (extract.ts does) and never calls a
// provider (the orchestrator does, through an injected SearchSource), so the
// whole collection plan is a pure function that can be inspected and costed
// before a single credit is spent.
//
// FOUR CATEGORIES ARE IMPLEMENTED: hiring, funding, expansion, product_launch.
//
// EXTENSION POINTS — declared, NOT implemented. pricing, website changes,
// acquisitions, partnerships, leadership changes and technology adoption each
// have a registry entry with `status: "not_implemented"`. `collectorFor()`
// returns null for them, the orchestrator counts them as `unsupported`, and no
// query is ever sent. Nothing claims they work.
//
// PURE.

import type { LisaCategory, WatchSubject } from "./types.ts";

export const EXTENSION_CATEGORIES = [
  "pricing", "website_change", "acquisition", "partnership", "leadership_change", "technology",
] as const;
export type ExtensionCategory = typeof EXTENSION_CATEGORIES[number];

export interface Collector {
  category: LisaCategory;
  status: "implemented";
  /** Queries for one subject. Bounded: at most `MAX_QUERIES_PER_CATEGORY`. */
  queries(subject: WatchSubject, ctx: CollectContext): string[];
}

export interface ExtensionPoint {
  category: ExtensionCategory;
  status: "not_implemented";
  /** What a real collector would need before it could be enabled. */
  requires: string;
}

export interface CollectContext {
  /** ICP industries from the Company Brain (market watches only). */
  industries: string[];
  /** ICP geographies from the Company Brain. */
  geographies: string[];
  /** Calendar year used to keep searches on recent events. */
  year: number;
}

export const MAX_QUERIES_PER_CATEGORY = 2;

const q = (s: string) => s.replace(/\s+/g, " ").trim();
const named = (s: WatchSubject) => (s.domain ? `"${s.name}" OR ${s.domain}` : `"${s.name}"`);
const firstGeo = (c: CollectContext) => c.geographies.find((g) => g.trim()) ?? "";
const industries = (c: CollectContext) => c.industries.filter((i) => i.trim()).slice(0, 2);

const COLLECTORS: Record<LisaCategory, Collector> = {
  funding: {
    category: "funding", status: "implemented",
    queries: (s, c) => s.kind === "market"
      ? industries(c).map((i) => q(`${i} company raises Series funding round ${c.year}`))
      : [q(`${named(s)} raises funding round ${c.year}`), q(`${named(s)} Series investment announcement`)],
  },
  hiring: {
    category: "hiring", status: "implemented",
    queries: (s, c) => s.kind === "market"
      ? industries(c).map((i) => q(`${i} company to hire hundreds new jobs ${firstGeo(c)} ${c.year}`))
      : [q(`${named(s)} hiring new jobs expansion ${c.year}`)],
  },
  expansion: {
    category: "expansion", status: "implemented",
    queries: (s, c) => s.kind === "market"
      ? industries(c).map((i) => q(`${i} opens new plant facility ${firstGeo(c)} ${c.year}`))
      : [q(`${named(s)} opens new facility office ${c.year}`)],
  },
  product_launch: {
    category: "product_launch", status: "implemented",
    queries: (s, c) => s.kind === "market"
      ? industries(c).map((i) => q(`${i} company launches new product ${c.year}`))
      : [q(`${named(s)} launches new product announcement ${c.year}`)],
  },
};

export const EXTENSION_POINTS: Record<ExtensionCategory, ExtensionPoint> = {
  pricing: { category: "pricing", status: "not_implemented", requires: "a page-diff source of competitor pricing pages and a price-change extractor" },
  website_change: { category: "website_change", status: "not_implemented", requires: "a scheduled page snapshot store and a material-change classifier" },
  acquisition: { category: "acquisition", status: "not_implemented", requires: "an acquirer/target extractor and an event key (acquirer · target)" },
  partnership: { category: "partnership", status: "not_implemented", requires: "a partner extractor and an event key (subject · partner)" },
  leadership_change: { category: "leadership_change", status: "not_implemented", requires: "a role/person extractor that stores no personal contact data" },
  technology: { category: "technology", status: "not_implemented", requires: "a technographic source with dated adoption evidence" },
};

/** The collector for a category, or null for an extension point / unknown category. */
export function collectorFor(category: string): Collector | null {
  return (COLLECTORS as Record<string, Collector>)[category] ?? null;
}

/** The full, bounded query plan for one subject. Deterministic; de-duplicated. */
export function planQueries(subject: WatchSubject, ctx: CollectContext): Array<{ category: LisaCategory; query: string }> {
  const out: Array<{ category: LisaCategory; query: string }> = [];
  const seen = new Set<string>();
  for (const cat of subject.categories) {
    const c = collectorFor(cat);
    if (!c) continue;
    for (const query of c.queries(subject, ctx).slice(0, MAX_QUERIES_PER_CATEGORY)) {
      if (!query || seen.has(query)) continue;
      seen.add(query);
      out.push({ category: c.category, query });
    }
  }
  return out;
}
