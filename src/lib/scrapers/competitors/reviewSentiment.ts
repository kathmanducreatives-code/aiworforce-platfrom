import { firecrawl } from '@/lib/firecrawl';
import { supabase } from '@/integrations/supabase/client';
import { ScraperResult, logScrape } from '../types';

export async function scrapeReviewSentiment(userId: string): Promise<ScraperResult> {
  const result: ScraperResult = { signalsCreated: 0, errors: [], feature: 'competitor_review_sentiment' };

  try {
    const { data: competitors } = await (supabase as any)
      .from('competitor_companies')
      .select('*')
      .eq('user_id', userId);

    if (!competitors?.length) return result;

    for (const comp of competitors) {
      try {
        const companySlug = comp.company_name.toLowerCase().replace(/\s+/g, '-');
        const g2Url = `https://www.g2.com/products/${companySlug}/reviews`;

        const res = await firecrawl.scrapeUrl(g2Url, {
          formats: ['markdown'],
          onlyMainContent: true,
        });

        const markdown = res?.data?.markdown || res?.markdown || '';
        if (!markdown) continue;

        // Extract rating from G2 page
        const ratingMatch = markdown.match(/(\d+\.?\d*)\s*(?:out of|\/)\s*5/i);
        const reviewCountMatch = markdown.match(/(\d+)\s*reviews?/i);

        const g2Rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
        const g2ReviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1]) : null;

        // Look for complaint patterns
        const complaints = markdown.match(/(?:cons?|dislike|negative|downside)[:\s]+([^\n]+)/gi) || [];
        const praises = markdown.match(/(?:pros?|like|positive|upside)[:\s]+([^\n]+)/gi) || [];

        if (complaints.length >= 3) {
          await (supabase as any).from('competitor_intel_signals').insert({
            user_id: userId,
            competitor_id: comp.id,
            competitor_name: comp.company_name,
            signal_type: 'review_trend',
            signal_title: `${comp.company_name} receiving complaint patterns`,
            signal_summary: `Found ${complaints.length} recurring complaint themes in recent reviews.`,
            signal_data: { complaints: complaints.slice(0, 5), praises: praises.slice(0, 5) },
            signal_source_url: g2Url,
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
            signal_source_url: g2Url,
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
        result.errors.push(`${comp.company_name}: ${e.message}`);
      }
    }
  } catch (e: any) {
    result.errors.push(e.message);
  }

  await logScrape(supabase, userId, result.feature, result.errors.length ? 'partial' : 'completed', result.signalsCreated, result.errors.join('; '));
  return result;
}
