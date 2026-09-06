// HALF OF A FETCHED PAGE IS MARKUP, AND THE SIBLINGS REPEAT EACH OTHER.
//
// ── THE MEASUREMENTS THIS EXISTS FOR ───────────────────────────────────────
//
// Across the 27 pages in `company_web_evidence`, 127,287 stored characters
// carry 65,792 of prose. Hebbia's homepage spends 6,000 stored characters on
// 1,338 of text. And the pages are fewer than they look: InEvent serves one
// document under four URLs, so any quote from it named four sources and
// therefore none — refused as `ambiguous_excerpt`, leaving a requirement open
// on evidence that was sitting in the store.
//
// The regression fixture is the REAL Metaview payload from lineage ab06540f,
// four pages, 23,103 characters, byte-for-byte as `company_web_evidence` holds
// them. Not a hand-built site that behaves the way this module hopes.
//
// ZERO network, ZERO models, ZERO providers, ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  pageProse, selectCompanyPages, MAX_PAGE_PROSE, MAX_COMPANY_PROSE,
} from "../../../supabase/functions/_shared/webEvidenceSelection.ts";
import { buildEvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import {
  parseMissionEvaluationStrict, anchorCitation,
} from "../../../supabase/functions/_shared/missionEvaluation.ts";

const METAVIEW = JSON.parse(
  await Deno.readTextFile(new URL("../../fixtures/metaviewWebEvidence.json", import.meta.url)),
) as {
  company_key: string;
  pages: Array<{ source_url: string; page_intent: string; source_text: string; fetched_at: string }>;
};

const page = (intent: string, body: string, host = "acme.com") => ({
  source_url: `https://${host}/${intent === "homepage" ? "" : intent}`,
  page_intent: intent,
  source_text: body,
  fetched_at: "2026-09-05T10:00:00.000Z",
});

/** The site chrome every page of a real site opens with. */
const CHROME = [
  "[Introducing Screening: talk to every candidate.](https://acme.com/screening)",
  "",
  "![](https://acme.com/_next/image?url=%2F_next%2Fstatic%2Fmedia%2Fhero.webp&w=3840&q=75)",
  "",
  "[Product](https://acme.com/product) [Pricing](https://acme.com/pricing) [Log in](https://my.acme.com)",
].join("\n");

const of = (intent: string, ps: Array<{ page_intent: string; source_text: string }>) =>
  ps.find((p) => p.page_intent === intent);

// ══════════ 1. a nav-heavy page keeps its deeper evidence ═════════════════

Deno.test("1. markup goes, prose stays, in original order", () => {
  const raw = [
    CHROME, "",
    "## Pricing",
    "",
    "![pricing table](https://acme.com/_next/image?url=%2Ftable.png&w=3840&q=75)",
    "",
    "Starter [$100 monthly per user](https://acme.com/pricing#starter), billed annually.",
  ].join("\n");

  const out = pageProse(raw);
  assert(out.includes("$100 monthly per user"), "the fact must survive");
  assert(!out.includes("w=3840"), "the asset URL must not");
  assert(!out.includes("https://acme.com/pricing#starter"), "nor the link target");
  assert(out.includes("Introducing Screening: talk to every candidate."),
    "anchor text is what a person reads, so it stays");
  assert(out.length < raw.length / 2, "half of a page like this is markup");

  // IDEMPOTENT — it runs at the write boundary and again at the read boundary.
  assertEquals(pageProse(out), out);
});

Deno.test("1b. the real Metaview pages are half markup", () => {
  const before = METAVIEW.pages.reduce((n, p) => n + p.source_text.length, 0);
  const after = METAVIEW.pages.reduce((n, p) => n + pageProse(p.source_text).length, 0);
  assertEquals(before, 23103, "the fixture is the payload the run actually held");
  assert(after < before * 0.65, `prose is ${after} of ${before} stored characters`);
  // And the evidence that carried this company in b1348724 is still there.
  const pricing = METAVIEW.pages.find((p) => p.page_intent === "pricing")!;
  assert(pageProse(pricing.source_text).includes("monthly per user"));
});

// ══════════ 2. siblings that repeat each other ════════════════════════════

Deno.test("2. shared blocks are kept ONCE, on the more specific page", () => {
  const SHARED = "Acme is the workflow platform for modern operations teams.";
  const sel = selectCompanyPages([
    page("homepage", `${CHROME}\n\n${SHARED}\n\nGet started today.`),
    page("product", `${CHROME}\n\n${SHARED}\n\nBuilt for operations at scale.`),
  ]);

  const home = of("homepage", sel.pages)!;
  const product = of("product", sel.pages)!;
  assert(product.source_text.includes(SHARED),
    "the specific page keeps what the front page merely repeats");
  assert(!home.source_text.includes(SHARED), "and the front page loses the tie");
  assert(home.source_text.includes("Get started today."), "its own content stays");
  assert(sel.duplicate_blocks > 0);

  // WHICH IS THE POINT: the quote now names exactly one page.
  const reg = buildEvidenceRegistry({
    evidence: {
      version: "company-evidence-v1", company_key: "acme.com", company_name: "Acme",
      domain: "acme.com", linkedin_company_url: null, identity_state: "resolved",
      geography_evidence: null, employee_evidence: null, industry_evidence: [],
      description: null, source_query: null,
      source_capability: "general_company_discovery",
      commercial_job_evidence: [], strongest_signal: null, evidence_urls: [],
      missing_fields: [], conflicting_evidence: [],
    } as never,
    web_pages: sel.pages,
  } as never);
  const anyId = reg.items.find((i) => i.evidence_type === "web_page")!.evidence_id;
  assertEquals(anchorCitation(reg, anyId, SHARED).outcome === "ambiguous_excerpt", false,
    "a quote carried by one page is locatable; carried by two it was not");
});

Deno.test("2b. a page carrying nothing of its own is not shown as a source", () => {
  const SAME = "One document, four addresses. Everything about this company.";
  const sel = selectCompanyPages([
    page("homepage", SAME), page("about", SAME),
    page("pricing", SAME), page("customers", SAME),
  ]);
  assertEquals(sel.pages.length, 1, "four URLs, one document");
  assertEquals(sel.dropped.length, 3);
  assert(sel.dropped.every((d) => d.reason === "no_unique_content"));
});

Deno.test("2c. the real Metaview siblings collapse, and pricing survives whole", () => {
  const sel = selectCompanyPages(METAVIEW.pages);
  assertEquals(sel.chars_in, 23103);
  assert(sel.chars_out < 10_000, `selected ${sel.chars_out} of ${sel.chars_in}`);
  const pricing = of("pricing", sel.pages)!;
  assert(pricing.source_text.includes("monthly per user"),
    "the receipt that qualified Metaview in b1348724 must survive selection");
  // /product and / share 4,596 characters of hero copy on the real site.
  assert(sel.duplicate_blocks > 0);
  const home = of("homepage", sel.pages);
  const product = of("product", sel.pages);
  assert(!home || !product ||
    home.source_text.length < 500 || product.source_text.length < 500,
    "one of the two near-identical pages must collapse");
});

// ══════════ 3-5. the requirement families, through the same mechanism ══════

Deno.test("3. pricing evidence survives selection", () => {
  const sel = selectCompanyPages([
    page("homepage", `${CHROME}\n\nWelcome.`),
    page("pricing", `${CHROME}\n\nStarter [$100 monthly per user](https://acme.com/p).\n\nEnterprise plans are quoted for organisations over 500 seats.`),
  ]);
  const p = of("pricing", sel.pages)!;
  assert(p.source_text.includes("$100 monthly per user"));
  assert(p.source_text.includes("over 500 seats"));
});

Deno.test("4. product and customer evidence survives selection", () => {
  const sel = selectCompanyPages([
    page("homepage", `${CHROME}\n\nWelcome.`),
    page("customers", `${CHROME}\n\n![logo](https://acme.com/l.png)\n\nTrusted by finance, legal and procurement teams at Barclays and Linklaters.`),
    page("product", `${CHROME}\n\nThe platform handles approvals, audit trails and SSO.`),
  ]);
  assert(of("customers", sel.pages)!.source_text.includes("Barclays and Linklaters"));
  assert(of("product", sel.pages)!.source_text.includes("approvals, audit trails and SSO"));
});

Deno.test("5. office and location evidence survives selection", () => {
  const sel = selectCompanyPages([
    page("homepage", `${CHROME}\n\nWelcome.`),
    page("contact", `${CHROME}\n\nOur London office is at 30 Finsbury Square, London EC2A 1AG, United Kingdom.`),
  ]);
  assert(of("contact", sel.pages)!.source_text.includes("30 Finsbury Square, London EC2A 1AG"));
});

// ══════════ 6-7. selection does not manufacture evidence ══════════════════

Deno.test("6. a page of generic prose stays generic", () => {
  const sel = selectCompanyPages([
    page("about", `${CHROME}\n\nWe are building the future of work. Join us on the journey.`),
  ]);
  const t = of("about", sel.pages)!.source_text;
  assertEquals(t.includes("future of work"), true);
  assert(!/saas|subscription|per user|b2b/i.test(t),
    "selection adds nothing; a vague page is still vague");
});

Deno.test("7. contradicting text is never removed as noise", () => {
  const sel = selectCompanyPages([
    page("homepage", `${CHROME}\n\nAcme is a free consumer app for individuals.`),
    page("product", `${CHROME}\n\nWe do not sell to businesses.`),
  ]);
  assert(of("homepage", sel.pages)!.source_text.includes("free consumer app for individuals"));
  assert(of("product", sel.pages)!.source_text.includes("We do not sell to businesses"),
    "a selector that dropped inconvenient sentences would be inventing a verdict");
});

// ══════════ 8. the quote still maps to the right page ═════════════════════

Deno.test("8. an exact quote still validates against its own page", () => {
  const sel = selectCompanyPages(METAVIEW.pages);
  const reg = buildEvidenceRegistry({
    evidence: {
      version: "company-evidence-v1", company_key: METAVIEW.company_key,
      company_name: "Metaview", domain: "metaview.ai", linkedin_company_url: null,
      identity_state: "resolved", geography_evidence: null, employee_evidence: null,
      industry_evidence: [], description: null, source_query: null,
      source_capability: "general_company_discovery", commercial_job_evidence: [],
      strongest_signal: null, evidence_urls: [], missing_fields: [],
      conflicting_evidence: [],
    } as never,
    web_pages: sel.pages,
  } as never);

  const pricing = reg.items.find((i) => i.metadata?.page_intent === "pricing")!;
  const quote = "monthly per user";
  const p = parseMissionEvaluationStrict({
    mission_fit: "pass", icp_fit: "strong", hiring_fit: "verified",
    confidence: 0.9, match_score: 90,
    matched_requirements: [{
      requirement: "Product is sold on a recurring subscription",
      evidence_id: pricing.evidence_id, excerpt: quote, support: "verified",
    }],
    failed_requirements: [], reasoning: "", rejection_reasons: [],
    evidence_quality: "strong", unknown_fields: [], next_action: null,
  }, reg);

  assertEquals(p.raw_shape.dropped_citations, []);
  assertEquals(p.evaluation.matched_requirements[0].evidence_id, pricing.evidence_id,
    "the receipt names the page a reviewer will open");
  assertEquals(p.evaluation.decision, "qualified");
});

// ══════════ bounds the code owns ══════════════════════════════════════════

Deno.test("size limits are enforced, and taken from the page that can afford it", () => {
  // Unique per page, or the deduplicator would collapse them and the bound
  // would never be the thing under test.
  const long = (tag: string, n: number) =>
    Array.from({ length: n }, (_, i) => `${tag} paragraph ${i}, its own sentence.`)
      .join("\n\n");
  const sel = selectCompanyPages(
    ["homepage", "pricing", "product", "customers", "about", "careers"]
      .map((intent) => page(intent, long(intent, 200))),
  );
  for (const p of sel.pages) {
    assert(p.source_text.length <= MAX_PAGE_PROSE, "per page");
  }
  assert(sel.chars_out <= MAX_COMPANY_PROSE, "and per company");
  assertEquals(sel.pages.length, 6, "a bound trims pages, it does not delete them");
});
