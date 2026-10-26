// Native PostgreSQL+PostgREST proof; no mocked query/RLS/transaction behavior.
// auth.sessions rows and signed JWTs are synthetic platform fixtures, NOT GoTrue proof.
// deno-lint-ignore-file no-import-prefix
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mintJwt,
  REST_URL,
  seedWorkspace,
  sql,
  uuid,
} from "../db-contract/lib/harness.ts";
import { PilotAccess } from "../../supabase/functions/_shared/pilot/pilotScope.ts";
import { createPilotScopeStore } from "../../supabase/functions/_shared/pilot/pilotScopeStore.ts";
import type { PilotEnrollment } from "../../supabase/functions/_shared/pilot/pilotPolicy.ts";

export const opts = { sanitizeResources: false, sanitizeOps: false };
export const signing = "synthetic-native-signing-key-not-production-123456789";
const secret = Deno.env.get("DB_CONTRACT_JWT_SECRET")!;
const b64 = (v: string | Uint8Array) =>
  btoa(typeof v === "string" ? v : String.fromCharCode(...v)).replace(/=/g, "")
    .replace(/\+/g, "-").replace(/\//g, "_");
export async function jwt(
  sub: string,
  sid: string | null,
  extra: Record<string, unknown> = {},
) {
  const claims = {
    role: "authenticated",
    sub,
    session_id: sid,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...extra,
  };
  const input = `${b64(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${
    b64(JSON.stringify(claims))
  }`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = `${input}.${
    b64(
      new Uint8Array(
        await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input)),
      ),
    )
  }`;
  return { token: signed, claims };
}
export async function api(
  token: string | null,
  path: string,
  method = "GET",
  body?: unknown,
  profile = "outpost_private",
) {
  const r = await fetch(`${REST_URL}/${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Accept-Profile": profile,
      "Content-Profile": profile,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await r.text();
  return { status: r.status, body: raw ? JSON.parse(raw) : null };
}
export const denied = (r: { status: number }) =>
  assert(
    [400, 401, 403, 404, 406].includes(r.status),
    `expected refusal, got ${r.status}`,
  );

export async function fixture(owner?: { userId: string; sessionId: string }) {
  const a = await seedWorkspace(),
    b = await seedWorkspace(),
    ua = owner?.userId ?? uuid(),
    ub = uuid(),
    viewer = uuid(),
    shared = uuid();
  const ca = uuid(),
    cb = uuid(),
    sa = owner?.sessionId ?? uuid(),
    sb = uuid(),
    sv = uuid(),
    ss = uuid();
  for (const u of [ua, ub, viewer, shared]) {
    if (owner && u === owner.userId) {
      assert((await sql`select id from auth.users where id=${u}`).length === 1);
    } else {
      await sql`insert into auth.users(id) values (${u})`;
    }
  }
  for (
    const [w, u, role] of [
      [a, ua, "owner"],
      [b, ub, "owner"],
      [a, viewer, "viewer"],
      [a, shared, "admin"],
      [b, shared, "admin"],
    ]
  ) {
    await sql`insert into public.workspace_members(workspace_id,user_id,role) values (${w},${u},${role})`;
  }
  for (const [s, u] of [[sa, ua], [sb, ub], [sv, viewer], [ss, shared]]) {
    if (owner && s === owner.sessionId) {
      assert(
        (await sql`select id from auth.sessions where id=${s} and user_id=${u}`)
          .length === 1,
      );
    } else {
      await sql`insert into auth.sessions(id,user_id) values (${s},${u})`;
    }
  }
  const enrollments: PilotEnrollment[] = [];
  for (const [w, c, label] of [[a, ca, "a"], [b, cb, "b"]]) {
    const domain = `native-${label}.example`;
    await sql`insert into public.company_brain(workspace_id,onboarding_completed,profile)
      values (${w},true,${
      sql.json({
        company: { name: `Native ${label}`, website_url: `https://${domain}` },
      })
    })`;
    await sql`insert into outpost_private.clients(workspace_id,client_binding_id,seller_domain,configuration_version)
      values (${w},${c},${domain},1)`;
    enrollments.push({
      workspace_id: w,
      client_binding_id: c,
      seller_domain: domain,
      version: 1,
      mode: "draft_only",
      credentials: [],
      destinations: [],
    });
  }
  const service = await mintJwt("service_role");
  const store = createPilotScopeStore({
    env: (k) =>
      k === "SUPABASE_URL"
        ? REST_URL
        : k === "SUPABASE_SERVICE_ROLE_KEY"
        ? service
        : undefined,
    fetch: (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url;
      return fetch(url.replace(`${REST_URL}/rest/v1`, REST_URL), init);
    },
  });
  const makeTask = async (
    e: PilotEnrollment,
    u: string,
    originSession?: string,
    initialResult?: Record<string, unknown>,
  ) => {
    const id = uuid();
    await sql`insert into public.tasks(id,workspace_id,user_id,status,payload)
      values (${id},${e.workspace_id},${u},'ready',${
      sql.json({
        execution_mode: "pilot_draft_only",
        ...(originSession ? { pilot_origin_session_id: originSession } : {}),
        apollo_account_id: "same-company-id",
        contact_email: "same@synthetic.example",
      })
    })`;
    if (initialResult) {
      await sql`update public.tasks set result=${
        sql.json(initialResult as never)
      } where id=${id}`;
    }
    const access = await PilotAccess.forUser(store, e, u);
    await access.bindTask(id, [], signing);
    await PilotAccess.forTask(store, e, id, signing, u); // Actual original P1 HMAC verifier.
    return id;
  };
  const ta = await makeTask(enrollments[0], ua),
    tb = await makeTask(enrollments[1], ub);
  const register = async (
    w: string,
    c: string,
    t: string,
    u: string,
    s: string,
  ) => {
    await sql`insert into outpost_private.task_bindings(workspace_id,client_binding_id,task_id,actor_id,session_id)
      values (${w},${c},${t},${u},${s})`;
  };
  await register(a, ca, ta, ua, sa);
  await register(b, cb, tb, ub, sb);
  return {
    a,
    b,
    ua,
    ub,
    viewer,
    shared,
    ca,
    cb,
    sa,
    sb,
    sv,
    ss,
    ta,
    tb,
    service,
    enrollments,
    store,
    makeTask,
    register,
  };
}
