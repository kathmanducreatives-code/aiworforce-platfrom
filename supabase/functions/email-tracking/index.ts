import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// PUBLIC TRACKING BEACON — verified against the stored email.
//
// Email clients load the open pixel and follow click links with no session, so
// this endpoint cannot require a user. What it must not be is what it was: an
// OPEN REDIRECT (any `url` was followed, so our domain could front a phishing
// link) and a free writer into email_tracking for any id at all. Now:
//   * the id must be a UUID of an email that exists;
//   * a click redirects only to an http(s) link that appears in THAT email;
//   * anything else records nothing and redirects nowhere.

const TRACKING_PIXEL = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
  0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21,
  0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
  0x01, 0x00, 0x3b,
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TrackingDeps { env: (k: string) => string | undefined; fetch: typeof fetch }
const defaultDeps: TrackingDeps = { env: (k) => Deno.env.get(k), fetch: (i, n) => fetch(i, n) };

const pixel = () => new Response(TRACKING_PIXEL, {
  headers: { "Content-Type": "image/gif", "Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0" },
});

/** A redirect target is allowed only if it is http(s) and that exact link is in the email. */
export function isRedirectAllowed(url: string, emailContent: string | null): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  return typeof emailContent === "string" && emailContent.includes(url);
}

export async function handleEmailTracking(req: Request, deps: TrackingDeps = defaultDeps): Promise<Response> {
  const u = new URL(req.url);
  const type = u.searchParams.get("type");
  const emailId = u.searchParams.get("id") ?? "";
  const redirectUrl = u.searchParams.get("url");

  if (type !== "open" && type !== "click") return new Response("Invalid tracking type", { status: 400 });
  // An open always answers with the pixel, so a mail client never shows a broken image.
  if (!UUID_RE.test(emailId)) return type === "open" ? pixel() : new Response("Invalid link", { status: 400 });

  const supabase = createClient(deps.env("SUPABASE_URL")!, deps.env("SUPABASE_SERVICE_ROLE_KEY")!, {
    global: { fetch: deps.fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userAgent = req.headers.get("user-agent") || "";
  const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "unknown";

  try {
    const { data: email } = await supabase.from("scheduled_emails").select("id,content").eq("id", emailId).maybeSingle();
    if (!email) return type === "open" ? pixel() : new Response("Invalid link", { status: 400 });

    if (type === "open") {
      await supabase.from("email_tracking").insert({ scheduled_email_id: emailId, event_type: "open", user_agent: userAgent, ip_address: ipAddress });
      return pixel();
    }

    if (!redirectUrl || !isRedirectAllowed(redirectUrl, (email as { content?: string | null }).content ?? null)) {
      return new Response("Invalid link", { status: 400 });
    }
    await supabase.from("email_tracking").insert({
      scheduled_email_id: emailId, event_type: "click", link_url: redirectUrl, user_agent: userAgent, ip_address: ipAddress,
    });
    return new Response(null, { status: 302, headers: { "Location": redirectUrl, "Cache-Control": "no-cache, no-store, must-revalidate" } });
  } catch (error) {
    console.error("[email-tracking] error:", String(error));
    return type === "open" ? pixel() : new Response("Tracking error", { status: 500 });
  }
}

if (!Deno.env.get("EMAIL_TRACKING_IMPORT_ONLY")) Deno.serve((req) => handleEmailTracking(req));
