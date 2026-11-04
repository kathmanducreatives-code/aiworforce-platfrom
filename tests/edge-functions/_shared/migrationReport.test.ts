// S5 — the historical migration plan is verified before it can be applied, and its
// rollback restores every touched field. Offline: the "live release" is this code.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildReport, directionOf, freezePlan, jsonbOrder } from "../../../scripts/dev/migration-report.ts";
import { persistedMissions } from "../../../scripts/dev/mission-semantics.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { criteriaFreezeState, criteriaOf, freezeCriteria } from "../../../supabase/functions/_shared/missionCriteriaReader.ts";
import { missionHash } from "../../../supabase/functions/_shared/leadMission.ts";

const derive = deriveMissionCriteria as never;
/** Equal as JSON values (key order aside — Postgres jsonb does not keep it). */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x);

Deno.test("direction: each kind of semantic difference is classified by what it does to who qualifies", () => {
  assertEquals(directionOf("geography:united_states: geography_scope - → headquarters"), "narrows");
  assertEquals(directionOf("company_stage:startup: kind hard → target"), "broadens");
  assertEquals(directionOf("removed hard constraint:x"), "broadens");
  assertEquals(directionOf("removed target constraint:x"), "neutral");
  assertEquals(directionOf("constraint:x: status ok → unprovable_today"), "narrows");
  assertEquals(directionOf("funding:x: any_of changed"), "broadens");
});

Deno.test("freeze plan (option A): every stored mission keeps exactly the meaning production runs, and its approval hash", async () => {
  const missions = await persistedMissions();
  const r = await freezePlan(missions, derive);
  assertEquals(r.failures, []);
  assert(r.plan.length >= 80);
  const byKey = new Map(missions.map(([k, m]) => [k, jsonbOrder(m)] as const)); // as production reads it
  for (const p of r.plan) {
    const m = byKey.get(p.key)!;
    const frozen = { ...m, ...p.set };
    assertEquals(criteriaFreezeState(frozen as never), "frozen", p.key);
    assertEquals(JSON.stringify(criteriaOf(frozen as never, { legacy: "rederive" })), JSON.stringify(deriveMissionCriteria(m as never)), p.key);
    assertEquals(await missionHash(frozen as never), await missionHash(m as never), p.key);
  }
});

Deno.test("rollback plan: restores every touched field exactly (re-derivation resumes)", async () => {
  const missions = await persistedMissions();
  const { plan, rollback } = await freezePlan(missions, derive);
  const byKey = new Map(missions);
  for (const [i, p] of plan.entries()) {
    const m = byKey.get(p.key)!;
    const restored: Record<string, unknown> = { ...m, ...p.set };
    for (const [k, v] of Object.entries(rollback[i].restore)) { if (v === null) delete restored[k]; else restored[k] = v; }
    assertEquals(canon(restored), canon(m), p.key);
  }
});

Deno.test("freeze plan never touches a mission that is already frozen", async () => {
  const [[key, m]] = (await persistedMissions()).filter(([, x]) => deriveMissionCriteria(x as never).length);
  const frozen = freezeCriteria({ ...m, criteria: deriveMissionCriteria(m as never) });
  assertEquals((await freezePlan([[key, frozen]], derive)).plan, []);
});

Deno.test("report: with the live release equal to this code, no stored mission changes meaning", async () => {
  const reports = await buildReport(await persistedMissions(), derive);
  assertEquals(reports.filter((r) => r.overall !== "unchanged").map((r) => r.key), []);
});
