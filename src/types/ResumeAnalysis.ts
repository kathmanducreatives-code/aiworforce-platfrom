export type CandidateStatus = 
  | 'new' 
  | 'reviewing' 
  | 'contacted' 
  | 'interview_scheduled' 
  | 'interviewed' 
  | 'offer_extended' 
  | 'hired' 
  | 'rejected';

export interface TimelineEvent {
  id: string;
  type: 'status_change' | 'note_added' | 'email_sent' | 'resume_uploaded' | 'analysis_completed';
  title: string;
  description: string;
  timestamp: string;
  userId?: string;
  userName?: string;
}

export interface CandidateNote {
  id: string;
  candidate_id: string;
  content: string;
  created_at: string;
  created_by: string;
  created_by_name: string;
}

export interface ResumeAnalysis {
  id?: string;
  date?: string;
  resume: string;
  candidateName: string;
  email: string;
  strengths: string[];
  weaknesses: string[];
  riskFactor: number;
  rewardFactor: number;
  fitScore: number;
  overallFactor: number;
  justification: string;
  recruitmentName?: string;
  // New display fields for text scores
  riskScore?: string;
  rewardScore?: string;
  fitScoreText?: string;
  overallScore?: number;
  // Status tracking
  status?: CandidateStatus;
  statusUpdatedAt?: string;
  statusUpdatedBy?: string;
  // Timeline and notes
  timeline?: TimelineEvent[];
  notes?: CandidateNote[];
}

export interface AnalysisResult {
  success: boolean;
  data?: ResumeAnalysis[];
  error?: string;
}

export interface SaveAnalysisResult {
  success: boolean;
  message?: string;
  error?: string;
}