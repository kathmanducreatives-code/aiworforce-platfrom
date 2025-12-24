import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const SYSTEM_PROMPT = `You are an AI interviewer conducting an Adaptive Stress-Based Screening conversation. Your role is to present realistic workplace scenarios and engage candidates in thoughtful dialogue to understand their behavioral patterns.

IMPORTANT GUIDELINES:
1. Be professional, warm, and respectful at all times
2. Present scenarios naturally, as if you're having a genuine conversation
3. Listen carefully to responses and ask relevant follow-up questions
4. Probe deeper when answers are vague or deflective
5. Never be judgmental or confrontational
6. Adapt your follow-ups based on the candidate's responses
7. Keep responses concise but meaningful (2-4 sentences typically)

BEHAVIORAL SIGNALS TO OBSERVE (but never mention these to the candidate):
- Ownership: Does the candidate take responsibility or deflect blame?
- Clarity: Can they articulate their thinking clearly under pressure?
- Emotional Regulation: Do they remain composed when scenarios escalate?
- Consistency: Are their values and approaches consistent across scenarios?

CONVERSATION FLOW:
1. Start with a warm introduction and explain the process
2. Present scenarios one at a time
3. Use adaptive follow-ups based on their responses
4. Transition smoothly between scenarios
5. End with a professional thank you

Remember: This is a decision SUPPORT tool, not an automated rejection system. Your goal is to surface behavioral patterns for human recruiters to consider.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { session_id, message, action, token } = await req.json();

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Handle different actions
    if (action === 'start') {
      return await handleStartSession(supabase, token);
    } else if (action === 'chat') {
      return await handleChat(supabase, session_id, message);
    } else if (action === 'consent') {
      return await handleConsent(supabase, session_id);
    } else if (action === 'begin') {
      return await handleBeginScreening(supabase, session_id);
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in adaptive-screening-chat:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function handleStartSession(supabase: any, token: string) {
  // Validate token and get session with role context
  const { data: session, error: sessionError } = await supabase
    .from('adaptive_screening_sessions')
    .select('*, resume_analyses(candidate_name, recruitment_name)')
    .eq('access_token', token)
    .single();

  if (sessionError || !session) {
    return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Check if session is expired
  if (new Date(session.expires_at) < new Date()) {
    await supabase
      .from('adaptive_screening_sessions')
      .update({ session_status: 'expired' })
      .eq('id', session.id);

    return new Response(JSON.stringify({ error: 'Session has expired' }), {
      status: 410,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Check if already completed
  if (session.session_status === 'completed') {
    return new Response(JSON.stringify({ error: 'Session already completed' }), {
      status: 410,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const candidateName = session.resume_analyses?.candidate_name || 'there';
  const roleName = session.resume_analyses?.recruitment_name || null;

  return new Response(JSON.stringify({
    session_id: session.id,
    candidate_name: candidateName,
    role_name: roleName,
    session_status: session.session_status,
    consent_given: session.candidate_consent_given,
    scenario_count: session.scenario_count,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleConsent(supabase: any, sessionId: string) {
  // Update session with consent (but don't start yet - wait for "begin" action)
  const { error: updateError } = await supabase
    .from('adaptive_screening_sessions')
    .update({
      candidate_consent_given: true,
      consent_given_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  if (updateError) {
    throw new Error('Failed to record consent');
  }

  // Get scenario count
  const { data: scenarios } = await supabase
    .from('screening_scenarios')
    .select('id')
    .eq('is_active', true)
    .limit(3);

  return new Response(JSON.stringify({
    success: true,
    total_scenarios: scenarios?.length || 3,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleBeginScreening(supabase: any, sessionId: string) {
  // Start the session and present the first scenario
  const { error: updateError } = await supabase
    .from('adaptive_screening_sessions')
    .update({
      session_status: 'in_progress',
      started_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  if (updateError) {
    throw new Error('Failed to start screening session');
  }

  // Get the first scenario
  const { data: scenarios } = await supabase
    .from('screening_scenarios')
    .select('*')
    .eq('is_active', true)
    .order('difficulty_level', { ascending: true })
    .limit(3);

  const firstScenario = scenarios?.[0];

  // Generate welcome message with first scenario
  const welcomeMessage = `Great! Let's begin.

I'm going to present you with ${scenarios?.length || 3} workplace scenarios and ask how you would handle them. There are no right or wrong answers—I'm interested in understanding your thought process and approach.

Here's your first scenario:

${firstScenario?.scenario_prompt || 'Imagine you join a new team and notice that a process everyone follows seems inefficient. What would you do?'}`;

  // Log the welcome message
  await supabase.from('screening_conversation_logs').insert({
    session_id: sessionId,
    message_index: 0,
    role: 'assistant',
    content: welcomeMessage,
    scenario_id: firstScenario?.id,
  });

  return new Response(JSON.stringify({
    message: welcomeMessage,
    is_complete: false,
    current_scenario_index: 0,
    total_scenarios: scenarios?.length || 3,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleChat(supabase: any, sessionId: string, userMessage: string) {
  // Get session and conversation history with role context
  const { data: session } = await supabase
    .from('adaptive_screening_sessions')
    .select('*, resume_analyses(recruitment_name)')
    .eq('id', sessionId)
    .single();

  if (!session) {
    throw new Error('Session not found');
  }

  const roleName = session.resume_analyses?.recruitment_name || null;

  const { data: conversationLogs } = await supabase
    .from('screening_conversation_logs')
    .select('*')
    .eq('session_id', sessionId)
    .order('message_index', { ascending: true });

  const { data: scenarios } = await supabase
    .from('screening_scenarios')
    .select('*')
    .eq('is_active', true)
    .limit(session.scenario_count);

  // Get current message index
  const currentIndex = (conversationLogs?.length || 0);

  // Log user message
  await supabase.from('screening_conversation_logs').insert({
    session_id: sessionId,
    message_index: currentIndex,
    role: 'user',
    content: userMessage,
  });

  // Build conversation history for AI
  const messages = [
    { role: 'system', content: buildSystemPrompt(scenarios, session.current_scenario_index, roleName) },
    ...(conversationLogs || []).map((log: any) => ({
      role: log.role === 'assistant' ? 'assistant' : 'user',
      content: log.content,
    })),
    { role: 'user', content: userMessage },
  ];

  // Determine if we should move to next scenario or complete
  const shouldProgress = await shouldProgressToNextScenario(conversationLogs || [], session.current_scenario_index);
  const isLastScenario = session.current_scenario_index >= session.scenario_count - 1;
  const shouldComplete = shouldProgress && isLastScenario;

  // Add instruction to AI about what to do
  if (shouldComplete) {
    messages.push({
      role: 'system',
      content: 'This is the final scenario. After responding to the candidate, thank them warmly for their time and let them know the screening is complete. Do NOT present any new scenarios.',
    });
  } else if (shouldProgress) {
    const nextScenario = scenarios?.[session.current_scenario_index + 1];
    if (nextScenario) {
      messages.push({
        role: 'system',
        content: `Good job on the previous scenario. Now smoothly transition to the next scenario: "${nextScenario.scenario_prompt}"`,
      });
    }
  }

  // Call Lovable AI
  const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages,
    }),
  });

  if (!aiResponse.ok) {
    const errorText = await aiResponse.text();
    console.error('AI API error:', aiResponse.status, errorText);
    
    if (aiResponse.status === 429) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please wait a moment and try again.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (aiResponse.status === 402) {
      return new Response(JSON.stringify({ error: 'AI service unavailable. Please contact support.' }), {
        status: 402,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    throw new Error('Failed to get AI response');
  }

  const aiData = await aiResponse.json();
  const assistantMessage = aiData.choices?.[0]?.message?.content || 'I apologize, but I encountered an issue. Could you please repeat your response?';

  // Log assistant message
  await supabase.from('screening_conversation_logs').insert({
    session_id: sessionId,
    message_index: currentIndex + 1,
    role: 'assistant',
    content: assistantMessage,
    scenario_id: scenarios?.[session.current_scenario_index]?.id,
  });

  // Update session progress
  let newScenarioIndex = session.current_scenario_index;
  if (shouldProgress && !isLastScenario) {
    newScenarioIndex = session.current_scenario_index + 1;
  }

  const updateData: any = {
    current_scenario_index: newScenarioIndex,
  };

  if (shouldComplete) {
    updateData.session_status = 'completed';
    updateData.completed_at = new Date().toISOString();

    // Also update the candidate's screening_status
    await supabase
      .from('resume_analyses')
      .update({ screening_status: 'completed' })
      .eq('id', session.candidate_id);

    // Trigger behavioral analysis (async, don't wait)
    triggerBehavioralAnalysis(sessionId);
  }

  await supabase
    .from('adaptive_screening_sessions')
    .update(updateData)
    .eq('id', sessionId);

  return new Response(JSON.stringify({
    message: assistantMessage,
    is_complete: shouldComplete,
    current_scenario_index: newScenarioIndex,
    total_scenarios: session.scenario_count,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function buildSystemPrompt(scenarios: any[], currentIndex: number, roleName?: string | null): string {
  const currentScenario = scenarios?.[currentIndex];
  
  const roleContext = roleName 
    ? `\n\nCANDIDATE CONTEXT: This candidate is being screened for a "${roleName}" position. Tailor your follow-up questions and probing to be relevant to this role.`
    : '';
  
  const scenarioContext = currentScenario 
    ? `\n\nCURRENT SCENARIO (${currentIndex + 1} of ${scenarios.length}):\nCategory: ${currentScenario.category}\n"${currentScenario.scenario_prompt}"\n\nPossible follow-up questions to probe deeper:\n${(currentScenario.follow_up_prompts || []).map((q: string) => `- ${q}`).join('\n')}`
    : '';

  return SYSTEM_PROMPT + roleContext + scenarioContext;
}

async function shouldProgressToNextScenario(logs: any[], currentIndex: number): Promise<boolean> {
  // Simple heuristic: progress after 4+ exchanges in a scenario
  const scenarioMessages = logs.filter(l => l.role === 'user').length;
  const messagesPerScenario = Math.floor(scenarioMessages / (currentIndex + 1));
  return messagesPerScenario >= 2;
}

async function triggerBehavioralAnalysis(sessionId: string) {
  // This will be called async to analyze the session
  try {
    const baseUrl = SUPABASE_URL?.replace('//', '//') || '';
    await fetch(`${baseUrl}/functions/v1/analyze-behavioral-signals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ session_id: sessionId }),
    });
  } catch (e) {
    console.error('Failed to trigger behavioral analysis:', e);
  }
}
