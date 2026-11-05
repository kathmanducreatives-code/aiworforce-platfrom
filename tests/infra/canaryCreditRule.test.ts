// The canary's credit rule (canary-stage.sh `canary_credit_rule`), run from the script itself.
// It replaces P09's "exactly 10" (the zero-Apify A7 judge's starting balance) for the PAID
// canary only: a successful session keeps the credits its starts reserved, so the rule is
// "none reserved, at least one attempt's three starts". Never a top-up; fails closed.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const script = await Deno.readTextFile(new URL("../../scripts/test-project/canary/canary-stage.sh", import.meta.url));
const min = /^CANARY_MIN_CREDITS=(\d+)$/m.exec(script)?.[1];
const fn = /^canary_credit_rule\(\) \{[\s\S]*?^\}$/m.exec(script)?.[0];

async function rule(actual: string): Promise<string> {
  const out = await new Deno.Command("bash", { args: ["-c", `CANARY_MIN_CREDITS=${min}\n${fn}\ncanary_credit_rule "$1"`, "_", actual], stdout: "piped" }).output();
  return new TextDecoder().decode(out.stdout).trim();
}

Deno.test("canary credits: the minimum is one attempt's starts (K09: one each of jobs, details, Atomus)", () => {
  assertEquals(min, "3");
  assert(fn, "canary_credit_rule is defined in canary-stage.sh");
  assert(script.includes(`$1 != "P09"`), "only P09 is re-judged; every other preflight check stays as written");
});

Deno.test("canary credits: legitimately consumed balance passes; low, reserved or unreadable fails", async () => {
  assertEquals(await rule("balance=10, reserved=0"), "PASS balance 10 ≥ 3, none reserved");
  assertEquals(await rule("balance=8, reserved=0"), "PASS balance 8 ≥ 3, none reserved");
  assertEquals(await rule("balance=3, reserved=0"), "PASS balance 3 ≥ 3, none reserved");
  assert((await rule("balance=2, reserved=0")).startsWith("FAIL balance 2 is below the 3"));
  assert((await rule("balance=8, reserved=1")).startsWith("FAIL 1 credit(s) reserved"));
  assert((await rule("no balance row")).startsWith("FAIL credit row unreadable"));
  assert((await rule("missing")).startsWith("FAIL credit row unreadable"));
  assert((await rule("balance=-1, reserved=0")).startsWith("FAIL credit row unreadable"));
});

Deno.test("canary credits: the A7 preflight itself is unchanged (exactly 10 for the zero-Apify judge)", async () => {
  const pre = await Deno.readTextFile(new URL("../../scripts/test-project/real-gpt/preflight.sql", import.meta.url));
  assert(pre.includes("balance_credits = 10 and reserved_credits = 0"));
});
