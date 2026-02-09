// TypeScript interfaces for ICP Management
export interface ICPProfile {
    id: string;
    name: string;
    industries: string[];
    industry_names?: string[];
    revenue_range?: string;
    company_size: string;
    location?: string[];
    hiring_intensity?: 'High' | 'Medium' | 'Low';
    tech_stack?: string[];
    lookalike_data?: any;
    feature_weights?: any;
    scoring_weights?: {
        industry: number;
        revenue: number;
        size: number;
        tech: number;
    };
    target_score?: number;
    created_at: string;
    updated_at?: string;
    // Enhanced metadata
    status?: string;
    scrape_status?: string;
    results_count?: number;
    strong_matches_count?: number;
    candidate_count?: number;
    avg_score?: number;
}

// Workflow Phases
export type ICPPhase =
    | 'input_collected'
    | 'profile_extracted'
    | 'ai_strategy_generated'
    | 'pre_scrape_ready'
    | 'scrape_executed'
    | 'post_scrape_scored'
    | 'completed';

export interface ICPDraft {
    id?: string; // Optional for new drafts
    user_id: string; // Ownership
    workspace_id: string; // Security

    // Workflow Control
    current_phase: ICPPhase;
    current_step: number; // For UI restoration
    last_completed_phase?: ICPPhase;
    version: number; // v2

    // User Inputs (Persisted from Step 1 & 2)
    role_titles: string[]; // Mapped from name/persona
    industries: string[];
    company_size: string[];
    company_location: string[];
    hiring_intensity: 'High' | 'Medium' | 'Low';
    candidate_requirements?: string;

    // System State
    lookalike_url?: string;
    extracted_profile?: ICPFormData['lookalikeProfile'];
    ai_targeting_strategy?: string; // text strategy
    normalized_search_logic?: string; // search logic dna
    execution_params?: any; // Technical constraints

    // Meta
    created_at: string;
    updated_at: string;
}

export interface ICPFormData {
    name: string;
    industries: string[];
    tech_stack: string[];
    excluded_industries?: string[]; // IDs to explicitly exclude
    company_size: string;
    company_location?: string[]; // New
    hiringIntensity?: 'High' | 'Medium' | 'Low'; // New
    target_results_count?: number; // New: Step 1
    // Persona Intent (Step 2)
    candidate_requirements?: string;

    // Lookalike fields
    lookalikeUrl?: string;
    lookalikeProfile?: {
        name: string;
        current_title: string; // Mapped from title
        company: string;
        top_skills: string[]; // Mapped from skills
        education_summary: string; // Mapped from education
        education?: any[]; // Full education array
        total_years_experience?: string;
        seniority_level?: string;
        summary?: string;
        past_companies?: string[];
        work_history?: any[];
        photo_url?: string;
        experience_summary?: string;
    };

    // Strategy & Verification (Step 4)
    generated_strategy?: string;
    final_query?: string;

    // AI Strategy Data (Step 4 Integration)
    strategyData?: {
        search_logic_dna: string;
        firmographic_constraints: any; // Object or array
        technical_execution: any; // Object or array
    };

    // Weighting
    featureWeights?: {
        education: number;
        experience: number;
        skills: number;
        seniority: number;
    };

    // Smart Scoring (Legacy but kept for compatibility if needed)
    scoring_weights?: {
        industry: number;
        revenue: number;
        size: number;
        tech: number;
    };
}

export const REVENUE_RANGES = [
    { value: 'under_1m', label: 'Under $1M' },
    { value: '1m_10m', label: '$1M - $10M' },
    { value: '10m_50m', label: '$10M - $50M' },
    { value: '50m_100m', label: '$50M - $100M' },
    { value: 'over_100m', label: 'Over $100M' },
];

export const COMPANY_SIZES = [
    { value: '1_10', label: '1-10 employees' },
    { value: '11_50', label: '11-50 employees' },
    { value: '51_200', label: '51-200 employees' },
    { value: '201_500', label: '201-500 employees' },
    { value: '501_1000', label: '501-1000 employees' },
    { value: 'over_1000', label: '1000+ employees' },
];

export const TECH_STACK_OPTIONS = [
    // CRM
    { category: 'CRM', value: 'salesforce', label: 'Salesforce' },
    { category: 'CRM', value: 'hubspot', label: 'HubSpot' },
    { category: 'CRM', value: 'pipedrive', label: 'Pipedrive' },
    { category: 'CRM', value: 'zoho', label: 'Zoho CRM' },

    // Marketing
    { category: 'Marketing', value: 'marketo', label: 'Marketo' },
    { category: 'Marketing', value: 'pardot', label: 'Pardot' },
    { category: 'Marketing', value: 'mailchimp', label: 'Mailchimp' },
    { category: 'Marketing', value: 'sendgrid', label: 'SendGrid' },

    // Analytics
    { category: 'Analytics', value: 'segment', label: 'Segment' },
    { category: 'Analytics', value: 'mixpanel', label: 'Mixpanel' },
    { category: 'Analytics', value: 'amplitude', label: 'Amplitude' },
    { category: 'Analytics', value: 'google_analytics', label: 'Google Analytics' },

    // Sales
    { category: 'Sales', value: 'outreach', label: 'Outreach' },
    { category: 'Sales', value: 'salesloft', label: 'SalesLoft' },
    { category: 'Sales', value: 'gong', label: 'Gong' },
    { category: 'Sales', value: 'chorus', label: 'Chorus.ai' },

    // DevTools
    { category: 'DevTools', value: 'github', label: 'GitHub' },
    { category: 'DevTools', value: 'gitlab', label: 'GitLab' },
    { category: 'DevTools', value: 'jira', label: 'Jira' },
    { category: 'DevTools', value: 'confluence', label: 'Confluence' },
];

// Candidate Result Type
export interface ICPCandidate {
    id: string;
    name: string;
    headline: string;
    current_company: string;
    location: string;
    avatar_url?: string;
    match_score: number;
    match_justification?: string; // AI Logic DNA
    linkedin_url?: string;
    experience: Array<{
        company: string;
        title: string;
        duration: string;
    }>;
}

export interface ProfileResult {
    id: string;
    name: string;
    photo_url?: string;
    headline?: string;
    current_title?: string;
    current_company?: string;
    location?: string;
    seniority_level?: string;
    years_experience?: number;
    similarity_score?: number;
    match_quality?: 'strong' | 'good' | 'moderate';
    linkedin_url?: string;
    top_skills?: string[];
    education?: { school: string; degree: string }[];
    work_history?: { company: string; title: string; duration?: string }[];
    match_reason?: string;
    tier_source?: number;
    inserted_at?: string;
    email?: string; // Email field for reveal functionality
    email_confidence?: 'high' | 'medium' | 'low' | 'none'; // Confidence of the email
    email_source?: string; // Source of the email (e.g. 'apify_linkedin_detail')
}
