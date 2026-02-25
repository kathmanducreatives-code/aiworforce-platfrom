import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, application_id, answer, question_index } = await req.json();
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Validate application exists and is not already completed
    if (!application_id) {
      return new Response(JSON.stringify({ error: 'Missing application_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: appCheck, error: appErr } = await supabase
      .from('screening_applications')
      .select('id, status')
      .eq('id', application_id)
      .single();

    if (appErr || !appCheck) {
      return new Response(JSON.stringify({ error: 'Application not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (appCheck.status === 'completed' && action !== 'complete_screening') {
      return new Response(JSON.stringify({ error: 'Application already completed' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'generate_questions') {
      return await handleGenerateQuestions(supabase, application_id);
    } else if (action === 'evaluate_answer') {
      return await handleEvaluateAnswer(supabase, application_id, answer, question_index);
    } else if (action === 'complete_screening') {
      return await handleCompleteScreening(supabase, application_id);
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Error in screen-candidate:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function handleGenerateQuestions(supabase: any, applicationId: string) {
  // Get application + job data
  const { data: app, error } = await supabase
    .from('screening_applications')
    .select('*, screening_jobs(*)')
    .eq('id', applicationId)
    .single();

  if (error || !app) throw new Error('Application not found');

  const job = app.screening_jobs;
  const resume = app.extracted_data || app.candidate_edits || {};
  const candidateName = resume.name || 'Candidate';

  const customQs = Array.isArray(job.custom_questions) ? job.custom_questions : [];

  const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: `You are a friendly, conversational AI interviewer. Generate 3-5 screening questions for a candidate.

RULES:
- Make questions conversational - use the candidate's name, reference their resume
- Ask open-ended questions that require detailed answers (not yes/no)
- Include: 1 technical question, 1 experience question, 1 culture/logistics question
- If there are red flags (experience gaps, missing skills), add a tactful question about it
- If custom questions are provided, incorporate them naturally

Return ONLY valid JSON array of objects:
[
  {
    "question": "The full question text",
    "type": "technical|experience|culture|logistics|red_flag|custom",
    "context": "Why this question is being asked (internal note, not shown to candidate)"
  }
]`
        },
        {
          role: 'user',
          content: `Generate screening questions for:

CANDIDATE: ${candidateName}
RESUME DATA: ${JSON.stringify(resume)}

JOB REQUIREMENTS:
- Title: ${job.title}
- Description: ${job.description}
- Required Years: ${job.required_years}
- Required Skills: ${(job.required_skills || []).join(', ')}
- Education Required: ${job.education_requirement}
- Salary Range: ${job.salary_min ? `$${job.salary_min.toLocaleString()}` : 'Not specified'} - ${job.salary_max ? `$${job.salary_max.toLocaleString()}` : 'Not specified'}

CUSTOM QUESTIONS FROM RECRUITER:
${customQs.length > 0 ? customQs.map((q: any, i: number) => `${i + 1}. ${typeof q === 'string' ? q : q.question}`).join('\n') : 'None'}`
        }
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!aiResponse.ok) throw new Error('Failed to generate questions');

  const aiData = await aiResponse.json();
  const rawContent = aiData.choices?.[0]?.message?.content || '[]';

  let questions;
  try {
    const parsed = JSON.parse(rawContent);
    questions = Array.isArray(parsed) ? parsed : parsed.questions || [];
  } catch {
    questions = [
      { question: `Hi ${candidateName}! Tell me about your most relevant experience for this ${job.title} role.`, type: 'experience', context: 'Fallback question' }
    ];
  }

  // Update application status
  await supabase
    .from('screening_applications')
    .update({ status: 'screening' })
    .eq('id', applicationId);

  return new Response(JSON.stringify({ questions }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleEvaluateAnswer(supabase: any, applicationId: string, answer: string, questionIndex: number) {
  const { data: app } = await supabase
    .from('screening_applications')
    .select('screening_answers, screening_jobs(title, required_skills)')
    .eq('id', applicationId)
    .single();

  const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: `You are evaluating a candidate's screening answer. Score it 1-10 and provide a brief analysis.

Scoring criteria:
- 8-10: Specific examples, measurable results, demonstrates deep knowledge
- 5-7: Decent answer with some specifics but could be deeper
- 3-4: Vague, generic, or surface-level
- 1-2: Extremely vague, irrelevant, or clearly evasive

Return ONLY valid JSON:
{
  "score": number,
  "analysis": "One sentence explanation",
  "sentiment": "positive|neutral|negative"
}`
        },
        {
          role: 'user',
          content: `Job: ${app?.screening_jobs?.title || 'Unknown'}
Required Skills: ${(app?.screening_jobs?.required_skills || []).join(', ')}

Candidate's answer: "${answer}"`
        }
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!aiResponse.ok) throw new Error('Failed to evaluate answer');

  const aiData = await aiResponse.json();
  let evaluation;
  try {
    evaluation = JSON.parse(aiData.choices?.[0]?.message?.content || '{}');
  } catch {
    evaluation = { score: 5, analysis: 'Unable to evaluate', sentiment: 'neutral' };
  }

  return new Response(JSON.stringify({ evaluation }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleCompleteScreening(supabase: any, applicationId: string) {
  const { data: app } = await supabase
    .from('screening_applications')
    .select('*, screening_jobs(*)')
    .eq('id', applicationId)
    .single();

  if (!app) throw new Error('Application not found');

  const job = app.screening_jobs;
  const resume = app.candidate_edits || app.extracted_data || {};
  const answers = app.screening_answers || [];

  const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: `You are a recruitment AI analyst. Calculate a match score and provide analysis for a candidate.

SCORING RULES:
1. Check each requirement: years experience, skills, education, salary
2. Base score = (requirements met / total) * 100
3. If average answer score >= 7: add 5-10% bonus
4. If average answer score < 4: subtract 5-10%
5. Final score: 0-100

CATEGORIES:
- 80-100: strong_fit
- 60-79: good_fit
- 40-59: maybe
- 0-39: not_qualified

Return ONLY valid JSON:
{
  "match_score": number,
  "match_category": "strong_fit|good_fit|maybe|not_qualified",
  "strengths": ["strength 1", "strength 2"],
  "red_flags": ["flag 1", "flag 2"],
  "score_breakdown": {
    "experience_match": true/false,
    "skills_match_pct": number,
    "education_match": true/false,
    "salary_match": true/false or null,
    "answer_quality_avg": number,
    "base_score": number,
    "bonus_penalty": number,
    "final_score": number
  },
  "interview_questions": [
    {
      "question": "...",
      "context": "Why this question",
      "type": "technical|behavioral|red_flag|verification"
    }
  ]
}`
        },
        {
          role: 'user',
          content: `CANDIDATE RESUME: ${JSON.stringify(resume)}

JOB REQUIREMENTS:
- Title: ${job.title}
- Required Years: ${job.required_years}
- Required Skills: ${(job.required_skills || []).join(', ')}
- Education: ${job.education_requirement}
- Salary: ${job.salary_min || 'N/A'} - ${job.salary_max || 'N/A'}

SCREENING Q&A:
${answers.map((a: any, i: number) => `Q${i + 1}: ${a.question}\nA: ${a.answer}\nScore: ${a.score}/10 - ${a.analysis}`).join('\n\n')}

Tab switches during screening: ${app.tab_switches}
Total time: ${app.total_time_seconds} seconds`
        }
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!aiResponse.ok) throw new Error('Failed to complete scoring');

  const aiData = await aiResponse.json();
  let result;
  try {
    result = JSON.parse(aiData.choices?.[0]?.message?.content || '{}');
  } catch {
    result = {
      match_score: 50,
      match_category: 'maybe',
      strengths: [],
      red_flags: [],
      interview_questions: [],
    };
  }

  // Update application with results
  await supabase
    .from('screening_applications')
    .update({
      status: 'completed',
      match_score: result.match_score,
      match_category: result.match_category,
      strengths: result.strengths,
      red_flags: result.red_flags,
      interview_questions: result.interview_questions || [],
      completed_at: new Date().toISOString(),
    })
    .eq('id', applicationId);

  return new Response(JSON.stringify({ success: true, result }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
