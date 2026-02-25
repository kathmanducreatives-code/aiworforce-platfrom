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
    const { file_content, file_name, application_id } = await req.json();

    if (!file_content || !application_id) {
      return new Response(JSON.stringify({ error: 'file_content and application_id are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Call AI to extract resume data
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
            content: `You are a resume parser. Extract structured data from the resume text provided. Return ONLY valid JSON with this exact structure:
{
  "name": "Full Name",
  "email": "email@example.com",
  "phone": "phone number or null",
  "current_title": "Current Job Title or null",
  "current_company": "Current Company or null",
  "total_years_experience": number,
  "work_history": [
    {
      "company": "Company Name",
      "title": "Job Title",
      "start_date": "YYYY or YYYY-MM",
      "end_date": "YYYY or YYYY-MM or Present",
      "description": "Brief summary"
    }
  ],
  "education": [
    {
      "degree": "Degree Type",
      "field": "Field of Study",
      "school": "School Name",
      "year": "Graduation Year or null"
    }
  ],
  "skills": ["skill1", "skill2"],
  "certifications": ["cert1", "cert2"],
  "highest_education_level": "None|High School|Bachelor's|Master's|PhD"
}

Be thorough and accurate. If information is not present, use null or empty arrays. Calculate total_years_experience by summing work history durations.`
          },
          {
            role: 'user',
            content: `Parse this resume and extract structured data:\n\n${file_content}`
          }
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);
      throw new Error('Failed to parse resume with AI');
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || '{}';
    
    let extractedData;
    try {
      extractedData = JSON.parse(rawContent);
    } catch {
      console.error('Failed to parse AI response as JSON:', rawContent);
      extractedData = {
        name: null,
        email: null,
        phone: null,
        current_title: null,
        current_company: null,
        total_years_experience: 0,
        work_history: [],
        education: [],
        skills: [],
        certifications: [],
        highest_education_level: "None"
      };
    }

    // Update the application with extracted data
    const { error: updateError } = await supabase
      .from('screening_applications')
      .update({
        extracted_data: extractedData,
        status: 'resume_uploaded',
      })
      .eq('id', application_id);

    if (updateError) {
      console.error('Failed to update application:', updateError);
      throw new Error('Failed to save extracted data');
    }

    return new Response(JSON.stringify({ 
      success: true, 
      extracted_data: extractedData 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Error in parse-resume:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
