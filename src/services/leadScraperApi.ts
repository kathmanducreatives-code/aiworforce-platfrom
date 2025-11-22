export interface LeadScraperFormData {
  currentCompanies: string[];
  currentJobTitles: string[];
  functionIds: string[];
  locations: string[];
  maxItems: number;
  pastCompanies: string[];
  pastJobTitles: string[];
  recentlyChangedJobs: boolean;
  schools: string[];
  searchQuery: string;
  seniorityLevelIds: string[];
  yearsAtCurrentCompanyIds: string[];
  yearsOfExperienceIds: string[];
}

export interface LeadScraperResponse {
  success: boolean;
  message?: string;
  leadsCount?: number;
}

// n8n webhook URL for LinkedIn Lead Scraper
const N8N_LEAD_SCRAPER_WEBHOOK_URL = "https://prasidha123aa.app.n8n.cloud/webhook/4e7f4a2b-3994-4dcd-945b-48f388139049";

export const leadScraperApi = {
  async scrapeLeads(formData: LeadScraperFormData, sessionId?: string): Promise<LeadScraperResponse> {
    try {
      console.log('Sending lead scraper request to n8n:', formData);
      
      const response = await fetch(N8N_LEAD_SCRAPER_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: sessionId,
          currentCompanies: formData.currentCompanies,
          currentJobTitles: formData.currentJobTitles,
          functionIds: formData.functionIds,
          locations: formData.locations,
          maxItems: formData.maxItems,
          pastCompanies: formData.pastCompanies,
          pastJobTitles: formData.pastJobTitles,
          recentlyChangedJobs: formData.recentlyChangedJobs,
          schools: formData.schools,
          searchQuery: formData.searchQuery,
          seniorityLevelIds: formData.seniorityLevelIds,
          yearsAtCurrentCompanyIds: formData.yearsAtCurrentCompanyIds,
          yearsOfExperienceIds: formData.yearsOfExperienceIds,
          timestamp: new Date().toISOString(),
          source: 'screening-pilot-lead-scraper',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText || 'Scraping failed'}`);
      }

      const result = await response.json();
      console.log('Response from n8n:', result);

      return {
        success: true,
        message: result.message || 'Lead scraping initiated successfully',
        leadsCount: result.leadsCount,
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
