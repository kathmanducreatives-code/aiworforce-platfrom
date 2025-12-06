import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const resendApiKey = Deno.env.get("RESEND_API_KEY");
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Base URL for tracking endpoints
const TRACKING_BASE_URL = `${supabaseUrl}/functions/v1/email-tracking`;

function addTrackingToEmail(emailId: string, htmlContent: string): string {
  // Add tracking pixel for open tracking
  const trackingPixel = `<img src="${TRACKING_BASE_URL}?type=open&id=${emailId}" width="1" height="1" style="display:none;" alt="" />`;
  
  // Replace links with tracked links
  const trackedContent = htmlContent.replace(
    /<a\s+([^>]*href=["'])([^"']+)(["'][^>]*)>/gi,
    (match, before, url, after) => {
      // Don't track mailto links or anchor links
      if (url.startsWith('mailto:') || url.startsWith('#')) {
        return match;
      }
      const trackedUrl = `${TRACKING_BASE_URL}?type=click&id=${emailId}&url=${encodeURIComponent(url)}`;
      return `<a ${before}${trackedUrl}${after}>`;
    }
  );
  
  // Add tracking pixel before closing body tag or at the end
  if (trackedContent.includes('</body>')) {
    return trackedContent.replace('</body>', `${trackingPixel}</body>`);
  }
  return trackedContent + trackingPixel;
}

function textToHtml(text: string): string {
  // Convert plain text to HTML with basic formatting
  return text
    .split('\n\n')
    .map(para => `<p>${para.replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("Starting scheduled email processing...");

  if (!resendApiKey) {
    console.error("RESEND_API_KEY not configured");
    return new Response(
      JSON.stringify({ error: "RESEND_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const resend = new Resend(resendApiKey);
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Get pending emails where send_time_utc has passed
    const now = new Date().toISOString();
    console.log(`Fetching pending emails with send_time_utc <= ${now}`);

    const { data: pendingEmails, error: fetchError } = await supabase
      .from("scheduled_emails")
      .select("*")
      .eq("status", "pending")
      .lte("send_time_utc", now)
      .limit(50); // Process in batches

    if (fetchError) {
      console.error("Error fetching emails:", fetchError);
      throw fetchError;
    }

    console.log(`Found ${pendingEmails?.length || 0} emails to send`);

    if (!pendingEmails || pendingEmails.length === 0) {
      return new Response(
        JSON.stringify({ message: "No pending emails to send", sent: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let sentCount = 0;
    let failedCount = 0;
    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const email of pendingEmails) {
      try {
        console.log(`Sending email to ${email.candidate_email} (ID: ${email.id})`);

        // Convert content to HTML and add tracking
        const htmlContent = textToHtml(email.content || "");
        const trackedHtml = addTrackingToEmail(email.id, htmlContent);

        // Send email via Resend
        const emailResponse = await resend.emails.send({
          from: `${email.sender_name || "Recruiter"} <onboarding@resend.dev>`,
          to: [email.candidate_email],
          subject: email.subject || "No Subject",
          html: trackedHtml,
        });

        console.log(`Email sent successfully to ${email.candidate_email}:`, emailResponse);

        // Update status to sent
        const { error: updateError } = await supabase
          .from("scheduled_emails")
          .update({ 
            status: "sent",
            scheduled_send_time: now 
          })
          .eq("id", email.id);

        if (updateError) {
          console.error(`Error updating email status for ${email.id}:`, updateError);
        }

        sentCount++;
        results.push({ id: email.id, success: true });

      } catch (sendError: any) {
        console.error(`Failed to send email ${email.id}:`, sendError);
        failedCount++;
        results.push({ id: email.id, success: false, error: sendError.message });

        // Update status to failed
        await supabase
          .from("scheduled_emails")
          .update({ status: "failed" })
          .eq("id", email.id);
      }
    }

    console.log(`Completed: ${sentCount} sent, ${failedCount} failed`);

    return new Response(
      JSON.stringify({
        message: "Email processing completed",
        sent: sentCount,
        failed: failedCount,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error in send-scheduled-emails:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
