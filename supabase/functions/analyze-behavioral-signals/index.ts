import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const N8N_WEBHOOK_URL = "https://siraa.app.n8n.cloud/webhook/2626a504-e45b-407f-9042-78618ad66928";
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

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

    // Get session with candidate info
    const { data: session, error: sessionError } = await supabase
      .from('adaptive_screening_sessions')
      .select(`
        *,
        resume_analyses:candidate_id (
          candidate_name
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

    // Get scenarios that were presented
    const { data: scenarios } = await supabase
      .from('screening_scenarios')
      .select('scenario_prompt, category, name')
      .eq('is_active', true);

    // Build payload for n8n webhook
    const payload = {
      session_id: session_id,
      candidate_name: session.resume_analyses?.candidate_name || 'Unknown',
      transcript: conversationLogs.map((log: any) => ({
        role: log.role,
        content: log.content,
        timestamp: log.created_at,
        message_index: log.message_index,
      })),
      scenarios_presented: scenarios?.map((s: any) => ({
        name: s.name,
        category: s.category,
        prompt: s.scenario_prompt,
      })) || [],
    };

    console.log('Sending transcript to n8n for behavioral analysis:', session_id);
    console.log('Transcript messages:', conversationLogs.length);

    // Call n8n webhook for analysis
    const n8nResponse = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!n8nResponse.ok) {
      const errorText = await n8nResponse.text();
      console.error('n8n webhook error:', n8nResponse.status, errorText);
      throw new Error(`Failed to get behavioral analysis from n8n: ${n8nResponse.status}`);
    }

    const analysis = await n8nResponse.json();
    console.log('Received analysis from n8n:', JSON.stringify(analysis).slice(0, 200));

    // Validate required fields from n8n response
    if (!analysis.overall_risk_level) {
      console.error('Invalid n8n response - missing overall_risk_level:', analysis);
      throw new Error('Invalid analysis response from n8n');
    }

    // Save analysis to database
    const { data: savedAnalysis, error: saveError } = await supabase
      .from('screening_behavioral_analysis')
      .upsert({
        session_id: session_id,
        candidate_id: session.candidate_id,
        ownership_score: analysis.ownership_score || 0,
        ownership_evidence: analysis.ownership_evidence || [],
        clarity_score: analysis.clarity_score || 0,
        clarity_evidence: analysis.clarity_evidence || [],
        emotional_regulation_score: analysis.emotional_regulation_score || 0,
        emotional_evidence: analysis.emotional_evidence || [],
        consistency_score: analysis.consistency_score || 0,
        consistency_evidence: analysis.consistency_evidence || [],
        red_flags: analysis.red_flags || [],
        green_flags: analysis.green_flags || [],
        overall_risk_level: analysis.overall_risk_level,
        risk_summary: analysis.risk_summary || '',
        ai_confidence_score: analysis.ai_confidence_score || 0,
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
