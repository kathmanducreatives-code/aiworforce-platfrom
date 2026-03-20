import { firecrawl } from '@/lib/firecrawl';
import { supabase } from '@/integrations/supabase/client';
import { ScraperResult, TalentSignalInsert, computeTier, logScrape } from '../types';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

const QUERIES = [
  '"open to work" software engineer 2026',
  '"open to new opportunities" product manager tech',
  '"seeking new role" engineering lead startup',
  '"actively looking" senior engineer remote',
];

const SENIOR_TITLES = ['head', 'lead', 'principal', 'staff', 'director', 'vp', 'cto', 'cpo'];

function isSenior(title: string): boolean {
  const lower = title.toLowerCase();
  return SENIOR_TITLES.some(t => lower.includes(t));
}

export async function scrapeOpenToWork(userId: string): Promise<ScraperResult> {
  const result: ScraperResult = { signalsCreated: 0, errors: [], feature: 'talent_open_to_work' };

  try {
    const signals: TalentSignalInsert[] = [];

    for (const query of QUERIES) {
      try {
        const res = await firecrawl.search(query, { limit: 8 });
        const items = res?.data || [];

        for (const item of items) {
          const url = item.url || '';
          const title = item.title || '';
          const description = item.description || '';

          const nameMatch = title.match(/^([^-–|]+)/);
          const candidateName = nameMatch ? nameMatch[1].trim() : 'Unknown';
          const candidateTitle = title.split(/[-–|]/)[1]?.trim() || '';

          let score = 7;
          if (description.toLowerCase().includes('today') || description.toLowerCase().includes('1 day ago')) {
            score = 10;
          }
          if (isSenior(candidateTitle) || isSenior(description)) {
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

        await delay(500);
      } catch (e: any) {
        result.errors.push(`Query failed: ${e.message}`);
      }
    }

    if (signals.length > 0) {
      const { error } = await (supabase as any).from('talent_signals').insert(signals);
      if (error) result.errors.push(error.message);
      else result.signalsCreated = signals.length;
    }
  } catch (e: any) {
    result.errors.push(e.message);
  }

  await logScrape(supabase, userId, result.feature, result.errors.length ? 'partial' : 'completed', result.signalsCreated, result.errors.join('; '));
  return result;
}
