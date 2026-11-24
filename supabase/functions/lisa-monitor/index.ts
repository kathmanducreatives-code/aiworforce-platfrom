// lisa-monitor — LISA V2 (see handler.ts). Disabled unless LISA_V2_ENABLED=true.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleLisa, type AdminClient } from "./handler.ts";

Deno.serve((req) => {
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  return handleLisa(req, {
    env: (k) => Deno.env.get(k),
    admin: admin as unknown as AdminClient,
    userIdFor: async (token) => {
      const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${token}` } } });
      const { data, error } = await anon.auth.getUser(token);
      return error || !data?.user?.id ? null : data.user.id;
    },
  });
});
