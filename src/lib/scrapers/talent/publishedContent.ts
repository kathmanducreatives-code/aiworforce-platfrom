import { firecrawl } from '@/lib/firecrawl';
import { supabase } from '@/integrations/supabase/client';
import { ScraperResult, TalentSignalInsert, computeTier, logScrape } from '../types';

const QUERIES = [
  'site:dev.to software engineering published this week',
  'site:medium.com engineering blog post this week',
  'site:substack.com engineering newsletter this week',
];

const SENIOR_TITLES = ['head', 'lead', 'principal', 'staff', 'director', 'vp', 'cto'];

export async function scrapePublishedContent(userId: string): Promise<ScraperResult> {
  const result: ScraperResult = { signalsCreated: 0, errors: [], feature: 'talent_published_content' };

  try {
    const allResults: any[] = [];

    for (const query of QUERIES) {
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

      // Extract author from title patterns like "Author Name - Article Title"
      const authorMatch = title.match(/by\s+([^|–-]+)/i) || description.match(/by\s+([^|–-,]+)/i);
      const authorName = authorMatch ? authorMatch[1].trim() : 'Author';

      let score = 8;
      // Recency boost
      if (description.toLowerCase().includes('today') || description.toLowerCase().includes('1 day')) {
        score = 8;
      }
      // Seniority check
      const isSenior = SENIOR_TITLES.some(t => description.toLowerCase().includes(t));
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
