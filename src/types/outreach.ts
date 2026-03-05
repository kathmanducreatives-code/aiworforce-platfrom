export interface OutreachLead {
    id: string;
    created_at: string;
    commenter_name: string;
    commenter_title?: string;
    commenter_company?: string;
    commenter_linkedin_url?: string;
    commenter_profile_picture_url?: string;
    comment_text: string;
    commenter_score: number; // 1–5
    score_signals: string[]; // e.g. ['Decision Maker', 'Frustrated', 'Agency Mention']
    generated_connection_note: string;
    dm_sent: boolean;
    discovery_source: string;
    post_url?: string;
    folder?: string;
}

export interface PostSearchResult {
    id: string;
    author_name: string;
    author_profile_url?: string;
    author_headline?: string;
    post_url: string;
    post_snippet: string;
    reactions_count: number;
    comments_count: number;
    posted_at?: string;
}

export type InterceptionStep = 'search' | 'loading' | 'leads';

export type LeadFilter = 'hot' | 'warm' | 'archived';
