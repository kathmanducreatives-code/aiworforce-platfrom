import { scrapeJobBoards } from "./1-job-board-scraper.js";
import { scrapeAndScoreLinkedInCommenters } from "./2-linkedin-scraper.js";
import { enrichLeads } from "./3-enrichment.js";
import { scrapeVCPortfolios } from "./4-vc-portfolio.js";
import { generateMessages } from "./5-message-generator.js";
import { saveToSupabase } from "./6-save-to-supabase.js";
import { triggerHotLeads } from "./7-trigger-n8n.js";
import type { PipelineEnv } from "../utils/env.js";
import type { OutreachLead } from "../types/lead.js";

export async function runPipeline(env: PipelineEnv): Promise<OutreachLead[]> {
  console.log("🚀 Starting Screening Pilot outreach pipeline...");

  const jobLeads = await scrapeJobBoards(env);
  const linkedinLeads = await scrapeAndScoreLinkedInCommenters(env);

  let allLeads: OutreachLead[] = [...jobLeads, ...linkedinLeads];

  if (env.runVcPortfolio) {
    const vcLeads = await scrapeVCPortfolios(env);
    allLeads = [...allLeads, ...vcLeads];
  }

  const enrichedLeads = await enrichLeads(allLeads, env);
  const messagedLeads = await generateMessages(enrichedLeads, env);

  await saveToSupabase(messagedLeads, env);
  await triggerHotLeads(messagedLeads, env);

  console.log(`✅ Pipeline complete. Leads processed: ${messagedLeads.length}`);
  return messagedLeads;
}
