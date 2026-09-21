// THE SCRAPE ENDPOINT FETCHES WITH OUR CREDENTIAL, SO IT CHOOSES ITS TARGETS.
//
// `firecrawl-scrape` exists so the browser stops holding a Firecrawl key. That
// moves a fetch that used to happen in the visitor's browser into our backend,
// which is the right place for the credential and the wrong place to accept any
// URL at all: an address that only resolves inside our network is not a page
// anyone is asking to read.
//
// PURE.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  allowedScrapeUrl, boundedPrompt, MAX_PROMPT_CHARS,
} from "../../../supabase/functions/_shared/firecrawlRequestGuard.ts";

Deno.test("ordinary public pages are allowed", () => {
  for (const u of [
    "https://example.com",
    "https://www.linkedin.com/jobs/view/123",
    "http://plain-http.example.org/a/b?c=d",
    "  https://agentory.space/pricing  ",
  ]) {
    assert(allowedScrapeUrl(u), u);
  }
  assertEquals(allowedScrapeUrl("https://example.com/x")?.toString(), "https://example.com/x");
});

Deno.test("anything that is not an http(s) page is refused", () => {
  for (const u of [
    "", "   ", "not a url", "example.com", "//example.com",
    "file:///etc/passwd", "data:text/html,<h1>x", "javascript:alert(1)",
    "ftp://example.com", null, undefined, 42, {},
  ]) {
    assertEquals(allowedScrapeUrl(u as unknown), null, String(u));
  }
});

Deno.test("addresses that only mean something inside our network are refused", () => {
  for (const u of [
    "http://localhost:8000", "http://127.0.0.1:54321", "http://127.8.8.8/",
    "http://[::1]:3000", "http://kong.local/x",
    "http://10.0.0.5/admin", "http://192.168.1.1/", "http://172.16.0.9/", "http://172.31.255.1/",
    // The cloud metadata service — the classic credential-theft target.
    "http://169.254.169.254/latest/meta-data/",
    "http://0.0.0.0/", "http://0.1.2.3/",
  ]) {
    assertEquals(allowedScrapeUrl(u), null, u);
  }
  // Neighbouring public ranges are NOT private and must still work.
  for (const u of ["http://172.15.0.1/", "http://172.32.0.1/", "http://11.0.0.1/", "http://193.168.1.1/"]) {
    assert(allowedScrapeUrl(u), u);
  }
});

Deno.test("a prompt is text, and bounded", () => {
  assertEquals(boundedPrompt("  extract the title  "), "extract the title");
  assertEquals(boundedPrompt(""), null);
  assertEquals(boundedPrompt("   "), null);
  assertEquals(boundedPrompt(undefined), null);
  assertEquals(boundedPrompt(123), null);
  assertEquals(boundedPrompt("x".repeat(5000))?.length, MAX_PROMPT_CHARS);
});

Deno.test("the function keeps the credential server side and refuses anonymous callers", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/firecrawl-scrape/index.ts", import.meta.url),
  );
  assert(src.includes('Deno.env.get("FIRECRAWL_API_KEY")'), "the key is read server side");
  assert(/authHeader\?\.startsWith\("Bearer "\)/.test(src), "an unauthenticated caller is refused");
  assert(src.includes("firecrawl_not_configured"), "a missing key is reported, not guessed around");
  // v2, like the rest of the backend.
  assert(src.includes("api.firecrawl.dev/v2"), "the function speaks Firecrawl v2");
  // A provider failure must not become an ok:true with empty data.
  assert(/payload\.success === false[\s\S]{0,200}ok: false/.test(src));
  assert(src.includes("AbortSignal.timeout"), "a hung provider must not hang the request");
});
