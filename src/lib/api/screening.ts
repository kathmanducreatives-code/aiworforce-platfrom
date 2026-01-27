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
