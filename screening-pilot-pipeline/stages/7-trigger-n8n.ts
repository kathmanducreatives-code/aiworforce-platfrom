import type { OutreachLead } from "../types/lead.js";
import type { PipelineEnv } from "../utils/env.js";

function buildN8nUrl(base: string, path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export async function triggerN8nOutreach(lead: OutreachLead, env: PipelineEnv): Promise<unknown> {
  const url = buildN8nUrl(env.n8nBaseUrl, env.n8nOutreachPath);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.n8nApiKey ? { Authorization: `Bearer ${env.n8nApiKey}` } : {})
    },
    body: JSON.stringify({
      lead_id: lead.id,
      contact_name: lead.contact_name,
      contact_linkedin_url: lead.contact_linkedin_url,
      personalized_message: lead.personalized_message,
      tier: lead.tier,
      trigger: "outreach_ready"
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`n8n trigger failed (${response.status}): ${text.slice(0, 500)}`);
  }

  return text ? JSON.parse(text) : {};
}

export async function triggerHotLeads(leads: OutreachLead[], env: PipelineEnv): Promise<void> {
  const hotLeads = leads.filter(l => l.tier === "hot");
  console.log(`[Stage 7] Triggering n8n for ${hotLeads.length} hot leads (dryRun=${env.dryRun})...`);

  if (env.dryRun) {
    hotLeads.forEach(lead => {
      console.log(`[Stage 7][DRY RUN] Would trigger lead ${lead.id} (${lead.company_name})`);
    });
    return;
  }

  for (const lead of hotLeads) {
    try {
      await triggerN8nOutreach(lead, env);
    } catch (error) {
      console.error(`[Stage 7] Failed lead ${lead.id}:`, error);
    }
  }
}
