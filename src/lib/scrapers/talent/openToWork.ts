import { firecrawl } from '@/lib/firecrawl';
import { supabase } from '@/integrations/supabase/client';
import { ScraperResult, TalentSignalInsert, computeTier, logScrape } from '../types';

const QUERIES = [
  'site:linkedin.com "open to work" software engineer',
  'site:linkedin.com "open to new opportunities" product manager',
  'site:linkedin.com "seeking new role" tech lead',
];

const SENIOR_TITLES = ['head', 'lead', 'principal', 'staff', 'director', 'vp', 'cto', 'cpo'];

function isSenior(title: string): boolean {
  const lower = title.toLowerCase();
  return SENIOR_TITLES.some(t => lower.includes(t));
}

function daysSinceNow(dateStr: string): number {
  const d = new Date(dateStr);
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}

export async function scrapeOpenToWork(userId: string): Promise<ScraperResult> {
  const result: ScraperResult = { signalsCreated: 0, errors: [], feature: 'talent_open_to_work' };

  try {
    const allResults: any[] = [];
    
    for (const query of QUERIES) {
      try {
        const res = await firecrawl.search(query, { limit: 10 });
        if (res?.data) {
          allResults.push(...res.data);
        }
      } catch (e: any) {
        result.errors.push(`Query failed: ${e.message}`);
      }
    }

    const signals: TalentSignalInsert[] = [];

    for (const item of allResults) {
      const url = item.url || '';
      const title = item.title || '';
      const description = item.description || item.markdown || '';

      // Extract candidate info from search results
      const nameMatch = title.match(/^([^-–|]+)/);
      const candidateName = nameMatch ? nameMatch[1].trim() : 'Unknown';

      // Score calculation
      let score = 7; // default mid-range

      // Check for recency hints in description
      if (description.toLowerCase().includes('today') || description.toLowerCase().includes('1 day ago')) {
        score = 10;
      } else if (description.toLowerCase().includes('2 days ago') || description.toLowerCase().includes('3 days ago')) {
        score = 7;
      }

      // Check seniority
      const candidateTitle = title.split(/[-–|]/)[1]?.trim() || '';
      if (isSenior(candidateTitle)) {
        score += 5;
      }

      signals.push({
        user_id: userId,
        candidate_name: candidateName,
        candidate_linkedin_url: url.includes('linkedin.com') ? url : undefined,
        candidate_title: candidateTitle || undefined,
        signal_type: 'open_to_work',
        signal_title: `${candidateName} is open to work`,
        signal_summary: description.slice(0, 500),
        signal_source_url: url,
        signal_score: score,
        tier: computeTier(score),
      });
    }

    if (signals.length > 0) {
      const { error } = await (supabase as any).from('talent_signals').insert(signals);
      if (error) {
        result.errors.push(error.message);
      } else {
        result.signalsCreated = signals.length;
      }
    }
  } catch (e: any) {
    result.errors.push(e.message);
  }

  await logScrape(supabase, userId, result.feature, result.errors.length ? 'partial' : 'completed', result.signalsCreated, result.errors.join('; '));
  return result;
}
