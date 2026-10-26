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
  assertEquals([p.type, p.default, p.required, p.options], ["choice", "openai-only", true, ["openai-only", "none", "openai-and-apify"]]);
  assertEquals(job.env.PROVIDERS, "${{ inputs.providers }}", "reaches the shell through env, never interpolated");
  assert(guard.includes('case "$PROVIDERS" in') && guard.includes("openai-only|none|openai-and-apify) ;;"), "the guard refuses any other value");
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
      SESSION_MINUTES: "1", CONFIRM_REF: "zeroapifyref", PROVIDERS: providers, APIFY_API_TOKEN: "fake-apify-token-present",
      OPENAI_API_KEY: "fake-openai-key-present" },
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
    { token: null, openai_key: "fake-openai-key-present", apify: "denied", openai: "granted", project: "granted", other: "prompt" });
});

Deno.test("providers-off: none — no Apify token, no OpenAI key, and both vendors denied, even with both secrets present", async () => {
  assertEquals(await runWorkerStep("none"),
    { token: null, openai_key: null, apify: "denied", openai: "denied", project: "granted", other: "prompt" });
});

Deno.test("keys by dispatch: a secret reaches the worker step only for a dispatch that may use it", () => {
  assertEquals(workerStep.env?.APIFY_API_TOKEN, "${{ inputs.providers == 'openai-and-apify' && secrets.TEST_APIFY_API_TOKEN || '' }}");
  assertEquals(workerStep.env?.OPENAI_API_KEY, "${{ inputs.providers != 'none' && secrets.TEST_OPENAI_API_KEY || '' }}");
});

Deno.test("approved commit: the guard refuses any checkout but the typed 40-character expected_sha", () => {
  const e = wf.on.workflow_dispatch.inputs.expected_sha;
  assertEquals([e.type, e.required], ["string", true]);
  assertEquals(job.env.EXPECTED_SHA, "${{ inputs.expected_sha }}", "reaches the shell through env, never interpolated");
  assert(guard.includes('[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] && [ "$EXPECTED_SHA" = "$GITHUB_SHA" ]'));
});

Deno.test("zero-Apify: only an explicit openai-and-apify dispatch can reach Apify", async () => {
  assertEquals(await runWorkerStep("openai-and-apify"),
    { token: "fake-apify-token-present", openai_key: "fake-openai-key-present", apify: "granted", openai: "granted", project: "granted", other: "prompt" });
});

/** The guard step's own shell, with the Environment a dispatch would give it. */
async function runGuard(over: Record<string, string>) {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const out = await new Deno.Command("bash", {
    args: ["-c", guard], clearEnv: true, stdout: "piped", stderr: "piped",
    env: { PATH: Deno.env.get("PATH") ?? "", CONFIRM_REF: "testref", TEST_PROJECT_REF: "testref",
      SUPABASE_URL: "https://testref.supabase.co", LEAD_V2_WORKER_WORKSPACES: "40e2512f-09b6-433e-97fe-f9999a1f1897",
      SESSION_MINUTES: "10", PROVIDERS: "none", EXPECTED_SHA: sha, GITHUB_SHA: sha, ...over },
  }).output();
  return { code: out.code, err: new TextDecoder().decode(out.stderr) };
}

Deno.test("guard, executed: the approved commit and a known providers value pass; anything else is refused before checkout", async () => {
  assertEquals((await runGuard({})).code, 0);
  assertEquals((await runGuard({ PROVIDERS: "openai-only" })).code, 0);
  const moved = await runGuard({ GITHUB_SHA: "fedcba9876543210fedcba9876543210fedcba98" });
  assertEquals(moved.code, 1);
  assert(moved.err.includes("not the approved expected_sha"), moved.err);
  assertEquals((await runGuard({ EXPECTED_SHA: "0123456" , GITHUB_SHA: "0123456" })).code, 1, "a short SHA is refused");
  assertEquals((await runGuard({ EXPECTED_SHA: "" })).code, 1, "an empty SHA is refused");
  assertEquals((await runGuard({ PROVIDERS: "apify-only" })).code, 1);
  assertEquals((await runGuard({ CONFIRM_REF: "ohsdatpvfdjdemstoiuj", TEST_PROJECT_REF: "ohsdatpvfdjdemstoiuj",
    SUPABASE_URL: "https://ohsdatpvfdjdemstoiuj.supabase.co" })).code, 1, "the live project is refused");
});
