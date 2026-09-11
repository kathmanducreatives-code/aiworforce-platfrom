// A FAILED IMAGE SAYS WHY.
//
// Live canary, 2026-09-11: an image regeneration was refused by OpenAI (no
// credits) and the Studio showed "Edge Function returned a non-2xx status
// code" — supabase-js's text for ANY non-2xx. The function's own reason rides on
// `error.context`; the service now reads it. The spend ceiling's refusal takes
// the same road, so a user told "ceiling reached" is told the truth.
//
// ZERO network.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { functionErrorDetail } from "../../src/lib/content/functionError.ts";

const src = await Deno.readTextFile(new URL("../../src/lib/content/contentService.ts", import.meta.url));

const httpError = (status: number, body: unknown) => ({
  message: "Edge Function returned a non-2xx status code",
  context: new Response(JSON.stringify(body), { status }),
});

Deno.test("the ceiling's refusal is reported as the ceiling", async () => {
  assertEquals(await functionErrorDetail(httpError(429, { error: "model_spend_refused", detail: "workspace model spend ceiling reached" })),
    "workspace model spend ceiling reached");
});

Deno.test("a provider failure is reported as the provider's reason", async () => {
  assertEquals(await functionErrorDetail(httpError(502, { error: "image_generation_failed", detail: "OpenAI images 429: You have no credits remaining. (credit_balance_exhausted)" })),
    "OpenAI images 429: You have no credits remaining. (credit_balance_exhausted)");
});

Deno.test("no body, or no context: null — the caller falls back to the transport message", async () => {
  assertEquals(await functionErrorDetail({ message: "x" }), null);
  assertEquals(await functionErrorDetail({ message: "x", context: new Response("not json", { status: 500 }) }), null);
  assertEquals(await functionErrorDetail(httpError(404, { error: "content_item_not_found" })), "content_item_not_found");
});

Deno.test("the image action uses it", async () => {
  const s = src.slice(src.indexOf("export async function generateContentImage"));
  if (!s.includes("(await functionErrorDetail(error)) ?? error.message")) throw new Error("generateContentImage must surface the server's reason");
});
