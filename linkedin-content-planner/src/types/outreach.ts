export interface OutreachLead {
    id: string;
    company: string;
    contact_name: string;
    title: string | null;
    email: string | null;
    linkedin_url: string | null;
    industry: string | null;
    company_size: string | null;
    notes: string | null;
    tier: 'unassigned' | 'tier_1' | 'tier_2' | 'tier_3';
    status: 'not_started' | 'in_sequence' | 'replied' | 'meeting_booked' | 'closed' | 'dead';
    scrape_status?: 'success' | 'failed_scrape' | 'in_progress' | null;
    scrape_url?: string | null;
    scraped_homepage?: string | null;
    scraped_careers?: string | null;
    generated_connection_note?: string | null;
    scraped_at?: string | null;
    closely_connection_status?: 'none' | 'pending' | 'accepted' | null;
    generated_sequence?: Array<{ step: number; dayOffset: number; content: string; approved?: boolean }>;
    signals: Signal[];
    sequence_id: string | null;
    current_sequence_step: number;
    last_touch_date: string | null;
    next_action_date: string | null;
    hiring_detected?: boolean | null;
    open_roles?: string | null;
    salary_range?: string | null;
    uses_agency?: boolean | null;
    agency_name?: string | null;
    hiring_source?: string | null;
    recent_news?: string | null;
    founder_about?: string | null;
    discovery_source?: string | null;
    role_count?: number | null;
    // Competitor Post Interceptor columns
    source_post_url?: string | null;
    source_post_author?: string | null;
    original_comment?: string | null;
    pain_point_detected?: string | null;
    commenter_score?: number | null;
    created_at: string;
    updated_at: string;
}

export interface Signal {
    type: 'hiring' | 'funding' | 'new_exec' | 'tech_change' | 'content_signal' | 'trigger_event' | 'pain_indicator';
    summary: string;
    detail: string;
    hook: string;
    confidence: 'high' | 'medium' | 'low';
    date_detected: string | null;
}

export interface OutreachSequence {
    id: string;
    name: string;
    description?: string;
    status: 'draft' | 'active' | 'paused';
    steps: SequenceStep[];
    leads_enrolled?: number;
    settings?: Record<string, any>;
    created_at: string;
    updated_at?: string;
}

export interface SequenceStep {
    id: string;
    sequence_id: string;
    step_number: number;
    type: 'email' | 'send_email' | 'linkedin_message' | 'send_linkedin_dm' | 'linkedin_connect' | 'linkedin_engage' | 'delay' | 'wait' | 'manual_task';
    channel?: 'email' | 'linkedin_dm' | 'linkedin_connect' | 'linkedin_engage' | 'manual';
    config: Record<string, any>;
    created_at: string;
}

export interface OutreachActivity {
    id: string;
    lead_id: string;
    sequence_id: string | null;
    step_number: number | null;
    channel: string;
    action_type: string;
    subject: string | null;
    body: string | null;
    scheduled_date: string | null;
    executed_date: string | null;
    status: 'pending' | 'sent' | 'skipped' | 'failed';
    response_received: boolean;
    response_text: string | null;
    created_at: string;
}

export interface OutreachSettings {
    id: string;
    user_id?: string;
    product_context: string;
    email_signature: string;
    default_cta: string;
    linkedin_daily_connect_limit: number;
    linkedin_daily_dm_limit: number;
}
