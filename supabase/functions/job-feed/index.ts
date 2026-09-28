// RETIRED. This was the legacy ScreeningPilot job feed: it returned any user's
// active screening jobs to ANYONE who knew (or guessed) a user id, through the
// service-role client with no caller check. Agentory's beta has no job
// distribution, so the endpoint is closed rather than guarded — it answers 410
// and touches nothing. Remove the deployed function with
// `supabase functions delete job-feed` (see docs/launch/deployment-runbook.md).

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function handleJobFeed(req: Request): Response {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  return new Response(JSON.stringify({ error: "gone", detail: "The job feed has been retired." }), {
    status: 410,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

if (!Deno.env.get("JOB_FEED_IMPORT_ONLY")) Deno.serve(handleJobFeed);
