import { authenticateUser, defaultAuthDeps, type AuthDeps } from "../_shared/requestAuth.ts";

// USER ENDPOINT. Exchanging or refreshing a Google token uses Agentory's OAuth
// CLIENT SECRET; that proxy was open to anyone with the anon key. The caller
// must now be a signed-in user. (The refresh branch also read the request body
// twice, which always threw — it reads it once.)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export async function handleGoogleCalendarAuth(req: Request, deps: AuthDeps = defaultAuthDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await authenticateUser(req, deps);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const clientId = deps.env("GOOGLE_CALENDAR_ID");
  const clientSecret = deps.env("GOOGLE_CALENDAR_CLIENT_SECRET");

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = body.action;
    const redirectUri = typeof body.redirectUri === "string" ? body.redirectUri : "";

    if (action === "get-auth-url") {
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", clientId ?? "");
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/calendar.events"].join(" "));
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      return json({ authUrl: authUrl.toString() });
    }

    if (action === "exchange-code" || action === "refresh-token") {
      const params = action === "exchange-code"
        ? { client_id: clientId ?? "", client_secret: clientSecret ?? "", code: String(body.code ?? ""), grant_type: "authorization_code", redirect_uri: redirectUri }
        : { client_id: clientId ?? "", client_secret: clientSecret ?? "", refresh_token: String(body.refresh_token ?? ""), grant_type: "refresh_token" };
      const tokenResponse = await deps.fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params),
      });
      const tokenData = await tokenResponse.json();
      if (tokenData.error) return json({ error: "google_token_error" }, 400);
      return json(action === "exchange-code"
        ? { access_token: tokenData.access_token, refresh_token: tokenData.refresh_token, expires_in: tokenData.expires_in }
        : { access_token: tokenData.access_token, expires_in: tokenData.expires_in });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (error) {
    console.error("[google-calendar-auth] error:", String(error));
    return json({ error: "calendar_auth_failed" }, 500);
  }
}

if (!Deno.env.get("GOOGLE_CALENDAR_AUTH_IMPORT_ONLY")) Deno.serve((req) => handleGoogleCalendarAuth(req));
