import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const ANALYSIS_SYSTEM_PROMPT = `You are an expert Behavioral Psychologist specializing in workplace behavioral assessment. You will analyze a candidate's screening conversation transcript and produce a structured behavioral analysis.

You MUST respond with valid JSON matching this exact schema:

{
  "ownership_score": <number 0-100>,
  "ownership_evidence": [{"quote": "<exact quote>", "signal": "<signal name>", "strength": "weak"|"moderate"|"strong", "scenario_context": "<context>"}],
  "clarity_score": <number 0-100>,
  "clarity_evidence": [{"quote": "<exact quote>", "signal": "<signal name>", "strength": "weak"|"moderate"|"strong", "scenario_context": "<context>"}],
  "emotional_regulation_score": <number 0-100>,
  "emotional_evidence": [{"quote": "<exact quote>", "signal": "<signal name>", "strength": "weak"|"moderate"|"strong", "scenario_context": "<context>"}],
  "consistency_score": <number 0-100>,
  "consistency_evidence": [{"quote": "<exact quote>", "signal": "<signal name>", "strength": "weak"|"moderate"|"strong", "scenario_context": "<context>"}],
  "overall_risk_level": "low"|"medium"|"high",
  "risk_summary": "<2-4 sentence summary of behavioral risk assessment>",
  "red_flags": [{"title": "<flag title>", "description": "<description>", "evidence_quote": "<quote>", "severity": "minor"|"moderate"|"major"}],
  "green_flags": [{"title": "<flag title>", "description": "<description>", "evidence_quote": "<quote>"}],
  "ai_confidence_score": <number 0-100>
}

SCORING GUIDELINES:
- Ownership (0-100): Does the candidate take personal responsibility? Do they use "I" vs "we/they"? Do they own mistakes?
- Clarity (0-100): Can they articulate thoughts clearly? Are responses structured and specific?
- Emotional Regulation (0-100): Do they stay composed under pressure scenarios? Do they escalate or de-escalate?
- Consistency (0-100): Are values and approaches consistent across different scenarios?

RISK LEVEL:
- "low": Scores mostly above 70, no major red flags
- "medium": Some scores below 60 or minor red flags present
- "high": Multiple scores below 50 or major red flags detected

IMPORTANT:
- Base all evidence on actual quotes from the transcript
- Be fair and balanced - look for both strengths and areas of concern
- This is a decision SUPPORT tool, not an automated rejection system
- Confidence score reflects transcript quality and response depth`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { session_id } = await req.json();

    if (!session_id) {
      return new Response(JSON.stringify({ error: 'session_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Get session with candidate info and role context
    const { data: session, error: sessionError } = await supabase
      .from('adaptive_screening_sessions')
      .select(`
        *,
        resume_analyses:candidate_id (
          candidate_name,
          recruitment_name
        )
      `)
      .eq('id', session_id)
      .single();

    if (sessionError || !session) {
      console.error('Session lookup error:', sessionError);
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get conversation logs
    const { data: conversationLogs } = await supabase
      .from('screening_conversation_logs')
      .select('*')
      .eq('session_id', session_id)
      .order('message_index', { ascending: true });

    if (!conversationLogs || conversationLogs.length === 0) {
      return new Response(JSON.stringify({ error: 'No conversation logs found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Format transcript
    const candidateName = session.resume_analyses?.candidate_name || 'Unknown';
    const roleName = session.resume_analyses?.recruitment_name || 'Not specified';
    
    const transcript = conversationLogs.map((log: any) => 
      `[${log.role.toUpperCase()}]: ${log.content}`
    ).join('\n\n');

    // Build role context from role_briefing
    let roleContext = '';
    if (session.role_briefing) {
      const rb = session.role_briefing;
      const parts = [];
      if (rb.role_title) parts.push(`Role: ${rb.role_title}`);
      if (rb.skills_expected) parts.push(`Required skills: ${rb.skills_expected}`);
      if (rb.experience_required) parts.push(`Experience level: ${rb.experience_required}`);
      if (rb.key_traits?.length) parts.push(`Key traits: ${rb.key_traits.join(', ')}`);
      if (parts.length > 0) roleContext = `\n\nRole Context:\n${parts.join('\n')}`;
    }

    const userPrompt = `Analyze the following behavioral screening transcript for candidate "${candidateName}" applying for position "${roleName}".${roleContext}

FULL TRANSCRIPT:
${transcript}

Provide your complete behavioral analysis as JSON.`;

    console.log('Calling Lovable AI for behavioral analysis, session:', session_id, 'messages:', conversationLogs.length);

    // Call Lovable AI Gateway with Gemini
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('Lovable AI error:', aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Analysis will be retried.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: 'AI credits exhausted. Please add credits.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content;

    if (!rawContent) {
      throw new Error('Empty response from AI');
    }

    // Parse JSON from response (handle markdown code blocks)
    let analysis: any;
    try {
      // Strip markdown code fences if present
      let jsonStr = rawContent.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      analysis = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', rawContent.slice(0, 500));
      throw new Error('AI returned invalid JSON');
    }

    // Validate required fields
    if (!analysis.overall_risk_level || !['low', 'medium', 'high'].includes(analysis.overall_risk_level)) {
      console.error('Invalid risk level:', analysis.overall_risk_level);
      analysis.overall_risk_level = 'medium'; // fallback
    }

    // Save analysis to database
    const { data: savedAnalysis, error: saveError } = await supabase
      .from('screening_behavioral_analysis')
      .upsert({
        session_id: session_id,
        candidate_id: session.candidate_id,
        ownership_score: analysis.ownership_score ?? 0,
        ownership_evidence: analysis.ownership_evidence || [],
        clarity_score: analysis.clarity_score ?? 0,
        clarity_evidence: analysis.clarity_evidence || [],
        emotional_regulation_score: analysis.emotional_regulation_score ?? 0,
        emotional_evidence: analysis.emotional_evidence || [],
        consistency_score: analysis.consistency_score ?? 0,
        consistency_evidence: analysis.consistency_evidence || [],
        red_flags: analysis.red_flags || [],
        green_flags: analysis.green_flags || [],
        overall_risk_level: analysis.overall_risk_level,
        risk_summary: analysis.risk_summary || '',
        ai_confidence_score: analysis.ai_confidence_score ?? 0,
        analysis_completed_at: new Date().toISOString(),
      }, {
        onConflict: 'session_id',
      })
      .select()
      .single();

    if (saveError) {
      console.error('Failed to save analysis:', saveError);
      throw new Error('Failed to save behavioral analysis');
    }

    console.log('Behavioral analysis completed and saved for session:', session_id);

    return new Response(JSON.stringify({
      success: true,
      analysis: savedAnalysis,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in analyze-behavioral-signals:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
