// Stage 7 (Option E): the production semantic replay gate.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { replay } from "../../../scripts/dev/production-replay.ts";
import { persistedMissions } from "../../../scripts/dev/mission-semantics.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";

const derive = deriveMissionCriteria as (m: never) => unknown[];

Deno.test("replay gate: the same compiler on both sides changes no stored mission", async () => {
  const missions = await persistedMissions();
  assert(missions.length >= 80, `every stored mission fixture is replayed (${missions.length})`);
  const r = replay(missions, derive, derive, []);
  assertEquals([r.changed.length, r.unapproved.length], [0, 0]);
});

Deno.test("replay gate: a compiler that weakens a hard requirement is caught, and only an exact owner approval clears it", async () => {
  const missions = (await persistedMissions()).slice(0, 20);
  const weakened = (m: never) => (derive(m) as Record<string, unknown>[]).map((c) => c.dimension === "geography" ? { ...c, kind: "target" } : c);
  const r = replay(missions, derive, weakened, []);
  assert(r.changed.length > 0, "a hard geography becoming a target changes meaning");
  assertEquals(r.unapproved.length, r.changed.length, "nothing is approved by default");
  const one = r.changed[0];
  const approved = [{ key: one.key, before: one.before, after: one.after, reason: "test", approvedBy: "owner" }];
  const again = replay(missions, derive, weakened, approved);
  assertEquals(again.unapproved.length, r.changed.length - 1, "an approval clears exactly its own mission's change");
  const stale = replay(missions, derive, weakened, [{ ...approved[0], after: "0".repeat(64) }]);
  assertEquals(stale.unapproved.length, r.changed.length, "an approval for a different outcome clears nothing");
});

