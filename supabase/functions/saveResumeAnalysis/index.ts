import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const supabaseUrl = "https://zbwsbnqqpkvdhqwavjke.supabase.co"; // <-- your real Supabase URL
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpid3NibnFxcGt2ZGhxd2F2amtlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NjUzODMzMSwiZXhwIjoyMDcyMTE0MzMxfQ.qk_UcRrjH7K5tknC8IpnCD_q1lWTHYZ6qqsFLwu5xnU"; // <-- your service role key
const supabase = createClient(supabaseUrl, supabaseKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Save resume analysis function called");

    const { resume, candidate_name, email, output = {}, recruitmentName, recruitment_name } =
      await req.json();

    const {
      candidate_strengths = [],
      candidate_weaknesses = [],
      risk_factor = null,
      reward_factor = null,
      overall_fit_rating = null,
      justification_for_rating = null,
    } = output;

    // 🔑 Robust recruitment_name handling
    const computedRecruitmentName =
      typeof recruitmentName === "string" && recruitmentName.trim().length > 0
        ? recruitmentName.trim()
        : typeof recruitment_name === "string" && recruitment_name.trim().length > 0
        ? recruitment_name.trim()
        : "Uncategorized";

    const { data, error } = await supabase
      .from("resume_analyses")
      .insert([
        {
          resume,
          candidate_name: candidate_name || "Unknown",
          email,
          strengths: candidate_strengths.join("\n"),
          weaknesses: candidate_weaknesses.join("\n"),
          risk_factor,
          reward_factor,
          fit_score: { score: overall_fit_rating },
          overall_factor: { explanation: justification_for_rating },
          justification: justification_for_rating,
          recruitment_name: computedRecruitmentName,
        },
      ])
      .select();

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error in save-resume-analysis function:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});