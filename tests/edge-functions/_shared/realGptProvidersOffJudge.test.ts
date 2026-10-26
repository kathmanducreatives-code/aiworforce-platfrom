// The providers-off judge, on the evidence documents of two real local
// rehearsals of Candidate B (real TEST-schema build + the three held security
// migrations, real worker process): `providers: none` (no key, OpenAI and Apify
// denied) and the scripted-GPT zero-Apify run. Synthetic workspace; no secrets.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { judgeProvidersOff, judgeRealGptRun, overall } from "../../../scripts/test-project/real-gpt/realGptJudge.ts";

const load = (f: string) => JSON.parse(Deno.readTextFileSync(new URL(`./fixtures/${f}`, import.meta.url)));
const off = load("providers-off-evidence.json"), gpt = load("scripted-gpt-evidence.json");
const failed = (vs: ReturnType<typeof judgeProvidersOff>) => vs.filter((v) => v.result === "FAIL").map((v) => v.id);

Deno.test("providers-off judge: the real providers-off rehearsal passes every criterion", () => {
  const vs = judgeProvidersOff(off);
  assertEquals(vs.map((v) => v.id), ["O1", "O2", "O3", "O4", "O5", "O6", "O7"]);
  assertEquals(failed(vs), []);
  assertEquals(overall(vs), "PASS");
});

Deno.test("providers-off judge: a run that called a model fails it — and the real-GPT judge fails the providers-off run", () => {
  assertEquals(failed(judgeProvidersOff(gpt)).sort(), ["O2", "O3", "O4"], "admitted model calls, ledger rows, another verdict");
  assertEquals(overall(judgeRealGptRun(gpt)), "PASS", "the scripted-GPT run passes its own judge");
  assert(failed(judgeRealGptRun(off)).length > 0, "providers-off evidence never passes as a real-GPT run");
});

Deno.test("providers-off judge: each breach is caught on its own", () => {
  const clone = () => structuredClone(off);
  const with_ = (f: (e: Record<string, any>) => void) => { const e = clone(); f(e); return failed(judgeProvidersOff(e)); };
  assertEquals(with_((e) => { e.queue.status = "resumable"; }), ["O1"]);
  assertEquals(with_((e) => { e.terminal = []; }), ["O2"]);
  assertEquals(with_((e) => { e.terminal = ["budget_exhausted"]; }), ["O2"]);
  assertEquals(with_((e) => { e.smoke_operations = [{ kind: "provider" }]; }), ["O3"]);
  assertEquals(with_((e) => { e.ledger = [{ record_kind: "model_call", source: "kickoff" }]; }), ["O4"]);
  assertEquals(with_((e) => { e.balance.reserved_credits = 1; }), ["O5"]);
  assertEquals(with_((e) => { e.balance.balance_credits = 9; }), ["O5"]);
  assertEquals(with_((e) => { e.credit_transactions = [{ status: "reserved" }]; }), ["O5"]);
  assertEquals(with_((e) => { e.leads = 1; }), ["O6"]);
  assertEquals(with_((e) => { e.credit_check = [{}]; }), ["O7"]);
});
