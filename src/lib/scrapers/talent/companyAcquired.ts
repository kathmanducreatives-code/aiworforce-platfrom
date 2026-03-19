import { firecrawl } from '@/lib/firecrawl';
import { supabase } from '@/integrations/supabase/client';
import { ScraperResult, TalentSignalInsert, computeTier, logScrape } from '../types';

export async function scrapeCompanyAcquired(userId: string): Promise<ScraperResult> {
  const result: ScraperResult = { signalsCreated: 0, errors: [], feature: 'talent_company_acquired' };

  try {
    const queries = [
      'tech company acquired 2025',
      'startup acquisition announcement this month',
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

      // Extract company names from acquisition headlines
      const companyMatch = title.match(/(\w[\w\s]+)\s+(acquires?|acquired|buys?|bought)\s+(\w[\w\s]+)/i);
      const acquiringCompany = companyMatch?.[1]?.trim() || '';
      const acquiredCompany = companyMatch?.[3]?.trim() || title.slice(0, 50);

      let score = 8; // default for older acquisitions
      if (description.toLowerCase().includes('today') || description.toLowerCase().includes('this week')) {
        score = 12;
      }

      signals.push({
        user_id: userId,
        candidate_company: acquiredCompany,
        signal_type: 'company_acquired',
        signal_title: `${acquiredCompany} acquired${acquiringCompany ? ` by ${acquiringCompany}` : ''}`,
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
