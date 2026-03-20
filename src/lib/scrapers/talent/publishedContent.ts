import { firecrawl } from '@/lib/firecrawl';
import { supabase } from '@/integrations/supabase/client';
import { ScraperResult, TalentSignalInsert, computeTier, logScrape } from '../types';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

const QUERIES = [
  'site:dev.to published this week software engineering',
  'site:medium.com engineering article 2026 startup',
  'substack engineering newsletter new post 2026',
];

const SENIOR_TITLES = ['head', 'lead', 'principal', 'staff', 'director', 'vp', 'cto'];

export async function scrapePublishedContent(userId: string): Promise<ScraperResult> {
  const result: ScraperResult = { signalsCreated: 0, errors: [], feature: 'talent_published_content' };

  try {
    const signals: TalentSignalInsert[] = [];

    for (const query of QUERIES) {
      try {
        const res = await firecrawl.search(query, { limit: 10 });
        const items = res?.data || [];

        for (const item of items) {
          const url = item.url || '';
          const title = item.title || '';
          const description = item.description || '';

          const authorMatch = title.match(/by\s+([^|–\-]+)/i) || description.match(/by\s+([^|–\-,]+)/i);
          const authorName = authorMatch ? authorMatch[1].trim() : 'Author';

          let score = 5;
          if (description.toLowerCase().includes('today') || description.toLowerCase().includes('1 day')) {
            score = 8;
          } else if (description.toLowerCase().includes('this week') || description.toLowerCase().includes('3 days')) {
            score = 5;
          }

          const isSenior = SENIOR_TITLES.some(t => description.toLowerCase().includes(t) || title.toLowerCase().includes(t));
          if (isSenior) score += 4;

          signals.push({
            user_id: userId,
            candidate_name: authorName,
            signal_type: 'published_content',
            signal_title: `Published: "${title.slice(0, 100)}"`,
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
