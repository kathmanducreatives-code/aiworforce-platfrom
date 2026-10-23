// Judge one zero-Apify real-GPT run from its evidence document.
//   deno run --allow-read scripts/test-project/real-gpt/judge-real-gpt-run.ts evidence.json
// Exits 1 when any automatic criterion fails. MANUAL rows are printed for the
// operator to sign off against the vendors' consoles; they never pass on their own.
import { judgeRealGptRun, overall } from "./realGptJudge.ts";

const path = Deno.args[0];
if (!path) {
  console.error("usage: judge-real-gpt-run.ts <evidence.json>");
  Deno.exit(2);
}
const verdicts = judgeRealGptRun(JSON.parse(Deno.readTextFileSync(path)));
for (const v of verdicts) console.log(`${v.result.padEnd(6)} ${v.id.padEnd(3)} ${v.criterion}\n         observed: ${v.observed}`);
const result = overall(verdicts);
const manual = verdicts.filter((v) => v.result === "MANUAL").map((v) => v.id);
console.log(`\nAUTOMATIC: ${result}${manual.length ? `   MANUAL sign-off still required: ${manual.join(", ")}` : ""}`);
Deno.exit(result === "PASS" ? 0 : 1);
