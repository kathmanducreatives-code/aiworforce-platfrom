// WHAT OF A FETCHED PAGE IS ACTUALLY EVIDENCE.
//
// PURE. No network, no provider, no model, no database, no clock.
//
// ── THE TWO MEASUREMENTS THIS EXISTS FOR ───────────────────────────────────
//
// Across the 27 pages `company_web_evidence` holds, 127,287 stored characters
// reduce to 65,792 of prose. FORTY-NINE PER CENT of every page bought was
// markdown markup — image embeds, link targets, base64 placeholders, table
// scaffolding. Hebbia's homepage is 6,000 stored characters and 1,338 of text;
// Pump.co's product page, 4,564 and 709. The cap is spent on URLs.
//
// And the pages are not as many pages as they look. Deduplicating blocks that
// appear on more than one page of the same site:
//
//     InEvent   /about  4,109 -> 295 unique;  /pricing and /customers -> 0
//     Metaview  /product 3,021 -> 120 unique
//     Kody      /product   241 ->   0 unique
//
// InEvent serves one document under four URLs. So "four pages of evidence" was
// one page, quoted four times, and any quote from it named four sources and
// therefore none — which `anchorCitation` correctly refuses as
// `ambiguous_excerpt`, leaving a requirement open on evidence that exists.
//
// ── WHAT THIS MODULE MAY AND MAY NOT DECIDE ────────────────────────────────
//
// It decides FORM, never MEANING. It removes markup, removes text a site
// repeats, and bounds what is left. It contains no list of words worth
// keeping, nothing that scores a page for relevance, and nothing that knows
// what any requirement is about. Which sentence answers the Mission is the
// model's judgement, made on evidence this module has only made legible.
//
// Every character it emits is still VERBATIM from the page, in original order,
// so `containsExcerpt` keeps working and a citation stays checkable.

/** Per page, after selection. The store's own cap, spent on prose instead. */
export const MAX_PAGE_PROSE = 6000;

/**
 * Per company, across every page shown at once.
 *
 * A bound the code owns, so a site with forty fetched pages cannot crowd out
 * the rest of the payload. It binds rarely — the largest company in the store
 * selects to about 9,000 characters — and when it binds it takes from the
 * pages that contribute least, not from whichever happened to be last.
 */
export const MAX_COMPANY_PROSE = 24_000;

/**
 * A page as this module handles one. Structural, so both the store and the
 * re-evaluator satisfy it without either importing the other.
 */
export interface SelectablePage {
  source_url: string;
  page_intent: string;
  source_text: string;
}

/**
 * Markup out, prose in original order.
 *
 * IDEMPOTENT, which is what lets it run at the write boundary for pages bought
 * from now on AND at the read boundary for the rows already stored, without
 * the two compounding.
 *
 * An image keeps its alt text and loses its URL: `![Reports UI preview](https:
 * //…&w=3840&q=75)` is 180 characters of which 18 are readable. A link keeps
 * its anchor text for the same reason. Nothing is reordered and nothing is
 * summarised, so any sentence a model quotes is still a substring of what the
 * site published.
 */
export function pageProse(markdown: string): string {
  return String(markdown ?? "")
    // Images and links: keep what a person reads, drop what a browser follows.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => alt)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, (_m, text: string) => text)
    // Firecrawl's own placeholder for an image it declined to inline.
    .replace(/<Base64-Image-Removed>/g, "")
    // Markdown's hard-break backslashes, which arrive in runs on card layouts.
    .replace(/\\+\n/g, "\n")
    .replace(/\\{2,}/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    // Lines that are only table rules, bullets or fence characters.
    .replace(/^[ \t]*[-*|`_=+~ \t]*[ \t]*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Blocks are what a site repeats: paragraphs, headings, cards. */
function blocksOf(text: string): string[] {
  return text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
}

/** Whitespace- and case-insensitive identity, so two renderings are one block. */
function blockKey(block: string): string {
  return block.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Is this the site's front page?
 *
 * ── WHY THE HOMEPAGE LOSES A TIE ───────────────────────────────────────────
 *
 * A block on two pages has to be kept on one of them, and which one decides
 * what `page_intent` a reviewer sees on the receipt. Every site repeats its
 * positioning on its front page; the specific page is where a fact lives. So
 * pricing copy shared between `/pricing` and `/` stays on `/pricing`.
 *
 * A structural property of websites, not a claim about any industry.
 */
function isHomepage(p: SelectablePage): boolean {
  if (p.page_intent === "homepage") return true;
  try {
    const path = new URL(p.source_url).pathname.replace(/\/+$/, "");
    return path === "";
  } catch {
    return false;
  }
}

export interface PageSelection<T extends SelectablePage> {
  /** The pages worth showing, with `source_text` replaced by what was kept. */
  pages: T[];
  /** Pages that contributed nothing another page did not already carry. */
  dropped: Array<{ source_url: string; reason: "no_unique_content" | "empty" }>;
  /** Characters in, characters out. For one line of observability. */
  chars_in: number;
  chars_out: number;
  /** Blocks removed because another page of this site already carried them. */
  duplicate_blocks: number;
}

/**
 * Select what to show for ONE company: strip, deduplicate, bound.
 *
 * The pages must all belong to the same company — this is where sibling
 * duplication is visible and nowhere else. Order in, order out, minus what was
 * dropped.
 */
export function selectCompanyPages<T extends SelectablePage>(
  input: readonly T[],
): PageSelection<T> {
  const chars_in = input.reduce((n, p) => n + (p.source_text ?? "").length, 0);
  const dropped: PageSelection<T>["dropped"] = [];

  const prose = new Map<string, string[]>();
  for (const p of input) prose.set(p.source_url, blocksOf(pageProse(p.source_text)));

  // How many pages carry each block. Two is already site-wide.
  const carriers = new Map<string, number>();
  for (const blocks of prose.values()) {
    for (const k of new Set(blocks.map(blockKey))) {
      carriers.set(k, (carriers.get(k) ?? 0) + 1);
    }
  }

  // Specific pages claim a shared block before the front page does.
  const claimOrder = [...input].sort((a, b) =>
    (isHomepage(a) ? 1 : 0) - (isHomepage(b) ? 1 : 0) ||
    a.source_url.localeCompare(b.source_url)
  );

  const claimed = new Set<string>();
  const keptFor = new Map<string, string[]>();
  let duplicate_blocks = 0;
  for (const p of claimOrder) {
    const keep: string[] = [];
    for (const block of prose.get(p.source_url) ?? []) {
      const k = blockKey(block);
      if ((carriers.get(k) ?? 0) > 1) {
        if (claimed.has(k)) { duplicate_blocks++; continue; }
        claimed.add(k);
      }
      keep.push(block);
    }
    keptFor.set(p.source_url, keep);
  }

  // ── THE COMPANY BUDGET ────────────────────────────────────────────────
  //
  // Taken from the LONGEST page first, repeatedly, so a bound is met by
  // trimming the page that can best afford it rather than by dropping whole
  // pages off the end of a list.
  const text = new Map<string, string>();
  for (const [url, keep] of keptFor) {
    text.set(url, keep.join("\n\n").slice(0, MAX_PAGE_PROSE));
  }
  let total = [...text.values()].reduce((n, t) => n + t.length, 0);
  while (total > MAX_COMPANY_PROSE) {
    let longest = "";
    for (const [url, t] of text) {
      if (t.length > (text.get(longest)?.length ?? 0)) longest = url;
    }
    const t = text.get(longest)!;
    const over = total - MAX_COMPANY_PROSE;
    const cut = Math.min(over, Math.max(1, Math.floor(t.length / 4)));
    text.set(longest, t.slice(0, t.length - cut));
    total -= cut;
  }

  const pages: T[] = [];
  for (const p of input) {
    const t = (text.get(p.source_url) ?? "").trim();
    if (t.length === 0) {
      // A page carrying nothing another page does not already carry is not a
      // second source. Shown, it is an empty item a citation could name.
      dropped.push({
        source_url: p.source_url,
        reason: (p.source_text ?? "").trim() ? "no_unique_content" : "empty",
      });
      continue;
    }
    pages.push({ ...p, source_text: t });
  }

  return {
    pages, dropped, duplicate_blocks,
    chars_in,
    chars_out: pages.reduce((n, p) => n + p.source_text.length, 0),
  };
}
