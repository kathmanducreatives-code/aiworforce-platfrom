export interface LeadScraperFormData {
  currentCompanies: string[];
  currentJobTitles: string[];
  locations: string[];
  industries: number[];
  maxItems: number;
  searchQuery: string;
  mode?: 'standard' | 'advanced';
}

export interface LeadScraperResponse {
  success: boolean;
  message?: string;
  leadsCount?: number;
  results_metadata?: {
    actual_count: number;
    requested_count: number;
  };
  suggestions?: Array<{
    label: string;
    action: string;
    value?: string;
  }>;
}

// n8n webhook URLs
const N8N_LEAD_SCRAPER_WEBHOOK_URL = "https://n8n.prasidha.me/webhook/4e7f4a2b-3994-4dcd-945b-48f388139049";
const N8N_ADVANCED_SEARCH_WEBHOOK_URL = "https://n8n.prasidha.me/webhook/advanced-firecrawl-search"; // Place-holder for now

export const leadScraperApi = {
  async scrapeLeads(formData: LeadScraperFormData, sessionId?: string): Promise<LeadScraperResponse> {
    try {
      const mode = formData.mode || 'standard';
      const webhookUrl = mode === 'advanced' ? N8N_ADVANCED_SEARCH_WEBHOOK_URL : N8N_LEAD_SCRAPER_WEBHOOK_URL;

      const payload = {
        currentCompanies: formData.currentCompanies ?? [],
        currentJobTitles: formData.currentJobTitles ?? [],
        locations: formData.locations ?? [],
        industries: formData.industries ?? [],
        maxItems: formData.maxItems ?? 50,
        searchQuery: formData.searchQuery ?? "",
        mode: mode,
        session_id: sessionId,
        timestamp: new Date().toISOString(),
        source: mode === 'advanced' ? "screening-pilot-firecrawl-search" : "screening-pilot-lead-scrape",
      };

      console.log(`[${mode.toUpperCase()}] Webhook payload:`, payload);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText || 'Scraping failed'}`);
      }

      const result = await response.json();
      console.log('Response from n8n:', result);

      return {
        success: true,
        message: result.message || `${mode === 'advanced' ? 'Advanced search' : 'Lead scraping'} initiated successfully`,
        leadsCount: result.leadsCount,
        results_metadata: result.results_metadata,
        suggestions: result.suggestions,
      };
    } catch (error) {
      console.error('Error calling lead scraper webhook:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to initiate lead scraping');
    }
  }
};
