export interface DeepSearchRequest {
  candidateId: string;
  candidateName: string;
  linkedinUrl?: string;
  company?: string;
}

export interface DeepSearchResponse {
  success: boolean;
  message?: string;
  searchId?: string;
}

const DEEP_SEARCH_WEBHOOK_URL = "https://praaasidha.app.n8n.cloud/webhook/deep-search";

export const deepSearchApi = {
  async runDeepSearch(request: DeepSearchRequest): Promise<DeepSearchResponse> {
    try {
      console.log('Initiating deep search for:', request);
      
      const response = await fetch(DEEP_SEARCH_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          candidate_id: request.candidateId,
          candidate_name: request.candidateName,
          linkedin_url: request.linkedinUrl,
          company: request.company,
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText || 'Deep search failed'}`);
      }

      const result = await response.json();
      console.log('Deep search initiated:', result);

      return {
        success: true,
        message: result.message || 'Deep search initiated successfully',
        searchId: result.searchId,
      };
    } catch (error) {
      console.error('Error running deep search:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to initiate deep search');
    }
  }
};
