import { firecrawl } from '@/lib/firecrawl';
import { supabase } from '@/integrations/supabase/client';
import { ScraperResult, TalentSignalInsert, computeTier, logScrape } from '../types';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function scrapeCompanyAcquired(userId: string): Promise<ScraperResult> {
  const result: ScraperResult = { signalsCreated: 0, errors: [], feature: 'talent_company_acquired' };

  try {
    const queries = [
      'tech startup acquired 2026 employees',
      'startup acquisition announcement this month 2026',
    ];

    const signals: TalentSignalInsert[] = [];

    for (const query of queries) {
      try {
        const res = await firecrawl.search(query, { limit: 10 });
        const items = res?.data || [];

        for (const item of items) {
          const url = item.url || '';
          const title = item.title || '';
          const description = item.description || '';

          const companyMatch = title.match(/(\w[\w\s]+)\s+(acquires?|acquired|buys?|bought)\s+(\w[\w\s]+)/i);
          const acquiringCompany = companyMatch?.[1]?.trim() || '';
          const acquiredCompany = companyMatch?.[3]?.trim() || title.slice(0, 50);

          let score = 8;
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

        await delay(500);
      } catch (e: any) {
        result.errors.push(`Query failed: ${e.message}`);
      }
    }

    // Also try TechCrunch M&A page
    try {
      const tcRes = await firecrawl.scrapeUrl('https://techcrunch.com/category/mergers-acquisitions/', {
        formats: ['markdown'],
        onlyMainContent: true,
      });
      const markdown = tcRes?.data?.markdown || tcRes?.markdown || '';
      if (markdown) {
        const headlines = markdown.match(/#{1,3}\s+.+/g) || [];
        for (const headline of headlines.slice(0, 5)) {
          const h = headline.replace(/^#+\s+/, '').trim();
          if (h.length < 10 || !/acqui|buy|merge/i.test(h)) continue;

          signals.push({
            user_id: userId,
            signal_type: 'company_acquired',
            signal_title: h.slice(0, 200),
            signal_summary: `Acquisition news from TechCrunch: ${h}`,
            signal_source_url: 'https://techcrunch.com/category/mergers-acquisitions/',
            signal_score: 10,
            tier: computeTier(10),
          });
        }
      }
    } catch (e: any) {
      result.errors.push(`TechCrunch scrape: ${e.message}`);
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
