// integration-readiness: returns provider availability. Pure read of secret
// presence; never returns secret values.
//
// READ-ONLY. It used to mirror the map into company_brain.profile on every call
// — and Content and Signals call it on every visit — rewriting the whole Brain
// from a copy read moments earlier, which could silently revert a concurrent
// edit. Agents now read the same map live (_shared/integrationReadiness.ts).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildIntegrationStatus } from "../_shared/integrationReadiness.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: uerr } = await userClient.auth.getUser(authHeader.replace("Bearer ", ""));
  if (uerr || !userData?.user?.id) return json({ error: "Unauthorized" }, 401);

  const providers = buildIntegrationStatus();

  const summary = {
    connected: Object.values(providers).filter((p) => p.status === "connected").length,
    setup_needed: Object.values(providers).filter((p) => p.status === "setup_needed").length,
    optional: Object.values(providers).filter((p) => p.status === "optional").length,
  };

  return json({ ok: true, providers, summary });
});
