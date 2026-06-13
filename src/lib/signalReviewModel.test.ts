import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeSignalRow } from "./signalFeedModel.ts";
import {
  mergeReviewState,
  buildReviewUpsert,
  buildBulkCommand,
  signalSummaryLine,
  matchesReviewFilter,
  isDefaultVisible,
  isReviewStatus,
  nextStatusAfterDraft,
  indexReviewsBySignal,
  REVIEW_STATUSES,
} from "./signalReviewModel.ts";

const mkSignal = (over: Record<string, unknown> = {}) =>
  normalizeSignalRow({
    id: (over.id as string) ?? "sig-1",
    signal_type: (over.signal_type as string) ?? "competitor_engagement",
    title: (over.title as string) ?? "Jane — Clay",
    source_url: (over.source_url as string) ?? "https://linkedin.com/posts/x",
    raw: (over.raw as Record<string, unknown>) ?? { competitor_name: "Clay", account_name: "Acme" },
  });

Deno.test("mergeReviewState: default status is new when no review row", () => {
  const s = mergeReviewState(mkSignal());
  assertEquals(s.review_status, "new");
  assertEquals(s.review_note, null);
  assertEquals(s.review_id, null);
});

Deno.test("mergeReviewState: normalizes persisted review state", () => {
  const s = mergeReviewState(mkSignal(), { id: "rev-1", signal_id: "sig-1", status: "saved", note: "  follow up  " });
  assertEquals(s.review_status, "saved");
  assertEquals(s.review_note, "follow up");
  assertEquals(s.review_id, "rev-1");
});

Deno.test("mergeReviewState: unknown status falls back to new", () => {
  const s = mergeReviewState(mkSignal(), { status: "bogus" });
  assertEquals(s.review_status, "new");
});

Deno.test("isReviewStatus guards the enum", () => {
  for (const st of REVIEW_STATUSES) assert(isReviewStatus(st));
  assert(!isReviewStatus("nope"));
  assert(!isReviewStatus(null));
});

Deno.test("buildReviewUpsert: stamps the matching *_at only", () => {
  const now = "2026-06-13T10:00:00.000Z";
  const reviewed = buildReviewUpsert({ workspaceId: "w", userId: "u", signalId: "s", status: "reviewed", now });
  assertEquals(reviewed.reviewed_at, now);
  assertEquals(reviewed.ignored_at, null);
  assertEquals(reviewed.saved_at, null);
  assertEquals(reviewed.status, "reviewed");

  const saved = buildReviewUpsert({ workspaceId: "w", userId: "u", signalId: "s", status: "saved", now });
  assertEquals(saved.saved_at, now);
  assertEquals(saved.reviewed_at, null);

  const ignored = buildReviewUpsert({ workspaceId: "w", userId: "u", signalId: "s", status: "ignored", now });
  assertEquals(ignored.ignored_at, now);

  // note is trimmed to null when blank
  const blank = buildReviewUpsert({ workspaceId: "w", userId: "u", signalId: "s", status: "new", note: "   ", now });
  assertEquals(blank.note, null);
});

Deno.test("matchesReviewFilter: all vs specific", () => {
  assert(matchesReviewFilter("ignored", "all"));
  assert(matchesReviewFilter("new", "new"));
  assert(!matchesReviewFilter("new", "saved"));
  assert(matchesReviewFilter("actioned", "actioned"));
});

Deno.test("isDefaultVisible: new/saved/actioned shown, reviewed/ignored not in default set", () => {
  assert(isDefaultVisible("new"));
  assert(isDefaultVisible("saved"));
  assert(isDefaultVisible("actioned"));
  assert(!isDefaultVisible("ignored"));
});

Deno.test("nextStatusAfterDraft: actioned unless explicit save/ignore", () => {
  assertEquals(nextStatusAfterDraft("new"), "actioned");
  assertEquals(nextStatusAfterDraft("reviewed"), "actioned");
  assertEquals(nextStatusAfterDraft("saved"), "saved");
  assertEquals(nextStatusAfterDraft("ignored"), "ignored");
});

Deno.test("indexReviewsBySignal keys by signal_id and skips null", () => {
  const idx = indexReviewsBySignal([
    { signal_id: "a", status: "saved" },
    { signal_id: null, status: "new" },
    { signal_id: "b", status: "reviewed" },
  ]);
  assertEquals(Object.keys(idx).sort(), ["a", "b"]);
  assertEquals(idx["a"].status, "saved");
});

Deno.test("signalSummaryLine: includes context, numbering, no fabrication", () => {
  const line = signalSummaryLine(mkSignal(), 0);
  assert(line.startsWith("1. "));
  assert(line.includes("Clay"));
  assert(line.includes("Acme"));
  assert(line.includes("Jane — Clay"));
});

Deno.test("buildBulkCommand: rank includes every selected signal", () => {
  const signals = [
    mkSignal({ id: "1", title: "Lead one", raw: { account_name: "Acme" } }),
    mkSignal({ id: "2", title: "Lead two", raw: { account_name: "Globex" } }),
  ];
  const cmd = buildBulkCommand("rank", signals);
  assert(cmd.startsWith("Rank these saved signals"));
  assert(cmd.includes("1. "));
  assert(cmd.includes("2. "));
  assert(cmd.includes("Lead one"));
  assert(cmd.includes("Lead two"));
});

Deno.test("buildBulkCommand: drafting commands are explicitly DRAFT-ONLY", () => {
  const signals = [mkSignal({ id: "1", title: "Lead one" })];

  const comment = buildBulkCommand("draft_comment", signals).toLowerCase();
  assert(comment.includes("do not post"), "comment must say do not post");

  const dm = buildBulkCommand("draft_dm", signals).toLowerCase();
  assert(dm.includes("do not send"), "dm must say do not send");

  const outreach = buildBulkCommand("create_outreach", signals).toLowerCase();
  assert(outreach.includes("do not send"), "outreach must say do not send");

  // No auto-send / auto-post wording anywhere.
  const banned = ["auto-send", "send automatically", "automatically post", "auto-post", "auto-dm"];
  for (const a of ["draft_comment", "draft_dm", "create_outreach", "rank"] as const) {
    const c = buildBulkCommand(a, signals).toLowerCase();
    for (const phrase of banned) {
      assert(!c.includes(phrase), `${a} must not contain "${phrase}"`);
    }
  }
});

Deno.test("buildBulkCommand: empty selection is safe", () => {
  const cmd = buildBulkCommand("rank", []);
  assert(cmd.includes("(no signals selected)"));
});
