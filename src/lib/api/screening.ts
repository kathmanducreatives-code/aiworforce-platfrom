// API client for Behavioral Screening n8n webhook
const WEBHOOK_URL = 'https://n8n.prasidha.me/webhook/behavioral-screening';

export interface GenerateLinkRequest {
    action: 'generate_link';
    candidate_id: string;
    job_role: string;
    template: {
        id: string;
        name?: string;
        description?: string;
    };
    role_briefing: {
        role_title: string;
        skills_expected: string;
        experience_required: string;
        key_traits?: string[];
    };
    scenario_config: {
        total_limit: number;
        category_limits: Record<string, number>;
    };
}

export interface StartSessionRequest {
    action: 'start_session';
    token: string;
}

export interface GetNextQuestionRequest {
    action: 'get_next_question';
    session_id: string;
    candidateAnswer: string;
}

export interface AnalyzeResponsesRequest {
    action: 'analyze_responses';
    session_id: string;
}

export interface APIResponse<T> {
    success: boolean;
    data: T | null;
    message?: string;
    errors?: Array<{
        stage: string;
        error: string;
        details: string;
        timestamp: string;
    }>;
}

export interface GenerateLinkResponse {
    candidate_link: string;
    token: string;
    expires_at: string;
}

export interface StartSessionResponse {
    session_id: string;
    first_question: {
        questionId: string;
        questionText: string;
        competencyArea: string;
    };
}

export interface NextQuestionResponse {
    questionId: string;
    questionText: string;
    isFollowUp: boolean;
    questionsRemaining: number;
    competencyArea: string;
}

export interface AnalysisResponse {
    overallScore: number;
    riskLevel: string;
    strengths: string[];
    developmentAreas: string[];
    redFlags: string[];
    greenFlags: string[];
    roleFitSummary: string;
    recommendations: string;
}

class ScreeningAPIClient {
    private async makeRequest<T>(payload: any): Promise<APIResponse<T>> {
        try {
            const response = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'API request failed');
            }

            return data;
        } catch (error: any) {
            console.error('Screening API Error:', error);
            throw error;
        }
    }

    async generateLink(request: Omit<GenerateLinkRequest, 'action'>): Promise<GenerateLinkResponse> {
        const response = await this.makeRequest<GenerateLinkResponse>({
            action: 'generate_link',
            ...request,
        });

        if (!response.success || !response.data) {
            throw new Error(response.message || 'Failed to generate screening link');
        }

        return response.data;
    }

    async startSession(token: string): Promise<StartSessionResponse> {
        const response = await this.makeRequest<StartSessionResponse>({
            action: 'start_session',
            token,
        });

        if (!response.success || !response.data) {
            throw new Error(response.message || 'Failed to start screening session');
        }

        return response.data;
    }

    async getNextQuestion(sessionId: string, candidateAnswer: string): Promise<NextQuestionResponse> {
        const response = await this.makeRequest<NextQuestionResponse>({
            action: 'get_next_question',
            session_id: sessionId,
            candidateAnswer,
        });

        if (!response.success || !response.data) {
            throw new Error(response.message || 'Failed to get next question');
        }

        return response.data;
    }

    async analyzeResponses(sessionId: string): Promise<AnalysisResponse> {
        const response = await this.makeRequest<AnalysisResponse>({
            action: 'analyze_responses',
            session_id: sessionId,
        });

        if (!response.success || !response.data) {
            throw new Error(response.message || 'Failed to analyze responses');
        }

        return response.data;
    }
    // Separate URL for ICP Scoring
    private ICP_WEBHOOK_URL = 'https://n8n.prasidha.me/webhook/icp-lookalike-engine';

    // Legacy method for compatibility if still used elsewhere
    async calculateICPScore(data: any): Promise<any> {
        // ... existing implementation if needed or deprecate
        return { score: 85, match_level: "High", details: "Legacy Score" };
    }
}

// ------------------------------------------------------------------
// ICP Lookalike Engine API Client
// ------------------------------------------------------------------

export interface ICPSessionResponse {
    success: boolean;
    session_id?: string;
    data?: any;
    message?: string;
}

class ICPAPIClient {
    private WEBHOOK_URL = 'https://n8n.prasidha.me/webhook/icp-lookalike-engine';

    private async callWebhook(action: string, payload: any): Promise<any> {
        try {
            const body = {
                action,
                ...payload,
                metadata: {
                    timestamp: new Date().toISOString(),
                    client_version: '1.0.0'
                }
            };

            const response = await fetch(this.WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                let errorMessage = `API Error: ${response.statusText}`;
                try {
                    const errData = await response.json();
                    if (errData.message) errorMessage = errData.message;
                } catch (e) { /* ignore */ }
                throw new Error(errorMessage);
            }

            // Handle response safely - might be empty or text
            const text = await response.text();
            try {
                return text ? JSON.parse(text) : { success: true };
            } catch (e) {
                console.warn(`[${action}] Response was not JSON:`, text);
                return { success: true, raw_response: text };
            }
        } catch (error) {
            console.error(`ICP API Error [${action}]:`, error);
            throw error;
        }
    }

    /**
     * Step 1: Save Account Definition
     * Generates or uses existing session_id.
     */
    async saveAccountDefinition(data: any, sessionId?: string): Promise<{ session_id: string }> {
        const currentSessionId = sessionId || crypto.randomUUID();

        try {
            const response = await this.callWebhook('save_account', {
                session_id: currentSessionId,
                account_data: data
            });
            return { session_id: response.session_id || currentSessionId };
        } catch (error) {
            console.warn("Save Account Definition failed upstream, proceeding with local session.", error);
            return { session_id: currentSessionId };
        }
    }

    /**
     * Step 2: Save Persona Search Query
     */
    async savePersonaIntent(query: string, sessionId: string): Promise<any> {
        if (!sessionId) throw new Error("Session ID is required");
        return this.callWebhook('save_persona', {
            session_id: sessionId,
            search_query: query
        });
    }

    /**
     * Step 3: Analyze Lookalike Profile
     */
    async scrapeLookalikeProfile(url: string, sessionId: string): Promise<any> {
        if (!sessionId) throw new Error("Session ID is required");

        const response = await this.callWebhook('scrape_lookalike', {
            session_id: sessionId,
            url: url
        });

        console.log('[DEBUG] Raw Scrape Response:', JSON.stringify(response, null, 2));

        // Return raw response to allow LookalikeForm to handle structure (response.data.profile)
        return response;

        // Mock fallback strictly for dev/demo if webhook fails or isn't ready
        // DISABLED per user request to valid real integration
        /*
        const isDev = typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development';
        
        if (isDev && !response.name) {
            console.warn("Using mock profile data");
            return {
                name: "Alex Thompson",
                current_title: "Senior Product Manager",
                company: "TechFlow Inc.",
                top_skills: ["Product Strategy", "Agile Methodologies", "User Research", "Data Analytics", "SaaS"],
                education_summary: "Stanford University - MBA",
                total_years_experience: "8 years",
                seniority_level: "Senior",
                summary: "Experienced product leader with a track record of scaling SaaS platforms."
            };
        }
        */

        return response;
    }

    /**
     * Step 4a: Generate Strategy (Pre-Launch)
     */
    async generateStrategy(sessionId: string): Promise<any> {
        if (!sessionId) throw new Error("Session ID is required");

        const response = await this.callWebhook('generate_strategy', {
            session_id: sessionId
        });

        const isDev = typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development';

        // Mock fallback common structure
        if (!response.search_logic_dna && isDev) {
            return {
                search_logic_dna: 'site:linkedin.com/in/ ("Product Manager" OR "PM") AND ("SaaS" OR "B2B") AND "San Francisco"',
                firmographic_constraints: { industries: ["Software"], size: "51-200" },
                technical_execution: { mode: "deep_scrape", depth: 2 }
            };
        }

        return response;
    }

    /**
     * Step 4b: Launch Strategy
     */
    async generateStrategyAndLaunch(data: any, sessionId: string): Promise<any> {
        if (!sessionId) throw new Error("Session ID is required");

        return this.callWebhook('generate_strategy_and_launch', {
            session_id: sessionId,
            ...data
        });
    }

    /**
     * Helper: Get Industry Name
     */
    async getIndustryName(id: number): Promise<string> {
        // As requested verify strictly via API, though inefficient
        // In practice we might cache this or just use local list
        try {
            const response = await this.callWebhook('get_industry_name', { id });
            return response.name || "Unknown Industry";
        } catch (e) {
            // Fallback to local
            // import { INDUSTRIES } from "@/data/industries"; // would cause circular dep or need dynamic import
            // simplifying fallback
            return `Industry ${id}`;
        }
    }
    /**
     * Save Draft State
     */
    async saveDraft(draft: any): Promise<{ success: boolean; draft_id?: string }> {
        // HOLD: Disable save_draft feature temporarily
        console.log('Draft sync is currently disabled (Local Mode).');
        // Return a mock success response so the UI continues to function
        // We use the draft.id if it exists, otherwise generate a temp ID locally if needed, 
        // but CreateICPDialog manages IDs mostly.
        return { success: true, draft_id: draft.id || "temp_local_draft_id" };

        /* 
        // Original Implementation Disabled
        const response = await this.callWebhook('save_draft', { draft });
        if (response && response.session_id) {
            return { success: true, draft_id: response.session_id };
        }
        return { success: !!response.success, draft_id: response.session_id };
        */
    }

    /**
     * Load Draft State
     */
    async loadDraft(draftId: string, userId: string): Promise<{ success: boolean; draft?: any; error?: string }> {
        const response = await this.callWebhook('load_draft', { draft_id: draftId, user_id: userId });
        if (response && response.draft) {
            return { success: true, draft: response.draft };
        }
        return { success: false, error: "Draft not found" };
    }
}

export const icpAPI = new ICPAPIClient();


export interface CalculateICPScoreRequest {
    action: 'calculate_icp_score';
    icp_data: {
        weights: {
            industry: number;
            revenue: number;
            size: number;
            tech: number;
        };
    };
    metadata: {
        user_id?: string;
        timestamp: string;
    };
}

export interface CalculateICPScoreResponse {
    score: number;
    match_level: string; // e.g., "High", "Medium"
    details: string;
}

export const screeningAPI = new ScreeningAPIClient();

// Error handling utility
export const handleScreeningAPIError = (error: any): string => {
    if (error.response) {
        switch (error.response.status) {
            case 401:
                return 'Unauthorized. Please check your credentials.';
            case 403:
                return 'Access forbidden. Your screening link may have expired.';
            case 404:
                return 'Session not found. Please restart the screening.';
            case 429:
                return 'Too many requests. Please wait a moment and try again.';
            case 500:
                return 'Server error. Please try again later.';
            default:
                return error.message || 'An unexpected error occurred.';
        }
    }
    return error.message || 'Network error. Please check your connection.';
};
