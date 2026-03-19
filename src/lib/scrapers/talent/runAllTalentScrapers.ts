import { scrapeOpenToWork } from './openToWork';
import { scrapeLayoffVictims } from './layoffVictims';
import { scrapePublishedContent } from './publishedContent';
import { scrapeCompanyAcquired } from './companyAcquired';
import { scrapeSpokeAtEvent } from './spokeAtEvent';
import { ScraperResult } from '../types';

export async function runAllTalentScrapers(userId: string): Promise<{
  totalSignals: number;
  results: ScraperResult[];
  errors: string[];
}> {
  const results = await Promise.all([
    scrapeOpenToWork(userId),
    scrapeLayoffVictims(userId),
    scrapePublishedContent(userId),
    scrapeCompanyAcquired(userId),
    scrapeSpokeAtEvent(userId),
  ]);

  const totalSignals = results.reduce((sum, r) => sum + r.signalsCreated, 0);
  const errors = results.flatMap(r => r.errors);

  return { totalSignals, results, errors };
}
