import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PUBLISHED_URL = "https://screeningpilot.lovable.app";

interface NotificationRequest {
  action: "candidate_confirmation" | "recruiter_new_application" | "candidate_status_update";
  application_id: string;
  new_status?: string;
  custom_message?: string;
}

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

async function getApplicationWithJob(supabase: any, applicationId: string) {
  const { data, error } = await supabase
    .from("screening_applications")
    .select("*, screening_jobs(*)")
    .eq("id", applicationId)
    .single();
  if (error) throw new Error(`Application not found: ${error.message}`);
  return data;
}

async function getRecruiterEmail(supabase: any, userId: string) {
  const { data } = await supabase.auth.admin.getUserById(userId);
  return data?.user?.email || null;
}

function candidateConfirmationHtml(candidateName: string, jobTitle: string, companyName: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background-color:#0a0a0a;margin:0;padding:40px 20px;">
<div style="max-width:600px;margin:0 auto;background-color:#111;border-radius:12px;overflow:hidden;border:1px solid #222;">
<div style="background:linear-gradient(135deg,#3ECF8E 0%,#2a9d6a 100%);padding:30px;text-align:center;">
<h1 style="color:#000;margin:0;font-size:24px;font-weight:700;">Application Received</h1></div>
<div style="padding:40px 30px;">
<p style="color:#fff;font-size:18px;margin:0 0 20px;">Hi ${candidateName},</p>
<p style="color:#ccc;font-size:16px;line-height:1.6;margin:0 0 20px;">Thank you for applying for <strong style="color:#fff;">${jobTitle}</strong> at <strong style="color:#fff;">${companyName}</strong>. We've received your application and screening responses.</p>
<div style="background-color:#1a1a1a;border-radius:12px;padding:24px;margin:20px 0;border:1px solid #333;">
<p style="color:#3ECF8E;font-size:16px;font-weight:600;margin:0;">What happens next?</p>
<p style="color:#ccc;font-size:14px;line-height:1.6;margin:10px 0 0;">Our team will review your application and get back to you within 3–5 business days. No further action is needed from you at this time.</p></div>
<p style="color:#ccc;font-size:16px;margin-top:30px;">Best regards,<br><span style="color:#fff;font-weight:600;">${companyName} Recruiting Team</span></p></div>
<div style="background-color:#0a0a0a;padding:20px 30px;text-align:center;border-top:1px solid #222;">
<p style="color:#666;font-size:12px;margin:0;">Sent via ScreeningPilot</p></div></div></body></html>`;
}

function recruiterNewApplicationHtml(
  candidateName: string, jobTitle: string, matchScore: number | null,
  matchCategory: string | null, strengths: any[], jobId: string
) {
  const categoryLabel: Record<string, string> = {
    strong_fit: "Strong Fit", good_fit: "Good Fit", maybe: "Maybe", not_qualified: "Not Qualified",
  };
  const categoryColor: Record<string, string> = {
    strong_fit: "#10b981", good_fit: "#f59e0b", maybe: "#6b7280", not_qualified: "#ef4444",
  };
  const cat = matchCategory || "pending";
  const label = categoryLabel[cat] || "Pending";
  const color = categoryColor[cat] || "#6b7280";
  const scoreText = matchScore != null ? `${matchScore}%` : "N/A";
  const topStrengths = (strengths || []).slice(0, 3).map((s: any) => typeof s === "string" ? s : s?.text || "").filter(Boolean);
  const strengthsHtml = topStrengths.length > 0
    ? topStrengths.map((s: string) => `<li style="color:#ccc;font-size:14px;margin-bottom:6px;">✅ ${s}</li>`).join("")
    : '<li style="color:#888;font-size:14px;">No strengths data yet</li>';
  const dashboardLink = `${PUBLISHED_URL}/screening-jobs/${jobId}`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background-color:#0a0a0a;margin:0;padding:40px 20px;">
<div style="max-width:600px;margin:0 auto;background-color:#111;border-radius:12px;overflow:hidden;border:1px solid #222;">
<div style="background:linear-gradient(135deg,#3ECF8E 0%,#2a9d6a 100%);padding:30px;text-align:center;">
<h1 style="color:#000;margin:0;font-size:24px;font-weight:700;">New Applicant</h1></div>
<div style="padding:40px 30px;">
<p style="color:#fff;font-size:18px;margin:0 0 20px;">A new candidate has completed screening for <strong>${jobTitle}</strong>.</p>
<div style="background-color:#1a1a1a;border-radius:12px;padding:24px;margin:20px 0;border:1px solid #333;">
<p style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;">Candidate</p>
<p style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">${candidateName}</p>
<div style="display:flex;gap:20px;">
<div><p style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px;">Score</p>
<p style="color:#fff;font-size:24px;font-weight:700;margin:0;">${scoreText}</p></div>
<div><p style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px;">Category</p>
<span style="background-color:${color}22;color:${color};padding:4px 12px;border-radius:20px;font-size:14px;font-weight:600;">${label}</span></div></div></div>
<div style="margin:20px 0;"><p style="color:#fff;font-size:14px;font-weight:600;margin:0 0 8px;">Top Strengths</p>
<ul style="margin:0;padding-left:20px;">${strengthsHtml}</ul></div>
<div style="margin:30px 0;text-align:center;">
<a href="${dashboardLink}" style="background-color:#3ECF8E;color:#000;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:600;display:inline-block;">Review Applicant</a></div></div>
<div style="background-color:#0a0a0a;padding:20px 30px;text-align:center;border-top:1px solid #222;">
<p style="color:#666;font-size:12px;margin:0;">Sent via ScreeningPilot</p></div></div></body></html>`;
}

function candidateStatusUpdateHtml(candidateName: string, jobTitle: string, companyName: string, newStatus: string, customMessage?: string) {
  const statusMessages: Record<string, string> = {
    reviewing: "Your application is currently being reviewed by our team.",
    interview_scheduled: "Great news! We'd like to schedule an interview with you. Our team will reach out shortly with available times.",
    rejected: "After careful consideration, we've decided to move forward with other candidates for this position. We appreciate your time and interest.",
    hired: "Congratulations! We're excited to extend an offer to you. Our team will reach out with next steps.",
  };
  const message = customMessage || statusMessages[newStatus] || `Your application status has been updated to: ${newStatus}.`;
  const statusLabel: Record<string, string> = {
    reviewing: "Under Review", interview_scheduled: "Interview Scheduled",
    rejected: "Application Update", hired: "Offer Extended", new: "Received",
  };
  const heading = statusLabel[newStatus] || "Application Update";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background-color:#0a0a0a;margin:0;padding:40px 20px;">
<div style="max-width:600px;margin:0 auto;background-color:#111;border-radius:12px;overflow:hidden;border:1px solid #222;">
<div style="background:linear-gradient(135deg,#3ECF8E 0%,#2a9d6a 100%);padding:30px;text-align:center;">
<h1 style="color:#000;margin:0;font-size:24px;font-weight:700;">${heading}</h1></div>
<div style="padding:40px 30px;">
<p style="color:#fff;font-size:18px;margin:0 0 20px;">Hi ${candidateName},</p>
<p style="color:#ccc;font-size:16px;line-height:1.6;margin:0 0 20px;">Regarding your application for <strong style="color:#fff;">${jobTitle}</strong> at <strong style="color:#fff;">${companyName}</strong>:</p>
<div style="background-color:#1a1a1a;border-radius:12px;padding:24px;margin:20px 0;border:1px solid #333;">
<p style="color:#ccc;font-size:16px;line-height:1.6;margin:0;">${message}</p></div>
<p style="color:#888;font-size:14px;line-height:1.6;margin-top:30px;">If you have any questions, please don't hesitate to reach out.</p>
<p style="color:#ccc;font-size:16px;margin-top:30px;">Best regards,<br><span style="color:#fff;font-weight:600;">${companyName} Recruiting Team</span></p></div>
<div style="background-color:#0a0a0a;padding:20px 30px;text-align:center;border-top:1px solid #222;">
<p style="color:#666;font-size:12px;margin:0;">Sent via ScreeningPilot</p></div></div></body></html>`;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, application_id, new_status, custom_message }: NotificationRequest = await req.json();
    const supabase = getSupabaseAdmin();
    const app = await getApplicationWithJob(supabase, application_id);
    const job = app.screening_jobs;
    const extracted = app.extracted_data as any;
    const candidateName = extracted?.name || "Candidate";
    const candidateEmail = extracted?.email;

    console.log(`Processing ${action} for application ${application_id}`);

    if (action === "candidate_confirmation") {
      if (!candidateEmail) {
        return new Response(JSON.stringify({ success: false, error: "No candidate email" }), {
          status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      const html = candidateConfirmationHtml(candidateName, job.title, job.company_name);
      await resend.emails.send({
        from: `${job.company_name} <onboarding@resend.dev>`,
        to: [candidateEmail],
        subject: `Application Received — ${job.title}`,
        html,
      });
      console.log(`Candidate confirmation sent to ${candidateEmail}`);
    }

    if (action === "recruiter_new_application") {
      const recruiterEmail = await getRecruiterEmail(supabase, job.user_id);
      if (!recruiterEmail) {
        return new Response(JSON.stringify({ success: false, error: "No recruiter email" }), {
          status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      const categoryLabel: Record<string, string> = {
        strong_fit: "Strong Fit", good_fit: "Good Fit", maybe: "Maybe", not_qualified: "Not Qualified",
      };
      const label = categoryLabel[app.match_category || ""] || "New";
      const html = recruiterNewApplicationHtml(
        candidateName, job.title, app.match_score, app.match_category, app.strengths || [], job.id
      );
      await resend.emails.send({
        from: `ScreeningPilot <onboarding@resend.dev>`,
        to: [recruiterEmail],
        subject: `New Applicant: ${candidateName} — ${label}`,
        html,
      });
      console.log(`Recruiter notification sent to ${recruiterEmail}`);
    }

    if (action === "candidate_status_update") {
      if (!candidateEmail) {
        return new Response(JSON.stringify({ success: false, error: "No candidate email" }), {
          status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      const html = candidateStatusUpdateHtml(candidateName, job.title, job.company_name, new_status || "reviewing", custom_message);
      await resend.emails.send({
        from: `${job.company_name} <onboarding@resend.dev>`,
        to: [candidateEmail],
        subject: `Application Update — ${job.title}`,
        html,
      });
      console.log(`Status update email sent to ${candidateEmail}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Notification error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
