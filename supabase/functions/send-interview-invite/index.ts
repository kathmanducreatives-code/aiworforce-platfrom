import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InterviewInviteRequest {
  candidateName: string;
  candidateEmail: string;
  scheduledAt: string;
  durationMinutes: number;
  meetingLink?: string;
  recruiterName?: string;
  companyName?: string;
  notes?: string;
}

const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const formatTime = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
  return `${hours} hour${hours > 1 ? 's' : ''} ${remainingMinutes} minutes`;
};

const generateGoogleCalendarLink = (
  title: string,
  startDate: string,
  durationMinutes: number,
  description: string,
  location?: string
): string => {
  const start = new Date(startDate);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  
  // Format: YYYYMMDDTHHMMSSZ
  const formatGoogleDate = (date: Date) => 
    date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${formatGoogleDate(start)}/${formatGoogleDate(end)}`,
    details: description,
  });
  
  if (location) params.append('location', location);
  
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      candidateName,
      candidateEmail,
      scheduledAt,
      durationMinutes,
      meetingLink,
      recruiterName,
      companyName,
    }: InterviewInviteRequest = await req.json();

    console.log("Sending interview invite to:", candidateEmail);

    const formattedDate = formatDate(scheduledAt);
    const formattedTime = formatTime(scheduledAt);
    const formattedDuration = formatDuration(durationMinutes);
    const senderName = companyName || recruiterName || "ScreeningPilot";

    // Generate Google Calendar link
    const calendarTitle = `Interview with ${companyName || recruiterName || 'ScreeningPilot'}`;
    const calendarDescription = `Interview scheduled for ${candidateName}${meetingLink ? `\n\nMeeting Link: ${meetingLink}` : ''}`;
    const googleCalendarLink = generateGoogleCalendarLink(
      calendarTitle,
      scheduledAt,
      durationMinutes,
      calendarDescription,
      meetingLink
    );

    const meetingButtonHtml = meetingLink
      ? `
        <div style="margin: 20px 0;">
          <a href="${meetingLink}" 
             style="background-color: #3ECF8E; color: #000; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">
            Join Meeting
          </a>
        </div>
        <p style="color: #888; font-size: 14px; margin-top: 10px;">
          Meeting Link: <a href="${meetingLink}" style="color: #3ECF8E;">${meetingLink}</a>
        </p>
      `
      : `
        <div style="background-color: #1a1a1a; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <p style="color: #888; margin: 0; font-size: 14px;">
            Meeting details will be shared separately.
          </p>
        </div>
      `;

    const googleCalendarButtonHtml = `
      <div style="margin: 20px 0; text-align: center;">
        <a href="${googleCalendarLink}" 
           target="_blank"
           style="background-color: #1a73e8; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">
          📅 Add to Google Calendar
        </a>
      </div>
    `;

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0a0a0a; margin: 0; padding: 40px 20px;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #111; border-radius: 12px; overflow: hidden; border: 1px solid #222;">
          
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #3ECF8E 0%, #2a9d6a 100%); padding: 30px; text-align: center;">
            <h1 style="color: #000; margin: 0; font-size: 24px; font-weight: 700;">
              Interview Scheduled
            </h1>
          </div>
          
          <!-- Content -->
          <div style="padding: 40px 30px;">
            <p style="color: #fff; font-size: 18px; margin: 0 0 30px 0;">
              Hi ${candidateName},
            </p>
            
            <p style="color: #ccc; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
              You've been scheduled for an interview. Here are the details:
            </p>
            
            <!-- Interview Details Card -->
            <div style="background-color: #1a1a1a; border-radius: 12px; padding: 24px; margin-bottom: 30px; border: 1px solid #333;">
              <div style="margin-bottom: 20px;">
                <p style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 6px 0;">Date</p>
                <p style="color: #fff; font-size: 18px; font-weight: 600; margin: 0;">${formattedDate}</p>
              </div>
              <div style="margin-bottom: 20px;">
                <p style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 6px 0;">Time</p>
                <p style="color: #fff; font-size: 18px; font-weight: 600; margin: 0;">${formattedTime}</p>
              </div>
              <div>
                <p style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 6px 0;">Duration</p>
                <p style="color: #fff; font-size: 18px; font-weight: 600; margin: 0;">${formattedDuration}</p>
              </div>
            </div>
            
            ${googleCalendarButtonHtml}
            
            ${meetingButtonHtml}
            
            <p style="color: #888; font-size: 14px; line-height: 1.6; margin-top: 30px;">
              If you have any questions or need to reschedule, please don't hesitate to reach out.
            </p>
            
            <p style="color: #ccc; font-size: 16px; margin-top: 30px;">
              Best regards,<br>
              <span style="color: #fff; font-weight: 600;">${recruiterName || 'The Recruiting Team'}</span>
            </p>
          </div>
          
          <!-- Footer -->
          <div style="background-color: #0a0a0a; padding: 20px 30px; text-align: center; border-top: 1px solid #222;">
            <p style="color: #666; font-size: 12px; margin: 0;">
              Sent via ${senderName}
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    const { data, error } = await resend.emails.send({
      from: `${senderName} <onboarding@resend.dev>`,
      to: [candidateEmail],
      subject: `Interview Scheduled - ${formattedDate} at ${formattedTime}`,
      html: emailHtml,
    });

    if (error) {
      console.error("Resend error:", error);
      throw error;
    }

    console.log("Interview invite sent successfully:", data);

    return new Response(
      JSON.stringify({ success: true, data }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error sending interview invite:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
