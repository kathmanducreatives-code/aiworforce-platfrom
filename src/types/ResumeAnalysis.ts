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
  overallScore?: number; // Changed from string to number for progress bar
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