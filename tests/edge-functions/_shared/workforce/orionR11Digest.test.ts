// R1.1 · WHAT ORION IS TOLD ABOUT THE WORKSPACE — through the public digest API
// (`loadOrionEvidenceDigest`), so this file runs unchanged against the R1
// implementation to show which properties were missing before the fix.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadOrionEvidenceDigest, type OrionEvidenceDigest } from "../../../../supabase/functions/_shared/orionEvidenceContext.ts";
import { mockDb, NOW, OUTSIDER, TABLES, USER, WS } from "./orionR11Fixture.ts";

const PROMPTS = JSON.parse(await Deno.readTextFile(new URL("../../../fixtures/orion-r1-capability-tests.json", import.meta.url))).tests
  .map((t: { prompt: string }) => t.prompt) as string[];
// deno-lint-ignore no-explicit-any
const allText = (d: OrionEvidenceDigest | null) => {
  // R1.1 adds `workspace.facts`; R1 had only `facts`.
  const w = (d as unknown as { workspace?: { facts?: Array<{ text: string }> } } | null)?.workspace?.facts ?? [];
  return [...w, ...(d?.facts ?? [])].map((f) => f.text).join("\n");
};
async function digest(message: string, failing: string[] = [], userId = USER) {
  return await loadOrionEvidenceDigest(mockDb(TABLES, failing) as never, { workspaceId: WS, userId, message, now: NOW });
}

Deno.test("totals: accounts, leads, scored, qualified, contacts, signals, hiring, monitoring — counted, not sampled (tests 4, 6, 10, 20)", async () => {
  const t = allText(await digest(PROMPTS[3]));
  for (const s of ["Accounts indexed", ": 145", "Lead candidates", ": 61", "new 61", "Leads with a stored fit score: 0",
    "Leads with status qualified: 0", "Saved decision-maker contacts: 0", "Stored LISA signals", ": 37", "Hiring signals: 21",
    "Monitoring subjects: 1", "currently enabled: 0"]) assertStringIncludes(t, s);
});

Deno.test("accounts vs leads are distinguished: 84 indexed accounts have no lead candidate (tests 6, 10)", async () => {
  const t = allText(await digest(PROMPTS[9]));
  assertStringIncludes(t, "84 indexed accounts have no lead candidate");
  assertStringIncludes(t, "An account is a company record; a lead candidate is an account ATLAS proposed as a lead");
});

Deno.test("the eight-item evidence sample is never presented as a total (tests 6, 20)", async () => {
  const d = await digest(PROMPTS[19]);
  const t = allText(d);
  assertStringIncludes(t, "a sample, not a census");
  assertStringIncludes(t, "never report their number as a total");
  assert((d?.items.length ?? 0) <= 12);
});

Deno.test("named companies are found in accounts even when they are not leads (test 8: Laminar, Epsilon3, Civilgrid)", async () => {
  const t = allText(await digest(PROMPTS[7]));
  for (const n of ["Laminar", "Epsilon3", "Civilgrid"]) assert(new RegExp(`${n} \\([^)]*\\): indexed in accounts[^\\n]*NOT a lead candidate`).test(t), `${n}: ${t}`);
  assert(/Hyperbound \([^)]*\): indexed in accounts[^\n]*lead candidate \(status new, no fit score\)/.test(t), t);
});

Deno.test("Hyperbound's decision-maker fields: zero saved contacts is stated, not guessed (test 9)", async () => {
  const t = allText(await digest(PROMPTS[8]));
  assert(/Hyperbound \([^)]*\):[^\n]*saved contacts: 0/.test(t), t);
});

Deno.test("signals carry their observed date, and a missing event date is named as such (test 11)", async () => {
  const d = await digest(PROMPTS[10]);
  const t = allText(d);
  assertStringIncludes(t, "observed 2026-");
  assertStringIncludes(t, "(event date not recorded)");
  assertFalse(t.includes("date not stated"));
  assertEquals(d!.items.length, 10, "ten were asked for");
  assert(d!.items.every((i) => i.source_type === "lisa_signal"), "a question about signals is answered from signals");
});

Deno.test("hiring signals older than 30 days are flagged HISTORICAL, and counted (test 12)", async () => {
  const t = allText(await digest(PROMPTS[11]));
  assertStringIncludes(t, "HISTORICAL hiring evidence");
  assertStringIncludes(t, "of which older than 30 days (HISTORICAL");
  // 21 hiring signals; two carry a 5-day-old event date, so 19 are historical.
  assert(/older than 30 days \(HISTORICAL[^:]*: 19/.test(t), t);
});

Deno.test("observed facts, agent inferences and missing verification are worded differently", async () => {
  const t = allText(await digest("Which leads and signals look strongest for us right now?"));
  assertStringIncludes(t, "agent inference (ATLAS's judgement");
  assertStringIncludes(t, "observed fact from a single source");
});

Deno.test("evidence about other companies is separated from the user's own Company Brain", async () => {
  const t = allText(await digest(PROMPTS[0]));
  assertStringIncludes(t, "not facts about the user's own company");
});

Deno.test("a failed table is reported as unreadable, never as zero", async () => {
  const t = allText(await digest(PROMPTS[3], ["contacts", "signal_events"]));
  assertStringIncludes(t, "Saved decision-maker contacts: COULD NOT BE READ (retrieval failed — this is not zero)");
  assertStringIncludes(t, "Stored LISA signals: COULD NOT BE READ");
  assertFalse(/Saved decision-maker contacts: 0/.test(t));
});

Deno.test("isolation: another workspace's Laminar, qualified lead, contact and signal never appear", async () => {
  const t = allText(await digest(PROMPTS[7]));
  assertFalse(t.includes("OTHER WORKSPACE"));
  assertFalse(t.includes("laminar-other.example"));
  assertStringIncludes(t, "Leads with status qualified: 0");
  assertStringIncludes(t, "Saved decision-maker contacts: 0");
});

Deno.test("isolation: a non-member gets nothing — no evidence and no totals", async () => {
  assertEquals(await digest(PROMPTS[3], [], OUTSIDER), null);
});

Deno.test("Company Brain data check: '2–2 employees' with label '5' is flagged, never silently repeated (test 1)", async () => {
  const t = allText(await digest(PROMPTS[0]));
  assertStringIncludes(t, "COMPANY BRAIN DATA CHECK");
  assertStringIncludes(t, "exactly 2–2 employees");
  assertStringIncludes(t, 'the size label "5" disagrees with the stored range 2–2');
});
