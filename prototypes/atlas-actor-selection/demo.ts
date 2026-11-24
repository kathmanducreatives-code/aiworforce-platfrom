// PROTOTYPE DEMO (offline; no network, no provider, no model, no database).
//   deno run --allow-read --no-check prototypes/atlas-actor-selection/demo.ts [--json]
//
// Each review scenario's mocked model reading goes through the REAL Mission Contract
// (contractFromProposal), then through the prototype selector. The live pipeline's verdict
// for the same reading is printed beside it (from the ATLAS simulator, review-scenarios/run.ts).
import { contractFromProposal } from "../../supabase/functions/_shared/missionContract/interpret.ts";
import { planSelection, proposeFromStore, type StoreSnapshot } from "./planner.ts";

globalThis.fetch = (() => { throw new Error("network disabled in the prototype"); }) as typeof fetch;

const LIVE: Record<string, string> = {
  "r1-firmographic": "BLOCKED — no discovery route without a hiring signal",
  "r2-hiring": "ready — job search + company record, $0.241 for 25",
  "r3-signal": "ready — but searches only [\"Account Executive\"] for \"sales teams\"",
  "r4-industry": "BLOCKED — no discovery route without a hiring signal",
  "r5-founders": "BLOCKED — people search not approved; LeadOcean off",
  "r6-research": "needs clarification (correct)",
  "pilot-industry-b2b": "ready (review-only) — industry never narrows the job search",
};
const dir = new URL("./review-scenarios/", import.meta.url);
const files = [...[...Deno.readDirSync(dir)].filter((e) => e.name.endsWith(".json")).map((e) => new URL(e.name, dir)),
  new URL("../../tests/fixtures/atlas-sim/pilot-industry-b2b.json", import.meta.url)];
const out: unknown[] = [];
for (const f of files) {
  const s = JSON.parse(Deno.readTextFileSync(f));
  const { contract } = contractFromProposal(s.query, s.interpretation);
  console.log(`\n══ ${s.name} — “${s.query}”`);
  console.log(`   live pipeline today: ${LIVE[s.name] ?? "—"}`);
  if (contract.ambiguities.length) { console.log(`   prototype: clarification first — ${contract.ambiguities[0].question}`); continue; }
  const p = planSelection(contract, { allowReviewOnly: s.allowReviewOnly === true });
  for (const st of p.steps) {
    console.log(`   ${st.executable ? "✓" : "✗"} ${st.capability.padEnd(36)} ${st.actorId ?? "—"} [${st.approval}]  worst $${st.worstUsd}`);
    if (st.input) console.log(`       input ${JSON.stringify(st.input).slice(0, 230)}`);
    if (!st.check.ok && st.check.errors.length) console.log(`       schema: ${st.check.errors.join("; ")}`);
    for (const d of st.disclosures) console.log(`       · ${d.label}: ${d.handling}${d.by && d.handling !== "filtered_at_source" ? ` by ${d.by}` : ""} — ${d.note}`);
  }
  console.log(`   → ${p.executable ? "EXECUTABLE" : "NOT executable"}  worst $${p.worstUsd} / $${p.ceilingUsd}${p.blockers.length ? `\n     blockers: ${p.blockers.join(" | ")}` : ""}`);
  out.push({ name: s.name, plan: p });
}
const snap = JSON.parse(Deno.readTextFileSync(new URL("./snapshots/store-snapshot.json", import.meta.url))) as StoreSnapshot;
console.log(`\n══ AI-assisted discovery (Store snapshot ${snap.capturedAt.slice(0, 10)}): proposals for "company_discovery", never executable`);
for (const x of proposeFromStore(snap, "company_discovery").slice(0, 3)) console.log(`   ${x.actorId.padEnd(48)} users ${x.users}  ${x.alreadyCatalogued ? "(already catalogued)" : "(new: review checklist applies)"}`);
if (Deno.args.includes("--json")) console.log(JSON.stringify(out, null, 1));
