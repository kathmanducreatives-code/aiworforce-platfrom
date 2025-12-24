import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const ANALYSIS_PROMPT = `You are an expert behavioral psychologist and organizational consultant analyzing a candidate's responses from a workplace scenario-based screening conversation.

Analyze the conversation transcript and provide a structured assessment of the following behavioral dimensions:

1. OWNERSHIP (0-100):
   - Does the candidate take personal responsibility for outcomes?
   - Do they acknowledge their role in failures or deflect blame?
   - Look for phrases like "I should have..." vs "They didn't..."

2. CLARITY UNDER PRESSURE (0-100):
   - Can they articulate their thinking clearly when faced with ambiguous situations?
   - Do they provide structured, logical responses or become scattered?
   - Look for clear reasoning vs vague generalizations

3. EMOTIONAL REGULATION (0-100):
   - Do they remain composed when scenarios escalate?
   - Do they show defensive reactions or thoughtful consideration?
   - Look for acknowledgment of emotions while maintaining professionalism

4. CONSISTENCY (0-100):
   - Are their values and approaches consistent across different scenarios?
   - Do their stated principles match their described actions?
   - Look for alignment between what they say they value and how they describe behaving

For each dimension, provide:
- A score (0-100)
- 2-3 specific evidence quotes from the conversation
- Brief analysis of what the evidence shows

Also identify:
- RED FLAGS: Specific concerns that recruiters should investigate further
- GREEN FLAGS: Positive indicators that suggest strong fit

Finally, provide:
- OVERALL RISK LEVEL: low, medium, or high
- RISK SUMMARY: A 2-3 sentence explanation for recruiters (be fair and balanced)
- AI CONFIDENCE: How confident you are in this assessment (0-100)

IMPORTANT: Be fair and balanced. Everyone has areas for growth. Focus on patterns, not single statements. This is decision SUPPORT, not automated rejection.

Respond in this exact JSON format:
{
  "ownership_score": number,
  "ownership_evidence": [{"quote": "...", "signal": "positive|negative|neutral", "strength": "weak|moderate|strong"}],
  "clarity_score": number,
  "clarity_evidence": [...],
  "emotional_regulation_score": number,
  "emotional_evidence": [...],
  "consistency_score": number,
  "consistency_evidence": [...],
  "red_flags": [{"title": "...", "description": "...", "evidence_quote": "...", "severity": "minor|moderate|major"}],
  "green_flags": [{"title": "...", "description": "...", "evidence_quote": "..."}],
  "overall_risk_level": "low|medium|high",
  "risk_summary": "...",
  "ai_confidence_score": number
}`;

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

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Get session and conversation logs
    const { data: session, error: sessionError } = await supabase
      .from('adaptive_screening_sessions')
      .select('*')
      .eq('id', session_id)
      .single();

    if (sessionError || !session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

    // Build transcript
    const transcript = conversationLogs
      .map((log: any) => `${log.role.toUpperCase()}: ${log.content}`)
      .join('\n\n');

    console.log('Analyzing transcript for session:', session_id);
    console.log('Transcript length:', transcript.length);

    // Call Lovable AI for analysis
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro', // Use Pro for better analysis
        messages: [
          { role: 'system', content: ANALYSIS_PROMPT },
          { role: 'user', content: `Please analyze this screening conversation:\n\n${transcript}` },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);
      throw new Error('Failed to get AI analysis');
    }

    const aiData = await aiResponse.json();
    const analysisText = aiData.choices?.[0]?.message?.content;

    if (!analysisText) {
      throw new Error('No analysis returned from AI');
    }

    // Parse JSON from response
    let analysis;
    try {
      // Extract JSON from response (in case there's extra text)
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', analysisText);
      throw new Error('Failed to parse behavioral analysis');
    }

    // Save analysis to database
    const { data: savedAnalysis, error: saveError } = await supabase
      .from('screening_behavioral_analysis')
      .upsert({
        session_id: session_id,
        candidate_id: session.candidate_id,
        ownership_score: analysis.ownership_score,
        ownership_evidence: analysis.ownership_evidence || [],
        clarity_score: analysis.clarity_score,
        clarity_evidence: analysis.clarity_evidence || [],
        emotional_regulation_score: analysis.emotional_regulation_score,
        emotional_evidence: analysis.emotional_evidence || [],
        consistency_score: analysis.consistency_score,
        consistency_evidence: analysis.consistency_evidence || [],
        red_flags: analysis.red_flags || [],
        green_flags: analysis.green_flags || [],
        overall_risk_level: analysis.overall_risk_level,
        risk_summary: analysis.risk_summary,
        ai_confidence_score: analysis.ai_confidence_score,
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

    console.log('Behavioral analysis completed for session:', session_id);

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
