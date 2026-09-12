// GENERATE A CONTENT IMAGE — the one server-side path.
//
// ── WHY A SEPARATE OPERATION ────────────────────────────────────────────────
//
// Text and image are separate costs and separate decisions. Regenerating text
// must not silently spend on a new image, and regenerating an image must not
// rewrite the copy. Keeping them separate endpoints is what makes that true by
// construction rather than by care.
//
// ── WHY NOT IN THE BROWSER ──────────────────────────────────────────────────
//
// The obvious shortcut is to call OpenAI from React and upload the result. That
// puts an image key in a bundle that already ships an anon key to every visitor.
// The provider is resolved here, the key is read here, and the browser asks for
// "an image for this draft" and receives an asset id.
//
// ── THE ROW EXISTS BEFORE THE PROVIDER IS CALLED ────────────────────────────
//
// A `pending` asset is written first. If generation fails or the isolate dies
// mid-call, the attempt is visible as `failed` rather than as silence — an
// image that cost money and never arrived is otherwise unfindable.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveImageProvider, imageTelemetryToModelTelemetry, type ImageCallTelemetry,
} from "../_shared/imageProvider.ts";
import { createLedgerWriter, recordModelCall, type LedgerDb } from "../_shared/executionLedger.ts";
import {
  authorizeModelSpend, resolveSpendEnforcement, resolveCeiling, describeSpend, spendRefusalMessage,
  MODEL_SPEND_REFUSED, type SpendDb,
} from "../_shared/modelSpendCeiling.ts";
import { buildVisualPrompt } from "../_shared/contentVisualBrief.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const BUCKET = "content-assets";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return json({ error: "server_misconfigured" }, 500);

  let body: { content_item_id?: string; workspace_id?: string; size?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const contentItemId = String(body.content_item_id ?? "");
  const workspaceId = String(body.workspace_id ?? "");
  if (!contentItemId || !workspaceId) return json({ error: "missing_required_fields" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // ── WORKSPACE MEMBERSHIP, NOT JUST A VALID TOKEN ─────────────────────────
  //
  // The service role bypasses RLS, so everything below would happily write into
  // any tenant. A browser caller must prove membership of the workspace it
  // names; a server caller (the service key) has already been gated upstream.
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!bearer) return json({ error: "Unauthorized" }, 401);

  if (bearer !== SERVICE_KEY) {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authz } },
    });
    const { data: userData } = await userClient.auth.getUser(bearer);
    const userId = userData?.user?.id;
    if (!userId) return json({ error: "Unauthorized" }, 401);
    const { data: member } = await admin
      .from("workspace_members").select("workspace_id")
      .eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
    if (!member) return json({ error: "forbidden" }, 403);
  }

  // ── the draft this image is for ──────────────────────────────────────────
  const { data: item } = await admin
    .from("content_item")
    .select("id, workspace_id, title, body, format, current_version_id, metadata")
    .eq("id", contentItemId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!item) return json({ error: "content_item_not_found" }, 404);

  const row = item as {
    id: string; title: string | null; body: string; format: string;
    current_version_id: string | null; metadata: Record<string, unknown> | null;
  };

  // A draft with no text has no visual to brief. Generating one anyway would
  // spend on an image for a post that does not exist yet.
  if (!row.body.trim()) return json({ error: "no_draft_to_illustrate" }, 409);

  const prompt = buildVisualPrompt({
    format: row.format,
    title: row.title,
    body: row.body,
    // Scribe's visual brief when it produced one; the draft itself otherwise.
    visualBrief: (row.metadata?.visual_brief as string | undefined) ?? null,
  });

  // ── THE WORKSPACE CEILING, BEFORE ANYTHING IS SPENT ──────────────────────
  //
  // An image is the most expensive single call Content can make, and until now
  // it was the only model call in the codebase that consulted no budget. The
  // ceiling sums `lead_model_calls`, which these calls now enter, so an image
  // both COUNTS toward the ceiling and is STOPPED by it — counting without
  // being stopped is how a runaway loop bills a workspace to the limit and then
  // keeps going.
  //
  // Checked before the pending asset row: a refusal is not a failed generation.
  // Nothing was spent and nothing was attempted, so there is no attempt to
  // record — writing a `failed` asset here would put a fault in the user's
  // history for a decision the system made on purpose.
  const spend = await authorizeModelSpend({
    db: admin as unknown as SpendDb,
    workspace_id: workspaceId,
    mode: resolveSpendEnforcement(),
    ...resolveCeiling(),
  });
  if (!spend.allowed || spend.reason !== "under_ceiling") {
    console.log("[generate-content-image][model-spend]", describeSpend(spend));
  }
  if (!spend.allowed) {
    return json({ error: MODEL_SPEND_REFUSED, reason: spend.reason, detail: spendRefusalMessage(spend) }, 429);
  }

  // ── the pending row, before any spend ────────────────────────────────────
  const { data: created, error: createErr } = await admin
    .from("content_asset")
    .insert({
      workspace_id: workspaceId,
      content_item_id: row.id,
      content_version_id: row.current_version_id,
      asset_type: "image",
      status: "pending",
      generation_source: "scribe_visual",
      generation_prompt: prompt,
    })
    .select("id")
    .single();
  if (createErr || !created) return json({ error: "asset_create_failed", detail: createErr?.message }, 500);
  const assetId = (created as { id: string }).id;

  const provider = resolveImageProvider();
  const calls: ImageCallTelemetry[] = [];
  const result = await provider.generate(
    { prompt, workspaceId, size: (body.size as never) ?? undefined },
    { onImageCall: (t) => { calls.push(t); } },
  );

  // ── ACCOUNTING, success or failure ───────────────────────────────────────
  //
  // Written before the outcome is returned, and for a failure too: a call that
  // reached the provider may have been billed whether or not an image came
  // back.
  //
  // THROUGH THE CANONICAL WRITER, not a hand-rolled insert. The first version
  // of this built its own `insert` and omitted `reason` — NOT NULL, no default
  // — so every row was rejected and the only trace was a `console.warn`. Both
  // production canary images generated, were stored, and cost money while the
  // ledger stayed empty. `recordModelCall` fills the columns the table demands
  // and lands the row in `lead_model_calls`, which is what model-spend queries
  // and the USD ceiling actually read.
  const ledger = createLedgerWriter(admin as unknown as LedgerDb);
  for (const c of calls) {
    await recordModelCall(ledger, {
      workspace_id: workspaceId,
      task_id: null,
      telemetry: imageTelemetryToModelTelemetry(c),
      ok: result.ok,
      failure_code: c.failure_code,
      // The vendor that charged, from the provider itself — not a constant.
      provider_id: c.provider,
      logical_call_key: `content_image:${assetId}`,
      request_input: { operation: "content_image", model: c.model, size: c.size },
    });
  }

  if (!result.ok || !result.bytes) {
    await admin.from("content_asset")
      .update({ status: "failed", failure_reason: (result.error ?? "unknown").slice(0, 300) })
      .eq("id", assetId);
    // THE TEXT DRAFT IS UNHARMED. A failed image must never invalidate the copy
    // it was going to illustrate.
    return json({ error: "image_generation_failed", detail: result.error, asset_id: assetId }, 502);
  }

  // ── the file, in storage, not in Postgres ────────────────────────────────
  //
  // Keyed by workspace first, so the storage policy can check membership from
  // the path without joining back to the row.
  const path = `${workspaceId}/${row.id}/${assetId}.png`;
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, result.bytes, { contentType: result.contentType, upsert: false });
  if (upErr) {
    await admin.from("content_asset")
      .update({ status: "failed", failure_reason: `storage: ${upErr.message}`.slice(0, 300) })
      .eq("id", assetId);
    return json({ error: "asset_store_failed", detail: upErr.message, asset_id: assetId }, 500);
  }

  const { error: readyErr } = await admin.from("content_asset")
    .update({
      status: "ready",
      storage_path: path,
      provider: result.provider,
      model: result.model,
      width: result.width,
      height: result.height,
      // The provider URL is provenance only — it expires, so it is never the
      // thing anything reads the image from.
      metadata: { source_url: result.sourceUrl },
    })
    .eq("id", assetId);
  if (readyErr) return json({ error: "asset_finalize_failed", detail: readyErr.message }, 500);

  // The newest ready asset becomes current. History is kept: nothing is
  // overwritten, a pointer moves.
  await admin.from("content_item")
    .update({ current_asset_id: assetId })
    .eq("id", row.id)
    .eq("workspace_id", workspaceId);

  return json({
    ok: true, asset_id: assetId, storage_path: path,
    provider: result.provider, model: result.model,
    width: result.width, height: result.height,
  }, 201);
});
