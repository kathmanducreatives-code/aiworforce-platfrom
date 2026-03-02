import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { file_content_base64, file_name, job_id } = await req.json();

    if (!file_content_base64) {
      return new Response(JSON.stringify({ error: 'file_content_base64 is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    console.log(`Parsing resume: ${file_name || 'unknown'} for job: ${job_id || 'unknown'}`);

    // Decode base64 to text for text-based extraction attempt
    let resumeText = '';
    try {
      const binaryString = atob(file_content_base64);
      // Try to extract readable text from the binary content
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const decoder = new TextDecoder('utf-8', { fatal: false });
      resumeText = decoder.decode(bytes);
    } catch {
      resumeText = '';
    }

    // Determine if content is likely a PDF (binary) or readable text
    const isPdf = file_name?.toLowerCase().endsWith('.pdf') || resumeText.startsWith('%PDF');
    
    // Build the AI request - use inline_data for PDFs so Gemini can read them natively
    const systemPrompt = `You are a resume parser. Extract structured data from the resume provided. Return ONLY valid JSON with this exact structure:
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

Be thorough and accurate. If information is not present, use null or empty arrays. Calculate total_years_experience by summing work history durations.`;

    let messages: any[];

    if (isPdf) {
      // For PDFs, send as base64 inline data so Gemini can process the document natively
      const mimeType = file_name?.toLowerCase().endsWith('.docx')
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf';
      
      messages = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            {
              type: 'file',
              file: {
                filename: file_name || 'resume.pdf',
                file_data: `data:${mimeType};base64,${file_content_base64}`,
              },
            },
            {
              type: 'text',
              text: 'Parse this resume document and extract all structured data as JSON.',
            },
          ],
        },
      ];
    } else {
      // For text-readable content (e.g. plain text resumes)
      messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Parse this resume and extract structured data:\n\n${resumeText}` },
      ];
    }

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
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again in a moment.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: 'AI credits exhausted. Please contact support.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error('Failed to parse resume with AI');
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || '{}';

    // Strip markdown code fences if present
    let jsonString = rawContent.trim();
    if (jsonString.startsWith('```')) {
      jsonString = jsonString.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    let extractedData;
    try {
      extractedData = JSON.parse(jsonString);
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

    console.log('Successfully parsed resume for:', extractedData.name || 'unknown');

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
