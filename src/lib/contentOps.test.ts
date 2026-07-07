import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deriveContentBrief,
  contentOpportunityFromSignal,
  deriveDraftStatus,
  DRAFT_STATUS_LABELS,
  hasAutoPostLanguage,
  type ContentBriefSignal,
} from "./contentOps.ts";

const sig = (o: Partial<ContentBriefSignal>): ContentBriefSignal => ({
  title: "Cekura raises $2.4M seed", signal_type: "funding", score: 80, company: "Cekura", source_url: "https://news.test/cekura", ...o,
});

Deno.test("content brief is empty & honest with no signals", () => {
  const b = deriveContentBrief([], 0);
  assert(b.isEmpty);
  assertEquals(b.sourceSignal, null);
  assertEquals(b.nextAction, null);
});

Deno.test("content brief points at the highest-scored signal", () => {
  const b = deriveContentBrief([sig({ score: 40, title: "low" }), sig({ score: 92, title: "high", company: "Cekura" })], 2);
  assertEquals(b.isEmpty, false);
  assertEquals(b.sourceSignal?.title, "high");
  assert((b.angle ?? "").length > 0);
  assertEquals(b.draftsAwaiting, 2);
});

Deno.test("empty brief still surfaces drafts awaiting review", () => {
  const b = deriveContentBrief([], 3);
  assert(b.isEmpty);
  assert((b.nextAction ?? "").includes("3"));
});

Deno.test("content opportunity links back to the source signal when a URL exists", () => {
  const o = contentOpportunityFromSignal(sig({ source_url: "https://news.test/x" }));
  assertEquals(o.sourceUrl, "https://news.test/x");
  assertEquals(o.company, "Cekura");
  assert(o.angle.length > 0);
});

Deno.test("content opportunity has null source URL when signal has none", () => {
  const o = contentOpportunityFromSignal(sig({ source_url: null }));
  assertEquals(o.sourceUrl, null);
});

Deno.test("draft statuses map correctly and needs_proof wins when proof missing", () => {
  assertEquals(deriveDraftStatus("approved"), "approved");
  assertEquals(deriveDraftStatus("in review"), "needs_review");
  assertEquals(deriveDraftStatus("published"), "manually_posted");
  assertEquals(deriveDraftStatus("draft"), "draft_ready");
  assertEquals(deriveDraftStatus("approved", false), "needs_proof");
});

Deno.test("no draft-queue label or CTA implies automatic posting", () => {
  for (const label of Object.values(DRAFT_STATUS_LABELS)) {
    assert(!hasAutoPostLanguage(label), `auto-post language in "${label}"`);
  }
  assert(!hasAutoPostLanguage(contentOpportunityFromSignal(sig({})).cta));
  // sanity: the guard actually catches offending copy
  assert(hasAutoPostLanguage("this posts automatically"));
});
