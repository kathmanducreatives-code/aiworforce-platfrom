import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Save resume analysis function called');
    
    const { analysisData } = await req.json();
    const requestId = analysisData?.[0]?.requestId || `edge_${Date.now()}`;
    console.log(`[${requestId}] Received analysis data:`, JSON.stringify(analysisData, null, 2));

    if (!analysisData || !Array.isArray(analysisData) || analysisData.length === 0) {
      throw new Error('Invalid analysis data: expected non-empty array');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[${requestId}] Processing`, analysisData.length, 'analysis records...');

    // Transform and insert data with hardened recruitment_name handling
    const recordsToInsert = analysisData.map((analysis: any) => {
      // Canonicalize and harden recruitment_name field
      const rawRecruitmentName = analysis.recruitment_name || analysis.recruitmentName || '';
      const cleanRecruitmentName = typeof rawRecruitmentName === 'string' 
        ? rawRecruitmentName.trim() 
        : String(rawRecruitmentName).trim();
      const finalRecruitmentName = cleanRecruitmentName || null; // Convert empty strings to null
      
      console.log(`[${requestId}] Processing analysis record:`, {
        candidateName: analysis.candidateName,
        rawRecruitmentName: rawRecruitmentName,
        cleanRecruitmentName: cleanRecruitmentName,
        finalRecruitmentName: finalRecruitmentName,
        email: analysis.email
      });

      return {
        candidate_name: analysis.candidateName || 'Unknown',
        email: analysis.email || null,
        resume: analysis.resume || null,
        strengths: typeof analysis.strengths === 'string' ? analysis.strengths : JSON.stringify(analysis.strengths || []),
        weaknesses: typeof analysis.weaknesses === 'string' ? analysis.weaknesses : JSON.stringify(analysis.weaknesses || []),
        risk_factor: analysis.riskFactor || 0,
        reward_factor: analysis.rewardFactor || 0,
        fit_score: analysis.fitScore || 0,
        overall_factor: analysis.overallFactor || analysis.fitScore || 0,
        justification: analysis.justification || null,
        recruitment_name: finalRecruitmentName
      };
    });

    console.log(`[${requestId}] Records to insert:`, JSON.stringify(recordsToInsert, null, 2));

    // Insert into database
    const { data, error } = await supabase
      .from('resume_analyses')
      .insert(recordsToInsert)
      .select();

    if (error) {
      console.error(`[${requestId}] Database insert error:`, error);
      throw new Error(`Failed to save analysis data: ${error.message}`);
    }

    console.log(`[${requestId}] Successfully inserted`, data?.length || 0, 'records');
    console.log(`[${requestId}] Inserted records:`, JSON.stringify(data, null, 2));

    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully saved ${data?.length || 0} analysis record(s)`,
        data: data
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const requestId = 'unknown';
    console.error(`[${requestId}] Error in save-resume-analysis function:`, error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});