export type LeadSource = "job_board" | "linkedin_comment" | "vc_portfolio";
export type LeadTier = "hot" | "warm" | "skip";

export interface EnrichmentData {
  team_size_signal?: string | null;
  open_roles_count?: number | null;
  tech_stack?: string[];
  funding_signal?: string | null;
  recent_growth_signal?: string | null;
  enrichment_summary?: string | null;
}

export interface OutreachLead {
  id: string;
  source: LeadSource;
  company_name: string;
  contact_name?: string;
  contact_title?: string;
  contact_linkedin_url?: string;
  company_url: string;
  score: number;
  tier: LeadTier;
  pain_point: string;
  buying_signal_summary: string;
  original_comment?: string;
  source_post_url?: string;
  job_role?: string;
  enrichment_data: EnrichmentData;
  personalized_message: string;
  status: "pending" | "sent" | "replied" | "booked";
  created_at: string;
}

export interface JobBoardLeadInput {
  company_name: string;
  role_title: string;
  date_posted: string;
  company_url: string;
  job_url: string;
}

export interface LinkedinPost {
  post_url: string;
  post_author: string;
  post_text: string;
  engagement_count: number;
}

export interface Commenter {
  commenter_name: string;
  commenter_title: string;
  commenter_profile_url: string;
  comment_text: string;
  commenter_company: string;
  source_post_url: string;
}
