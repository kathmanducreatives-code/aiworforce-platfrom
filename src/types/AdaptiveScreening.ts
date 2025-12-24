// Enums matching database
export type ScreeningSessionStatus = 'invited' | 'in_progress' | 'completed' | 'expired' | 'abandoned';
export type BehavioralRiskLevel = 'low' | 'medium' | 'high';
export type ScenarioCategory = 'ambiguity' | 'accountability' | 'competing_priorities' | 'time_pressure' | 'conflict_resolution';

// Screening Session
export interface AdaptiveScreeningSession {
  id: string;
  candidate_id: string;
  session_status: ScreeningSessionStatus;
  access_token: string;
  invited_at: string;
  started_at?: string;
  completed_at?: string;
  expires_at: string;
  scenario_count: number;
  current_scenario_index: number;
  candidate_consent_given: boolean;
  consent_given_at?: string;
  created_at: string;
  updated_at: string;
}

// Scenario
export interface ScreeningScenario {
  id: string;
  name: string;
  category: ScenarioCategory;
  scenario_prompt: string;
  follow_up_prompts: string[];
  difficulty_level: number;
  target_signals: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Conversation Log
export interface ScreeningConversationLog {
  id: string;
  session_id: string;
  message_index: number;
  role: 'system' | 'assistant' | 'user';
  content: string;
  scenario_id?: string;
  behavioral_signals_detected: Record<string, any>;
  response_time_seconds?: number;
  created_at: string;
}

// Behavioral Analysis
export interface ScreeningBehavioralAnalysis {
  id: string;
  session_id: string;
  candidate_id: string;
  ownership_score?: number;
  ownership_evidence: BehavioralEvidence[];
  clarity_score?: number;
  clarity_evidence: BehavioralEvidence[];
  emotional_regulation_score?: number;
  emotional_evidence: BehavioralEvidence[];
  consistency_score?: number;
  consistency_evidence: BehavioralEvidence[];
  overall_risk_level?: BehavioralRiskLevel;
  risk_summary?: string;
  red_flags: BehavioralFlag[];
  green_flags: BehavioralFlag[];
  ai_confidence_score?: number;
  analysis_completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface BehavioralEvidence {
  quote: string;
  signal: string;
  strength: 'weak' | 'moderate' | 'strong';
  scenario_context?: string;
}

export interface BehavioralFlag {
  title: string;
  description: string;
  evidence_quote?: string;
  severity?: 'minor' | 'moderate' | 'major';
}

// Chat Message for UI
export interface ScreeningChatMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  timestamp: Date;
  isTyping?: boolean;
}

// Session with candidate info for recruiter view
export interface ScreeningSessionWithCandidate extends AdaptiveScreeningSession {
  candidate_name: string;
  candidate_email?: string;
  recruitment_name?: string;
  fit_score?: number;
  behavioral_analysis?: ScreeningBehavioralAnalysis;
}

// API request/response types
export interface StartScreeningRequest {
  token: string;
}

export interface ScreeningChatRequest {
  session_id: string;
  message: string;
  response_time_seconds?: number;
}

export interface ScreeningChatResponse {
  message: string;
  is_complete: boolean;
  current_scenario_index: number;
  total_scenarios: number;
}

export interface GenerateInviteRequest {
  candidate_id: string;
  scenario_count?: number;
  expires_in_days?: number;
}

export interface GenerateInviteResponse {
  session_id: string;
  access_token: string;
  screening_url: string;
  expires_at: string;
}
