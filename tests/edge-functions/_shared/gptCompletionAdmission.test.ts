// T01 through the real fetch admission gate. Only the vendor and durable RPC
// responses are mocked. SQL enforcement remains covered by the DB contracts.
// deno-lint-ignore no-import-prefix
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { gptStructured } from "../../../supabase/functions/_shared/gptProvider.ts";
import { createAdmissionFetch, missionAdmission, type AdmissionDb, type MissionAdmissionContext } from "../../../supabase/functions/_shared/smokeAdmission.ts";
import spec from "../../../docs/launch/discovery-smoke-budget.spec.json" with { type: "json" };

Deno.test("T01: retry, cancellation and a resumed generation retain admitted attempts and money", async () => {
  const deadline = new Date(Date.now() + 60_000).toISOString();
  const token = "11111111-2222-4333-8444-555555555555";
  const modelCap = spec.limits.model_committed_max_usd * 1e6;
  const attemptCap = spec.limits.model_attempts;
  const quote = modelCap / attemptCap;
  const authorization: NonNullable<MissionAdmissionContext["authorization"]> = {
    id: "auth", queue_id: "q", workspace_id: "w", status: "active", deadline_at: deadline,
    actor_limits: {}, provider_polls: 0,
    approved_quotes: { gpt: { allowed_kinds: ["model"], allowed_actors: ["openai:gpt-4.1"],
      maximum_microusd: quote, source: "synthetic", liability_bound_ref: "offline-test",
      observed_at: new Date().toISOString(), request_limits: { max_request_bytes: 4096, max_output_tokens: 100 } } },
  };
  let attempts = 0, committed = 0, sent = 0, keys = 0;
  let revoke: AbortController | null = null;
  const generations: unknown[] = [];
  const db = { rpc: (fn: string, args: Record<string, unknown>) => {
    assertEquals(fn, "admit_discovery_smoke");
    generations.push(args.p_generation);
    if (attempts >= attemptCap || committed + quote > modelCap) {
      return Promise.resolve({ data: { decision: "model_limit" }, error: null });
    }
    attempts++; committed += quote;
    revoke?.abort();
    return Promise.resolve({ data: { decision: "admitted", operation_key: args.p_key,
      reservation_token: token, committed_microusd: committed, deadline_at: deadline }, error: null });
  } } as unknown as AdmissionDb;
  const gate = createAdmissionFetch({
    db, ownApi: "https://synthetic.supabase.co", newKey: () => String(++keys), log: () => {},
    baseFetch: (() => {
      sent++;
      return Promise.resolve(sent === 1 ? new Response("rate limit", { status: 429 }) : new Response(JSON.stringify({
        choices: [{ finish_reason: "length", message: { content: '{"looks_complete":true}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      })));
    }) as typeof fetch,
  });
  const deps = { fetch: (url: string, init: RequestInit) => gate(url, init),
    readEnv: (key: string) => key === "OPENAI_API_KEY" ? "sk-offline" : undefined,
    sleep: () => Promise.resolve() };
  const req = { purpose: "offline", system: "JSON", user: "synthetic", maxTokens: 100 };
  const run = (generation: number, signal?: AbortSignal) => missionAdmission.run({
    queueId: "q", workerId: "worker", taskId: "t", generation, authorization: structuredClone(authorization), signal,
  }, () => gptStructured(req, deps));

  const first = await run(1);
  assert(!first.ok);
  assertEquals([first.code, first.attempts], ["incomplete_response", 2], "HTTP retry consumed its own admission");
  assertEquals([attempts, sent], [2, 2], "truncation does not add another retry");
  const resumed = await run(2);
  assert(!resumed.ok);
  assertEquals(resumed.code, "incomplete_response");
  assertEquals([attempts, sent], [3, 3], "a fresh slice shares the durable authorization");
  revoke = new AbortController();
  const cancelled = await run(3, revoke.signal);
  assert(!cancelled.ok);
  assertEquals([cancelled.code, cancelled.attempts], ["http_error", 1]);
  assertEquals([attempts, sent], [4, 3], "cancellation after admission retains the slot but sends nothing");
  revoke = null;
  const afterCheckpoint = await run(4);
  assert(!afterCheckpoint.ok);
  assertEquals([afterCheckpoint.code, afterCheckpoint.attempts], ["http_error", 1]);
  assertEquals([attempts, sent, committed], [attemptCap, 3, modelCap], "resume cannot replenish attempts or committed money");
  assertEquals(generations, [1, 1, 2, 3, 4]);
});
