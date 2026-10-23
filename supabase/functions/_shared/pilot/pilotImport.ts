import { guardPilotStore } from "./pilotNativeAccess.ts";
// P3 preview only: no commit action, persistence store, task binding, or executor.
import { authenticateUser, defaultAuthDeps } from "../requestAuth.ts";
import { type PilotContextDeps } from "./pilotContext.ts";
import { CORS, json } from "./pilotHttp.ts";
import {
  loadPilotEnrollment,
  object,
  PilotRefusal,
  validId,
} from "./pilotPolicy.ts";
import { digest, PilotAccess } from "./pilotScope.ts";
import { createPilotScopeStore } from "./pilotScopeStore.ts";
import { CsvRefusal, parsePilotCsv } from "./pilotCsv.ts";
import { previewCsv } from "./pilotImportContract.ts";
// JSON escaping may expand the 250KB UTF-8 CSV by up to 6x. Bound the envelope too.
async function readBody(req: Request) {
  if (!req.body) throw new PilotRefusal("invalid_request", 400);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1_600_000) {
        await reader.cancel();
        throw new PilotRefusal("request_too_large", 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    return object(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  } catch (e) {
    if (e instanceof PilotRefusal) throw e;
    throw new PilotRefusal("invalid_request", 400);
  } finally {
    reader.releaseLock();
  }
}
export async function handlePilotImport(
  req: Request,
  deps: PilotContextDeps = defaultAuthDeps,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    if (
      deps.env("OUTPOST_PILOT_CSV_PREVIEW_ENABLED") !== "true" ||
      deps.env("OUTPOST_PILOT_CONTEXT_ENABLED") !== "true"
    ) throw new PilotRefusal("pilot_csv_preview_disabled", 503);
    // A service bearer never imports/previews on behalf of an unspecified client.
    const auth = await authenticateUser(req, deps);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    const body = await readBody(req);
    if (
      typeof body.action !== "string" ||
      !["inspect", "preview"].includes(body.action) ||
      Object.keys(body).some((k) =>
        ![
          "action",
          "workspace_id",
          "client_binding_id",
          "csv",
          "approved_existing_leads",
          ...(body.action === "preview" ? ["mapping"] : []),
        ].includes(k)
      )
    ) throw new PilotRefusal("invalid_request", 400);
    if (body.approved_existing_leads !== true) {
      throw new PilotRefusal("existing_leads_approval_required", 400);
    }
    if (!validId(body.workspace_id) || !validId(body.client_binding_id)) {
      throw new PilotRefusal("explicit_client_scope_required", 400);
    }
    const enrollment = loadPilotEnrollment(
      deps.env,
      body.workspace_id,
      body.client_binding_id,
    );
    const store = guardPilotStore(
      deps.store?.() ?? createPilotScopeStore(deps),
      deps,
      auth.token,
      enrollment,
      null,
    );
    const access = await PilotAccess.forUser(store, enrollment, auth.userId);
    if (typeof body.csv !== "string") {
      throw new PilotRefusal("invalid_request", 400);
    }
    const scope = access.summary();
    const fileBytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(body.csv),
    );
    const file_hash = [...new Uint8Array(fileBytes)].map((b) =>
      b.toString(16).padStart(2, "0")
    ).join(""); // Exact decoded UTF-8 text, including BOM/line endings.
    let result: Record<string, unknown>;
    if (body.action === "inspect") {
      const parsed = parsePilotCsv(body.csv);
      result = { headers: parsed.headers, input_rows: parsed.rows.length };
    } else {
      const preview = await previewCsv(body.csv, body.mapping);
      const rows = await Promise.all(preview.rows.map(async (r) => ({
        ...r,
        ...scope,
        preview_row_key: await digest({
          scope,
          actor: auth.userId,
          file_hash,
          source_rows: r.source_rows,
          normalized_hash: r.normalized_hash,
        }),
      })));
      result = { ...preview, rows };
    }
    const preview_hash = await digest({
      scope,
      actor: auth.userId,
      policy: enrollment,
      file_hash,
      result,
    });
    await access.recheck();
    return json({
      action: body.action,
      scope,
      source: "apollo_export_declared_unverified",
      file_hash,
      preview_hash,
      ...result,
      capabilities: {
        preview_only: true,
        persist: false,
        task_creation: false,
        research: false,
        model: false,
        apollo_api: false,
        export: false,
        dispatch: false,
      },
    });
  } catch (e) {
    return e instanceof PilotRefusal
      ? json({ error: e.code }, e.status)
      : e instanceof CsvRefusal
      ? json({ error: e.message }, 400)
      : json({ error: "pilot_csv_preview_unavailable" }, 503);
  }
}
