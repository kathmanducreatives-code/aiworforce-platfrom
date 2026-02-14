import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

const N8N_WEBHOOK_URL = 'https://n8n.prasidha.me/webhook/behavioral-screening';
const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

// Generate custom screening questions using Lovable AI
async function generateCustomQuestions(
  role_title: string,
  required_skills: string[],
  experience_level: string,
  culture_keywords: string[] = []
): Promise<Array<{ category: string; question_text: string; follow_up_prompts: string[]; difficulty_level: number }> | null> {
  if (!LOVABLE_API_KEY) {
    console.error('LOVABLE_API_KEY not configured, skipping AI question generation');
    return null;
  }

  const skillsList = required_skills.join(', ');
  const cultureList = culture_keywords.length > 0 ? culture_keywords.join(', ') : 'teamwork, adaptability';
  const levelMap: Record<string, string> = {
    entry: 'entry-level (0-2 years experience)',
    mid: 'mid-level (3-7 years experience)',
    senior: 'senior-level (8+ years experience)',
  };
  const levelDesc = levelMap[experience_level] || levelMap['mid'];

  const systemPrompt = `You are an expert behavioral interview designer for recruitment. You create STAR-format behavioral screening questions that are probing, open-ended, and role-specific. Never create yes/no questions. Each question should present a realistic workplace scenario that reveals how the candidate thinks and acts.`;

  const userPrompt = `Generate behavioral screening questions for a ${levelDesc} "${role_title}" position.

Required skills to assess: ${skillsList}
Culture keywords to probe: ${cultureList}

Generate questions following this exact distribution:
- 2 ownership/accountability scenario questions (category: "accountability")
- ${required_skills.length >= 3 ? '3' : '2'} questions per required skill, testing behavioral competency (category: the skill name, e.g. "${required_skills[0]}")
- ${culture_keywords.length > 0 ? '2' : '1'} culture-fit questions using the culture keywords (category: "culture_fit")
- 1 red-flag detector question designed to surface concerning patterns (category: "red_flag")

Each question must:
- Be STAR-format friendly (Situation, Task, Action, Result)
- Be open-ended and probing (never yes/no)
- Include 2 follow-up prompts to dig deeper
- Have a difficulty_level between 1-5 appropriate for ${experience_level} level
- Be specific to the "${role_title}" role`;

  const toolDef = {
    type: "function",
    function: {
      name: "generate_screening_questions",
      description: "Return an array of behavioral screening questions for the role.",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: { type: "string", description: "Category: accountability, culture_fit, red_flag, or the skill name" },
                question_text: { type: "string", description: "The full behavioral question text" },
                follow_up_prompts: { type: "array", items: { type: "string" }, description: "2 follow-up probing questions" },
                difficulty_level: { type: "number", description: "Difficulty 1-5" },
              },
              required: ["category", "question_text", "follow_up_prompts", "difficulty_level"],
              additionalProperties: false,
            },
          },
        },
        required: ["questions"],
        additionalProperties: false,
      },
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        tools: [toolDef],
        tool_choice: { type: "function", function: { name: "generate_screening_questions" } },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      console.error(`AI gateway error [${response.status}]:`, errText);
      return null;
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      console.error('No tool call in AI response:', JSON.stringify(result));
      return null;
    }

    const parsed = JSON.parse(toolCall.function.arguments);
    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      console.error('AI returned empty questions array');
      return null;
    }

    console.log(`AI generated ${parsed.questions.length} custom questions for "${role_title}"`);
    return parsed.questions;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('AI question generation failed:', err);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      candidate_id, 
      template_id: incoming_template_id = null,
      role_briefing: incoming_role_briefing = null,
      scenario_config = null,
      scenario_count = 3, 
      expires_in_days = 7, 
      send_email = true,
      skip_webhook = false,
      // New AI question generation params
      role_title = null,
      required_skills = null,
      experience_level = 'mid',
      culture_keywords = [],
      // Pre-generated questions from wizard preview (skip AI call)
      pre_generated_questions = null,
      // Candidate source: 'resume_screening' or 'linkedin_leads'
      candidate_source = 'resume_screening',
    } = await req.json();

    if (!candidate_id) {
      return new Response(JSON.stringify({ error: 'candidate_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let template_id = incoming_template_id;
    let role_briefing = incoming_role_briefing;
    
    console.log('Creating screening with context:', { 
      template_id, 
      role_briefing: !!role_briefing, 
      scenario_config: !!scenario_config, 
      skip_webhook,
      role_title,
      required_skills,
    });

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Get candidate info from the appropriate table
    let candidate: any = null;

    if (candidate_source === 'linkedin_leads') {
      const { data, error: err } = await supabase
        .from('linkedin_leads')
        .select('*')
        .eq('id', candidate_id)
        .single();

      if (err || !data) {
        return new Response(JSON.stringify({ error: 'Candidate not found in linkedin_leads' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Normalize to common shape
      candidate = {
        id: data.id,
        candidate_name: data.candidate_name,
        email: data.contact_email,
        recruitment_name: data.job_title,
        resume: null,
        strengths: null,
        weaknesses: null,
      };
    } else {
      const { data, error: err } = await supabase
        .from('resume_analyses')
        .select('*')
        .eq('id', candidate_id)
        .single();

      if (err || !data) {
        return new Response(JSON.stringify({ error: 'Candidate not found in resume_analyses' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      candidate = data;
    }

    // Check for existing active session
    const { data: existingSession } = await supabase
      .from('adaptive_screening_sessions')
      .select('*')
      .eq('candidate_id', candidate_id)
      .in('session_status', ['invited', 'in_progress'])
      .single();

    if (existingSession) {
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

    // === AI-Powered Custom Question Generation ===
    // === Pre-generated questions from wizard (skip AI call) ===
    if (pre_generated_questions && Array.isArray(pre_generated_questions) && pre_generated_questions.length > 0) {
      console.log(`Using ${pre_generated_questions.length} pre-generated questions from wizard`);
      
      const templateName = role_title ? `${role_title} Custom Assessment` : 'Custom Assessment';
      const { data: newTemplate, error: templateError } = await supabase
        .from('screening_templates')
        .insert({
          name: templateName,
          description: `AI-generated behavioral assessment. Skills: ${(required_skills || []).join(', ')}.`,
          role_focus: role_title || 'General',
          is_default: false,
        })
        .select()
        .single();

      if (!templateError && newTemplate) {
        const questionsToInsert = pre_generated_questions.map((q: any, idx: number) => ({
          template_id: newTemplate.id,
          category: q.category || 'general',
          question_text: q.question_text,
          follow_up_prompts: q.follow_up_prompts || [],
          difficulty_level: q.difficulty_level || 3,
          is_custom: true,
          sort_order: idx + 1,
        }));

        const { error: questionsError } = await supabase
          .from('screening_template_questions')
          .insert(questionsToInsert);

        if (!questionsError) {
          console.log(`Created template "${newTemplate.name}" with ${questionsToInsert.length} pre-generated questions`);
          template_id = newTemplate.id;
        } else {
          console.error('Failed to insert pre-generated questions:', questionsError);
        }
      }

      role_briefing = {
        ...(role_briefing || {}),
        role_title,
        required_skills,
        experience_level,
        culture_keywords,
        ai_generated: true,
      };
    }
    // === AI-Powered Custom Question Generation (fallback if no pre-generated) ===
    else if (role_title && required_skills && Array.isArray(required_skills) && required_skills.length > 0) {
      console.log(`Generating custom questions for role: "${role_title}", skills: [${required_skills.join(', ')}]`);
      
      const generatedQuestions = await generateCustomQuestions(
        role_title,
        required_skills,
        experience_level,
        culture_keywords
      );

      if (generatedQuestions && generatedQuestions.length > 0) {
        // Create custom template
        const { data: newTemplate, error: templateError } = await supabase
          .from('screening_templates')
          .insert({
            name: `${role_title} Custom Assessment`,
            description: `AI-generated behavioral assessment for ${role_title} role. Skills: ${required_skills.join(', ')}.`,
            role_focus: role_title,
            is_default: false,
          })
          .select()
          .single();

        if (templateError || !newTemplate) {
          console.error('Failed to create custom template:', templateError);
          // Fall through to default behavior
        } else {
          // Insert generated questions
          const questionsToInsert = generatedQuestions.map((q, idx) => ({
            template_id: newTemplate.id,
            category: q.category,
            question_text: q.question_text,
            follow_up_prompts: q.follow_up_prompts,
            difficulty_level: q.difficulty_level,
            is_custom: true,
            sort_order: idx + 1,
          }));

          const { error: questionsError } = await supabase
            .from('screening_template_questions')
            .insert(questionsToInsert);

          if (questionsError) {
            console.error('Failed to insert custom questions:', questionsError);
          } else {
            console.log(`Created template "${newTemplate.name}" with ${questionsToInsert.length} AI-generated questions`);
            template_id = newTemplate.id;
          }
        }

        // Enrich role_briefing with custom params for chat AI context
        role_briefing = {
          ...(role_briefing || {}),
          role_title,
          required_skills,
          experience_level,
          culture_keywords,
          ai_generated: true,
        };
      } else {
        console.log('AI generation returned no questions, falling back to default behavior');
      }
    }

    // Calculate expiration
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expires_in_days);

    // Only call n8n webhook if not skipped
    if (!skip_webhook) {
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

    // Create the session in Supabase
    // Note: candidate_id FK references resume_analyses, so for LinkedIn leads we set it to null
    const sessionCandidateId = candidate_source === 'linkedin_leads' ? null : candidate_id;
    const { data: newSession, error: sessionError } = await supabase
      .from('adaptive_screening_sessions')
      .insert({
        candidate_id: sessionCandidateId,
        template_id: template_id,
        scenario_count: scenario_count,
        expires_at: expiresAt.toISOString(),
        role_briefing: {
          ...(role_briefing || {}),
          actual_candidate_id: candidate_id,
          candidate_source: candidate_source,
          candidate_name: candidate.candidate_name,
          candidate_email: candidate.email,
        },
        scenario_config: scenario_config,
      })
      .select()
      .single();

    if (sessionError) {
      console.error('Failed to create session:', sessionError);
      throw new Error('Failed to create screening session');
    }

    // Update candidate's screening status (only for resume_analyses candidates)
    if (candidate_source !== 'linkedin_leads') {
      await supabase
        .from('resume_analyses')
        .update({ screening_status: 'invited' })
        .eq('id', candidate_id);
    }

    const origin = req.headers.get('origin') || 'https://screeningpilot.com';
    const screeningUrl = `${origin}/screening/${newSession.access_token}`;

    if (send_email && candidate.email && RESEND_API_KEY) {
      try {
        await sendInviteEmail(candidate, screeningUrl, expiresAt);
        console.log('Invite email sent to:', candidate.email);
      } catch (emailError) {
        console.error('Failed to send invite email:', emailError);
      }
    }

    console.log('Screening invite created for candidate:', candidate_id);

    return new Response(JSON.stringify({
      session_id: newSession.id,
      access_token: newSession.access_token,
      screening_url: screeningUrl,
      expires_at: newSession.expires_at,
      existing: false,
      ai_generated: !!(role_title && template_id !== incoming_template_id),
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
