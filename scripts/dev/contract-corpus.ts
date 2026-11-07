// MISSION CONTRACT v4 — offline measurement against the interpretation corpus and the
// recorded live studies. $0, no model call.
//
//   deno run --allow-read --allow-env scripts/dev/contract-corpus.ts            # corpus + run #24 replay
//
// The corpus and the studies recorded the model's v3 answers (understanding + legacy
// fields). `v4From` adapts one to the v4 shape: the understanding as-is, and the v4-only
// fields (count, size, stated windows) from the answer's STRUCTURED fields — never from
// its free-form `hard_constraints`, which v4 does not have. Spans for size and windows are
// located in the request text by a pattern: a TEST ADAPTER, not production logic (a live
// v4 model quotes its own spans).
//
// Approved v4 differences from the v1/v3 corpus expectations are recorded, with reasons,
// in tests/fixtures/mission-reliability/v1/v4-expectations.json.

import { compare, type Expect, loadCases, summarise } from "./interpretation-corpus.ts";
import { contractFromProposal, type ContractProposalV4 } from "../../supabase/functions/_shared/missionContract/interpret.ts";
import { compileContract } from "../../supabase/functions/_shared/missionContract/compile.ts";
import { audienceDescriptor } from "../../supabase/functions/_shared/missionCriteria.ts";

const WIN = /\b(?:in|within|over)?\s*the\s+(?:last|past)\s+\d+\s+(?:days?|weeks?|months?|years?)|\blast\s+\d+\s+(?:days?|months?)/i;
const SIZE = /\d[\d,]*\s*(?:[-–]|to)\s*\d[\d,]*\s*(?:employees|people|staff|ppl)|(?:under|fewer than|less than|over|more than)\s+\d[\d,]*\s*(?:employees|people)/i;

/** A recorded v3 answer → the v4 proposal shape (test adapter; see the header). */
export function v4From(p: { query: string; proposal: Record<string, unknown>; understanding?: unknown }): ContractProposalV4 {
  const pr = p.proposal ?? {};
  const er = (pr.employee_range ?? {}) as { min?: number | null; max?: number | null };
  const days = (pr.signal_recency_days as number | null | undefined) ?? null;
  const win = WIN.exec(p.query)?.[0]?.trim();
  const und = (p.understanding ?? {}) as { signals?: { kind: string }[] };
  const size = SIZE.exec(p.query)?.[0];
  // v3 carried the AUDIENCE in `company_types` too ("B2B" in M01). v4 has one channel —
  // understanding.industries — so a recorded v3 type the understanding lacks is carried
  // there, quoted only when the request holds it. (Until 2026-11-06 this adapter dropped
  // them, and the v4 corpus silently lost "B2B": the gap the coverage check now catches.)
  const u = (p.understanding ?? {}) as { industries?: { span: string; industry: string; necessity: string }[] };
  const have = (u.industries ?? []).map((i) => `${i.span} ${i.industry}`.toLowerCase());
  const carried = ((pr.company_types as string[] | undefined) ?? [])
    .filter((t) => typeof t === "string" && audienceDescriptor(t) !== null && new RegExp(`\\b${t.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(p.query) && !have.some((h) => h.includes(t.trim().toLowerCase())))
    .map((t) => ({ span: t.trim(), industry: t.trim(), necessity: "required" }));
  return {
    understanding: carried.length && p.understanding ? { ...u, industries: [...(u.industries ?? []), ...carried] } : p.understanding,
    signal_windows: days && win
      ? (und.signals ?? []).filter((s) => s.kind === "hiring" || s.kind === "funding").slice(0, 1).map((s) => ({ event: s.kind, days, phrase: win, signal: null }))
      : [],
    deliverable: { entity: "company", count: 5, count_span: null, person_roles: [] },
    company_size: (er.min != null || er.max != null) && size
      ? { min: er.min ?? null, max: er.max ?? null, necessity: /\b(prefer|ideally|but include)\b/i.test(p.query) ? "preferred" : "required", span: size }
      : null,
    funding_stages: [], forbid_broadening: [],
  };
}

const OVERRIDES = JSON.parse(Deno.readTextFileSync(new URL("../../tests/fixtures/mission-reliability/v1/v4-expectations.json", import.meta.url))) as
  { overrides: Record<string, { expect: Partial<Expect>; reason: string }> };
/** The case's expectation under contract v4 (an approved, documented difference, if any). */
export const v4Expect = (id: string, e: Expect): Expect => ({ ...e, ...(OVERRIDES.overrides[id]?.expect ?? {}) });

async function check(id: string, e: Expect, query: string, v4: ContractProposalV4): Promise<string[]> {
  try {
    const { contract } = contractFromProposal(query, v4);
    if (contract.ambiguities.length) return [`asks: ${contract.ambiguities[0].question}`];
    return compare(v4Expect(id, e), summarise(await compileContract(contract) as never));
  } catch (e) {
    return [`error: ${(e as Error).message.slice(0, 160)}`];
  }
}

/** Every corpus phrasing, read through the v4 path. */
export async function v4Corpus() {
  const out: { id: string; label: string; mismatches: string[] }[] = [];
  for (const c of loadCases()) for (const p of c.phrasings) {
    out.push({ id: c.id, label: p.label, mismatches: await check(c.id, c.expect, p.query, v4From(p as never)) });
  }
  return out;
}

/** Every recorded live answer of a study, read through the v4 path (no-answer rows stay failures). */
export async function v4Replay(study: { rows: { case: string; label: string; repeat: number; proposal?: Record<string, unknown>; error?: string | null }[] }) {
  const cases = loadCases();
  const out: { id: string; label: string; repeat: number; mismatches: string[] }[] = [];
  for (const r of study.rows) {
    const c = cases.find((x) => x.id === r.case)!;
    const p = c.phrasings.find((x) => x.label === r.label)!;
    const mismatches = r.proposal
      ? await check(c.id, c.expect, p.query, v4From({ query: p.query, proposal: r.proposal, understanding: r.proposal.understanding }))
      : [`no answer: ${r.error}`];
    out.push({ id: r.case, label: r.label, repeat: r.repeat, mismatches });
  }
  return out;
}

if (import.meta.main) {
  const corpus = await v4Corpus();
  console.log(`v4 corpus: ${corpus.filter((x) => !x.mismatches.length).length}/${corpus.length}`);
  for (const x of corpus.filter((x) => x.mismatches.length)) console.log(`  ${x.id}/${x.label}: ${x.mismatches.join("; ")}`);
  const study = JSON.parse(await Deno.readTextFile(new URL("../../docs/benchmarks/live-paraphrase/2026-11-05-run24.json", import.meta.url)));
  const replay = await v4Replay(study);
  console.log(`run #24 replay (v4): ${replay.filter((x) => !x.mismatches.length).length}/${replay.length}`);
  for (const x of replay.filter((x) => x.mismatches.length)) console.log(`  ${x.id}/${x.label}#${x.repeat}: ${x.mismatches.join("; ").slice(0, 200)}`);
}
