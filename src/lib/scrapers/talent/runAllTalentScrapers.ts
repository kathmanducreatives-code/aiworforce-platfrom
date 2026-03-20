import { scrapeOpenToWork } from './openToWork';
import { scrapeLayoffVictims } from './layoffVictims';
import { scrapePublishedContent } from './publishedContent';
import { scrapeCompanyAcquired } from './companyAcquired';
import { scrapeSpokeAtEvent } from './spokeAtEvent';
import { ScraperResult, logScrape } from '../types';
import { supabase } from '@/integrations/supabase/client';

export async function runAllTalentScrapers(userId: string): Promise<{
  totalSignals: number;
  results: ScraperResult[];
  errors: string[];
  duration_ms: number;
}> {
  const start = Date.now();

  const settled = await Promise.allSettled([
    scrapeOpenToWork(userId),
    scrapeLayoffVictims(userId),
    scrapePublishedContent(userId),
    scrapeCompanyAcquired(userId),
    scrapeSpokeAtEvent(userId),
  ]);

  const results: ScraperResult[] = [];
  const errors: string[] = [];

  for (const s of settled) {
    if (s.status === 'fulfilled') {
      results.push(s.value);
    } else {
      errors.push(s.reason?.message || 'Unknown scraper error');
      results.push({ signalsCreated: 0, errors: [s.reason?.message || 'Unknown'], feature: 'unknown' });
    }
  }

  const totalSignals = results.reduce((sum, r) => sum + r.signalsCreated, 0);
  errors.push(...results.flatMap(r => r.errors));
  const duration_ms = Date.now() - start;

  await logScrape(supabase, userId, 'run_all_talent_scrapers', errors.length ? 'partial' : 'completed', totalSignals, JSON.stringify({
    totalSignals,
    by_type: {
      open_to_work: results[0]?.signalsCreated || 0,
      layoff_victim: results[1]?.signalsCreated || 0,
      published_content: results[2]?.signalsCreated || 0,
      company_acquired: results[3]?.signalsCreated || 0,
      spoke_at_event: results[4]?.signalsCreated || 0,
    },
    duration_ms,
    error_count: errors.length,
  }));

  return { totalSignals, results, errors: [...new Set(errors)], duration_ms };
}
