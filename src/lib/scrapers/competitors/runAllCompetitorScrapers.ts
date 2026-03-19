import { scrapePricingMonitor } from './pricingMonitor';
import { scrapeProductIntel } from './productIntel';
import { scrapeReviewSentiment } from './reviewSentiment';
import { scrapeExecutiveChanges } from './executiveChanges';
import { analyzeHiringPatterns } from './hiringPatternAnalysis';
import { ScraperResult } from '../types';

export async function runAllCompetitorScrapers(userId: string): Promise<{
  totalSignals: number;
  results: ScraperResult[];
  errors: string[];
}> {
  const results = await Promise.all([
    scrapePricingMonitor(userId),
    scrapeProductIntel(userId),
    scrapeReviewSentiment(userId),
    scrapeExecutiveChanges(userId),
    analyzeHiringPatterns(userId),
  ]);

  const totalSignals = results.reduce((sum, r) => sum + r.signalsCreated, 0);
  const errors = results.flatMap(r => r.errors);

  return { totalSignals, results, errors };
}
