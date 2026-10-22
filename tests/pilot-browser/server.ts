// Only loopback and synthetic data. No Supabase/default fetch/credentials.
import { p8Workflow } from "../edge-functions/_helpers/pilotP8Workflow.ts";
const sessions = new Map<string, Awaited<ReturnType<typeof p8Workflow>>>();
const json = (v: unknown, status = 200) => Response.json(v, { status });
Deno.serve({ hostname: "127.0.0.1", port: 8788 }, async (req) => {
  const url = new URL(req.url);
  // No real JWT, no customer input, no exposure as an Edge Function.
  if (
    req.method !== "POST" ||
    req.headers.get("x-p8-fixture") !== "synthetic-only" ||
    !["127.0.0.1:8788", "127.0.0.1:5178"].includes(
      req.headers.get("host") ?? "",
    )
  ) return json({ error: "refused" }, 403);
  const origin = req.headers.get("origin");
  if (origin && origin !== "http://127.0.0.1:5178") {
    return json({ error: "origin_refused" }, 403);
  }
  try {
    const r = await req.json();
    if (url.pathname === "/fixture/start") {
      if (!["A", "B"].includes(r.client) || typeof r.csv !== "string") {
        return json({ error: "fixture_only" }, 400);
      }
      const x = await p8Workflow(r.client, r.csv), token = crypto.randomUUID();
      sessions.set(token, x);
      return json({ token, scope: x.scope, preview: x.preview });
    }
    const x = sessions.get(req.headers.get("x-p8-token") ?? "");
    if (!x) return json({ error: "fixture_session_missing" }, 403);
    if (url.pathname === "/fixture/inspect") {
      return json(await x.service.inspect(r.scope));
    }
    if (url.pathname === "/fixture/review") {
      return json(await x.service.review(r.scope, r.request));
    }
    if (url.pathname === "/fixture/export") {
      return json(await x.service.prepare(r.scope, r.request));
    }
    if (url.pathname === "/fixture/revoke") {
      x.f.n.tables.workspace_members = [];
      return json({ revoked: true });
    }
    if (url.pathname === "/fixture/receipt") {
      return json({
        model_attempts: x.accounting.runtimeAttempts,
        model_receipts: x.accounting.receipts.size,
        source_loads: x.loads(),
        events: x.events.commits,
        external_requests: x.f.n.external.length,
        packet_hash: x.packet.packet_hash,
        packet_version: x.packet.version,
        durable_database: false,
      });
    }
    return json({ error: "not_found" }, 404);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "refused" }, 409);
  }
});
