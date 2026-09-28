import { withBuildStamp } from "../_shared/buildStamp.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { authenticateUser, defaultAuthDeps, type AuthDeps } from "../_shared/requestAuth.ts";

// USER ENDPOINT. "Send pending emails" sends THE CALLER'S OWN due emails and
// nothing else. It used to be callable by anyone holding the public anon key,
// and it sent EVERY user's due emails through Agentory's Resend account —
// together with a permissive insert policy on scheduled_emails, a relay for
// arbitrary mail. The caller is authenticated and every read and write is
// scoped to `user_id = caller`.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** At most this many emails per call. */
export const SEND_BATCH_LIMIT = 50;

export function trackingBase(supabaseUrl: string): string {
  return `${supabaseUrl}/functions/v1/email-tracking`;
}

export function addTrackingToEmail(base: string, emailId: string, htmlContent: string): string {
  const trackingPixel = `<img src="${base}?type=open&id=${emailId}" width="1" height="1" style="display:none;" alt="" />`;
  const trackedContent = htmlContent.replace(
    /<a\s+([^>]*href=["'])([^"']+)(["'][^>]*)>/gi,
    (match, before, url, after) => {
      if (url.startsWith("mailto:") || url.startsWith("#")) return match;
      return `<a ${before}${base}?type=click&id=${emailId}&url=${encodeURIComponent(url)}${after}>`;
    },
  );
  if (trackedContent.includes("</body>")) return trackedContent.replace("</body>", `${trackingPixel}</body>`);
  return trackedContent + trackingPixel;
}

function textToHtml(text: string): string {
  return text.split("\n\n").map((para) => `<p>${para.replace(/\n/g, "<br/>")}</p>`).join("");
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export async function handleSendScheduledEmails(req: Request, deps: AuthDeps = defaultAuthDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await authenticateUser(req, deps);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const userId = auth.userId;

  const resendApiKey = deps.env("RESEND_API_KEY");
  const supabaseUrl = deps.env("SUPABASE_URL")!;
  const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY");
  if (!resendApiKey || !serviceKey) return json({ error: "email_sending_not_configured" }, 500);

  const supabase = createClient(supabaseUrl, serviceKey, {
    global: { fetch: deps.fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const now = new Date().toISOString();
    const { data: pendingEmails, error: fetchError } = await supabase
      .from("scheduled_emails")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "pending")
      .lte("send_time_utc", now)
      .limit(SEND_BATCH_LIMIT);
    if (fetchError) throw fetchError;

    if (!pendingEmails || pendingEmails.length === 0) {
      return json({ message: "No pending emails to send", sent: 0 });
    }

    let sentCount = 0;
    let failedCount = 0;
    const results: Array<{ id: string; success: boolean; error?: string }> = [];
    const base = trackingBase(supabaseUrl);

    for (const email of pendingEmails) {
      try {
        const trackedHtml = addTrackingToEmail(base, email.id, textToHtml(email.content || ""));
        const emailResponse = await deps.fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: `${email.sender_name || "Recruiter"} <onboarding@resend.dev>`,
            to: [email.candidate_email],
            subject: email.subject || "No Subject",
            html: trackedHtml,
          }),
        });
        if (!emailResponse.ok) throw new Error(`Resend API error: ${emailResponse.status}`);

        await supabase.from("scheduled_emails")
          .update({ status: "sent", scheduled_send_time: now })
          .eq("id", email.id).eq("user_id", userId);
        sentCount++;
        results.push({ id: email.id, success: true });
      } catch (sendError) {
        console.error(`[send-scheduled-emails] failed ${email.id}:`, String(sendError));
        failedCount++;
        results.push({ id: email.id, success: false, error: "send_failed" });
        await supabase.from("scheduled_emails").update({ status: "failed" })
          .eq("id", email.id).eq("user_id", userId);
      }
    }

    return json({ message: "Email processing completed", sent: sentCount, failed: failedCount, results });
  } catch (error) {
    console.error("[send-scheduled-emails] error:", String(error));
    return json({ error: "email_processing_failed" }, 500);
  }
}

if (!Deno.env.get("SEND_SCHEDULED_EMAILS_IMPORT_ONLY")) Deno.serve(withBuildStamp((req) => handleSendScheduledEmails(req)));
