import { firecrawl } from '@/lib/firecrawl';
import { supabase } from '@/integrations/supabase/client';
import { ScraperResult, logScrape } from '../types';

export async function scrapeProductIntel(userId: string): Promise<ScraperResult> {
  const result: ScraperResult = { signalsCreated: 0, errors: [], feature: 'competitor_product_intel' };

  try {
    const { data: competitors } = await (supabase as any)
      .from('competitor_companies')
      .select('*')
      .eq('user_id', userId);

    if (!competitors?.length) return result;

    for (const comp of competitors) {
      try {
        const websiteUrl = comp.website_url || `https://${comp.company_name.toLowerCase().replace(/\s+/g, '')}.com`;
        const blogUrl = `${websiteUrl.replace(/\/$/, '')}/blog`;

        // Scrape blog
        const blogRes = await firecrawl.scrapeUrl(blogUrl, {
          formats: ['markdown'],
          onlyMainContent: true,
        });

        const blogMarkdown = blogRes?.data?.markdown || blogRes?.markdown || '';

        if (blogMarkdown) {
          // Extract blog post titles/topics
          const postMatches = blogMarkdown.match(/#{1,3}\s+.+/g) || [];
          const recentPosts = postMatches.slice(0, 5);

          for (const post of recentPosts) {
            const postTitle = post.replace(/^#+\s+/, '').trim();
            if (!postTitle || postTitle.length < 10) continue;

            await (supabase as any).from('competitor_intel_signals').insert({
              user_id: userId,
              competitor_id: comp.id,
              competitor_name: comp.company_name,
              signal_type: 'content_published',
              signal_title: `${comp.company_name} published: "${postTitle.slice(0, 100)}"`,
              signal_summary: `New blog post found on ${comp.company_name}'s blog.`,
              signal_source_url: blogUrl,
              signal_date: new Date().toISOString(),
              importance: 'MEDIUM',
            });
            result.signalsCreated++;
          }

          // Detect positioning shifts: check if multiple posts mention same theme
          const aiTerms = recentPosts.filter(p => /ai|machine learning|llm|gpt|automation/i.test(p));
          if (aiTerms.length >= 3) {
            await (supabase as any).from('competitor_intel_signals').insert({
              user_id: userId,
              competitor_id: comp.id,
              competitor_name: comp.company_name,
              signal_type: 'positioning_shift',
              signal_title: `${comp.company_name} is pivoting toward AI`,
              signal_summary: `${aiTerms.length} of their recent ${recentPosts.length} blog posts focus on AI/ML topics, suggesting a positioning shift.`,
              signal_source_url: blogUrl,
              signal_date: new Date().toISOString(),
              importance: 'HIGH',
            });
            result.signalsCreated++;
          }
        }

        // Update profile with features
        await (supabase as any).from('competitor_profiles').upsert({
          user_id: userId,
          competitor_id: comp.id,
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
