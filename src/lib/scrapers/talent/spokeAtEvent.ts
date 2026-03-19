import { firecrawl } from '@/lib/firecrawl';
import { supabase } from '@/integrations/supabase/client';
import { ScraperResult, TalentSignalInsert, computeTier, logScrape } from '../types';

const SENIOR_TITLES = ['head', 'lead', 'principal', 'staff', 'director', 'vp', 'cto', 'cpo'];

export async function scrapeSpokeAtEvent(userId: string): Promise<ScraperResult> {
  const result: ScraperResult = { signalsCreated: 0, errors: [], feature: 'talent_spoke_at_event' };

  try {
    const queries = [
      'tech conference speaker 2025 software engineer',
      'meetup speaker engineering this month',
      'tech summit keynote speaker 2025',
    ];

    const allResults: any[] = [];
    for (const query of queries) {
      try {
        const res = await firecrawl.search(query, { limit: 10 });
        if (res?.data) allResults.push(...res.data);
      } catch (e: any) {
        result.errors.push(`Query failed: ${e.message}`);
      }
    }

    const signals: TalentSignalInsert[] = [];

    for (const item of allResults) {
      const url = item.url || '';
      const title = item.title || '';
      const description = item.description || '';

      let score = 7;
      if (description.toLowerCase().includes('upcoming') || description.toLowerCase().includes('next week')) {
        score = 7;
      } else if (description.toLowerCase().includes('last week') || description.toLowerCase().includes('yesterday')) {
        score = 9;
      }

      const isSenior = SENIOR_TITLES.some(t => description.toLowerCase().includes(t) || title.toLowerCase().includes(t));
      if (isSenior) score += 4;

      signals.push({
        user_id: userId,
        signal_type: 'spoke_at_event',
        signal_title: `Speaker: "${title.slice(0, 100)}"`,
        signal_summary: description.slice(0, 500),
        signal_source_url: url,
        signal_score: score,
        tier: computeTier(score),
      });
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
