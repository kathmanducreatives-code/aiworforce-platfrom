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
    closely_connection_status?: 'none' | 'pending' | 'accepted' | null;
    generated_sequence?: Array<{ step: number; dayOffset: number; content: string; approved?: boolean }>;
    signals: Signal[];
    sequence_id: string | null;
    current_sequence_step: number;
    last_touch_date: string | null;
    next_action_date: string | null;
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
