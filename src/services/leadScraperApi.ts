export interface LeadScraperFormData {
  jobTitle: string;
  location: string;
  keywords: string[];
  experienceLevel: string;
  industry: string;
  numberOfLeads: number;
}

export interface LeadScraperResponse {
  success: boolean;
  message?: string;
  leadsCount?: number;
}

// n8n webhook URL for LinkedIn Lead Scraper
const N8N_LEAD_SCRAPER_WEBHOOK_URL = "https://praaasidha.app.n8n.cloud/webhook/a482bedc-5ac9-4128-9a1b-38eabe61c426";

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
          job_title: formData.jobTitle,
          location: formData.location,
          keywords: formData.keywords,
          experience_level: formData.experienceLevel,
          industry: formData.industry,
          number_of_leads: formData.numberOfLeads,
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
