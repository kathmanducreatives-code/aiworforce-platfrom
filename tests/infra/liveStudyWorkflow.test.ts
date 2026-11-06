// The live paraphrase study stage of discovery-test-worker.yml (owner-authorised: <= 180
// model calls, <= $2). It may spend ONLY on the model, only within the cap, only on the
// approved commit, and only after its budget guard tests pass.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parse } from "https://deno.land/std@0.224.0/yaml/mod.ts";

const ROOT = new URL("../../", import.meta.url);
type Step = { name?: string; run?: string; uses?: string; env?: Record<string, string>; if?: string };
const wf = parse(Deno.readTextFileSync(new URL(".github/workflows/discovery-test-worker.yml", ROOT))) as {
  jobs: Record<string, { if?: string; environment?: string; permissions?: Record<string, string>; steps: Step[]; env?: Record<string, string> }>;
};
const job = wf.jobs.study;

Deno.test("study: its own stage only; the worker and the canary never run beside it", () => {
  assertEquals(job.if, "${{ inputs.canary_stage == 'study' || inputs.canary_stage == 'study_v4' }}");
  assert(wf.jobs.worker.if!.includes("inputs.canary_stage != 'study_v4'"));
  // The interpreter choice comes from the stage, never from a free input, and never touches the cap.
  assertEquals(job.env?.STUDY_CONTRACT, "${{ inputs.canary_stage == 'study_v4' && 'v4' || 'v3' }}");
  assert(wf.jobs.worker.if!.includes("inputs.canary_stage != 'study'"));
  assert(!wf.jobs.canary.if!.includes("study"));
  assertEquals(job.permissions, { contents: "read" });
});

Deno.test("study: refuses first — TEST key only, the approved commit, the exact approval phrase", () => {
  const guard = job.steps[0].run ?? "";
  assert(guard.includes("tlvnfrxzjhsjgdofwehb") && guard.includes("ohsdatpvfdjdemstoiuj"));
  assert(guard.includes('"$EXPECTED_SHA" = "$GITHUB_SHA"'));
  assert(guard.includes("run the live paraphrase study within 2 USD"));
});

Deno.test("study: the budget guard tests run before any paid call; the cap is fixed, not an input", () => {
  const names = job.steps.map((s) => s.name ?? s.uses ?? "");
  const guardAt = names.findIndex((n) => n.startsWith("Budget guard tests"));
  const liveAt = names.findIndex((n) => n.startsWith("Live study"));
  assert(guardAt > 0 && liveAt > guardAt);
  const live = job.steps[liveAt];
  assert(live.run!.includes("--allow-net=api.openai.com"), "the model host is the only network permission");
  assert(live.run!.includes("--budget-usd 2") && live.run!.includes("--max-calls 180") && live.run!.includes("--repeats 3"));
  assert(!/\\$\\{\\{\\s*inputs\\./.test(live.run!), "no input can raise the cap");
});

Deno.test("study: the model key is the only secret it reads, and only on the live step", () => {
  const withSecrets = job.steps.filter((s) => JSON.stringify(s.env ?? {}).includes("secrets."));
  assertEquals(withSecrets.map((s) => s.name), ["Live study (api.openai.com only; at most 180 calls and 2 USD, enforced per request)"]);
  assertEquals(Object.keys(withSecrets[0].env!), ["OPENAI_API_KEY"]);
  assert(!JSON.stringify(job).includes("APIFY"), "no lead provider credential");
  assert(!JSON.stringify(job).includes("TEST_DB_URL"), "no database");
});
