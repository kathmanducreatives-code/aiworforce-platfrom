// EVERY CONTENT ENTRYPOINT STAYS ON THE SAME SERVICES.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// Content had four ways in — the page, the signal cards, the prompt box and
// Pilot chat — and each one built its own English sentence and dispatched it.
// Nothing shared a contract, so "generate from a signal" meant something
// slightly different in every one of them and none of them persisted anything.
//
// The architecture fixes that by routing all four through `contentService`.
// Nothing STOPS a fifth entrypoint from going around it again, which is how the
// first four drifted apart. These tests are the thing that stops it: they read
// the real source and fail when a caller invents its own path.
//
// ZERO network, ZERO database, ZERO models. Source text only.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = new URL("../../src/", import.meta.url);

async function read(rel: string): Promise<string> {
  return await Deno.readTextFile(new URL(rel, SRC));
}

async function exists(rel: string): Promise<boolean> {
  try { await Deno.stat(new URL(rel, SRC)); return true; } catch { return false; }
}

/** Code with comments removed. A name in prose is not a call. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => (l.trim().startsWith("//") ? "" : l.replace(/\s\/\/.*$/, "")))
    .join("\n");
}

const SERVICE = "lib/content/contentService.ts";

// ══════════ 1. the service is the only door ═══════════════════════════════

Deno.test("1. the content service exists and exposes the whole workflow", async () => {
  const s = stripComments(await read(SERVICE));
  for (const op of [
    "createContent", "regenerateContentText", "saveContentEdit",
    "approveContent", "generateContentImage", "listContent",
    "getContentVersions", "getContentAssets", "signedAssetUrl",
  ]) {
    assert(s.includes(`export async function ${op}`) || s.includes(`export const ${op}`),
      `contentService must export ${op} — a caller that cannot find it writes its own`);
  }
});

Deno.test("2. no Content surface calls the generation edge function directly", async () => {
  // The specific regression: a component that invokes `run-agent` itself gets
  // generation without persistence, which is the UI shell this replaced.
  const surfaces = [
    "pages/Content.tsx",
    "components/content/ContentComposer.tsx",
    "components/content/ContentDetailDrawer.tsx",
  ];
  const offenders: string[] = [];
  for (const f of surfaces) {
    if (!await exists(f)) continue;
    const s = stripComments(await read(f));
    if (/functions\.invoke\(\s*['"]run-agent['"]/.test(s)) offenders.push(f);
    if (/functions\.invoke\(\s*['"]generate-content-image['"]/.test(s)) offenders.push(f);
  }
  assertEquals(offenders, [],
    `these Content surfaces call an edge function directly instead of going ` +
    `through contentService: ${offenders.join(", ")}`);
});

// ══════════ 2. no key, no model, no provider in the browser ═══════════════

Deno.test("3. the frontend never names a provider, a model or a key", async () => {
  const s = stripComments(await read(SERVICE));
  for (const forbidden of [
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "api.openai.com", "api.anthropic.com",
    "gpt-image-1", "claude-haiku", "gpt-4",
  ]) {
    assert(!s.includes(forbidden),
      `contentService names "${forbidden}". The backend chooses the provider; a ` +
      `frontend that names one has to be redeployed to change it, and a frontend ` +
      `that holds a key ships it to every visitor.`);
  }
});

// ══════════ 3. the honest failure contract ════════════════════════════════

Deno.test("4. a failed generation still leaves the user a draft", async () => {
  const s = stripComments(await read(SERVICE));
  // `createContent` must return the item alongside the error. Returning only an
  // error is what left users with a toast and nothing to retry.
  const fn = s.slice(s.indexOf("export async function createContent"));
  const body = fn.slice(0, fn.indexOf("\nexport "));
  assert(/return \{ ok: false, item, error:/.test(body),
    "createContent must return the draft with the error — the row exists, only " +
    "the generation failed, and the user needs it to press Regenerate");
});

Deno.test("5. a hand edit never inherits model provenance", async () => {
  const s = stripComments(await read(SERVICE));
  const fn = s.slice(s.indexOf("export async function saveContentEdit"));
  const body = fn.slice(0, fn.indexOf("\nexport "));
  assert(body.includes("last_generation_source: 'manual_edit'"),
    "saveContentEdit must state manual_edit explicitly; the database trigger " +
    "keys the model/provider/task columns off it, and a hand edit that omitted " +
    "it inherited the generation it edited");
});

// ══════════ 4. text and image stay separate spends ════════════════════════

Deno.test("6. regenerating text does not generate an image", async () => {
  const s = stripComments(await read(SERVICE));
  const fn = s.slice(s.indexOf("export async function regenerateContentText"));
  const body = fn.slice(0, fn.indexOf("\nexport "));
  assert(!body.includes("generate-content-image") && !body.includes("generateContentImage"),
    "text regeneration must not spend on an image — separate cost, separate " +
    "decision, and the user pressed one button");
});

Deno.test("7. images are read through signed URLs, never a public bucket", async () => {
  const s = stripComments(await read(SERVICE));
  assert(s.includes("createSignedUrl"),
    "content-assets is private: drafts are unpublished work, and getPublicUrl " +
    "would make every generated image world-readable by URL");
  assert(!s.includes("getPublicUrl"), "no public URL may be minted for a draft asset");
});
