import { firecrawl } from '@/lib/firecrawl';
import { supabase } from '@/integrations/supabase/client';
import { ScraperResult, logScrape } from '../types';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

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
        const baseUrl = websiteUrl.replace(/\/$/, '');

        // Scrape blog
        const blogPosts: string[] = [];
        for (const path of ['/blog', '/news', '/updates']) {
          try {
            const blogRes = await firecrawl.scrapeUrl(`${baseUrl}${path}`, {
              formats: ['markdown'],
              onlyMainContent: true,
            });
            const blogMarkdown = blogRes?.data?.markdown || blogRes?.markdown || '';
            if (blogMarkdown && blogMarkdown.length > 100) {
              const postMatches = blogMarkdown.match(/#{1,3}\s+.+/g) || [];
              blogPosts.push(...postMatches.slice(0, 5).map((p: string) => p.replace(/^#+\s+/, '').trim()));
              break;
            }
            await delay(500);
          } catch {
            continue;
          }
        }

        for (const postTitle of blogPosts) {
          if (!postTitle || postTitle.length < 10) continue;
          await (supabase as any).from('competitor_intel_signals').insert({
            user_id: userId,
            competitor_id: comp.id,
            competitor_name: comp.company_name,
            signal_type: 'content_published',
            signal_title: `${comp.company_name} published: "${postTitle.slice(0, 100)}"`,
            signal_summary: `New blog post found on ${comp.company_name}'s blog.`,
            signal_source_url: `${baseUrl}/blog`,
            signal_date: new Date().toISOString(),
            importance: 'LOW',
          });
          result.signalsCreated++;
        }

        // Scrape changelog
        try {
          for (const path of ['/changelog', '/releases', '/whats-new']) {
            try {
              const clRes = await firecrawl.scrapeUrl(`${baseUrl}${path}`, {
                formats: ['markdown'],
                onlyMainContent: true,
              });
              const clMarkdown = clRes?.data?.markdown || clRes?.markdown || '';
              if (clMarkdown && clMarkdown.length > 100) {
                const updates = clMarkdown.match(/#{1,3}\s+.+/g) || [];
                for (const update of updates.slice(0, 3)) {
                  const updateTitle = update.replace(/^#+\s+/, '').trim();
                  if (updateTitle.length < 5) continue;
                  await (supabase as any).from('competitor_intel_signals').insert({
                    user_id: userId,
                    competitor_id: comp.id,
                    competitor_name: comp.company_name,
                    signal_type: 'new_feature',
                    signal_title: `${comp.company_name} released: "${updateTitle.slice(0, 100)}"`,
                    signal_summary: `Product update found in ${comp.company_name}'s changelog.`,
                    signal_source_url: `${baseUrl}${path}`,
                    signal_date: new Date().toISOString(),
                    importance: 'MEDIUM',
                  });
                  result.signalsCreated++;
                }
                break;
              }
              await delay(500);
            } catch {
              continue;
            }
          }
        } catch (e: any) {
          result.errors.push(`${comp.company_name} changelog: ${e.message}`);
        }

        // Search ProductHunt
        try {
          const phRes = await firecrawl.search(`${comp.company_name} site:producthunt.com`, { limit: 3 });
          const phItems = phRes?.data || [];
          for (const item of phItems) {
            const title = item.title || '';
            const description = item.description || '';
            if (title.length < 5) continue;
            await (supabase as any).from('competitor_intel_signals').insert({
              user_id: userId,
              competitor_id: comp.id,
              competitor_name: comp.company_name,
              signal_type: 'new_feature',
              signal_title: `${comp.company_name} on ProductHunt: "${title.slice(0, 100)}"`,
              signal_summary: description.slice(0, 500) || `Found on ProductHunt.`,
              signal_source_url: item.url || '',
              signal_date: new Date().toISOString(),
              importance: 'HIGH',
            });
            result.signalsCreated++;
          }
          await delay(500);
        } catch (e: any) {
          result.errors.push(`${comp.company_name} PH: ${e.message}`);
        }

        // Detect positioning shifts
        const aiTerms = blogPosts.filter(p => /ai|machine learning|llm|gpt|automation/i.test(p));
        if (aiTerms.length >= 3) {
          await (supabase as any).from('competitor_intel_signals').insert({
            user_id: userId,
            competitor_id: comp.id,
            competitor_name: comp.company_name,
            signal_type: 'positioning_shift',
            signal_title: `${comp.company_name} is pivoting toward AI`,
            signal_summary: `${aiTerms.length} of their recent ${blogPosts.length} blog posts focus on AI/ML topics.`,
            signal_source_url: `${baseUrl}/blog`,
            signal_date: new Date().toISOString(),
            importance: 'HIGH',
          });
          result.signalsCreated++;
        }

        // Update profile
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
