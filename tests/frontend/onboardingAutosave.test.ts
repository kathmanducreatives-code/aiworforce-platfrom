// ONBOARDING RESUMES ACROSS DEVICES AND A STALE AUTOSAVE LOSES NOTHING TYPED
// (roadmap Phase 2). Pure.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mergeStale, resumeFrom, type ProgressCopy } from "../../src/lib/onboardingAutosave.ts";

const copy = (step: number, answers: ProgressCopy["answers"], updated_at: string): ProgressCopy => ({ step, answers, updated_at });
const T1 = "2026-10-23T10:00:00.000Z";
const T2 = "2026-10-23T10:05:00.000Z";

Deno.test("AS-1 device B resumes device A's server copy; a newer offline buffer wins; ties go to the server", () => {
  const server = copy(3, { company: { name: "Northwind" } }, T2);
  assertEquals(resumeFrom(server, null), { source: "server", copy: server });
  assertEquals(resumeFrom(server, copy(1, {}, T1)).source, "server", "older buffer");
  assertEquals(resumeFrom(server, copy(4, {}, "2026-10-23T10:06:00.000Z")).source, "local", "newer buffer (offline edits)");
  assertEquals(resumeFrom(server, copy(4, {}, T2)).source, "server", "tie");
  assertEquals(resumeFrom(server, copy(4, {}, "not a date")).source, "server", "unreadable buffer time");
  assertEquals(resumeFrom(null, null), { source: "none", copy: null });
});

Deno.test("AS-2 a stale save merges field by field: each side's own changes survive", () => {
  const base = copy(1, { company: { name: "Northwind", description: "" } }, T1);
  const mine = copy(2, { company: { name: "Northwind", description: "Revenue analytics" } }, T1);
  const server = copy(1, { company: { name: "Northwind Analytics", description: "" }, founder: { role: "CEO" } }, T2);
  const { merged, conflicts } = mergeStale(base, mine, server);
  assertEquals(merged.answers, { company: { name: "Northwind Analytics", description: "Revenue analytics" }, founder: { role: "CEO" } });
  assertEquals(merged.step, 2, "the furthest step either side reached");
  assertEquals(merged.updated_at, T2, "the merge builds on the server's version");
  assertEquals(conflicts, []);
});

Deno.test("AS-3 both sides changed the same field differently: server value kept, this tab's value returned — nothing lost", () => {
  const base = copy(1, { company: { name: "Northwind" } }, T1);
  const mine = copy(1, { company: { name: "Northwind Ltd" } }, T1);
  const server = copy(1, { company: { name: "Northwind Analytics" } }, T2);
  const { merged, conflicts } = mergeStale(base, mine, server);
  assertEquals(merged.answers.company.name, "Northwind Analytics");
  assertEquals(conflicts, [{ form: "company", field: "name", mine: "Northwind Ltd", theirs: "Northwind Analytics" }]);
});

Deno.test("AS-4 clears are changes too: a field this tab cleared stays cleared; one the server cleared stays cleared", () => {
  const base = copy(1, { company: { name: "Northwind", website_url: "https://n.example" } }, T1);
  const mine = copy(1, { company: { name: "Northwind" } }, T1);                  // cleared the website
  const server = copy(1, { company: { website_url: "https://n.example" } }, T2); // cleared the name
  const { merged, conflicts } = mergeStale(base, mine, server);
  assertEquals(merged.answers, {});
  assertEquals(conflicts, []);
});

Deno.test("AS-5 the same edit on both sides is kept once, without a conflict", () => {
  const base = copy(1, {}, T1);
  const both = { founder: { first_help_goal: "Improve outbound" } };
  assertEquals(mergeStale(base, copy(1, both, T1), copy(1, both, T2)), { merged: copy(1, both, T2), conflicts: [] });
});
