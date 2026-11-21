// R1.2 · EVIDENCE: signals retrieved (not crowded out), a bounded row-level LISA
// table, relevant evidence only, honest date labels, and follow-up referents
// that name the companies an answer was about. Public digest API; no network.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadOrionEvidenceDigest, type OrionEvidenceDigest } from "../../../../supabase/functions/_shared/orionEvidenceContext.ts";
import { mockDb, NOW, TABLES, USER, WS } from "./orionR12Fixture.ts";

const FX = JSON.parse(await Deno.readTextFile(new URL("../../../fixtures/orion-r12-acceptance.json", import.meta.url)));
const P = (id: string) => FX.findings.find((f: { id: string }) => f.id === id).prompt as string;
const text = (d: OrionEvidenceDigest | null) => {
  const w = (d as unknown as { workspace?: { facts?: Array<{ text: string }> } } | null)?.workspace?.facts ?? [];
  return [...w, ...(d?.facts ?? [])].map((f) => f.text).join("\n");
};
const digest = (message: string, now = NOW) =>
  loadOrionEvidenceDigest(mockDb(TABLES) as never, { workspaceId: WS, userId: USER, message, now });

Deno.test("F3: a signals question gets LISA signals as evidence, never only ATLAS leads", async () => {
  for (const id of ["F3-signals", "F6-under30"]) {
    const d = await digest(P(id));
    assert(d && d.items.length > 0, id);
    assert(d.items.every((i) => i.source_type === "lisa_signal"), `${id}: ${d.items.map((i) => i.source_type)}`);
  }
  // "Distinguish structured signal records from signals mentioned only in lead records" asks for both.
  const both = await digest(P("F3-analyze"));
  assert(both!.items.some((i) => i.source_type === "lisa_signal") && both!.items.some((i) => i.source_type === "lead"));
});

Deno.test("F3: a bounded row-level LISA table lists every stored signal, with unavailable fields named", async () => {
  const t = text(await digest(P("F3-signals")));
  assertStringIncludes(t, "LISA SIGNAL TABLE");
  assertStringIncludes(t, "37 of 37 stored signals");
  for (const n of [1, 21, 37]) assertStringIncludes(t, `[S${n}]`);
  assertFalse(t.includes("[S38]"));
  assertStringIncludes(t, "event date: not recorded");
  assertStringIncludes(t, "source URL: not stored");
  assertStringIncludes(t, "topic (not a company): buyer-intent");
  assertStringIncludes(t, "verification: none recorded");
  assertFalse(t.includes("OTHER WORKSPACE SIGNAL"));
});

Deno.test("F3: the signal table is NOT sent for questions that are not about signals", async () => {
  assertFalse(text(await digest(P("F5-brain-audit"))).includes("LISA SIGNAL TABLE"));
});

Deno.test("F5: Company Brain and own-company content questions get no ATLAS lead evidence", async () => {
  for (const id of ["F5-brain-audit", "F5-content"]) {
    const d = await digest(P(id));
    assertEquals(d?.items.length ?? 0, 0, `${id} attached ${d?.items.map((i) => i.subject).join(", ")}`);
  }
});

Deno.test("F5: pipeline questions still get evidence, and named companies come first", async () => {
  const d = await digest("Compare Hyperbound with our other leads and recommend which to research first.");
  assert(d && d.items.length > 0);
  assertEquals(d.items[0].subject, "Hyperbound");
});

Deno.test("F6: a lead's date is when ATLAS saved it, never an observation date", async () => {
  const t = text(await digest("Which leads look strongest and why?"));
  assertStringIncludes(t, "ATLAS saved this lead on");
  assertStringIncludes(t, "when the hiring was observed is not recorded");
  assertFalse(/ATLAS lead record\)[^\n]*observed 2026/.test(t));
});

Deno.test("F6: a signal without an event date is 'at least N days old', never dated by observation", async () => {
  const t = text(await digest(P("F6-under30")));
  assertStringIncludes(t, "event date not recorded — the event is at least");
  assertStringIncludes(t, "never treat a missing event date as the observation date");
});

Deno.test("F6: ages are calendar days (UTC), not elapsed 24-hour periods", async () => {
  const now = new Date("2026-11-15T00:30:00Z");
  const tables = { ...TABLES, signal_events: [{ ...TABLES.signal_events[5], observed_at: "2026-11-14T23:50:00Z" }] };
  const d = await loadOrionEvidenceDigest(mockDb(tables) as never, { workspaceId: WS, userId: USER, message: P("F3-signals"), now });
  assertStringIncludes(text(d), "observed 2026-11-14, 1 day ago");
});

Deno.test("F4: follow-up referents are the companies the question named, then the [E#] the reply cites", async () => {
  const { presentedSubjectsFor } = await import("../../../../supabase/functions/_shared/orionEvidenceContext.ts");
  const d = await digest("Compare Hyperbound, Laminar, Epsilon3 and Civilgrid using our stored leads.");
  const reply = "Hyperbound leads [E1]. Laminar, Epsilon3 and Civilgrid are accounts only.";
  const names = presentedSubjectsFor(d!, reply).map((x) => x.name);
  assertEquals(names.slice(0, 4), ["Hyperbound", "Laminar", "Epsilon3", "Civilgrid"]);
  // Uncited evidence subjects are not pointable.
  assertEquals(names.length, 4);
});
Deno.test("F4: [E2]–[E4] ranges in a reply make those subjects pointable", async () => {
  const { presentedSubjectsFor } = await import("../../../../supabase/functions/_shared/orionEvidenceContext.ts");
  const d = await digest("Which leads look strongest and why?");
  const names = presentedSubjectsFor(d!, "See [E2]–[E4].").map((x) => x.name);
  assertEquals(names, [...new Set([d!.items[1].subject, d!.items[2].subject, d!.items[3].subject])]);
});

// ── R1.2 redesign: STABLE REFERENTS — the companies a reply actually SHOWED ──
// Live run 3, test 4: the reply before "these companies" discussed companies by
// name without an [E#] citation, so nothing was stored and the follow-up failed
// as no_prior_results. A company the reply names is shown; one it neither
// names nor cites is not.
Deno.test("stable referents: companies the reply NAMES (uncited) are pointable, in reply order, after cited ones", async () => {
  const { presentedSubjectsFor } = await import("../../../../supabase/functions/_shared/orionEvidenceContext.ts");
  const d = await digest("Which leads look strongest and why?");
  const [a, b, c] = [d!.items[0].subject, d!.items[1].subject, d!.items[2].subject];
  const names = presentedSubjectsFor(d!, `Two stand out: ${c} first, then ${a}. Nothing else is current.`).map((x) => x.name);
  assertEquals(names, [c, a]);
  assertFalse(names.includes(b), "an evidence row the reply neither cites nor names is never pointable");
  // Cited first, then named.
  assertEquals(presentedSubjectsFor(d!, `See [E2]. Also ${a}.`).map((x) => x.name), [b, a]);
  // A reply that names nobody stores nothing — the follow-up then states the gap instead of guessing.
  assertEquals(presentedSubjectsFor(d!, "I can't verify any of that from stored records.").length, 0);
});
Deno.test("stable referents are bounded", async () => {
  const { presentedSubjectsFor, PRESENTED_SUBJECTS_MAX } = await import("../../../../supabase/functions/_shared/orionEvidenceContext.ts");
  const d = await digest("Which leads look strongest and why?");
  const many = { ...d!, subjects: Array.from({ length: 60 }, (_, k) => ({ name: `Company${k}x`, domain: null })) };
  const reply = many.subjects.map((s) => s.name).join(", ");
  assertEquals(presentedSubjectsFor(many, reply).length, PRESENTED_SUBJECTS_MAX);
});
