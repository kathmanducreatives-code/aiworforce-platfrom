import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const userId = url.searchParams.get("user");
    const format = url.searchParams.get("format") || "xml";

    if (!userId) {
      return new Response(JSON.stringify({ error: "Missing user parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: jobs, error } = await supabase
      .from("screening_jobs")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active");

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (format === "json") {
      const jsonFeed = {
        version: "1.0",
        publisher: "ScreeningPilot",
        generated_at: new Date().toISOString(),
        jobs: (jobs || []).map((j: any) => ({
          title: j.title,
          company: j.company_name,
          description: j.description,
          required_skills: j.required_skills,
          required_years: j.required_years,
          education: j.education_requirement,
          salary_min: j.salary_min,
          salary_max: j.salary_max,
          apply_url: `https://screeningpilot.lovable.app/apply/${j.slug}`,
          posted_date: j.created_at,
        })),
      };

      return new Response(JSON.stringify(jsonFeed, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // XML format (Indeed-compatible)
    const xmlJobs = (jobs || [])
      .map(
        (j: any) => `  <job>
    <title><![CDATA[${j.title}]]></title>
    <company><![CDATA[${j.company_name}]]></company>
    <description><![CDATA[${j.description}]]></description>
    <salary_min>${j.salary_min || ""}</salary_min>
    <salary_max>${j.salary_max || ""}</salary_max>
    <education>${j.education_requirement || ""}</education>
    <experience_years>${j.required_years || 0}</experience_years>
    <skills>${(j.required_skills || []).join(", ")}</skills>
    <url>https://screeningpilot.lovable.app/apply/${j.slug}</url>
    <date>${j.created_at}</date>
  </job>`
      )
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<source>
  <publisher>ScreeningPilot</publisher>
  <publisherurl>https://screeningpilot.lovable.app</publisherurl>
  <lastBuildDate>${new Date().toISOString()}</lastBuildDate>
${xmlJobs}
</source>`;

    return new Response(xml, {
      headers: { ...corsHeaders, "Content-Type": "application/xml" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
