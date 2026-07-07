import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deriveRadarBrief, type BriefSignal } from "./radarBrief.ts";

const mk = (o: Partial<BriefSignal>): BriefSignal => ({
  signal_type: "hiring", title: "t", score: 50, verified: true, ...o,
});

Deno.test("empty when no verified signals → honest isEmpty", () => {
  const b = deriveRadarBrief([mk({ verified: false })], ["Comments"]);
  assert(b.isEmpty);
  assertEquals(b.usefulCount, 0);
  assertEquals(b.strongestType, null);
  assertEquals(b.missingSources, ["Comments"]);
});

Deno.test("strongest type is the most common verified type", () => {
  const b = deriveRadarBrief([
    mk({ signal_type: "hiring", score: 60 }),
    mk({ signal_type: "hiring", score: 55 }),
    mk({ signal_type: "funding", score: 90 }),
  ]);
  assertEquals(b.usefulCount, 3);
  assertEquals(b.strongestType?.type, "hiring");
  assertEquals(b.strongestType?.count, 2);
});

Deno.test("top action comes from the highest-scored verified signal with an action", () => {
  const b = deriveRadarBrief([
    mk({ title: "Low", score: 30, recommended_action: "do A", company: "Acme" }),
    mk({ title: "High", score: 88, recommended_action: "Extract lead → Workbench", company: "Cekura" }),
  ]);
  assertEquals(b.topAction?.title, "High");
  assertEquals(b.topAction?.action, "Extract lead → Workbench");
  assertEquals(b.topAction?.company, "Cekura");
});

Deno.test("missing sources are passed through honestly", () => {
  const b = deriveRadarBrief([mk({})], ["Comments", "People"]);
  assertEquals(b.missingSources, ["Comments", "People"]);
  assert(!b.isEmpty);
});
