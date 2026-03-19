export interface ScraperResult {
  signalsCreated: number;
  errors: string[];
  feature: string;
}

export interface TalentSignalInsert {
  user_id: string;
  candidate_name?: string;
  candidate_linkedin_url?: string;
  candidate_email?: string;
  candidate_title?: string;
  candidate_company?: string;
  candidate_location?: string;
  candidate_photo_url?: string;
  signal_type: string;
  signal_title: string;
  signal_summary?: string;
  signal_source_url?: string;
  signal_score: number;
  tier: 'HOT' | 'WARM' | 'COLD';
  matched_job_id?: string;
  role_match_score?: number;
}

export interface CompetitorIntelSignalInsert {
  user_id: string;
  competitor_id?: string;
  competitor_name?: string;
  signal_type: string;
  signal_title: string;
  signal_summary?: string;
  signal_data?: any;
  signal_source_url?: string;
  signal_date?: string;
  importance: 'HIGH' | 'MEDIUM' | 'LOW';
}

export function computeTier(score: number): 'HOT' | 'WARM' | 'COLD' {
  if (score >= 15) return 'HOT';
  if (score >= 8) return 'WARM';
  return 'COLD';
}

export async function logScrape(
  supabase: any,
  userId: string,
  feature: string,
  status: string,
  signalsCount: number,
  errorMessage?: string
) {
  await (supabase as any).from('firecrawl_scrape_logs').insert({
    user_id: userId,
    feature,
    status,
    results_count: signalsCount,
    error_message: errorMessage,
    created_at: new Date().toISOString(),
  });
}
