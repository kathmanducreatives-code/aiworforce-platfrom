// A LOCAL STAND-IN FOR THE MODEL. LOOPBACK ONLY, AND IT NEVER SPENDS.
//
// Local development deliberately has no OPENAI_API_KEY, so the execution
// planner — a model call — fails with `no_api_key` and the lead pipeline stops
// before a single stage runs. That makes the whole chain below planning
// untestable locally, which is the opposite of what a local stack is for.
//
// This server answers OpenAI's chat-completions shape with a DETERMINISTIC
// plan, derived from the payload the planner itself sends: it reads
// `authorised_capabilities` out of the user message and picks the first
// capability and one of ITS OWN actors. It invents nothing, so it cannot
// propose a capability the mission never authorised — the containment guard
// would refuse that, and rightly.
//
// It is not a model. It does not reason, rank or qualify. It exists so that the
// queue → worker → task → stages → Workbench path can be exercised end to end
// without money, and anything that depends on real judgement will look exactly
// as empty as it should.
//
//   deno run --allow-net=127.0.0.1 scripts/local-supabase/model-stub.ts
const PORT = Number(Deno.env.get("MODEL_STUB_PORT") ?? 8791);

interface Actor { actor_key?: string; key?: string }
interface Cap { capability?: string; actors?: Actor[] }

/** The planner's payload travels as the user message, pretty-printed JSON. */
function readPayload(body: unknown): Record<string, unknown> | null {
  const msgs = (body as { messages?: { role?: string; content?: unknown }[] })?.messages ?? [];
  const user = [...msgs].reverse().find((m) => m.role === "user");
  if (typeof user?.content !== "string") return null;
  try { return JSON.parse(user.content) as Record<string, unknown>; } catch { return null; }
}

function planFor(payload: Record<string, unknown> | null): unknown {
  const caps = (payload?.authorised_capabilities ?? []) as Cap[];
  const first = caps.find((c) => (c.actors ?? []).length > 0) ?? caps[0];
  if (!first?.capability) {
    // NOTHING WAS AUTHORISED. An empty plan is the honest answer; the engine
    // already knows what to do with one (`no_valid_step`).
    return { reasoning: "stub: no authorised capability in the payload", steps: [] };
  }
  const a = (first.actors ?? [])[0];
  const actor_key = a?.actor_key ?? a?.key ?? null;
  return {
    reasoning:
      "LOCAL STUB PLAN — one step on the first authorised capability. No model " +
      "ran; this exists to exercise the execution path, not to choose well.",
    steps: [{
      capability: first.capability,
      actor_key,
      purpose: "local smoke test: exercise the capability path without spending",
      input_json: "{}",
      depends_on: [],
    }],
  };
}

Deno.serve({ port: PORT, hostname: "127.0.0.1" }, async (req) => {
  const url = new URL(req.url);
  if (!url.pathname.endsWith("/chat/completions")) {
    return new Response(JSON.stringify({ error: { message: "stub: only /chat/completions" } }),
      { status: 404, headers: { "content-type": "application/json" } });
  }
  let body: unknown = null;
  try { body = await req.json(); } catch { /* answered below as an empty plan */ }
  const payload = readPayload(body);
  const content = JSON.stringify(planFor(payload));
  const purpose = (body as { metadata?: { purpose?: string } })?.metadata?.purpose ?? "";
  console.log(`[model-stub] ${new Date().toISOString()} purpose=${purpose || "?"} caps=${
    ((payload?.authorised_capabilities ?? []) as Cap[]).length} → ${content.length}b`);
  return new Response(JSON.stringify({
    id: "chatcmpl-local-stub", object: "chat.completion",
    created: Math.floor(Date.now() / 1000), model: "local-stub",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    // Zero usage: nothing was bought, and the cost model should say so.
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }), { headers: { "content-type": "application/json" } });
});
console.log(`[model-stub] listening on http://127.0.0.1:${PORT}/v1 (loopback only)`);
