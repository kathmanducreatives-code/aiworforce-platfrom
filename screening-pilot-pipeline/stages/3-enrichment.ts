import type { OutreachLead } from "../types/lead.js";
import type { PipelineEnv } from "../utils/env.js";
import { firecrawlScrape } from "../utils/firecrawl.js";
import { askClaudeJson } from "../utils/anthropic.js";

type EnrichmentExtraction = {
  team_size_signal: string | null;
  open_roles_count: number | null;
  tech_stack: string[];
  funding_signal: string | null;
  recent_growth_signal: string | null;
  enrichment_summary: string | null;
};

const inferAboutUrls = (companyUrl: string): string[] => {
  if (!companyUrl) return [];
  const clean = companyUrl.endsWith("/") ? companyUrl.slice(0, -1) : companyUrl;
  return [clean, `${clean}/about`, `${clean}/careers`];
};

async function extractEnrichmentFromText(markdown: string, env: PipelineEnv): Promise<EnrichmentExtraction> {
  return askClaudeJson<EnrichmentExtraction>({
    apiKey: env.anthropicApiKey,
    model: env.claudeModel,
    system:
      "Extract only concrete company growth/hiring signals. Return JSON with keys: team_size_signal, open_roles_count, tech_stack, funding_signal, recent_growth_signal, enrichment_summary.",
    user: markdown.slice(0, 160000),
    maxTokens: 1200
  });
}

export async function enrichLeads(leads: OutreachLead[], env: PipelineEnv): Promise<OutreachLead[]> {
  console.log("[Stage 3] Enriching leads with Firecrawl + Claude...");

  const output: OutreachLead[] = [];

  for (const lead of leads) {
    if (!lead.company_url) {
      output.push(lead);
      continue;
    }

    try {
      const urls = inferAboutUrls(lead.company_url);
      let combinedMarkdown = "";

      for (const url of urls) {
        try {
          const scraped = await firecrawlScrape({
            baseUrl: env.firecrawlBaseUrl,
            apiKey: env.firecrawlApiKey,
            url
          });
          combinedMarkdown += `\n\n## ${url}\n${scraped.markdown}`;
        } catch {
          // continue to next page for resilience
        }
      }

      if (!combinedMarkdown.trim() || !env.anthropicApiKey) {
        output.push(lead);
        continue;
      }

      const enrichment = await extractEnrichmentFromText(combinedMarkdown, env);
      output.push({
        ...lead,
        enrichment_data: {
          ...lead.enrichment_data,
          ...enrichment
        }
      });
    } catch (error) {
      console.error(`[Stage 3] Enrichment failed for ${lead.company_name}:`, error);
      output.push(lead);
    }
  }

  return output;
}
