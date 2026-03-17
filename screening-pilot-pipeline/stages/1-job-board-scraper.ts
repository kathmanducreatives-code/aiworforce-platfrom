import crypto from "node:crypto";
import { askClaudeJson } from "../utils/anthropic.js";
import { firecrawlScrape } from "../utils/firecrawl.js";
import { toIsoNow } from "../utils/http.js";
import type { PipelineEnv } from "../utils/env.js";
import type { JobBoardLeadInput, OutreachLead } from "../types/lead.js";

const JOB_BOARD_URLS = [
  "https://wellfound.com/jobs?role=engineer",
  "https://www.ycombinator.com/jobs",
  "https://remotive.com/remote-jobs/software-dev",
  "https://workatastartup.com/jobs"
];

const STAFFING_RE = /(staffing|recruiting firm|agency|headhunter|talent acquisition)/i;

function withinLastDays(dateLike: string, days: number): boolean {
  const parsed = new Date(dateLike);
  if (Number.isNaN(parsed.getTime())) return false;
  const ms = Date.now() - parsed.getTime();
  return ms <= days * 24 * 60 * 60 * 1000;
}

async function extractListingsWithClaude(markdown: string, sourceUrl: string, env: PipelineEnv): Promise<JobBoardLeadInput[]> {
  return askClaudeJson<JobBoardLeadInput[]>({
    apiKey: env.anthropicApiKey,
    model: env.claudeModel,
    system:
      "Extract recent job listings. Return an array of JSON objects with keys: company_name, role_title, date_posted, company_url, job_url. Keep only records where you can infer a valid posting date.",
    user: `Source URL: ${sourceUrl}\n\nMarkdown:\n${markdown.slice(0, 160000)}`,
    maxTokens: 2200
  });
}

export async function scrapeJobBoards(env: PipelineEnv): Promise<OutreachLead[]> {
  console.log("[Stage 1] Scraping job boards with Firecrawl...");

  const allListings: JobBoardLeadInput[] = [];

  for (const url of JOB_BOARD_URLS) {
    try {
      const scraped = await firecrawlScrape({
        baseUrl: env.firecrawlBaseUrl,
        apiKey: env.firecrawlApiKey,
        url
      });

      if (!env.anthropicApiKey) {
        console.warn(`[Stage 1] Skipping ${url} extraction because ANTHROPIC_API_KEY is missing.`);
        continue;
      }

      const listings = await extractListingsWithClaude(scraped.markdown, url, env);
      allListings.push(...listings);
      console.log(`[Stage 1] ${url}: extracted ${listings.length} listings`);
    } catch (error) {
      console.error(`[Stage 1] Failed ${url}:`, error);
    }
  }

  const dedup = new Map<string, JobBoardLeadInput>();
  for (const row of allListings) {
    const key = `${row.company_name}::${row.role_title}::${row.job_url}`.toLowerCase();
    dedup.set(key, row);
  }

  const filtered = [...dedup.values()]
    .filter(row => withinLastDays(row.date_posted, 7))
    .filter(row => !STAFFING_RE.test(`${row.company_name} ${row.role_title}`))
    .slice(0, env.maxJobLeads);

  const leads: OutreachLead[] = filtered.map(row => ({
    id: crypto.randomUUID(),
    source: "job_board",
    company_name: row.company_name,
    company_url: row.company_url || "",
    score: 4,
    tier: "hot",
    pain_point: "urgent engineering hire",
    buying_signal_summary: `${row.company_name} posted ${row.role_title} recently (${row.date_posted})`,
    job_role: row.role_title,
    source_post_url: row.job_url,
    enrichment_data: {},
    personalized_message: "",
    status: "pending",
    created_at: toIsoNow()
  }));

  console.log(`[Stage 1] Hot leads after filtering: ${leads.length}`);
  return leads;
}
