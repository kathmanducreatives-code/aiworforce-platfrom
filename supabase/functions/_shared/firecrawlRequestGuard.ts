// WHAT THE BROWSER IS ALLOWED TO ASK FIRECRAWL TO FETCH.
//
// `firecrawl-scrape` runs with our credential, so the URL it is handed is a
// request made on our behalf by whoever is signed in. Two things follow:
//
//   * only http(s) — `file:`, `data:` and friends are not pages;
//   * never an address that is only meaningful from INSIDE our network.
//     Loopback, RFC-1918 ranges and the 169.254 link-local block (which is
//     where cloud metadata services live) are the classic SSRF targets. The
//     scraper is a third party, so the blast radius is smaller than an
//     in-process fetch — but a credentialled fetcher pointed at internal
//     addresses is a capability nobody asked for, and it costs nothing to
//     refuse.
//
// Pure, and exported on its own so the rules can be tested without starting a
// server.

export function allowedScrapeUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local")) return null;
  if (/^127\./.test(h)) return null;
  if (/^10\./.test(h)) return null;
  if (/^192\.168\./.test(h)) return null;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return null;
  if (/^169\.254\./.test(h)) return null;       // cloud metadata
  if (/^0\./.test(h) || h === "0.0.0.0") return null;
  return u;
}

/** The caller's prompt, bounded. A prompt is text, not a budget. */
export const MAX_PROMPT_CHARS = 1000;
export function boundedPrompt(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, MAX_PROMPT_CHARS) : null;
}
