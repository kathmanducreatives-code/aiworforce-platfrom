// EVERY MODEL CALL GOES THROUGH AN ACCOUNTED SEAM, OR IT IS NAMED HERE.
//
// ── WHY A STRUCTURAL TEST AND NOT A CONVENTION ─────────────────────────────
//
// Four separate times this codebase grew a provider call that bypassed the
// accounting it already had:
//
//     toolRegistry     → api.perplexity.ai   live, 13 calls, in no ledger
//     chat-respond     → 3 providers          orphaned, unpriced, no workspace
//     aiProvider       → gateway + Anthropic  emitted nothing until 8958550c
//     leadStrategy     → shared transport     emitted into `undefined`
//
// Every one was written by someone who knew the rule. The rule was not
// checkable, so knowing it was not enough. This file makes it checkable: a new
// `fetch` to a model provider fails the build unless its file is listed below
// with a reason.
//
// ZERO network, ZERO models, ZERO providers, ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FUNCTIONS = new URL("../../../supabase/functions/", import.meta.url);

async function* walk(dir: URL, prefix = ""): AsyncGenerator<{ path: string; text: string }> {
  for await (const e of Deno.readDir(dir)) {
    const child = new URL(e.name + (e.isDirectory ? "/" : ""), dir);
    if (e.isDirectory) yield* walk(child, `${prefix}${e.name}/`);
    else if (e.name.endsWith(".ts")) {
      yield { path: `${prefix}${e.name}`, text: await Deno.readTextFile(child) };
    }
  }
}

const FILES: { path: string; text: string }[] = [];
for await (const f of walk(FUNCTIONS)) FILES.push(f);

/** Hosts that bill per token. A `fetch` to one of these is model spend. */
const PROVIDER_HOSTS = [
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.perplexity.ai",
  "ai.gateway.lovable.dev",
];

/**
 * THE APPROVED SEAMS. Each reports to `ModelCallCollector` and honours a budget.
 *
 * A file here is not exempt from accounting — it IS the accounting. Adding a
 * name means claiming the file emits telemetry on success AND failure and
 * consults a budget before spending; the tests beside this one check that for
 * each of them.
 */
const ACCOUNTED: Readonly<Record<string, string>> = Object.freeze({
  "_shared/gptProvider.ts":
    "OpenAI transport; emits via GptDeps.onModelCall on success and failure",
  "_shared/aiProvider.ts":
    "gateway + Anthropic; emits via opts.onModelCall, budget checked per attempt",
  "_shared/leadStrategy/adapters/shared.ts":
    "the one strategist transport; emits on success and failure, budget checked before the request",
  "_shared/leadStrategy/adapters/openai.ts":
    "endpoint constant only; delegates to the shared transport",
  "_shared/leadStrategy/adapters/lovableAi.ts":
    "endpoint constant only; delegates to the shared transport",
});

/**
 * KNOWN-UNMETERED, AND WHY THEY SURVIVE.
 *
 * These belong to the dormant recruiting product and are reachable ONLY from
 * frontend components — so deleting them means deleting their callers, and the
 * frontend tree currently carries 24 uncommitted files of someone else's work.
 * Removing them is a decision about the recruiting product, not a cleanup.
 *
 * The list may SHRINK and must never grow. Every entry is model spend that
 * appears in no ledger.
 */
const KNOWN_UNMETERED: Readonly<Record<string, string>> = Object.freeze({
  "screen-candidate/index.ts": "3 gateway calls; reachable from src/",
  "generate-screening-invite/index.ts": "1 gateway call; reachable from src/",
  "parse-resume/index.ts": "1 gateway call; reachable from src/",
});

/** A real call site, not a comment or a doc string. */
function providerCallSites(text: string): string[] {
  return text.split("\n")
    .filter((l) => {
      const t = l.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return false;
      return PROVIDER_HOSTS.some((h) => l.includes(h));
    })
    .map((l) => l.trim());
}

// ══════════ 1. no unapproved provider call sites ══════════════════════════

Deno.test("THE INVARIANT: every model provider call is in an accounted file", () => {
  const offenders: string[] = [];
  for (const f of FILES) {
    if (providerCallSites(f.text).length === 0) continue;
    if (f.path in ACCOUNTED || f.path in KNOWN_UNMETERED) continue;
    offenders.push(f.path);
  }
  assertEquals(
    offenders.sort(), [],
    `these files call a model provider directly and are neither an accounted ` +
      `seam nor a known gap: ${offenders.join(", ")}. Route the call through ` +
      `aiProvider, gptProvider or the strategist transport — all three report ` +
      `to ModelCallCollector and honour a run budget.`,
  );
});

Deno.test("the known-unmetered list may shrink, never grow", () => {
  // Pinned. A fourth unmetered function is a regression, and the number is the
  // cheapest possible way to notice one.
  assertEquals(
    Object.keys(KNOWN_UNMETERED).length, 3,
    "adding an unmetered provider call is a regression — wire it to the seam instead",
  );
  for (const p of Object.keys(KNOWN_UNMETERED)) {
    const f = FILES.find((x) => x.path === p);
    assert(f, `KNOWN_UNMETERED names "${p}", which no longer exists — remove the entry`);
    assert(
      providerCallSites(f!.text).length > 0,
      `"${p}" no longer calls a provider — remove it from KNOWN_UNMETERED`,
    );
  }
});

Deno.test("every accounted seam still exists and still calls a provider", () => {
  // An allow-list entry for a deleted file protects nothing and hides the next
  // real one.
  for (const p of Object.keys(ACCOUNTED)) {
    const f = FILES.find((x) => x.path === p);
    assert(f, `ACCOUNTED names "${p}", which no longer exists`);
  }
});

// ══════════ 2. deleted implementations stay deleted ═══════════════════════

Deno.test("chat-respond is gone, and nothing references it", () => {
  assert(
    !FILES.some((f) => f.path.startsWith("chat-respond/")),
    "chat-respond was deleted: it had no caller, duplicated pilot-chat, had a " +
      "broken Gemini branch, and had no workspace to attribute spend to",
  );
  const refs = FILES.filter((f) => f.text.includes("chat-respond")).map((f) => f.path);
  assertEquals(refs, [], `dangling chat-respond references: ${refs.join(", ")}`);
});

Deno.test("the deleted screening orphans stay deleted", () => {
  // Each had zero callers anywhere in the repo; two made unmetered model calls.
  for (const d of [
    "adaptive-screening-chat", "generate-screening-questions",
    "getResumeAnalysis", "saveResumeAnalysis", "analyze-behavioral-signals",
  ]) {
    assert(
      !FILES.some((f) => f.path.startsWith(`${d}/`)),
      `${d} was deleted as an orphan — restoring it needs a caller and a seam`,
    );
  }
});

Deno.test("Perplexity cannot be reached", () => {
  const callers = FILES
    .filter((f) => providerCallSites(f.text).some((l) => l.includes("api.perplexity.ai")))
    .map((f) => f.path);
  assertEquals(callers, [], `Perplexity call sites: ${callers.join(", ")}`);
  const keyReaders = FILES.filter((f) => f.text.includes("PERPLEXITY_API_KEY")).map((f) => f.path);
  assertEquals(keyReaders, [], "nothing may read the Perplexity key");
});

// ══════════ 3. one canonical chat backend ═════════════════════════════════

Deno.test("pilot-chat is the only chat entrypoint", () => {
  assert(
    FILES.some((f) => f.path === "pilot-chat/index.ts"),
    "pilot-chat is the canonical chat backend and must exist",
  );
  // The property that matters: no OTHER function serves chat by talking to a
  // provider itself. `orchestrate` plans and delegates; it holds no provider URL.
  const orchestrate = FILES.find((f) => f.path === "orchestrate/index.ts");
  assert(orchestrate, "orchestrate must exist");
  assertEquals(
    providerCallSites(orchestrate!.text), [],
    "orchestrate must delegate to the shared providers, never call one itself",
  );
});
