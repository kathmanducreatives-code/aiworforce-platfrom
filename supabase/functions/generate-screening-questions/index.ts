import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      role_title,
      required_skills = [],
      experience_level = 'mid',
      culture_keywords = [],
      industry = '',
      free_text_description = '',
    } = await req.json();

    if (!role_title || !Array.isArray(required_skills) || required_skills.length === 0) {
      return new Response(JSON.stringify({ error: 'role_title and required_skills are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI service not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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

    let userPrompt = `Generate behavioral screening questions for a ${levelDesc} "${role_title}" position.`;
    
    if (industry) {
      userPrompt += `\nThis role is in the ${industry} industry. Make scenarios industry-specific where appropriate.`;
    }

    if (free_text_description) {
      userPrompt += `\n\nRecruiter's expectations: "${free_text_description}"`;
    }

    userPrompt += `\n\nRequired skills to assess: ${skillsList}
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

      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again in a moment.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'AI credits exhausted. Please add credits to continue.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Failed to generate questions' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      console.error('No tool call in AI response:', JSON.stringify(result));
      return new Response(JSON.stringify({ error: 'AI returned unexpected format' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const parsed = JSON.parse(toolCall.function.arguments);

    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      return new Response(JSON.stringify({ error: 'AI returned no questions' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Generated ${parsed.questions.length} preview questions for "${role_title}"`);

    return new Response(JSON.stringify({ questions: parsed.questions }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in generate-screening-questions:', error);
    const msg = error.name === 'AbortError' ? 'AI generation timed out' : (error.message || 'Unknown error');
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
