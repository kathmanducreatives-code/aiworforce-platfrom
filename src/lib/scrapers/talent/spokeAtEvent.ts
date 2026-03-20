import { firecrawl } from '@/lib/firecrawl';
import { supabase } from '@/integrations/supabase/client';
import { ScraperResult, TalentSignalInsert, computeTier, logScrape } from '../types';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

const SENIOR_TITLES = ['head', 'lead', 'principal', 'staff', 'director', 'vp', 'cto', 'cpo'];

export async function scrapeSpokeAtEvent(userId: string): Promise<ScraperResult> {
  const result: ScraperResult = { signalsCreated: 0, errors: [], feature: 'talent_spoke_at_event' };

  try {
    const queries = [
      'tech conference speaker 2026 software engineer',
      'meetup speaker engineering startup 2026',
      'keynote speaker developer conference 2026',
      'site:sessionize.com speaker profile engineer 2026',
    ];

    const signals: TalentSignalInsert[] = [];

    for (const query of queries) {
      try {
        const res = await firecrawl.search(query, { limit: 8 });
        const items = res?.data || [];

        for (const item of items) {
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
