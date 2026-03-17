import { createClient } from "@supabase/supabase-js";
import type { OutreachLead } from "../types/lead.js";

export function createSupabaseAdmin(url: string, serviceKey: string) {
  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export async function saveOutreachLeads(params: {
  client: ReturnType<typeof createSupabaseAdmin>;
  table: string;
  leads: OutreachLead[];
}): Promise<void> {
  if (!params.leads.length) return;

  const rows = params.leads.map(lead => ({
    id: lead.id,
    source: lead.source,
    company_name: lead.company_name,
    contact_name: lead.contact_name || null,
    contact_title: lead.contact_title || null,
    contact_linkedin_url: lead.contact_linkedin_url || null,
    company_url: lead.company_url,
    score: lead.score,
    tier: lead.tier,
    pain_point: lead.pain_point,
    buying_signal_summary: lead.buying_signal_summary,
    original_comment: lead.original_comment || null,
    source_post_url: lead.source_post_url || null,
    job_role: lead.job_role || null,
    enrichment_data: lead.enrichment_data,
    personalized_message: lead.personalized_message,
    status: lead.status,
    created_at: lead.created_at
  }));

  const { error } = await params.client.from(params.table).upsert(rows, { onConflict: "id" });
  if (error) throw error;
}
