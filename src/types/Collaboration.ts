export type CandidateSource = 'resume_screening' | 'deep_search' | 'linkedin_scraper' | 'screening_flow';

export interface CollaborationRoom {
  id: string;
  name: string;
  description?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  is_archived: boolean;
}

export interface RoomMember {
  id: string;
  room_id: string;
  user_id: string;
  joined_at: string;
  last_seen_at: string;
  profile?: {
    full_name?: string;
    logo_url?: string;
  };
}

export interface CollaborationMessage {
  id: string;
  room_id: string;
  user_id?: string;
  content: string;
  mentions: string[];
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  profile?: {
    full_name?: string;
    logo_url?: string;
  };
}

export interface CandidateAttachment {
  id: string;
  room_id: string;
  candidate_source: CandidateSource;
  candidate_id: string;
  attached_by?: string;
  attached_at: string;
  fit_score?: number;
  custom_notes?: string;
  tags?: CandidateTag[];
  comments?: CandidateComment[];
}

export interface CandidateComment {
  id: string;
  attachment_id: string;
  user_id?: string;
  comment: string;
  created_at: string;
  updated_at: string;
  profile?: {
    full_name?: string;
  };
}

export interface CandidateTag {
  id: string;
  attachment_id: string;
  tag: string;
  created_by?: string;
  created_at: string;
}

export interface ContactHistory {
  id: string;
  candidate_source: CandidateSource;
  candidate_id: string;
  contacted_by?: string;
  contacted_at: string;
  contact_method?: string;
  notes?: string;
  profile?: {
    full_name?: string;
  };
}

export interface UnifiedCandidate {
  id: string;
  source: CandidateSource;
  name: string;
  title?: string;
  company?: string;
  email?: string;
  fitScore?: number;
  status?: string;
  linkedin_url?: string;
  notes?: string;
}
