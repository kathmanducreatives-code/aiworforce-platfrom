import { firecrawl } from '@/lib/firecrawl';
import { supabase } from '@/integrations/supabase/client';
import { ScraperResult, logScrape } from '../types';

export async function scrapeExecutiveChanges(userId: string): Promise<ScraperResult> {
  const result: ScraperResult = { signalsCreated: 0, errors: [], feature: 'competitor_executive_changes' };

  try {
    const { data: competitors } = await (supabase as any)
      .from('competitor_companies')
      .select('*')
      .eq('user_id', userId);

    if (!competitors?.length) return result;

    for (const comp of competitors) {
      try {
        const queries = [
          `"${comp.company_name}" hires new CTO OR CPO OR CEO OR VP`,
          `"${comp.company_name}" executive joins OR leaves OR departure`,
        ];

        for (const query of queries) {
          const res = await firecrawl.search(query, { limit: 5 });
          const results = res?.data || [];

          for (const item of results) {
            const title = item.title || '';
            const description = item.description || '';
            const url = item.url || '';

            // Check if it's actually about an executive change
            if (!/cto|cpo|ceo|vp|chief|president|head of|director/i.test(title + description)) continue;

            await (supabase as any).from('competitor_intel_signals').insert({
              user_id: userId,
              competitor_id: comp.id,
              competitor_name: comp.company_name,
              signal_type: 'executive_change',
              signal_title: title.slice(0, 200),
              signal_summary: description.slice(0, 500),
              signal_source_url: url,
              signal_date: new Date().toISOString(),
              importance: 'HIGH',
            });
            result.signalsCreated++;
          }
        }

      } catch (e: any) {
        result.errors.push(`${comp.company_name}: ${e.message}`);
      }
    }
  } catch (e: any) {
    result.errors.push(e.message);
  }

  await logScrape(supabase, userId, result.feature, result.errors.length ? 'partial' : 'completed', result.signalsCreated, result.errors.join('; '));
  return result;
}
