import { firecrawl } from '@/lib/firecrawl';
import { supabase } from '@/integrations/supabase/client';
import { ScraperResult, TalentSignalInsert, logScrape } from '../types';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function scrapeLayoffVictims(userId: string): Promise<ScraperResult> {
  const result: ScraperResult = { signalsCreated: 0, errors: [], feature: 'talent_layoff_victims' };

  try {
    // Step 1: Scrape layoffs.fyi
    let layoffCompanies: Array<{ company: string; date: string; count: string }> = [];

    try {
      const res = await firecrawl.scrapeUrl('https://layoffs.fyi', {
        formats: ['markdown'],
        onlyMainContent: true,
      });

      const markdown = res?.data?.markdown || res?.markdown || '';
      const lines = markdown.split('\n').filter((l: string) => l.includes('|') && !l.includes('---'));

      for (const line of lines.slice(0, 20)) {
        const cols = line.split('|').map((c: string) => c.trim()).filter(Boolean);
        if (cols.length < 3) continue;
        const companyName = cols[0]?.replace(/\[|\]/g, '').replace(/\(.*?\)/g, '').trim();
        if (!companyName || companyName.toLowerCase() === 'company') continue;
        layoffCompanies.push({ company: companyName, date: cols[1]?.trim() || '', count: cols[2]?.trim() || '' });
      }
    } catch (e: any) {
      result.errors.push(`layoffs.fyi scrape: ${e.message}`);
    }

    // Step 2: Search for affected individuals from top layoffs
    const signals: TalentSignalInsert[] = [];

    for (const layoff of layoffCompanies.slice(0, 5)) {
      // Check existing candidates at this company
      try {
        const { data: existingCandidates } = await (supabase as any)
          .from('candidate_profiles')
          .select('id, name, current_company, linkedin_url')
          .ilike('current_company', `%${layoff.company}%`)
          .limit(5);

        if (existingCandidates?.length) {
          for (const candidate of existingCandidates) {
            signals.push({
              user_id: userId,
              candidate_name: candidate.name || layoff.company + ' employee',
              candidate_linkedin_url: candidate.linkedin_url,
              candidate_company: layoff.company,
              signal_type: 'layoff_victim',
              signal_title: `${candidate.name || 'Candidate'} may be affected by ${layoff.company} layoffs`,
              signal_summary: `${layoff.company} announced layoffs${layoff.count ? ` affecting ${layoff.count} employees` : ''}${layoff.date ? ` on ${layoff.date}` : ''}. This candidate works there.`,
              signal_source_url: 'https://layoffs.fyi',
              signal_score: 15,
              tier: 'HOT',
            });
          }
        }
      } catch (e: any) {
        result.errors.push(`candidate check ${layoff.company}: ${e.message}`);
      }

      // Search for affected people
      try {
        const res = await firecrawl.search(`"${layoff.company}" layoff affected employees LinkedIn 2026`, { limit: 5 });
        const items = res?.data || [];

        for (const item of items) {
          const title = item.title || '';
          const description = item.description || '';
          const url = item.url || '';

          if (!/layoff|laid off|let go|affected|impacted/i.test(title + description)) continue;

          signals.push({
            user_id: userId,
            candidate_company: layoff.company,
            signal_type: 'layoff_victim',
            signal_title: `Affected by ${layoff.company} layoff — ${layoff.count || 'unknown'} people laid off`,
            signal_summary: description.slice(0, 500) || `${layoff.company} announced layoffs${layoff.count ? ` affecting ${layoff.count} employees` : ''}.`,
            signal_source_url: url || 'https://layoffs.fyi',
            signal_score: 15,
            tier: 'HOT',
          });
        }

        await delay(500);
      } catch (e: any) {
        result.errors.push(`search ${layoff.company}: ${e.message}`);
      }
    }

    // Also add generic layoff signals for companies not searched individually
    for (const layoff of layoffCompanies.slice(5)) {
      signals.push({
        user_id: userId,
        candidate_company: layoff.company,
        signal_type: 'layoff_victim',
        signal_title: `${layoff.company} layoffs — ${layoff.count || 'unknown'} affected`,
        signal_summary: `${layoff.company} announced layoffs${layoff.count ? ` affecting ${layoff.count} employees` : ''}${layoff.date ? ` on ${layoff.date}` : ''}.`,
        signal_source_url: 'https://layoffs.fyi',
        signal_score: 15,
        tier: 'HOT',
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
