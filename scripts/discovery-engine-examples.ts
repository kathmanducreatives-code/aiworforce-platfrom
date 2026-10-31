// Prints, offline, how the discovery engine plans five example requests:
// the interpreter's spec (fixture GPT output, validated), the chosen providers,
// the rejected ones, what is verified, what stays uncertain, and the worst case.
//   deno run --no-check --allow-read scripts/discovery-engine-examples.ts
import { interpretQuery } from "../supabase/functions/_shared/discoveryEngine/spec.ts";
import { planExecution } from "../supabase/functions/_shared/discoveryEngine/planner.ts";
import { ALL_ON, fixtureModel, MODEL_OUTPUT } from "../tests/edge-functions/_shared/discoveryEngine/fixtures.ts";

for (const q of Object.keys(MODEL_OUTPUT)) {
  const { spec, repairs } = await interpretQuery(q, fixtureModel);
  const p = planExecution(spec!, ALL_ON());
  console.log(`\n### "${q}"\n`);
  console.log(`- **Spec:** target ${spec!.target}, ${spec!.quantity}; hard [${spec!.hard.join(", ")}]; roles [${spec!.roles.join(", ")}]; signals ${spec!.signals.map((s) => `${s.kind}${s.required ? " (required" : " (preferred"}${s.withinDays ? `, ${s.withinDays}d` : ""})`).join(", ") || "none"}${repairs.length ? `; repairs: ${repairs.join("; ")}` : ""}`);
  console.log(`- **Strategy:** ${p.strategy} — status ${p.status}; worst case ${p.estimated.leadoceanRecords} LeadOcean records, $${p.estimated.apifyUsd} Apify`);
  for (const e of p.explanation) console.log(`  - ${e}`);
  if (p.verifies.length) console.log(`- **Verified:** ${p.verifies.join("; ")}`);
  if (p.uncertain.length) console.log(`- **Uncertain:** ${p.uncertain.join("; ")}`);
}
