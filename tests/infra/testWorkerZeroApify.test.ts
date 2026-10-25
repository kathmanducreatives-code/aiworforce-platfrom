// ZERO-APIFY IS STRUCTURAL ON THE TEST WORKER. The dispatch input `providers`
// defaults to `openai-only`: the worker step then unsets the Apify token and
// has Deno refuse api.apify.com before connecting, whatever the queue row's
// authorization or the Environment's secrets say. Only an explicit
// `openai-and-apify` dispatch (the separately approved paid A7) reaches Apify.
//
// The worker step's own shell is executed here with `worker/main.ts` replaced
// by a probe that reports the permissions Deno actually granted (no network is
// used). This matters: a bare-host `--deny-net=api.apify.com` does NOT
// override a `host:443` allow — only the port form does.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parse } from "https://deno.land/std@0.224.0/yaml/mod.ts";

const ROOT = new URL("../../", import.meta.url);
const wf = parse(Deno.readTextFileSync(new URL(".github/workflows/discovery-test-worker.yml", ROOT))) as {
  on: { workflow_dispatch: { inputs: Record<string, { type: string; default: string; options?: string[]; required: boolean }> } };
  jobs: { worker: { env: Record<string, string>; steps: Array<{ name?: string; run?: string; env?: Record<string, string> }> } };
};
const job = wf.jobs.worker;
const guard = job.steps[0].run ?? "";
const workerStep = job.steps.find((s) => (s.run ?? "").includes("worker/main.ts"))!;

Deno.test("zero-Apify: `providers` is a required choice that defaults to openai-only, validated before checkout", () => {
  const p = wf.on.workflow_dispatch.inputs.providers;
  assertEquals([p.type, p.default, p.required, p.options], ["choice", "openai-only", true, ["openai-only", "openai-and-apify"]]);
  assertEquals(job.env.PROVIDERS, "${{ inputs.providers }}", "reaches the shell through env, never interpolated");
  assert(guard.includes('case "$PROVIDERS" in') && guard.includes("openai-only|openai-and-apify) ;;"), "the guard refuses any other value");
});

const PROBE = new URL("tests/infra/fixtures/zero-apify-probe.ts", ROOT).pathname;

/** The worker step's own shell, with the probe for the worker; bash owns the temp dir (the suite has no --allow-write). */
async function runWorkerStep(providers: string) {
  const script = workerStep.run!.replace("worker/main.ts", PROBE);
  assert(script.includes(PROBE), "the probe stands in for the worker");
  const out = await new Deno.Command("bash", {
    args: ["-c", `export RUNNER_TEMP="$(mktemp -d)"; trap 'rm -rf "$RUNNER_TEMP"' EXIT\n${script}\nrc=$?; cat "$RUNNER_TEMP/worker.log"; exit $rc`],
    cwd: new URL(".", ROOT).pathname,
    env: { PATH: Deno.env.get("PATH") ?? "", HOME: Deno.env.get("HOME") ?? "", DENO_DIR: Deno.env.get("DENO_DIR") ?? `${Deno.env.get("HOME")}/.cache/deno`,
      SESSION_MINUTES: "1", CONFIRM_REF: "zeroapifyref", PROVIDERS: providers, APIFY_API_TOKEN: "fake-apify-token-present" },
    clearEnv: true, stdout: "piped", stderr: "piped",
  }).output();
  const log = new TextDecoder().decode(out.stdout);
  assertEquals(out.code, 0, new TextDecoder().decode(out.stderr) + log);
  const line = log.split("\n").find((l) => l.startsWith("PROBE "));
  assert(line, log);
  return JSON.parse(line.slice(6)) as Record<string, string | null>;
}

Deno.test("zero-Apify: openai-only — no Apify token and Apify is denied, even with the secret present", async () => {
  assertEquals(await runWorkerStep("openai-only"),
    { token: null, apify: "denied", openai: "granted", project: "granted", other: "prompt" });
});

Deno.test("zero-Apify: only an explicit openai-and-apify dispatch can reach Apify", async () => {
  assertEquals(await runWorkerStep("openai-and-apify"),
    { token: "fake-apify-token-present", apify: "granted", openai: "granted", project: "granted", other: "prompt" });
});
