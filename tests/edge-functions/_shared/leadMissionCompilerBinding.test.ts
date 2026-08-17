// THE COMPILER MUST NAME A MODEL THE ADAPTER WILL ACTUALLY ACCEPT.
//
// On TEST the flag was on, the allow-list held both workspaces, LOVABLE_API_KEY
// was set, and `isMissionCompilerEnabled` returned `enabled` — yet every mission
// came out of the deterministic parser. The binding pinned `gpt-5.6-luna`, the
// OpenAI *wire* id, while the strategist allow-list is built from the CANONICAL
// (vendor-prefixed) configured models. `LovableAIStrategistProvider.complete`
// rejected it with `model_not_allowed` before sending anything, and
// `proposeMission` — which by design reports any failure as "no proposal" —
// turned that into a silent, permanent fallback. Zero network, zero cost, zero
// signal.
//
// Every binding failure here is invisible by construction, so the id itself has
// to be asserted. The behavioural test additionally proves the REAL transport is
// reached, because a mocked `generate` bypasses the allow-list entirely — which
// is precisely why the existing suite never caught this.
//
// ZERO real network: `fetch` is stubbed and restored.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMissionCompilerBinding, isMissionCompilerEnabled,
  DEFAULT_MISSION_COMPILER_MODEL,
} from "../../../supabase/functions/_shared/leadMissionCompilerBinding.ts";
import {
  LEAD_STRATEGY_ALLOWED_MODELS,
} from "../../../supabase/functions/_shared/leadStrategyModels.ts";

const MY = "00000000-0000-0000-0000-000000000001";

/** Flag on, this workspace allowed. Injected — never the real environment. */
const envOn = (ws: string) => (k: string): string | undefined =>
  k === "GPT_LEAD_MISSION_COMPILER"
    ? "true"
    : k === "GPT_LEAD_MISSION_COMPILER_WORKSPACES"
    ? ws
    : undefined;

Deno.test("1. the pinned compiler model is one the strategist adapter allows", () => {
  assert(
    LEAD_STRATEGY_ALLOWED_MODELS.includes(DEFAULT_MISSION_COMPILER_MODEL),
    `${DEFAULT_MISSION_COMPILER_MODEL} is not in [${LEAD_STRATEGY_ALLOWED_MODELS.join(", ")}]. ` +
      "The adapter would answer model_not_allowed and the compiler would never run.",
  );
});

Deno.test("2. the canonical id is vendor-prefixed, not the OpenAI wire form", () => {
  assert(
    DEFAULT_MISSION_COMPILER_MODEL.includes("/"),
    "an unprefixed id is the wire form; the allow-list is built from canonical ids",
  );
});

Deno.test("3. enablement is unchanged by the model id", () => {
  const e = isMissionCompilerEnabled(MY, envOn(MY));
  assertEquals(e.enabled, true);
  assertEquals(e.reason, "enabled");
  assertEquals(e.model, DEFAULT_MISSION_COMPILER_MODEL);
});

// THE ONE THAT WOULD HAVE CAUGHT IT. No injected `generate`: the production
// facade is exercised end-to-end down to the transport seam.
//
// ── RETARGETED 2026-08-17: THE TRANSPORT IS NOW OPENAI ────────────────────
//
// This asserted the Lovable gateway and the strategist model id. That was
// accurate and was itself the finding: even with `GPT_LEAD_MISSION_COMPILER`
// ON, mission compilation went to Lovable/Claude — so "enable the flag" would
// never have produced a GPT-first architecture, only a different non-GPT one.
// The seam still matters; the endpoint behind it changed.
Deno.test("4. the real facade reaches the OpenAI transport and returns a proposal", async () => {
  const realFetch = globalThis.fetch;
  const realKey = Deno.env.get("OPENAI_API_KEY");
  Deno.env.set("OPENAI_API_KEY", "sk-test-not-a-credential");

  const seen: Array<{ url: string; model: unknown }> = [];
  globalThis.fetch = ((url: string, init: RequestInit) => {
    seen.push({ url: String(url), model: JSON.parse(String(init.body)).model });
    return Promise.resolve(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{"proposed":true}' } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  }) as typeof fetch;

  try {
    const binding = buildMissionCompilerBinding({ workspaceId: MY, read: envOn(MY) });
    assert(binding.proposeMission !== null, "an enabled binding must expose proposeMission");

    const proposal = await binding.proposeMission!({
      originalUserQuery: "Find 10 founders at B2B SaaS companies hiring sales teams.",
      requestedCount: 10,
    });

    assertEquals(seen.length, 1, "the model must be called exactly once");
    assert(
      seen[0].url.includes("openai.com"),
      `mission compilation must reach OpenAI, reached ${seen[0].url}`,
    );
    assertEquals(proposal, { proposed: true }, "a successful call must yield a proposal");
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) Deno.env.delete("OPENAI_API_KEY");
    else Deno.env.set("OPENAI_API_KEY", realKey);
  }
});
