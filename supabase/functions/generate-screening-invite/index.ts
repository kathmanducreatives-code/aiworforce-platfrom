import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

// n8n webhook URL for screening backend
const N8N_WEBHOOK_URL = 'https://n8n.prasidha.me/webhook/screening';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      candidate_id, 
      template_id = null,
      role_briefing = null,
      scenario_config = null,
      scenario_count = 3, 
      expires_in_days = 7, 
      send_email = true,
      skip_webhook = false, // When true, skip n8n call (already synced in Step 3)
    } = await req.json();

    if (!candidate_id) {
      return new Response(JSON.stringify({ error: 'candidate_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log('Creating screening with context:', { template_id, role_briefing: !!role_briefing, scenario_config: !!scenario_config, skip_webhook });

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Get candidate info
    const { data: candidate, error: candidateError } = await supabase
      .from('resume_analyses')
      .select('*')
      .eq('id', candidate_id)
      .single();

    if (candidateError || !candidate) {
      return new Response(JSON.stringify({ error: 'Candidate not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check for existing active session
    const { data: existingSession } = await supabase
      .from('adaptive_screening_sessions')
      .select('*')
      .eq('candidate_id', candidate_id)
      .in('session_status', ['invited', 'in_progress'])
      .single();

    if (existingSession) {
      // Return existing session
      const screeningUrl = `${req.headers.get('origin') || 'https://screeningpilot.com'}/screening/${existingSession.access_token}`;
      
      return new Response(JSON.stringify({
        session_id: existingSession.id,
        access_token: existingSession.access_token,
        screening_url: screeningUrl,
        expires_at: existingSession.expires_at,
        existing: true,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Calculate expiration
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expires_in_days);

    // Only call n8n webhook if not skipped (webhook was already called in Step 3)
    if (!skip_webhook) {
      // Fetch template data if template_id is provided
      let templateData = null;
      if (template_id) {
        const { data: template } = await supabase
          .from('screening_templates')
          .select('id, name, description, role_focus')
          .eq('id', template_id)
          .single();
        
        const { data: questions } = await supabase
          .from('screening_template_questions')
          .select('id, category, question_text, follow_up_prompts, difficulty_level')
          .eq('template_id', template_id)
          .order('sort_order');
        
        if (template) {
          templateData = { ...template, questions: questions || [] };
        }
      }

      // Build payload for n8n webhook
      const webhookPayload = {
        action: 'create_screening',
        timestamp: new Date().toISOString(),
        candidate: {
          id: candidate.id,
          name: candidate.candidate_name,
          email: candidate.email,
          position: candidate.recruitment_name,
          resume: candidate.resume,
          strengths: candidate.strengths,
          weaknesses: candidate.weaknesses,
        },
        role_briefing: role_briefing,
        template: templateData,
        scenario_config: scenario_config,
        settings: {
          expires_in_days: expires_in_days,
          expires_at: expiresAt.toISOString(),
          send_email: send_email && !!candidate.email,
          scenario_count: scenario_count,
        },
      };

      console.log('Calling n8n webhook with payload:', JSON.stringify(webhookPayload, null, 2));

      // Call n8n webhook and wait for response (30 second timeout)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      try {
        const webhookResponse = await fetch(N8N_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookPayload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!webhookResponse.ok) {
          const errorText = await webhookResponse.text();
          console.error('n8n webhook failed:', webhookResponse.status, errorText);
          return new Response(JSON.stringify({ 
            error: 'Backend processing failed. Please try again.',
            details: errorText,
            status_code: webhookResponse.status,
          }), {
            status: 502,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const webhookResult = await webhookResponse.json();
        console.log('n8n webhook success:', webhookResult);

      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          console.error('n8n webhook timed out after 30 seconds');
          return new Response(JSON.stringify({ 
            error: 'Backend processing timed out. Please try again.',
          }), {
            status: 504,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        console.error('n8n webhook network error:', fetchError);
        return new Response(JSON.stringify({ 
          error: 'Failed to connect to backend. Please check your connection.',
          details: fetchError.message,
        }), {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      console.log('Skipping n8n webhook - already synced in Step 3');
    }

    // n8n webhook succeeded - now create the session in Supabase
    const { data: newSession, error: sessionError } = await supabase
      .from('adaptive_screening_sessions')
      .insert({
        candidate_id: candidate_id,
        template_id: template_id,
        scenario_count: scenario_count,
        expires_at: expiresAt.toISOString(),
        role_briefing: role_briefing,
        scenario_config: scenario_config,
      })
      .select()
      .single();

    if (sessionError) {
      console.error('Failed to create session:', sessionError);
      throw new Error('Failed to create screening session');
    }

    // Update candidate's screening status
    await supabase
      .from('resume_analyses')
      .update({ screening_status: 'invited' })
      .eq('id', candidate_id);

    // Generate screening URL
    const origin = req.headers.get('origin') || 'https://screeningpilot.com';
    const screeningUrl = `${origin}/screening/${newSession.access_token}`;

    // Send email invitation if enabled and email is available
    if (send_email && candidate.email && RESEND_API_KEY) {
      try {
        await sendInviteEmail(candidate, screeningUrl, expiresAt);
        console.log('Invite email sent to:', candidate.email);
      } catch (emailError) {
        console.error('Failed to send invite email:', emailError);
        // Don't fail the whole request if email fails
      }
    }

    console.log('Screening invite created for candidate:', candidate_id);

    return new Response(JSON.stringify({
      session_id: newSession.id,
      access_token: newSession.access_token,
      screening_url: screeningUrl,
      expires_at: newSession.expires_at,
      existing: false,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in generate-screening-invite:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function sendInviteEmail(candidate: any, screeningUrl: string, expiresAt: Date) {
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; padding: 20px 0; }
        .content { padding: 20px; background: #f9fafb; border-radius: 8px; }
        .button { display: inline-block; padding: 12px 24px; background: #0EA5E9; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>You're Invited to Complete a Brief Screening</h1>
        </div>
        <div class="content">
          <p>Hi ${candidate.candidate_name},</p>
          <p>As part of your application process, we'd like to invite you to complete a brief interactive screening. This is a conversation-based assessment that helps us understand how you approach workplace situations.</p>
          <p><strong>What to expect:</strong></p>
          <ul>
            <li>A conversational format with an AI interviewer</li>
            <li>3-4 realistic workplace scenarios</li>
            <li>Approximately 10-15 minutes to complete</li>
            <li>No right or wrong answers</li>
          </ul>
          <p style="text-align: center;">
            <a href="${screeningUrl}" class="button">Start Screening</a>
          </p>
          <p><small>This link expires on ${expiresAt.toLocaleDateString()}. Please complete the screening before then.</small></p>
        </div>
        <div class="footer">
          <p>If you have any questions, please reply to this email.</p>
          <p>Powered by ScreeningPilot</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'ScreeningPilot <screening@resend.dev>',
      to: [candidate.email],
      subject: 'Complete Your Brief Screening Assessment',
      html: emailHtml,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send email: ${errorText}`);
  }
}