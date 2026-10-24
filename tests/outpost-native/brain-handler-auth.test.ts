// Unmodified #169 Edge handlers + actual local GoTrue/PostgREST/SQL.
// Replaces gateway routing only; external requests are refused, never simulated.
// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  closeHarness,
  REST_URL,
  seedWorkspace,
  sql,
} from "../db-contract/lib/harness.ts";
import { authUrl, login } from "./lib/auth.ts";
import { jwt, opts } from "./fixture.ts";

type Handler = (request: Request) => Response | Promise<Response>;
async function loadHandler(path: string): Promise<Handler> {
  const original = Object.getOwnPropertyDescriptor(Deno, "serve")!;
  let captured: Handler | undefined;
  Object.defineProperty(Deno, "serve", {
    configurable: original.configurable,
    enumerable: original.enumerable,
    writable: true,
    value: (handler: Handler) => {
      assert(!captured, "one entry point per actual module");
      captured = handler;
      return { shutdown: () => Promise.resolve() };
    },
  });
  try {
    await import(path);
    assert(captured, "capture actual entrypoint, never a reproduced handler");
    return captured;
  } finally {
    Object.defineProperty(Deno, "serve", original);
  }
}
const handlers = [
  {
    name: "setup",
    path: "../../supabase/functions/setup-company-brain/index.ts",
  },
  {
    name: "update",
    path: "../../supabase/functions/generate-company-brain-draft/index.ts",
  },
];
type Case =
  | "owner"
  | "admin"
  | "editor"
  | "viewer"
  | "revoked"
  | "foreign"
  | "logged_out"
  | "member"
  | "revoke_inflight"
  | "demote_inflight"
  | "logout_inflight";
const cases: Case[] = [
  "owner",
  "admin",
  "editor",
  "viewer",
  "revoked",
  "foreign",
  "logged_out",
  "member",
  "revoke_inflight",
  "demote_inflight",
  "logout_inflight",
];
const loaded = new Map<string, Handler>();
for (const h of handlers) {
  for (const scenario of cases) {
    Deno.test({
      ...opts,
      name: `Brain Edge ${h.name}: ${scenario} authorization and native write`,
      fn: async () => {
        const { x, session } = await login();
        const workspace = await seedWorkspace(); // NON-enrolled agency Brain: #169 owns this path.
        await sql`insert into public.company_brain(workspace_id,profile) values (${workspace},${
          sql.json({ company: { name: "Before synthetic edit" } })
        }) on conflict(workspace_id) do update set profile=excluded.profile`;
        if (scenario !== "foreign") {
          const role =
            ["owner", "admin", "editor", "viewer", "member"].includes(scenario)
              ? scenario
              : "owner";
          await sql`insert into public.workspace_members(workspace_id,user_id,role) values (${workspace},${x.ua},${role})`;
        }
        if (
          scenario === "revoked"
        ) {
          await sql`delete from public.workspace_members where workspace_id=${workspace} and user_id=${x.ua}`;
        }
        if (scenario === "logged_out") {
          const r = await fetch(authUrl + "/logout?scope=global", {
            method: "POST",
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          assertEquals(r.status, 204);
          await r.text();
          assertEquals(
            (await sql`select id from auth.sessions where id=${x.sa}`).length,
            0,
          );
        }
        for (
          const key of [
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "APIFY_API_TOKEN",
            "FIRECRAWL_API_KEY",
            "LOVABLE_API_KEY",
          ]
        ) {
          Deno.env.delete(key);
        }
        const before =
          (await sql`select to_jsonb(b) r from public.company_brain b where workspace_id=${workspace}`)[
            0
          ].r;
        Deno.env.set("SUPABASE_URL", REST_URL);
        Deno.env.set(
          "SUPABASE_ANON_KEY",
          (await jwt(x.ua, null, { role: "anon" })).token,
        );
        Deno.env.set(
          "SUPABASE_SERVICE_ROLE_KEY",
          (await jwt(x.ua, null, { role: "service_role" })).token,
        );
        let handler = loaded.get(h.name);
        if (!handler) {
          handler = await loadHandler(h.path);
          loaded.set(h.name, handler);
        }
        const originalFetch = globalThis.fetch;
        let external = 0, writes = 0, revoked = false;
        globalThis.fetch = async (input, init) => {
          const req = new Request(input, init);
          let destination = req.url;
          if (destination.startsWith(REST_URL + "/auth/v1/")) {
            destination = authUrl +
              destination.slice((REST_URL + "/auth/v1").length);
          } else if (destination.startsWith(REST_URL + "/rest/v1/")) {
            destination = REST_URL +
              destination.slice((REST_URL + "/rest/v1").length);
            if (
              destination.startsWith(REST_URL + "/company_brain?") &&
              req.method === "GET" && scenario.endsWith("inflight") && !revoked
            ) {
              // The membership SELECT returned; the actual handler passed its role check.
              // A second connection commits revocation before its Brain read/write.
              revoked = true;
              if (scenario === "revoke_inflight") {
                await sql`delete from public.workspace_members where workspace_id=${workspace} and user_id=${x.ua}`;
              } else if (scenario === "demote_inflight") {
                await sql`update public.workspace_members set role='viewer' where workspace_id=${workspace} and user_id=${x.ua}`;
              } else {
                // Real GoTrue logout, not a simulated Auth result.
                const out = await originalFetch(
                  authUrl + "/logout?scope=global",
                  {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${session.access_token}`,
                    },
                  },
                );
                assertEquals(out.status, 204);
                await out.text();
                assertEquals(
                  (await sql`select id from auth.sessions where id=${x.sa}`)
                    .length,
                  0,
                );
              }
            }
            if (!["GET", "HEAD"].includes(req.method)) writes++;
          } else {
            external++;
            throw new Error("external request forbidden in native Brain audit");
          }
          const out = await originalFetch(new Request(destination, req));
          return out;
        };
        let response: Response;
        let body: string;
        try {
          const payload = h.name === "setup"
            ? {
              action: "save_basics",
              workspace_id: workspace,
              company_name: "After synthetic edit",
            }
            : {
              action: "update",
              workspace_id: workspace,
              expected_updated_at: before.updated_at,
              patch: { company: { name: "After synthetic edit" } },
            };
          response = await handler(
            new Request("http://127.0.0.1/offline-brain-handler", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${session.access_token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            }),
          );
          body = await response.text();
        } finally {
          globalThis.fetch = originalFetch;
        }
        assertEquals(external, 0, "zero model/provider/website/send calls");
        const after =
          (await sql`select to_jsonb(b) r from public.company_brain b where workspace_id=${workspace}`)[
            0
          ].r;
        const changed = JSON.stringify(before) !== JSON.stringify(after);
        console.log(
          JSON.stringify({
            handler: h.name,
            scenario,
            status: response.status,
            changed,
            writes,
            revoked,
            external_calls: external,
            response: body,
          }),
        );
        if (["owner", "admin", "editor"].includes(scenario)) {
          assertEquals(response.status, 200);
          assert(
            changed,
            "positive control must land a distinct actual SQL write",
          );
        } else {
          if (scenario.endsWith("inflight")) {
            assert(
              revoked,
              "race must actually commit before handler proceeds",
            );
          }
          assert(
            [401, 403].includes(response.status),
            "lost authorization must refuse",
          );
          assertEquals(
            changed,
            false,
            "lost authorization must not write through the service client",
          );
          assertEquals(
            writes,
            0,
            "refuse before service write, not merely through RLS",
          );
        }
      },
    });
  }
}
Deno.test({
  ...opts,
  name: "close actual Brain handler native audit",
  fn: closeHarness,
});
