// MISSION CONTRACT v4 SHADOW (production chat) — offline measurement of what production chat's shadow mode
// (AGENTORY_CHAT_CONTRACT_V4_SHADOW=enabled) would record. $0, no model call.
//
//   deno run --allow-read --allow-write --allow-env scripts/dev/mission-contract-shadow.ts [--out docs/benchmarks/mission-contract-shadow]
//
// For every corpus phrasing and every recorded live answer of study run #24, the baseline
// (the mission the production compiler builds from the same answer, converted by the one
// compatibility boundary) is compared with the v4 contract read from that answer
// (`compareContracts`): added / removed / strengthened / weakened / changed requirements,
// approval, plan-hard and qualification differences. Only meaning keys are written.

import { compilePhrasing, loadCases } from "./interpretation-corpus.ts";
import { v4From } from "./contract-corpus.ts";
import { contractFromProposal } from "../../supabase/functions/_shared/missionContract/interpret.ts";
import { contractFromMission } from "../../supabase/functions/_shared/missionContract/boundary.ts";
import { compareContracts, type ContractComparison } from "../../supabase/functions/_shared/missionContract/chatMission.ts";
import { compileLeadMission } from "../../supabase/functions/_shared/leadMissionCompiler.ts";

type Row = { set: string; id: string; label: string; repeat?: number; baseline: "v1" | "v3"; comparison?: ContractComparison; error?: string };

async function compare(set: string, id: string, label: string, query: string, baselineMission: () => unknown, v4: unknown, baseline: "v1" | "v3", repeat?: number): Promise<Row> {
  try {
    const b = contractFromMission(baselineMission() as never);
    const { contract } = contractFromProposal(query, v4 as never);
    return { set, id, label, repeat, baseline, comparison: await compareContracts(b.ok ? b.contract : null, contract) };
  } catch (e) {
    return { set, id, label, repeat, baseline, error: (e as Error).message.slice(0, 160) };
  }
}

export async function shadowRows(): Promise<Row[]> {
  const rows: Row[] = [];
  const cases = loadCases();
  for (const c of cases) for (const p of c.phrasings) {
    for (const mode of ["v1", "v3"] as const) {
      rows.push(await compare("corpus", c.id, p.label, p.query, () => compilePhrasing(p, mode), v4From(p as never), mode));
    }
  }
  const study = JSON.parse(await Deno.readTextFile(new URL("../../docs/benchmarks/live-paraphrase/2026-11-05-run24.json", import.meta.url)));
  for (const r of study.rows as { case: string; label: string; repeat: number; proposal?: Record<string, unknown> }[]) {
    if (!r.proposal) continue;
    const p = cases.find((x) => x.id === r.case)!.phrasings.find((x) => x.label === r.label)!;
    rows.push(await compare("run24", r.case, r.label, p.query,
      () => compileLeadMission({ originalUserQuery: p.query, proposal: r.proposal as never, requestedCount: 5, contract: "v3" }).final_mission,
      v4From({ query: p.query, proposal: r.proposal, understanding: r.proposal.understanding }), "v3", r.repeat));
  }
  return rows;
}

export function summariseShadow(rows: Row[]) {
  const by = (set: string, baseline: string) => rows.filter((r) => r.set === set && r.baseline === baseline);
  const stat = (rs: Row[]) => {
    const ok = rs.filter((r) => r.comparison) as (Row & { comparison: ContractComparison })[];
    const count = (f: (c: ContractComparison) => unknown[]) => ok.filter((r) => f(r.comparison).length).length;
    const keys = (f: (c: ContractComparison) => string[]) => {
      const m = new Map<string, number>();
      for (const r of ok) for (const k of f(r.comparison)) m.set(k, (m.get(k) ?? 0) + 1);
      return Object.fromEntries([...m].sort((a, b) => b[1] - a[1]));
    };
    return {
      compared: ok.length, errors: rs.length - ok.length,
      identical_meaning: ok.filter((r) => r.comparison.identical_meaning).length,
      with_added: count((c) => c.added), with_removed: count((c) => c.removed),
      with_strengthened: count((c) => c.strengthened), with_weakened: count((c) => c.weakened), with_changed: count((c) => c.changed),
      plan_hard_differs: ok.filter((r) => r.comparison.plan_hard.added.length || r.comparison.plan_hard.removed.length).length,
      approval_differs: ok.filter((r) => r.comparison.approval.baseline !== r.comparison.approval.candidate).length,
      qualification_differs: ok.filter((r) => r.comparison.qualification.added.length || r.comparison.qualification.removed.length).length,
      keys: { added: keys((c) => c.added), removed: keys((c) => c.removed), strengthened: keys((c) => c.strengthened), weakened: keys((c) => c.weakened), changed: keys((c) => c.changed) },
    };
  };
  return { corpus_v1: stat(by("corpus", "v1")), corpus_v3: stat(by("corpus", "v3")), run24_v3: stat(by("run24", "v3")) };
}

if (import.meta.main) {
  const outDir = Deno.args.includes("--out") ? Deno.args[Deno.args.indexOf("--out") + 1] : null;
  const rows = await shadowRows();
  const summary = summariseShadow(rows);
  console.log(JSON.stringify(summary, null, 2));
  if (outDir) {
    await Deno.mkdir(outDir, { recursive: true });
    await Deno.writeTextFile(`${outDir}/2026-11-06.json`, JSON.stringify({ generated: "offline, $0, no model call", summary, rows }, null, 1));
  }
}
