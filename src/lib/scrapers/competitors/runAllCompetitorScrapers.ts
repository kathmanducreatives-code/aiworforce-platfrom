import { scrapePricingMonitor } from './pricingMonitor';
import { scrapeProductIntel } from './productIntel';
import { scrapeReviewSentiment } from './reviewSentiment';
import { scrapeExecutiveChanges } from './executiveChanges';
import { analyzeHiringPatterns } from './hiringPatternAnalysis';
import { ScraperResult, logScrape } from '../types';
import { supabase } from '@/integrations/supabase/client';

export async function runAllCompetitorScrapers(userId: string): Promise<{
  totalSignals: number;
  results: ScraperResult[];
  errors: string[];
  duration_ms: number;
}> {
  const start = Date.now();

  const settled = await Promise.allSettled([
    scrapePricingMonitor(userId),
    scrapeProductIntel(userId),
    scrapeReviewSentiment(userId),
    scrapeExecutiveChanges(userId),
    analyzeHiringPatterns(userId),
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

  await logScrape(supabase, userId, 'run_all_competitor_scrapers', errors.length ? 'partial' : 'completed', totalSignals, JSON.stringify({
    totalSignals,
    by_type: {
      pricing_monitor: results[0]?.signalsCreated || 0,
      product_intel: results[1]?.signalsCreated || 0,
      review_sentiment: results[2]?.signalsCreated || 0,
      executive_changes: results[3]?.signalsCreated || 0,
      hiring_patterns: results[4]?.signalsCreated || 0,
    },
    duration_ms,
    error_count: errors.length,
  }));

  return { totalSignals, results, errors: [...new Set(errors)], duration_ms };
}
