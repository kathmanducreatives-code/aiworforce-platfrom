// Mission reliability S0: interpretation fuzz, interpretation corpus, cross-component
// consistency, and labelled coverage losses — today's baselines, pinned. A change to any
// recorded baseline is a reviewed re-record; an improvement shows as a diff, never silently.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FUZZ_BASELINE_PATH, fuzz, summarise as fuzzSummary } from "../../../scripts/dev/interpretation-fuzz.ts";
import { collapsedContrasts, loadCases, loadContrasts, runCases, unstableCases } from "../../../scripts/dev/interpretation-corpus.ts";
import { consistency, CONSISTENCY_BASELINE_PATH } from "../../../scripts/dev/consistency-check.ts";
import { coverage, KNOWN_LOSSES } from "../../../scripts/dev/requirement-coverage.ts";

const read = async (p: string) => JSON.parse(await Deno.readTextFile(new URL(`../../../${p}`, import.meta.url)));

Deno.test("fuzz: every field spelling's outcome matches the recorded baseline", async () => {
  const recorded = (await read(FUZZ_BASELINE_PATH)).results;
  assertEquals(fuzz().map(({ category, spelling, outcome }) => ({ category, spelling, outcome })), recorded);
});

Deno.test("fuzz: the cf55180 incident is fixed (S1) — 'signal role' is the hiring signal's own role, and no spelling fails", () => {
  const r = fuzz().find((x) => x.category === "role" && x.spelling === "signal role")!;
  assertEquals(r.outcome, "ok");
  assertEquals(fuzzSummary(fuzz()).failing, 0, "S1: every covered restatement reconciles by value");
  const s = fuzzSummary(fuzz());
  assert(s.by.size_preference.unmappable === 0 && s.by.geography.unmappable === 0, "value-matched categories stay robust");
});

Deno.test("corpus: every phrasing meets its label, or is wrong ONLY where a known defect is labelled", () => {
  const r = runCases();
  assertEquals(r.filter((x) => !x.ok && !x.defect).map((x) => `${x.case}:${x.label}: ${x.mismatches.join("; ")}`), [], "an unlabelled interpretation regression");
  assertEquals(r.filter((x) => x.ok && x.defect).map((x) => `${x.case}:${x.label}`), [], "a labelled defect is fixed: remove its label in the same change");
});

Deno.test("corpus: paraphrases of one meaning are unstable ONLY where a known defect is labelled", () => {
  const r = runCases();
  const withDefect = new Set(loadCases().filter((c) => c.phrasings.some((p) => p.defect)).map((c) => c.id));
  assertEquals(unstableCases(r).filter((id) => !withDefect.has(id)), []);
});

Deno.test("corpus: requests that mean DIFFERENT things never compile to the same canonical requirements", () => {
  assert(loadContrasts().length >= 6, "the contrast set is in place");
  assertEquals(collapsedContrasts(runCases()), []);
});

// ── S4: CONTRACT v3 IS THE ACCEPTANCE SUITE ─────────────────────────────────

Deno.test("v3 acceptance: every phrasing compiles to its labelled meaning — no defect label applies", () => {
  const r = runCases(loadCases(), "v3");
  assertEquals(r.filter((x) => !x.ok).map((x) => `${x.case}:${x.label}: ${x.mismatches.join("; ")}`), []);
  assertEquals(r.filter((x) => x.defect).length, 0, "v3 failures are never labelled away");
});

Deno.test("v3 acceptance: equivalent requests produce equivalent canonical requirements (no unstable case)", () => {
  assertEquals(unstableCases(runCases(loadCases(), "v3")), []);
});

Deno.test("v3 acceptance: requests that mean different things stay different", () => {
  assert(loadContrasts().length >= 10);
  assertEquals(collapsedContrasts(runCases(loadCases(), "v3")), []);
});

Deno.test("v3 acceptance: every phrasing carries the v3 reading it is judged by", () => {
  assertEquals(loadCases().flatMap((c) => c.phrasings.filter((p) => !p.understanding).map((p) => `${c.id}:${p.label}`)), []);
});

Deno.test("corpus: natural-language variety is covered (casual, typos, abbreviations, synonyms, indirect, multi-constraint)", () => {
  const ids = new Set(loadCases().map((c) => c.id));
  for (const id of ["M13", "M14", "M15", "M16", "M17", "M18", "M19", "M20", "M21", "M22", "M23", "M24", "M25", "M26"]) assert(ids.has(id), id);
});

Deno.test("consistency: planner / ORION / qualification disagreements match the recorded baseline", async () => {
  const recorded = (await read(CONSISTENCY_BASELINE_PATH)).disagreements;
  assertEquals(await consistency(), recorded);
});

Deno.test("consistency (S2): one mission means one thing — no disagreement except legacy stored-copy drift (S5)", async () => {
  const r = await consistency();
  assertEquals(Object.entries(r).filter(([, v]) => !v.includes("legacy_stored_criteria_drift")).map(([k, v]) => `${k}: ${v}`), []);
  // Every freshly compiled mission (the whole interpretation corpus) agrees completely.
  assertEquals(Object.keys(r).filter((k) => k.startsWith("corpus:") || k.startsWith("corpus-v3:")), []);
});

Deno.test("coverage: every labelled known loss still occurs (a fixed loss must be unlabelled in the same change)", async () => {
  const c = await coverage();
  const occurring = new Set(Object.entries(c).flatMap(([k, fs]) => fs.map((f) => `${k}|${f.item}`)));
  assertEquals(Object.keys(KNOWN_LOSSES).filter((k) => !occurring.has(k)), []);
});
