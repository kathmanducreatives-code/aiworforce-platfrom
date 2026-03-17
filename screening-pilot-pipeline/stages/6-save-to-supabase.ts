import type { OutreachLead } from "../types/lead.js";
import type { PipelineEnv } from "../utils/env.js";
import { createSupabaseAdmin, saveOutreachLeads } from "../utils/supabase.js";

export async function saveToSupabase(leads: OutreachLead[], env: PipelineEnv): Promise<void> {
  console.log(`[Stage 6] Saving ${leads.length} leads to Supabase...`);
  const client = createSupabaseAdmin(env.supabaseUrl, env.supabaseServiceKey);
  await saveOutreachLeads({
    client,
    table: env.supabaseOutreachTable,
    leads
  });
}
