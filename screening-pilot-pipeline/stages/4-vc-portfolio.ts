import crypto from "node:crypto";
import type { OutreachLead } from "../types/lead.js";
import type { PipelineEnv } from "../utils/env.js";
import { firecrawlScrape } from "../utils/firecrawl.js";
import { askClaudeJson } from "../utils/anthropic.js";
import { createSupabaseAdmin } from "../utils/supabase.js";
import { toIsoNow } from "../utils/http.js";

const PORTFOLIO_URLS = [
  "https://www.ycombinator.com/companies",
  "https://www.seedcamp.com/portfolio/",
  "https://www.techstars.com/portfolio"
];

type PortfolioCompany = {
  company_name: string;
  company_website: string;
  batch_or_cohort?: string | null;
  short_description?: string | null;
};

export async function scrapeVCPortfolios(env: PipelineEnv): Promise<OutreachLead[]> {
  console.log("[Stage 4] Running VC portfolio batch scrape...");

  if (!env.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY required for VC portfolio extraction.");
  }

  const companies: PortfolioCompany[] = [];

  for (const url of PORTFOLIO_URLS) {
    try {
      const scraped = await firecrawlScrape({
        baseUrl: env.firecrawlBaseUrl,
        apiKey: env.firecrawlApiKey,
        url
      });

      const extracted = await askClaudeJson<PortfolioCompany[]>({
        apiKey: env.anthropicApiKey,
        model: env.claudeModel,
        system:
          "Extract startup portfolio entries and return JSON array with company_name, company_website, batch_or_cohort, short_description.",
        user: scraped.markdown.slice(0, 160000),
        maxTokens: 2200
      });

      companies.push(...extracted);
      console.log(`[Stage 4] ${url}: extracted ${extracted.length} companies`);
    } catch (error) {
      console.error(`[Stage 4] Failed ${url}:`, error);
    }
  }

  const unique = new Map<string, PortfolioCompany>();
  for (const row of companies) {
    if (!row.company_name) continue;
    unique.set(row.company_name.toLowerCase(), row);
  }

  const deduped = [...unique.values()];

  const supabase = createSupabaseAdmin(env.supabaseUrl, env.supabaseServiceKey);
  const { error } = await supabase.from(env.supabaseVcTable).upsert(
    deduped.map(c => ({
      company_name: c.company_name,
      company_website: c.company_website || null,
      batch_or_cohort: c.batch_or_cohort || null,
      short_description: c.short_description || null,
      source: "firecrawl"
    })),
    { onConflict: "company_name" }
  );
  if (error) throw error;

  return deduped.map(c => ({
    id: crypto.randomUUID(),
    source: "vc_portfolio",
    company_name: c.company_name,
    company_url: c.company_website || "",
    score: 2,
    tier: "warm",
    pain_point: "scaling hiring demand",
    buying_signal_summary: c.batch_or_cohort ? `Portfolio company (${c.batch_or_cohort})` : "Portfolio startup",
    enrichment_data: {
      enrichment_summary: c.short_description || null
    },
    personalized_message: "",
    status: "pending",
    created_at: toIsoNow()
  }));
}
