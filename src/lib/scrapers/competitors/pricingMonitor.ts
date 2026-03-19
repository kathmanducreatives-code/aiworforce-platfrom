import { firecrawl } from '@/lib/firecrawl';
import { supabase } from '@/integrations/supabase/client';
import { ScraperResult, logScrape } from '../types';

export async function scrapePricingMonitor(userId: string): Promise<ScraperResult> {
  const result: ScraperResult = { signalsCreated: 0, errors: [], feature: 'competitor_pricing_monitor' };

  try {
    const { data: competitors } = await (supabase as any)
      .from('competitor_companies')
      .select('*')
      .eq('user_id', userId);

    if (!competitors?.length) return result;

    for (const comp of competitors) {
      try {
        const websiteUrl = comp.website_url || `https://${comp.company_name.toLowerCase().replace(/\s+/g, '')}.com`;
        const pricingUrl = `${websiteUrl.replace(/\/$/, '')}/pricing`;

        const res = await firecrawl.scrapeUrl(pricingUrl, {
          formats: ['markdown'],
          onlyMainContent: true,
        });

        const markdown = res?.data?.markdown || res?.markdown || '';
        if (!markdown) continue;

        // Get latest pricing history for comparison
        const { data: latestHistory } = await (supabase as any)
          .from('pricing_history')
          .select('*')
          .eq('competitor_id', comp.id)
          .eq('user_id', userId)
          .order('scraped_at', { ascending: false })
          .limit(1);

        const previousData = latestHistory?.[0]?.pricing_data;
        const currentData = { raw_markdown: markdown.slice(0, 5000), scraped_url: pricingUrl };
        const changeDetected = previousData ? JSON.stringify(previousData) !== JSON.stringify(currentData) : false;

        // Insert pricing history
        const { data: historyEntry } = await (supabase as any)
          .from('pricing_history')
          .insert({
            user_id: userId,
            competitor_id: comp.id,
            pricing_data: currentData,
            change_detected: changeDetected,
            change_summary: changeDetected ? `Pricing page content changed for ${comp.company_name}` : null,
            previous_entry_id: latestHistory?.[0]?.id || null,
          })
          .select()
          .single();

        if (changeDetected) {
          await (supabase as any).from('competitor_intel_signals').insert({
            user_id: userId,
            competitor_id: comp.id,
            competitor_name: comp.company_name,
            signal_type: 'pricing_change',
            signal_title: `${comp.company_name} pricing page updated`,
            signal_summary: `Pricing page content has changed since last scan.`,
            signal_data: currentData,
            signal_source_url: pricingUrl,
            signal_date: new Date().toISOString(),
            importance: 'HIGH',
          });
          result.signalsCreated++;
        }

        // Update competitor profiles
        await (supabase as any).from('competitor_profiles').upsert({
          user_id: userId,
          competitor_id: comp.id,
          last_full_scan_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'competitor_id' }).eq('user_id', userId);

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
