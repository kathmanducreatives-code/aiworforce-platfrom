export const ICP_WEBHOOK_URL = 'https://n8n.prasidha.me/webhook/icp-lookalike-engine';
export const DEEP_SEARCH_WEBHOOK_URL = 'https://n8n.prasidha.me/webhook/21eba91f-c2eb-4748-8f7c-67b3a8a2d313';

export interface ICPResponse {
    success: boolean;
    error?: { message: string; code?: string };
    errors?: string[];
    // Step 1
    session_id?: string;
    profile_name?: string;
    // Step 2
    message?: string;
    // Step 3
    profile?: any;
    generated_strategy?: string;
    search_logic_dna?: string;
    firmographic_constraints?: any;
    technical_execution?: any;
    // Step 4
    apify_run_id?: string;
    status?: 'running' | 'completed' | 'failed';
    results_count?: number;
    results?: any[];
    total_count?: number;
    // Deep Search Result
    deep_search_result?: {
        candidate_id: string;
        candidate_name: string;
        linkedin_url: string;
        company: string;
        profile_picture_url: string;
        analysis: {
            summary: string;
            education: string;
            certifications: string;
            strengths: string[];
            weaknesses: string[];
            ideal_roles: string[];
            fit_score: number;
            languages?: string[];
        };
        email?: string | null;
    };
    [key: string]: any;
}

// Helper to normalize n8n responses which might be [response] or response
// and might have data nested in a .data property or flat
const normalizeResponse = async (response: Response): Promise<ICPResponse> => {
    let raw: any;
    try {
        raw = await response.json();
    } catch (e) {
        throw new Error('Failed to parse API response');
    }

    // Unpack Array if present (n8n standard behavior often returns arrays)
    const item = Array.isArray(raw) ? raw[0] : raw;

    if (!item) {
        throw new Error('Empty response from server');
    }

    // Check success flag on the item
    // If explicit success: false, throw
    if (item.success === false) {
        const errorMsg = item.errors?.[0] || item.error?.message || item.message || 'Operation failed';
        throw new Error(errorMsg);
    }

    // If item has a .data property, merge it up, but keep top level success/message
    if (item.data) {
        return {
            success: item.success !== false, // default true if missing
            ...item.data,
            // Preserve top-level keys if they don't exist in data
            apify_run_id: item.data.apify_run_id || item.apify_run_id,
            ...item
        };
    }

    // Otherwise return flat item
    return {
        success: item.success !== false,
        ...item
    };
};

export const icpAPI = {
    // Step 1: Save Account Definition
    saveAccountDefinition: async (data: {
        session_id: string;
        account_data: {
            name: string;
            industries: string[];
            size: string;
            location: string[];
            hiring_intensity: string;
        };
    }): Promise<ICPResponse> => {
        try {
            const response = await fetch(ICP_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_account_definition',
                    session_id: data.session_id,
                    profile_name: data.account_data.name,
                    target_industry: data.account_data.industries,
                    company_size: data.account_data.size,
                    company_location: data.account_data.location,
                    hiring_intensity: data.account_data.hiring_intensity,
                    metadata: {
                        timestamp: new Date().toISOString(),
                        client_version: '1.0.0'
                    }
                })
            });

            if (!response.ok) {
                // Try to parse error text if JSON fails
                const text = await response.text();
                throw new Error(`Request failed: ${response.status} ${text}`);
            }

            return await normalizeResponse(response);
        } catch (error) {
            console.error("API Error (saveAccountDefinition):", error);
            throw error;
        }
    },

    // Step 2: Save Persona Intent
    savePersonaIntent: async (session_id: string, search_query: string): Promise<ICPResponse> => {
        try {
            const response = await fetch(ICP_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_persona_intent',
                    session_id: session_id,
                    persona_description: search_query,
                    metadata: {
                        timestamp: new Date().toISOString()
                    }
                })
            });

            if (!response.ok) throw new Error('Request failed');
            return await normalizeResponse(response);
        } catch (error) {
            console.error("API Error (savePersonaIntent):", error);
            throw error;
        }
    },

    // Step 3: Analyze Lookalike Profile
    analyzeLookalikeProfile: async (session_id: string, linkedin_url: string): Promise<ICPResponse> => {
        try {
            const response = await fetch(ICP_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'scrape_lookalike_profile',
                    session_id: session_id,
                    linkedin_url: linkedin_url,
                    metadata: {
                        timestamp: new Date().toISOString()
                    }
                })
            });

            if (!response.ok) throw new Error('Request failed');
            return await normalizeResponse(response);
        } catch (error) {
            console.error("API Error (analyzeLookalikeProfile):", error);
            throw error;
        }
    },

    // Step 4: Start Scraping (Launch)
    startScraping: async (session_id: string): Promise<ICPResponse> => {
        try {
            const response = await fetch(ICP_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'generate_strategy_and_launch',
                    session_id: session_id,
                    metadata: {
                        timestamp: new Date().toISOString()
                    }
                })
            });

            if (!response.ok) throw new Error('Request failed');
            return await normalizeResponse(response);
        } catch (error) {
            console.error("API Error (startScraping):", error);
            throw error;
        }
    },

    // Get Scrape Status
    getScrapeStatus: async (session_id: string): Promise<ICPResponse> => {
        try {
            const response = await fetch(ICP_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'get_scrape_status',
                    session_id: session_id
                })
            });

            if (!response.ok) throw new Error('Request failed');
            return await normalizeResponse(response);
        } catch (error) {
            console.error("API Error (getScrapeStatus):", error);
            return { success: false, status: 'failed', error: { message: (error as Error).message } };
        }
    },

    // Get Results
    getResults: async (session_id: string): Promise<ICPResponse> => {
        try {
            const response = await fetch(ICP_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'get_results',
                    session_id: session_id
                })
            });

            if (!response.ok) throw new Error('Request failed');
            return await normalizeResponse(response);
        } catch (error) {
            console.error("API Error (getResults):", error);
            throw error;
        }
    },

    // Get Industry Names
    getIndustryNames: async (industry_ids: string[]): Promise<ICPResponse> => {
        try {
            const response = await fetch(ICP_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'get_industry_name',
                    industry_ids: industry_ids
                })
            });

            if (!response.ok) throw new Error('Request failed');
            return await normalizeResponse(response);
        } catch (error) {
            console.error("API Error (getIndustryNames):", error);
            return { success: false, error: { message: (error as Error).message } };
        }
    },

    // Deep Search
    deepSearch: async (candidate_id: string, linkedin_url: string, evaluation_prompt?: string): Promise<ICPResponse> => {
        try {
            const response = await fetch(DEEP_SEARCH_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    candidate_id,
                    linkedin_url,
                    evaluation_prompt
                })
            });

            if (!response.ok) throw new Error('Request failed');
            return await normalizeResponse(response);
        } catch (error) {
            console.error("API Error (deepSearch):", error);
            // Non-blocking error
            return { success: false, error: { message: (error as Error).message } };
        }
    },

    // Reveal Email
    // Reveal Email
    revealEmail: async (profile_id: string, linkedin_url: string, session_id: string): Promise<ICPResponse> => {
        try {
            const response = await fetch(ICP_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'reveal_email',
                    profile_id: profile_id,
                    linkedin_url: linkedin_url,
                    session_id: session_id
                })
            });

            // Special handling for "Email not found" cases where API returns 200 but success: false
            if (response.ok) {
                const cloned = response.clone();
                try {
                    const raw = await cloned.json();
                    const item = Array.isArray(raw) ? raw[0] : raw;
                    // If specifically email not found error, return distinct response
                    if (item.success === false && item.email === null) {
                        return {
                            success: false,
                            email: null,
                            error: { message: item.error || "Email not found" }
                        };
                    }
                } catch (e) {
                    // JSON parse error or other, let normalizeResponse handle it
                }
            }

            if (!response.ok) throw new Error('Failed to reveal email');
            return await normalizeResponse(response);
        } catch (error) {
            console.error("API Error (revealEmail):", error);
            throw error;
        }
    },

    saveDraft: async (draft: any): Promise<ICPResponse> => {
        console.log("Draft sync temporarily disabled/local only.");
        return { success: true, session_id: draft.id || "local_draft" };
    },

    loadDraft: async (draftId: string, userId: string): Promise<ICPResponse> => {
        return { success: false, error: { message: "Draft loading disabled" } };
    }
};
