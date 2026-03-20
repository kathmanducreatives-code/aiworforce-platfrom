import { firecrawl } from '@/lib/firecrawl';
import { supabase } from '@/integrations/supabase/client';
import { ScraperResult, logScrape } from '../types';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function scrapeReviewSentiment(userId: string): Promise<ScraperResult> {
  const result: ScraperResult = { signalsCreated: 0, errors: [], feature: 'competitor_review_sentiment' };

  try {
    const { data: competitors } = await (supabase as any)
      .from('competitor_companies')
      .select('*')
      .eq('user_id', userId);

    if (!competitors?.length) return result;

    for (const comp of competitors) {
      let g2Rating: number | null = null;
      let g2ReviewCount: number | null = null;
      let complaints: string[] = [];
      let praises: string[] = [];
      let g2Url = '';

      // Step 1: Find & scrape G2 profile
      try {
        const g2Search = await firecrawl.search(`${comp.company_name} site:g2.com reviews`, { limit: 3 });
        const g2Items = g2Search?.data || [];
        g2Url = g2Items.find((i: any) => i.url?.includes('g2.com'))?.url || '';

        if (g2Url) {
          await delay(500);
          const res = await firecrawl.scrapeUrl(g2Url, {
            formats: ['markdown'],
            onlyMainContent: true,
          });

          const markdown = res?.data?.markdown || res?.markdown || '';
          if (markdown) {
            const ratingMatch = markdown.match(/(\d+\.?\d*)\s*(?:out of|\/)\s*5/i);
            const reviewCountMatch = markdown.match(/(\d+)\s*reviews?/i);
            g2Rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
            g2ReviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1]) : null;

            complaints = (markdown.match(/(?:cons?|dislike|negative|downside)[:\s]+([^\n]+)/gi) || []).slice(0, 5);
            praises = (markdown.match(/(?:pros?|like|positive|upside)[:\s]+([^\n]+)/gi) || []).slice(0, 5);
          }
        }
        await delay(500);
      } catch (e: any) {
        result.errors.push(`${comp.company_name} G2: ${e.message}`);
      }

      // Step 2: Search Capterra
      try {
        const capRes = await firecrawl.search(`${comp.company_name} site:capterra.com reviews`, { limit: 3 });
        const capItems = capRes?.data || [];
        const capUrl = capItems.find((i: any) => i.url?.includes('capterra.com'))?.url || '';

        if (capUrl) {
          await delay(500);
          const res = await firecrawl.scrapeUrl(capUrl, {
            formats: ['markdown'],
            onlyMainContent: true,
          });

          const markdown = res?.data?.markdown || res?.markdown || '';
          if (markdown) {
            const capComplaints = (markdown.match(/(?:cons?|dislike|negative|downside)[:\s]+([^\n]+)/gi) || []);
            const capPraises = (markdown.match(/(?:pros?|like|positive|upside)[:\s]+([^\n]+)/gi) || []);
            complaints.push(...capComplaints.slice(0, 3));
            praises.push(...capPraises.slice(0, 3));
          }
        }
        await delay(500);
      } catch (e: any) {
        result.errors.push(`${comp.company_name} Capterra: ${e.message}`);
      }

      // Step 3: Generate signals
      try {
        if (complaints.length >= 3) {
          await (supabase as any).from('competitor_intel_signals').insert({
            user_id: userId,
            competitor_id: comp.id,
            competitor_name: comp.company_name,
            signal_type: 'review_trend',
            signal_title: `${comp.company_name} receiving complaint patterns`,
            signal_summary: `Found ${complaints.length} recurring complaint themes in recent reviews.`,
            signal_data: { complaints: complaints.slice(0, 5), praises: praises.slice(0, 5) },
            signal_source_url: g2Url || '',
            signal_date: new Date().toISOString(),
            importance: 'HIGH',
          });
          result.signalsCreated++;
        } else if (g2Rating) {
          await (supabase as any).from('competitor_intel_signals').insert({
            user_id: userId,
            competitor_id: comp.id,
            competitor_name: comp.company_name,
            signal_type: 'review_trend',
            signal_title: `${comp.company_name} G2 rating: ${g2Rating}/5`,
            signal_summary: `Current G2 rating is ${g2Rating}/5 based on ${g2ReviewCount || 'unknown'} reviews.`,
            signal_data: { g2_rating: g2Rating, g2_review_count: g2ReviewCount },
            signal_source_url: g2Url || '',
            signal_date: new Date().toISOString(),
            importance: 'MEDIUM',
          });
          result.signalsCreated++;
        }

        // Update competitor profile
        await (supabase as any).from('competitor_profiles').upsert({
          user_id: userId,
          competitor_id: comp.id,
          g2_rating: g2Rating,
          g2_review_count: g2ReviewCount,
          top_praise: praises.slice(0, 5),
          top_complaints: complaints.slice(0, 5),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'competitor_id' }).eq('user_id', userId);
      } catch (e: any) {
        result.errors.push(`${comp.company_name} signals: ${e.message}`);
      }
    }
  } catch (e: any) {
    result.errors.push(e.message);
  }

  await logScrape(supabase, userId, result.feature, result.errors.length ? 'partial' : 'completed', result.signalsCreated, result.errors.join('; '));
  return result;
}
