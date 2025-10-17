export interface LeadScraperFormData {
  jobTitle: string;
  location: string;
  keywords: string[];
  experienceLevel: string;
}

export interface LeadScraperResponse {
  success: boolean;
  message?: string;
  leadsCount?: number;
}

// Replace with your actual n8n webhook URL
const N8N_LEAD_SCRAPER_WEBHOOK_URL = "https://your-n8n-instance.app.n8n.cloud/webhook/lead-scraper";

export const leadScraperApi = {
  async scrapeLeads(formData: LeadScraperFormData): Promise<LeadScraperResponse> {
    try {
      console.log('Sending lead scraper request to n8n:', formData);
      
      const response = await fetch(N8N_LEAD_SCRAPER_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          job_title: formData.jobTitle,
          location: formData.location,
          keywords: formData.keywords,
          experience_level: formData.experienceLevel,
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
