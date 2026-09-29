// LAUNCH BUDGET SAFETY: SPEND FAILS CLOSED, AND CREDITS ARE A BETA GRANT.
//
// Before: credit and model-spend enforcement defaulted to `observe`, signup was
// open, and a new workspace held no credits — so unless production happened to
// set LEAD_CREDIT_ENFORCEMENT=enforce, any new account could start paid
// missions ($2.00 provider + $0.40 model ceiling each) without limit.
//
// Decided 2026-09-28 ("Enforce + beta grants"): enforcement is on unless the
// exact word `observe` disarms it; a workspace spends provider credits only
// after `scripts/beta/grant-credits.ts` grants them; and orchestrate refuses a
// paid mission for a no-credit workspace BEFORE anything is queued, with a
// message the user can act on. PURE.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BETA_ACCESS_MESSAGE, CREDITS_REQUIRED, creditStartGate, MIN_CREDITS_TO_START, startBuysProviderData,
} from "../../../supabase/functions/_shared/creditStartGate.ts";
import { resolveCreditEnforcement } from "../../../supabase/functions/_shared/creditAuthorization.ts";
import { MAX_GRANT, parseGrantArgs } from "../../../scripts/beta/grant-credits.ts";

const WS = "00000000-0000-4000-a000-000000000001";

// ═══════════════════════════════════════════════════════════ the gate ══

Deno.test("UNSET ENV → ENFORCE → a workspace nobody granted is refused at the door", () => {
  const mode = resolveCreditEnforcement(() => undefined);
  assertEquals(mode, "enforce");
  assertEquals(creditStartGate({ mode, balance: null }), { allowed: false, reason: "no_credits", balance: null });
  assertEquals(creditStartGate({ mode, balance: 0 }).allowed, false);
});

Deno.test("A GRANTED WORKSPACE STARTS: one credit is enough to begin", () => {
  assertEquals(MIN_CREDITS_TO_START, 1);
  assertEquals(creditStartGate({ mode: "enforce", balance: 1 }), { allowed: true, reason: "has_credits", balance: 1 });
  assertEquals(creditStartGate({ mode: "enforce", balance: 50 }).reason, "has_credits");
});

Deno.test("AN UNREADABLE BALANCE IS NOT A FUNDED ONE (enforce refuses); OBSERVE NEVER REFUSES", () => {
  assertEquals(creditStartGate({ mode: "enforce", balance: 99, readFailed: true }).reason, "balance_unreadable");
  assertEquals(creditStartGate({ mode: "enforce", balance: 99, readFailed: true }).allowed, false);
  assertEquals(creditStartGate({ mode: "observe", balance: 0 }), { allowed: true, reason: "enforcement_off", balance: 0 });
});

Deno.test("ONLY PAID STARTS ARE GATED: missions and Apify sourcing yes; chat, content and drafts no", () => {
  assert(startBuysProviderData({ lead_mission: { version: "lead-mission-v1" } }));
  assert(startBuysProviderData({ tool_input: { lead_mission: {} } }));
  assert(startBuysProviderData({ tool_input: { tool_name: "source_with_apify" } }));
  assert(startBuysProviderData({ tool_needed: "source_with_apify" }));
  assertFalse(startBuysProviderData({ user_instruction: "draft a LinkedIn post" }));
  assertFalse(startBuysProviderData({ tool_input: { tool_name: "research_web" } }));
});

Deno.test("THE MESSAGE says what is wrong and what to do, and does not read as a crash", () => {
  assert(BETA_ACCESS_MESSAGE.includes("private beta"));
  assert(BETA_ACCESS_MESSAGE.includes("Request beta access"));
  assert(BETA_ACCESS_MESSAGE.includes("keep working"), "and that the free parts still work");
  assertFalse(/fail|error|orchestrat/i.test(BETA_ACCESS_MESSAGE));
});

// ═══════════════════════════════════════════════════════════ wiring ══

Deno.test("WIRED: orchestrate gates after membership and model spend, BEFORE any plan row", () => {
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/orchestrate/index.ts", import.meta.url));
  const spend = src.indexOf("error: MODEL_SPEND_REFUSED,");
  const gate = src.indexOf("if (startBuysProviderData(body as Record<string, unknown>)) {");
  const plan = src.indexOf('.from("task_plans")');
  assert(spend > 0 && gate > spend, "after the model-spend layer (which follows the membership check)");
  assert(plan > gate, "before the plan is written: a refusal leaves nothing half-built");
  const block = src.slice(gate, gate + 1400);
  assert(block.includes("resolveCreditEnforcement()"));
  assert(block.includes('.from("workspace_credit_balances")'));
  assert(block.includes("error: CREDITS_REQUIRED, reason: gate.reason, details: BETA_ACCESS_MESSAGE }, 402)"));
  assertEquals(CREDITS_REQUIRED, "credits_required");
});

Deno.test("WIRED: pilot-chat answers a credit refusal with the beta message — not 'the orchestrator failed'", () => {
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const credit = src.indexOf("if (!orchResponse.ok && orchBody?.error === CREDITS_REQUIRED) {");
  const failed = src.indexOf("if (!orchResponse.ok) {");
  assert(credit > 0 && credit < failed, "checked before the generic failure branch");
  const block = src.slice(credit, failed);
  assertFalse(block.includes("is_error: true"), "not recorded as an error");
  assert(block.includes("credits_required: true"));
});

// ═════════════════════════════════════════════════ the operator grant ══

Deno.test("GRANT SCRIPT: validates before any network call; a same-day re-run replays the same key", () => {
  const ok = parseGrantArgs(["--workspace", WS, "--credits", "50", "--reason", "beta: Acme, approved by Prasidha"], "2026-09-28");
  assertEquals(ok.errors, []);
  assertEquals(ok.args!.key, `beta-grant:${WS}:50:2026-09-28`, "idempotent by default");
  assertEquals(ok.args!.dryRun, false);
  const bad = (argv: string[]) => parseGrantArgs(argv, "2026-09-28").errors;
  assert(bad(["--workspace", "not-a-uuid", "--credits", "5", "--reason", "x y z"]).some((e) => e.includes("--workspace")));
  assert(bad(["--workspace", WS, "--credits", "-3", "--reason", "x y z"]).some((e) => e.includes("--credits")));
  assert(bad(["--workspace", WS, "--credits", "2.5", "--reason", "x y z"]).some((e) => e.includes("--credits")));
  assert(bad(["--workspace", WS, "--credits", String(MAX_GRANT + 1), "--reason", "x y z"]).some((e) => e.includes("refused")));
  assert(bad(["--workspace", WS, "--credits", "5"]).some((e) => e.includes("--reason")), "every grant says who approved it");
  assertEquals(parseGrantArgs(["--workspace", WS, "--credits", "5", "--reason", "abc", "--key", "k1", "--dry-run"], "d").args!.key, "k1");
});

Deno.test("OPERATOR SCRIPTS never print the service key, and read it in exactly one place", () => {
  const files = ["grant-credits.ts", "review-requests.ts", "betaAdmin.ts"];
  for (const f of files) {
    const src = Deno.readTextFileSync(new URL(`../../../scripts/beta/${f}`, import.meta.url));
    const logs = src.split("\n").filter((l) => /console\.(log|error)/.test(l));
    // The key lives in `env.key` / `e.key` and in the request headers.
    // (`args.key` is the idempotency key, printed on purpose.)
    assertFalse(logs.some((l) => /\b(env|e)\.key\b|\$\{key\}|headers|Bearer|SERVICE_ROLE_KEY=/.test(l)), `${f}:\n${logs.join("\n")}`);
    const reads = (src.match(/SUPABASE_SERVICE_ROLE_KEY"\)/g) ?? []).length;
    assertEquals(reads, f === "betaAdmin.ts" ? 1 : 0, `${f} reads the key ${reads} time(s)`);
  }
});
